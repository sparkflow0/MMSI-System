import { createClient } from '@supabase/supabase-js';

const MMSI_START = 408000001;
const MMSI_END = 408999998;

const getEnv = () => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.VITE_SUPABASE_KEY;

  if (!url || !key) {
    throw new Error('Supabase credentials are missing (SUPABASE_URL and service key)');
  }

  return { url, key };
};

const authenticate = (req) => {
  const expected =
    process.env.ASSIGN_MMSI_TOKEN ||
    process.env.API_TOKEN ||
    process.env.API_SECRET;

  if (!expected) return true; // no token configured: allow for backward compatibility

  const authHeader = req.headers['authorization'];
  const bearer = authHeader && authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7)
    : null;
  const headerToken = bearer || req.headers['x-api-token'];

  return headerToken && headerToken === expected;
};

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!authenticate(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const { url, key } = getEnv();
    const supabase = createClient(url, key);

    const readBody = async () => {
      if (req.body) return req.body;
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      if (!chunks.length) return {};
      const raw = Buffer.concat(chunks).toString('utf8');
      return raw ? JSON.parse(raw) : {};
    };

    const payload = await readBody();
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

    const [activeShips, exclusions] = await Promise.all([
      supabase.from('active_ships').select('mmsi'),
      supabase.from('mmsi_exclusions').select('*')
    ]);

    if (activeShips.error) throw activeShips.error;
    if (exclusions.error) throw exclusions.error;

    const assignedSet = new Set(
      (activeShips.data || []).map((s) => parseInt(s.mmsi, 10)).filter((n) => !Number.isNaN(n))
    );

    let candidate = findNextAvailable(assignedSet, exclusions.data || []);
    if (!candidate) {
      res.status(409).json({ error: 'No available MMSI within configured range' });
      return;
    }

    let finalMmsi = null;
    while (candidate && !finalMmsi) {
      const { error } = await supabase.from('active_ships').insert([
        {
          mmsi: candidate.toString(),
          ship_name,
          call_sign,
          owner_name,
          reg_no,
          ship_type,
          registration_date,
          expiry_date
        }
      ]);

      if (!error) {
        finalMmsi = candidate.toString();
      } else if (error.code === '23505') {
        // Collision (likely concurrent assignment) - try the next available number
        assignedSet.add(candidate);
        candidate = findNextAvailable(assignedSet, exclusions.data || []);
      } else {
        throw error;
      }
    }

    if (!finalMmsi) {
      res.status(409).json({ error: 'Unable to assign MMSI due to concurrent updates' });
      return;
    }

    await supabase
      .from('mmsi_pool')
      .upsert(
        [{ mmsi: finalMmsi, status: 'Assigned', assigned_name: ship_name }],
        { onConflict: 'mmsi' }
      );

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
    res.status(500).json({ error: err.message || 'Unexpected server error' });
  }
}
