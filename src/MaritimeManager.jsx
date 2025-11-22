import React, { useState, useEffect, useMemo } from 'react';
import { 
  Ship, Search, Plus, FileText, Trash2, LayoutDashboard, Anchor, 
  Radio, CheckCircle, AlertTriangle, Menu, X, Save, RefreshCw, 
  Settings, Upload, Split, Check, Info, Edit2, Ban, ListX, FileSearch, 
  Loader2, Eye, History, Users, Shield, LogOut, Clock,
  FileCheck, Activity, AlertOctagon, UserPlus, Key
} from 'lucide-react';

// --- CONFIGURATION ---
const apiKey = "AIzaSyCMkoBqWYbSAuLHIzTbieEM5jRlvJoyL1I"; 

// --- UTILITIES ---

function formatMmsi(mmsi) {
    if (!mmsi) return '';
    const s = mmsi.toString();
    if (s.length !== 9) return s;
    return `${s.slice(0,3)} ${s.slice(3,6)} ${s.slice(6,9)}`;
}

function getShipStatus(expiryDate, regDate, certPath) {
    if (!expiryDate || !regDate || !certPath) return 'missing';
    const today = new Date();
    const exp = new Date(expiryDate);
    const diffTime = exp - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return 'expired';
    if (diffDays <= 30) return 'expiring';
    return 'active';
}

function parseCSV(text, type) {
  const lines = text.split('\n');
  const isBook2 = lines[0].toLowerCase().includes('vessel name'); 
  const data = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const row = [];
    let current = '';
    let insideQuote = false;
    for (let char of lines[i]) {
      if (char === '"') { insideQuote = !insideQuote; } 
      else if (char === ',' && !insideQuote) { row.push(current.trim()); current = ''; } 
      else { current += char; }
    }
    row.push(current.trim());
    const obj = {};
    
    if (type === 'active') {
        if (isBook2) {
            let rawMmsi = row[0];
            if(rawMmsi) rawMmsi = rawMmsi.replace(/\s/g, ''); 
            if (!rawMmsi) continue;
            obj.mmsi = rawMmsi;
            obj.owner_name = row[1] || '';
            obj.ship_name = row[8] || '';
            obj.call_sign = row[9] || '';
            obj.ship_type = row[13] || 'Gen';
            obj.reg_no = row[14] || '';
            obj.validity = new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString(); 
        } else {
            let rawMmsi = row[13]; 
            if(rawMmsi) rawMmsi = rawMmsi.replace(/\s/g, '');
            if (!rawMmsi) continue;
            obj.mmsi = rawMmsi;
            obj.ship_name = row[3];
            obj.reg_no = row[14] || '';
        }
    } 
    if(obj.mmsi) data.push(obj); 
  }
  return data;
}

const convertPdfToImage = async (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsArrayBuffer(file);
        reader.onload = async (e) => {
            try {
                if (!window.pdfjsLib) {
                    const script = document.createElement('script');
                    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
                    script.onload = () => {
                        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
                        processPdf(e.target.result, resolve, reject);
                    };
                    script.onerror = reject;
                    document.body.appendChild(script);
                } else {
                    processPdf(e.target.result, resolve, reject);
                }
            } catch (err) {
                reject(err);
            }
        };
    });
};

const processPdf = async (data, resolve, reject) => {
    try {
        const pdf = await window.pdfjsLib.getDocument(data).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({ canvasContext: context, viewport: viewport }).promise;
        const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
        resolve(base64);
    } catch (err) {
        reject(err);
    }
};

const analyzeCertificateWithAI = async (imageBase64) => {
    const today = new Date().toISOString().split('T')[0];
    const prompt = `
        You are an expert maritime document analyzer. 
        Analyze the attached Boat Registration Certificate image. The document is bilingual (English and Arabic).
        Extract the following information precisely. Use the English text values if available, but understand the Arabic labels to locate them.
        
        Fields to Extract:
        1. "vesselName": Look for "Vehicle Name" / "اسم السفينة".
        2. "regNo": Look for "Vessel No" / "رقم السفينة" or "Registration No".
        3. "ownerName": Look for Owner details usually at the bottom or labeled "Owner" / "المالك".
        4. "shipType": Look for "Vessel Type" / "نوع السفينة".
        5. "callSign": Look for "Call Sign" / "إشارة النداء". If not present, return an empty string.
        6. "registrationDate": Look for "Date of Registry" / "تاريخ التسجيل". Convert format to YYYY-MM-DD.
        7. "validUntil": Look for "Valid until" / "صالحة لغاية" or "Expiry Date". Convert format to YYYY-MM-DD.
        8. "isExpired": Boolean. True if "validUntil" is before today's date (${today}), otherwise false.

        Output Format:
        Return ONLY a valid, raw JSON object. Do not wrap in markdown code blocks.
    `;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: prompt },
                        { inline_data: { mime_type: "image/jpeg", data: imageBase64 } }
                    ]
                }],
                generationConfig: {
                    response_mime_type: "application/json"
                }
            })
        });

        if (!response.ok) throw new Error('AI Service Error');
        const result = await response.json();
        let text = result.candidates[0].content.parts[0].text;
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(text);
    } catch (error) {
        console.error("AI Analysis Failed", error);
        throw error;
    }
};

// --- SUB-COMPONENTS (Defined BEFORE Main Component to avoid ReferenceError) ---

const SidebarItem = ({ id, icon: Icon, label, setView, currentView, isMobile, closeMobileMenu }) => (
  <button
    onClick={() => { setView(id); if(isMobile) closeMobileMenu(); }}
    className={`w-full flex items-center space-x-3 px-6 py-4 transition-colors ${
      currentView === id ? 'bg-blue-800 text-white border-r-4 border-blue-400' : 'text-blue-100 hover:bg-blue-800'
    }`}
  >
    <Icon size={20} />
    <span className="font-medium">{label}</span>
  </button>
);

const StatCard = ({ label, value, icon: Icon, color, subtext }) => (
  <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-center space-x-4">
    <div className={`p-4 rounded-full ${color} text-white`}>
      <Icon size={24} />
    </div>
    <div>
      <p className="text-sm text-slate-500 font-medium uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold text-slate-800">{value ? value.toLocaleString() : 0}</p>
      {subtext && <p className="text-xs text-slate-400 mt-1">{subtext}</p>}
    </div>
  </div>
);

const LoginView = ({ handleLogin, loading }) => {
    const [email, setEmail] = useState('');
    const [pass, setPass] = useState('');
    return (
        <div className="flex h-screen items-center justify-center bg-slate-900">
            <div className="bg-white p-10 rounded-2xl shadow-2xl w-full max-w-md">
                <div className="text-center mb-8">
                    <div className="bg-blue-600 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-white">
                        <Anchor size={32}/>
                    </div>
                    <h1 className="text-2xl font-bold text-slate-800">Maritime Portal</h1>
                    <p className="text-slate-500">MMSI Assignment System</p>
                </div>
                <form onSubmit={(e) => { e.preventDefault(); handleLogin(email, pass); }} className="space-y-4">
                    <div><label className="block text-sm font-bold text-slate-700">Email</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} className="w-full p-3 border rounded-lg" required/></div>
                    <div><label className="block text-sm font-bold text-slate-700">Password</label><input type="password" value={pass} onChange={e=>setPass(e.target.value)} className="w-full p-3 border rounded-lg" required/></div>
                    <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700">{loading ? 'Signing In...' : 'Sign In'}</button>
                </form>
            </div>
        </div>
    );
};

