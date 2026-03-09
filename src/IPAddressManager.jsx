import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, Server, Monitor, Wifi, HardDrive, Camera, Shield, Globe, Filter, X, MapPin, Cpu, Box, CircleDot, ChevronDown, ChevronUp, Copy, Check, Zap, Download, Edit3, Plus, Trash2, Save, AlertCircle, Settings, Upload, FileText, AlertTriangle, CheckCircle, ChevronRight, Tag, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import * as XLSX from 'xlsx';

// Default network configuration (overridden by Settings modal / localStorage)
const DEFAULT_NETWORK_CONFIG = {
  id: 'net-1',
  networkName: "Home Network",
  subnet: "192.168.0",
  dhcpStart: 1,
  dhcpEnd: 170,
  staticStart: 171,
  staticEnd: 254,
  fixedInDHCP: [6, 50],
};

// Load saved config from localStorage, falling back to defaults (kept for migration)
function loadNetworkConfig() {
  try {
    const saved = localStorage.getItem('ip-manager-network-config');
    if (saved) return { ...DEFAULT_NETWORK_CONFIG, ...JSON.parse(saved) };
  } catch {}
  return { ...DEFAULT_NETWORK_CONFIG };
}

// Load networks array from localStorage; migrates old single-config format automatically
function loadNetworks() {
  try {
    const saved = localStorage.getItem('ip-manager-networks');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
    // Migrate: wrap old single network config in an array
    const old = loadNetworkConfig();
    return [{ ...DEFAULT_NETWORK_CONFIG, ...old, id: old.id || 'net-1' }];
  } catch {}
  return [{ ...DEFAULT_NETWORK_CONFIG }];
}

// Load / save UI display preferences (browser-local, not synced to API)
const DEFAULT_UI_PREFS = { showFreeInList: true };
function loadUiPrefs() {
  try {
    const saved = localStorage.getItem('ip-manager-ui-prefs');
    if (saved) return { ...DEFAULT_UI_PREFS, ...JSON.parse(saved) };
  } catch {}
  return { ...DEFAULT_UI_PREFS };
}

