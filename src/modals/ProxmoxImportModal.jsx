import React from 'react';
import { useState } from 'react';
import { Server, X, AlertCircle, CheckCircle, ChevronRight, HelpCircle } from 'lucide-react';
import { useModalA11y } from '../shared/common';

function ProxmoxImportModal({ onClose, onImport }) {
  const modalRef = useModalA11y(typeof onClose === 'function' ? onClose : null);
  const [step, setStep]           = useState(1); // 1 = connect, 2 = preview
  const [host, setHost]           = useState('');
  const [apiToken, setApiToken]   = useState('');
  const [ignoreTls, setIgnoreTls] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState('');
  const [entries, setEntries]     = useState([]);   // entries with IPs
  const [noIp, setNoIp]           = useState([]);   // entries without IPs
  const [selected, setSelected]   = useState(new Set());
  const [importMode, setImportMode] = useState('merge');
  const [showProxmoxHelp, setShowProxmoxHelp] = useState(false);

  const discover = async () => {
    setDiscoverError('');
    setDiscovering(true);
    try {
      const res = await fetch('/api/proxmox/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, apiToken, ignoreTls }),
      });
      const data = await res.json();
      if (!res.ok) { setDiscoverError(data.error || 'Discovery failed'); return; }
      setEntries(data.entries || []);
      setNoIp(data.noIp || []);
      setSelected(new Set((data.entries || []).map(e => e.ip)));
      setStep(2);
    } catch (err) {
      setDiscoverError('Could not reach the server: ' + err.message);
    } finally {
      setDiscovering(false);
    }
  };

  const toggleAll = () => {
    if (selected.size === entries.length) setSelected(new Set());
    else setSelected(new Set(entries.map(e => e.ip)));
  };

  const doImport = () => {
    const rows = entries.filter(e => selected.has(e.ip));
    onImport(rows, importMode);
    onClose();
  };

  const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent';

  return (
    <div ref={modalRef} role="dialog" aria-modal="true" aria-label="Import from Proxmox" tabIndex={-1}
         className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 outline-none" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="p-6 border-b border-slate-200 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Server className="w-5 h-5 text-purple-600" />
                Import from Proxmox
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">
                {step === 1 ? 'Connect to your Proxmox host to discover VMs and LXC containers'
                            : `Found ${entries.length} entries with IPs${noIp.length ? `, ${noIp.length} without` : ''}`}
              </p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-500" /></button>
          </div>
          <div className="flex items-center gap-1">
            {['Connect', 'Preview & Import'].map((label, i) => (
              <React.Fragment key={label}>
                <div className={`flex items-center gap-1.5 text-xs font-medium ${step === i+1 ? 'text-purple-700' : step > i+1 ? 'text-slate-400' : 'text-slate-300'}`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${step === i+1 ? 'bg-purple-600 text-white' : step > i+1 ? 'bg-purple-100 text-purple-600' : 'bg-slate-100 text-slate-300'}`}>{i+1}</div>
                  {label}
                </div>
                {i < 1 && <ChevronRight className="w-3 h-3 text-slate-200 flex-shrink-0 mx-1" />}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* ── Step 1: Connect ── */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Proxmox Host</label>
                <input type="text" value={host} onChange={e => setHost(e.target.value)}
                  className={inputCls} placeholder="192.168.0.2 or pve.home.lab or 192.168.0.2:8006"
                  onKeyDown={e => e.key === 'Enter' && host && apiToken && discover()} />
                <p className="text-xs text-slate-400 mt-1">IP or hostname — port defaults to 8006</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">API Token</label>
                <input type="password" value={apiToken} onChange={e => setApiToken(e.target.value)}
                  className={inputCls} placeholder="root@pam!ipmanager=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  onKeyDown={e => e.key === 'Enter' && host && apiToken && discover()} />
                <p className="text-xs text-slate-400 mt-1">
                  Format: <code className="font-mono bg-slate-100 px-1 rounded">USER@REALM!TOKENID=SECRET</code>
                  &nbsp;&mdash; e.g. <code className="font-mono bg-slate-100 px-1 rounded">root@pam!ipmanager=abc123…</code>
                </p>
              </div>

              {/* ── Collapsible setup guide ── */}
              <div className="rounded-lg border border-purple-200 bg-purple-50 overflow-hidden">
                <button type="button"
                  onClick={() => setShowProxmoxHelp(h => !h)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-purple-100 transition-colors">
                  <span className="text-sm font-semibold text-purple-800 flex items-center gap-2">
                    <HelpCircle className="w-4 h-4 text-purple-500" />
                    How to create a Proxmox API token
                  </span>
                  <ChevronRight className={`w-4 h-4 text-purple-400 transition-transform ${showProxmoxHelp ? 'rotate-90' : ''}`} />
                </button>
                {showProxmoxHelp && (
                  <div className="px-4 pb-4 space-y-3 text-xs text-purple-900">
                    <div>
                      <p className="font-semibold text-purple-700 mb-1">Step 1 — Create the API token</p>
                      <ol className="space-y-1 list-decimal list-inside text-purple-800">
                        <li>In the Proxmox web UI, go to <strong>Datacenter → Permissions → API Tokens</strong></li>
                        <li>Click <strong>Add</strong></li>
                        <li>Set <strong>User</strong> to <code className="font-mono bg-purple-100 px-1 rounded">root@pam</code> (or any Proxmox user)</li>
                        <li>Set <strong>Token ID</strong> to something memorable, e.g. <code className="font-mono bg-purple-100 px-1 rounded">ipmanager</code></li>
                        <li>Leave <strong>Privilege Separation</strong> <em>unchecked</em> — this lets the token inherit the user's permissions without extra role steps</li>
                        <li>Click <strong>Add</strong> — <strong>copy the secret immediately</strong>, it will not be shown again</li>
                      </ol>
                    </div>
                    <div>
                      <p className="font-semibold text-purple-700 mb-1">Step 2 — Assign the role (only if Privilege Separation is ON)</p>
                      <ol className="space-y-1 list-decimal list-inside text-purple-800">
                        <li>Go to <strong>Datacenter → Permissions → Add → API Token Permission</strong></li>
                        <li>Set Path to <code className="font-mono bg-purple-100 px-1 rounded">/</code></li>
                        <li>Select your token, set Role to <strong>PVEAuditor</strong></li>
                        <li>Click <strong>Add</strong></li>
                      </ol>
                    </div>
                    <div>
                      <p className="font-semibold text-purple-700 mb-1">Token format</p>
                      <code className="block font-mono bg-purple-100 px-2 py-1 rounded text-purple-800">USER@REALM!TOKENID=SECRET-UUID</code>
                      <code className="block font-mono bg-purple-100 px-2 py-1 rounded text-purple-800 mt-1">root@pam!ipmanager=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</code>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded p-2 text-amber-800">
                      <strong>VMs not showing an IP?</strong> Install and enable the <strong>QEMU guest agent</strong> inside the VM — Proxmox needs it to read the IP. LXC containers report IPs automatically.
                    </div>
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={ignoreTls} onChange={e => setIgnoreTls(e.target.checked)}
                  className="rounded border-slate-300 text-purple-600 focus:ring-purple-500" />
                <span className="text-sm text-slate-700">Ignore TLS certificate errors</span>
                <span className="text-xs text-slate-400">(required for self-signed certs)</span>
              </label>
              {discoverError && (
                <div className="flex items-start gap-2 text-red-600 text-sm bg-red-50 px-3 py-2 rounded-lg">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />{discoverError}
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Preview ── */}
          {step === 2 && (
            <div className="space-y-4">
              {/* Entries with IPs */}
              {entries.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-slate-700">{entries.length} entries ready to import</p>
                    <button onClick={toggleAll} className="text-xs text-purple-600 hover:underline">
                      {selected.size === entries.length ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-500 font-medium">
                        <tr>
                          <th className="px-3 py-2 w-8"></th>
                          <th className="px-3 py-2 text-left">Name</th>
                          <th className="px-3 py-2 text-left">Type</th>
                          <th className="px-3 py-2 text-left">IP</th>
                          <th className="px-3 py-2 text-left">Node</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {entries.map(e => (
                          <tr key={e.ip} className={selected.has(e.ip) ? 'bg-purple-50' : 'bg-white'}>
                            <td className="px-3 py-2">
                              <input type="checkbox" checked={selected.has(e.ip)}
                                onChange={() => setSelected(prev => {
                                  const n = new Set(prev);
                                  n.has(e.ip) ? n.delete(e.ip) : n.add(e.ip);
                                  return n;
                                })}
                                className="rounded border-slate-300 text-purple-600 focus:ring-purple-500" />
                            </td>
                            <td className="px-3 py-2 font-medium text-slate-800">{e.assetName}</td>
                            <td className="px-3 py-2">
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${e.type === 'LXC' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'}`}>{e.type}</span>
                            </td>
                            <td className="px-3 py-2 font-mono text-slate-600">{e.ip}</td>
                            <td className="px-3 py-2 text-slate-500">{e.location}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Entries without IPs */}
              {noIp.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs font-semibold text-amber-700 mb-2">
                    {noIp.length} {noIp.length === 1 ? 'entry' : 'entries'} skipped — no IP found
                  </p>
                  <p className="text-xs text-amber-600 mb-2">
                    VMs require the QEMU guest agent to report IPs. Stopped containers may also not report interfaces.
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {noIp.map(e => (
                      <span key={`${e._vmid}-${e._node}`} className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-mono">
                        {e.assetName}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {entries.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-4">No entries with IP addresses were found.</p>
              )}

              {/* Import mode */}
              <div className="flex gap-3 pt-2">
                {['merge', 'replace'].map(mode => (
                  <label key={mode} className={`flex-1 flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${importMode === mode ? 'border-purple-500 bg-purple-50' : 'border-slate-200 hover:border-slate-300'}`}>
                    <input type="radio" name="importMode" value={mode} checked={importMode === mode}
                      onChange={() => setImportMode(mode)} className="mt-0.5 text-purple-600 focus:ring-purple-500" />
                    <div>
                      <p className="text-sm font-semibold text-slate-800 capitalize">{mode}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {mode === 'merge' ? 'Add new entries; update existing ones matched by IP. Safe for incremental syncs.' : 'Replace all entries in this network with Proxmox data. Use with caution.'}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 flex-shrink-0 flex justify-between items-center">
          {step === 2
            ? <button onClick={() => setStep(1)} className="text-sm text-slate-500 hover:text-slate-700">← Back</button>
            : <div />}
          {step === 1 ? (
            <button onClick={discover} disabled={!host || !apiToken || discovering}
              className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors">
              {discovering && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {discovering ? 'Discovering…' : 'Discover VMs & LXCs'}
            </button>
          ) : (
            <button onClick={doImport} disabled={selected.size === 0}
              className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors">
              <CheckCircle className="w-4 h-4" />
              Import {selected.size} {selected.size === 1 ? 'entry' : 'entries'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── CIDR Calculator ──────────────────────────────────────────────────────────
// Pure client-side; no server calls needed.

export default ProxmoxImportModal;
