const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const MMSI_START = 408000001;
const MMSI_END = 408999998;

// --- Authentication Helper for HTTPS Functions ---
const authenticate = (req) => {
    const expected = process.env.ASSIGN_MMSI_TOKEN || process.env.API_TOKEN || process.env.API_SECRET;

    if (!expected) return true; // Backward compatibility if no token set (WARN: Insecure)

    const authHeader = req.headers['authorization'];
    const bearer = authHeader && authHeader.toLowerCase().startsWith('bearer ')
        ? authHeader.slice(7)
        : null;
    const headerToken = bearer || req.headers['x-api-token'];

    return headerToken && headerToken === expected;
};

// --- Logic Helpers ---
const findNextAvailable = (assignedSet, exclusions) => {
    const isExcluded = (mmsi) =>
        exclusions.some((ex) => {
            const start = parseInt(ex.start_mmsi, 10);
            const end = parseInt(ex.end_mmsi, 10);
            return mmsi >= start && mmsi <= end;
        });

    for (let i = MMSI_START; i <= MMSI_END; i++) {
        if (!assignedSet.has(i) && !isExcluded(i)) return i;
    }
    return null;
};

// --- HTTPS Function: Assign MMSI ---
exports.assignMmsi = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    if (!authenticate(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    try {
        const payload = req.body;
        const {
            ship_name,
            call_sign,
            registration_date,
            expiry_date,
            owner_name,
            reg_no,
            ship_type = 'Gen'
        } = payload;

        if (!ship_name || !call_sign || !registration_date || !expiry_date || !owner_name || !reg_no) {
            res.status(400).json({
                error: 'ship_name, call_sign, owner_name, reg_no, registration_date, and expiry_date are required'
            });
            return;
        }

        // Run inside a transaction to prevent race conditions
        // However, since we read ALL docs, transaction might be too heavy or fail on contention if reading too much.
        // Given the logic "find first available", we can't lock the whole range.
        // Strategy: Read snapshots first, calculate candidate, then try to create in Transaction.
        // If transaction fails (document already exists), logic should retry.
        // But Firestore Transactions require reads to come BEFORE writes.
        // So we'll scan first outside transaction (optimistic), then verify in transaction.

        // 1. Get all active ships and exclusions (Optimistic read)
        const [shipsSnapshot, exclusionsSnapshot] = await Promise.all([
            db.collection('active_ships').select('mmsi').get(),
            db.collection('mmsi_exclusions').get()
        ]);

        const assignedSet = new Set();
        shipsSnapshot.forEach(doc => {
            // active_ships in Supabase had 'mmsi' column. In Firestore we can use Document ID as MMSI or a field.
            // The code uses `mmsi` field. Let's stick to that, but also maybe use it as Doc ID for uniqueness.
            // Original: upsert on mmsi. So Doc ID = MMSI is best for uniqueness check.
            const data = doc.data();
            if (data.mmsi) assignedSet.add(parseInt(data.mmsi, 10));
            // Also check doc.id if it's numeric? Let's assume field 'mmsi'.
        });

        const exclusions = [];
        exclusionsSnapshot.forEach(doc => exclusions.push(doc.data()));

        let candidate = findNextAvailable(assignedSet, exclusions);
        if (!candidate) {
            res.status(409).json({ error: 'No available MMSI within configured range' });
            return;
        }

        let finalMmsi = null;
        let attempts = 0;
        const maxAttempts = 5;

        while (candidate && !finalMmsi && attempts < maxAttempts) {
            attempts++;
            const candidateStr = candidate.toString();
            const docRef = db.collection('active_ships').doc(candidateStr);

            try {
                await db.runTransaction(async (t) => {
                    const doc = await t.get(docRef);
                    if (doc.exists) {
                        throw new Error("Collision");
                    }
                    t.set(docRef, {
                        mmsi: candidateStr,
                        ship_name,
                        call_sign,
                        owner_name,
                        reg_no,
                        ship_type,
                        registration_date,
                        expiry_date,
                        created_at: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // Also update mmsi_pool
                    // Original used upsert.
                    const poolRef = db.collection('mmsi_pool').doc(candidateStr);
                    t.set(poolRef, {
                        mmsi: candidateStr,
                        status: 'Assigned',
                        assigned_name: ship_name,
                        updated_at: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                });
                finalMmsi = candidateStr;
            } catch (e) {
                if (e.message === "Collision") {
                    console.log(`Collision for ${candidateStr}, retrying...`);
                    assignedSet.add(candidate);
                    candidate = findNextAvailable(assignedSet, exclusions);
                } else {
                    throw e;
                }
            }
        }

        if (!finalMmsi) {
            res.status(409).json({ error: 'Unable to assign MMSI due to concurrent updates or full range' });
            return;
        }

        const responsePayload = {
            mmsi: finalMmsi,
            ship_name,
            call_sign,
            registration_date,
            expiry_date,
            owner_name,
            reg_no,
            ship_type,
            ship: {
                ship_name,
                call_sign,
                registration_date,
                expiry_date,
                owner_name,
                reg_no,
                ship_type
            }
        };

        res.status(200).json(responsePayload);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message || 'Unexpected server error' });
    }
});

// --- Callable Function: Create User (Admin Only) ---
exports.createUser = functions.https.onCall(async (data, context) => {
    // Check if user is admin. 
    // We can check custom claims or look up the user in a 'user_roles' collection like the frontend does.
    // For safety, let's look up 'user_roles'.
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    // Check Admin Role
    // NOTE: This assumes 'user_roles' collection exists and has { user_id: '...', role: 'admin' }
    const callerId = context.auth.uid;
    const roleDoc = await db.collection('user_roles').where('user_id', '==', callerId).get();
    let isAdmin = false;
    if (!roleDoc.empty && roleDoc.docs[0].data().role === 'admin') {
        isAdmin = true;
    }

    if (!isAdmin) {
        throw new functions.https.HttpsError('permission-denied', 'Only admins can create users.');
    }

    const { new_email, new_password, new_role } = data;
    if (!new_email || !new_password || !new_role) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing fields');
    }

    try {
        const userRecord = await admin.auth().createUser({
            email: new_email,
            password: new_password,
        });

        // Add to user_roles
        await db.collection('user_roles').add({
            user_id: userRecord.uid,
            email: new_email,
            role: new_role,
            created_at: admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true, uid: userRecord.uid };
    } catch (error) {
        throw new functions.https.HttpsError('internal', error.message);
    }
});

// --- Callable Function: Update User Password (Admin Only) ---
exports.updateUserPassword = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const callerId = context.auth.uid;
    const roleDoc = await db.collection('user_roles').where('user_id', '==', callerId).get();
    let isAdmin = false;
    if (!roleDoc.empty && roleDoc.docs[0].data().role === 'admin') {
        isAdmin = true;
    }

    if (!isAdmin) {
        throw new functions.https.HttpsError('permission-denied', 'Only admins can update passwords.');
    }

    const { target_user_id, new_password } = data;

    try {
        await admin.auth().updateUser(target_user_id, {
            password: new_password
        });
        return { success: true };
    } catch (error) {
        throw new functions.https.HttpsError('internal', error.message);
    }
});