// Format an ISO date string into a short readable date (e.g. "5 Mar 2026")
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Settings Modal Component
function SettingsModal({ config, onSave, onClose, onClear, locations, onRenameLocation, onDeleteLocation, canDeleteNetwork, onDeleteNetwork, showFreeInList, onToggleShowFreeInList, ipData, networks, onRestore }) {
  const [form, setForm] = useState({
    networkName: config.networkName,
    subnet: config.subnet,
    dhcpStart: config.dhcpStart,
    dhcpEnd: config.dhcpEnd,
    staticStart: config.staticStart,
    staticEnd: config.staticEnd,
    fixedInDHCP: config.fixedInDHCP.join(', '),
  });
  const [error, setError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDeleteNetwork, setConfirmDeleteNetwork] = useState(false);
  const [editingLoc, setEditingLoc] = useState(null); // { old, draft }
  const [newLocation, setNewLocation] = useState('');
  const [restoreError, setRestoreError] = useState('');
  const [restorePreview, setRestorePreview] = useState(null); // { networks, ipData, exportedAt }
  const [confirmRestore, setConfirmRestore] = useState(false);
  const restoreFileRef = useRef(null);

  // Account / change-password state
  const [pwForm, setPwForm] = useState({ currentPassword: '', newUsername: '', newPassword: '', confirmPassword: '' });
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwError('');
    setPwSuccess(false);
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      return setPwError('New passwords do not match');
    }
    if (pwForm.newPassword.length < 4) {
      return setPwError('New password must be at least 4 characters');
    }
    if (!pwForm.newUsername.trim()) {
      return setPwError('Username cannot be blank');
    }
    setPwLoading(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: pwForm.currentPassword,
          newUsername: pwForm.newUsername.trim(),
          newPassword: pwForm.newPassword,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setPwSuccess(true);
        // Server cleared all sessions — reload to show login screen
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setPwError(data.error || 'Failed to update credentials');
      }
    } catch {
      setPwError('Could not reach the server');
    } finally {
      setPwLoading(false);
    }
  };

  // ── Backup download ──────────────────────────────────────────────────────────
  const handleDownloadBackup = () => {
    const backup = {
      version: '1.8',
      exportedAt: new Date().toISOString(),
      networks: networks || [],
      ipData: ipData || [],
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ip-manager-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Restore from file ────────────────────────────────────────────────────────
  const handleRestoreFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoreError('');
    setRestorePreview(null);
    setConfirmRestore(false);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!Array.isArray(parsed.networks) || !Array.isArray(parsed.ipData)) {
          setRestoreError('Invalid backup file — missing networks or ipData arrays.');
          return;
        }
        setRestorePreview(parsed);
        setConfirmRestore(true);
      } catch {
        setRestoreError('Could not read backup file. Make sure it is a valid .json backup.');
      }
    };
    reader.readAsText(file);
    // Reset file input so the same file can be re-selected
    e.target.value = '';
  };

  const handleConfirmRestore = () => {
    if (!restorePreview) return;
    onRestore(restorePreview.networks, restorePreview.ipData);
    setConfirmRestore(false);
    setRestorePreview(null);
  };

  const handleSave = (e) => {
    e.preventDefault();
    setError('');

    // Normalise subnet: strip CIDR suffix and trailing .0 octets so users can
    // paste full network addresses — "172.16.0.0/16" → "172.16"
    const subnet = normaliseSubnet(form.subnet);

    // Update the form field to show the normalised value
    if (subnet !== form.subnet) setForm(f => ({ ...f, subnet }));

    const is16 = subnetOctetCount(subnet) === 2;
    const rangePattern = is16 ? /^\d{1,3}\.\d{1,3}$/ : /^\d{1,3}$/;
    const rangeHint    = is16 ? 'e.g. 2.20' : 'e.g. 1';

    if (!subnet.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/) && !subnet.match(/^\d{1,3}\.\d{1,3}$/))
      return setError('Enter a 2-octet prefix for /16 (e.g. 192.168) or 3-octet prefix for /24 (e.g. 192.168.1). You can also paste the full network address (e.g. 192.168.0.0) and trailing zeros will be stripped automatically.');
    if (!rangePattern.test(form.dhcpStart.trim()) || !rangePattern.test(form.dhcpEnd.trim()) ||
        !rangePattern.test(form.staticStart.trim()) || !rangePattern.test(form.staticEnd.trim()))
      return setError(`Range values must be in the format ${rangeHint} for a /${is16 ? '16' : '24'} network.`);

    const dhcpStart   = form.dhcpStart.trim();
    const dhcpEnd     = form.dhcpEnd.trim();
    const staticStart = form.staticStart.trim();
    const staticEnd   = form.staticEnd.trim();

    if (rangeOrdinal(dhcpStart, subnet) >= rangeOrdinal(dhcpEnd, subnet))
      return setError('DHCP start must be less than DHCP end.');
    if (rangeOrdinal(staticStart, subnet) >= rangeOrdinal(staticEnd, subnet))
      return setError('Static start must be less than static end.');

    const fixedInDHCP = form.fixedInDHCP
      .split(',')
      .map(s => s.trim())
      .filter(s => s && rangePattern.test(s));

    const newConfig = { networkName: form.networkName, subnet, dhcpStart, dhcpEnd, staticStart, staticEnd, fixedInDHCP };
    onSave(newConfig); // parent handles persistence (API or localStorage)
  };

  const f = (key) => ({ value: form[key], onChange: e => setForm(p => ({ ...p, [key]: e.target.value })) });
  const inputCls = "w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm";
  const labelCls = "block text-sm font-medium text-slate-700 mb-1";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-slate-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Settings className="w-5 h-5 text-slate-500" />
                Network Settings
              </h2>
              <p className="text-sm text-slate-500 mt-1">Configure to match your network layout</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-5">

          {/* Network identity */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Network Identity</p>
            <div>
              <label className={labelCls}>Network Name</label>
              <input type="text" className={inputCls} placeholder="e.g. Home Network" {...f('networkName')} />
            </div>
            <div>
              <label className={labelCls}>Subnet Prefix</label>
              <input type="text" className={inputCls} placeholder="e.g. 192.168.0.0 or 192.168.1 or 192.168" {...f('subnet')} />
              <p className="text-xs text-slate-400 mt-1">Paste your network address (e.g. <span className="font-mono">192.168.0.0</span>) or just the prefix — <span className="font-mono">192.168.1</span> for /24, <span className="font-mono">192.168</span> for /16. Trailing zeros are stripped automatically.</p>
            </div>
          </div>

          {/* DHCP range */}
          <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 space-y-4">
            <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider">⚡ DHCP Pool</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Start</label>
                <input type="text" className={inputCls} placeholder={subnetOctetCount(form.subnet) === 2 ? "e.g. 0.1" : "e.g. 1"} {...f('dhcpStart')} />
              </div>
              <div>
                <label className={labelCls}>End</label>
                <input type="text" className={inputCls} placeholder={subnetOctetCount(form.subnet) === 2 ? "e.g. 0.254" : "e.g. 170"} {...f('dhcpEnd')} />
              </div>
            </div>
          </div>

          {/* DHCP Reservations */}
          <div className="p-4 bg-blue-50 rounded-xl border border-blue-200 space-y-4">
            <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider">🔒 DHCP Reservations</p>
            <div>
              <label className={labelCls}>Reserved IPs (host portions)</label>
              <input type="text" className={inputCls} placeholder={subnetOctetCount(form.subnet) === 2 ? "e.g. 0.6, 0.50" : "e.g. 6, 50"} {...f('fixedInDHCP')} />
              <p className="text-xs text-slate-400 mt-1">Comma-separated host portions of IPs that have DHCP reservations. These can be anywhere on the network — inside or outside the DHCP pool.</p>
            </div>
          </div>

          {/* Static range */}
          <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200 space-y-4">
            <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">🖥 Static Range</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Start</label>
                <input type="text" className={inputCls} placeholder={subnetOctetCount(form.subnet) === 2 ? "e.g. 1.1" : "e.g. 171"} {...f('staticStart')} />
              </div>
              <div>
                <label className={labelCls}>End</label>
                <input type="text" className={inputCls} placeholder={subnetOctetCount(form.subnet) === 2 ? "e.g. 254.254" : "e.g. 254"} {...f('staticEnd')} />
              </div>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Preview — shows normalised subnet so user sees what will be saved */}
          {(() => { const ps = normaliseSubnet(form.subnet); return (
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs font-mono text-slate-500 space-y-1">
            <p><span className="text-slate-400">Network:    </span>{subnetCIDR(ps)}</p>
            <p><span className="text-slate-400">DHCP pool:  </span>{ps}.{form.dhcpStart} – {ps}.{form.dhcpEnd}</p>
            <p><span className="text-slate-400">Static range: </span>{ps}.{form.staticStart} – {ps}.{form.staticEnd}</p>
            {form.fixedInDHCP && <p><span className="text-slate-400">Fixed IPs:  </span>{form.fixedInDHCP.split(',').map(s => `${ps}.${s.trim()}`).join(', ')}</p>}
          </div>
          ); })()}

          <button
            type="submit"
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors"
          >
            <Save className="w-4 h-4" />
            Save Settings
          </button>

          {/* Display Preferences */}
          <div className="pt-2 border-t border-slate-200">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Display</p>
            <label className="flex items-center justify-between gap-3 cursor-pointer select-none group">
              <div>
                <p className="text-sm font-medium text-slate-700">Show free IP cards in main list</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Turn off if you have a large subnet (/16) — hiding free cards prevents thousands of entries from slowing down the page.
                </p>
              </div>
              <button
                type="button"
                onClick={onToggleShowFreeInList}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${showFreeInList ? 'bg-emerald-500' : 'bg-slate-300'}`}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${showFreeInList ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </label>
          </div>

          {/* Backup & Restore */}
          <div className="pt-2 border-t border-slate-200">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Backup & Restore</p>
            <p className="text-xs text-slate-500 mb-3">
              A full backup includes all IP entries, all network configs, tags, notes, and change history — everything needed to fully restore the app on a new machine.
            </p>

            {/* Download backup */}
            <button
              type="button"
              onClick={handleDownloadBackup}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-700 hover:bg-slate-800 text-white font-medium rounded-lg transition-colors text-sm mb-2"
            >
              <Download className="w-4 h-4" />
              Download Full Backup (.json)
            </button>

            {/* Restore from backup */}
            <input
              type="file"
              accept=".json"
              ref={restoreFileRef}
              onChange={handleRestoreFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => { setRestoreError(''); setConfirmRestore(false); restoreFileRef.current?.click(); }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-slate-300 text-slate-600 hover:bg-slate-50 font-medium rounded-lg transition-colors text-sm"
            >
              <Upload className="w-4 h-4" />
              Restore from Backup…
            </button>

            {restoreError && (
              <div className="mt-2 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                {restoreError}
              </div>
            )}

            {confirmRestore && restorePreview && (
              <div className="mt-3 space-y-2">
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                  <p className="font-semibold mb-1">Ready to restore backup</p>
                  <p className="text-xs text-amber-700">
                    {restorePreview.exportedAt ? `Exported: ${new Date(restorePreview.exportedAt).toLocaleString()}` : ''}
                    {' · '}{restorePreview.networks?.length || 0} network{restorePreview.networks?.length !== 1 ? 's' : ''}
                    {' · '}{restorePreview.ipData?.length || 0} IP entries
                  </p>
                  <p className="text-xs text-amber-600 mt-1">This will replace ALL current data. This cannot be undone.</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setConfirmRestore(false); setRestorePreview(null); }}
                    className="flex-1 px-4 py-2 border border-slate-300 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors text-sm font-medium">
                    Cancel
                  </button>
                  <button type="button" onClick={handleConfirmRestore}
                    className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors text-sm font-medium">
                    Yes, Restore Now
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Manage Locations */}
          <div className="pt-2 border-t border-slate-200">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Locations</p>
            <div className="flex flex-wrap gap-2 mb-2">
              {locations.filter(l => l).map(loc => (
                <div key={loc} className="flex items-center gap-1 bg-slate-100 rounded-lg px-2 py-1">
                  {editingLoc?.old === loc ? (
                    <>
                      <input
                        autoFocus
                        className="text-xs border border-blue-300 rounded px-1 py-0.5 w-28 outline-none"
                        value={editingLoc.draft}
                        onChange={e => setEditingLoc(ev => ({ ...ev, draft: e.target.value }))}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && editingLoc.draft.trim()) { onRenameLocation(loc, editingLoc.draft.trim()); setEditingLoc(null); }
                          if (e.key === 'Escape') setEditingLoc(null);
                        }}
                      />
                      <button type="button" onClick={() => { if (editingLoc.draft.trim()) { onRenameLocation(loc, editingLoc.draft.trim()); setEditingLoc(null); }}} className="text-blue-500 hover:text-blue-700 text-xs font-bold">✓</button>
                      <button type="button" onClick={() => setEditingLoc(null)} className="text-slate-400 hover:text-slate-600 text-xs">✕</button>
                    </>
                  ) : (
                    <>
                      <span className="text-xs text-slate-700">{loc}</span>
                      <button type="button" onClick={() => setEditingLoc({ old: loc, draft: loc })} className="text-slate-400 hover:text-blue-500 text-xs ml-1" title="Rename">✎</button>
                      <button type="button" onClick={() => onDeleteLocation(loc)} className="text-slate-400 hover:text-red-500 text-xs" title="Remove from all entries">✕</button>
                    </>
                  )}
                </div>
              ))}
              {locations.filter(l => l).length === 0 && (
                <p className="text-xs text-slate-400">No locations yet — add one below or import data.</p>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-1.5 outline-none focus:border-teal-400"
                placeholder="Add a new location…"
                value={newLocation}
                onChange={e => setNewLocation(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newLocation.trim()) { onRenameLocation(null, newLocation.trim()); setNewLocation(''); }
                }}
              />
              <button
                type="button"
                disabled={!newLocation.trim()}
                onClick={() => { onRenameLocation(null, newLocation.trim()); setNewLocation(''); }}
                className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors"
              >Add</button>
            </div>
          </div>

          {/* Account */}
          <div className="pt-2 border-t border-slate-200">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Account</p>
            <form onSubmit={handleChangePassword} className="space-y-3">
              <div>
                <label className={labelCls}>Current Password</label>
                <input type="password" autoComplete="current-password" value={pwForm.currentPassword}
                  onChange={e => setPwForm(f => ({ ...f, currentPassword: e.target.value }))}
                  className={inputCls} placeholder="Enter current password" />
              </div>
              <div>
                <label className={labelCls}>New Username</label>
                <input type="text" autoComplete="username" value={pwForm.newUsername}
                  onChange={e => setPwForm(f => ({ ...f, newUsername: e.target.value }))}
                  className={inputCls} placeholder="New username" />
              </div>
              <div>
                <label className={labelCls}>New Password</label>
                <input type="password" autoComplete="new-password" value={pwForm.newPassword}
                  onChange={e => setPwForm(f => ({ ...f, newPassword: e.target.value }))}
                  className={inputCls} placeholder="New password (min 4 chars)" />
              </div>
              <div>
                <label className={labelCls}>Confirm New Password</label>
                <input type="password" autoComplete="new-password" value={pwForm.confirmPassword}
                  onChange={e => setPwForm(f => ({ ...f, confirmPassword: e.target.value }))}
                  className={inputCls} placeholder="Repeat new password" />
              </div>
              {pwError && (
                <p className="text-red-600 text-sm flex items-center gap-1">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />{pwError}
                </p>
              )}
              {pwSuccess && (
                <p className="text-emerald-600 text-sm">✓ Credentials updated — signing you out…</p>
              )}
              <button type="submit" disabled={pwLoading || pwSuccess}
                className="w-full bg-slate-700 hover:bg-slate-800 disabled:bg-slate-300 text-white text-sm font-semibold py-2 rounded-lg transition-colors">
                {pwLoading ? 'Saving…' : 'Update Login Credentials'}
              </button>
            </form>
          </div>

          {/* Danger Zone */}
          <div className="pt-2 border-t border-slate-200">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Danger Zone</p>

            {/* Delete Network (only shown when >1 network exists) */}
            {canDeleteNetwork && (
              <div className="mb-3">
                {!confirmDeleteNetwork ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteNetwork(true)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-orange-300 text-orange-600 hover:bg-orange-50 font-medium rounded-lg transition-colors text-sm"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete This Network
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-start gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm text-orange-700">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>This will delete this network and all its IP entries. This cannot be undone.</span>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setConfirmDeleteNetwork(false)}
                        className="flex-1 px-4 py-2 border border-slate-300 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors text-sm font-medium">
                        Cancel
                      </button>
                      <button type="button" onClick={onDeleteNetwork}
                        className="flex-1 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors text-sm font-medium">
                        Yes, Delete Network
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!confirmClear ? (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-red-300 text-red-600 hover:bg-red-50 font-medium rounded-lg transition-colors text-sm"
              >
                <Trash2 className="w-4 h-4" />
                Clear All Network Data
              </button>
            ) : (
              <div className="space-y-2">
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>This will permanently delete all IP entries. This cannot be undone.</span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="flex-1 px-4 py-2 border border-slate-300 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors text-sm font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={onClear}
                    className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-sm font-medium"
                  >
                    Yes, Clear Everything
                  </button>
                </div>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

// Initial IP address data from the Excel spreadsheet
// ── Example data — replace with your own via Import or by editing entries in the app ──
const initialIpData = [
  // DHCP fixed reservations (.6 and .50 are fixed in DHCP by default)
  { assetName: "DNS Server",        hostname: "dns.home.lab",        ip: "192.168.0.6",   type: "Virtual",   location: "Server Room", apps: "PiHole",      notes: "Primary DNS — fixed DHCP reservation" },
  { assetName: "NAS",               hostname: "nas.home.lab",        ip: "192.168.0.50",  type: "Physical",  location: "Server Room", apps: "Synology",    notes: "Fixed DHCP reservation" },

  // Static assignments (.171–.254)
  { assetName: "Home Server",       hostname: "server.home.lab",     ip: "192.168.0.171", type: "Physical",  location: "Server Room", apps: "Proxmox",     notes: "" },
  { assetName: "Media Server",      hostname: "media.home.lab",      ip: "192.168.0.172", type: "Virtual",   location: "Server Room", apps: "Plex",        notes: "" },
  { assetName: "Home Automation",   hostname: "ha.home.lab",         ip: "192.168.0.173", type: "LXC",       location: "Server Room", apps: "Home Assistant", notes: "" },
  { assetName: "Uptime Monitor",    hostname: "uptime.home.lab",     ip: "192.168.0.174", type: "LXC",       location: "Server Room", apps: "Uptime Kuma", notes: "" },
  { assetName: "VPN Gateway",       hostname: "vpn.home.lab",        ip: "192.168.0.175", type: "LXC",       location: "Server Room", apps: "Tailscale",   notes: "" },

  // Free (available to claim)
  { assetName: "Free", hostname: "", ip: "192.168.0.176", type: "", location: "", apps: "", notes: "" },
  { assetName: "Free", hostname: "", ip: "192.168.0.177", type: "", location: "", apps: "", notes: "" },
  { assetName: "Free", hostname: "", ip: "192.168.0.178", type: "", location: "", apps: "", notes: "" },
  { assetName: "Free", hostname: "", ip: "192.168.0.179", type: "", location: "", apps: "", notes: "" },
  { assetName: "Free", hostname: "", ip: "192.168.0.180", type: "", location: "", apps: "", notes: "" },

  // Networking gear
  { assetName: "Core Switch",       hostname: "switch.home.lab",     ip: "192.168.0.240", type: "Physical",  location: "Server Room", apps: "",            notes: "" },
  { assetName: "Access Point",      hostname: "ap-lounge.home.lab",  ip: "192.168.0.241", type: "Physical",  location: "Lounge",      apps: "",            notes: "" },
  { assetName: "Access Point",      hostname: "ap-office.home.lab",  ip: "192.168.0.242", type: "Physical",  location: "Office",      apps: "",            notes: "" },

  // Reserved / gateway
  { assetName: "Reserved", hostname: "", ip: "192.168.0.251", type: "", location: "", apps: "", notes: "" },
  { assetName: "Reserved", hostname: "", ip: "192.168.0.253", type: "", location: "", apps: "", notes: "" },
  { assetName: "Router / Firewall", hostname: "router.home.lab",     ip: "192.168.0.254", type: "Physical",  location: "Server Room", apps: "OPNsense",    notes: "Default gateway" },
];

// Load saved IP data from localStorage, falling back to the hardcoded defaults
// (used for immediate render before API check completes)
function loadIpData() {
  try {
    const saved = localStorage.getItem('ip-manager-ip-data');
    if (saved) return JSON.parse(saved);
  } catch {}
  return initialIpData;
}

// ── API helpers (SQLite backend on LXC) ──────────────────────────────────────
// Returns true if the API server is reachable. Falls back silently to
// localStorage mode if running locally without the server.
// Called whenever any API request gets a 401 — registered by the component on mount.
let onUnauthenticated = null;

async function detectApi() {
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function apiGet(path) {
  const res = await fetch(path);
  if (res.status === 401) { onUnauthenticated?.(); throw new Error('Unauthorised'); }
  if (!res.ok) throw new Error(`API ${path} returned ${res.status}`);
  return res.json();
}

async function apiPut(path, body) {
  const res = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401) { onUnauthenticated?.(); }
}

// ── Login screen ──────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        onLogin();
      } else {
        setError('Invalid username or password');
      }
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-emerald-100 rounded-2xl mb-4">
            <Shield className="w-7 h-7 text-emerald-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">IP Address Manager</h1>
          <p className="text-slate-500 text-sm mt-1">Sign in to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Username</label>
            <input
              type="text"
              autoFocus
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              placeholder="admin"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 px-3 py-2 rounded-lg">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold py-2.5 rounded-lg transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="mt-6 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500 text-center">
          <span className="font-medium">First time?</span> Sign in with <span className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200">admin</span> / <span className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200">admin</span>, then go to <span className="font-medium">Settings → Account</span> to set your own credentials.
        </div>
      </div>
    </div>
  );
}

// Helper functions
const getUniqueValues = (data, key) => {
  const values = [...new Set(data.map(item => item[key]).filter(Boolean))];
  return values.sort();
};

const getServiceIcon = (apps, assetName) => {
  const combined = `${apps} ${assetName}`.toLowerCase();
  if (combined.includes('camera') || combined.includes('reolink') || combined.includes('tapo')) return Camera;
  if (combined.includes('proxmox')) return Server;
  if (combined.includes('docker')) return Box;
  if (combined.includes('pihole') || combined.includes('dns')) return Shield;
  if (combined.includes('nas') || combined.includes('truenas') || combined.includes('synology')) return HardDrive;
  if (combined.includes('unifi') || combined.includes('wifi') || combined.includes('access point')) return Wifi;
  if (combined.includes('ghost') || combined.includes('blog') || combined.includes('nginx')) return Globe;
  if (combined.includes('switch') || combined.includes('mikrotik') || combined.includes('netgear')) return Monitor;
  return Cpu;
};

const getTypeColor = (type) => {
  if (type === 'Virtual') return 'bg-purple-100 text-purple-800 border-purple-200';
  if (type === 'Physical') return 'bg-blue-100 text-blue-800 border-blue-200';
  return 'bg-gray-100 text-gray-500 border-gray-200';
};

const TRACKED_FIELDS = [
  { key: 'assetName', label: 'Name' },
  { key: 'hostname',  label: 'Hostname' },
  { key: 'type',      label: 'Type' },
  { key: 'location',  label: 'Location' },
  { key: 'apps',      label: 'Service' },
  { key: 'notes',     label: 'Notes' },
  { key: 'tags',      label: 'Tags' },
];

const computeDiff = (oldItem, newItem) =>
  TRACKED_FIELDS.reduce((acc, { key, label }) => {
    const oldVal = key === 'tags' ? (oldItem[key] || []).join(', ') : (oldItem[key] || '');
    const newVal = key === 'tags' ? (newItem[key] || []).join(', ') : (newItem[key] || '');
    if (oldVal !== newVal) acc.push({ label, old: oldVal, new: newVal });
    return acc;
  }, []);

const getLocationColor = (location) => {
  const colors = {
    'Garage': 'bg-amber-100 text-amber-800',
    'Office': 'bg-green-100 text-green-800',
    'House': 'bg-sky-100 text-sky-800',
    'Loft': 'bg-rose-100 text-rose-800',
    'Proxmox1': 'bg-indigo-100 text-indigo-800',
    'Proxmox2': 'bg-violet-100 text-violet-800',
    'Proxmox3': 'bg-fuchsia-100 text-fuchsia-800',
    'Proxmox4': 'bg-pink-100 text-pink-800',
    'Proxmox5': 'bg-cyan-100 text-cyan-800',
    'Proxmox6': 'bg-teal-100 text-teal-800',
    'Proxmox': 'bg-slate-100 text-slate-800',
  };
  return colors[location] || 'bg-gray-100 text-gray-600';
};

// ── Subnet utilities — support /24 (3-octet prefix) and /16 (2-octet prefix) ─

// Number of octets in the prefix string ("192.168.0" → 3, "192.168" → 2)
const subnetOctetCount = (subnet) => subnet.split('.').length;

// Convert a full IP to a host-portion ordinal for numeric comparison/sorting
const ipOrdinal = (ip, subnet) => {
  const p = ip.split('.');
  return subnetOctetCount(subnet) === 2
    ? (parseInt(p[2]) || 0) * 256 + (parseInt(p[3]) || 0)
    : parseInt(p[3]) || 0;
};

// Convert a stored range value ("170" or "1.170") to a comparable ordinal
const rangeOrdinal = (val, subnet) => {
  const parts = String(val).split('.');
  return subnetOctetCount(subnet) === 2 && parts.length === 2
    ? (parseInt(parts[0]) || 0) * 256 + (parseInt(parts[1]) || 0)
    : parseInt(parts[parts.length - 1]) || 0;
};

// The host-portion suffix for display (".170" for /24, ".1.170" for /16)
const ipSuffix = (ip, subnet) => ip.substring(subnet.length);

// CIDR string for header display
const subnetCIDR = (subnet) =>
  subnetOctetCount(subnet) === 2 ? `${subnet}.0.0/16` : `${subnet}.0/24`;

// Normalise a subnet input: strip CIDR suffix, strip trailing .0 octets
// "172.16.0.0/16" → "172.16",  "172.16.2.0" → "172.16.2",  "172.16" → "172.16"
const normaliseSubnet = (raw) => {
  const parts = raw.trim().replace(/\/\d+$/, '').split('.');
  // Only strip trailing zero octets when the user typed a full 4-octet address
  // (e.g. 192.168.1.0 → 192.168.1, 172.16.0.0 → 172.16).
  // A valid 3-octet /24 prefix such as 192.168.0 must NOT be altered.
  if (parts.length === 4) {
    while (parts.length > 2 && parts[parts.length - 1] === '0') parts.pop();
  }
  return parts.join('.');
};

const isInDHCPRange = (ip, config = DEFAULT_NETWORK_CONFIG) => {
  const ord = ipOrdinal(ip, config.subnet);
  return ord >= rangeOrdinal(config.dhcpStart, config.subnet) &&
         ord <= rangeOrdinal(config.dhcpEnd, config.subnet);
};

const isFixedInDHCP = (ip, config = DEFAULT_NETWORK_CONFIG) => {
  const ord = ipOrdinal(ip, config.subnet);
  return config.fixedInDHCP.some(f => rangeOrdinal(f, config.subnet) === ord);
};

// Returns array of { start, end } where start/end are actual IP strings
const groupIPsIntoRanges = (ips, subnet = DEFAULT_NETWORK_CONFIG.subnet) => {
  if (ips.length === 0) return [];
  const sorted = [...ips].sort((a, b) => ipOrdinal(a, subnet) - ipOrdinal(b, subnet));
  const ranges = [];
  let rangeStartIp = sorted[0];
  let rangeEndIp   = sorted[0];
  let rangeEndOrd  = ipOrdinal(sorted[0], subnet);

  for (let i = 1; i < sorted.length; i++) {
    const currentOrd = ipOrdinal(sorted[i], subnet);
    if (currentOrd === rangeEndOrd + 1) {
      rangeEndIp  = sorted[i];
      rangeEndOrd = currentOrd;
    } else {
      ranges.push({ start: rangeStartIp, end: rangeEndIp });
      rangeStartIp = sorted[i];
      rangeEndIp   = sorted[i];
      rangeEndOrd  = currentOrd;
    }
  }
  ranges.push({ start: rangeStartIp, end: rangeEndIp });
  return ranges;
};

// ── Import Modal ──────────────────────────────────────────────────────────────
function ImportModal({ onClose, onImport, networkConfig }) {
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
    reader.onload = (e) => {
      try {
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
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
function BulkEditModal({ count, onApply, onClose, types, locations, allTags }) {
  const [tagInput, setTagInput] = useState('');
  const [pendingTags, setPendingTags] = useState([]);
  const [setType, setSetType] = useState('');
  const [setLocation, setSetLocation] = useState('');

  const addTag = (tag) => {
    const t = tag.trim();
    if (t && !pendingTags.includes(t)) setPendingTags(prev => [...prev, t]);
    setTagInput('');
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Bulk Edit</h2>
            <p className="text-sm text-slate-500 mt-0.5">{count} {count === 1 ? 'entry' : 'entries'} selected</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <div className="p-6 space-y-5">
          {/* Add Tags */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Add Tags <span className="text-slate-400 font-normal">(appended to existing tags)</span></label>
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-teal-400"
                placeholder="e.g. switch, core, uplink…"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput); }}}
              />
              <button type="button" onClick={() => addTag(tagInput)} disabled={!tagInput.trim()}
                className="px-3 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors">
                Add
              </button>
            </div>
            {allTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {allTags.filter(t => !pendingTags.includes(t)).map(t => (
                  <button key={t} type="button" onClick={() => addTag(t)}
                    className="px-2 py-0.5 text-xs bg-violet-50 text-violet-700 border border-violet-200 rounded-full hover:bg-violet-100 transition-colors">
                    + {t}
                  </button>
                ))}
              </div>
            )}
            {pendingTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {pendingTags.map(t => (
                  <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-violet-600 text-white rounded-full">
                    {t}
                    <button type="button" onClick={() => setPendingTags(prev => prev.filter(x => x !== t))} className="hover:opacity-75">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
          {/* Set Type */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Set Type <span className="text-slate-400 font-normal">(overwrites, leave blank to keep existing)</span></label>
            <select className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-teal-400 bg-white"
              value={setType} onChange={e => setSetType(e.target.value)}>
              <option value="">— keep existing —</option>
              {['Physical', 'Virtual', 'LXC', 'Network', 'IoT', 'Camera', 'Other', ...types.filter(t => !['Physical','Virtual','LXC','Network','IoT','Camera','Other'].includes(t))].map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          {/* Set Location */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Set Location <span className="text-slate-400 font-normal">(overwrites, leave blank to keep existing)</span></label>
            <select className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-teal-400 bg-white"
              value={setLocation} onChange={e => setSetLocation(e.target.value)}>
              <option value="">— keep existing —</option>
              {locations.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-slate-300 text-slate-600 hover:bg-slate-50 rounded-xl font-medium text-sm transition-colors">
            Cancel
          </button>
          <button
            onClick={() => onApply({ addTags: pendingTags, setType: setType || null, setLocation: setLocation || null })}
            disabled={!pendingTags.length && !setType && !setLocation}
            className="flex-1 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white rounded-xl font-medium text-sm transition-colors">
            Apply to {count} {count === 1 ? 'entry' : 'entries'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Edit Modal Component
function EditModal({ item, onSave, onClose, onMarkFree, locations, types, onAddLocation }) {
  const [formData, setFormData] = useState({
    assetName: item.assetName,
    hostname: item.hostname,
    type: item.type,
    location: item.location,
    apps: item.apps,
    notes: item.notes || '',
    tags: item.tags || [],
  });
  const [tagInput, setTagInput] = useState('');
  // Separate draft state for the "add new location" text input.
  // We must NOT write the typed value into formData.location until the user
  // commits, because formData.location === '__new__' is the condition that
  // keeps the input visible — writing to it mid-keystroke collapses the field.
  const [newLocationDraft, setNewLocationDraft] = useState('');
  // Remember what was selected before the user opened "+ Add new location"
  // so we can restore it if they cancel without typing anything.
  const prevLocationRef = useRef('');

  const commitNewLocation = () => {
    const v = newLocationDraft.trim();
    if (v) {
      setFormData(prev => ({ ...prev, location: v }));
      onAddLocation?.(v); // persist to networkConfig.extraLocations immediately
    } else {
      // Cancelled — restore whatever was selected before opening "+ Add new location"
      setFormData(prev => ({ ...prev, location: prevLocationRef.current }));
    }
    setNewLocationDraft('');
  };

  const addTag = (raw) => {
    const newTags = raw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    setFormData(prev => ({ ...prev, tags: [...new Set([...prev.tags, ...newTags])] }));
    setTagInput('');
  };

  const removeTag = (tag) => setFormData(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tag) }));

  const handleSubmit = (e) => {
    e.preventDefault();
    // Resolve any pending new-location draft — blur may not have committed
    // yet if the user clicked Save directly from the text input.
    const finalLocation = formData.location === '__new__'
      ? newLocationDraft.trim()
      : formData.location;
    if (finalLocation && formData.location === '__new__') {
      onAddLocation?.(finalLocation);
    }
    onSave({ ...item, ...formData, location: finalLocation });
  };

  const isFree = item.assetName === 'Free';
  const isReserved = item.assetName === 'Reserved';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-slate-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-800">
                {isFree ? 'Claim IP Address' : 'Edit IP Entry'}
              </h2>
              <p className="text-sm text-slate-500 font-mono mt-1">{item.ip}</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Asset Name *</label>
            <input
              type="text"
              required
              value={formData.assetName}
              onChange={(e) => setFormData({ ...formData, assetName: e.target.value })}
              placeholder="e.g., My New Container"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Hostname</label>
            <input
              type="text"
              value={formData.hostname}
              onChange={(e) => setFormData({ ...formData, hostname: e.target.value })}
              placeholder="e.g., myserver.the-allens.uk"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-white"
              >
                <option value="">Select type...</option>
                <option value="Virtual">Virtual</option>
                <option value="Physical">Physical</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Location</label>
              <select
                value={formData.location}
                onChange={(e) => {
                  if (e.target.value === '__new__') {
                    // Save current location so we can restore it if the user cancels
                    prevLocationRef.current = formData.location;
                    setNewLocationDraft('');
                  }
                  setFormData({ ...formData, location: e.target.value });
                }}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-white"
              >
                <option value="">Select location...</option>
                {locations.map(loc => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
                <option value="__new__">+ Add new location</option>
              </select>
            </div>
          </div>

          {formData.location === '__new__' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">New Location Name</label>
              <input
                autoFocus
                type="text"
                value={newLocationDraft}
                onChange={(e) => setNewLocationDraft(e.target.value)}
                onBlur={commitNewLocation}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitNewLocation(); } if (e.key === 'Escape') { setFormData(prev => ({ ...prev, location: prevLocationRef.current })); setNewLocationDraft(''); } }}
                placeholder="e.g., Basement"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Service / Apps</label>
            <input
              type="text"
              value={formData.apps}
              onChange={(e) => setFormData({ ...formData, apps: e.target.value })}
              placeholder="e.g., Docker, Plex, Home Assistant"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Tags</label>
            {formData.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {formData.tags.map(tag => (
                  <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                    <Tag className="w-2.5 h-2.5" />{tag}
                    <button type="button" onClick={() => removeTag(tag)} className="hover:text-violet-900 ml-0.5">×</button>
                  </span>
                ))}
              </div>
            )}
            <input
              type="text"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); if (tagInput.trim()) addTag(tagInput); } }}
              onBlur={() => { if (tagInput.trim()) addTag(tagInput); }}
              placeholder="Type a tag and press Enter (e.g. media, iot, monitoring)"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
            <textarea
              rows={2}
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Credentials hint, purpose, last maintenance date…"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm resize-none"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors"
            >
              <Save className="w-4 h-4" />
              {isFree ? 'Claim IP' : 'Save Changes'}
            </button>

            {!isFree && !isReserved && (
              <button
                type="button"
                onClick={() => onMarkFree(item.ip)}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-100 hover:bg-rose-200 text-rose-700 font-medium rounded-lg transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Release IP
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

// Main Component
export default function IPAddressManager() {
  // Auth state: 'checking' while we verify the session, 'ok' when logged in, 'none' when not.
  const [auth, setAuth] = useState('checking');

  // Register the global 401 handler so apiGet/apiPut can signal session expiry.
  useEffect(() => {
    onUnauthenticated = () => setAuth('none');
    return () => { onUnauthenticated = null; };
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setAuth('none');
  };

  // Persistence mode — 'loading' until API check completes, then 'api' or 'local'
  const [persistMode, setPersistMode] = useState('loading');

  // Multi-network state.  `networks` is an array of network configs; the active
  // one is derived in a memo below.  Both start with safe defaults and are
  // populated by the mount effect once the API check resolves.
  const [networks, setNetworks] = useState([{ ...DEFAULT_NETWORK_CONFIG }]);
  const [activeNetworkId, setActiveNetworkId] = useState('net-1');
  const [showSettings, setShowSettings] = useState(false);

  const [ipData, setIpData] = useState([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // UI display preferences (browser-local; not synced to server)
  const [uiPrefs, setUiPrefs] = useState(loadUiPrefs);

  // UI state (declared here so all useEffect hooks below can safely reference them)
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [showReserved, setShowReserved] = useState(false);
  const [expandedCard, setExpandedCard] = useState(null);
  const [viewMode, setViewMode] = useState('cards');
  const [showFreeIPs, setShowFreeIPs] = useState(false);
  const [copiedIP, setCopiedIP] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [sortField, setSortField] = useState('ip');
  const [sortDir, setSortDir] = useState('asc');
  const searchRef = useRef(null);

  // ── On mount: check auth status, then detect API and load data ───────────────
  useEffect(() => {
    (async () => {
      // Always check auth status first — if the server is up and we're not
      // logged in, show the login screen immediately.
      try {
        const statusRes = await fetch('/api/auth/status');
        if (statusRes.ok) {
          const { authenticated } = await statusRes.json();
          if (!authenticated) {
            setAuth('none');
            setPersistMode('local'); // fall back to localStorage while logged out
            return;
          }
          setAuth('ok');
        }
      } catch {
        // Server unreachable — skip auth, fall through to localStorage mode
        setAuth('ok');
      }

      const hasApi = await detectApi();
      if (hasApi) {
        try {
          const [ipsJson, networksJson] = await Promise.all([
            apiGet('/api/ips'),
            apiGet('/api/networks').catch(() => ({ data: null })),
          ]);

          // ── IP data ──────────────────────────────────────────────────────
          if (ipsJson.data) {
            // Migrate legacy entries that have no networkId → assign to net-1
            const migrated = ipsJson.data.map(item =>
              item.networkId ? item : { ...item, networkId: 'net-1' }
            );
            setIpData(migrated);
          } else {
            // First run on this server — push local data up (tagged to net-1)
            const local = loadIpData().map(item => ({ ...item, networkId: 'net-1' }));
            await apiPut('/api/ips', local);
          }

          // ── Networks config ──────────────────────────────────────────────
          if (networksJson.data && Array.isArray(networksJson.data) && networksJson.data.length > 0) {
            setNetworks(networksJson.data);
            setActiveNetworkId(networksJson.data[0].id);
          } else {
            // Try migrating old single-config endpoint
            const configJson = await apiGet('/api/config').catch(() => ({ data: null }));
            const migrated = configJson?.data
              ? [{ ...DEFAULT_NETWORK_CONFIG, ...configJson.data, id: 'net-1' }]
              : [{ ...DEFAULT_NETWORK_CONFIG }];
            setNetworks(migrated);
            await apiPut('/api/networks', migrated);
          }

          setPersistMode('api');
        } catch {
          setPersistMode('local');
        }
      } else {
        // No API — load from localStorage with migration
        const savedNetworks = loadNetworks();
        const savedIps = loadIpData().map(item => ({ ...item, networkId: item.networkId || 'net-1' }));
        setIpData(savedIps);
        setNetworks(savedNetworks);
        setActiveNetworkId(savedNetworks[0]?.id || 'net-1');
        setPersistMode('local');
      }
    })();
  }, []);

  // ── Auto-save IP data ───────────────────────────────────────────────────────
  useEffect(() => {
    if (persistMode === 'loading') return;
    if (persistMode === 'api') {
      apiPut('/api/ips', ipData).catch(() => {});
    } else {
      try { localStorage.setItem('ip-manager-ip-data', JSON.stringify(ipData)); } catch {}
    }
  }, [ipData, persistMode]);

  // ── Auto-save networks array ────────────────────────────────────────────────
  useEffect(() => {
    if (persistMode === 'loading') return;
    if (persistMode === 'api') {
      apiPut('/api/networks', networks).catch(() => {});
    } else {
      try { localStorage.setItem('ip-manager-networks', JSON.stringify(networks)); } catch {}
    }
  }, [networks, persistMode]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      // Ignore if typing in an input/textarea/select
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // / — focus search
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      // Esc — clear search, close modals, collapse expanded card
      if (e.key === 'Escape') {
        if (editingItem) { setEditingItem(null); return; }
        if (showSettings) { setShowSettings(false); return; }
        if (showImport)   { setShowImport(false);   return; }
        if (expandedCard !== null) { setExpandedCard(null); return; }
        if (searchTerm)   { setSearchTerm('');       return; }
      }
      // t — switch to Table view
      if (e.key === 't' || e.key === 'T') setViewMode('table');
      // c — switch to Cards view
      if (e.key === 'c' || e.key === 'C') setViewMode('cards');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editingItem, showSettings, showImport, expandedCard, searchTerm]);

  // ── Persist UI prefs (browser-local, runs whenever uiPrefs changes) ─────────
  useEffect(() => {
    try { localStorage.setItem('ip-manager-ui-prefs', JSON.stringify(uiPrefs)); } catch {}
  }, [uiPrefs]);

  // ── Derived network state ────────────────────────────────────────────────────

  // Active network config — derived from networks array for backward compat
  const networkConfig = useMemo(
    () => networks.find(n => n.id === activeNetworkId) || networks[0] || DEFAULT_NETWORK_CONFIG,
    [networks, activeNetworkId]
  );

  // IP data scoped to the active network.
  // Backward compat: entries without a networkId are treated as belonging to net-1.
  const networkIpData = useMemo(
    () => ipData.filter(item => !item.networkId || item.networkId === activeNetworkId),
    [ipData, activeNetworkId]
  );

  // Derived data (all scoped to the active network via networkIpData)
  const locations = useMemo(() => {
    const fromData = getUniqueValues(networkIpData, 'location');
    const extra = networkConfig.extraLocations || [];
    return [...new Set([...fromData, ...extra])].filter(Boolean).sort();
  }, [networkIpData, networkConfig.extraLocations]);

  const types = useMemo(() => getUniqueValues(networkIpData, 'type'), [networkIpData]);

  const allTags = useMemo(() => {
    const set = new Set();
    networkIpData.forEach(item => (item.tags || []).forEach(t => t && set.add(t)));
    return Array.from(set).sort();
  }, [networkIpData]);

  const freeStaticIPs = useMemo(() => {
    const subnet = networkConfig.subnet;
    const is16   = subnetOctetCount(subnet) === 2;
    const startOrd = rangeOrdinal(networkConfig.staticStart, subnet);
    const endOrd   = rangeOrdinal(networkConfig.staticEnd,   subnet);
    // Exclude legacy 'Free' entries — older databases stored released IPs
    // as assetName==='Free' rows; with the new range-based model they are
    // simply absent from networkIpData.  Treat them as unassigned for compatibility.
    const assignedIPs = new Set(
      networkIpData.filter(item => item.assetName !== 'Free').map(item => item.ip)
    );
    const free = [];
    for (let ord = startOrd; ord <= endOrd; ord++) {
      const ip = is16
        ? `${subnet}.${Math.floor(ord / 256)}.${ord % 256}`
        : `${subnet}.${ord}`;
      if (!assignedIPs.has(ip)) free.push(ip);
    }
    return free;
  }, [networkIpData, networkConfig]);

  const freeIPRanges = useMemo(() => groupIPsIntoRanges(freeStaticIPs, networkConfig.subnet), [freeStaticIPs, networkConfig.subnet]);

  // Merge assigned entries with synthetic Free entries so free IPs appear in
  // search, cards, and table views. Legacy assetName==='Free' rows in networkIpData
  // are dropped to avoid duplicates (freeStaticIPs already covers them).
  // When showFreeInList is off, free entries are excluded entirely — this is
  // critical for /16 networks that could have tens of thousands of free IPs.
  const showFreeInList = uiPrefs.showFreeInList !== false;
  const allDisplayData = useMemo(() => {
    const assigned = networkIpData.filter(item => item.assetName !== 'Free');
    if (!showFreeInList) return assigned;
    const freeEntries = freeStaticIPs.map(ip => ({
      ip, assetName: 'Free', hostname: '', type: '', location: '',
      apps: '', notes: '', tags: [], updatedAt: null,
    }));
    return [...assigned, ...freeEntries];
  }, [networkIpData, freeStaticIPs, showFreeInList]);

  const filteredData = useMemo(() => {
    return allDisplayData.filter(item => {
      if (!showReserved && item.assetName === 'Reserved') return false;

      const searchLower = searchTerm.toLowerCase();
      const itemTags = item.tags || [];
      const matchesSearch = !searchTerm ||
        item.assetName.toLowerCase().includes(searchLower) ||
        item.hostname.toLowerCase().includes(searchLower) ||
        item.ip.toLowerCase().includes(searchLower) ||
        (item.apps || '').toLowerCase().includes(searchLower) ||
        (item.location || '').toLowerCase().includes(searchLower) ||
        itemTags.some(t => t.toLowerCase().includes(searchLower)) ||
        (item.assetName === 'Free' && 'free'.includes(searchLower)) ||
        (item.assetName === 'Free' && 'available'.includes(searchLower));

      const matchesType = !selectedType || item.type === selectedType;
      const matchesLocation = !selectedLocation || item.location === selectedLocation;
      const matchesTag = !selectedTag || itemTags.includes(selectedTag);

      return matchesSearch && matchesType && matchesLocation && matchesTag;
    });
  }, [allDisplayData, searchTerm, selectedType, selectedLocation, selectedTag, showReserved]);

  const sortedData = useMemo(() => {
    if (!sortField) return filteredData;
    return [...filteredData].sort((a, b) => {
      let av, bv;
      if (sortField === 'ip') {
        av = ipOrdinal(a.ip, networkConfig.subnet);
        bv = ipOrdinal(b.ip, networkConfig.subnet);
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      if (sortField === 'updatedAt') {
        av = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        bv = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      } else {
        av = (a[sortField] || '').toLowerCase();
        bv = (b[sortField] || '').toLowerCase();
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortField, sortDir]);

  const stats = useMemo(() => {
    const active = networkIpData.filter(i => i.assetName !== 'Reserved' && i.assetName !== 'Free');
    const staticAssigned = networkIpData.filter(i => {
      const ord = ipOrdinal(i.ip, networkConfig.subnet);
      return ord >= rangeOrdinal(networkConfig.staticStart, networkConfig.subnet) &&
             ord <= rangeOrdinal(networkConfig.staticEnd, networkConfig.subnet) &&
             i.assetName !== 'Reserved' && i.assetName !== 'Free';
    });
    const dhcpSize = rangeOrdinal(networkConfig.dhcpEnd, networkConfig.subnet) -
                     rangeOrdinal(networkConfig.dhcpStart, networkConfig.subnet) + 1 -
                     networkConfig.fixedInDHCP.length;
    return {
      total: networkIpData.length,
      active: active.length,
      virtual: active.filter(i => i.type === 'Virtual').length,
      physical: active.filter(i => i.type === 'Physical').length,
      reserved: networkIpData.filter(i => i.assetName === 'Reserved').length,
      freeStatic: freeStaticIPs.length,
      staticAssigned: staticAssigned.length,
      dhcpPoolSize: dhcpSize,
    };
  }, [networkIpData, freeStaticIPs, networkConfig]);

  // Actions
  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const sortIcon = (field) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    return sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
  };

  const clearFilters = () => {
    setSearchTerm('');
    setSelectedType('');
    setSelectedLocation('');
    setSelectedTag('');
  };

  // Rename a location across all entries.
  // oldName===null means "add new" from the text box — nothing to rename yet,
  // but the name will appear in the dropdown next time the user edits an entry.
  // We achieve this by keeping a separate managed list in networkConfig.
  const handleRenameLocation = (oldName, newName) => {
    if (!newName || newName === oldName) return;
    if (oldName === null) {
      // Add to the managed extra-locations list stored in the active network config
      setNetworks(prev => prev.map(n =>
        n.id === activeNetworkId
          ? { ...n, extraLocations: [...new Set([...(n.extraLocations || []), newName])] }
          : n
      ));
      return;
    }
    setIpData(prev =>
      prev.map(item =>
        item.location === oldName ? { ...item, location: newName, updatedAt: new Date().toISOString() } : item
      )
    );
    setHasChanges(true);
  };

  const handleDeleteLocation = (name) => {
    // Clear the location from all IP entries
    setIpData(prev =>
      prev.map(item =>
        item.location === name ? { ...item, location: '', updatedAt: new Date().toISOString() } : item
      )
    );
    // Remove from extraLocations so it doesn't reappear from the network config
    setNetworks(prev => prev.map(n =>
      n.id === activeNetworkId
        ? { ...n, extraLocations: (n.extraLocations || []).filter(l => l !== name) }
        : n
    ));
    setHasChanges(true);
  };

  const copyToClipboard = (ip) => {
    navigator.clipboard.writeText(ip);
    setCopiedIP(ip);
    setTimeout(() => setCopiedIP(null), 2000);
  };

  // ── Bulk selection ──────────────────────────────────────────────────────────
  const [selectedIPs, setSelectedIPs] = useState(new Set());
  const [showBulkEdit, setShowBulkEdit] = useState(false);

  const toggleSelect = (ip, e) => {
    e.stopPropagation();
    setSelectedIPs(prev => {
      const next = new Set(prev);
      next.has(ip) ? next.delete(ip) : next.add(ip);
      return next;
    });
  };

  const selectAll = () => setSelectedIPs(new Set(sortedData.map(i => i.ip)));
  const clearSelection = () => setSelectedIPs(new Set());

  const handleBulkEdit = ({ addTags, setType, setLocation }) => {
    const now = new Date().toISOString();
    setIpData(prev => prev.map(item => {
      if (!selectedIPs.has(item.ip)) return item;
      const updated = { ...item, updatedAt: now };
      if (addTags?.length) updated.tags = [...new Set([...(item.tags || []), ...addTags])];
      if (setType)     updated.type     = setType;
      if (setLocation) updated.location = setLocation;
      const changes = computeDiff(item, updated);
      const entry = { ts: now, changes, bulk: true };
      const history = [...(item.history || []), entry].slice(-20);
      return { ...updated, history };
    }));
    setHasChanges(true);
    clearSelection();
    setShowBulkEdit(false);
  };

  const handleBulkRelease = () => {
    setIpData(prev => prev.filter(item => !selectedIPs.has(item.ip)));
    setHasChanges(true);
    clearSelection();
  };

  const handleSaveItem = (updatedItem) => {
    const now = new Date().toISOString();
    const stamped = { ...updatedItem, updatedAt: now };
    setIpData(prev => {
      const existing = prev.find(item => item.ip === stamped.ip);
      if (existing) {
        const changes = computeDiff(existing, stamped);
        const entry = changes.length
          ? { ts: now, changes }
          : { ts: now, changes: [{ label: 'Saved', old: '', new: '(no changes)' }] };
        const history = [...(existing.history || []), entry].slice(-20);
        return prev.map(item => item.ip === stamped.ip ? { ...stamped, history } : item);
      }
      // New entry — record creation and stamp with active network
      const history = [{ ts: now, changes: [{ label: 'Created', old: '', new: stamped.ip }] }];
      return [...prev, { ...stamped, history, networkId: activeNetworkId }];
    });
    setHasChanges(true);
    setEditingItem(null);
    setExpandedCard(null);
  };

  const handleMarkFree = (ip) => {
    // Remove the entry entirely — free IPs are now derived from the static
    // range minus ipData, so deleting is all that's needed to return it to
    // the free pool.
    setIpData(prev => prev.filter(item => item.ip !== ip));
    setHasChanges(true);
    setEditingItem(null);
    setExpandedCard(null);
  };

  const handleExportExcel = () => {
    // Prepare data for Excel
    const excelData = ipData.map(item => ({
      'AssetName': item.assetName,
      'Hostname': item.hostname,
      'IP Address': item.ip,
      'Virtual/Physical': item.type,
      'Location': item.location,
      'Apps': item.apps,
    }));

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);

    // Set column widths
    ws['!cols'] = [
      { wch: 35 }, // AssetName
      { wch: 35 }, // Hostname
      { wch: 15 }, // IP Address
      { wch: 15 }, // Virtual/Physical
      { wch: 15 }, // Location
      { wch: 25 }, // Apps
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'IP Addresses');

    // Generate filename with date
    const date = new Date().toISOString().split('T')[0];
    const filename = `IP_Addresses_${date}.xlsx`;

    // Download
    XLSX.writeFile(wb, filename);
    setHasChanges(false);
  };

  const handleImport = async (rows, mode) => {
    // Tag all incoming rows with the active network
    const taggedRows = rows.map(r => ({ ...r, networkId: activeNetworkId }));

    if (persistMode === 'api') {
      try {
        await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: taggedRows, mode, networkId: activeNetworkId }),
        });
        // Refresh from server so UI is in sync
        const fresh = await apiGet('/api/ips');
        if (fresh.data) setIpData(fresh.data);
      } catch {}
    } else {
      if (mode === 'replace') {
        // Replace only entries belonging to the active network; keep other networks intact
        setIpData(prev => [
          ...prev.filter(item => item.networkId !== activeNetworkId),
          ...taggedRows,
        ]);
      } else {
        setIpData(prev => {
          const map = new Map(prev.map(r => [r.ip, r]));
          taggedRows.forEach(r => map.set(r.ip, r));
          return Array.from(map.values()).sort((a, b) =>
            ipOrdinal(a.ip, networkConfig.subnet) - ipOrdinal(b.ip, networkConfig.subnet)
          );
        });
      }
      setHasChanges(true);
    }
  };

  // ── Multi-network management ────────────────────────────────────────────────
  const handleAddNetwork = () => {
    const newId = `net-${Date.now()}`;
    const newNet = {
      ...DEFAULT_NETWORK_CONFIG,
      id: newId,
      networkName: `Network ${networks.length + 1}`,
      subnet: '10.0.0',
      dhcpStart: 1,
      dhcpEnd: 100,
      staticStart: 101,
      staticEnd: 254,
      fixedInDHCP: [],
    };
    setNetworks(prev => [...prev, newNet]);
    setActiveNetworkId(newId);
    // Clear filters so the new (empty) network view is clean
    clearFilters();
    setShowSettings(true); // Let user configure the new network immediately
  };

  const handleDeleteNetwork = () => {
    if (networks.length <= 1) return;
    const remaining = networks.filter(n => n.id !== activeNetworkId);
    setNetworks(remaining);
    setIpData(prev => prev.filter(item => item.networkId !== activeNetworkId));
    setActiveNetworkId(remaining[0]?.id || 'net-1');
    setShowSettings(false);
  };

  const hasActiveFilters = searchTerm || selectedType || selectedLocation || selectedTag;

  // Use networkConfig-aware versions of the helper functions
  const isInDHCPRangeConfig = (ip) => {
    const ord = ipOrdinal(ip, networkConfig.subnet);
    return ord >= rangeOrdinal(networkConfig.dhcpStart, networkConfig.subnet) &&
           ord <= rangeOrdinal(networkConfig.dhcpEnd, networkConfig.subnet);
  };
  const isFixedInDHCPConfig = (ip) => {
    const ord = ipOrdinal(ip, networkConfig.subnet);
    return networkConfig.fixedInDHCP.some(f => rangeOrdinal(f, networkConfig.subnet) === ord);
  };

  // Show login screen while checking or when unauthenticated
  if (auth === 'checking') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-slate-400 text-sm">Loading…</div>
      </div>
    );
  }
  if (auth === 'none') {
    // Reload the page after login so the full init/data-loading flow reruns
    // with the auth cookie already set — avoids stale-state data wipe issues.
    return <LoginScreen onLogin={() => window.location.reload()} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Settings Modal */}
      {showBulkEdit && (
        <BulkEditModal
          count={selectedIPs.size}
          onApply={handleBulkEdit}
          onClose={() => setShowBulkEdit(false)}
          types={types}
          locations={locations}
          allTags={allTags}
        />
      )}

      {showSettings && (
        <SettingsModal
          config={networkConfig}
          onSave={(cfg) => {
            setNetworks(prev => prev.map(n =>
              n.id === activeNetworkId ? { ...n, ...cfg, id: activeNetworkId } : n
            ));
            setShowSettings(false);
          }}
          onClose={() => setShowSettings(false)}
          onClear={() => {
            // Only clear IP entries that belong to the active network
            setIpData(prev => prev.filter(item => item.networkId !== activeNetworkId));
            setHasChanges(true);
            setShowSettings(false);
          }}
          locations={locations}
          onRenameLocation={handleRenameLocation}
          onDeleteLocation={handleDeleteLocation}
          canDeleteNetwork={networks.length > 1}
          onDeleteNetwork={handleDeleteNetwork}
          showFreeInList={showFreeInList}
          onToggleShowFreeInList={() => setUiPrefs(p => ({ ...p, showFreeInList: p.showFreeInList === false }))}
          ipData={ipData}
          networks={networks}
          onRestore={(restoredNetworks, restoredIpData) => {
            setNetworks(restoredNetworks);
            setIpData(restoredIpData);
            setActiveNetworkId(restoredNetworks[0]?.id || 'net-1');
            setShowSettings(false);
          }}
        />
      )}

      {/* Import Modal */}
      {showImport && (
        <ImportModal
          networkConfig={networkConfig}
          onImport={handleImport}
          onClose={() => setShowImport(false)}
        />
      )}

      {/* Edit Modal */}
      {editingItem && (
        <EditModal
          item={editingItem}
          onSave={handleSaveItem}
          onClose={() => setEditingItem(null)}
          onMarkFree={handleMarkFree}
          locations={locations}
          types={types}
          onAddLocation={(name) => handleRenameLocation(null, name)}
        />
      )}

      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">

          {/* Network Tabs — shown whenever there are multiple networks */}
          {networks.length > 1 && (
            <div className="flex items-center gap-1 mb-3 flex-wrap">
              {networks.map(net => (
                <button
                  key={net.id}
                  onClick={() => { setActiveNetworkId(net.id); clearFilters(); }}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    net.id === activeNetworkId
                      ? 'bg-slate-800 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {net.networkName}
                  <span className={`ml-1.5 text-xs font-mono ${net.id === activeNetworkId ? 'text-slate-300' : 'text-slate-400'}`}>
                    {subnetCIDR(net.subnet)}
                  </span>
                </button>
              ))}
              <button
                onClick={handleAddNetwork}
                title="Add another network"
                className="px-3 py-1.5 text-sm font-medium rounded-lg bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-600 border border-dashed border-slate-300 transition-colors"
              >
                + Add Network
              </button>
            </div>
          )}

          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-800">IP Address Manager</h1>
              <p className="text-sm text-slate-500">{networkConfig.networkName} · {subnetCIDR(networkConfig.subnet)}</p>
            </div>
            <div className="flex gap-2 items-center">
              {/* Persistence mode badge */}
              {persistMode === 'api' && (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs border border-emerald-200" title="Data is stored in SQLite on the server — shared across all users">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                  SQLite
                </div>
              )}
              {persistMode === 'local' && (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 text-slate-500 rounded-lg text-xs border border-slate-200" title="Data is stored in this browser only — no API server detected">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-400"></div>
                  Local
                </div>
              )}
              {hasChanges && persistMode !== 'api' && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-sm border border-amber-200">
                  <AlertCircle className="w-4 h-4" />
                  Unsaved changes
                </div>
              )}
              <button
                onClick={() => setShowImport(true)}
                className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white font-medium rounded-lg transition-colors"
              >
                <Upload className="w-4 h-4" />
                Import
              </button>
              <button
                onClick={handleExportExcel}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors"
              >
                <Download className="w-4 h-4" />
                Export
              </button>
              {networks.length === 1 && (
                <button
                  onClick={handleAddNetwork}
                  className="flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 text-slate-500 font-medium rounded-lg border border-dashed border-slate-300 transition-colors text-sm"
                  title="Add another network (e.g. a VLAN or IoT segment)"
                >
                  <Plus className="w-4 h-4" />
                  Add Network
                </button>
              )}
              <button
                onClick={() => setShowSettings(true)}
                className="flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium rounded-lg transition-colors"
                title="Network Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
              {persistMode === 'api' && (
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-red-50 hover:text-red-600 text-slate-500 font-medium rounded-lg transition-colors"
                  title="Sign out"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => setViewMode('cards')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  viewMode === 'cards'
                    ? 'bg-slate-800 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Cards
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  viewMode === 'table'
                    ? 'bg-slate-800 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Table
              </button>
            </div>
          </div>

          {/* Network Overview */}
          <div className="mb-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div className="flex flex-wrap gap-6 text-sm">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" />
                <span className="text-slate-600">
                  <span className="font-medium">DHCP Pool:</span> .{networkConfig.dhcpStart} – .{networkConfig.dhcpEnd}
                  <span className="text-slate-400 ml-1">({stats.dhcpPoolSize} dynamic)</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-emerald-500" />
                <span className="text-slate-600">
                  <span className="font-medium">Static Range:</span> .{networkConfig.staticStart} – .{networkConfig.staticEnd}
                  <span className="text-slate-400 ml-1">({stats.staticAssigned} assigned, {stats.freeStatic} free)</span>
                </span>
              </div>
              {networkConfig.fixedInDHCP.length > 0 && (
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-blue-500" />
                  <span className="text-slate-600">
                    <span className="font-medium">DHCP Reservations:</span> {networkConfig.fixedInDHCP.map(n => `.${n}`).join(', ')}

                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Stats Bar */}
          <div className="flex flex-wrap gap-4 mb-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
              <span className="text-slate-600">{stats.active} Active</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-purple-500"></div>
              <span className="text-slate-600">{stats.virtual} Virtual</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-500"></div>
              <span className="text-slate-600">{stats.physical} Physical</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-slate-300"></div>
              <span className="text-slate-600">{stats.reserved} Reserved</span>
            </div>
            <button
              onClick={() => setShowFreeIPs(!showFreeIPs)}
              className={`flex items-center gap-2 px-3 py-1 rounded-full transition-colors ${
                showFreeIPs
                  ? 'bg-emerald-100 text-emerald-800 ring-2 ring-emerald-300'
                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              }`}
            >
              <CircleDot className="w-3 h-3" />
              <span className="font-medium">{stats.freeStatic} Free Static</span>
              {showFreeIPs ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>

          {/* Free Static IPs Panel */}
          {showFreeIPs && (
            <div className="mb-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-emerald-800 flex items-center gap-2">
                  <CircleDot className="w-4 h-4" />
                  {freeStaticIPs.length} Free Static IP Addresses
                  <span className="text-xs font-normal text-emerald-600">(.{networkConfig.staticStart}–.{networkConfig.staticEnd} range)</span>
                </h3>
                <span className="text-xs text-emerald-600">Click to claim or copy</span>
              </div>

              {freeStaticIPs.length > 0 ? (
                <>
                  <div className="mb-3 text-sm text-emerald-700">
                    <span className="font-medium">Available ranges: </span>
                    {freeIPRanges.map((range, idx) => (
                      <span key={idx}>
                        {range.start === range.end
                          ? ipSuffix(range.start, networkConfig.subnet)
                          : `${ipSuffix(range.start, networkConfig.subnet)}–${ipSuffix(range.end, networkConfig.subnet)}`}
                        {idx < freeIPRanges.length - 1 ? ', ' : ''}
                      </span>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
                    {freeStaticIPs.map(ip => {
                      return (
                        <button
                          key={ip}
                          onClick={() => setEditingItem({ ip, assetName: '', hostname: '', type: 'Physical', location: '', apps: '', notes: '', tags: [] })}
                          className="group px-3 py-1.5 font-mono text-xs rounded-lg transition-all bg-white text-emerald-700 hover:bg-emerald-500 hover:text-white border border-emerald-200 hover:border-emerald-500 flex items-center gap-2"
                        >
                          {ipSuffix(ip, networkConfig.subnet)}
                          <Plus className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-3 pt-3 border-t border-emerald-200 flex items-center gap-4">
                    <span className="text-sm text-emerald-700">Quick claim: </span>
                    <button
                      onClick={() => setEditingItem({ ip: freeStaticIPs[0], assetName: '', hostname: '', type: 'Physical', location: '', apps: '', notes: '', tags: [] })}
                      className="flex items-center gap-1 font-mono text-sm font-semibold text-emerald-800 hover:text-emerald-600"
                    >
                      <Plus className="w-4 h-4" />
                      {freeStaticIPs[0]}
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-emerald-700 text-sm">No free static IPs available. All IPs in the static range are assigned.</p>
              )}
            </div>
          )}

          {/* Bulk Selection Bar */}
          {selectedIPs.size > 0 && (
            <div className="flex items-center gap-3 px-4 py-3 bg-violet-50 border border-violet-200 rounded-xl">
              <span className="text-sm font-semibold text-violet-800">
                {selectedIPs.size} selected
              </span>
              <div className="flex items-center gap-2 ml-auto">
                <button onClick={selectAll} className="text-xs text-violet-600 hover:text-violet-800 underline underline-offset-2">
                  Select all ({sortedData.length})
                </button>
                <button onClick={clearSelection} className="text-xs text-slate-500 hover:text-slate-700 underline underline-offset-2">
                  Clear
                </button>
                <button
                  onClick={() => setShowBulkEdit(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <Tag className="w-3.5 h-3.5" />
                  Bulk Edit
                </button>
                <button
                  onClick={handleBulkRelease}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-sm font-medium rounded-lg transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Release
                </button>
              </div>
            </div>
          )}

          {/* Search and Filters */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search IP, hostname, service, location, or tag..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent text-sm"
              />
            </div>

            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400 text-sm bg-white"
            >
              <option value="">All Types</option>
              {types.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>

            <select
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400 text-sm bg-white"
            >
              <option value="">All Locations</option>
              {locations.map(loc => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>

            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={showReserved}
                onChange={(e) => setShowReserved(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-slate-600 focus:ring-slate-400"
              />
              Show Reserved
            </label>

            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 px-3 py-2 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
                Clear
              </button>
            )}
          </div>

          {/* Tag filter chips */}
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {allTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => setSelectedTag(selectedTag === tag ? '' : tag)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                    selectedTag === tag
                      ? 'bg-violet-600 text-white border-violet-600'
                      : 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100'
                  }`}
                >
                  <Tag className="w-3 h-3" />{tag}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Results Count */}
      <div className="max-w-7xl mx-auto px-4 py-3">
        <p className="text-sm text-slate-500">
          Showing {filteredData.length} of {showReserved ? allDisplayData.length : stats.active + stats.freeStatic} addresses
          {hasChanges && persistMode !== 'api' && <span className="ml-2 text-amber-600">• Changes pending export</span>}
          {persistMode === 'api' && <span className="ml-2 text-emerald-600">• Auto-saved to SQLite</span>}
        </p>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 pb-8">
        {viewMode === 'cards' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredData.map((item, index) => {
              const Icon = getServiceIcon(item.apps, item.assetName);
              const isExpanded = expandedCard === index;
              const isReserved = item.assetName === 'Reserved';
              const isFree = item.assetName === 'Free';
              const isDHCP = isInDHCPRangeConfig(item.ip);
              const isFixed = isFixedInDHCPConfig(item.ip);

              const isSelected = selectedIPs.has(item.ip);
              return (
                <div
                  key={item.ip}
                  onClick={() => selectedIPs.size > 0 ? toggleSelect(item.ip, { stopPropagation: () => {} }) : setExpandedCard(isExpanded ? null : index)}
                  className={`group rounded-xl border transition-all ${
                    isSelected
                      ? 'bg-violet-50 border-violet-400 border-2 ring-2 ring-violet-300 cursor-pointer'
                      : isFree
                        ? 'bg-emerald-50 border-emerald-300 border-2 cursor-pointer hover:bg-emerald-100'
                        : isReserved
                          ? 'bg-white border-dashed border-slate-200 opacity-60 cursor-pointer'
                          : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-md cursor-pointer'
                  } ${isExpanded && !selectedIPs.size ? 'ring-2 ring-slate-400' : ''}`}
                >
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-start gap-2">
                        {/* Selection checkbox — always visible on hover, solid when selected */}
                        <div
                          onClick={e => toggleSelect(item.ip, e)}
                          className={`mt-0.5 w-4 h-4 rounded border-2 flex-shrink-0 cursor-pointer flex items-center justify-center transition-all
                            ${isSelected
                              ? 'bg-violet-600 border-violet-600'
                              : 'border-slate-300 hover:border-violet-400 bg-white opacity-0 group-hover:opacity-100'
                            }`}
                          style={{ opacity: isSelected ? 1 : undefined }}
                        >
                          {isSelected && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                        </div>
                        <div className={`p-2 rounded-lg ${isFree ? 'bg-emerald-200' : isReserved ? 'bg-slate-50' : 'bg-slate-100'}`}>
                          {isFree ? (
                            <CircleDot className="w-5 h-5 text-emerald-600" />
                          ) : (
                            <Icon className={`w-5 h-5 ${isReserved ? 'text-slate-300' : 'text-slate-600'}`} />
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        {isFree && (
                          <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-500 text-white">
                            AVAILABLE
                          </span>
                        )}
                        {!isFree && isDHCP && !isFixed && (
                          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                            DHCP
                          </span>
                        )}
                        {!isFree && isFixed && (
                          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700 border border-blue-200">
                            Fixed
                          </span>
                        )}
                        {!isFree && !isDHCP && !isFixed && item.type && (
                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${getTypeColor(item.type)}`}>
                            {item.type}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mb-2">
                      <div className={`font-mono text-lg font-semibold ${isFree ? 'text-emerald-700' : 'text-slate-800'}`}>{item.ip}</div>
                      <div className={`text-sm ${isFree ? 'text-emerald-600 font-semibold' : isReserved ? 'text-slate-400 italic' : 'font-medium text-slate-700'}`}>
                        {isFree ? 'Available for use' : item.assetName}
                      </div>
                    </div>

                    {isFree && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingItem(item);
                        }}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 rounded-lg text-sm text-white font-medium transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        Claim This IP
                      </button>
                    )}

                    {!isReserved && !isFree && (
                      <>
                        {item.hostname && (
                          <div className="text-xs text-slate-500 font-mono truncate mb-2">
                            {item.hostname}
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2">
                          {item.location && (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${getLocationColor(item.location)}`}>
                              <MapPin className="w-3 h-3" />
                              {item.location}
                            </span>
                          )}
                          {item.apps && (
                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 text-slate-600">
                              {item.apps}
                            </span>
                          )}
                          {(item.tags || []).map(tag => (
                            <span key={tag} onClick={(e) => { e.stopPropagation(); setSelectedTag(selectedTag === tag ? '' : tag); }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-violet-100 text-violet-700 border border-violet-200 cursor-pointer hover:bg-violet-200 transition-colors">
                              <Tag className="w-2.5 h-2.5" />{tag}
                            </span>
                          ))}
                        </div>
                      </>
                    )}

                    {isExpanded && !isFree && (
                      <div className="mt-4 pt-4 border-t border-slate-100">
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <div className="text-slate-400 text-xs uppercase tracking-wide">Type</div>
                            <div className="text-slate-700">{item.type || '—'}</div>
                          </div>
                          <div>
                            <div className="text-slate-400 text-xs uppercase tracking-wide">Location</div>
                            <div className="text-slate-700">{item.location || '—'}</div>
                          </div>
                          <div>
                            <div className="text-slate-400 text-xs uppercase tracking-wide">IP Range</div>
                            <div className="text-slate-700">
                              {isFixed
                                ? isDHCP
                                  ? `Fixed in DHCP Pool (.${networkConfig.dhcpStart} – .${networkConfig.dhcpEnd})`
                                  : 'DHCP Reservation (outside pool)'
                                : isDHCP
                                  ? `DHCP Pool (.${networkConfig.dhcpStart} – .${networkConfig.dhcpEnd})`
                                  : `Static (.${networkConfig.staticStart} – .${networkConfig.staticEnd})`}
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-400 text-xs uppercase tracking-wide">Service/App</div>
                            <div className="text-slate-700">{item.apps || '—'}</div>
                          </div>
                          <div className="col-span-2">
                            <div className="text-slate-400 text-xs uppercase tracking-wide">Hostname</div>
                            <div className="text-slate-700 font-mono text-xs break-all">{item.hostname || '—'}</div>
                          </div>
                          {(item.tags || []).length > 0 && (
                            <div className="col-span-2">
                              <div className="text-slate-400 text-xs uppercase tracking-wide mb-1">Tags</div>
                              <div className="flex flex-wrap gap-1">
                                {(item.tags || []).map(tag => (
                                  <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                                    <Tag className="w-2.5 h-2.5" />{tag}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {item.notes && (
                            <div className="col-span-2">
                              <div className="text-slate-400 text-xs uppercase tracking-wide">Notes</div>
                              <div className="text-slate-600 text-sm mt-0.5">{item.notes}</div>
                            </div>
                          )}
                          {item.updatedAt && (
                            <div className="col-span-2">
                              <div className="text-slate-400 text-xs uppercase tracking-wide">Last Modified</div>
                              <div className="text-slate-500 text-xs mt-0.5">{formatDate(item.updatedAt)}</div>
                            </div>
                          )}
                        </div>
                        {(item.history || []).length > 0 && (
                          <div className="col-span-2 mt-1">
                            <div className="text-slate-400 text-xs uppercase tracking-wide mb-2">Change History</div>
                            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                              {[...(item.history || [])].reverse().map((entry, i) => (
                                <div key={i} className="text-xs">
                                  <span className="text-slate-400">{new Date(entry.ts).toLocaleString()}</span>
                                  {entry.bulk && <span className="ml-1 px-1 py-0.5 bg-violet-100 text-violet-600 rounded text-[10px] font-medium">bulk</span>}
                                  <div className="mt-0.5 space-y-0.5">
                                    {entry.changes.map((c, j) => (
                                      <div key={j} className="flex items-start gap-1 text-slate-600">
                                        <span className="font-medium text-slate-500 min-w-[52px]">{c.label}:</span>
                                        {c.old
                                          ? <><span className="line-through text-slate-400 truncate max-w-[100px]">{c.old}</span><span className="text-slate-400 mx-0.5">→</span><span className="text-slate-700 truncate max-w-[100px]">{c.new}</span></>
                                          : <span className="text-slate-700">{c.new}</span>
                                        }
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              copyToClipboard(item.ip);
                            }}
                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm text-slate-700 transition-colors"
                          >
                            {copiedIP === item.ip ? (
                              <>
                                <Check className="w-4 h-4 text-emerald-600" />
                                <span className="text-emerald-600">Copied!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-4 h-4" />
                                Copy IP
                              </>
                            )}
                          </button>
                          {!isReserved && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingItem(item);
                              }}
                              className="flex items-center justify-center gap-2 px-3 py-2 bg-blue-100 hover:bg-blue-200 rounded-lg text-sm text-blue-700 transition-colors"
                            >
                              <Edit3 className="w-4 h-4" />
                              Edit
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 w-10">
                      <input type="checkbox"
                        className="w-4 h-4 rounded border-slate-300 accent-violet-600 cursor-pointer"
                        checked={sortedData.length > 0 && sortedData.every(i => selectedIPs.has(i.ip))}
                        onChange={e => e.target.checked ? selectAll() : clearSelection()}
                      />
                    </th>
                    {[
                      { label: 'IP Address', field: 'ip' },
                      { label: 'Asset Name', field: 'assetName' },
                      { label: 'Hostname',   field: 'hostname' },
                      { label: 'Range',      field: null },
                      { label: 'Type',       field: 'type' },
                      { label: 'Location',   field: 'location' },
                      { label: 'Service',    field: 'apps' },
                      { label: 'Tags',       field: null },
                      { label: 'Modified',   field: 'updatedAt' },
                      { label: 'Actions',    field: null },
                    ].map(({ label, field }) => (
                      <th key={label} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        {field ? (
                          <button onClick={() => handleSort(field)} className="flex items-center gap-1 hover:text-slate-800 transition-colors">
                            {label}{sortIcon(field)}
                          </button>
                        ) : label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedData.map((item) => {
                    const isReserved = item.assetName === 'Reserved';
                    const isFree = item.assetName === 'Free';
                    const isDHCP = isInDHCPRangeConfig(item.ip);
                    const isFixed = isFixedInDHCPConfig(item.ip);
                    return (
                      <tr
                        key={item.ip}
                        className={`transition-colors ${
                          selectedIPs.has(item.ip)
                            ? 'bg-violet-50'
                            : isFree
                              ? 'bg-emerald-50 hover:bg-emerald-100'
                              : isReserved
                                ? 'opacity-50 hover:bg-slate-50'
                                : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="px-4 py-3 w-10">
                          <input type="checkbox"
                            className="w-4 h-4 rounded border-slate-300 accent-violet-600 cursor-pointer"
                            checked={selectedIPs.has(item.ip)}
                            onChange={e => toggleSelect(item.ip, e)}
                            onClick={e => e.stopPropagation()}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => copyToClipboard(item.ip)}
                            className={`font-mono text-sm font-medium flex items-center gap-2 ${
                              isFree ? 'text-emerald-700 hover:text-emerald-800' : 'text-slate-800 hover:text-emerald-600'
                            }`}
                          >
                            {item.ip}
                            {copiedIP === item.ip && <Check className="w-3 h-3 text-emerald-600" />}
                          </button>
                        </td>
                        <td className={`px-4 py-3 text-sm ${
                          isFree ? 'text-emerald-600 font-semibold' : isReserved ? 'text-slate-400 italic' : 'text-slate-700'
                        }`}>
                          {isFree ? '✓ Available' : item.assetName}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500 max-w-xs truncate">
                          {item.hostname || '—'}
                        </td>
                        <td className="px-4 py-3">
                          {isFree ? (
                            <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-500 text-white">
                              FREE
                            </span>
                          ) : isFixed ? (
                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">
                              Fixed
                            </span>
                          ) : isDHCP ? (
                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">
                              DHCP
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 text-emerald-700">
                              Static
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {item.type && (
                            <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${getTypeColor(item.type)}`}>
                              {item.type}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {item.location && (
                            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getLocationColor(item.location)}`}>
                              {item.location}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">{item.apps || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {(item.tags || []).map(tag => (
                              <button key={tag} onClick={() => setSelectedTag(selectedTag === tag ? '' : tag)}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border transition-colors ${
                                  selectedTag === tag ? 'bg-violet-600 text-white border-violet-600' : 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100'
                                }`}>
                                <Tag className="w-2.5 h-2.5" />{tag}
                              </button>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{formatDate(item.updatedAt)}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => setEditingItem(item)}
                            className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded transition-colors ${
                              isFree
                                ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            {isFree ? <Plus className="w-3 h-3" /> : <Edit3 className="w-3 h-3" />}
                            {isFree ? 'Claim' : 'Edit'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {filteredData.length === 0 && (
          <div className="text-center py-12">
            <Filter className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-700 mb-1">No results found</h3>
            <p className="text-slate-500">Try adjusting your search or filters</p>
          </div>
        )}
      </div>
    </div>
  );
}