const UserManagementView = ({ usersList, updateUserRole, createUser, changeUserPassword }) => {
  const [isCreating, setIsCreating] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', password: '', role: 'requester' });
  const [resettingUser, setResettingUser] = useState(null); 
  const [newPass, setNewPass] = useState('');

  const handleCreate = async (e) => {
    e.preventDefault();
    await createUser(newUser.email, newUser.password, newUser.role);
    setIsCreating(false);
    setNewUser({ email: '', password: '', role: 'requester' });
  };
  
  const handlePasswordReset = async (e) => {
      e.preventDefault();
      if(!resettingUser || !newPass) return;
      await changeUserPassword(resettingUser, newPass);
      setResettingUser(null);
      setNewPass('');
  };

  return (
    <div className="bg-white rounded-xl shadow p-6">
        <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-bold text-slate-800 flex items-center"><Users className="mr-2"/> User Access Management</h3>
            <button onClick={() => setIsCreating(!isCreating)} className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center hover:bg-blue-700">
                <UserPlus size={18} className="mr-2"/> Add User
            </button>
        </div>

        {isCreating && (
            <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-100">
                <h4 className="font-bold text-blue-800 mb-3">Create New User</h4>
                <form onSubmit={handleCreate} className="flex gap-4 items-end">
                    <div className="flex-1">
                        <label className="block text-xs font-bold text-blue-600 mb-1">Email</label>
                        <input type="email" required value={newUser.email} onChange={e=>setNewUser({...newUser, email: e.target.value})} className="w-full p-2 border rounded" />
                    </div>
                    <div className="flex-1">
                        <label className="block text-xs font-bold text-blue-600 mb-1">Password</label>
                        <input type="password" required value={newUser.password} onChange={e=>setNewUser({...newUser, password: e.target.value})} className="w-full p-2 border rounded" />
                    </div>
                    <div className="w-32">
                        <label className="block text-xs font-bold text-blue-600 mb-1">Role</label>
                        <select value={newUser.role} onChange={e=>setNewUser({...newUser, role: e.target.value})} className="w-full p-2 border rounded">
                            <option value="requester">Requester</option>
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                        </select>
                    </div>
                    <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded font-bold hover:bg-blue-700">Create</button>
                </form>
            </div>
        )}
        
        {resettingUser && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <div className="bg-white p-6 rounded-lg shadow-xl w-96">
                    <h4 className="text-lg font-bold mb-4">Reset Password</h4>
                    <form onSubmit={handlePasswordReset} className="space-y-4">
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1">New Password</label>
                            <input type="password" required value={newPass} onChange={e=>setNewPass(e.target.value)} className="w-full p-2 border rounded" placeholder="Enter new password"/>
                        </div>
                        <div className="flex justify-end gap-2">
                            <button type="button" onClick={() => setResettingUser(null)} className="px-3 py-1 text-slate-500 hover:bg-slate-100 rounded">Cancel</button>
                            <button type="submit" className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
                        </div>
                    </form>
                </div>
            </div>
        )}

        <table className="w-full text-left text-sm">
            <thead className="bg-slate-100"><tr><th className="p-3">Email</th><th className="p-3">Role</th><th className="p-3">Actions</th></tr></thead>
            <tbody>
                {usersList.map(u => (
                    <tr key={u.id} className="border-b">
                        <td className="p-3">{u.email}</td>
                        <td className="p-3"><span className={`px-2 py-1 rounded text-xs font-bold uppercase ${u.role==='admin'?'bg-purple-100 text-purple-700':u.role==='user'?'bg-blue-100 text-blue-700':'bg-slate-100'}`}>{u.role}</span></td>
                        <td className="p-3 flex items-center gap-2">
                            <select value={u.role} onChange={(e) => updateUserRole(u.user_id, e.target.value)} className="border rounded p-1 text-xs">
                                <option value="requester">Requester</option>
                                <option value="user">Officer</option>
                                <option value="admin">Admin</option>
                            </select>
                            <button onClick={() => setResettingUser(u.user_id)} title="Change Password" className="p-1 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded">
                                <Key size={16}/>
                            </button>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
  );
};

const RequestManagementView = ({ requests, processRequest }) => (
    <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-lg shadow border-l-4 border-amber-500">
                <p className="text-xs text-slate-500 uppercase">Pending</p>
                <p className="text-2xl font-bold">{requests.filter(r=>r.status==='pending').length}</p>
            </div>
        </div>
        <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-bold mb-4">Pending Assignments</h3>
            {requests.filter(r=>r.status==='pending').length === 0 ? (
                <p className="text-slate-400 italic">No pending requests.</p>
            ) : (
                <div className="space-y-4">
                    {requests.filter(r=>r.status==='pending').map(req => (
                        <div key={req.id} className="border rounded-lg p-4 flex justify-between items-center">
                            <div>
                                <p className="font-bold text-slate-800">{req.ship_name}</p>
                                <p className="text-sm text-slate-500">Req by: {req.requester_email} | Type: {req.ship_type}</p>
                            </div>
                            <div className="flex space-x-2">
                                <button onClick={() => processRequest(req, 'reject', 'Incomplete Docs')} className="px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 text-sm">Reject</button>
                                <button onClick={() => processRequest(req, 'approve')} className="px-3 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 text-sm">Approve & Assign</button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    </div>
);

const AuditLogView = ({ auditLogs }) => (
    <div className="bg-white rounded-xl shadow p-6">
        <h3 className="text-lg font-bold mb-4 flex items-center"><Activity className="mr-2"/> System Activity Log</h3>
        <div className="overflow-x-auto h-96">
            <table className="w-full text-left text-sm">
                <thead className="bg-slate-100 sticky top-0"><tr><th className="p-3">Time</th><th className="p-3">User</th><th className="p-3">Action</th><th className="p-3">Details</th></tr></thead>
                <tbody className="divide-y">
                    {auditLogs.map(log => (
                        <tr key={log.id}>
                            <td className="p-3 text-slate-500">{new Date(log.created_at).toLocaleString()}</td>
                            <td className="p-3 font-medium">{log.user_email}</td>
                            <td className="p-3"><span className="bg-slate-100 px-2 py-0.5 rounded text-xs font-mono">{log.action}</span></td>
                            <td className="p-3 text-slate-600 truncate max-w-xs">{log.details}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </div>
);

const ConflictModal = ({ conflicts, resolved, resolve, finalize, setConflicts }) => {
    if (!conflicts || conflicts.length === 0) return null;
    const resolvedCount = resolved.length;
    const totalCount = conflicts.length;
    const isComplete = resolvedCount === totalCount;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                <div className="p-6 border-b bg-amber-50 rounded-t-xl flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-bold text-amber-800 flex items-center">
                            <Split className="mr-2" /> Duplicate Entries Detected
                        </h2>
                        <p className="text-amber-700 text-sm mt-1">
                            The file contains <strong>{totalCount} MMSI numbers</strong> that appear multiple times.
                        </p>
                    </div>
                    <div className="text-right">
                        <p className="text-2xl font-bold text-amber-800">{resolvedCount} / {totalCount}</p>
                        <p className="text-xs text-amber-600 font-bold uppercase">Resolved</p>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50">
                    {conflicts.map((conflict, idx) => {
                        const isResolved = resolved.find(r => r.mmsi === conflict.mmsi);
                        return (
                            <div key={conflict.mmsi} className={`bg-white border rounded-lg overflow-hidden transition-all ${isResolved ? 'border-emerald-200 opacity-60' : 'border-blue-200 shadow-md'}`}>
                                <div className={`px-4 py-2 flex justify-between items-center ${isResolved ? 'bg-emerald-50' : 'bg-blue-50'}`}>
                                    <span className="font-mono font-bold text-slate-700">MMSI: {formatMmsi(conflict.mmsi)}</span>
                                    {isResolved && <span className="text-xs font-bold text-emerald-600 flex items-center"><Check size={14} className="mr-1"/> RESOLVED</span>}
                                </div>
                                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {conflict.variants.map((variant, vIdx) => (
                                        <button key={vIdx} onClick={() => resolve(conflict.mmsi, variant)} className={`text-left p-3 rounded-lg border-2 transition-all relative group ${isResolved === variant ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200' : 'border-slate-100 hover:border-blue-300 hover:bg-blue-50'}`}>
                                            <div className="space-y-1">
                                                <div className="text-sm font-semibold text-slate-800">{variant.ship_name || '(No Name)'}</div>
                                                <div className="text-xs text-slate-500">Call Sign: {variant.call_sign}</div>
                                                <div className="text-xs text-slate-500">Owner: {variant.owner_name}</div>
                                            </div>
                                            {isResolved === variant && <div className="absolute top-2 right-2 bg-emerald-500 text-white rounded-full p-1"><Check size={12} /></div>}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div className="p-4 border-t bg-white rounded-b-xl flex justify-between items-center">
                    <button onClick={() => setConflicts([])} className="px-4 py-2 text-slate-500 hover:text-slate-700">Cancel Import</button>
                    <button onClick={finalize} disabled={!isComplete} className={`px-6 py-3 rounded-lg font-bold text-white transition-all flex items-center ${isComplete ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-300 cursor-not-allowed'}`}>{isComplete ? <><Save className="mr-2" size={18}/> Finalize Import</> : `Resolve ${totalCount - resolvedCount} Remaining`}</button>
                </div>
            </div>
        </div>
    );
};

const DetailModal = ({ selectedShip, setSelectedShip, updateShip, revokeShip, uploadFile, supabaseUrl, onViewHistory }) => {
    if (!selectedShip) return null;
    
    const [isEditing, setIsEditing] = useState(false);
    const [editForm, setEditForm] = useState({...selectedShip});
    const [viewCert, setViewCert] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [aiMismatch, setAiMismatch] = useState(null); 

    useEffect(() => {
        setEditForm({...selectedShip});
        setIsEditing(false);
        setViewCert(false);
        setAiMismatch(null);
    }, [selectedShip]);

    const handleSave = async () => {
        await updateShip(editForm);
        setIsEditing(false);
        setAiMismatch(null);
    };

    const handleCertUpdate = async (e) => {
        const file = e.target.files[0];
        if(!file) return;
        
        setIsUploading(true);
        setAiMismatch(null);
        try {
            const base64 = await convertPdfToImage(file);
            const analysis = await analyzeCertificateWithAI(base64);
            
            const discrepancies = [];
            if (analysis.vesselName && analysis.vesselName.toUpperCase() !== editForm.ship_name?.toUpperCase()) discrepancies.push({ field: 'Vessel Name', current: editForm.ship_name, new: analysis.vesselName });
            if (analysis.regNo && analysis.regNo !== editForm.reg_no) discrepancies.push({ field: 'Reg No', current: editForm.reg_no, new: analysis.regNo });
            
            const filePath = await uploadFile(file, selectedShip.mmsi);
            
            setEditForm(prev => ({
                ...prev,
                ship_name: analysis.vesselName || prev.ship_name,
                reg_no: analysis.regNo || prev.reg_no,
                owner_name: analysis.ownerName || prev.owner_name,
                call_sign: analysis.callSign || prev.call_sign,
                ship_type: analysis.shipType || prev.ship_type,
                registration_date: analysis.registrationDate || prev.registration_date,
                expiry_date: analysis.validUntil || prev.expiry_date,
                certificate_path: filePath 
            }));

            if (discrepancies.length > 0) {
                setAiMismatch(discrepancies);
            }
            
        } catch (err) {
            alert("Process failed: " + err.message);
        } finally {
            setIsUploading(false);
        }
    };

    const handleDeleteCert = () => {
        if(confirm("Are you sure you want to remove the certificate from this record?")) {
            setEditForm(prev => ({ ...prev, certificate_path: null }));
            updateShip({ ...editForm, certificate_path: null });
        }
    };

    const handleRevoke = () => {
        const reason = prompt("Please enter reason for revocation (e.g., Sold, Expired, Scrapped):");
        if (reason) revokeShip(selectedShip, reason);
    };

    const status = getShipStatus(selectedShip.expiry_date, selectedShip.registration_date, selectedShip.certificate_path);
    let statusBadge;
    if(status === 'active') statusBadge = <span className="px-2 py-1 bg-emerald-100 text-emerald-800 rounded text-xs font-bold">ACTIVE</span>;
    else if(status === 'expiring') statusBadge = <span className="px-2 py-1 bg-amber-100 text-amber-800 rounded text-xs font-bold">EXPIRING SOON</span>;
    else if(status === 'expired') statusBadge = <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs font-bold">EXPIRED</span>;
    else statusBadge = <span className="px-2 py-1 bg-slate-100 text-slate-500 rounded text-xs font-bold">NEEDS REVIEW</span>;

    const certUrl = selectedShip.certificate_path && supabaseUrl
        ? `${supabaseUrl}/storage/v1/object/public/certificates/${selectedShip.certificate_path}`
        : null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
                <div className="bg-blue-900 px-6 py-4 flex justify-between items-center shrink-0">
                    <h2 className="text-white font-bold text-lg flex items-center"><Ship className="mr-2"/> Ship Details</h2>
                    <button onClick={() => setSelectedShip(null)} className="text-blue-200 hover:text-white"><X size={24}/></button>
                </div>
                
                <div className="p-8 space-y-6">
                    {isEditing ? (
                        <div className="space-y-4">
                            <div className="p-4 border-2 border-dashed border-blue-200 bg-blue-50 rounded-lg text-center mb-4">
                                {isUploading ? (
                                    <div className="flex items-center justify-center text-blue-600"><Loader2 className="animate-spin mr-2"/> Uploading & Analyzing...</div>
                                ) : (
                                    <label className="cursor-pointer block">
                                        <div className="flex items-center justify-center text-blue-600 font-bold mb-1"><Upload className="mr-2" size={18}/> Upload / Replace Certificate</div>
                                        <div className="text-xs text-slate-500">AI will verify details against current record</div>
                                        <input type="file" className="hidden" accept=".pdf" onChange={handleCertUpdate} />
                                    </label>
                                )}
                            </div>

                            {aiMismatch && (
                                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                                    <h4 className="text-amber-800 font-bold flex items-center mb-2"><AlertOctagon size={16} className="mr-2"/> Data Mismatch Detected</h4>
                                    <div className="text-xs text-amber-700 space-y-1">
                                        <p>The uploaded certificate data differs from the database:</p>
                                        <ul className="list-disc pl-4">
                                            {aiMismatch.map((m, i) => (
                                                <li key={i}>
                                                    <strong>{m.field}:</strong> DB says <em>"{m.current}"</em>, Cert says <em>"{m.new}"</em>
                                                </li>
                                            ))}
                                        </ul>
                                        <p className="mt-2 font-semibold">Clicking "Save Changes" will overwrite the database with the Certificate data.</p>
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                <div><label className="block text-xs font-bold text-slate-500 mb-1">Vessel Name</label><input type="text" className="w-full p-2 border rounded" value={editForm.ship_name || ''} onChange={(e) => setEditForm({...editForm, ship_name: e.target.value})} /></div>
                                <div><label className="block text-xs font-bold text-slate-500 mb-1">MMSI</label><input type="text" disabled className="w-full p-2 border rounded bg-slate-100 text-slate-500 font-mono" value={formatMmsi(editForm.mmsi)} /></div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><label className="block text-xs font-bold text-slate-500 mb-1">Registration Date</label><input type="date" className="w-full p-2 border rounded" value={editForm.registration_date || ''} onChange={(e) => setEditForm({...editForm, registration_date: e.target.value})} /></div>
                                <div><label className="block text-xs font-bold text-slate-500 mb-1">Expiry Date</label><input type="date" className="w-full p-2 border rounded" value={editForm.expiry_date || ''} onChange={(e) => setEditForm({...editForm, expiry_date: e.target.value})} /></div>
                            </div>
                            <div className="flex justify-end space-x-3 pt-4 border-t mt-4">
                                <button onClick={() => setIsEditing(false)} className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded">Cancel</button>
                                <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center"><Save size={16} className="mr-2"/> Save Changes</button>
                            </div>
                        </div>
                    ) : (
                        <>
                          <div className="grid grid-cols-2 gap-8">
                              <div><p className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">Vessel Name</p><p className="text-xl font-bold text-slate-800">{selectedShip.ship_name || 'N/A'}</p></div>
                              <div><p className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">Assigned MMSI</p><p className="text-2xl font-mono font-bold text-blue-600">{formatMmsi(selectedShip.mmsi)}</p></div>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-6 border-t border-b border-slate-100 py-6">
                              <div><p className="text-xs text-slate-500">Registration No</p><p className="font-medium text-slate-700">{selectedShip.reg_no || '-'}</p></div>
                              <div><p className="text-xs text-slate-500">Owner Name</p><p className="font-medium text-slate-700">{selectedShip.owner_name || '-'}</p></div>
                              <div><p className="text-xs text-slate-500">Registration Date</p><p className="font-medium text-slate-700">{selectedShip.registration_date || 'Not Set'}</p></div>
                              <div><p className="text-xs text-slate-500">Expiry Date</p><p className={`font-medium ${status === 'expired' ? 'text-red-600 font-bold' : 'text-slate-700'}`}>{selectedShip.expiry_date || 'Not Set'}</p></div>
                          </div>

                          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-sm flex justify-between items-center">
                              <div className="flex items-center">
                                  <span className="mr-4">Certificate:</span>
                                  {certUrl ? (
                                      <span className="text-emerald-600 font-bold flex items-center"><CheckCircle size={14} className="mr-1"/> On File</span>
                                  ) : (
                                      <span className="text-slate-400 italic">None Uploaded</span>
                                  )}
                              </div>
                              <div className="flex space-x-2">
                                  {certUrl && (
                                      <>
                                        <button onClick={() => setViewCert(!viewCert)} className="text-blue-600 hover:bg-blue-100 px-3 py-1 rounded transition-colors flex items-center text-xs font-bold">
                                            <Eye size={14} className="mr-1"/> {viewCert ? 'Hide' : 'View'}
                                        </button>
                                        <button onClick={handleDeleteCert} className="text-red-600 hover:bg-red-100 px-3 py-1 rounded transition-colors flex items-center text-xs font-bold">
                                            <Trash2 size={14} className="mr-1"/> Delete File
                                        </button>
                                      </>
                                  )}
                              </div>
                          </div>

                          <div className="flex justify-between items-center mt-4">
                              <span className="text-sm text-slate-500 font-bold">Assignment Status: {statusBadge}</span>
                              <button onClick={() => onViewHistory(selectedShip.mmsi)} className="text-blue-600 hover:underline text-sm font-semibold flex items-center bg-blue-50 px-3 py-1 rounded">
                                  <History size={16} className="mr-1"/> View Full History
                              </button>
                          </div>

                          {viewCert && certUrl && (
                              <div className="border rounded-lg p-2 bg-slate-100 overflow-hidden">
                                  <iframe src={certUrl} className="w-full h-96 rounded" title="Certificate Preview"></iframe>
                              </div>
                          )}

                          <div className="flex justify-end space-x-3 pt-2">
                              <button onClick={() => setIsEditing(true)} className="px-4 py-2 border border-blue-200 text-blue-600 rounded hover:bg-blue-50 flex items-center"><Edit2 size={16} className="mr-2"/> Edit / Upload Cert</button>
                              <button onClick={handleRevoke} className="px-4 py-2 border border-red-200 text-red-600 rounded hover:bg-red-50 flex items-center"><Ban size={16} className="mr-2"/> Revoke Assignment</button>
                              <button onClick={() => setSelectedShip(null)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded hover:bg-slate-200">Close</button>
                          </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

const HistoryView = ({ historyData, supabaseUrl, searchMmsi, setSearchMmsi }) => {
    const filteredHistory = searchMmsi 
        ? historyData.filter(h => h.mmsi.includes(searchMmsi))
        : historyData;

    return (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
            <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-bold text-slate-800 flex items-center"><History className="mr-2"/> Assignment History Log</h3>
                <div className="relative w-64">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={16} />
                    <input 
                        type="text" 
                        placeholder="Search History by MMSI..." 
                        className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={searchMmsi}
                        onChange={(e) => setSearchMmsi(e.target.value)}
                    />
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-500 uppercase">
                        <tr>
                            <th className="px-6 py-4">MMSI</th>
                            <th className="px-6 py-4">Ship Name</th>
                            <th className="px-6 py-4">Assigned Date</th>
                            <th className="px-6 py-4">Revoked Date</th>
                            <th className="px-6 py-4">Reason</th>
                            <th className="px-6 py-4">Cert</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {filteredHistory.map(h => (
                            <tr key={h.id} className="hover:bg-slate-50">
                                <td className="px-6 py-4 font-mono text-blue-600 font-medium">{formatMmsi(h.mmsi)}</td>
                                <td className="px-6 py-4 font-medium text-slate-800">{h.ship_name}</td>
                                <td className="px-6 py-4 text-slate-600">
                                    {h.assigned_at ? new Date(h.assigned_at).toLocaleDateString() : 'Unknown'}
                                </td>
                                <td className="px-6 py-4 text-red-600 font-medium">
                                    {h.revoked_at ? new Date(h.revoked_at).toLocaleDateString() : 'Active'}
                                </td>
                                <td className="px-6 py-4 text-slate-500 italic">{h.revocation_reason}</td>
                                <td className="px-6 py-4">
                                    {h.certificate_path && supabaseUrl ? (
                                        <a href={`${supabaseUrl}/storage/v1/object/public/certificates/${h.certificate_path}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline flex items-center"><FileText size={14} className="mr-1"/> View</a>
                                    ) : <span className="text-slate-300">-</span>}
                                </td>
                            </tr>
                        ))}
                        {filteredHistory.length === 0 && <tr><td colSpan="6" className="p-8 text-center text-slate-400">No history records found matching "{searchMmsi}".</td></tr>}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const SettingsView = ({ handleImport }) => (
  <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-8 max-w-2xl mx-auto mt-8">
      <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center"><Settings className="mr-2" /> System Administration</h3>
      <div className="mb-8 p-6 bg-slate-50 rounded-lg border border-slate-200">
          <h4 className="font-semibold text-slate-700 mb-2">Data Import (Book2.csv)</h4>
          <label className="flex items-center justify-center w-full h-32 px-4 transition bg-white border-2 border-gray-300 border-dashed rounded-md appearance-none cursor-pointer hover:border-blue-400">
              <span className="flex flex-col items-center space-y-2"><Upload className="text-gray-400" size={24}/><span className="font-medium text-gray-600">Drop Book2.csv here</span></span>
              <input type="file" className="hidden" accept=".csv" onChange={handleImport} />
          </label>
      </div>
  </div>
);

const ExclusionsView = ({ exclusions, addExclusion, removeExclusion, showNotification }) => {
    const [form, setForm] = useState({ start: '', end: '', reason: '' });
    const handleSubmit = (e) => {
        e.preventDefault();
        if(!form.start || !form.end) return;
        const s = parseInt(form.start.replace(/\s/g, ''));
        const eM = parseInt(form.end.replace(/\s/g, ''));
        if(s > eM) return showNotification("Start must be less than End", "error");
        addExclusion({ start_mmsi: s, end_mmsi: eM, reason: form.reason });
        setForm({ start: '', end: '', reason: '' });
    };
    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="bg-red-900 px-6 py-4"><h2 className="text-white font-bold text-lg flex items-center"><Ban className="mr-2"/> Exclude MMSI Ranges</h2></div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div><label className="text-xs font-bold text-slate-500">Start MMSI</label><input value={form.start} onChange={e=>setForm({...form, start: e.target.value})} placeholder="408..." className="w-full p-2 border rounded" required/></div>
                        <div><label className="text-xs font-bold text-slate-500">End MMSI</label><input value={form.end} onChange={e=>setForm({...form, end: e.target.value})} placeholder="408..." className="w-full p-2 border rounded" required/></div>
                        <div><label className="text-xs font-bold text-slate-500">Reason</label><input value={form.reason} onChange={e=>setForm({...form, reason: e.target.value})} placeholder="e.g. Reserved" className="w-full p-2 border rounded" required/></div>
                    </div>
                    <button type="submit" className="w-full bg-red-600 text-white py-2 rounded font-medium hover:bg-red-700">Add Exclusion Range</button>
                </form>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
                <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center"><ListX className="mr-2"/> Active Exclusions</h3>
                <table className="w-full text-left">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Start</th><th className="p-3">End</th><th className="p-3">Reason</th><th className="p-3 text-right">Actions</th></tr></thead>
                    <tbody className="divide-y">
                        {exclusions.map(ex => (<tr key={ex.id}><td className="p-3 font-mono text-red-600">{formatMmsi(ex.start_mmsi)}</td><td className="p-3 font-mono text-red-600">{formatMmsi(ex.end_mmsi)}</td><td className="p-3 text-sm text-slate-600">{ex.reason}</td><td className="p-3 text-right"><button onClick={() => removeExclusion(ex.id)} className="text-slate-400 hover:text-red-600"><Trash2 size={16}/></button></td></tr>))}
                        {exclusions.length === 0 && <tr><td colSpan="4" className="p-4 text-center text-slate-400 text-sm">No exclusions active.</td></tr>}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const AssignMmsiView = ({ MMSI_START, MMSI_END, assignMmsi, showNotification, findNextAvailableMmsi, uploadFile }) => {
  const [formData, setFormData] = useState({ 
      name: '', owner: '', callSign: '', regNo: '', type: 'Gen', mmsi: '', 
      regDate: '', expDate: '', certPath: null 
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const handleAutoSuggest = () => {
      const next = findNextAvailableMmsi();
      if(next) setFormData(prev => ({ ...prev, mmsi: formatMmsi(next) }));
      else showNotification("No available MMSI found in range!", "error");
  };

  const handleCertificateUpload = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      setIsAnalyzing(true);
      try {
          const imageBase64 = await convertPdfToImage(file);
          const result = await analyzeCertificateWithAI(imageBase64);
          const tempId = `temp-${Date.now()}`;
          const uploadedPath = await uploadFile(file, tempId);
          setFormData(prev => ({
              ...prev,
              name: result.vesselName || prev.name,
              regNo: result.regNo || prev.regNo,
              owner: result.ownerName || prev.owner,
              callSign: result.callSign || prev.callSign,
              type: result.shipType || prev.type,
              regDate: result.registrationDate || prev.regDate,
              expDate: result.validUntil || prev.expDate,
              certPath: uploadedPath 
          }));
          if (result.isExpired) showNotification(`Warning: Certificate Expired`, 'error');
          else showNotification(`Certificate Analyzed & Uploaded`, 'success');
      } catch (err) {
          console.error(err);
          showNotification("Failed to analyze/upload certificate: " + err.message, "error");
      } finally {
          setIsAnalyzing(false);
      }
  };

  return (
    <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="bg-blue-900 px-6 py-4 flex items-center justify-between"><h2 className="text-white font-bold text-lg flex items-center"><Plus className="mr-2" /> Assign New MMSI</h2></div>
      <div className="px-8 pt-6">
          <label className={`flex items-center justify-center w-full p-4 border-2 border-dashed rounded-lg transition-colors cursor-pointer ${isAnalyzing ? 'bg-blue-50 border-blue-300' : 'bg-slate-50 border-slate-300 hover:border-blue-400'}`}>
              {isAnalyzing ? (<div className="flex items-center text-blue-600"><Loader2 className="animate-spin mr-2"/> Analyzing & Uploading...</div>) : (<div className="flex flex-col items-center text-slate-500"><div className="flex items-center"><FileSearch className="mr-2"/> <span className="font-medium">Auto-Fill from Certificate</span></div><span className="text-xs mt-1">Upload PDF to auto-extract & store</span></div>)}
              <input type="file" className="hidden" accept=".pdf" onChange={handleCertificateUpload} disabled={isAnalyzing} />
          </label>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); assignMmsi(formData); }} className="p-8 space-y-6">
        <div className="grid grid-cols-2 gap-6">
          <div><label className="text-sm font-semibold">Vessel Name</label><input value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} required className="w-full p-3 border rounded-lg" /></div>
          <div><label className="text-sm font-semibold">Call Sign</label><input value={formData.callSign} onChange={e=>setFormData({...formData, callSign: e.target.value})} className="w-full p-3 border rounded-lg" /></div>
        </div>
        <div className="grid grid-cols-2 gap-6">
          <div><label className="text-sm font-semibold">Owner</label><input value={formData.owner} onChange={e=>setFormData({...formData, owner: e.target.value})} required className="w-full p-3 border rounded-lg" /></div>
          <div><label className="text-sm font-semibold">Reg No</label><input value={formData.regNo} onChange={e=>setFormData({...formData, regNo: e.target.value})} className="w-full p-3 border rounded-lg" /></div>
        </div>
        <div className="grid grid-cols-2 gap-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
           <div><label className="text-xs font-bold text-slate-500 mb-1 block">Registration Date</label><input type="date" value={formData.regDate} onChange={e=>setFormData({...formData, regDate: e.target.value})} className="w-full p-2 border rounded bg-white"/></div>
           <div><label className="text-xs font-bold text-slate-500 mb-1 block">Expiry Date</label><input type="date" value={formData.expDate} onChange={e=>setFormData({...formData, expDate: e.target.value})} className="w-full p-2 border rounded bg-white"/></div>
           <div className="col-span-2 text-xs text-slate-400 flex items-center"><Info size={12} className="mr-1"/> Empty dates will be flagged for review later.</div>
        </div>
        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
          <label className="text-sm font-bold text-slate-700 flex justify-between items-center mb-2"><span>Assign MMSI Number</span><span className="text-xs font-normal text-slate-500">Range: {formatMmsi(MMSI_START)} - {formatMmsi(MMSI_END)}</span></label>
          <div className="flex gap-2">
              <input type="text" required className="flex-1 p-3 border rounded-lg font-mono text-blue-700 font-bold" value={formData.mmsi} onChange={e => setFormData({...formData, mmsi: e.target.value})} placeholder="408 XXX XXX"/>
              <button type="button" onClick={handleAutoSuggest} className="px-4 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium text-sm flex items-center"><RefreshCw size={16} className="mr-2"/> Find Next Free</button>
          </div>
        </div>
        <div className="pt-4 flex justify-end"><button type="submit" className="px-6 py-3 rounded-lg bg-blue-600 text-white font-medium">Confirm Assignment</button></div>
      </form>
    </div>
  );
};

const ShipListView = ({ activeShips, searchTerm, setSearchTerm, statusFilter, setStatusFilter, setSelectedShip }) => {
  const filtered = activeShips.filter(s => {
      const matchesSearch = s.ship_name?.toLowerCase().includes(searchTerm.toLowerCase()) || s.mmsi?.includes(searchTerm);
      const status = getShipStatus(s.expiry_date, s.registration_date, s.certificate_path);
      if (!matchesSearch) return false;
      if (statusFilter === 'all') return true;
      return status === statusFilter;
  });

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 flex flex-col h-full">
      <div className="p-6 border-b border-slate-100">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-4">
              <h2 className="text-xl font-bold text-slate-800">Assigned MMSI & Registry</h2>
              <div className="relative w-full sm:w-72">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={18} />
                  <input type="text" placeholder="Search Name, MMSI..." className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}/>
              </div>
          </div>
          <div className="flex space-x-2 overflow-x-auto pb-2">
              {['all', 'active', 'expiring', 'expired', 'missing'].map(f => (
                  <button key={f} onClick={() => setStatusFilter(f)} className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase whitespace-nowrap transition-colors ${statusFilter === f ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>{f === 'missing' ? 'Needs Review' : f}</button>
              ))}
          </div>
      </div>
      <div className="overflow-x-auto flex-1">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500 uppercase"><tr><th className="px-6 py-4">MMSI</th><th className="px-6 py-4">Name</th><th className="px-6 py-4">Reg No</th><th className="px-6 py-4">Expiry</th><th className="px-6 py-4">Status</th></tr></thead>
          <tbody className="divide-y divide-slate-100 cursor-pointer">
            {filtered.map(ship => {
                const status = getShipStatus(ship.expiry_date, ship.registration_date, ship.certificate_path);
                let rowClass = "hover:bg-blue-50 transition-colors";
                let statusLabel = <span className="text-emerald-600 font-bold">Active</span>;
                if (status === 'missing') { rowClass = "bg-amber-50 hover:bg-amber-100"; statusLabel = <span className="text-amber-600 font-bold flex items-center"><AlertTriangle size={12} className="mr-1"/> Needs Review</span>; } 
                else if (status === 'expired') { statusLabel = <span className="text-red-600 font-bold">Expired</span>; } 
                else if (status === 'expiring') { statusLabel = <span className="text-orange-500 font-bold">Expiring</span>; }
                return (
                  <tr key={ship.mmsi} onClick={() => setSelectedShip(ship)} className={rowClass}>
                      <td className="px-6 py-4 font-mono text-blue-600 font-medium">{formatMmsi(ship.mmsi)}</td>
                      <td className="px-6 py-4 font-medium text-slate-800">{ship.ship_name}</td>
                      <td className="px-6 py-4 text-slate-600 font-mono text-xs">{ship.reg_no || '-'}</td>
                      <td className="px-6 py-4 text-slate-600">{ship.expiry_date || '-'}</td>
                      <td className="px-6 py-4">{statusLabel}</td>
                  </tr>
                );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// --- Main Component ---

export default function MMSIPlatform() {
  // --- System State ---
  const [supabase, setSupabase] = useState(null);
  const [session, setSession] = useState(null);
  const [currentUserRole, setCurrentUserRole] = useState(null); // 'admin', 'user', 'requester'
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState(null);
  
  // --- Data State ---
  const [activeShips, setActiveShips] = useState([]);
  const [mmsiPool, setMmsiPool] = useState([]);
  const [historyData, setHistoryData] = useState([]);
  const [exclusions, setExclusions] = useState([]);
  const [requests, setRequests] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  
  // --- UI State ---
  const [view, setView] = useState('login'); 
  const [isSidebarOpen, setSidebarOpen] = useState(true); // Desktop toggle
  const [isMobileMenuOpen, setMobileMenuOpen] = useState(false); // Mobile toggle
  const [searchTerm, setSearchTerm] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedShip, setSelectedShip] = useState(null);
  const [importConflicts, setImportConflicts] = useState([]); 
  const [cleanImportData, setCleanImportData] = useState([]); 
  const [resolvedConflicts, setResolvedConflicts] = useState([]);
  const [supabaseUrl, setSupabaseUrl] = useState('');
  
  // --- Constants ---
  const MMSI_START = 408000001;
  const MMSI_END = 408999998;

  // 1. Initialize Supabase
  useEffect(() => {
    const initSupabase = () => {
       let envUrl, envKey;
       try {
           // Safe access to env vars
           if (typeof import.meta !== 'undefined' && import.meta.env) {
               envUrl = import.meta.env.VITE_SUPABASE_URL;
               envKey = import.meta.env.VITE_SUPABASE_KEY;
           }
       } catch (e) {
           console.warn("Environment variables not accessible.");
       }
       
       // Fallback if empty (prevents crash, shows config error screen)
       if (envUrl) setSupabaseUrl(envUrl);

       if (!window.supabase && envUrl && envKey) {
          const script = document.createElement('script');
          script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
          script.async = true;
          script.onload = () => {
              const client = window.supabase.createClient(envUrl, envKey);
              setSupabase(client);
          };
          document.body.appendChild(script);
       } else if (window.supabase && envUrl && envKey) {
          const client = window.supabase.createClient(envUrl, envKey);
          setSupabase(client);
       }
    };
    initSupabase();
  }, []);

  // 2. Auth Listener
  useEffect(() => {
      if (!supabase) return;
      
      // Check active session
      supabase.auth.getSession().then(({ data: { session } }) => {
          setSession(session);
          if (session) fetchUserProfile(session.user.id);
          else setView('login');
      });

      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
          setSession(session);
          if (session) fetchUserProfile(session.user.id);
          else setView('login');
      });

      return () => subscription.unsubscribe();
  }, [supabase]);

  // 3. Fetch User Role & Data
  const fetchUserProfile = async (userId) => {
      if(!supabase) return;
      const { data, error } = await supabase.from('user_roles').select('role').eq('user_id', userId).single();
      
      if (data) {
          setCurrentUserRole(data.role);
          setView('dashboard');
          fetchAllData();
          logActivity('login', `User logged in as ${data.role}`);
      } else {
          // Auto-create requester role for new users
          await supabase.from('user_roles').insert([{ user_id: userId, role: 'requester', email: session?.user?.email }]);
          setCurrentUserRole('requester');
          setView('dashboard');
          fetchAllData();
      }
  };

  const fetchAllData = async () => {
      if(!supabase) return;
      setLoading(true);
      
      // Parallel fetching for speed
      const [ships, pool, hist, excl, reqs, users, logs] = await Promise.all([
          supabase.from('active_ships').select('*').order('created_at', { ascending: false }),
          supabase.from('mmsi_pool').select('*').order('mmsi', { ascending: true }).limit(1000),
          supabase.from('assignment_history').select('*').order('revoked_at', { ascending: false }),
          supabase.from('mmsi_exclusions').select('*'),
          supabase.from('mmsi_requests').select('*').order('created_at', { ascending: false }),
          supabase.from('user_roles').select('*'),
          supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100)
      ]);

      if(ships.data) setActiveShips(ships.data);
      if(pool.data) setMmsiPool(pool.data);
      if(hist.data) setHistoryData(hist.data);
      if(excl.data) setExclusions(excl.data);
      if(reqs.data) setRequests(reqs.data);
      if(users.data) setUsersList(users.data);
      if(logs.data) setAuditLogs(logs.data);
      
      setLoading(false);
  };

  // --- LOGGING SYSTEM ---
  const logActivity = async (action, details) => {
      if(!supabase || !session) return;
      await supabase.from('audit_logs').insert([{
          user_id: session.user.id,
          user_email: session.user.email,
          action: action,
          details: details
      }]);
  };

  const updateUserRole = async (userId, newRole) => {
      await supabase.from('user_roles').update({ role: newRole }).eq('user_id', userId);
      logActivity('role_change', `Changed user ${userId} to ${newRole}`);
      fetchAllData();
  };

  const createAdminUser = async (email, password, role) => {
      if(!supabase) return;
      setLoading(true);
      const { data, error } = await supabase.rpc('create_user_by_admin', { 
          new_email: email, 
          new_password: password, 
          new_role: role 
      });
      
      if (error) {
          showNotification("Failed to create user: " + error.message, "error");
      } else {
          showNotification("User created successfully.");
          logActivity('user_created', `Created user ${email} as ${role}`);
          fetchAllData();
      }
      setLoading(false);
  };
  
  const changeUserPassword = async (userId, newPassword) => {
      if(!supabase) return;
      setLoading(true);
      const { error } = await supabase.rpc('update_user_password_by_admin', { 
          target_user_id: userId, 
          new_password: newPassword 
      });
      
      if (error) {
          showNotification("Failed to update password: " + error.message, "error");
      } else {
          showNotification("Password updated successfully.");
          logActivity('password_change', `Changed password for user ${userId}`);
      }
      setLoading(false);
  };

  // --- CALCULATED STATS ---
  const stats = useMemo(() => {
     // ... (Previous calculation logic preserved, simplified for brevity)
     // Calculate available logic same as before...
     const uniqueAssigned = new Set(activeShips.map(s => parseInt(s.mmsi, 10)));
     const available = (MMSI_END - MMSI_START) - uniqueAssigned.size; // Simplified approximation
     
     return {
         active: activeShips.length,
         available: available,
         pending: requests.filter(r => r.status === 'pending').length,
         history: historyData.length
     };
  }, [activeShips, requests, historyData]);

  const findNextAvailableMmsi = () => {
      const assignedSet = new Set(activeShips.map(s => parseInt(s.mmsi, 10)));
      
      // Helper to check if a number is excluded
      const isExcluded = (mmsi) => {
          return exclusions.some(ex => {
             const start = parseInt(ex.start_mmsi, 10);
             const end = parseInt(ex.end_mmsi, 10);
             return mmsi >= start && mmsi <= end;
          });
      };

      for (let i = MMSI_START; i <= MMSI_END; i++) {
          if (!assignedSet.has(i) && !isExcluded(i)) {
              return i.toString();
          }
      }
      return null;
  };

  const uploadFile = async (file, mmsi) => {
      if (!supabase) throw new Error("Database not connected");
      const fileExt = file.name.split('.').pop();
      const fileName = `${mmsi || 'temp'}-${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;
      const { error } = await supabase.storage.from('certificates').upload(filePath, file);
      if (error) throw error;
      return filePath;
  };

  // --- ACTIONS ---

  const handleLogin = async (email, password) => {
      setLoading(true);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
          showNotification("Login failed: " + error.message, "error");
          setLoading(false); // Ensure loading stops on error
      }
      // Success is handled by auth listener
  };

  const handleLogout = async () => {
      await logActivity('logout', 'User logged out');
      await supabase.auth.signOut();
      setView('login');
  };

  const showNotification = (msg, type='success') => {
      setNotification({ msg, type });
      setTimeout(() => setNotification(null), 4000);
  };

  // --- Request Logic ---
  const submitRequest = async (formData) => {
      setLoading(true);
      const { error } = await supabase.from('mmsi_requests').insert([{
          requester_id: session.user.id,
          requester_email: session.user.email,
          ...formData,
          status: 'pending'
      }]);
      if(error) showNotification("Request failed", "error");
      else {
          showNotification("Request submitted successfully");
          logActivity('request_submitted', `Request for ${formData.ship_name}`);
          fetchAllData();
          setView('my-requests');
      }
      setLoading(false);
  };

  const processRequest = async (request, action, reason = '') => {
      setLoading(true);
      
      if (action === 'approve') {
          // 1. Assign MMSI (Find free one)
          // ... (Logic to find next free MMSI) ...
          // Simplified for this snippet:
          const mmsiToAssign = findNextAvailableMmsi(); 

          // 2. Insert into Active
          await supabase.from('active_ships').insert([{
              mmsi: mmsiToAssign,
              ship_name: request.ship_name,
              owner_name: request.owner_name,
              call_sign: request.call_sign,
              reg_no: request.reg_no,
              ship_type: request.ship_type,
              registration_date: request.registration_date,
              expiry_date: request.expiry_date,
              certificate_path: request.certificate_path
          }]);
          
          // 3. Update Request Status
          await supabase.from('mmsi_requests').update({ status: 'approved' }).eq('id', request.id);
          
          logActivity('request_approved', `Approved ship ${request.ship_name}, Assigned ${mmsiToAssign}`);
      } else {
          await supabase.from('mmsi_requests').update({ status: 'rejected', rejection_reason: reason }).eq('id', request.id);
          logActivity('request_rejected', `Rejected ship ${request.ship_name}. Reason: ${reason}`);
      }
      
      fetchAllData();
      setLoading(false);
  };

  // Ship Actions
  const updateShip = async (updatedData) => {
    if (!supabase) return;
    setLoading(true);
    const { error } = await supabase.from('active_ships').update({
            ship_name: updatedData.ship_name,
            owner_name: updatedData.owner_name,
            call_sign: updatedData.call_sign,
            reg_no: updatedData.reg_no,
            ship_type: updatedData.ship_type,
            registration_date: updatedData.registration_date,
            expiry_date: updatedData.expiry_date,
            certificate_path: updatedData.certificate_path
        }).eq('mmsi', updatedData.mmsi);
    if (error) {
        showNotification("Update Failed: " + error.message, "error");
    } else {
        await supabase.from('mmsi_pool').update({ assigned_name: updatedData.ship_name }).eq('mmsi', updatedData.mmsi);
        showNotification("Ship details updated successfully.");
        fetchData(supabase);
        setSelectedShip(updatedData); 
    }
    setLoading(false);
  };

  const revokeShip = async (ship, reason) => {
    if (!supabase) return;
    setLoading(true);
    
    // 1. Move to History (Revoke)
    await supabase.from('assignment_history').insert([{ 
        mmsi: ship.mmsi, 
        ship_name: ship.ship_name,
        owner_name: ship.owner_name,
        call_sign: ship.call_sign,
        reg_no: ship.reg_no,
        ship_type: ship.ship_type,
        registration_date: ship.registration_date,
        expiry_date: ship.expiry_date,
        certificate_path: ship.certificate_path,
        assigned_at: ship.created_at,
        revoked_at: new Date().toISOString(), // Add current timestamp for revoked_at
        revocation_reason: reason 
    }]);

    // 2. Remove from Active
    await supabase.from('active_ships').delete().eq('mmsi', ship.mmsi);
    // 3. Free up Pool
    await supabase.from('mmsi_pool').update({ status: 'Available', assigned_name: null }).eq('mmsi', ship.mmsi);

    showNotification('Assignment revoked and moved to history.');
    fetchData(supabase);
    if (selectedShip?.mmsi === ship.mmsi) setSelectedShip(null);
  };

  const assignMmsi = async (formData) => {
    if (!supabase) return;
    setLoading(true);
    const cleanMmsi = formData.mmsi.replace(/\s/g, '');
    const newShip = {
      mmsi: cleanMmsi,
      ship_name: formData.name,
      call_sign: formData.callSign,
      owner_name: formData.owner,
      registration_date: formData.regDate || null,
      expiry_date: formData.expDate || null,
      certificate_path: formData.certPath || null, 
      ship_type: formData.type,
      reg_no: formData.regNo
    };
    const { error: insertError } = await supabase.from('active_ships').insert([newShip]);
    if (insertError) {
      showNotification("Failed: " + insertError.message, "error");
      setLoading(false);
      return;
    }
    await supabase.from('mmsi_pool').update({ status: 'Assigned', assigned_name: formData.name }).eq('mmsi', cleanMmsi);
    showNotification(`Ship ${formData.name} assigned MMSI ${formatMmsi(cleanMmsi)} successfully.`);
    setView('search');
    fetchData(supabase);
    setLoading(false);
  };

  const handleViewHistory = (mmsi) => {
      setSelectedShip(null);
      setHistorySearch(mmsi);
      setView('history');
  };

  const resolveConflict = (mmsi, selectedVariant) => {
      setResolvedConflicts(prev => [...prev.filter(i => i.mmsi !== mmsi), selectedVariant]);
  };

  const finalizeImport = () => {
      const finalData = [...cleanImportData, ...resolvedConflicts];
      performUpload(finalData);
      setImportConflicts([]); 
  };

  const performUpload = async (data) => {
      setLoading(true);
      const { error: activeError } = await supabase.from('active_ships').upsert(data, { onConflict: 'mmsi' });
      if (activeError) {
        showNotification(`Import Failed: ${activeError.message}`, 'error');
      } else {
        const poolUpdates = data.map(s => ({ mmsi: s.mmsi, status: 'Assigned', assigned_name: s.ship_name }));
        await supabase.from('mmsi_pool').upsert(poolUpdates, { onConflict: 'mmsi' });
        showNotification(`Successfully imported ${data.length} ships.`, 'success');
        fetchData(supabase); 
      }
      setLoading(false);
  };
  
  const addExclusion = async (data) => {
      if(!supabase) return;
      setLoading(true);
      const { error } = await supabase.from('mmsi_exclusions').insert([data]);
      if(error) showNotification("Failed: " + error.message, "error");
      else { showNotification("Exclusion added."); fetchData(supabase); }
      setLoading(false);
  };

  const removeExclusion = async (id) => {
      if(!supabase) return;
      if(!confirm("Remove exclusion?")) return;
      setLoading(true);
      await supabase.from('mmsi_exclusions').delete().eq('id', id);
      fetchData(supabase);
      setLoading(false);
  };

  if (view === 'login') return <LoginView handleLogin={handleLogin} loading={loading} />;

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden">
      <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-blue-900 flex items-center justify-between px-4 z-50">
         <span className="text-white font-bold">Maritime Portal</span>
         <button onClick={() => setMobileMenuOpen(!isMobileMenuOpen)} className="text-white"><Menu/></button>
      </div>

      <div className={`
          fixed inset-y-0 left-0 z-40 w-72 bg-blue-900 transform transition-transform duration-300 ease-in-out
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
          md:relative md:translate-x-0 flex flex-col shadow-xl
      `}>
        <div className="h-20 flex items-center justify-center border-b border-blue-800 mt-16 md:mt-0">
          <Anchor className="text-blue-300 mr-2" size={28} />
          <h1 className="text-white font-bold text-lg">PORT AUTHORITY</h1>
        </div>
        
        <nav className="flex-1 py-8 space-y-2 overflow-y-auto">
          <SidebarItem id="dashboard" icon={LayoutDashboard} label="Dashboard" setView={setView} currentView={view} isMobile={true} closeMobileMenu={()=>setMobileMenuOpen(false)}/>
          
          {/* Requester & Up */}
          <SidebarItem id="search" icon={Search} label="Ship Registry" setView={setView} currentView={view} isMobile={true} closeMobileMenu={()=>setMobileMenuOpen(false)}/>
          
          {currentUserRole === 'requester' && (
             <SidebarItem id="my-requests" icon={FileCheck} label="My Requests" setView={setView} currentView={view} isMobile={true} closeMobileMenu={()=>setMobileMenuOpen(false)}/>
          )}

          {(currentUserRole === 'admin' || currentUserRole === 'user') && (
             <>
                <SidebarItem id="requests" icon={FileCheck} label="Manage Requests" setView={setView} currentView={view} isMobile={true} closeMobileMenu={()=>setMobileMenuOpen(false)}/>
                <SidebarItem id="assign" icon={Plus} label="Assign MMSI" setView={setView} currentView={view} isMobile={true} closeMobileMenu={()=>setMobileMenuOpen(false)}/>
                <SidebarItem id="history" icon={History} label="History" setView={setView} currentView={view} isMobile={true} closeMobileMenu={()=>setMobileMenuOpen(false)}/>
             </>
          )}

          {currentUserRole === 'admin' && (
             <>
                <SidebarItem id="exclusions" icon={Ban} label="Exclusions" setView={setView} currentView={view} isMobile={true} closeMobileMenu={()=>setMobileMenuOpen(false)}/>
                <SidebarItem id="users" icon={Users} label="User Management" setView={setView} currentView={view} isMobile={true} closeMobileMenu={()=>setMobileMenuOpen(false)}/>
                <SidebarItem id="audit" icon={Shield} label="Audit Logs" setView={setView} currentView={view} isMobile={true} closeMobileMenu={()=>setMobileMenuOpen(false)}/>
             </>
          )}
        </nav>

        <div className="p-4 bg-blue-950">
            <div className="flex items-center mb-3">
                <div className="w-8 h-8 bg-blue-700 rounded-full flex items-center justify-center text-white font-bold text-xs">
                    {session?.user?.email?.substring(0,2).toUpperCase()}
                </div>
                <div className="ml-3 overflow-hidden">
                    <p className="text-xs text-white font-bold truncate">{session?.user?.email}</p>
                    <p className="text-xs text-blue-300 capitalize">{currentUserRole}</p>
                </div>
            </div>
            <button onClick={handleLogout} className="w-full flex items-center justify-center py-2 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-bold transition-colors">
                <LogOut size={14} className="mr-2"/> Sign Out
            </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden pt-16 md:pt-0">
        <main className="flex-1 overflow-y-auto p-4 md:p-8 relative">
          {notification && (
            <div className={`fixed top-4 right-4 md:top-8 md:right-8 px-6 py-4 rounded-lg shadow-lg z-50 flex items-center text-white animate-bounce ${notification.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'}`}>
               {notification.msg}
            </div>
          )}

          <ConflictModal conflicts={importConflicts} resolved={resolvedConflicts} resolve={resolveConflict} finalize={finalizeImport} setConflicts={setImportConflicts} />
          <DetailModal selectedShip={selectedShip} setSelectedShip={setSelectedShip} updateShip={updateShip} revokeShip={revokeShip} uploadFile={uploadFile} supabaseUrl={supabaseUrl} onViewHistory={handleViewHistory} />

          {view === 'dashboard' && (
              <div className="space-y-6">
                  <h2 className="text-2xl font-bold text-slate-800">Dashboard</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <StatCard label="Active Ships" value={stats.active} icon={Ship} color="bg-blue-600" />
                    {(currentUserRole === 'admin' || currentUserRole === 'user') && (
                        <StatCard label="Available MMSI" value={stats.available} icon={Radio} color="bg-emerald-500"/>
                    )}
                    <StatCard label="Pending Requests" value={stats.pending} icon={Clock} color="bg-amber-500" />
                  </div>
              </div>
          )}

          {view === 'users' && <UserManagementView usersList={usersList} updateUserRole={updateUserRole} createUser={createAdminUser} changeUserPassword={changeUserPassword} />}
          {view === 'requests' && <RequestManagementView requests={requests} processRequest={processRequest} />}
          {view === 'audit' && <AuditLogView auditLogs={auditLogs} />}

          {view === 'settings' && <SettingsView handleImport={handleImport} />}
          
          {view === 'assign' && (
            <AssignMmsiView 
                MMSI_START={MMSI_START} 
                MMSI_END={MMSI_END} 
                assignMmsi={assignMmsi} 
                showNotification={showNotification} 
                findNextAvailableMmsi={findNextAvailableMmsi} 
                uploadFile={uploadFile} 
            />
          )}
          
          {view === 'exclusions' && (
            <ExclusionsView 
                exclusions={exclusions} 
                addExclusion={addExclusion} 
                removeExclusion={removeExclusion} 
                showNotification={showNotification} 
            />
          )}

          {view === 'search' && (
            <ShipListView 
                activeShips={activeShips} 
                searchTerm={searchTerm} 
                setSearchTerm={setSearchTerm} 
                statusFilter={statusFilter} 
                setStatusFilter={setStatusFilter} 
                setSelectedShip={setSelectedShip}
            />
          )}

          {view === 'history' && (
            <HistoryView 
                historyData={historyData} 
                supabaseUrl={supabaseUrl} 
                searchMmsi={historySearch} 
                setSearchMmsi={setHistorySearch} 
            />
          )}
          
        </main>
      </div>
    </div>
  );
}