import React, { useState, useEffect } from 'react';
import { 
  Ship, 
  Search, 
  Plus, 
  FileText, 
  Trash2, 
  LayoutDashboard, 
  Anchor, 
  Radio, 
  CheckCircle, 
  AlertTriangle,
  Menu,
  X,
  Save,
  RefreshCw,
  Terminal,
  Settings,
  Upload,
  Split,
  Check,
  Info,
  Hash,
  Edit2
} from 'lucide-react';

// --- Utility: CSV Parser ---
const parseCSV = (text, type) => {
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
};

export default function MMSIAssignmentSystem() {
  // --- App State ---
  const [supabase, setSupabase] = useState(null);
  const [activeShips, setActiveShips] = useState([]);
  const [mmsiPool, setMmsiPool] = useState([]);
  const [deletedShips, setDeletedShips] = useState([]);
  
  // --- Selection State ---
  const [selectedShip, setSelectedShip] = useState(null);

  // --- Import Conflict State ---
  const [importConflicts, setImportConflicts] = useState([]); 
  const [cleanImportData, setCleanImportData] = useState([]); 
  const [resolvedConflicts, setResolvedConflicts] = useState([]); 
  
  const [view, setView] = useState('dashboard'); 
  const [searchTerm, setSearchTerm] = useState('');
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [notification, setNotification] = useState(null);
  const [loading, setLoading] = useState(false);
  const [envError, setEnvError] = useState(false);

  // --- Constants ---
  const MMSI_START = 408000001;
  const MMSI_END = 408999998;

  // --- Initialization ---
  useEffect(() => {
    let envUrl, envKey;
    try {
        envUrl = import.meta.env.VITE_SUPABASE_URL;
        envKey = import.meta.env.VITE_SUPABASE_KEY;
    } catch (e) {
        console.warn("Environment variables not accessible.");
    }

    if (!envUrl || !envKey || envUrl.includes('your-project-url')) {
        setEnvError(true);
        return;
    }

    if (!window.supabase) {
        const script = document.createElement('script');
        script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
        script.async = true;
        script.onload = () => initializeSupabase(envUrl, envKey);
        document.body.appendChild(script);
    } else {
        initializeSupabase(envUrl, envKey);
    }
  }, []);

  const initializeSupabase = (url, key) => {
    if (!window.supabase || !window.supabase.createClient) {
        setTimeout(() => initializeSupabase(url, key), 500);
        return;
    }
    try {
      const client = window.supabase.createClient(url, key);
      setSupabase(client);
      setTimeout(() => fetchData(client), 500);
    } catch (e) {
      showNotification("Failed to initialize database client", "error");
    }
  };

  const fetchData = async (client) => {
    if (!client) return;
    setLoading(true);
    try {
      const { data: active } = await client.from('active_ships').select('*').order('created_at', { ascending: false });
      const { data: pool } = await client.from('mmsi_pool').select('*').order('mmsi', { ascending: true }).limit(1000); 
      const { data: deleted } = await client.from('deleted_ships').select('*').order('deleted_at', { ascending: false });

      if(active) setActiveShips(active);
      if(pool) setMmsiPool(pool);
      if(deleted) setDeletedShips(deleted);
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const showNotification = (msg, type = 'success') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // --- Logic: Find Next Available MMSI ---
  const findNextAvailableMmsi = () => {
    // Create a Set of all currently assigned MMSIs for fast lookup
    const assignedSet = new Set(activeShips.map(s => parseInt(s.mmsi, 10)));
    
    // Scan the range
    for (let i = MMSI_START; i <= MMSI_END; i++) {
        if (!assignedSet.has(i)) {
            return i.toString();
        }
    }
    return null;
  };

  const handleImport = (e) => {
    if (!supabase) return;
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target.result;
      const parsedData = parseCSV(text, 'active');
      
      if (parsedData.length === 0) {
        showNotification("No valid data found in file.", "error");
        setLoading(false);
        return;
      }

      const groups = {};
      parsedData.forEach(row => {
          if (!groups[row.mmsi]) groups[row.mmsi] = [];
          groups[row.mmsi].push(row);
      });

      const conflicts = [];
      const clean = [];

      Object.keys(groups).forEach(mmsi => {
          if (groups[mmsi].length > 1) {
              conflicts.push({ mmsi, variants: groups[mmsi] });
          } else {
              clean.push(groups[mmsi][0]);
          }
      });

      if (conflicts.length > 0) {
          setImportConflicts(conflicts);
          setCleanImportData(clean);
          setResolvedConflicts([]);
          setLoading(false);
          showNotification(`Found ${conflicts.length} conflicting MMSI numbers. Please resolve them.`, 'warning');
      } else {
          performUpload(parsedData);
      }
    };
    reader.readAsText(file);
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
        const poolUpdates = data.map(s => ({
            mmsi: s.mmsi,
            status: 'Assigned',
            assigned_name: s.ship_name
        }));
        await supabase.from('mmsi_pool').upsert(poolUpdates, { onConflict: 'mmsi' });

        showNotification(`Successfully imported ${data.length} ships.`, 'success');
        fetchData(supabase); 
      }
      setLoading(false);
  };

  const assignMmsi = async (formData) => {
    if (!supabase) return;
    setLoading(true);
    
    const newShip = {
      mmsi: formData.mmsi,
      ship_name: formData.name,
      call_sign: formData.callSign,
      owner_name: formData.owner,
      validity: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString(),
      ship_type: formData.type,
      reg_no: formData.regNo
    };

    const { error: insertError } = await supabase.from('active_ships').insert([newShip]);

    if (insertError) {
      showNotification("Failed: " + insertError.message, "error");
      setLoading(false);
      return;
    }

    await supabase.from('mmsi_pool').update({ status: 'Assigned', assigned_name: formData.name }).eq('mmsi', formData.mmsi);
    showNotification(`Ship ${formData.name} assigned MMSI ${formData.mmsi} successfully.`);
    setView('search');
    fetchData(supabase);
    setLoading(false);
  };

  const updateShip = async (updatedData) => {
    if (!supabase) return;
    setLoading(true);

    const { error } = await supabase
        .from('active_ships')
        .update({
            ship_name: updatedData.ship_name,
            owner_name: updatedData.owner_name,
            call_sign: updatedData.call_sign,
            reg_no: updatedData.reg_no,
            ship_type: updatedData.ship_type
        })
        .eq('mmsi', updatedData.mmsi);

    if (error) {
        showNotification("Update Failed: " + error.message, "error");
    } else {
        // Sync pool name to keep it consistent
        await supabase.from('mmsi_pool')
            .update({ assigned_name: updatedData.ship_name })
            .eq('mmsi', updatedData.mmsi);
            
        showNotification("Ship details updated successfully.");
        fetchData(supabase);
        setSelectedShip(updatedData); 
    }
    setLoading(false);
  };

  const deleteShip = async (ship) => {
    if (!supabase) return;
    if (!confirm(`Are you sure you want to delete ${ship.ship_name}?`)) return;
    setLoading(true);

    await supabase.from('deleted_ships').insert([{ mmsi: ship.mmsi, ship_name: ship.ship_name, reason: 'Manual Deletion' }]);
    await supabase.from('active_ships').delete().eq('mmsi', ship.mmsi);
    await supabase.from('mmsi_pool').update({ status: 'Available', assigned_name: null }).eq('mmsi', ship.mmsi);

    showNotification('Ship deleted and MMSI released.');
    fetchData(supabase);
    if (selectedShip?.mmsi === ship.mmsi) setSelectedShip(null);
  };

  // --- Components ---

  const SidebarItem = ({ id, icon: Icon, label }) => (
    <button
      onClick={() => { setView(id); setSelectedShip(null); }}
      className={`w-full flex items-center space-x-3 px-6 py-4 transition-colors ${
        view === id ? 'bg-blue-800 text-white border-r-4 border-blue-400' : 'text-blue-100 hover:bg-blue-800'
      }`}
    >
      <Icon size={20} />
      <span className="font-medium">{label}</span>
    </button>
  );

  const StatCard = ({ label, value, icon: Icon, color }) => (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-center space-x-4">
      <div className={`p-4 rounded-full ${color} text-white`}>
        <Icon size={24} />
      </div>
      <div>
        <p className="text-sm text-slate-500 font-medium uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold text-slate-800">{value}</p>
      </div>
    </div>
  );

  const ConflictModal = () => {
      if (importConflicts.length === 0) return null;
      const resolvedCount = resolvedConflicts.length;
      const totalCount = importConflicts.length;
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
                      {importConflicts.map((conflict, idx) => {
                          const isResolved = resolvedConflicts.find(r => r.mmsi === conflict.mmsi);
                          return (
                              <div key={conflict.mmsi} className={`bg-white border rounded-lg overflow-hidden transition-all ${isResolved ? 'border-emerald-200 opacity-60' : 'border-blue-200 shadow-md'}`}>
                                  <div className={`px-4 py-2 flex justify-between items-center ${isResolved ? 'bg-emerald-50' : 'bg-blue-50'}`}>
                                      <span className="font-mono font-bold text-slate-700">MMSI: {conflict.mmsi}</span>
                                      {isResolved && <span className="text-xs font-bold text-emerald-600 flex items-center"><Check size={14} className="mr-1"/> RESOLVED</span>}
                                  </div>
                                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                      {conflict.variants.map((variant, vIdx) => (
                                          <button key={vIdx} onClick={() => resolveConflict(conflict.mmsi, variant)} className={`text-left p-3 rounded-lg border-2 transition-all relative group ${isResolved === variant ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200' : 'border-slate-100 hover:border-blue-300 hover:bg-blue-50'}`}>
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
                      <button onClick={() => setImportConflicts([])} className="px-4 py-2 text-slate-500 hover:text-slate-700">Cancel Import</button>
                      <button onClick={finalizeImport} disabled={!isComplete} className={`px-6 py-3 rounded-lg font-bold text-white transition-all flex items-center ${isComplete ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-300 cursor-not-allowed'}`}>{isComplete ? <><Save className="mr-2" size={18}/> Finalize Import</> : `Resolve ${totalCount - resolvedCount} Remaining`}</button>
                  </div>
              </div>
          </div>
      );
  };

  const DetailModal = () => {
      if (!selectedShip) return null;
      
      const [isEditing, setIsEditing] = useState(false);
      const [editForm, setEditForm] = useState({...selectedShip});

      // Reset form when selectedShip changes
      useEffect(() => {
          setEditForm({...selectedShip});
          setIsEditing(false);
      }, [selectedShip]);

      const handleSave = async () => {
          await updateShip(editForm);
          setIsEditing(false);
      };

      return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden">
                  <div className="bg-blue-900 px-6 py-4 flex justify-between items-center">
                      <h2 className="text-white font-bold text-lg flex items-center"><Ship className="mr-2"/> Ship & MMSI Assignment Details</h2>
                      <button onClick={() => setSelectedShip(null)} className="text-blue-200 hover:text-white"><X size={24}/></button>
                  </div>
                  <div className="p-8 space-y-6">
                      
                      {/* --- Edit Mode --- */}
                      {isEditing ? (
                          <div className="space-y-4">
                              <div className="grid grid-cols-2 gap-4">
                                  <div>
                                      <label className="block text-xs font-bold text-slate-500 mb-1">Vessel Name</label>
                                      <input type="text" className="w-full p-2 border rounded" value={editForm.ship_name} onChange={(e) => setEditForm({...editForm, ship_name: e.target.value})} />
                                  </div>
                                  <div>
                                      <label className="block text-xs font-bold text-slate-500 mb-1">MMSI (Read Only)</label>
                                      <input type="text" disabled className="w-full p-2 border rounded bg-slate-100 text-slate-500 font-mono" value={editForm.mmsi} />
                                  </div>
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                  <div>
                                      <label className="block text-xs font-bold text-slate-500 mb-1">Call Sign</label>
                                      <input type="text" className="w-full p-2 border rounded" value={editForm.call_sign} onChange={(e) => setEditForm({...editForm, call_sign: e.target.value})} />
                                  </div>
                                  <div>
                                      <label className="block text-xs font-bold text-slate-500 mb-1">Registration No</label>
                                      <input type="text" className="w-full p-2 border rounded" value={editForm.reg_no} onChange={(e) => setEditForm({...editForm, reg_no: e.target.value})} />
                                  </div>
                              </div>
                              <div>
                                  <label className="block text-xs font-bold text-slate-500 mb-1">Owner Name</label>
                                  <input type="text" className="w-full p-2 border rounded" value={editForm.owner_name} onChange={(e) => setEditForm({...editForm, owner_name: e.target.value})} />
                              </div>
                              <div>
                                  <label className="block text-xs font-bold text-slate-500 mb-1">Ship Type</label>
                                  <input type="text" className="w-full p-2 border rounded" value={editForm.ship_type} onChange={(e) => setEditForm({...editForm, ship_type: e.target.value})} />
                              </div>
                              <div className="flex justify-end space-x-3 pt-4 border-t mt-4">
                                  <button onClick={() => setIsEditing(false)} className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded">Cancel</button>
                                  <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center"><Save size={16} className="mr-2"/> Save Changes</button>
                              </div>
                          </div>
                      ) : (
                          /* --- View Mode --- */
                          <>
                            <div className="grid grid-cols-2 gap-8">
                                <div>
                                    <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">Vessel Name</p>
                                    <p className="text-xl font-bold text-slate-800">{selectedShip.ship_name || 'N/A'}</p>
                                </div>
                                <div>
                                    <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">Assigned MMSI</p>
                                    <p className="text-2xl font-mono font-bold text-blue-600">{selectedShip.mmsi}</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-6 border-t border-b border-slate-100 py-6">
                                <div><p className="text-xs text-slate-500">Call Sign</p><p className="font-medium text-slate-700">{selectedShip.call_sign || '-'}</p></div>
                                <div><p className="text-xs text-slate-500">Registration No</p><p className="font-medium text-slate-700">{selectedShip.reg_no || '-'}</p></div>
                                <div><p className="text-xs text-slate-500">Owner Name</p><p className="font-medium text-slate-700">{selectedShip.owner_name || '-'}</p></div>
                                <div><p className="text-xs text-slate-500">Ship Type</p><p className="font-medium text-slate-700">{selectedShip.ship_type || '-'}</p></div>
                            </div>
                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-sm">
                                <div className="flex justify-between items-center mb-2"><span>Global Range:</span><span className="font-mono text-slate-600">408 000 001 - 408 999 998</span></div>
                                <div className="flex justify-between items-center"><span>Status:</span><span className="px-2 py-1 bg-emerald-100 text-emerald-800 rounded text-xs font-bold">ACTIVE</span></div>
                            </div>
                            <div className="flex justify-end space-x-3 pt-2">
                                <button onClick={() => setIsEditing(true)} className="px-4 py-2 border border-blue-200 text-blue-600 rounded hover:bg-blue-50 flex items-center"><Edit2 size={16} className="mr-2"/> Edit Details</button>
                                <button onClick={() => deleteShip(selectedShip)} className="px-4 py-2 border border-red-200 text-red-600 rounded hover:bg-red-50 flex items-center"><Trash2 size={16} className="mr-2"/> Delete</button>
                                <button onClick={() => setSelectedShip(null)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded hover:bg-slate-200">Close</button>
                            </div>
                          </>
                      )}
                  </div>
              </div>
          </div>
      );
  };

  // --- Views ---
  
  if (envError) return <div className="flex h-screen items-center justify-center text-red-600">Config Missing</div>;

  const stats = {
    totalActive: activeShips.length,
    totalPool: mmsiPool.length,
    availableMmsi: mmsiPool.filter(p => p.status === 'Available').length,
    deletedCount: deletedShips.length,
  };

  const SettingsView = () => (
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

  const AssignMmsiView = () => {
    const [formData, setFormData] = useState({ name: '', owner: '', callSign: '', regNo: '', type: 'Gen', mmsi: '' });
    
    const handleAutoSuggest = () => {
        const next = findNextAvailableMmsi();
        if(next) setFormData(prev => ({ ...prev, mmsi: next }));
        else showNotification("No available MMSI found in range!", "error");
    };

    return (
      <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="bg-blue-900 px-6 py-4"><h2 className="text-white font-bold text-lg flex items-center"><Plus className="mr-2" /> Assign New MMSI</h2></div>
        <form onSubmit={(e) => { e.preventDefault(); assignMmsi(formData); }} className="p-8 space-y-6">
          <div className="grid grid-cols-2 gap-6">
            <div><label className="text-sm font-semibold">Vessel Name</label><input value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} required className="w-full p-3 border rounded-lg" /></div>
            <div><label className="text-sm font-semibold">Call Sign</label><input value={formData.callSign} onChange={e=>setFormData({...formData, callSign: e.target.value})} className="w-full p-3 border rounded-lg" /></div>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div><label className="text-sm font-semibold">Owner</label><input value={formData.owner} onChange={e=>setFormData({...formData, owner: e.target.value})} required className="w-full p-3 border rounded-lg" /></div>
            <div><label className="text-sm font-semibold">Reg No</label><input value={formData.regNo} onChange={e=>setFormData({...formData, regNo: e.target.value})} className="w-full p-3 border rounded-lg" /></div>
          </div>
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
            <label className="text-sm font-bold text-slate-700 flex justify-between items-center mb-2">
                <span>Assign MMSI Number</span>
                <span className="text-xs font-normal text-slate-500">Range: 408000001 - 408999998</span>
            </label>
            <div className="flex gap-2">
                <input 
                    type="text" 
                    required 
                    className="flex-1 p-3 border rounded-lg font-mono text-blue-700 font-bold" 
                    value={formData.mmsi}
                    onChange={e => setFormData({...formData, mmsi: e.target.value})}
                    placeholder="Enter or Generate..."
                />
                <button type="button" onClick={handleAutoSuggest} className="px-4 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium text-sm flex items-center">
                    <RefreshCw size={16} className="mr-2"/> Find Next Free
                </button>
            </div>
            <p className="text-xs text-slate-500 mt-2 flex items-center"><Info size={12} className="mr-1"/> System will scan for the first available number in range.</p>
          </div>
          <div className="pt-4 flex justify-end"><button type="submit" className="px-6 py-3 rounded-lg bg-blue-600 text-white font-medium">Confirm Assignment</button></div>
        </form>
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900">
      <ConflictModal />
      <DetailModal />

      <div className={`${isSidebarOpen ? 'w-72' : 'w-20'} bg-blue-900 flex-shrink-0 flex flex-col transition-all duration-300 shadow-xl z-20`}>
        <div className="h-20 flex items-center justify-center border-b border-blue-800">
          <Anchor className="text-blue-300 mr-2" size={28} />
          {isSidebarOpen && <h1 className="text-white font-bold text-sm tracking-tight">TELECOM DIRECTORATE</h1>}
        </div>
        <nav className="flex-1 py-8 space-y-2">
          <SidebarItem id="dashboard" icon={LayoutDashboard} label={isSidebarOpen ? "Dashboard" : ""} />
          <SidebarItem id="search" icon={Search} label={isSidebarOpen ? "Ship Registry" : ""} />
          <SidebarItem id="assign" icon={Plus} label={isSidebarOpen ? "Assign MMSI" : ""} />
          <SidebarItem id="pool" icon={Radio} label={isSidebarOpen ? "MMSI Pool" : ""} />
          <SidebarItem id="deleted" icon={Trash2} label={isSidebarOpen ? "History" : ""} />
        </nav>
        <div className="p-4 border-t border-blue-800">
            <button onClick={() => setView('settings')} className={`w-full flex items-center ${isSidebarOpen ? 'justify-start px-6' : 'justify-center'} py-3 text-blue-300 hover:text-white hover:bg-blue-800 rounded transition-colors`}>
                <Settings size={20} />
                {isSidebarOpen && <span className="ml-3 font-medium">Settings</span>}
            </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 shadow-sm">
          <div><h2 className="text-xl font-bold text-slate-800">MMSI Assignment</h2><p className="text-xs text-slate-500">Telecom Directorate</p></div>
          <div className="flex items-center space-x-4"><div className="text-right hidden sm:block"><p className="text-sm font-bold text-slate-800">Admin User</p><p className="text-xs text-slate-500">Database Connected</p></div><div className="h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold">AD</div></div>
        </header>

        <main className="flex-1 overflow-y-auto p-8 relative">
          {loading && <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-40 backdrop-blur-sm"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-900"></div></div>}
          {notification && <div className={`fixed top-24 right-8 px-6 py-4 rounded-lg shadow-lg z-50 flex items-center text-white ${notification.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'}`}>{notification.type === 'error' ? <AlertTriangle className="mr-3" size={20}/> : <CheckCircle className="mr-3" size={20} />}{notification.msg}</div>}

          {view === 'dashboard' && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard label="Active Ships" value={stats.totalActive} icon={Ship} color="bg-blue-600" />
                <StatCard label="Available MMSI" value={stats.availableMmsi} icon={Radio} color="bg-emerald-500" />
                <StatCard label="Total Registry" value={stats.totalPool} icon={FileText} color="bg-indigo-500" />
                <StatCard label="Deleted / Archived" value={stats.deletedCount} icon={Trash2} color="bg-slate-500" />
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
                <h3 className="text-lg font-bold text-slate-800 mb-4">System Status</h3>
                <div className="space-y-4">
                  <div className="flex items-center text-sm text-slate-600"><CheckCircle className="text-emerald-500 mr-2" size={16} /> Database Connected</div>
                  <button onClick={() => fetchData(supabase)} className="mt-4 text-blue-600 text-sm font-semibold hover:underline flex items-center"><RefreshCw size={14} className="mr-1"/> Refresh Data</button>
                </div>
              </div>
            </div>
          )}

          {view === 'settings' && <SettingsView />}
          {view === 'assign' && <AssignMmsiView />}

          {view === 'search' && (
             <div className="bg-white rounded-xl shadow-sm border border-slate-100 flex flex-col h-full">
               <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-4">
                 <h2 className="text-xl font-bold text-slate-800">Active Ship Registry</h2>
                 <div className="relative w-full sm:w-72">
                   <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={18} />
                   <input type="text" placeholder="Search Name, MMSI..." className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}/>
                 </div>
               </div>
               <div className="overflow-x-auto flex-1">
                 <table className="w-full text-left">
                   <thead className="bg-slate-50 text-slate-500 text-sm uppercase">
                        <tr>
                            <th className="px-6 py-4">MMSI</th>
                            <th className="px-6 py-4">Name</th>
                            <th className="px-6 py-4">Call Sign</th>
                            <th className="px-6 py-4">Reg No</th>
                            <th className="px-6 py-4">Owner</th>
                        </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-100 cursor-pointer">
                     {activeShips.filter(s => (s.ship_name?.toLowerCase().includes(searchTerm.toLowerCase()) || s.mmsi?.includes(searchTerm))).map(ship => (
                       <tr key={ship.mmsi} onClick={() => setSelectedShip(ship)} className="hover:bg-blue-50 transition-colors">
                         <td className="px-6 py-4 font-mono text-blue-600 font-medium">{ship.mmsi}</td>
                         <td className="px-6 py-4 font-medium text-slate-800">{ship.ship_name}</td>
                         <td className="px-6 py-4 text-slate-600">{ship.call_sign}</td>
                         <td className="px-6 py-4 text-slate-600 font-mono text-xs">{ship.reg_no || '-'}</td>
                         <td className="px-6 py-4 text-slate-600 text-sm">{ship.owner_name}</td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
               </div>
             </div>
          )}
          
          {view === 'pool' && (
            <div className="bg-white rounded-xl shadow-sm p-6">
               <h3 className="text-lg font-bold mb-4">MMSI Number Pool</h3>
               <div className="h-96 overflow-y-auto border rounded-lg">
                 <table className="w-full text-sm">
                   <thead className="bg-slate-50 sticky top-0"><tr><th className="p-3 text-left">MMSI</th><th className="p-3 text-left">Vessel</th><th className="p-3 text-left">Status</th></tr></thead>
                   <tbody>
                     {mmsiPool.map(p => (
                       <tr key={p.mmsi} className="border-t">
                         <td className="p-3 font-mono">{p.mmsi}</td>
                         <td className="p-3">{p.assigned_name || '-'}</td>
                         <td className="p-3"><span className={`px-2 py-1 rounded text-xs ${p.status === 'Available' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-800'}`}>{p.status}</span></td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
               </div>
            </div>
          )}

          {view === 'deleted' && (
             <div className="bg-white rounded-xl shadow-sm p-6">
               <h3 className="text-lg font-bold mb-4 text-red-700">Deleted / Archived Ships</h3>
               <table className="w-full text-left text-sm">
                  <thead className="bg-red-50 text-red-800"><tr><th className="p-3">MMSI</th><th className="p-3">Name</th><th className="p-3">Reason</th></tr></thead>
                  <tbody className="divide-y">
                    {deletedShips.map(s => <tr key={s.id}><td className="p-3 font-mono">{s.mmsi}</td><td className="p-3">{s.ship_name}</td><td className="p-3">{s.reason}</td></tr>)}
                  </tbody>
                </table>
             </div>
          )}
        </main>
      </div>
    </div>
  );
}