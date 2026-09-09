import React from 'react';
import { useState } from 'react';
import { Wifi, X, ChevronDown, AlertCircle, AlertTriangle, CheckCircle, ChevronRight } from 'lucide-react';
import { useModalA11y, isInDHCPRange } from '../shared/common';

function ARPScanModal({ onClose, onImport, subnet, networkConfig }) {
  const modalRef = useModalA11y(typeof onClose === 'function' ? onClose : null);
  const [step, setStep]             = useState(1); // 1 = config, 2 = results
  const [scanSubnet, setScanSubnet] = useState(subnet); // editable copy
  const [iface, setIface]           = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [scanning, setScanning]     = useState(false);
  const [scanError, setScanError]   = useState('');
  const [results, setResults]       = useState([]);
  const [method, setMethod]         = useState('');
  const [scanWarning, setScanWarning] = useState(null);
  const [selected, setSelected]     = useState(new Set());

  const startScan = async () => {
    if (!scanSubnet.trim()) return setScanError('Please enter a subnet to scan.');
    setScanError('');
    setScanWarning(null);
    setScanning(true);
    try {
      const res = await fetch('/api/arp/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subnet: scanSubnet.trim(), interface: iface.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setScanError(data.error || 'Scan failed'); setScanning(false); return; }
      // Upgrade 'Untracked' → 'DHCP' or 'Static' using the network config
      const classified = (data.results || []).map(r => {
        if (r.status !== 'Untracked') return r;
        const inDhcp = networkConfig && networkConfig.dhcpEnabled !== false
          && isInDHCPRange(r.ip, networkConfig);
        return { ...r, status: inDhcp ? 'DHCP' : 'Static' };
      });
      setResults(classified);
      setMethod(data.method || 'arp-scan');
      setScanWarning(data.scanWarning || null);
      // Pre-select Static untracked only — DHCP addresses deselected by default
      const preselect = new Set(classified.filter(r => r.status === 'Static' || r.status === 'OutOfRange').map(r => r.ip));
      setSelected(preselect);
      setStep(2);
    } catch (err) {
      setScanError('Could not reach the server: ' + err.message);
    } finally {
      setScanning(false);
    }
  };

  const toggleRow = (ip) => setSelected(prev => {
    const n = new Set(prev);
    n.has(ip) ? n.delete(ip) : n.add(ip);
    return n;
  });

  const toggleAll = () => {
    const importable = results.filter(r => r.status !== 'Tracked');
    if (selected.size === importable.length) setSelected(new Set());
    else setSelected(new Set(importable.map(r => r.ip)));
  };

  const selectStaticOnly = () => {
    setSelected(new Set(results.filter(r => r.status === 'Static').map(r => r.ip)));
  };

  const doImport = () => {
    const rows = results
      .filter(r => selected.has(r.ip))
      .map(r => ({
        ip:        r.ip,
        assetName: r.hostname || r.mac,
        hostname:  r.hostname,
        notes:     `MAC: ${r.mac} | Vendor: ${r.vendor}`,
        type:      'Physical',
        tags:      ['arp-scan'],
      }));
    onImport(rows, 'merge');
    onClose();
  };

  const tracked    = results.filter(r => r.status === 'Tracked');
  const staticIPs  = results.filter(r => r.status === 'Static');
  const dhcpIPs    = results.filter(r => r.status === 'DHCP');
  const outRange   = results.filter(r => r.status === 'OutOfRange');
  const importable = results.filter(r => r.status !== 'Tracked');

  const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent';

  const statusBadge = (status) => {
    if (status === 'Tracked') return <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">✓ Tracked</span>;
    if (status === 'Static')  return <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">◯ Static</span>;
    if (status === 'DHCP')    return <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">~ DHCP</span>;
    return <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-500">⊘ Out of range</span>;
  };

  return (
    <div ref={modalRef} role="dialog" aria-modal="true" aria-label="ARP network scan" tabIndex={-1}
         className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 outline-none" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="p-6 border-b border-slate-200 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Wifi className="w-5 h-5 text-teal-600" />
                ARP Network Scan
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">
                {step === 1
                  ? `Scan your network for active devices`
                  : `Found ${results.length} device${results.length !== 1 ? 's' : ''} — ${staticIPs.length} static untracked, ${dhcpIPs.length} DHCP`}
              </p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-500" /></button>
          </div>
          <div className="flex items-center gap-1">
            {['Configure', 'Review & Import'].map((label, i) => (
              <React.Fragment key={label}>
                <div className={`flex items-center gap-1.5 text-xs font-medium ${step === i+1 ? 'text-teal-700' : step > i+1 ? 'text-slate-400' : 'text-slate-300'}`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${step === i+1 ? 'bg-teal-600 text-white' : step > i+1 ? 'bg-teal-100 text-teal-600' : 'bg-slate-100 text-slate-300'}`}>{i+1}</div>
                  {label}
                </div>
                {i < 1 && <ChevronRight className="w-3 h-3 text-slate-200 flex-shrink-0 mx-1" />}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* ── Step 1: Configure ── */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Subnet to scan</label>
                <input type="text" value={scanSubnet} onChange={e => setScanSubnet(e.target.value)}
                  className={inputCls + ' font-mono'} placeholder="e.g. 192.168.0 or 192.168.0.0/24"
                  onKeyDown={e => e.key === 'Enter' && !scanning && startScan()} />
                <p className="text-xs text-slate-400 mt-1">Pre-filled from your network settings — change if you want to scan a different subnet.</p>
              </div>

              <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 text-xs text-teal-800 space-y-1">
                <p className="font-semibold">How it works</p>
                <p>Sends a single ARP broadcast packet to each IP in your subnet — very lightweight (~15 KB for a /24). Returns each device's MAC address and, where resolvable, its hostname.</p>
              </div>

              {/* Advanced options */}
              <div>
                <button type="button" onClick={() => setShowAdvanced(v => !v)}
                  className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
                  <ChevronDown className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                  Advanced options
                </button>
                {showAdvanced && (
                  <div className="mt-3">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Network Interface <span className="text-slate-400 font-normal">(optional)</span></label>
                    <input type="text" value={iface} onChange={e => setIface(e.target.value)}
                      className={inputCls} placeholder="e.g. eth0, enp3s0 — leave blank for auto"
                      onKeyDown={e => e.key === 'Enter' && !scanning && startScan()} />
                    <p className="text-xs text-slate-400 mt-1">Only needed if your server has multiple network interfaces. Leave blank for automatic selection.</p>
                  </div>
                )}
              </div>

              {scanError && (
                <div className="flex items-start gap-2 text-red-600 text-sm bg-red-50 px-3 py-2 rounded-lg">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />{scanError}
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Results ── */}
          {step === 2 && (
            <div className="space-y-4">

              {/* ARP cache fallback warning — shown when arp-scan failed */}
              {scanWarning && (
                <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-300 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-semibold text-amber-800">Results from kernel ARP cache — not a live scan</p>
                    <p className="text-amber-700 mt-0.5 text-xs">{scanWarning}</p>
                    <p className="text-amber-600 mt-1 text-xs">These are only devices that have recently communicated with the server — most devices on your network will be missing. Fix the permissions on the server and scan again for complete results.</p>
                  </div>
                </div>
              )}

              {/* Summary chips */}
              <div className="flex gap-2 flex-wrap text-xs">
                <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-lg font-medium">{tracked.length} tracked</span>
                {staticIPs.length > 0 && <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-lg font-medium">{staticIPs.length} static untracked</span>}
                {dhcpIPs.length > 0 && <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-lg font-medium">{dhcpIPs.length} DHCP</span>}
                {outRange.length > 0 && <span className="px-2 py-1 bg-slate-100 text-slate-500 rounded-lg font-medium">{outRange.length} out of range</span>}
                <span className={`px-2 py-1 rounded-lg ${method === 'arp-cache' ? 'bg-amber-100 text-amber-600 font-medium' : 'bg-slate-50 text-slate-400'}`}>via {method}</span>
              </div>

              {/* DHCP info note */}
              {dhcpIPs.length > 0 && (
                <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
                  <AlertCircle className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                  <span><strong>{dhcpIPs.length} DHCP address{dhcpIPs.length !== 1 ? 'es' : ''}</strong> found in your DHCP pool — these are deselected by default as they may be temporary leases. Tick them if you want to record them.</span>
                </div>
              )}

              {/* Results table */}
              {results.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-slate-700">{importable.length} importable device{importable.length !== 1 ? 's' : ''}</p>
                    {importable.length > 0 && (
                      <div className="flex gap-3 text-xs">
                        {dhcpIPs.length > 0 && staticIPs.length > 0 && (
                          <button onClick={selectStaticOnly} className="text-teal-600 hover:underline">Static only</button>
                        )}
                        <button onClick={toggleAll} className="text-teal-600 hover:underline">
                          {selected.size === importable.length ? 'Deselect all' : 'Select all'}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-500 font-medium">
                        <tr>
                          <th className="px-3 py-2 w-8"></th>
                          <th className="px-3 py-2 text-left">IP</th>
                          <th className="px-3 py-2 text-left">MAC</th>
                          <th className="px-3 py-2 text-left">Vendor</th>
                          <th className="px-3 py-2 text-left">Hostname</th>
                          <th className="px-3 py-2 text-left">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {results.map(r => {
                          const isTracked = r.status === 'Tracked';
                          const isSelected = selected.has(r.ip);
                          return (
                            <tr key={r.ip} className={isSelected ? 'bg-teal-50' : isTracked ? 'bg-slate-50' : 'bg-white'}>
                              <td className="px-3 py-2">
                                {!isTracked && (
                                  <input type="checkbox" checked={isSelected}
                                    onChange={() => toggleRow(r.ip)}
                                    className="rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
                                )}
                              </td>
                              <td className="px-3 py-2 font-mono text-slate-700">{r.ip}</td>
                              <td className="px-3 py-2 font-mono text-slate-500">{r.mac}</td>
                              <td className="px-3 py-2 text-slate-500 max-w-[120px] truncate" title={r.vendor}>{r.vendor}</td>
                              <td className="px-3 py-2 text-slate-600">{r.hostname || <span className="text-slate-300">—</span>}</td>
                              <td className="px-3 py-2">{statusBadge(r.status)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500 text-center py-4">No devices found on the network.</p>
              )}

              {selected.size > 0 && (
                <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 text-xs text-teal-700">
                  Selected devices will be imported with type <strong>Physical</strong>, tagged <strong>arp-scan</strong>, and merged with any existing entries at the same IP.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 flex-shrink-0 flex justify-between items-center">
          {step === 2
            ? <button onClick={() => setStep(1)} className="text-sm text-slate-500 hover:text-slate-700">← Back</button>
            : <div />}
          {step === 1 ? (
            <button onClick={startScan} disabled={scanning}
              className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors">
              {scanning && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {scanning ? 'Scanning…' : 'Start Scan'}
            </button>
          ) : (
            <button onClick={doImport} disabled={selected.size === 0}
              className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors">
              <CheckCircle className="w-4 h-4" />
              Import {selected.size} {selected.size === 1 ? 'device' : 'devices'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Login screen ──────────────────────────────────────────────────────────────

export default ARPScanModal;
