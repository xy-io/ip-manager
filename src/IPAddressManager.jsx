import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, Server, Monitor, Wifi, HardDrive, Camera, Shield, Globe, Filter, X, MapPin, Cpu, Box, CircleDot, ChevronDown, ChevronUp, Copy, Check, Zap, Download, Edit3, Plus, Trash2, Save, AlertCircle, Settings, Upload, FileText, AlertTriangle, CheckCircle, ChevronRight, Tag, ArrowUpDown, ArrowUp, ArrowDown, HelpCircle, LogOut, Moon, Sun, MoreHorizontal } from 'lucide-react';
import * as XLSX from 'xlsx';

// Default network configuration (overridden by Settings modal / localStorage)
const DEFAULT_NETWORK_CONFIG = {
  id: 'net-1',
  networkName: "Home Network",
  subnet: "192.168.0",
  dhcpEnabled: true,
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

// Generates a short unique ID for host groups (Option A linking)
function generateHostId() {
  return `host-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// Settings Modal Component
function SettingsModal({ config, onSave, onClose, onClear, locations, onRenameLocation, onDeleteLocation, tags, onRenameTag, onDeleteTag, canDeleteNetwork, onDeleteNetwork, showFreeInList, onToggleShowFreeInList, ipData, networks, onRestore, dnsConfig, dnsStatus, dnsLoading, onSaveDnsConfig, onRunDns, proxmoxSyncConfig, proxmoxSyncStatus, proxmoxSyncLoading, onSaveProxmoxSyncConfig, onRunProxmoxSync }) {
  const [form, setForm] = useState({
    networkName: config.networkName,
    subnet: config.subnet,
    dhcpEnabled: config.dhcpEnabled !== false, // default true for existing networks
    dhcpStart: String(config.dhcpStart),
    dhcpEnd: String(config.dhcpEnd),
    staticStart: String(config.staticStart),
    staticEnd: String(config.staticEnd),
    fixedInDHCP: (config.fixedInDHCP || []).join(', '),
  });
  const [error, setError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDeleteNetwork, setConfirmDeleteNetwork] = useState(false);
  const [editingLoc, setEditingLoc] = useState(null); // { old, draft }
  const [newLocation, setNewLocation] = useState('');
  const [editingTag, setEditingTag] = useState(null); // { old, draft }
  const [newTag, setNewTag] = useState('');
  const [restoreError, setRestoreError] = useState('');
  const [restorePreview, setRestorePreview] = useState(null); // { networks, ipData, exportedAt }
  const [confirmRestore, setConfirmRestore] = useState(false);
  const restoreFileRef = useRef(null);

  // DNS config form state (local draft until saved)
  const [dnsForm, setDnsForm] = useState({ server: dnsConfig?.server || '', enabled: dnsConfig?.enabled !== false });

  // Proxmox sync form state (local draft until saved)
  const [proxSyncForm, setProxSyncForm] = useState({
    host:            proxmoxSyncConfig?.host            || '',
    token:           proxmoxSyncConfig?.token           || '',
    ignoreTLS:       proxmoxSyncConfig?.ignoreTLS       !== false,
    enabled:         proxmoxSyncConfig?.enabled         === true,
    intervalMinutes: proxmoxSyncConfig?.intervalMinutes || 60,
  });
  const [showSyncToken, setShowSyncToken] = useState(false);
  const [proxSyncSaved, setProxSyncSaved] = useState(false);
  const [activeTab, setActiveTab] = useState('network');

  // Account / change-password state
  const [pwForm, setPwForm] = useState({ currentPassword: '', newUsername: '', newPassword: '', confirmPassword: '' });
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  const handleChangePassword = async () => {
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
    if (form.dhcpEnabled) {
      if (!rangePattern.test(form.dhcpStart.trim()) || !rangePattern.test(form.dhcpEnd.trim()))
        return setError(`DHCP range values must be in the format ${rangeHint} for a /${is16 ? '16' : '24'} network.`);
      if (rangeOrdinal(form.dhcpStart.trim(), subnet) >= rangeOrdinal(form.dhcpEnd.trim(), subnet))
        return setError('DHCP start must be less than DHCP end.');
    }

    if (!rangePattern.test(form.staticStart.trim()) || !rangePattern.test(form.staticEnd.trim()))
      return setError(`Static range values must be in the format ${rangeHint} for a /${is16 ? '16' : '24'} network.`);

    const dhcpStart   = form.dhcpEnabled ? form.dhcpStart.trim() : '';
    const dhcpEnd     = form.dhcpEnabled ? form.dhcpEnd.trim() : '';
    const staticStart = form.staticStart.trim();
    const staticEnd   = form.staticEnd.trim();

    if (rangeOrdinal(staticStart, subnet) >= rangeOrdinal(staticEnd, subnet))
      return setError('Static start must be less than static end.');

    const fixedInDHCP = form.dhcpEnabled
      ? form.fixedInDHCP.split(',').map(s => s.trim()).filter(s => s && rangePattern.test(s))
      : [];

    const newConfig = { networkName: form.networkName, subnet, dhcpEnabled: form.dhcpEnabled, dhcpStart, dhcpEnd, staticStart, staticEnd, fixedInDHCP };
    onSave(newConfig); // parent handles persistence (API or localStorage)
  };

  const f = (key) => ({ value: form[key], onChange: e => setForm(p => ({ ...p, [key]: e.target.value })) });
  const inputCls = "w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm";
  const labelCls = "block text-sm font-medium text-slate-700 mb-1";

  const settingsTabs = [
    { id: 'network',  label: 'Network' },
    { id: 'dns',      label: 'DNS' },
    { id: 'proxmox',  label: 'Proxmox Sync' },
    { id: 'backup',   label: 'Backup' },
    { id: 'manage',   label: 'Locations & Tags' },
    { id: 'account',  label: 'Account' },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Settings className="w-5 h-5 text-slate-500" />
              Settings
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">Configure your network and app preferences</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Body: sidebar + content */}
        <div className="flex flex-1 overflow-hidden">

          {/* Sidebar nav */}
          <div className="w-44 border-r border-slate-100 py-3 flex-shrink-0 bg-slate-50 overflow-y-auto rounded-bl-2xl">
            {settingsTabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${activeTab === tab.id ? 'bg-white text-slate-800 font-semibold shadow-sm border-r-2 border-emerald-500' : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content pane */}
          <div className="flex-1 overflow-y-auto p-6">

            {/* ── NETWORK TAB ── */}
            {activeTab === 'network' && (
              <form onSubmit={handleSave} className="space-y-5">
                <div>
                  <h3 className="text-base font-semibold text-slate-800 mb-1">Network Configuration</h3>
                  <p className="text-xs text-slate-500 mb-4">Define the IP layout for this network. Changes take effect when you click Save.</p>
                </div>

                {/* Network identity */}
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Network Identity</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>Network Name</label>
                      <input type="text" className={inputCls} placeholder="e.g. Home Network" {...f('networkName')} />
                    </div>
                    <div>
                      <label className={labelCls}>Subnet Prefix</label>
                      <input type="text" className={inputCls} placeholder="e.g. 192.168.0 or 192.168" {...f('subnet')} />
                      <p className="text-xs text-slate-400 mt-1">Paste the network address — trailing zeros stripped automatically.</p>
                    </div>
                  </div>
                </div>

                {/* DHCP + Static side by side */}
                <div className="grid grid-cols-2 gap-4">
                  {/* DHCP range */}
                  <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider">⚡ DHCP Pool</p>
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <span className="text-xs text-amber-700 font-medium">{form.dhcpEnabled ? 'On' : 'Off'}</span>
                        <button
                          type="button"
                          onClick={() => setForm(f => ({ ...f, dhcpEnabled: !f.dhcpEnabled }))}
                          className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${form.dhcpEnabled ? 'bg-amber-500' : 'bg-slate-300'}`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ${form.dhcpEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                      </label>
                    </div>
                    {form.dhcpEnabled ? (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className={labelCls}>Start</label>
                          <input type="text" className={inputCls} placeholder={subnetOctetCount(form.subnet) === 2 ? "0.1" : "1"} {...f('dhcpStart')} />
                        </div>
                        <div>
                          <label className={labelCls}>End</label>
                          <input type="text" className={inputCls} placeholder={subnetOctetCount(form.subnet) === 2 ? "0.254" : "170"} {...f('dhcpEnd')} />
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-amber-600">No DHCP pool — all IPs treated as static.</p>
                    )}
                  </div>

                  {/* Static range */}
                  <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200 space-y-3">
                    <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">🖥 Static Range</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={labelCls}>Start</label>
                        <input type="text" className={inputCls} placeholder={subnetOctetCount(form.subnet) === 2 ? "1.1" : "171"} {...f('staticStart')} />
                      </div>
                      <div>
                        <label className={labelCls}>End</label>
                        <input type="text" className={inputCls} placeholder={subnetOctetCount(form.subnet) === 2 ? "254.254" : "254"} {...f('staticEnd')} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* DHCP Reservations */}
                {form.dhcpEnabled && (
                  <div className="p-4 bg-blue-50 rounded-xl border border-blue-200 space-y-3">
                    <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider">🔒 DHCP Reservations</p>
                    <div>
                      <label className={labelCls}>Reserved IPs (host portions)</label>
                      <input type="text" className={inputCls} placeholder={subnetOctetCount(form.subnet) === 2 ? "e.g. 0.6, 0.50" : "e.g. 6, 50"} {...f('fixedInDHCP')} />
                      <p className="text-xs text-slate-400 mt-1">Comma-separated — inside or outside the DHCP pool.</p>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    {error}
                  </div>
                )}

                {/* Preview */}
                {(() => { const ps = normaliseSubnet(form.subnet); return (
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs font-mono text-slate-500 space-y-1">
                    <p><span className="text-slate-400">Network:      </span>{subnetCIDR(ps)}</p>
                    {form.dhcpEnabled
                      ? <p><span className="text-slate-400">DHCP pool:    </span>{ps}.{form.dhcpStart} – {ps}.{form.dhcpEnd}</p>
                      : <p><span className="text-slate-400">DHCP pool:    </span><span className="text-slate-400 not-italic">disabled</span></p>}
                    <p><span className="text-slate-400">Static range: </span>{ps}.{form.staticStart} – {ps}.{form.staticEnd}</p>
                    {form.dhcpEnabled && form.fixedInDHCP && <p><span className="text-slate-400">Fixed IPs:    </span>{form.fixedInDHCP.split(',').map(s => `${ps}.${s.trim()}`).join(', ')}</p>}
                  </div>
                ); })()}

                <button
                  type="submit"
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors"
                >
                  <Save className="w-4 h-4" />
                  Save Network Settings
                </button>

                {/* Display Preferences */}
                <div className="pt-4 border-t border-slate-200">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Display</p>
                  <label className="flex items-center justify-between gap-3 cursor-pointer select-none group">
                    <div>
                      <p className="text-sm font-medium text-slate-700">Show free IP cards in main list</p>
                      <p className="text-xs text-slate-400 mt-0.5">Turn off for large /16 subnets — hiding free cards keeps the page fast.</p>
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
              </form>
            )}

            {/* ── DNS TAB ── */}
            {activeTab === 'dns' && onSaveDnsConfig && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-base font-semibold text-slate-800 mb-1">DNS Reverse Lookup</h3>
                  <p className="text-xs text-slate-500 mb-4">Resolves PTR records for all tracked IPs. Runs automatically every 24 hours. Leave the server blank to use the system default resolver.</p>
                </div>
                <div>
                  <label className={labelCls}>DNS Server</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="192.168.0.6 or 8.8.8.8 — blank = system default"
                      value={dnsForm.server}
                      onChange={e => setDnsForm(p => ({ ...p, server: e.target.value }))}
                      className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => onSaveDnsConfig({ server: dnsForm.server, enabled: dnsForm.enabled })}
                      className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-medium whitespace-nowrap transition-colors"
                    >
                      Save
                    </button>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={dnsForm.enabled}
                    onChange={e => setDnsForm(p => ({ ...p, enabled: e.target.checked }))}
                    className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  Enable automatic DNS lookup (every 24 hours)
                </label>

                <div className="pt-3 border-t border-slate-200">
                  {/* Run Now row */}
                  <div className="flex items-center gap-3 mb-3">
                    <button
                      type="button"
                      onClick={onRunDns}
                      disabled={dnsLoading}
                      className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-teal-50 hover:text-teal-700 text-slate-600 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {dnsLoading ? (
                        <><span className="animate-spin text-base">⟳</span> Looking up…</>
                      ) : (
                        'Run Now'
                      )}
                    </button>
                    {dnsConfig?.lastRun && (
                      <span className="text-xs text-slate-400">
                        Last run: {new Date(dnsConfig.lastRun).toLocaleString()}
                      </span>
                    )}
                  </div>

                  {/* DNS result log */}
                  {dnsLoading && (
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-teal-50 border border-teal-200 rounded-lg text-xs text-teal-700">
                      <span className="animate-spin text-sm">⟳</span>
                      Resolving PTR records…
                    </div>
                  )}

                  {!dnsLoading && dnsConfig?.lastRun && (() => {
                    const entries = Object.entries(dnsStatus || {});
                    if (!entries.length) return null;
                    const resolved   = entries.filter(([, v]) => v?.ptr);
                    const unresolved = entries.filter(([, v]) => !v?.ptr);
                    const allOk = unresolved.length === 0;
                    return (
                      <div className="border border-slate-200 rounded-lg overflow-hidden">
                        {/* Summary header */}
                        <div className={`flex items-center justify-between px-3 py-2 border-b ${allOk ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                          <span className={`text-xs font-semibold ${allOk ? 'text-emerald-800' : 'text-amber-800'}`}>
                            {entries.length} IPs checked — {resolved.length} resolved
                            {unresolved.length > 0 && <span className="text-amber-600"> · {unresolved.length} unresolved</span>}
                          </span>
                          <span className="text-xs text-slate-400">Last run</span>
                        </div>
                        {/* Resolved PTR records */}
                        {resolved.length > 0 && (
                          <div className="max-h-48 overflow-y-auto divide-y divide-slate-100">
                            {resolved.map(([ip, v]) => (
                              <div key={ip} className="flex items-center gap-3 px-3 py-1.5 bg-white text-xs">
                                <span className="font-mono text-slate-400 w-28 flex-shrink-0">{ip}</span>
                                <span className="text-slate-700 truncate">{v.ptr}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Unresolved IPs (shown only if there are any) */}
                        {unresolved.length > 0 && (
                          <div className="border-t border-slate-100">
                            <div className="px-3 py-1.5 bg-slate-50 text-xs text-slate-400 font-medium">No PTR record</div>
                            <div className="max-h-24 overflow-y-auto divide-y divide-slate-100">
                              {unresolved.map(([ip]) => (
                                <div key={ip} className="flex items-center gap-3 px-3 py-1.5 bg-white text-xs">
                                  <span className="font-mono text-slate-400 w-28 flex-shrink-0">{ip}</span>
                                  <span className="text-slate-400 italic">—</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* ── PROXMOX SYNC TAB ── */}
            {activeTab === 'proxmox' && onSaveProxmoxSyncConfig && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-800 mb-1">Proxmox Scheduled Sync</h3>
                  <p className="text-xs text-slate-500 mb-4">Automatically re-queries Proxmox on a schedule and updates entries that have drifted — useful for HA failovers where a VM or LXC migrates to a different node. Only entries tagged <span className="font-mono bg-slate-100 px-1 rounded">proxmox</span> are updated.</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Proxmox host</label>
                    <input
                      type="text"
                      placeholder="192.168.0.50 or pve.home.lab"
                      value={proxSyncForm.host}
                      onChange={e => setProxSyncForm(p => ({ ...p, host: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
                    />
                    <p className="text-xs text-slate-400 mt-1">Port defaults to 8006.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Sync interval</label>
                    <select
                      value={proxSyncForm.intervalMinutes}
                      onChange={e => setProxSyncForm(p => ({ ...p, intervalMinutes: parseInt(e.target.value) }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    >
                      <option value={15}>Every 15 minutes</option>
                      <option value={30}>Every 30 minutes</option>
                      <option value={60}>Every 1 hour</option>
                      <option value={120}>Every 2 hours</option>
                      <option value={360}>Every 6 hours</option>
                      <option value={1440}>Every 24 hours</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">API token</label>
                  <div className="flex gap-2">
                    <input
                      type={showSyncToken ? 'text' : 'password'}
                      placeholder="root@pam!tokenid=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      value={proxSyncForm.token}
                      onChange={e => setProxSyncForm(p => ({ ...p, token: e.target.value }))}
                      className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSyncToken(v => !v)}
                      className="px-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-500 hover:bg-slate-50 transition-colors"
                    >
                      {showSyncToken ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={proxSyncForm.ignoreTLS}
                        onChange={e => setProxSyncForm(p => ({ ...p, ignoreTLS: e.target.checked }))}
                        className="rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                      />
                      Ignore TLS errors
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={proxSyncForm.enabled}
                        onChange={e => setProxSyncForm(p => ({ ...p, enabled: e.target.checked }))}
                        className="rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                      />
                      Enable automatic sync
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await onSaveProxmoxSyncConfig(proxSyncForm);
                      setProxSyncSaved(true);
                      setTimeout(() => setProxSyncSaved(false), 2000);
                    }}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium whitespace-nowrap transition-colors"
                  >
                    {proxSyncSaved ? '✓ Saved' : 'Save'}
                  </button>
                </div>

                <div className="pt-3 border-t border-slate-200">
                  {/* Sync Now button row */}
                  <div className="flex items-center gap-3 mb-3">
                    <button
                      type="button"
                      onClick={onRunProxmoxSync}
                      disabled={proxmoxSyncLoading || proxmoxSyncStatus?.running || !proxmoxSyncConfig?.host || !proxmoxSyncConfig?.token}
                      className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-purple-50 hover:text-purple-700 text-slate-600 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {(proxmoxSyncLoading || proxmoxSyncStatus?.running) ? (
                        <><span className="animate-spin text-base">⟳</span> Syncing…</>
                      ) : (
                        'Sync Now'
                      )}
                    </button>
                    {proxmoxSyncConfig?.lastRun && (
                      <span className="text-xs text-slate-400">
                        Last run: {new Date(proxmoxSyncConfig.lastRun).toLocaleString()}
                      </span>
                    )}
                  </div>

                  {/* Sync result log */}
                  {(proxmoxSyncLoading || proxmoxSyncStatus?.running) && (
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-700">
                      <span className="animate-spin text-sm">⟳</span>
                      Querying Proxmox…
                    </div>
                  )}

                  {!proxmoxSyncStatus?.running && proxmoxSyncStatus?.lastError && (
                    <div className="px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-xs font-semibold text-red-700 mb-0.5">Sync failed</p>
                      <p className="text-xs text-red-600 font-mono break-all">{proxmoxSyncStatus.lastError}</p>
                    </div>
                  )}

                  {!proxmoxSyncStatus?.running && !proxmoxSyncStatus?.lastError && proxmoxSyncConfig?.lastRun && proxmoxSyncStatus?.changesFound === 0 && (
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700">
                      <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      All entries up to date — no drift detected
                    </div>
                  )}

                  {!proxmoxSyncStatus?.running && !proxmoxSyncStatus?.lastError && (proxmoxSyncStatus?.changeLog || []).length > 0 && (
                    <div className="border border-amber-200 rounded-lg overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 bg-amber-50 border-b border-amber-200">
                        <span className="text-xs font-semibold text-amber-800">
                          {proxmoxSyncStatus.changesFound} entr{proxmoxSyncStatus.changesFound !== 1 ? 'ies' : 'y'} updated
                        </span>
                        <span className="text-xs text-amber-600">Last run</span>
                      </div>
                      <div className="max-h-48 overflow-y-auto divide-y divide-slate-100">
                        {(proxmoxSyncStatus.changeLog).map((entry, i) => (
                          <div key={i} className="px-3 py-2 bg-white text-xs">
                            <div className="flex items-baseline gap-1.5 mb-1">
                              <span className="font-mono text-slate-500">{entry.ip}</span>
                              <span className="font-medium text-slate-700">{entry.name}</span>
                            </div>
                            <div className="space-y-0.5">
                              {entry.changes.location && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-slate-400 w-16 flex-shrink-0">Node</span>
                                  <span className="text-red-500 line-through">{entry.changes.location.from || '—'}</span>
                                  <span className="text-slate-400">→</span>
                                  <span className="text-emerald-600 font-medium">{entry.changes.location.to}</span>
                                </div>
                              )}
                              {entry.changes.assetName && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-slate-400 w-16 flex-shrink-0">Name</span>
                                  <span className="text-red-500 line-through">{entry.changes.assetName.from || '—'}</span>
                                  <span className="text-slate-400">→</span>
                                  <span className="text-emerald-600 font-medium">{entry.changes.assetName.to}</span>
                                </div>
                              )}
                              {entry.changes.notes && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-slate-400 w-16 flex-shrink-0">Notes</span>
                                  <span className="text-slate-500 truncate max-w-xs">{entry.changes.notes.to}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── BACKUP TAB ── */}
            {activeTab === 'backup' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-base font-semibold text-slate-800 mb-1">Backup & Restore</h3>
                  <p className="text-xs text-slate-500 mb-4">A full backup includes all IP entries, network configs, tags, notes, and change history — everything needed to fully restore the app on a new machine.</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={handleDownloadBackup}
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-700 hover:bg-slate-800 text-white font-medium rounded-lg transition-colors text-sm"
                  >
                    <Download className="w-4 h-4" />
                    Download Backup (.json)
                  </button>
                  <button
                    type="button"
                    onClick={() => { setRestoreError(''); setConfirmRestore(false); restoreFileRef.current?.click(); }}
                    className="flex items-center justify-center gap-2 px-4 py-3 border border-slate-300 text-slate-600 hover:bg-slate-50 font-medium rounded-lg transition-colors text-sm"
                  >
                    <Upload className="w-4 h-4" />
                    Restore from Backup…
                  </button>
                </div>

                <input type="file" accept=".json" ref={restoreFileRef} onChange={handleRestoreFileChange} className="hidden" />

                {restoreError && (
                  <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    {restoreError}
                  </div>
                )}

                {confirmRestore && restorePreview && (
                  <div className="space-y-2">
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
            )}

            {/* ── LOCATIONS & TAGS TAB ── */}
            {activeTab === 'manage' && (
              <div className="grid grid-cols-2 gap-6">

                {/* Locations column */}
                <div>
                  <h3 className="text-base font-semibold text-slate-800 mb-1">Locations</h3>
                  <p className="text-xs text-slate-500 mb-3">Rename or remove location labels used across your entries.</p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {locations.filter(l => l).map(loc => (
                      <div key={loc} className="flex items-center gap-1 bg-slate-100 rounded-lg px-2 py-1">
                        {editingLoc?.old === loc ? (
                          <>
                            <input
                              autoFocus
                              className="text-xs border border-blue-300 rounded px-1 py-0.5 w-24 outline-none"
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
                      <p className="text-xs text-slate-400">No locations yet.</p>
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

                {/* Tags column */}
                <div>
                  <h3 className="text-base font-semibold text-slate-800 mb-1">Tags</h3>
                  <p className="text-xs text-slate-500 mb-3">Rename or remove tags applied to IP entries.</p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {tags.filter(t => t).map(tag => (
                      <div key={tag} className="flex items-center gap-1 bg-slate-100 rounded-lg px-2 py-1">
                        {editingTag?.old === tag ? (
                          <>
                            <input
                              autoFocus
                              className="text-xs border border-blue-300 rounded px-1 py-0.5 w-24 outline-none"
                              value={editingTag.draft}
                              onChange={e => setEditingTag(ev => ({ ...ev, draft: e.target.value }))}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && editingTag.draft.trim()) { onRenameTag(tag, editingTag.draft.trim()); setEditingTag(null); }
                                if (e.key === 'Escape') setEditingTag(null);
                              }}
                            />
                            <button type="button" onClick={() => { if (editingTag.draft.trim()) { onRenameTag(tag, editingTag.draft.trim()); setEditingTag(null); }}} className="text-blue-500 hover:text-blue-700 text-xs font-bold">✓</button>
                            <button type="button" onClick={() => setEditingTag(null)} className="text-slate-400 hover:text-slate-600 text-xs">✕</button>
                          </>
                        ) : (
                          <>
                            <span className="text-xs text-slate-700">{tag}</span>
                            <button type="button" onClick={() => setEditingTag({ old: tag, draft: tag })} className="text-slate-400 hover:text-blue-500 text-xs ml-1" title="Rename tag">✎</button>
                            <button type="button" onClick={() => onDeleteTag(tag)} className="text-slate-400 hover:text-red-500 text-xs" title="Remove tag from all entries">✕</button>
                          </>
                        )}
                      </div>
                    ))}
                    {tags.filter(t => t).length === 0 && (
                      <p className="text-xs text-slate-400">No tags yet — add tags to IP entries to see them here.</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-1.5 outline-none focus:border-teal-400"
                      placeholder="Add a new tag…"
                      value={newTag}
                      onChange={e => setNewTag(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newTag.trim()) { onRenameTag(null, newTag.trim()); setNewTag(''); }
                      }}
                    />
                    <button
                      type="button"
                      disabled={!newTag.trim()}
                      onClick={() => { onRenameTag(null, newTag.trim()); setNewTag(''); }}
                      className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors"
                    >Add</button>
                  </div>
                </div>
              </div>
            )}

            {/* ── ACCOUNT TAB ── */}
            {activeTab === 'account' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-base font-semibold text-slate-800 mb-1">Account</h3>
                  <p className="text-xs text-slate-500 mb-4">Update your login credentials. You will be signed out after saving.</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
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
                </div>

                {pwError && (
                  <p className="text-red-600 text-sm flex items-center gap-1">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />{pwError}
                  </p>
                )}
                {pwSuccess && (
                  <p className="text-emerald-600 text-sm">✓ Credentials updated — signing you out…</p>
                )}
                <button type="button" disabled={pwLoading || pwSuccess}
                  onClick={handleChangePassword}
                  className="w-full bg-slate-700 hover:bg-slate-800 disabled:bg-slate-300 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors">
                  {pwLoading ? 'Saving…' : 'Update Login Credentials'}
                </button>

                {/* Danger Zone */}
                <div className="pt-4 border-t border-slate-200">
                  <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-3">Danger Zone</p>
                  <div className="space-y-3">
                    {canDeleteNetwork && (
                      !confirmDeleteNetwork ? (
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
                              className="flex-1 px-4 py-2 border border-slate-300 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors text-sm font-medium">Cancel</button>
                            <button type="button" onClick={onDeleteNetwork}
                              className="flex-1 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors text-sm font-medium">Yes, Delete Network</button>
                          </div>
                        </div>
                      )
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
                          <button type="button" onClick={() => setConfirmClear(false)}
                            className="flex-1 px-4 py-2 border border-slate-300 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors text-sm font-medium">Cancel</button>
                          <button type="button" onClick={onClear}
                            className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-sm font-medium">Yes, Clear Everything</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
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

// ── Proxmox import modal ──────────────────────────────────────────────────────

function ProxmoxImportModal({ onClose, onImport }) {
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
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

// ── ARP Scan Modal ────────────────────────────────────────────────────────────

function ARPScanModal({ onClose, onImport, subnet, networkConfig }) {
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
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

// ── selfh.st/icons integration ────────────────────────────────────────────
// Curated slug map: service keywords → selfh.st icon slug
// More specific phrases listed before shorter keywords to match first
const SH_SLUG_MAP = [
  ['nginx proxy manager', 'nginx-proxy-manager'],
  ['adguard home',        'adguard-home'],
  ['uptime kuma',         'uptime-kuma'],
  ['home assistant',      'home-assistant'],
  ['truenas scale',       'truenas-scale'],
  ['truenas core',        'truenas-core'],
  ['paperless-ngx',       'paperless-ngx'],
  ['paperless ngx',       'paperless-ngx'],
  ['speedtest tracker',   'speedtest-tracker'],
  ['technitium dns',      'technitium-dns'],
  ['grafana loki',        'grafana-loki'],
  ['node-red',            'node-red'],
  ['nodered',             'node-red'],
  ['wiki.js',             'wiki-js'],
  ['wikijs',              'wiki-js'],
  ['homeassistant',       'home-assistant'],
  ['pihole',              'pi-hole'],
  ['pi-hole',             'pi-hole'],
  ['adguard',             'adguard-home'],
  ['unifi',               'ubiquiti-unifi'],
  ['truenas',             'truenas-scale'],
  ['technitium',          'technitium-dns'],
  ['speedtest',           'speedtest-tracker'],
  ['synology',            'synology-dsm'],
  ['proxmox',             'proxmox-ve'],
  ['sonarr',              'sonarr'],
  ['radarr',              'radarr'],
  ['lidarr',              'lidarr'],
  ['readarr',             'readarr'],
  ['prowlarr',            'prowlarr'],
  ['bazarr',              'bazarr'],
  ['overseerr',           'overseerr'],
  ['jellyseerr',          'jellyseerr'],
  ['tautulli',            'tautulli'],
  ['sabnzbd',             'sabnzbd'],
  ['qbittorrent',         'qbittorrent'],
  ['transmission',        'transmission'],
  ['deluge',              'deluge'],
  ['rutorrent',           'rutorrent'],
  ['plex',                'plex'],
  ['jellyfin',            'jellyfin'],
  ['emby',                'emby'],
  ['vaultwarden',         'vaultwarden'],
  ['bitwarden',           'bitwarden'],
  ['nextcloud',           'nextcloud'],
  ['portainer',           'portainer'],
  ['traefik',             'traefik'],
  ['caddy',               'caddy'],
  ['nginx',               'nginx'],
  ['grafana',             'grafana'],
  ['prometheus',          'prometheus'],
  ['influxdb',            'influxdb'],
  ['gitea',               'gitea'],
  ['gitlab',              'gitlab'],
  ['homer',               'homer'],
  ['homarr',              'homarr'],
  ['heimdall',            'heimdall'],
  ['dashy',               'dashy'],
  ['mosquitto',           'mosquitto'],
  ['wireguard',           'wireguard'],
  ['tailscale',           'tailscale'],
  ['docker',              'docker'],
  ['authentik',           'authentik'],
  ['authelia',            'authelia'],
  ['keycloak',            'keycloak'],
  ['immich',              'immich'],
  ['photoprism',          'photoprism'],
  ['frigate',             'frigate'],
  ['homebridge',          'homebridge'],
  ['esphome',             'esphome'],
  ['zigbee2mqtt',         'zigbee2mqtt'],
  ['duplicati',           'duplicati'],
  ['netdata',             'netdata'],
  ['scrutiny',            'scrutiny'],
  ['ntfy',                'ntfy'],
  ['gotify',              'gotify'],
  ['actual',              'actual-budget'],
  ['bookstack',           'bookstack'],
  ['freshrss',            'freshrss'],
  ['miniflux',            'miniflux'],
  ['minio',               'minio'],
  ['redis',               'redis'],
  ['postgresql',          'postgresql'],
  ['postgres',            'postgresql'],
  ['mariadb',             'mariadb'],
  ['mysql',               'mysql'],
  ['mongodb',             'mongodb'],
  ['cockpit',             'cockpit'],
  ['zabbix',              'zabbix'],
  ['paperless',           'paperless-ngx'],
  ['myspeed',             'myspeed'],
];

const getServiceSlug = (apps, assetName) => {
  // Match against the service name first; only fall back to assetName when
  // apps is blank (so a hostname like "speedtest-pi" can't hijack the icon
  // for an unrelated service running on that device).
  const primary   = (apps      || '').toLowerCase();
  const secondary = (assetName || '').toLowerCase();
  const haystack  = primary || secondary;

  for (const [keyword, slug] of SH_SLUG_MAP) {
    if (haystack.includes(keyword)) return slug;
  }
  // Auto-slug as a last attempt (works for simple single-word service names)
  const svc = primary.trim()
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
  return svc || null;
};

// Tries selfh.st CDN icon first; in dark mode requests the -light variant
// (white SVG on dark bg), retrying with the standard coloured icon if missing.
// Falls back to the existing Lucide icon if the CDN has nothing for the slug.
const ServiceIcon = ({ apps, assetName, darkMode, imgClass, lucideClass }) => {
  const [failed, setFailed] = React.useState(false);
  const slug = getServiceSlug(apps, assetName);
  const FallbackIcon = getServiceIcon(apps, assetName);

  if (slug && !failed) {
    const base = `https://cdn.jsdelivr.net/gh/selfhst/icons/svg/${slug}`;
    const src  = darkMode ? `${base}-light.svg` : `${base}.svg`;
    return (
      <img
        src={src}
        alt=""
        className={imgClass}
        onError={(e) => {
          if (darkMode && !e.currentTarget.dataset.triedStd) {
            // Dark mode: -light.svg missing → try standard coloured icon
            e.currentTarget.dataset.triedStd = '1';
            e.currentTarget.src = `${base}.svg`;
          } else {
            setFailed(true);
          }
        }}
      />
    );
  }
  return <FallbackIcon className={lucideClass} />;
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
  if (config.dhcpEnabled === false) return false;
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

// ── Help Modal ────────────────────────────────────────────────────────────────
function HelpModal({ onClose }) {
  const [activeSection, setActiveSection] = useState('overview');

  const sections = [
    { id: 'overview',   label: 'Overview' },
    { id: 'status',     label: 'Status Indicators' },
    { id: 'managing',   label: 'Managing IPs' },
    { id: 'networks',   label: 'Networks & Settings' },
    { id: 'proxmox',    label: 'Proxmox Import' },
    { id: 'proxmoxsync', label: 'Proxmox Sync' },
    { id: 'hostgroup',  label: 'Multiple IPs per Host' },
    { id: 'arp',        label: 'ARP Scan' },
    { id: 'ping',       label: 'Ping / Reachability' },
    { id: 'backup',     label: 'Backup & Restore' },
    { id: 'importexp',  label: 'Import & Export' },
    { id: 'dns',        label: 'DNS Lookup' },
    { id: 'shortcuts',  label: 'Keyboard Shortcuts' },
  ];

  /* ── shared style helpers ── */
  const H2 = ({ children }) => <h3 className="text-base font-bold text-slate-800 mb-2">{children}</h3>;
  const H3 = ({ children }) => <h4 className="text-sm font-semibold text-slate-700 mt-4 mb-1.5">{children}</h4>;
  const P  = ({ children }) => <p className="text-sm text-slate-600 leading-relaxed mb-3">{children}</p>;
  const Kbd = ({ children }) => <kbd className="inline-block px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-xs font-mono text-slate-700">{children}</kbd>;
  const Badge = ({ color, children }) => {
    const colors = {
      green:  'bg-emerald-100 text-emerald-700 border-emerald-200',
      amber:  'bg-amber-100 text-amber-700 border-amber-200',
      blue:   'bg-blue-100 text-blue-700 border-blue-200',
      slate:  'bg-slate-100 text-slate-600 border-slate-200',
      violet: 'bg-violet-100 text-violet-700 border-violet-200',
    };
    return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${colors[color] || colors.slate}`}>{children}</span>;
  };
  const Row = ({ label, children }) => (
    <div className="flex gap-3 py-2 border-b border-slate-100 last:border-0">
      <div className="w-32 flex-shrink-0 text-xs font-semibold text-slate-500 pt-0.5">{label}</div>
      <div className="text-sm text-slate-600 flex-1">{children}</div>
    </div>
  );

  /* ── section content ── */
  const content = {
    overview: (
      <div>
        <H2>Overview</H2>
        <P>IP Address Manager gives you a single place to track every device on your home lab network — replacing the Excel spreadsheet you've been using for years.</P>
        <P>Each IP address gets a <strong>card</strong> (or a table row) showing the asset name, hostname, device type, service/app, physical location, tags, and notes. Free IPs in your static range are shown as green "Available" cards so you can claim them instantly.</P>

        <H3>Views</H3>
        <P><strong>Cards</strong> — visual grid, ideal for browsing. Click a card to expand its details and history. Press <Kbd>c</Kbd> to switch.</P>
        <P><strong>Table</strong> — dense, sortable list. Click any column header to sort. Press <Kbd>t</Kbd> to switch.</P>

        <H3>The header bar</H3>
        <div className="text-sm text-slate-600 space-y-1.5">
          <Row label="SQLite badge">Server mode — data saved to the server database and shared across all users/browsers.</Row>
          <Row label="Local badge">Browser-only mode — no server detected; data saved to this browser's localStorage.</Row>
          <Row label="Proxmox">Discover and import VMs & LXC containers from a Proxmox host.</Row>
          <Row label="ARP Scan">Sweep your subnet for active devices and import untracked ones.</Row>
          <Row label="Ping">Force an immediate reachability check of all tracked IPs.</Row>
          <Row label="DNS">Run a reverse DNS (PTR) lookup for all tracked IPs — see what your DNS server thinks each IP is called.</Row>
          <Row label="Import">Load IP data from a CSV or Excel file.</Row>
          <Row label="Export">Download all data as a formatted .xlsx file.</Row>
          <Row label="⚙">Network Settings — subnet, DHCP range, DNS server, locations, tags, backup & restore.</Row>
        </div>
      </div>
    ),

    status: (
      <div>
        <H2>Status Indicators</H2>

        <H3>Ping dots (next to each IP address)</H3>
        <div className="space-y-2 mb-4">
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400 flex-shrink-0" />
            <span><strong>Green</strong> — device responded to the last ping. Online.</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-400 flex-shrink-0" />
            <span><strong>Red</strong> — no response. Offline or unreachable.</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-300 flex-shrink-0" />
            <span><strong>Grey</strong> — status not yet known. Ping hasn't run yet, or the server is starting up.</span>
          </div>
          <P>Free (available) and Reserved IPs are not pinged — dots only appear on assigned entries.</P>
        </div>

        <H3>Card / row badges</H3>
        <div className="space-y-2">
          <div className="flex items-center gap-3"><Badge color="green">AVAILABLE</Badge><span className="text-sm text-slate-600">Free IP — click to claim it for a new device.</span></div>
          <div className="flex items-center gap-3"><Badge color="amber">DHCP</Badge><span className="text-sm text-slate-600">IP falls inside your DHCP pool — assigned dynamically by your router.</span></div>
          <div className="flex items-center gap-3"><Badge color="blue">Fixed</Badge><span className="text-sm text-slate-600">DHCP reservation — the router always gives this device the same IP.</span></div>
          <div className="flex items-center gap-3"><Badge color="slate">LXC / VM / Physical…</Badge><span className="text-sm text-slate-600">Device type — shown when the IP is in the static range and has no other badge.</span></div>
          <div className="flex items-center gap-3"><Badge color="violet">tag name</Badge><span className="text-sm text-slate-600">Tags assigned to the entry — searchable and filterable.</span></div>
        </div>
      </div>
    ),

    managing: (
      <div>
        <H2>Managing IPs</H2>

        <H3>Claiming a free IP</H3>
        <P>Click any green <Badge color="green">AVAILABLE</Badge> card to open the edit form. Fill in the details and click <strong>Save</strong>. The IP moves from free to assigned immediately.</P>

        <H3>Editing an entry</H3>
        <P>Click any card or table row to expand it, then click the <strong>Edit</strong> button. You can change the asset name, hostname, type, service/app, location, tags, and notes. Every save is recorded in the change history shown at the bottom of the expanded card.</P>

        <H3>Releasing an IP</H3>
        <P>Open the edit form for an assigned entry and click <strong>Release IP</strong> (shown at the bottom). The entry reverts to a free card. All its data is cleared.</P>

        <H3>Bulk operations</H3>
        <P>Hover any card to reveal a checkbox in the top-left corner. Click it (or click multiple cards while holding nothing — just click the checkbox) to select entries. A bulk action bar appears at the bottom of the screen with options to:</P>
        <ul className="list-disc list-inside text-sm text-slate-600 space-y-1 mb-3 ml-2">
          <li>Edit type, location, or tags across all selected entries at once</li>
          <li>Delete all selected entries</li>
          <li>Clear the selection</li>
        </ul>

        <H3>Searching & filtering</H3>
        <P>The search bar at the top filters by any field — name, hostname, IP, service, location, tag, or notes. Press <Kbd>/</Kbd> from anywhere to jump to it. Press <Kbd>Esc</Kbd> to clear.</P>
        <P>Use the <strong>Filter</strong> button next to the search bar to narrow by type, location, or tag.</P>

        <H3>Copy an IP</H3>
        <P>In Table view, click any IP address to copy it to the clipboard instantly. In Card view, expand the card and use the <strong>Copy IP</strong> button.</P>
      </div>
    ),

    networks: (
      <div>
        <H2>Networks & Settings</H2>
        <P>Click the <strong>⚙</strong> icon in the header to open Settings for the active network.</P>

        <H3>Network ranges</H3>
        <P>The app understands your network layout so it can colour-code entries correctly:</P>
        <div className="text-sm text-slate-600 space-y-1 mb-3">
          <Row label="Subnet">Your network prefix — e.g. <code className="font-mono bg-slate-100 px-1 rounded text-xs">192.168.0.0</code> or <code className="font-mono bg-slate-100 px-1 rounded text-xs">192.168.0</code>. Trailing zeros are stripped automatically.</Row>
          <Row label="DHCP enabled">Toggle the DHCP pool on or off. Disable for fully static networks.</Row>
          <Row label="DHCP range">Start and end of the pool your router manages. Entries here get the amber DHCP badge.</Row>
          <Row label="DHCP Reservations">Host-portion octets of IPs that are fixed DHCP leases. Can be anywhere on the network — inside or outside the pool.</Row>
          <Row label="Static range">The range you manage manually. Free IPs are shown as Available cards.</Row>
        </div>

        <H3>Locations</H3>
        <P>Location labels (e.g. "Server Room", "Loft", "Office") can be added, renamed, or deleted in Settings → Locations. Changes apply to all entries using that label instantly.</P>

        <H3>Tags</H3>
        <P>Tags let you group entries by any criteria you choose (e.g. "Production", "IoT", "Monitoring"). Manage them in Settings → Tags — rename or delete a tag and it updates every entry that uses it.</P>

        <H3>Multiple networks / VLANs</H3>
        <P>Click <strong>Add Network</strong> in the header to create a second subnet. Each network has its own IP entries, ranges, locations, and settings. Switch between networks using the tabs below the header. A network can be deleted from its own Settings panel.</P>

        <H3>Backup & Restore</H3>
        <P>Settings → Backup downloads a single <code className="font-mono bg-slate-100 px-1 rounded text-xs">.json</code> file containing all networks, all IP entries, tags, and change history. Restore it on any machine in one click. Always take a backup before a Restore — it replaces all current data.</P>
      </div>
    ),

    proxmox: (
      <div>
        <H2>Proxmox Import</H2>
        <P>Click the purple <strong>Proxmox</strong> button to discover all VMs and LXC containers from a Proxmox host and import them in one click.</P>

        <H3>What you need</H3>
        <P>A Proxmox API token. Here's how to create one:</P>
        <ol className="list-decimal list-inside text-sm text-slate-600 space-y-1.5 mb-3 ml-1">
          <li>In the Proxmox web UI, go to <strong>Datacenter → Permissions → API Tokens</strong></li>
          <li>Click <strong>Add</strong></li>
          <li>Set <strong>User</strong> to <code className="font-mono bg-slate-100 px-1 rounded text-xs">root@pam</code></li>
          <li>Set <strong>Token ID</strong> to something memorable, e.g. <code className="font-mono bg-slate-100 px-1 rounded text-xs">ipmanager</code></li>
          <li>Leave <strong>Privilege Separation</strong> unchecked</li>
          <li>Click <strong>Add</strong> — <strong>copy the secret immediately</strong>, it won't be shown again</li>
        </ol>
        <P>Token format: <code className="font-mono bg-slate-100 px-1 rounded text-xs">root@pam!ipmanager=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</code></P>

        <H3>Running the import</H3>
        <P>Enter the Proxmox host IP or hostname (port defaults to 8006), paste the token, leave <em>Ignore TLS certificate errors</em> checked for self-signed certs, and click <strong>Discover VMs & LXCs</strong>.</P>

        <H3>Import modes</H3>
        <Row label="Merge">Adds new entries; updates existing ones matched by IP. Existing entries not in the Proxmox results are left untouched. Safe for incremental syncs.</Row>
        <div className="mb-3" />
        <Row label="Replace">Replaces all entries in the active network with what Proxmox returned. Use with caution — take a backup first.</Row>

        <H3>VMs not showing an IP?</H3>
        <P>VMs need the <strong>QEMU guest agent</strong> installed and running inside the VM so Proxmox can read the IP. LXC containers report IPs automatically. Stopped containers may not report interfaces.</P>
      </div>
    ),

    proxmoxsync: (
      <div>
        <H2>Proxmox Scheduled Sync</H2>
        <P>Once you've imported entries via the Proxmox button, the scheduled sync keeps them up to date automatically — no manual re-import needed. Its main purpose is detecting <strong>HA failovers</strong>: when Proxmox High Availability migrates a VM or LXC to a different node, the stored node name in your manager goes stale. The sync catches this and corrects it.</P>

        <H3>What it updates</H3>
        <P>Only entries already tagged <code className="font-mono bg-slate-100 px-1 rounded text-xs">proxmox</code> are ever touched — user-managed entries are ignored even if their IP matches something in Proxmox. For each matching entry, the sync checks three fields:</P>
        <div className="space-y-2 mb-3">
          <Row label="Location (node)">The Proxmox node the VM or LXC is currently running on. This is the primary HA failover signal.</Row>
          <div className="mb-1" />
          <Row label="Asset name">Updated if Proxmox reports a different name for the VMID.</Row>
          <div className="mb-1" />
          <Row label="Notes">Refreshed to reflect the current VMID, node, and power status.</Row>
        </div>
        <P>Every change is written into the entry's change history, visible in the expanded card view — so you can see exactly what moved and when.</P>

        <H3>Setting it up</H3>
        <P>Go to <strong>Settings → Proxmox Scheduled Sync</strong> and enter the same host and API token you use for the one-shot import. Choose a sync interval (default 1 hour, minimum 15 minutes), tick <strong>Enable automatic sync</strong>, and click <strong>Save</strong>.</P>

        <H3>Sync Now</H3>
        <P>The <strong>Sync Now</strong> button in the same Settings section triggers an immediate run. It shows a spinner while running and updates the last-run time and change count when done. The IP cards refresh automatically if any entries were changed.</P>

        <H3>Things it won't do</H3>
        <P>The sync never adds new entries — if a new VM appears in Proxmox, you still import it manually via the Proxmox button. It also won't overwrite fields you've customised (like tags, service, or location) on entries that aren't tagged <code className="font-mono bg-slate-100 px-1 rounded text-xs">proxmox</code>.</P>
      </div>
    ),

    hostgroup: (
      <div>
        <H2>Multiple IPs per Host</H2>
        <P>A server or VM with multiple network interfaces (multi-NIC or multi-VLAN) can have all its IP entries linked together so they clearly belong to the same host. Each group has one <strong>primary</strong> entry and one or more <strong>secondary</strong> entries.</P>

        <H3>Linking IPs</H3>
        <P>Open the Edit modal for the IP you want to be the primary. Scroll to the <strong>Secondary IPs</strong> section at the bottom of the form. Use the dropdown to pick any other standalone (non-free, non-grouped) entry on the same network, then click <strong>+ Link</strong>. You can link multiple secondaries. Click <strong>Save</strong> — the association is stored immediately.</P>

        <H3>How it looks</H3>
        <div className="space-y-2 mb-3">
          <Row label="Primary card / row">Shows small blue chip badges listing each secondary IP address, so you can see all interfaces at a glance.</Row>
          <div className="mb-1" />
          <Row label="Secondary card / row">Shows a <span className="font-mono text-xs bg-slate-100 px-1 rounded">↳ Primary name</span> label so you always know which host it belongs to.</Row>
        </div>
        <P>The same indicators appear in both Cards view and Table view.</P>

        <H3>Unlinking IPs</H3>
        <P>Open the Edit modal for the primary entry. In the Secondary IPs section, each linked entry has an <strong>×</strong> button — click it to remove the association, then save. You can also unlink from the secondary entry's edit modal; it will be detached from the group.</P>

        <H3>Proxmox auto-grouping</H3>
        <P>When you import from Proxmox and a single VM or LXC reports multiple IP addresses (because it has multiple NICs or is connected to multiple VLANs), the importer automatically groups those IPs — the first address becomes the primary and the rest become secondaries. No manual linking required.</P>
      </div>
    ),

    arp: (
      <div>
        <H2>ARP Scan</H2>
        <P>Click the teal <strong>ARP Scan</strong> button to sweep your subnet for active devices using ARP broadcast packets. This finds everything that's online — not just what's already in the manager.</P>

        <H3>How it works</H3>
        <P>The server runs <code className="font-mono bg-slate-100 px-1 rounded text-xs">arp-scan</code> against your subnet, then cross-references the results against your existing entries.</P>

        <H3>Result statuses</H3>
        <div className="space-y-2 mb-3">
          <div className="flex items-center gap-3 text-sm text-slate-600"><Badge color="green">✓ Tracked</Badge><span>Already in the manager. No action needed.</span></div>
          <div className="flex items-center gap-3 text-sm text-slate-600"><Badge color="amber">◯ Static</Badge><span>On your subnet, in the static range, not yet recorded. <strong>Pre-selected</strong> for import.</span></div>
          <div className="flex items-center gap-3 text-sm text-slate-600"><Badge color="blue">~ DHCP</Badge><span>In the DHCP pool. Deselected by default — you may not want to track dynamic leases.</span></div>
          <div className="flex items-center gap-3 text-sm text-slate-600"><Badge color="slate">⊘ Out of range</Badge><span>Responded but outside your configured subnet range.</span></div>
        </div>

        <H3>Importing results</H3>
        <P>Select the entries you want to add (use <strong>Static only</strong> for a quick pick of just the static-range devices), then click <strong>Import</strong>. Entries are merged into the active network.</P>

        <H3>Troubleshooting</H3>
        <P>If the scan returns only a handful of IPs almost instantly, the server is falling back to the kernel ARP cache (devices that recently talked to the server) rather than doing a real scan. This usually means <code className="font-mono bg-slate-100 px-1 rounded text-xs">arp-scan</code> lacks raw socket permission — run the update script (<code className="font-mono bg-slate-100 px-1 rounded text-xs">ip-manager-update</code>) to fix it automatically.</P>
      </div>
    ),

    ping: (
      <div>
        <H2>Ping / Reachability</H2>
        <P>Every assigned IP card and table row shows a coloured dot next to the IP address indicating whether the device is currently reachable.</P>

        <H3>Dot colours</H3>
        <div className="space-y-2 mb-4">
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400 flex-shrink-0" />
            <span><strong>Green</strong> — responded to ping. Online.</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-400 flex-shrink-0" />
            <span><strong>Red</strong> — no response. Offline or unreachable.</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-300 flex-shrink-0" />
            <span><strong>Grey</strong> — not yet checked (server just started, or fping unavailable).</span>
          </div>
        </div>

        <H3>Auto-refresh</H3>
        <P>The server pings all tracked IPs every <strong>60 seconds</strong> in the background using <code className="font-mono bg-slate-100 px-1 rounded text-xs">fping</code>. Results are cached and served instantly to the browser — the browser also polls every 60 seconds. You don't need to do anything; dots stay current automatically.</P>

        <H3>Manual refresh</H3>
        <P>Click the sky-blue <strong>Ping</strong> button in the header to force an immediate refresh. The button shows a spinner while the scan is running. Hovering it shows when the last check completed.</P>

        <H3>Troubleshooting</H3>
        <P>If you see an amber "Ping unavailable" banner, <code className="font-mono bg-slate-100 px-1 rounded text-xs">fping</code> is either not installed or lacks raw socket permission. Run the update script (<code className="font-mono bg-slate-100 px-1 rounded text-xs">ip-manager-update</code>) on the server to install and configure it automatically.</P>
      </div>
    ),

    importexp: (
      <div>
        <H2>Import & Export</H2>

        <H3>Importing from CSV or Excel</H3>
        <P>Click <strong>Import</strong> in the header. Drag and drop a <code className="font-mono bg-slate-100 px-1 rounded text-xs">.csv</code>, <code className="font-mono bg-slate-100 px-1 rounded text-xs">.xlsx</code>, or <code className="font-mono bg-slate-100 px-1 rounded text-xs">.xls</code> file onto the upload zone, or click to browse. A downloadable CSV template with the correct column headers is available from the import screen.</P>

        <H3>Column mapping</H3>
        <P>Common header variations are detected automatically (e.g. <em>hostname</em>, <em>host name</em>, and <em>fqdn</em> all map to Hostname). Use the dropdowns to fix any columns that weren't auto-detected.</P>

        <H3>Supported columns</H3>
        <div className="space-y-0.5 mb-3">
          <Row label="ip (required)">Full IPv4 address. On /24 networks, last-octet shorthand (e.g. 42) expands to your subnet automatically.</Row>
          <Row label="hostname (required)">FQDN or short name.</Row>
          <Row label="type (required)">e.g. LXC, VM, Physical, IoT.</Row>
          <Row label="service (required)">App or service running on the host.</Row>
          <Row label="name">Display / asset name. Falls back to the hostname prefix if omitted.</Row>
          <Row label="location">Physical location or rack label.</Row>
          <Row label="host">Hypervisor or parent host.</Row>
          <Row label="notes">Free-text notes.</Row>
          <Row label="status">assigned or free (defaults to assigned).</Row>
        </div>

        <H3>Import modes</H3>
        <Row label="Merge">Adds new entries; updates existing ones by IP. Safe for incremental updates.</Row>
        <div className="mb-2"/>
        <Row label="Replace">Replaces all entries in the active network. Use with caution — take a backup first.</Row>

        <H3>Exporting</H3>
        <P>Click <strong>Export</strong> in the header to download a formatted <code className="font-mono bg-slate-100 px-1 rounded text-xs">.xlsx</code> file containing all entries in the active network, preserving all fields.</P>
      </div>
    ),

    backup: (
      <div>
        <H2>Backup & Restore</H2>
        <P>Backup and Restore live in <strong>Settings (⚙)</strong> — they are distinct from Export, which only downloads the active network as a spreadsheet. A backup captures <em>everything</em>.</P>

        <H3>What a backup includes</H3>
        <P>A full backup is a single <code className="font-mono bg-slate-100 px-1 rounded text-xs">.json</code> file containing all networks, all IP entries across every network, all tags, all notes, all custom locations, and the complete change history. It contains everything needed to fully restore the app on a new machine or after a server rebuild.</P>

        <H3>Downloading a backup</H3>
        <P>Open <strong>Settings (⚙)</strong> and scroll to the <strong>Backup & Restore</strong> section. Click <strong>Download Full Backup (.json)</strong>. Save the file somewhere safe — an external drive, cloud storage, or another server. The filename includes today's date so you can keep multiple versions.</P>
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800 mb-3">
          <strong>Tip:</strong> Take a backup before any major change — restoring a network, importing a large dataset, or upgrading the server. It takes two seconds and gives you a full rollback point.
        </div>

        <H3>Restoring from a backup</H3>
        <P>In <strong>Settings (⚙) → Backup & Restore</strong>, click <strong>Restore from Backup…</strong> and select your <code className="font-mono bg-slate-100 px-1 rounded text-xs">.json</code> file. A preview panel shows the backup date, how many networks it contains, and how many IP entries. Review it, then click <strong>Yes, Restore Now</strong>.</P>
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 mb-3">
          <strong>Warning:</strong> A restore replaces <em>all</em> current data — every network and every IP entry — with the contents of the backup file. This cannot be undone. Always download a fresh backup first if you want a way back.
        </div>

        <H3>Difference between Backup and Export</H3>
        <div className="space-y-0">
          <Row label="Backup (.json)">Everything — all networks, all entries, tags, notes, history. Use for disaster recovery, server migrations, and full snapshots.</Row>
          <Row label="Export (.xlsx)">The active network only, as a formatted spreadsheet. Use for sharing data, reporting, or opening in Excel.</Row>
        </div>
      </div>
    ),

    dns: (
      <div>
        <H2>DNS Lookup</H2>
        <P>The DNS Lookup feature runs a <strong>reverse DNS (PTR) lookup</strong> for every tracked IP address and displays the result alongside each entry. It answers the question: "What does DNS think this IP is called?"</P>

        <H3>What is a PTR record?</H3>
        <P>When you look up a hostname you get an IP address (a forward lookup). A PTR record is the reverse — given an IP address, it returns the hostname registered in DNS. For example, <code className="font-mono bg-slate-100 px-1 rounded text-xs">192.168.0.171</code> might resolve to <code className="font-mono bg-slate-100 px-1 rounded text-xs">server.home.lab</code> if that PTR record exists on your DNS server.</P>

        <H3>Running a DNS lookup</H3>
        <P>Click the <strong>DNS</strong> button in the header to run an immediate reverse lookup for all tracked IPs. The lookup also runs automatically in the background every 24 hours — you only need to click the button when you want a fresh result right now.</P>

        <H3>How results are displayed</H3>
        <P>IP Manager compares each PTR result against the hostname you have stored for that entry and only shows something when it adds new information:</P>
        <div className="space-y-0 mb-3">
          <Row label="Match">PTR record matches the stored hostname — nothing extra is shown. Your DNS and your records agree; no need to repeat it.</Row>
          <Row label="No hostname stored">No hostname on the entry — the PTR result is shown in grey beneath the IP as a useful fill-in.</Row>
          <Row label="Mismatch">PTR differs from the stored hostname — shown in amber as <code className="font-mono bg-slate-100 px-1 rounded text-xs">⚠ DNS: other-name.domain</code>. Worth investigating — could be a stale DNS record or a typo in your entry.</Row>
        </div>

        <H3>Configuring the DNS server</H3>
        <P>By default, lookups use the system resolver on the server (whatever is configured in <code className="font-mono bg-slate-100 px-1 rounded text-xs">/etc/resolv.conf</code>). To use a specific server — your Pi-hole, your router, or a public resolver — open <strong>Settings (⚙) → DNS Reverse Lookup</strong> and enter the IP address of the server you want to use (e.g. <code className="font-mono bg-slate-100 px-1 rounded text-xs">192.168.0.6</code> or <code className="font-mono bg-slate-100 px-1 rounded text-xs">1.1.1.1</code>). Leave the field blank to return to the system default.</P>

        <H3>Why might a lookup return nothing?</H3>
        <div className="space-y-0">
          <Row label="No PTR record">The IP has no reverse DNS entry. Common for DHCP clients — most home routers don't create PTR records automatically.</Row>
          <Row label="Wrong DNS server">The configured DNS server doesn't hold your LAN's reverse zone. Try setting it to your local DNS (e.g. Pi-hole or router IP).</Row>
          <Row label="Disabled">DNS lookup is disabled in Settings. Toggle it on to resume background lookups.</Row>
        </div>
      </div>
    ),

    shortcuts: (
      <div>
        <H2>Keyboard Shortcuts</H2>
        <P>These shortcuts work anywhere in the app, as long as you're not typing in an input field.</P>
        <div className="mt-2 space-y-0">
          {[
            ['/','Focus the search bar'],
            ['Esc','Clear search — or close the open modal — or collapse the expanded card (in that order)'],
            ['t','Switch to Table view'],
            ['c','Switch to Cards view'],
          ].map(([key, desc]) => (
            <div key={key} className="flex items-start gap-4 py-3 border-b border-slate-100 last:border-0">
              <div className="flex-shrink-0 w-12"><Kbd>{key}</Kbd></div>
              <span className="text-sm text-slate-600">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    ),
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[82vh] flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-slate-600" />
            <h2 className="text-lg font-bold text-slate-800">Help & Reference</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">

          {/* Sidebar */}
          <div className="w-48 border-r border-slate-100 py-3 flex-shrink-0 overflow-y-auto bg-slate-50 rounded-bl-2xl">
            {sections.map(s => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                  activeSection === s.id
                    ? 'bg-white text-slate-800 font-semibold border-r-2 border-slate-800'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {content[activeSection]}
          </div>

        </div>
      </div>
    </div>
  );
}

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
function EditModal({ item, onSave, onClose, onMarkFree, locations, types, onAddLocation, allTags, allNetworkEntries }) {
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
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);

  // Host group linking state
  const [pendingLinks,   setPendingLinks]   = useState([]); // IPs to link as secondary on save
  const [pendingUnlinks, setPendingUnlinks] = useState([]); // IPs to unlink on save

  // Compute current secondaries from allNetworkEntries (excluding pending unlinks)
  const existingSecondaries = (allNetworkEntries || []).filter(
    e => e.hostId && e.hostId === item.hostId && !e.isPrimary && !pendingUnlinks.includes(e.ip)
  );
  // Entries available to link: same network, not self, not already in a group, not already pending
  const linkableEntries = (allNetworkEntries || []).filter(
    e => e.ip !== item.ip &&
         e.assetName !== 'Free' && e.assetName !== 'Reserved' &&
         !e.hostId &&
         !pendingLinks.includes(e.ip)
  );
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
    onSave(
      { ...item, ...formData, location: finalLocation },
      { link: pendingLinks, unlink: pendingUnlinks }
    );
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
                {formData.tags.slice().sort().map(tag => (
                  <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                    <Tag className="w-2.5 h-2.5" />{tag}
                    <button type="button" onClick={() => removeTag(tag)} className="hover:text-violet-900 ml-0.5">×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <input
                type="text"
                value={tagInput}
                onChange={e => { setTagInput(e.target.value); setShowTagSuggestions(true); }}
                onFocus={() => setShowTagSuggestions(true)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); if (tagInput.trim()) { addTag(tagInput); setShowTagSuggestions(false); } }
                  if (e.key === 'Escape') setShowTagSuggestions(false);
                }}
                onBlur={() => setTimeout(() => setShowTagSuggestions(false), 150)}
                placeholder="Type a tag and press Enter, or pick from list…"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm"
              />
              {showTagSuggestions && (() => {
                const suggestions = (allTags || []).filter(t =>
                  !formData.tags.includes(t) &&
                  (tagInput === '' || t.toLowerCase().includes(tagInput.toLowerCase()))
                );
                return suggestions.length > 0 ? (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                    {suggestions.map(t => (
                      <button
                        key={t}
                        type="button"
                        onMouseDown={e => { e.preventDefault(); addTag(t); setShowTagSuggestions(false); }}
                        className="w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-violet-50 hover:text-violet-700 flex items-center gap-2"
                      >
                        <Tag className="w-3 h-3 text-violet-400 flex-shrink-0" />{t}
                      </button>
                    ))}
                  </div>
                ) : null;
              })()}
            </div>
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

          {/* Host Group — only shown for assigned, non-reserved entries */}
          {!isFree && !isReserved && (
            <div className="pt-2 border-t border-slate-200">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Secondary IPs</label>
              <p className="text-xs text-slate-400 mb-2">
                Link other IPs to this entry to indicate they belong to the same host (e.g. a management NIC, a second VLAN interface).
              </p>

              {/* If this entry is itself a secondary, show who the primary is */}
              {item.hostId && !item.isPrimary && (() => {
                const primary = (allNetworkEntries || []).find(e => e.hostId === item.hostId && e.isPrimary);
                return primary ? (
                  <p className="text-xs text-blue-500 mb-2">
                    ↳ This is a secondary IP of <strong>{primary.assetName}</strong> ({primary.ip}). Edit the primary entry to manage the group.
                  </p>
                ) : null;
              })()}

              {/* Existing secondaries (only shown if this is/will be the primary) */}
              {(item.isPrimary || !item.hostId) && (
                <>
                  {/* Already-saved secondaries */}
                  {existingSecondaries.map(entry => (
                    <div key={entry.ip} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-blue-50 border border-blue-100 mb-1.5">
                      <span className="font-mono text-xs text-blue-700">{entry.ip}</span>
                      <span className="text-xs text-slate-500 flex-1 truncate">{entry.assetName}</span>
                      <button
                        type="button"
                        onClick={() => setPendingUnlinks(prev => [...prev, entry.ip])}
                        className="text-slate-400 hover:text-red-500 text-sm leading-none px-1"
                        title="Unlink this IP"
                      >×</button>
                    </div>
                  ))}

                  {/* Pending new links (not yet saved) */}
                  {pendingLinks.map(ip => {
                    const entry = (allNetworkEntries || []).find(e => e.ip === ip);
                    return (
                      <div key={ip} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 border-dashed mb-1.5">
                        <span className="font-mono text-xs text-emerald-700">{ip}</span>
                        <span className="text-xs text-slate-500 flex-1 truncate">{entry?.assetName}</span>
                        <button
                          type="button"
                          onClick={() => setPendingLinks(prev => prev.filter(p => p !== ip))}
                          className="text-slate-400 hover:text-red-500 text-sm leading-none px-1"
                          title="Remove"
                        >×</button>
                      </div>
                    );
                  })}

                  {/* Dropdown to add a new secondary */}
                  {linkableEntries.length > 0 && (
                    <select
                      defaultValue=""
                      onChange={e => {
                        if (e.target.value) {
                          setPendingLinks(prev => [...prev, e.target.value]);
                          e.target.value = '';
                        }
                      }}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-white text-sm text-slate-600"
                    >
                      <option value="">Link another IP as secondary…</option>
                      {linkableEntries.map(e => (
                        <option key={e.ip} value={e.ip}>{e.ip} — {e.assetName}</option>
                      ))}
                    </select>
                  )}
                </>
              )}
            </div>
          )}

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
  const [showProxmoxImport, setShowProxmoxImport] = useState(false);
  const [showARPScan, setShowARPScan] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Ping / reachability — { [ip]: 'up' | 'down' }, null = not yet fetched
  const [pingStatus, setPingStatus] = useState({});
  const [pingLoading, setPingLoading] = useState(false);
  const [pingWarning, setPingWarning] = useState(null);
  const [pingLastAt, setPingLastAt] = useState(null); // Date

  // DNS reverse lookup — { [ip]: { ptr: string | null } }
  const [dnsStatus,  setDnsStatus]  = useState({});
  const [dnsLoading, setDnsLoading] = useState(false);
  const [dnsLastAt,  setDnsLastAt]  = useState(null); // Date
  const [dnsConfig,  setDnsConfig]  = useState({ server: '', enabled: true, lastRun: null });

  // Proxmox scheduled sync
  const [proxmoxSyncConfig,  setProxmoxSyncConfig]  = useState({ host: '', token: '', ignoreTLS: true, enabled: false, intervalMinutes: 60, lastRun: null, changesFound: 0 });
  const [proxmoxSyncStatus,  setProxmoxSyncStatus]  = useState({ running: false, lastError: null, changeLog: [] });
  const [proxmoxSyncLoading, setProxmoxSyncLoading] = useState(false);

  // UI display preferences (browser-local; not synced to server)
  const [uiPrefs, setUiPrefs] = useState(loadUiPrefs);

  // Dark mode (browser-local; persisted to localStorage)
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('ip-manager-dark-mode') === 'true');
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('ip-manager-dark-mode', darkMode ? 'true' : 'false');
  }, [darkMode]);

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
  const [showMobileTools, setShowMobileTools] = useState(false);
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
        if (showImport)        { setShowImport(false);        return; }
        if (showProxmoxImport) { setShowProxmoxImport(false); return; }
        if (showARPScan)       { setShowARPScan(false);       return; }
        if (showHelp)          { setShowHelp(false);          return; }
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
  }, [editingItem, showSettings, showImport, showProxmoxImport, showARPScan, showHelp, expandedCard, searchTerm]);

  // ── Persist UI prefs (browser-local, runs whenever uiPrefs changes) ─────────
  useEffect(() => {
    try { localStorage.setItem('ip-manager-ui-prefs', JSON.stringify(uiPrefs)); } catch {}
  }, [uiPrefs]);

  // ── Ping / reachability ──────────────────────────────────────────────────────
  const fetchPingStatus = async (force = false) => {
    if (persistMode !== 'api') return; // only when server is available
    setPingLoading(true);
    try {
      const res = await fetch(`/api/ping-status${force ? '?force=1' : ''}`);
      if (!res.ok) return;
      const data = await res.json();
      setPingStatus(data.results || {});
      setPingWarning(data.warning || null);
      setPingLastAt(new Date());
    } catch { /* silently ignore network errors */ } finally {
      setPingLoading(false);
    }
  };

  // Initial fetch + 60-second auto-poll
  useEffect(() => {
    if (persistMode !== 'api') return;
    fetchPingStatus();
    const timer = setInterval(() => fetchPingStatus(), 60_000);
    return () => clearInterval(timer);
  }, [persistMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── DNS reverse lookup ───────────────────────────────────────────────────────
  const fetchDnsStatus = async (force = false) => {
    if (persistMode !== 'api') return;
    setDnsLoading(true);
    try {
      const res = await fetch(`/api/dns-status${force ? '?force=1' : ''}`);
      if (!res.ok) return;
      const data = await res.json();
      setDnsStatus(data.results || {});
      setDnsLastAt(data.cachedAt ? new Date(data.cachedAt) : null);
      if (data.config) setDnsConfig(data.config);
    } catch { /* silently ignore network errors */ } finally {
      setDnsLoading(false);
    }
  };

  const handleSaveDnsConfig = async (cfg) => {
    try {
      await fetch('/api/dns-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      setDnsConfig(prev => ({ ...prev, ...cfg }));
    } catch { /* ignore */ }
  };

  // Load cached DNS results on mount (no auto-poll — runs every 24h server-side)
  useEffect(() => {
    if (persistMode !== 'api') return;
    fetchDnsStatus(false);
  }, [persistMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Proxmox scheduled sync ───────────────────────────────────────────────────

  const fetchProxmoxSyncConfig = async () => {
    if (persistMode !== 'api') return;
    try {
      const res = await fetch('/api/proxmox-sync/config');
      if (!res.ok) return;
      const data = await res.json();
      setProxmoxSyncConfig(data);
    } catch { /* ignore */ }
  };

  const fetchProxmoxSyncStatus = async () => {
    if (persistMode !== 'api') return;
    try {
      const res = await fetch('/api/proxmox-sync/status');
      if (!res.ok) return;
      const data = await res.json();
      setProxmoxSyncStatus(data);
      // Also refresh config to pick up updated lastRun / changesFound
      if (!data.running) fetchProxmoxSyncConfig();
    } catch { /* ignore */ }
  };

  const handleSaveProxmoxSyncConfig = async (cfg) => {
    try {
      await fetch('/api/proxmox-sync/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      setProxmoxSyncConfig(prev => ({ ...prev, ...cfg }));
    } catch { /* ignore */ }
  };

  const handleRunProxmoxSync = async () => {
    setProxmoxSyncLoading(true);
    try {
      await fetch('/api/proxmox-sync/run', { method: 'POST' });
      // Poll status until the sync finishes
      const poll = setInterval(async () => {
        const res = await fetch('/api/proxmox-sync/status');
        if (!res.ok) { clearInterval(poll); setProxmoxSyncLoading(false); return; }
        const data = await res.json();
        setProxmoxSyncStatus(data);
        if (!data.running) {
          clearInterval(poll);
          setProxmoxSyncLoading(false);
          fetchProxmoxSyncConfig(); // refresh lastRun / changesFound
          loadData();               // refresh IP cards in case entries changed
        }
      }, 1500);
    } catch {
      setProxmoxSyncLoading(false);
    }
  };

  // Load Proxmox sync config on mount
  useEffect(() => {
    if (persistMode !== 'api') return;
    fetchProxmoxSyncConfig();
  }, [persistMode]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const tagSet = new Set();
    networkIpData.forEach(item => (item.tags || []).forEach(t => t && tagSet.add(t)));
    (networkConfig.extraTags || []).forEach(t => t && tagSet.add(t));
    return [...tagSet].sort();
  }, [networkIpData, networkConfig.extraTags]);

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

  const handleRenameTag = (oldTag, newTag) => {
    if (!newTag) return;
    const trimmed = newTag.trim();
    if (!trimmed || trimmed === oldTag) return;

    if (oldTag === null) {
      // Add a brand-new pre-defined tag (stored in extraTags, similar to extraLocations)
      setNetworks(prev => prev.map(n =>
        n.id === activeNetworkId
          ? { ...n, extraTags: [...new Set([...(n.extraTags || []), trimmed])] }
          : n
      ));
    } else {
      // Rename across all IP entries
      const now = new Date().toISOString();
      setIpData(prev => prev.map(item => {
        if (!(item.tags || []).includes(oldTag)) return item;
        return { ...item, tags: item.tags.map(t => t === oldTag ? trimmed : t), updatedAt: now };
      }));
      // Also rename in extraTags if it's there
      setNetworks(prev => prev.map(n =>
        n.id === activeNetworkId
          ? { ...n, extraTags: (n.extraTags || []).map(t => t === oldTag ? trimmed : t) }
          : n
      ));
    }
    setHasChanges(true);
  };

  const handleDeleteTag = (tag) => {
    const now = new Date().toISOString();
    setIpData(prev => prev.map(item =>
      (item.tags || []).includes(tag)
        ? { ...item, tags: item.tags.filter(t => t !== tag), updatedAt: now }
        : item
    ));
    // Also remove from extraTags
    setNetworks(prev => prev.map(n =>
      n.id === activeNetworkId
        ? { ...n, extraTags: (n.extraTags || []).filter(t => t !== tag) }
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

  const handleSaveItem = (updatedItem, groupOps = {}) => {
    const now = new Date().toISOString();
    const stamped = { ...updatedItem, updatedAt: now };
    setIpData(prev => {
      let data = [...prev];

      // ── Update the main entry ──────────────────────────────────────────────
      const existing = data.find(item => item.ip === stamped.ip);
      if (existing) {
        const changes = computeDiff(existing, stamped);
        const entry = changes.length
          ? { ts: now, changes }
          : { ts: now, changes: [{ label: 'Saved', old: '', new: '(no changes)' }] };
        const history = [...(existing.history || []), entry].slice(-20);
        data = data.map(item => item.ip === stamped.ip ? { ...stamped, history } : item);
      } else {
        // New entry
        const history = [{ ts: now, changes: [{ label: 'Created', old: '', new: stamped.ip }] }];
        data = [...data, { ...stamped, history, networkId: activeNetworkId }];
      }

      // ── Process host-group link operations ────────────────────────────────
      const { link = [], unlink = [] } = groupOps;

      if (link.length > 0) {
        // Ensure the primary has a hostId; generate one if not
        const hostId = stamped.hostId || generateHostId();
        data = data.map(e => {
          if (e.ip === stamped.ip)   return { ...e, hostId, isPrimary: true };
          if (link.includes(e.ip))  return { ...e, hostId, isPrimary: false, updatedAt: now };
          return e;
        });
      }

      if (unlink.length > 0) {
        data = data.map(e => {
          if (!unlink.includes(e.ip)) return e;
          const { hostId: _h, isPrimary: _p, ...rest } = e;
          return { ...rest, updatedAt: now };
        });
        // If the primary now has no secondaries left, clear its hostId too
        const primaryEntry = data.find(e => e.ip === stamped.ip);
        if (primaryEntry?.hostId) {
          const remainingSiblings = data.filter(e => e.hostId === primaryEntry.hostId && e.ip !== stamped.ip);
          if (remainingSiblings.length === 0) {
            data = data.map(e => {
              if (e.ip !== stamped.ip) return e;
              const { hostId: _h, isPrimary: _p, ...rest } = e;
              return rest;
            });
          }
        }
      }

      return data;
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
          tags={allTags}
          onRenameTag={handleRenameTag}
          onDeleteTag={handleDeleteTag}
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
          dnsConfig={dnsConfig}
          dnsStatus={dnsStatus}
          dnsLoading={dnsLoading}
          onSaveDnsConfig={handleSaveDnsConfig}
          onRunDns={() => fetchDnsStatus(true)}
          proxmoxSyncConfig={proxmoxSyncConfig}
          proxmoxSyncStatus={proxmoxSyncStatus}
          proxmoxSyncLoading={proxmoxSyncLoading}
          onSaveProxmoxSyncConfig={handleSaveProxmoxSyncConfig}
          onRunProxmoxSync={handleRunProxmoxSync}
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

      {/* Proxmox Import Modal */}
      {showProxmoxImport && (
        <ProxmoxImportModal
          onImport={handleImport}
          onClose={() => setShowProxmoxImport(false)}
        />
      )}

      {/* ARP Scan Modal */}
      {showARPScan && (
        <ARPScanModal
          subnet={networkConfig.subnet}
          networkConfig={networkConfig}
          onImport={handleImport}
          onClose={() => setShowARPScan(false)}
        />
      )}

      {/* Help Modal */}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

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
          allTags={allTags}
          allNetworkEntries={networkIpData}
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
              <h1 className="text-xl md:text-2xl font-bold text-slate-800">IP Address Manager</h1>
              <p className="text-xs md:text-sm text-slate-500">{networkConfig.networkName} · {subnetCIDR(networkConfig.subnet)}</p>
            </div>

            {/* ── Desktop toolbar (md+) ── */}
            <div className="hidden md:flex gap-2 items-center flex-wrap">

              {/* Status badge */}
              {persistMode === 'api' && (
                <div className="flex items-center gap-1.5 px-2.5 py-2 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-medium border border-emerald-200 whitespace-nowrap" title="Data stored in SQLite on the server — shared across all users">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                  SQLite
                </div>
              )}
              {persistMode === 'local' && (
                <div className="flex items-center gap-1.5 px-2.5 py-2 bg-slate-50 text-slate-500 rounded-lg text-xs font-medium border border-slate-200 whitespace-nowrap" title="Data stored in this browser only — no API server detected">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-400 flex-shrink-0" />
                  Local
                </div>
              )}
              {hasChanges && persistMode !== 'api' && (
                <div className="flex items-center gap-1.5 px-2.5 py-2 bg-amber-50 text-amber-700 rounded-lg text-xs font-medium border border-amber-200 whitespace-nowrap">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  Unsaved
                </div>
              )}

              {/* Import tools (api-only) */}
              {persistMode === 'api' && (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setShowProxmoxImport(true)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg whitespace-nowrap transition-colors"
                    title="Auto-discover VMs and LXCs from Proxmox"
                  >
                    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="3" width="20" height="14" rx="2"/>
                      <path d="M8 21h8M12 17v4"/>
                      <path d="M7 8h.01M12 8h.01M17 8h.01"/>
                    </svg>
                    Proxmox
                  </button>
                  <button
                    onClick={() => setShowARPScan(true)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg whitespace-nowrap transition-colors"
                    title="Scan your subnet for active devices via ARP"
                  >
                    <Wifi className="w-4 h-4 flex-shrink-0" />
                    ARP Scan
                  </button>
                  <button
                    onClick={() => fetchPingStatus(true)}
                    disabled={pingLoading}
                    title={pingLastAt ? `Last checked: ${pingLastAt.toLocaleTimeString()}` : 'Check reachability of all tracked IPs'}
                    className="flex items-center gap-1.5 px-3 py-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg whitespace-nowrap transition-colors"
                  >
                    {pingLoading
                      ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin flex-shrink-0" />
                      : <Zap className="w-4 h-4 flex-shrink-0" />}
                    Ping
                  </button>
                  <button
                    onClick={() => fetchDnsStatus(true)}
                    disabled={dnsLoading}
                    title={dnsLastAt ? `DNS last run: ${dnsLastAt.toLocaleString()}` : 'Run reverse DNS (PTR) lookup for all tracked IPs'}
                    className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg whitespace-nowrap transition-colors"
                  >
                    {dnsLoading
                      ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin flex-shrink-0" />
                      : <Globe className="w-4 h-4 flex-shrink-0" />}
                    DNS
                  </button>
                </div>
              )}

              {/* Data buttons */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setShowImport(true)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium rounded-lg whitespace-nowrap transition-colors"
                >
                  <Upload className="w-4 h-4 flex-shrink-0" />
                  Import
                </button>
                <button
                  onClick={handleExportExcel}
                  className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg whitespace-nowrap transition-colors"
                >
                  <Download className="w-4 h-4 flex-shrink-0" />
                  Export
                </button>
              </div>

              {/* Utility icon buttons */}
              <div className="flex items-center gap-1">
                {networks.length === 1 && (
                  <button
                    onClick={handleAddNetwork}
                    className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 text-sm font-medium rounded-lg border border-dashed border-slate-300 hover:border-slate-400 whitespace-nowrap transition-colors"
                    title="Add another network (e.g. a VLAN or IoT segment)"
                  >
                    <Plus className="w-4 h-4 flex-shrink-0" />
                    Add Network
                  </button>
                )}
                <button
                  onClick={() => setDarkMode(d => !d)}
                  className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-lg transition-colors"
                  title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                  {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => setShowHelp(true)}
                  className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-lg transition-colors"
                  title="Help & Reference"
                >
                  <HelpCircle className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setShowSettings(true)}
                  className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors"
                  title="Network Settings"
                >
                  <Settings className="w-4 h-4" />
                </button>
                {persistMode === 'api' && (
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-red-50 hover:text-red-500 text-slate-500 rounded-lg transition-colors text-sm font-medium whitespace-nowrap"
                    title="Sign out"
                  >
                    <LogOut className="w-4 h-4 flex-shrink-0" />
                    Sign out
                  </button>
                )}
              </div>

              {/* View toggle */}
              <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
                <button
                  onClick={() => setViewMode('cards')}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                    viewMode === 'cards' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Cards
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                    viewMode === 'table' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Table
                </button>
              </div>

            </div>

            {/* ── Mobile toolbar (< md): view toggle + tools menu button ── */}
            <div className="flex md:hidden items-center gap-2">
              {/* Status badges — keep visible on mobile */}
              {persistMode === 'api' && (
                <div className="flex items-center gap-1 px-2 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-medium border border-emerald-200">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  SQLite
                </div>
              )}
              {hasChanges && persistMode !== 'api' && (
                <div className="flex items-center gap-1 px-2 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-xs font-medium border border-amber-200">
                  <AlertCircle className="w-3 h-3" />
                  Unsaved
                </div>
              )}
              {/* View toggle */}
              <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
                <button
                  onClick={() => setViewMode('cards')}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    viewMode === 'cards' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  Cards
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    viewMode === 'table' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  Table
                </button>
              </div>
              {/* Tools dropdown toggle */}
              <button
                onClick={() => setShowMobileTools(t => !t)}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                  showMobileTools
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                }`}
                title="Tools"
              >
                <MoreHorizontal className="w-4 h-4" />
                Tools
                <ChevronDown className={`w-3 h-3 transition-transform ${showMobileTools ? 'rotate-180' : ''}`} />
              </button>
            </div>
          </div>

          {/* ── Mobile tools panel ── */}
          {showMobileTools && (
            <div className="flex md:hidden flex-wrap gap-2 pb-3 mb-3 border-b border-slate-200">
              {persistMode === 'api' && (<>
                <button
                  onClick={() => { setShowProxmoxImport(true); setShowMobileTools(false); }}
                  className="flex items-center gap-1.5 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2"/>
                    <path d="M8 21h8M12 17v4"/>
                    <path d="M7 8h.01M12 8h.01M17 8h.01"/>
                  </svg>
                  Proxmox
                </button>
                <button
                  onClick={() => { setShowARPScan(true); setShowMobileTools(false); }}
                  className="flex items-center gap-1.5 px-3 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <Wifi className="w-4 h-4 flex-shrink-0" />
                  ARP Scan
                </button>
                <button
                  onClick={() => { fetchPingStatus(true); setShowMobileTools(false); }}
                  disabled={pingLoading}
                  className="flex items-center gap-1.5 px-3 py-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {pingLoading
                    ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin flex-shrink-0" />
                    : <Zap className="w-4 h-4 flex-shrink-0" />}
                  Ping
                </button>
                <button
                  onClick={() => { fetchDnsStatus(true); setShowMobileTools(false); }}
                  disabled={dnsLoading}
                  className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {dnsLoading
                    ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin flex-shrink-0" />
                    : <Globe className="w-4 h-4 flex-shrink-0" />}
                  DNS
                </button>
              </>)}
              <button
                onClick={() => { setShowImport(true); setShowMobileTools(false); }}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Upload className="w-4 h-4 flex-shrink-0" />
                Import
              </button>
              <button
                onClick={() => { handleExportExcel(); setShowMobileTools(false); }}
                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Download className="w-4 h-4 flex-shrink-0" />
                Export
              </button>
              {networks.length === 1 && (
                <button
                  onClick={() => { handleAddNetwork(); setShowMobileTools(false); }}
                  className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium rounded-lg border border-dashed border-slate-300 transition-colors"
                >
                  <Plus className="w-4 h-4 flex-shrink-0" />
                  Add Network
                </button>
              )}
              <button
                onClick={() => setDarkMode(d => !d)}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium rounded-lg transition-colors"
              >
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                {darkMode ? 'Light mode' : 'Dark mode'}
              </button>
              <button
                onClick={() => { setShowHelp(true); setShowMobileTools(false); }}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium rounded-lg transition-colors"
              >
                <HelpCircle className="w-4 h-4" />
                Help
              </button>
              <button
                onClick={() => { setShowSettings(true); setShowMobileTools(false); }}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium rounded-lg transition-colors"
              >
                <Settings className="w-4 h-4" />
                Settings
              </button>
              {persistMode === 'api' && (
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-red-50 hover:text-red-500 text-slate-500 text-sm font-medium rounded-lg transition-colors"
                >
                  <LogOut className="w-4 h-4 flex-shrink-0" />
                  Sign out
                </button>
              )}
            </div>
          )}

          {/* Network Overview — hidden on mobile to save vertical space */}
          <div className="hidden md:block mb-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
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

          {/* Tag filter chips — single scrollable row on mobile, wraps on desktop */}
          {allTags.length > 0 && (
            <div className="flex md:flex-wrap gap-1.5 mt-2 overflow-x-auto pb-1 md:pb-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {allTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => setSelectedTag(selectedTag === tag ? '' : tag)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border transition-colors flex-shrink-0 ${
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

      {/* Ping warning — shown when fping is unavailable */}
      {pingWarning && (
        <div className="max-w-7xl mx-auto px-4 mb-2">
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" />
            <span className="min-w-0"><span className="font-semibold">Ping unavailable: </span>{pingWarning}</span>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 pb-8">
        {viewMode === 'cards' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedData.map((item, index) => {
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
                            <ServiceIcon
                              apps={item.apps}
                              assetName={item.assetName}
                              darkMode={darkMode}
                              imgClass="w-5 h-5 object-contain"
                              lucideClass={`w-5 h-5 ${isReserved ? 'text-slate-300' : 'text-slate-600'}`}
                            />
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
                      <div className="flex items-center gap-2">
                        <div className={`font-mono text-lg font-semibold ${isFree ? 'text-emerald-700' : 'text-slate-800'}`}>{item.ip}</div>
                        {!isFree && !isReserved && pingStatus[item.ip] != null && (
                          <span title={pingStatus[item.ip] === 'up' ? 'Online' : 'Offline'}
                            className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${pingStatus[item.ip] === 'up' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                        )}
                        {!isFree && !isReserved && pingStatus[item.ip] == null && pingLastAt && (
                          <span title="Status unknown" className="inline-block w-2 h-2 rounded-full flex-shrink-0 bg-slate-300" />
                        )}
                      </div>
                      {(() => {
                        if (isFree || isReserved) return null;
                        const ptr = dnsStatus[item.ip]?.ptr;
                        if (!ptr) return null;
                        const norm = s => s.toLowerCase().replace(/\.$/, '').trim();
                        const matches = item.hostname && norm(ptr) === norm(item.hostname);
                        if (matches) return null; // hostname already shown below — no need to repeat
                        return item.hostname ? (
                          // PTR exists but differs from stored hostname — highlight as mismatch
                          <div className="text-xs font-mono text-amber-500 truncate leading-tight mt-0.5"
                               title={`DNS PTR record: ${ptr} — differs from stored hostname: ${item.hostname}`}>
                            ⚠ DNS: {ptr}
                          </div>
                        ) : (
                          // No stored hostname — show PTR as useful info
                          <div className="text-xs font-mono text-slate-400 truncate leading-tight mt-0.5"
                               title={`PTR record from DNS: ${ptr}`}>
                            {ptr}
                          </div>
                        );
                      })()}
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

                        {/* Secondary IPs — shown on the primary card */}
                        {item.isPrimary && item.hostId && (() => {
                          const secondaries = networkIpData.filter(e => e.hostId === item.hostId && !e.isPrimary);
                          if (!secondaries.length) return null;
                          return (
                            <div className="flex flex-wrap gap-1 mb-2">
                              {secondaries.map(s => (
                                <span key={s.ip}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-mono rounded bg-blue-50 text-blue-600 border border-blue-200"
                                  title={`Secondary IP: ${s.assetName}`}>
                                  {s.ip}
                                </span>
                              ))}
                            </div>
                          );
                        })()}

                        {/* "Part of primary" label — shown on secondary cards */}
                        {!item.isPrimary && item.hostId && (() => {
                          const primary = networkIpData.find(e => e.hostId === item.hostId && e.isPrimary);
                          if (!primary) return null;
                          return (
                            <div className="text-xs text-blue-500 truncate mb-1.5" title={`Secondary IP of ${primary.assetName} (${primary.ip})`}>
                              ↳ {primary.assetName}
                            </div>
                          );
                        })()}

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
                          {(item.tags || []).slice().sort().map(tag => (
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
                                {(item.tags || []).slice().sort().map(tag => (
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
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => copyToClipboard(item.ip)}
                              className={`font-mono text-sm font-medium flex items-center gap-1.5 ${
                                isFree ? 'text-emerald-700 hover:text-emerald-800' : 'text-slate-800 hover:text-emerald-600'
                              }`}
                            >
                              {item.ip}
                              {copiedIP === item.ip && <Check className="w-3 h-3 text-emerald-600" />}
                            </button>
                            {!isFree && !isReserved && pingStatus[item.ip] != null && (
                              <span title={pingStatus[item.ip] === 'up' ? 'Online' : 'Offline'}
                                className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${pingStatus[item.ip] === 'up' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                            )}
                            {!isFree && !isReserved && pingStatus[item.ip] == null && pingLastAt && (
                              <span title="Status unknown" className="inline-block w-2 h-2 rounded-full flex-shrink-0 bg-slate-300" />
                            )}
                          </div>
                          {(() => {
                            if (isFree || isReserved) return null;
                            const ptr = dnsStatus[item.ip]?.ptr;
                            if (!ptr) return null;
                            const norm = s => s.toLowerCase().replace(/\.$/, '').trim();
                            const matches = item.hostname && norm(ptr) === norm(item.hostname);
                            if (matches) return null;
                            return item.hostname ? (
                              <div className="text-xs font-mono text-amber-500 truncate leading-tight mt-0.5"
                                   title={`DNS PTR record: ${ptr} — differs from stored hostname: ${item.hostname}`}>
                                ⚠ DNS: {ptr}
                              </div>
                            ) : (
                              <div className="text-xs font-mono text-slate-400 truncate leading-tight mt-0.5"
                                   title={`PTR record from DNS: ${ptr}`}>
                                {ptr}
                              </div>
                            );
                          })()}
                        </td>
                        <td className={`px-4 py-3 text-sm ${
                          isFree ? 'text-emerald-600 font-semibold' : isReserved ? 'text-slate-400 italic' : 'text-slate-700'
                        }`}>
                          {isFree ? '✓ Available' : item.assetName}
                          {/* Secondary IPs listed under asset name in table */}
                          {item.isPrimary && item.hostId && (() => {
                            const secondaries = networkIpData.filter(e => e.hostId === item.hostId && !e.isPrimary);
                            if (!secondaries.length) return null;
                            return (
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {secondaries.map(s => (
                                  <span key={s.ip} className="font-mono text-xs px-1 py-0 rounded bg-blue-50 text-blue-500 border border-blue-200" title={s.assetName}>{s.ip}</span>
                                ))}
                              </div>
                            );
                          })()}
                          {/* "Part of" indicator for secondary rows */}
                          {!item.isPrimary && item.hostId && (() => {
                            const primary = networkIpData.find(e => e.hostId === item.hostId && e.isPrimary);
                            return primary ? (
                              <div className="text-xs text-blue-400 mt-0.5">↳ {primary.assetName}</div>
                            ) : null;
                          })()}
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
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {item.apps ? (
                            <span className="flex items-center gap-1.5">
                              <ServiceIcon
                                apps={item.apps}
                                assetName={item.assetName}
                                darkMode={darkMode}
                                imgClass="w-4 h-4 object-contain flex-shrink-0"
                                lucideClass="w-4 h-4 flex-shrink-0 text-slate-400"
                              />
                              {item.apps}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {(item.tags || []).slice().sort().map(tag => (
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
