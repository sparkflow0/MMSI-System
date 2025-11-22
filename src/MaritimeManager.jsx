import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { 
  Ship, 
  Search, 
  Plus, 
  FileText, 
  Trash2, 
  LayoutDashboard, 
  Anchor, 
  Radio, 
  Upload, 
  CheckCircle, 
  AlertTriangle,
  Menu,
  X,
  Save,
  Database,
  RefreshCw
} from 'lucide-react';

// --- CONFIGURATION ---
// REPLACE THESE WITH YOUR ACTUAL SUPABASE PROJECT DETAILS
const supabaseUrl = 'YOUR_SUPABASE_URL_HERE';
const supabaseKey = 'YOUR_SUPABASE_ANON_KEY_HERE';

const supabase = createClient(supabaseUrl, supabaseKey);

// --- Utility: CSV Parser ---
const parseCSV = (text, type) => {
  const lines = text.split('\n');
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]+/g, ''));
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

    if (row.length < 2) continue; 

    const obj = {};
    
    if (type === 'active') {
        // Mapping for "all ships 25-10-2022.csv"
        let rawMmsi = row[headers.indexOf('mmsi')] || row[13];
        if(rawMmsi) rawMmsi = rawMmsi.replace(/\s/g, ''); // Clean spaces

        obj.mmsi = rawMmsi;
        obj.ship_name = row[headers.indexOf('ship_name')] || row[3];
        obj.call_sign = row[headers.indexOf('callsign')] || row[4];
        obj.owner_name = row[headers.indexOf('user_name')] || row[5];
        obj.validity = row[headers.indexOf('vald')] || row[1]; // Needs Date formatting in real scenario
        obj.ship_type = row[headers.indexOf('tp')] || 'Gen';
        obj.reg_no = row[headers.indexOf('regno')] || '';
        obj.cpr = row[headers.indexOf('cpr')] || '';
    } else if (type === 'pool') {
        // Mapping for "Sheet1.csv"
        let rawMmsi = row[0];
        if(rawMmsi) rawMmsi = rawMmsi.replace(/\s/g, '');

        obj.mmsi = rawMmsi;
        obj.assigned_name = row[1]; // Name column
        // Logic: If name column is empty or very short, it's Available
        obj.status = (row[1] && row[1].length > 1) ? 'Assigned' : 'Available';
    } else if (type === 'deleted') {
         // Mapping for "Deleted.csv"
         let rawMmsi = row[0];
         if(rawMmsi) rawMmsi = rawMmsi.replace(/\s/g, '');
         
         obj.mmsi = rawMmsi;
         obj.ship_name = row[1];
         obj.reason = row[headers.indexOf('reason')] || 'Archived from File';
    }
    if(obj.mmsi) data.push(obj); // Only push if MMSI exists
  }
  return data;
};

