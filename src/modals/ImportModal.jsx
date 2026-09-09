import React from 'react';
import { useState, useRef } from 'react';
import { X, AlertCircle, Upload, FileText, AlertTriangle, CheckCircle, ChevronRight } from 'lucide-react';
import { loadXLSX, useModalA11y, subnetOctetCount } from '../shared/common';

function ImportModal({ onClose, onImport, networkConfig }) {
  const modalRef = useModalA11y(typeof onClose === 'function' ? onClose : null);
  const EXPECTED_FIELDS = [
    { key: 'ip',           label: 'IP Address',        required: true  },
    { key: 'name',         label: 'Name / Asset Name', required: false },
    { key: 'hostname',     label: 'Hostname',          required: false },
    { key: 'type',         label: 'Type',              required: false },
    { key: 'service',      label: 'Service / Apps',    required: false },
    { key: 'location',     label: 'Location',          required: false },
    { key: 'host',         label: 'Host / Hypervisor', required: false },
    { key: 'tags',         label: 'Tags',              required: false },
    { key: 'notes',        label: 'Notes',             required: false },
    { key: 'status',       label: 'Status',            required: false },
  ];
  const FIELD_ALIASES = {
    ip:           ['ip','ip address','ipaddress','address','ip_address'],
    name:         ['name','asset name','assetname','asset','device name','devicename'],
    hostname:     ['hostname','host','host name','fqdn','dns','host_name'],
    type:         ['type','virtual/physical','vm type','device type','asset type'],
    service:      ['service','services','apps','application','applications','app'],
    location:     ['location','loc','place','room'],
    host:         ['host','host / hypervisor','hypervisor','proxmox_host','proxmox','proxmox host','host machine','vm host'],
    tags:         ['tags','tag','labels','label','categories','category'],
    notes:        ['notes','note','comment','comments','description','info'],
    status:       ['status','state','assignment'],
  };

  const [step, setStep]               = useState(1);
  const [isDragging, setIsDragging]   = useState(false);
  const [fileName, setFileName]       = useState('');
  const [rawHeaders, setRawHeaders]   = useState([]);
  const [rawRows, setRawRows]         = useState([]);
  const [multiSheetWarn, setMultiSheetWarn] = useState(false);
  const [parseError, setParseError]   = useState('');
  const [columnMap, setColumnMap]     = useState({});
  const [validated, setValidated]     = useState([]);
  const [importMode, setImportMode]   = useState('merge');
  const fileRef = useRef(null);

  const autoDetect = (headers) => {
    const map = {};
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      const match = headers.find(h => aliases.includes(h.toLowerCase().trim()));
      if (match) map[field] = match;
    }
    return map;
  };

  const parseFile = (file) => {
    setParseError('');
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['csv','xlsx','xls'].includes(ext)) {
      setParseError('Please upload a .csv, .xlsx, or .xls file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const XLSX = await loadXLSX();
        const wb = XLSX.read(e.target.result, { type: 'binary' });
        setMultiSheetWarn(wb.SheetNames.length > 1);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        const headers = (raw[0] || []).map(h => String(h).trim()).filter(Boolean);
        const dataRows = raw.slice(1).filter(r => r.some(c => String(c).trim() !== ''));
        const objRows  = dataRows.map(row =>
          Object.fromEntries(headers.map((h, i) => [h, String(row[i] ?? '').trim()]))
        );
        setRawHeaders(headers);
        setRawRows(objRows);
        setFileName(file.name);
        setColumnMap(autoDetect(headers));
      } catch {
        setParseError('Failed to parse file. Please check the format and try again.');
      }
    };
    reader.readAsBinaryString(file);
  };

  const downloadTemplate = () => {
    const hdrs = EXPECTED_FIELDS.map(f => f.key).join(',');
    const ex   = '192.168.0.200,My New Server,server.example.com,LXC,Docker,Garage,node01,Management container,assigned';
    const blob = new Blob([`${hdrs}\n${ex}\n`], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'ip-manager-template.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const buildValidated = () => {
    const seenIps = new Set();
    return rawRows.map((row, i) => {
      const errors = [], warnings = [];
      const g = (f) => (columnMap[f] ? (row[columnMap[f]] || '').trim() : '');
      let ip = g('ip');
      if (!ip) {
        errors.push('Missing IP address');
      } else {
        // Auto-expand bare last-octet (e.g. "170" → "192.168.0.170") only for /24 networks
        if (/^\d{1,3}$/.test(ip) && subnetOctetCount(networkConfig.subnet) === 3)
          ip = `${networkConfig.subnet}.${ip}`;
        if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
          errors.push(`Invalid IP format: ${g('ip')}`);
        } else if (seenIps.has(ip)) {
          errors.push('Duplicate IP within file');
        } else {
          seenIps.add(ip);
          if (!ip.startsWith(networkConfig.subnet + '.'))
            warnings.push(`Outside ${networkConfig.subnet}.x subnet`);
        }
      }
      const hostname = g('hostname'), type = g('type'), service = g('service');
      const status = g('status').toLowerCase() || 'assigned';
      const isFree = status === 'free';
      // Rows with only an IP and no other details are treated as Free (available to claim)
      const isSparse = !hostname && !type && !service && !g('name');
      if (isSparse) warnings.push('No details — imported as Free (available to claim)');
      const effectiveFree = isFree || isSparse;
      const name = effectiveFree ? 'Free' : (g('name') || (hostname ? hostname.split('.')[0] : '') || service || 'Imported');
      return {
        _row: i + 2, _errors: errors, _warnings: warnings, _valid: errors.length === 0,
        assetName: effectiveFree ? 'Free' : name,
        hostname, ip: ip || g('ip'), type,
        location: g('location') || g('host'),
        apps: service, notes: g('notes'),
        tags: g('tags') ? g('tags').split(',').map(t => t.trim()).filter(Boolean) : [],
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const validateAndAdvance = () => {
    const v = buildValidated();
    setValidated(v);
    setStep(3);
  };

  const readyRows   = validated.filter(r => r._valid);
  const skippedRows = validated.filter(r => !r._valid);
  const warnRows    = readyRows.filter(r => r._warnings?.length > 0);

  const doImport = () => {
    const clean = readyRows.map(({ _row, _errors, _warnings, _valid, ...r }) => r);
    onImport(clean, importMode);
    onClose();
  };

  const hasRequired = EXPECTED_FIELDS.filter(f => f.required).every(f => columnMap[f.key]);
  const inputCls    = 'px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500';

  return (
    <div ref={modalRef} role="dialog" aria-modal="true" aria-label="Import data" tabIndex={-1}
         className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 outline-none" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="p-6 border-b border-slate-200 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Upload className="w-5 h-5 text-emerald-600" />Import IP Data
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">Import from CSV or Excel — merge or replace existing data</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-500" /></button>
          </div>
          {/* Step indicator */}
          <div className="flex items-center gap-1">
            {['Upload', 'Preview & Map', 'Confirm'].map((label, i) => (
              <React.Fragment key={label}>
                <div className={`flex items-center gap-1.5 text-xs font-medium ${step === i+1 ? 'text-emerald-700' : step > i+1 ? 'text-slate-400' : 'text-slate-300'}`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${step === i+1 ? 'bg-emerald-600 text-white' : step > i+1 ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-300'}`}>{i+1}</div>
                  {label}
                </div>
                {i < 2 && <ChevronRight className="w-3 h-3 text-slate-200 flex-shrink-0 mx-1" />}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* ── Step 1: Upload ── */}
          {step === 1 && (<>
            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={e => { e.preventDefault(); setIsDragging(false); parseFile(e.dataTransfer.files[0]); }}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${isDragging ? 'border-emerald-400 bg-emerald-50' : fileName ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}
            >
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => parseFile(e.target.files[0])} />
              {fileName ? (
                <div className="flex flex-col items-center gap-2">
                  <FileText className="w-10 h-10 text-emerald-600" />
                  <p className="font-semibold text-emerald-700">{fileName}</p>
                  <p className="text-sm text-emerald-600">{rawRows.length} data row{rawRows.length !== 1 ? 's' : ''} detected</p>
                  <p className="text-xs text-slate-400">Click to change file</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="w-10 h-10 text-slate-300" />
                  <p className="font-medium text-slate-600">Drop your file here or click to browse</p>
                  <p className="text-sm text-slate-400">Accepts .csv, .xlsx, .xls</p>
                </div>
              )}
            </div>

            {parseError && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />{parseError}
              </div>
            )}
            {multiSheetWarn && (
              <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />Multiple sheets detected — only the first sheet will be imported.
              </div>
            )}

            {/* Template */}
            <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm">
              <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <span className="text-slate-600">Need a starting point?</span>
              <button onClick={downloadTemplate} className="ml-auto text-emerald-600 hover:text-emerald-700 font-medium underline underline-offset-2 text-sm">Download template</button>
            </div>

            {/* Expected columns */}
            <div>
              <p className="text-sm font-medium text-slate-700 mb-2">Expected columns</p>
              <div className="flex flex-wrap gap-1.5">
                {EXPECTED_FIELDS.map(f => (
                  <span key={f.key} className={`px-2 py-0.5 text-xs rounded-full font-mono ${f.required ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500'}`}>
                    {f.key}{f.required ? ' *' : ''}
                  </span>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-1.5">* required &nbsp;·&nbsp; tip: last-octet-only IPs (e.g. <span className="font-mono">200</span>) are auto-expanded to your subnet</p>
            </div>
          </>)}

          {/* ── Step 2: Preview & Map ── */}
          {step === 2 && (<>
            {/* Column mapping */}
            <div>
              <p className="text-sm font-semibold text-slate-700 mb-3">Column mapping</p>
              <div className="grid grid-cols-2 gap-2">
                {EXPECTED_FIELDS.map(field => (
                  <div key={field.key} className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${columnMap[field.key] ? 'bg-emerald-500' : field.required ? 'bg-red-400' : 'bg-slate-200'}`} />
                    <span className="text-xs text-slate-600 w-28 flex-shrink-0">{field.label}{field.required ? ' *' : ''}</span>
                    <select
                      value={columnMap[field.key] || ''}
                      onChange={e => setColumnMap(m => { const n = { ...m }; e.target.value ? n[field.key] = e.target.value : delete n[field.key]; return n; })}
                      className={`flex-1 min-w-0 ${inputCls}`}
                    >
                      <option value="">— not mapped —</option>
                      {rawHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              {!hasRequired && <p className="text-xs text-red-500 mt-2">Please map all required (*) columns before continuing.</p>}
            </div>

            {/* Preview table */}
            <div>
              <p className="text-sm font-semibold text-slate-700 mb-2">Preview <span className="font-normal text-slate-400">(first 5 rows)</span></p>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>{rawHeaders.map(h => <th key={h} className="px-3 py-2 text-left font-medium text-slate-500 whitespace-nowrap">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rawRows.slice(0, 5).map((row, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        {rawHeaders.map(h => <td key={h} className="px-3 py-2 text-slate-600 max-w-[8rem] truncate">{row[h]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rawRows.length > 5 && <p className="text-xs text-slate-400 mt-1">…and {rawRows.length - 5} more rows</p>}
            </div>
          </>)}

          {/* ── Step 3: Confirm ── */}
          {step === 3 && (<>
            {/* Summary */}
            <div className={`p-4 rounded-xl border ${readyRows.length > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
              <div className="flex items-center gap-3">
                <CheckCircle className={`w-8 h-8 flex-shrink-0 ${readyRows.length > 0 ? 'text-emerald-600' : 'text-red-400'}`} />
                <div>
                  <p className="font-semibold text-slate-800">
                    {readyRows.length} row{readyRows.length !== 1 ? 's' : ''} ready to import
                    {skippedRows.length > 0 && <span className="text-red-600">, {skippedRows.length} skipped</span>}
                  </p>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {skippedRows.length > 0 ? 'Rows with errors will be skipped — valid rows will still import.' : 'All rows validated successfully.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Skipped rows */}
            {skippedRows.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-slate-700 mb-2">Skipped rows</p>
                <div className="space-y-1 max-h-28 overflow-y-auto">
                  {skippedRows.map((row, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs p-2 bg-red-50 border border-red-100 rounded-lg">
                      <span className="text-red-400 font-mono font-medium flex-shrink-0">Row {row._row}</span>
                      <span className="text-red-600">{row._errors.join(' · ')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Warnings */}
            {warnRows.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-slate-700 mb-2">Warnings <span className="font-normal text-slate-400">(these rows will still import)</span></p>
                <div className="space-y-1 max-h-24 overflow-y-auto">
                  {warnRows.map((row, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs p-2 bg-amber-50 border border-amber-100 rounded-lg">
                      <span className="text-amber-600 font-mono font-medium flex-shrink-0">Row {row._row}</span>
                      <span className="text-amber-700 font-mono">{row.ip}</span>
                      <span className="text-amber-600">{row._warnings.join(' · ')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Import mode */}
            <div>
              <p className="text-sm font-semibold text-slate-700 mb-3">Import mode</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: 'merge',   label: 'Merge',   desc: 'Add new IPs and update existing ones matched by IP address. Everything else is kept.' },
                  { value: 'replace', label: 'Replace', desc: 'Wipe current data and load fresh from this file. Use with caution.' },
                ].map(opt => (
                  <button key={opt.value} type="button" onClick={() => setImportMode(opt.value)}
                    className={`p-3 rounded-xl border-2 text-left transition-all ${importMode === opt.value
                      ? (opt.value === 'replace' ? 'border-rose-400 bg-rose-50' : 'border-emerald-400 bg-emerald-50')
                      : 'border-slate-200 hover:border-slate-300 bg-white'}`}
                  >
                    <p className={`font-semibold text-sm ${importMode === opt.value ? (opt.value === 'replace' ? 'text-rose-700' : 'text-emerald-700') : 'text-slate-700'}`}>{opt.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{opt.desc}</p>
                  </button>
                ))}
              </div>
              {importMode === 'replace' && (
                <div className="flex items-center gap-2 p-3 mt-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-700">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />This will permanently overwrite all current IP data.
                </div>
              )}
            </div>
          </>)}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-200 flex-shrink-0 flex items-center justify-between">
          <button onClick={step === 1 ? onClose : () => setStep(s => s - 1)}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            {step === 1 ? 'Cancel' : '← Back'}
          </button>
          <div className="flex items-center gap-2">
            {step === 1 && (
              <button disabled={!fileName || rawRows.length === 0} onClick={() => setStep(2)}
                className="px-5 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-lg transition-colors">
                Next: Preview →
              </button>
            )}
            {step === 2 && (
              <button disabled={!hasRequired} onClick={validateAndAdvance}
                className="px-5 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-lg transition-colors">
                Next: Review →
              </button>
            )}
            {step === 3 && (
              <button disabled={readyRows.length === 0} onClick={doImport}
                className={`px-5 py-2 text-sm font-semibold rounded-lg transition-colors text-white disabled:bg-slate-200 disabled:text-slate-400 ${importMode === 'replace' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                {importMode === 'replace' ? 'Replace All Data' : `Import ${readyRows.length} Row${readyRows.length !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// Bulk Edit Modal

export default ImportModal;
