import React, { useState, useEffect, useMemo } from 'react';
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
  Edit2,
  Ban,
  ListX,
  FileSearch,
  Loader2,
  Filter,
  Calendar,
  Eye,
  History,
  ArrowRightLeft,
  AlertOctagon
} from 'lucide-react';

// --- API Configuration ---
const apiKey = "AIzaSyCMkoBqWYbSAuLHIzTbieEM5jRlvJoyL1I"; 

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

// --- Utility: Format MMSI ---
const formatMmsi = (mmsi) => {
    if (!mmsi) return '';
    const s = mmsi.toString();
    if (s.length !== 9) return s;
    return `${s.slice(0,3)} ${s.slice(3,6)} ${s.slice(6,9)}`;
};

// --- Utility: Date Status Helper ---
const getShipStatus = (expiryDate, regDate, certPath) => {
    if (!expiryDate || !regDate || !certPath) return 'missing';
    
    const today = new Date();
    const exp = new Date(expiryDate);
    const diffTime = exp - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return 'expired';
    if (diffDays <= 30) return 'expiring';
    return 'active';
};

// --- Utility: PDF to Image Helper ---
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

// --- Utility: Gemini API Caller ---
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

// --- SUB-COMPONENTS (Moved Outside) ---

const SidebarItem = ({ id, icon: Icon, label, setView }) => (
  <button
    onClick={() => setView(id)}
    className="w-full flex items-center space-x-3 px-6 py-4 text-blue-100 hover:bg-blue-800 transition-colors"
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
                              <button onClick={() => onViewHistory(selectedShip.mmsi)} className="text-blue-600 hover:underline text-sm font-semibold flex items-center">
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
                                    {h.revoked_at ? new Date(h.revoked_at).toLocaleDateString() : 'Unknown'}
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
                        {exclusions.length === <tr><td colSpan="4" className="p-4 text-center text-slate-400 text-sm">No exclusions active.</td></tr>}
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

export default function MMSIAssignmentSystem() {
  const [supabase, setSupabase] = useState(null);
  const [activeShips, setActiveShips] = useState([]);
  const [mmsiPool, setMmsiPool] = useState([]);
  const [historyData, setHistoryData] = useState([]);
  const [exclusions, setExclusions] = useState([]); 
  
  const [selectedShip, setSelectedShip] = useState(null);
  const [importConflicts, setImportConflicts] = useState([]); 
  const [cleanImportData, setCleanImportData] = useState([]); 
  const [resolvedConflicts, setResolvedConflicts] = useState([]); 
  
  const [view, setView] = useState('dashboard'); 
  const [searchTerm, setSearchTerm] = useState('');
  const [historySearch, setHistorySearch] = useState(''); // New state for history search
  const [statusFilter, setStatusFilter] = useState('all'); 
  
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [notification, setNotification] = useState(null);
  const [loading, setLoading] = useState(false);
  const [envError, setEnvError] = useState(false);
  const [supabaseUrl, setSupabaseUrl] = useState('');

  const MMSI_START = 408000001;
  const MMSI_END = 408999998;

  useEffect(() => {
    let envUrl, envKey;
    try {
        envUrl = import.meta.env.VITE_SUPABASE_URL;
        envKey = import.meta.env.VITE_SUPABASE_KEY;
        setSupabaseUrl(envUrl);
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
      const { data: hist } = await client.from('assignment_history').select('*').order('revoked_at', { ascending: false });
      const { data: excl } = await client.from('mmsi_exclusions').select('*').order('start_mmsi', { ascending: true });

      if(active) setActiveShips(active);
      if(pool) setMmsiPool(pool);
      if(hist) setHistoryData(hist);
      if(excl) setExclusions(excl);
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

  const uploadFile = async (file, mmsi) => {
      if (!supabase) throw new Error("Database not connected");
      const fileExt = file.name.split('.').pop();
      const fileName = `${mmsi || 'temp'}-${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;
      const { error } = await supabase.storage.from('certificates').upload(filePath, file);
      if (error) throw error;
      return filePath;
  };

  const calculatedStats = useMemo(() => {
      const totalRange = MMSI_END - MMSI_START + 1;
      const sortedExclusions = [...exclusions].sort((a, b) => a.start_mmsi - b.start_mmsi);
      const mergedExclusions = [];
      if (sortedExclusions.length > 0) {
          let current = { start: sortedExclusions[0].start_mmsi, end: sortedExclusions[0].end_mmsi };
          for (let i = 1; i < sortedExclusions.length; i++) {
              if (sortedExclusions[i].start_mmsi <= current.end + 1) {
                  current.end = Math.max(current.end, sortedExclusions[i].end_mmsi);
              } else {
                  mergedExclusions.push(current);
                  current = { start: sortedExclusions[i].start_mmsi, end: sortedExclusions[i].end_mmsi };
              }
          }
          mergedExclusions.push(current);
      }

      let excludedCount = 0;
      mergedExclusions.forEach(ex => {
          const s = Math.max(ex.start, MMSI_START);
          const e = Math.min(ex.end, MMSI_END);
          if (e >= s) excludedCount += (e - s + 1);
      });

      const uniqueAssigned = new Set(
          activeShips
            .map(s => parseInt(s.mmsi, 10))
            .filter(m => m >= MMSI_START && m <= MMSI_END && !isNaN(m))
      );
      const assignedCount = uniqueAssigned.size;

      let intersectionCount = 0;
      uniqueAssigned.forEach(mmsi => {
          if (mergedExclusions.some(ex => mmsi >= ex.start && mmsi <= ex.end)) {
              intersectionCount++;
          }
      });

      const totalUsed = assignedCount + excludedCount - intersectionCount;
      const available = Math.max(0, totalRange - totalUsed);

      return {
          totalActive: activeShips.length,
          totalPool: mmsiPool.length, 
          availableMmsi: available,
          historyCount: historyData.length,
          mergedExclusions,
          uniqueAssigned
      };
  }, [activeShips, exclusions, mmsiPool, historyData]);

  const findNextAvailableMmsi = () => {
    const { uniqueAssigned, mergedExclusions } = calculatedStats;
    const isExcluded = (mmsi) => {
        return mergedExclusions.some(ex => mmsi >= ex.start && mmsi <= ex.end);
    };
    for (let i = MMSI_START; i <= MMSI_END; i++) {
        if (!uniqueAssigned.has(i) && !isExcluded(i)) {
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
          showNotification(`Found ${conflicts.length} conflicting MMSI numbers.`, 'warning');
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
        const poolUpdates = data.map(s => ({ mmsi: s.mmsi, status: 'Assigned', assigned_name: s.ship_name }));
        await supabase.from('mmsi_pool').upsert(poolUpdates, { onConflict: 'mmsi' });
        showNotification(`Successfully imported ${data.length} ships.`, 'success');
        fetchData(supabase); 
      }
      setLoading(false);
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

  const handleViewHistory = (mmsi) => {
      setSelectedShip(null);
      setHistorySearch(mmsi);
      setView('history');
  };

  if (envError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 font-sans p-4">
        <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md text-center">
          <AlertTriangle className="mx-auto text-red-500 mb-4" size={48} />
          <h2 className="text-2xl font-bold text-slate-800 mb-2">Config Missing</h2>
          <p className="text-slate-500 mb-6 text-sm">Check your .env.local file for VITE_SUPABASE_URL and KEY.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900">
      {/* --- Global Modals --- */}
      <ConflictModal 
        conflicts={importConflicts} 
        resolved={resolvedConflicts} 
        resolve={resolveConflict} 
        finalize={finalizeImport} 
        setConflicts={setImportConflicts} 
      />
      <DetailModal 
        selectedShip={selectedShip} 
        setSelectedShip={setSelectedShip} 
        updateShip={updateShip} 
        revokeShip={revokeShip} 
        uploadFile={uploadFile} 
        supabaseUrl={supabaseUrl}
        onViewHistory={handleViewHistory} // Pass the handler
      />

      {/* --- Sidebar --- */}
      <div className={`${isSidebarOpen ? 'w-72' : 'w-20'} bg-blue-900 flex-shrink-0 flex flex-col transition-all duration-300 shadow-xl z-20`}>
        <div className="h-20 flex items-center justify-center border-b border-blue-800">
          <Anchor className="text-blue-300 mr-2" size={28} />
          {isSidebarOpen && <h1 className="text-white font-bold text-sm tracking-tight">TELECOM DIRECTORATE</h1>}
        </div>
        
        <nav className="flex-1 py-8 space-y-2">
          <SidebarItem id="dashboard" icon={LayoutDashboard} label={isSidebarOpen ? "Dashboard" : ""} setView={setView} />
          <SidebarItem id="search" icon={Search} label={isSidebarOpen ? "Ship Registry" : ""} setView={setView} />
          <SidebarItem id="assign" icon={Plus} label={isSidebarOpen ? "Assign MMSI" : ""} setView={setView} />
          <SidebarItem id="exclusions" icon={Ban} label={isSidebarOpen ? "Exclusions" : ""} setView={setView} />
          <SidebarItem id="pool" icon={Radio} label={isSidebarOpen ? "MMSI Pool" : ""} setView={setView} />
          <SidebarItem id="history" icon={History} label={isSidebarOpen ? "History" : ""} setView={setView} />
        </nav>
      </div>

      {/* --- Main Content --- */}
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

          {view === 'dashboard' && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard label="Active Ships" value={calculatedStats.totalActive} icon={Ship} color="bg-blue-600" />
                <StatCard label="Available MMSI" value={calculatedStats.availableMmsi} icon={Radio} color="bg-emerald-500" subtext="Calculated dynamically"/>
                <StatCard label="Total Registry" value={calculatedStats.totalPool} icon={FileText} color="bg-indigo-500" />
                <StatCard label="Historical Records" value={calculatedStats.historyCount} icon={History} color="bg-slate-500" />
              </div>
            </div>
          )}

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
          
          {view === 'pool' && (
            <div className="bg-white rounded-xl shadow-sm p-6">
               <h3 className="text-lg font-bold mb-4">MMSI Number Pool</h3>
               <div className="h-96 overflow-y-auto border rounded-lg">
                 <table className="w-full text-sm">
                   <thead className="bg-slate-50 sticky top-0"><tr><th className="p-3 text-left">MMSI</th><th className="p-3 text-left">Vessel</th><th className="p-3 text-left">Status</th></tr></thead>
                   <tbody>
                     {mmsiPool.map(p => (
                       <tr key={p.mmsi} className="border-t">
                         <td className="p-3 font-mono">{formatMmsi(p.mmsi)}</td>
                         <td className="p-3">{p.assigned_name || '-'}</td>
                         <td className="p-3"><span className={`px-2 py-1 rounded text-xs ${p.status === 'Available' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-800'}`}>{p.status}</span></td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
               </div>
            </div>
          )}

          {view === 'history' && (
            <HistoryView 
                historyData={historyData} 
                supabaseUrl={supabaseUrl} 
                searchMmsi={historySearch} // Pass search state
                setSearchMmsi={setHistorySearch} // Pass setter
            />
          )}
        </main>
      </div>
    </div>
  );
}