export default function MMSIAssignmentSystem() {
  // --- State ---
  const [activeShips, setActiveShips] = useState([]);
  const [mmsiPool, setMmsiPool] = useState([]);
  const [deletedShips, setDeletedShips] = useState([]);
  
  const [view, setView] = useState('dashboard'); 
  const [searchTerm, setSearchTerm] = useState('');
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [notification, setNotification] = useState(null);
  const [loading, setLoading] = useState(false);

  // --- Initial Load ---
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: active } = await supabase.from('active_ships').select('*').order('created_at', { ascending: false });
      const { data: pool } = await supabase.from('mmsi_pool').select('*').order('mmsi', { ascending: true }).limit(1000); // Limiting for perf
      const { data: deleted } = await supabase.from('deleted_ships').select('*').order('deleted_at', { ascending: false });

      if(active) setActiveShips(active);
      if(pool) setMmsiPool(pool);
      if(deleted) setDeletedShips(deleted);
    } catch (error) {
      console.error("Error fetching data:", error);
      showNotification("Error connecting to Database. Check credentials.", "error");
    } finally {
      setLoading(false);
    }
  };

  // --- Actions ---
  
  const showNotification = (msg, type = 'success') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const handleFileUpload = (e, type) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target.result;
      const parsedData = parseCSV(text, type);
      
      let error = null;

      // Bulk Insert to Supabase
      if (type === 'active') {
        const { error: err } = await supabase.from('active_ships').upsert(parsedData, { onConflict: 'mmsi' });
        error = err;
      } else if (type === 'pool') {
        const { error: err } = await supabase.from('mmsi_pool').upsert(parsedData, { onConflict: 'mmsi' });
        error = err;
      } else if (type === 'deleted') {
        const { error: err } = await supabase.from('deleted_ships').insert(parsedData);
        error = err;
      }

      if (error) {
        console.error(error);
        showNotification(`Database Error: ${error.message}`, 'error');
      } else {
        showNotification(`Successfully migrated ${parsedData.length} records to ${type} table.`);
        fetchData(); // Refresh local state
      }
      setLoading(false);
    };
    reader.readAsText(file);
  };

  const assignMmsi = async (formData) => {
    setLoading(true);
    
    // 1. Insert into Active Ships
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
      showNotification("Failed to create ship record: " + insertError.message, "error");
      setLoading(false);
      return;
    }

    // 2. Update Pool Status
    const { error: updateError } = await supabase
      .from('mmsi_pool')
      .update({ status: 'Assigned', assigned_name: formData.name })
      .eq('mmsi', formData.mmsi);

    if (updateError) {
      showNotification("Ship created but failed to update MMSI Pool status.", "error");
    } else {
      showNotification(`Ship ${formData.name} assigned MMSI ${formData.mmsi} successfully.`);
      setView('search');
      fetchData();
    }
    setLoading(false);
  };

  const deleteShip = async (ship) => {
    if (!confirm(`Are you sure you want to delete ${ship.ship_name}? This will archive the record.`)) return;
    setLoading(true);

    // 1. Add to Deleted
    await supabase.from('deleted_ships').insert([{
      mmsi: ship.mmsi,
      ship_name: ship.ship_name,
      reason: 'Manual Deletion via System'
    }]);

    // 2. Remove from Active
    await supabase.from('active_ships').delete().eq('mmsi', ship.mmsi);

    // 3. Free up in Pool
    await supabase.from('mmsi_pool').update({ status: 'Available', assigned_name: null }).eq('mmsi', ship.mmsi);

    showNotification('Ship moved to deleted records and MMSI released.');
    fetchData();
  };

  // --- Derived State ---
  const stats = {
    totalActive: activeShips.length,
    totalPool: mmsiPool.length,
    availableMmsi: mmsiPool.filter(p => p.status === 'Available').length,
    deletedCount: deletedShips.length,
  };

  // --- Components ---

  const SidebarItem = ({ id, icon: Icon, label }) => (
    <button
      onClick={() => setView(id)}
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

  // --- Views ---

  const DashboardView = () => (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard label="Active Ships" value={stats.totalActive} icon={Ship} color="bg-blue-600" />
        <StatCard label="Available MMSI" value={stats.availableMmsi} icon={Radio} color="bg-emerald-500" />
        <StatCard label="Total Registry" value={stats.totalPool} icon={FileText} color="bg-indigo-500" />
        <StatCard label="Deleted / Archived" value={stats.deletedCount} icon={Trash2} color="bg-slate-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Migration / Upload */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
          <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center">
            <Database className="mr-2 text-blue-600" size={20}/> Database Migration / Import
          </h3>
          <p className="text-sm text-slate-500 mb-4">Select the corresponding CSV files to migrate data into Supabase.</p>
          <div className="space-y-4">
            <div className="p-4 border border-dashed border-slate-300 rounded-lg bg-slate-50">
              <label className="block text-sm font-medium text-slate-700 mb-2">1. Active Ships (all ships...csv)</label>
              <input type="file" accept=".csv" onChange={(e) => handleFileUpload(e, 'active')} className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"/>
            </div>
            <div className="p-4 border border-dashed border-slate-300 rounded-lg bg-slate-50">
              <label className="block text-sm font-medium text-slate-700 mb-2">2. MMSI Pool (Sheet1.csv)</label>
              <input type="file" accept=".csv" onChange={(e) => handleFileUpload(e, 'pool')} className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"/>
            </div>
            <div className="p-4 border border-dashed border-slate-300 rounded-lg bg-slate-50">
              <label className="block text-sm font-medium text-slate-700 mb-2">3. Deleted Ships (Deleted.csv)</label>
              <input type="file" accept=".csv" onChange={(e) => handleFileUpload(e, 'deleted')} className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-red-50 file:text-red-700 hover:file:bg-red-100"/>
            </div>
          </div>
        </div>

        {/* System Status */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
          <h3 className="text-lg font-bold text-slate-800 mb-4">Database Status</h3>
          <div className="space-y-4">
            <div className="flex items-center text-sm text-slate-600">
              <CheckCircle className="text-emerald-500 mr-2" size={16} />
              Supabase Connection Active
            </div>
            <div className="flex items-center text-sm text-slate-600">
              <CheckCircle className="text-emerald-500 mr-2" size={16} />
              Tables: Active, Pool, Deleted
            </div>
            {stats.availableMmsi < 50 && (
               <div className="flex items-center text-sm text-amber-600 bg-amber-50 p-2 rounded">
               <AlertTriangle className="mr-2" size={16} />
               Warning: Low MMSI availability ({stats.availableMmsi} remaining)
             </div>
            )}
            <button onClick={fetchData} className="mt-4 text-blue-600 text-sm font-semibold hover:underline flex items-center">
               <RefreshCw size={14} className="mr-1"/> Refresh Data
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const ShipListView = () => {
    const filtered = activeShips.filter(s => 
      (s.ship_name && s.ship_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (s.mmsi && s.mmsi.includes(searchTerm)) ||
      (s.call_sign && s.call_sign.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (s.owner_name && s.owner_name.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 flex flex-col h-full">
        <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-4">
          <h2 className="text-xl font-bold text-slate-800">Active Ship Registry</h2>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text" 
              placeholder="Search Name, MMSI, Owner..." 
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-slate-500 text-sm uppercase">
              <tr>
                <th className="px-6 py-4 font-semibold">MMSI</th>
                <th className="px-6 py-4 font-semibold">Ship Name</th>
                <th className="px-6 py-4 font-semibold">Call Sign</th>
                <th className="px-6 py-4 font-semibold">Owner</th>
                <th className="px-6 py-4 font-semibold">Validity</th>
                <th className="px-6 py-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(ship => (
                <tr key={ship.mmsi} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 font-mono text-blue-600 font-medium">{ship.mmsi}</td>
                  <td className="px-6 py-4 font-medium text-slate-800">{ship.ship_name}</td>
                  <td className="px-6 py-4 text-slate-600">{ship.call_sign}</td>
                  <td className="px-6 py-4 text-slate-600 text-sm max-w-xs truncate">{ship.owner_name}</td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800">
                      {ship.validity}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button 
                      onClick={() => deleteShip(ship)}
                      className="text-slate-400 hover:text-red-600 transition-colors"
                      title="Delete Ship"
                    >
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan="6" className="px-6 py-12 text-center text-slate-400">
                    No ships found matching your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const AssignMmsiView = () => {
    const [formData, setFormData] = useState({
      name: '', owner: '', callSign: '', regNo: '', type: 'Gen', mmsi: ''
    });

    // Only show Available MMSIs
    const availableMmsis = mmsiPool.filter(p => p.status === 'Available').slice(0, 200);

    const handleSubmit = (e) => {
      e.preventDefault();
      if (!formData.mmsi) return showNotification("Please select an MMSI number.", "error");
      assignMmsi(formData);
    };

    return (
      <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="bg-blue-900 px-6 py-4 flex items-center justify-between">
          <h2 className="text-white font-bold text-lg flex items-center">
            <Plus className="mr-2" /> Assign New MMSI
          </h2>
        </div>
        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Vessel Name</label>
              <input required type="text" className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="e.g. SEA HAWK 1" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}/>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Call Sign</label>
              <input type="text" className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="e.g. A9D1234" value={formData.callSign} onChange={e => setFormData({...formData, callSign: e.target.value})}/>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Owner / Company Name</label>
            <input required type="text" className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="Full Registered Owner Name" value={formData.owner} onChange={e => setFormData({...formData, owner: e.target.value})}/>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Assign MMSI Number</label>
            <select required className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white" value={formData.mmsi} onChange={e => setFormData({...formData, mmsi: e.target.value})}>
              <option value="">Select an available MMSI...</option>
              {availableMmsis.map(m => (
                <option key={m.mmsi} value={m.mmsi}>{m.mmsi} (Available)</option>
              ))}
            </select>
          </div>

          <div className="pt-4 flex justify-end space-x-4">
             <button type="button" onClick={() => setView('search')} className="px-6 py-3 rounded-lg text-slate-600 font-medium hover:bg-slate-100 transition-colors">Cancel</button>
            <button type="submit" className="px-6 py-3 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all flex items-center"><Save className="mr-2" size={18} /> Confirm Assignment</button>
          </div>
        </form>
      </div>
    );
  };

  // --- Main Layout ---
  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900">
      
      {/* Sidebar */}
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

        <button onClick={() => setSidebarOpen(!isSidebarOpen)} className="h-12 flex items-center justify-center text-blue-300 hover:text-white hover:bg-blue-800 transition-colors">
          {isSidebarOpen ? <X size={20}/> : <Menu size={20}/>}
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 shadow-sm">
          <div>
            <h2 className="text-xl font-bold text-slate-800">MMSI Assignment</h2>
            <p className="text-xs text-slate-500">Telecom Directorate</p>
          </div>
          <div className="flex items-center space-x-4">
             <div className="text-right hidden sm:block">
               <p className="text-sm font-bold text-slate-800">Admin User</p>
               <p className="text-xs text-slate-500">Database Connected</p>
             </div>
             <div className="h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold">AD</div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-8 relative">
          
          {/* Loading Overlay */}
          {loading && (
            <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-40 backdrop-blur-sm">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-900"></div>
            </div>
          )}

          {notification && (
            <div className={`fixed top-24 right-8 px-6 py-4 rounded-lg shadow-lg z-50 flex items-center text-white ${notification.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'}`}>
              {notification.type === 'error' ? <AlertTriangle className="mr-3" size={20}/> : <CheckCircle className="mr-3" size={20} />}
              {notification.msg}
            </div>
          )}

          {view === 'dashboard' && <DashboardView />}
          {view === 'search' && <ShipListView />}
          {view === 'assign' && <AssignMmsiView />}
          
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
               <div className="overflow-x-auto">
               <table className="w-full text-left">
                  <thead className="bg-red-50 text-red-800 text-sm"><tr><th className="p-3">MMSI</th><th className="p-3">Name</th><th className="p-3">Reason</th></tr></thead>
                  <tbody className="divide-y">
                    {deletedShips.map(s => (
                      <tr key={s.id || s.mmsi}>
                        <td className="p-3 font-mono">{s.mmsi}</td>
                        <td className="p-3">{s.ship_name}</td>
                        <td className="p-3 text-slate-500">{s.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
             </div>
          )}
        </main>
      </div>
    </div>
  );
}
