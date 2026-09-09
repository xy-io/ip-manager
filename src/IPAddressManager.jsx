import React, { useState, useMemo, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { Search, Server, Monitor, Wifi, HardDrive, Camera, Shield, Globe, Filter, X, MapPin, Cpu, Box, CircleDot, ChevronDown, ChevronUp, Copy, Check, Zap, Download, Edit3, Plus, Trash2, Save, AlertCircle, Settings, Upload, FileText, AlertTriangle, CheckCircle, ChevronRight, Tag, ArrowUpDown, ArrowUp, ArrowDown, HelpCircle, LogOut, Moon, Sun, MoreHorizontal, Terminal, RotateCw } from 'lucide-react';
import { loadXLSX, APP_VERSION, useModalA11y, DEFAULT_NETWORK_CONFIG, ipOrdinal, rangeOrdinal, subnetOctetCount, isInDHCPRange, parseCIDR } from './shared/common';

// ── Lazily-loaded modals ─────────────────────────────────────────────────────
// None of these are on screen at first paint, and most sessions never open
// them, so they are fetched on demand. Together they were 24% of the initial
// JavaScript download (136 kB gzipped to 104 kB).
//
// Each import is cached by the bundler after the first open, so a modal is
// fetched at most once per session.
const HelpModal = lazy(() => import('./modals/HelpModal'));
const BackupCloudSection = lazy(() => import('./modals/BackupCloudSection'));
const ImportModal = lazy(() => import('./modals/ImportModal'));
const DomainsView = lazy(() => import('./modals/DomainsView'));
const ARPScanModal = lazy(() => import('./modals/ARPScanModal'));
const ProxmoxImportModal = lazy(() => import('./modals/ProxmoxImportModal'));
const SubnetVisuiserModal = lazy(() => import('./modals/SubnetVisuiserModal'));
const CIDRCalculatorModal = lazy(() => import('./modals/CIDRCalculatorModal'));
const WhatsNewModal = lazy(() => import('./modals/WhatsNewModal'));

// A modal that is still downloading shows nothing rather than a spinner: on a
// LAN the chunk arrives in a few milliseconds, and a flash of loading UI is
// more distracting than a brief pause.
const ModalSuspense = ({ children }) => <Suspense fallback={null}>{children}</Suspense>;


// ── On-demand libraries ──────────────────────────────────────────────────────
// xlsx and qrcode were previously imported statically. Together they accounted
// for roughly half the JavaScript bundle (939 kB → 489 kB raw, 277 kB → 126 kB
// gzipped) and were downloaded on every page load, but they are only needed by
// the import/export functions and the QR modal — features most sessions never
// touch. Loading them on first use keeps them out of the initial download.
//
// Each loader caches its promise, so the chunk is fetched at most once per
// session no matter how many times the feature is used.
let qrcodePromise = null;
const loadQRCode = () => {
  if (!qrcodePromise) qrcodePromise = import('qrcode').then(m => m.default || m);
  return qrcodePromise;
};

// ── App version ───────────────────────────────────────────────────────────────
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

// ── ARP & Presence Tab (lives inside SettingsModal) ───────────────────────────
function ArpPresenceTab() {
  const [config,  setConfig]  = useState(null);
  const [status,  setStatus]  = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [scanning, setScanning] = useState(false);
  const [msg,     setMsg]     = useState(null); // { type: 'ok'|'err', text }

  // Local editable state
  const [lastSeenEnabled,          setLastSeenEnabled]          = useState(false);
  const [discoveryEnabled,         setDiscoveryEnabled]         = useState(false);
  const [discoveryInterval,        setDiscoveryInterval]        = useState('');
  const [discoveryBandwidth,       setDiscoveryBandwidth]       = useState('');
  const [discoveryInterface,       setDiscoveryInterface]       = useState('');

  const loadConfig = async () => {
    try {
      const r = await fetch('/api/arp-presence/config');
      if (!r.ok) return;
      const d = await r.json();
      setConfig(d);
      setLastSeenEnabled(d.lastSeenEnabled);
      setDiscoveryEnabled(d.discoveryEnabled);
      setDiscoveryInterval(d.discoveryIntervalMinutes != null ? String(d.discoveryIntervalMinutes) : '');
      setDiscoveryBandwidth(d.discoveryBandwidthKbps  != null ? String(d.discoveryBandwidthKbps)  : '');
      setDiscoveryInterface(d.discoveryInterface || '');
    } catch {}
  };

  const loadStatus = async () => {
    try {
      const r = await fetch('/api/arp-presence/status');
      if (!r.ok) return;
      setStatus(await r.json());
    } catch {}
  };

  useEffect(() => {
    loadConfig();
    loadStatus();
    const t = setInterval(loadStatus, 10_000);
    return () => clearInterval(t);
  }, []);

  const handleSave = async () => {
    setSaving(true); setMsg(null);
    try {
      const body = {
        lastSeenEnabled,
        discoveryEnabled,
        discoveryIntervalMinutes: discoveryInterval  !== '' ? parseInt(discoveryInterval)  : null,
        discoveryBandwidthKbps:   discoveryBandwidth !== '' ? parseInt(discoveryBandwidth) : null,
        discoveryInterface,
      };
      const r = await fetch('/api/arp-presence/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('Save failed');
      setMsg({ type: 'ok', text: 'Settings saved.' });
      loadConfig();
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally {
      setSaving(false);
    }
  };

  const handleScanNow = async () => {
    setScanning(true); setMsg(null);
    try {
      const r = await fetch('/api/arp-presence/scan', { method: 'POST' });
      const d = await r.json();
      if (!d.ok && d.message) { setMsg({ type: 'err', text: d.message }); setScanning(false); return; }
      setMsg({ type: 'ok', text: 'Scan started — results will appear below in a few seconds.' });
      // Poll status until scan completes
      const poll = setInterval(async () => {
        await loadStatus();
        setStatus(prev => {
          if (prev && !prev.discovery?.running) { clearInterval(poll); setScanning(false); }
          return prev;
        });
      }, 2000);
      setTimeout(() => { clearInterval(poll); setScanning(false); }, 120_000);
    } catch (e) {
      setMsg({ type: 'err', text: e.message }); setScanning(false);
    }
  };

  const handleClearLastSeen = async () => {
    try {
      await fetch('/api/arp-presence/clear-last-seen', { method: 'POST' });
      setMsg({ type: 'ok', text: 'Last seen data cleared.' });
      loadStatus();
    } catch {}
  };

  const labelCls   = "block text-sm font-medium text-slate-700 mb-1";
  const inputCls   = "w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm";
  const sectionCls = "border border-slate-200 rounded-xl p-4 space-y-4";

  const fmtTime = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    return `${Math.floor(diffH / 24)}d ago`;
  };

  const discoveryResults = status?.discovery?.lastResults || [];
  const untracked = discoveryResults.filter(r => !r.tracked && r.inStaticRange);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-slate-800">ARP & Presence</h3>
        <p className="text-sm text-slate-500 mt-0.5">Track when devices were last seen online, and optionally scan for untracked devices on your network.</p>
      </div>

      {/* ── Last Seen Timestamps ── */}
      <div className={sectionCls}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-700">Last Seen Timestamps</p>
            <p className="text-xs text-slate-500 mt-0.5">Piggybacks on the existing ping cycle (every 60 s) — zero extra network traffic. Records the last time each device responded to a ping.</p>
          </div>
          <button
            type="button"
            onClick={() => setLastSeenEnabled(v => !v)}
            className={`flex-shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${lastSeenEnabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${lastSeenEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
        {lastSeenEnabled && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs text-emerald-700">
            When enabled, a clock icon appears on each card and table row showing how long ago the device was last seen online. A grey indicator appears when no data has been collected yet or when the device has been offline.
          </div>
        )}
        {status && Object.keys(status.lastSeen || {}).length > 0 && (
          <div className="flex items-center justify-between text-xs text-slate-500 mt-1">
            <span>{Object.keys(status.lastSeen).length} IPs with last-seen data</span>
            <button type="button" onClick={handleClearLastSeen} className="text-red-500 hover:text-red-700 transition-colors">Clear data</button>
          </div>
        )}
      </div>

      {/* ── Background Discovery Scan ── */}
      <div className={sectionCls}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-700">Background Discovery Scan</p>
            <p className="text-xs text-slate-500 mt-0.5">Scheduled ARP sweep scoped to your static IP range. Surfaces devices on your network that aren't yet tracked. Rate-limited to minimise traffic on large subnets.</p>
          </div>
          <button
            type="button"
            onClick={() => setDiscoveryEnabled(v => !v)}
            className={`flex-shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${discoveryEnabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${discoveryEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        {config && (
          <div className="bg-slate-50 rounded-lg px-3 py-2 text-xs text-slate-600 space-y-0.5">
            <p>Subnet: <span className="font-mono">/{config.subnetPrefixLen}</span> &nbsp;·&nbsp; Auto interval: <span className="font-mono">{config.defaultIntervalMinutes} min</span> &nbsp;·&nbsp; Auto bandwidth cap: <span className="font-mono">{config.defaultBandwidthKbps} Kbps</span></p>
            {config.subnetPrefixLen <= 16 && (
              <p className="text-amber-600">⚠ /16 or larger subnet detected — default bandwidth cap is conservative (200 Kbps). A full scan may take several minutes.</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Scan interval (min) <span className="text-slate-400 font-normal">— blank = auto ({config?.defaultIntervalMinutes ?? '…'})</span></label>
            <input type="number" min="5" className={inputCls} value={discoveryInterval} onChange={e => setDiscoveryInterval(e.target.value)} placeholder={String(config?.defaultIntervalMinutes ?? 15)} />
          </div>
          <div>
            <label className={labelCls}>Bandwidth cap (Kbps) <span className="text-slate-400 font-normal">— blank = auto</span></label>
            <input type="number" min="50" className={inputCls} value={discoveryBandwidth} onChange={e => setDiscoveryBandwidth(e.target.value)} placeholder={String(config?.defaultBandwidthKbps ?? 1000)} />
          </div>
        </div>

        <div>
          <label className={labelCls}>Network interface <span className="text-slate-400 font-normal">— blank = auto-detect</span></label>
          <input type="text" className={inputCls} value={discoveryInterface} onChange={e => setDiscoveryInterface(e.target.value)} placeholder="e.g. eth0" />
        </div>

        {/* Scan status */}
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-500">
            {status?.discovery?.running ? (
              <span className="text-amber-600">⟳ Scan in progress…</span>
            ) : status?.discovery?.lastRun ? (
              <span>Last scan: {fmtTime(status.discovery.lastRun)} · {discoveryResults.length} device{discoveryResults.length !== 1 ? 's' : ''} found</span>
            ) : (
              <span>No scan run yet</span>
            )}
          </div>
          <button
            type="button"
            disabled={scanning || status?.discovery?.running}
            onClick={handleScanNow}
            className="text-xs px-3 py-1.5 bg-teal-500 text-white rounded-lg hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {scanning || status?.discovery?.running ? 'Scanning…' : 'Scan Now'}
          </button>
        </div>

        {/* Last error */}
        {status?.discovery?.lastError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
            Last scan error: {status.discovery.lastError}
          </div>
        )}

        {/* Untracked devices */}
        {untracked.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-amber-700">{untracked.length} untracked device{untracked.length !== 1 ? 's' : ''} found in static range</p>
            <div className="max-h-40 overflow-y-auto space-y-1">
              {untracked.map((d, i) => (
                <div key={i} className="flex items-center gap-2 text-xs bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                  <span className="font-mono font-semibold text-slate-700 w-28 flex-shrink-0">{d.ip}</span>
                  <span className="font-mono text-slate-500 w-40 flex-shrink-0 hidden sm:block">{d.mac}</span>
                  <span className="text-slate-600 truncate">{d.vendor || 'Unknown vendor'}</span>
                  {d.networkName && <span className="text-slate-400 ml-auto flex-shrink-0">{d.networkName}</span>}
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400">Use the ARP Scan button in the toolbar to import these devices.</p>
          </div>
        )}
      </div>

      {/* Save + feedback */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        {msg && (
          <span className={`text-sm ${msg.type === 'ok' ? 'text-emerald-600' : 'text-red-500'}`}>{msg.text}</span>
        )}
      </div>
    </div>
  );
}

// ── Home Assistant Tab ────────────────────────────────────────────────────────
// ── Accessibility: modal dialog behaviour ────────────────────────────────────
// Gives a modal the three things assistive technology and keyboard users need:
// the dialog is announced, focus moves into it and cannot Tab out, and focus
// returns to whatever opened it on close. Escape closes, when the modal is
// dismissible.
function NotificationsTab() {
  const [config, setConfig] = useState(null);
  const [catalogue, setCatalogue] = useState({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    fetch('/api/notifications/config')
      .then(r => r.json())
      .then(d => { setConfig(d.config); setCatalogue(d.catalogue || {}); })
      .catch(() => setMessage({ kind: 'error', text: 'Could not load notification settings' }));
  }, []);

  const save = async (patch) => {
    setSaving(true);
    setMessage(null);
    try {
      const r = await fetch('/api/notifications/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const d = await r.json();
      if (!r.ok) { setMessage({ kind: 'error', text: d.error || 'Could not save' }); return; }
      setConfig(d.config);
      setMessage({ kind: 'ok', text: 'Saved' });
      setTimeout(() => setMessage(null), 2500);
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const r = await fetch('/api/notifications/test', { method: 'POST' });
      const d = await r.json();
      setMessage(r.ok
        ? { kind: 'ok', text: `Test sent to ${d.sentTo}. If nothing arrives, check the URL and that the server can reach it.` }
        : { kind: 'error', text: d.error || 'Could not send test' });
    } finally {
      setTesting(false);
    }
  };

  if (!config) return <div className="text-sm text-slate-400">Loading notification settings…</div>;

  const placeholder = config.type === 'ntfy'
    ? 'https://ntfy.sh/your-topic-name'
    : 'https://example.com/webhook';

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-1">Notifications</h3>
        <p className="text-xs text-slate-500 leading-relaxed">
          Push an alert when something changes — a device drops off, a health check fails, a domain is about to expire.
          Sends to an <a href="https://ntfy.sh" target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline">ntfy</a> topic
          or any webhook endpoint. No Home Assistant required.
        </p>
      </div>

      {message && (
        <div className={`text-xs rounded-lg px-3 py-2 border ${
          message.kind === 'ok'
            ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
            : 'text-red-600 bg-red-50 border-red-200'
        }`}>{message.text}</div>
      )}

      {/* Destination */}
      <div className="border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <input
            id="notif-enabled"
            type="checkbox"
            checked={config.enabled}
            onChange={e => save({ enabled: e.target.checked })}
            className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
          <label htmlFor="notif-enabled" className="text-sm font-medium text-slate-700">Enable notifications</label>
        </div>

        <div>
          <label htmlFor="notif-type" className="block text-xs font-medium text-slate-600 mb-1">Destination type</label>
          <select
            id="notif-type"
            value={config.type}
            onChange={e => setConfig(c => ({ ...c, type: e.target.value }))}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="ntfy">ntfy — plain text push to a topic</option>
            <option value="webhook">Webhook — JSON POST</option>
          </select>
        </div>

        <div>
          <label htmlFor="notif-url" className="block text-xs font-medium text-slate-600 mb-1">Destination URL</label>
          <input
            id="notif-url"
            type="url"
            value={config.url}
            onChange={e => setConfig(c => ({ ...c, url: e.target.value }))}
            placeholder={placeholder}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <p className="text-xs text-slate-400 mt-1">
            {config.type === 'ntfy'
              ? 'Pick any hard-to-guess topic name — anyone who knows it can read your alerts.'
              : 'Receives a JSON body with type, message, meta and timestamp.'}
          </p>
        </div>

        <div>
          <label htmlFor="notif-cycles" className="block text-xs font-medium text-slate-600 mb-1">
            Failed ping cycles before alerting
          </label>
          <input
            id="notif-cycles"
            type="number"
            min="1"
            max="10"
            value={config.minOfflineCycles}
            onChange={e => setConfig(c => ({ ...c, minOfflineCycles: e.target.value }))}
            className="w-24 px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <p className="text-xs text-slate-400 mt-1">
            Pings run every 60 seconds. A value of 2 means a device must be unreachable for two consecutive checks before you are told — this filters out dropped packets.
          </p>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => save({ type: config.type, url: config.url, minOfflineCycles: config.minOfflineCycles })}
            disabled={saving}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={sendTest}
            disabled={testing || !config.url}
            className="px-4 py-2 bg-slate-100 border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 disabled:opacity-50 transition-colors"
          >
            {testing ? 'Sending…' : 'Send test'}
          </button>
        </div>
        <p className="text-xs text-slate-400">A test sends regardless of whether notifications are enabled, so you can check delivery first.</p>
      </div>

      {/* Events */}
      <div>
        <h4 className="text-sm font-semibold text-slate-700 mb-2">Which events to send</h4>
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          {Object.entries(catalogue).map(([key, description]) => (
            <div key={key} className="flex items-start gap-3 px-3 py-2.5 border-b border-slate-100 last:border-0">
              <input
                id={`evt-${key}`}
                type="checkbox"
                checked={!!config.events[key]}
                onChange={e => save({ events: { [key]: e.target.checked } })}
                className="mt-0.5 w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 shrink-0"
              />
              <label htmlFor={`evt-${key}`} className="flex-1 cursor-pointer">
                <span className="block text-sm text-slate-700">{description}</span>
                <code className="text-xs text-slate-400 font-mono">{key}</code>
              </label>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ActivityTab() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  const load = () => {
    setLoading(true);
    const qs = filter ? `?type=${encodeURIComponent(filter)}&limit=200` : '?limit=200';
    fetch(`/api/audit-log${qs}`)
      .then(r => r.json())
      .then(d => { setEntries(d.entries || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(load, [filter]);

  const clear = async () => {
    if (!confirm('Clear the activity log?\n\nThis cannot be undone.')) return;
    await fetch('/api/audit-log', { method: 'DELETE' });
    load();
  };

  const relative = (iso) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const colourFor = (type) => {
    if (type.startsWith('auth.login.failed')) return 'bg-red-50 text-red-600 border-red-200';
    if (type.startsWith('auth')) return 'bg-indigo-50 text-indigo-600 border-indigo-200';
    if (type.startsWith('apikey')) return 'bg-amber-50 text-amber-700 border-amber-200';
    if (type.startsWith('device.offline') || type.startsWith('health.down')) return 'bg-orange-50 text-orange-600 border-orange-200';
    if (type.startsWith('device.online') || type.startsWith('health.up')) return 'bg-emerald-50 text-emerald-600 border-emerald-200';
    if (type.startsWith('entry')) return 'bg-sky-50 text-sky-600 border-sky-200';
    return 'bg-slate-100 text-slate-500 border-slate-200';
  };

  const filters = [
    ['', 'All'],
    ['auth', 'Sign-in'],
    ['apikey', 'API keys'],
    ['entry', 'Entries'],
    ['device', 'Devices'],
    ['config', 'Config'],
  ];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-1">Activity</h3>
        <p className="text-xs text-slate-500 leading-relaxed">
          System-level record of sign-ins, API key changes, configuration updates, and device status changes.
          The most recent 500 events are kept.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {filters.map(([value, text]) => (
          <button
            key={value || 'all'}
            onClick={() => setFilter(value)}
            aria-pressed={filter === value}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
              filter === value
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {text}
          </button>
        ))}
        <button onClick={load} className="ml-auto px-2.5 py-1 rounded-lg text-xs font-medium border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">
          Refresh
        </button>
        <button onClick={clear} className="px-2.5 py-1 rounded-lg text-xs font-medium border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
          Clear
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-slate-400">Loading activity…</div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-slate-400 italic">Nothing recorded yet.</p>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden max-h-96 overflow-y-auto">
          {entries.map(e => (
            <div key={e.id} className="flex items-start gap-3 px-3 py-2 border-b border-slate-100 last:border-0">
              <span className={`px-1.5 py-0.5 text-xs font-mono rounded border shrink-0 ${colourFor(e.type)}`}>
                {e.type}
              </span>
              <span className="text-sm text-slate-700 flex-1 min-w-0">{e.message}</span>
              <span className="text-xs text-slate-400 shrink-0" title={new Date(e.ts).toLocaleString()}>
                {relative(e.ts)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DeviceHistory({ ip }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/ips/${encodeURIComponent(ip)}/history`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [ip]);

  if (error) return null;                       // history is a bonus, never an error state
  if (!data) return <div className="text-xs text-slate-400">Loading history…</div>;

  const when = (iso) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const label = {
    'offline':     { text: 'Went offline',      cls: 'text-red-600' },
    'online':      { text: 'Came back online',  cls: 'text-emerald-600' },
    'health.down': { text: 'Health check failed', cls: 'text-orange-600' },
    'health.up':   { text: 'Health check recovered', cls: 'text-emerald-600' },
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-slate-400 text-xs uppercase tracking-wide">Recent history</span>
        {data.outageCount > 0 && (
          <span className="text-xs text-slate-400">
            {data.outageCount} outage{data.outageCount === 1 ? '' : 's'} in {data.windowDays} days
          </span>
        )}
      </div>

      {data.lastSeen && (
        <p className="text-xs text-slate-500 mb-2">Last seen responding {when(data.lastSeen)}</p>
      )}

      {data.events.length === 0 ? (
        <p className="text-xs text-slate-400 italic">
          No status changes recorded — this device has been stable.
        </p>
      ) : (
        <ul className="space-y-1 max-h-32 overflow-y-auto">
          {data.events.slice(0, 12).map((e, i) => {
            const meta = label[e.type] || { text: e.type, cls: 'text-slate-600' };
            return (
              <li key={i} className="flex items-baseline gap-2 text-xs">
                <span className={meta.cls}>{meta.text}</span>
                {e.detail && <span className="text-slate-400">{e.detail}</span>}
                <span className="text-slate-400 ml-auto" title={new Date(e.ts).toLocaleString()}>
                  {when(e.ts)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TopologyModal({ onClose }) {
  const modalRef = useModalA11y(typeof onClose === 'function' ? onClose : null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [impact, setImpact] = useState(null);
  const [showGateway, setShowGateway] = useState(false);

  const query = showGateway ? '?gateway=1' : '';

  useEffect(() => {
    setData(null);
    fetch(`/api/topology${query}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setData)
      .catch(() => setError('Could not load the topology'));
  }, [query]);

  useEffect(() => {
    if (!selected) { setImpact(null); return; }
    fetch(`/api/topology/impact/${encodeURIComponent(selected)}${query}`)
      .then(r => r.json()).then(setImpact).catch(() => setImpact(null));
  }, [selected, query]);

  // ── Layout ────────────────────────────────────────────────────────────────
  // Deterministic rather than force-directed: devices are laid out in columns
  // by group, which keeps the picture stable between refreshes. A physics
  // simulation looks impressive and makes it impossible to find anything twice.
  const layout = useMemo(() => {
    if (!data) return null;
    const COL_W = 200, ROW_H = 46, PAD_X = 24, PAD_TOP = 64;
    const positions = new Map();
    const columns = [];

    data.groups.forEach((group, gi) => {
      const members = data.nodes.filter(n => n.group === group.id);
      columns.push({ group, members, x: PAD_X + gi * COL_W });
      members.forEach((node, ni) => {
        positions.set(node.id, { x: PAD_X + gi * COL_W, y: PAD_TOP + ni * ROW_H });
      });
    });

    const tallest = Math.max(1, ...columns.map(c => c.members.length));
    return {
      columns,
      positions,
      width: Math.max(560, PAD_X * 2 + columns.length * COL_W),
      height: PAD_TOP + tallest * ROW_H + 40,
    };
  }, [data]);

  const statusColour = (status) =>
    status === 'online' ? '#10b981' : status === 'offline' ? '#ef4444' : '#cbd5e1';

  const affectedSet = new Set((impact?.affected || []).map(a => a.id));

  return (
    <div ref={modalRef} role="dialog" aria-modal="true" aria-label="Network topology" tabIndex={-1}
         className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 outline-none" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Network Topology</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {data
                ? `${data.stats.devices} devices · ${data.stats.dependencyLinks} dependency · ${data.stats.hypervisorLinks} hypervisor`
                  + (data.stats.gatewayLinks ? ` · ${data.stats.gatewayLinks} gateway` : '')
                : 'Loading…'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
              <input type="checkbox" checked={showGateway}
                     onChange={e => setShowGateway(e.target.checked)}
                     className="rounded border-slate-300" />
              Show gateway links
            </label>
            <button onClick={onClose} aria-label="Close" className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 bg-slate-50">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!data && !error && <p className="text-sm text-slate-400">Building the graph…</p>}

          {data && data.nodes.length === 0 && (
            <p className="text-sm text-slate-400 italic">No devices to show yet.</p>
          )}

          {/* Why the picture may look sparse. Without this the diagram just
              looks broken — the user has no way to know the map is waiting on
              information only they can supply. */}
          {data?.hints?.untrackedHosts?.length > 0 && (
            <div className="mb-3 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
              {data.hints.untrackedHosts.length === 1 ? 'Hypervisor ' : 'Hypervisors '}
              <span className="font-mono font-semibold">{data.hints.untrackedHosts.join(', ')}</span>
              {data.hints.untrackedHosts.length === 1 ? ' has' : ' have'} guests here but
              {data.hints.untrackedHosts.length === 1 ? ' is' : ' are'} not in your inventory.
              Add an entry named the same as the node to link the guests to it.
            </div>
          )}

          {data?.hints?.noLinks && (
            <div className="mb-3 text-xs bg-slate-100 border border-slate-200 text-slate-600 rounded-lg px-3 py-2">
              No relationships yet. Set <span className="font-semibold">Dependencies</span> on a few
              entries — a NAS on its switch, a service on its database — and they will appear here.
              Guests imported from Proxmox link to their host automatically.
            </div>
          )}

          {data && layout && data.nodes.length > 0 && (
            <svg width={layout.width} height={layout.height} className="mx-auto">
              {/* Column headings */}
              {layout.columns.map(col => (
                <g key={col.group.id}>
                  <text x={col.x} y={28} className="fill-slate-500" style={{ fontSize: 11, fontWeight: 600 }}>
                    {col.group.label}
                  </text>
                  <text x={col.x} y={44} className="fill-slate-400" style={{ fontSize: 10 }}>
                    {col.group.kind === 'hypervisor' ? 'hypervisor' : 'network'} · {col.members.length}
                  </text>
                </g>
              ))}

              {/* Edges, drawn first so nodes sit on top */}
              {data.edges.map((edge, i) => {
                const a = layout.positions.get(edge.from);
                const b = layout.positions.get(edge.to);
                if (!a || !b) return null;
                const highlighted = selected && (edge.from === selected || edge.to === selected);
                return (
                  <path
                    key={i}
                    d={`M ${a.x + 150} ${a.y + 14} C ${a.x + 180} ${a.y + 14}, ${b.x - 30} ${b.y + 14}, ${b.x} ${b.y + 14}`}
                    fill="none"
                    stroke={highlighted ? '#6366f1'
                      : edge.kind === 'hypervisor' ? '#cbd5e1'
                      : edge.kind === 'gateway' ? '#e2e8f0' : '#94a3b8'}
                    strokeWidth={highlighted ? 2 : 1}
                    strokeDasharray={edge.kind === 'hypervisor' ? '3 3' : edge.kind === 'gateway' ? '1 4' : undefined}
                  />
                );
              })}

              {/* Nodes */}
              {data.nodes.map(node => {
                const pos = layout.positions.get(node.id);
                if (!pos) return null;
                const isSelected = selected === node.id;
                const isAffected = affectedSet.has(node.id);
                return (
                  <g key={node.id} transform={`translate(${pos.x}, ${pos.y})`}
                     onClick={() => setSelected(isSelected ? null : node.id)}
                     style={{ cursor: 'pointer' }}>
                    <rect width={150} height={28} rx={6}
                          fill={isSelected ? '#eef2ff' : isAffected ? '#fef3c7' : '#ffffff'}
                          stroke={isSelected ? '#6366f1' : isAffected ? '#f59e0b' : '#e2e8f0'}
                          strokeWidth={isSelected || isAffected ? 2 : 1} />
                    <circle cx={12} cy={14} r={4} fill={statusColour(node.status)} />
                    <text x={24} y={18} className="fill-slate-700" style={{ fontSize: 11 }}>
                      {node.label.length > 18 ? node.label.slice(0, 17) + '…' : node.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-white flex items-center gap-4 text-xs text-slate-500 flex-wrap">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /> online</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" /> offline</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-300" /> unknown</span>
          <span className="flex items-center gap-1.5"><svg width="20" height="4"><line x1="0" y1="2" x2="20" y2="2" stroke="#94a3b8" strokeWidth="1"/></svg> depends on</span>
          <span className="flex items-center gap-1.5"><svg width="20" height="4"><line x1="0" y1="2" x2="20" y2="2" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3 3"/></svg> hypervisor</span>
          {showGateway && (
            <span className="flex items-center gap-1.5"><svg width="20" height="4"><line x1="0" y1="2" x2="20" y2="2" stroke="#e2e8f0" strokeWidth="1" strokeDasharray="1 4"/></svg> gateway</span>
          )}
          {selected && impact && (
            <span className="ml-auto text-slate-600">
              {impact.count === 0
                ? 'Nothing depends on this device'
                : `${impact.count} device${impact.count === 1 ? '' : 's'} would be affected if this went down`}
            </span>
          )}
          {!selected && <span className="ml-auto text-slate-400">Click a device to trace what depends on it</span>}
        </div>
      </div>
    </div>
  );
}

// Friendly labels for the DNS-SD service types worth naming. Anything not
// listed is shown as its raw type rather than guessed at.
const MDNS_SERVICE_LABELS = {
  '_airplay._tcp': 'AirPlay',
  '_raop._tcp': 'AirPlay audio',
  '_companion-link._tcp': 'Apple device',
  '_googlecast._tcp': 'Chromecast',
  '_ipp._tcp': 'Printer',
  '_ipps._tcp': 'Printer',
  '_printer._tcp': 'Printer',
  '_pdl-datastream._tcp': 'Printer',
  '_smb._tcp': 'File share',
  '_afpovertcp._tcp': 'File share',
  '_nfs._tcp': 'File share',
  '_ssh._tcp': 'SSH',
  '_sftp-ssh._tcp': 'SFTP',
  '_http._tcp': 'Web',
  '_https._tcp': 'Web',
  '_workstation._tcp': 'Workstation',
  '_device-info._tcp': 'Device info',
  '_homekit._tcp': 'HomeKit',
  '_hap._tcp': 'HomeKit',
  '_esphomelib._tcp': 'ESPHome',
  '_hue._tcp': 'Philips Hue',
  '_spotify-connect._tcp': 'Spotify Connect',
};

function MdnsModal({ onClose, onApply }) {
  const modalRef = useModalA11y(typeof onClose === 'function' ? onClose : null);
  const [status, setStatus] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [chosen, setChosen] = useState(() => new Set());
  const [applied, setApplied] = useState(0);

  useEffect(() => {
    fetch('/api/mdns/status').then(r => r.json()).then(setStatus).catch(() => {});
  }, []);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    setApplied(0);
    try {
      const res = await fetch('/api/mdns/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeoutMs: 5000 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || json.error || 'The scan failed');
      setStatus(json);
      // Pre-select everything that is safe to fill, since that is what the user
      // came here for — but nothing is written until they press Apply.
      setChosen(new Set(
        (json.suggestions || [])
          .filter(s => s.canFillName || s.canFillHostname)
          .map(s => s.ip)
      ));
    } catch (err) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  };

  const suggestions = status?.suggestions || [];
  const fillable = suggestions.filter(s => s.canFillName || s.canFillHostname);

  const toggle = (ip) => setChosen(prev => {
    const next = new Set(prev);
    if (next.has(ip)) next.delete(ip); else next.add(ip);
    return next;
  });

  const apply = () => {
    const updates = fillable
      .filter(s => chosen.has(s.ip))
      .map(s => ({
        ip: s.ip,
        assetName: s.canFillName ? s.suggestedName : undefined,
        hostname: s.canFillHostname ? s.hostname : undefined,
      }));
    if (!updates.length) return;
    onApply(updates);
    setApplied(updates.length);
  };

  return (
    <div ref={modalRef} role="dialog" aria-modal="true" aria-label="mDNS discovery" tabIndex={-1}
         className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 outline-none" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-800">mDNS Discovery</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Asks the network what its devices call themselves
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={runScan} disabled={scanning}
                    className="px-3 py-1.5 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {scanning ? 'Scanning…' : 'Scan'}
            </button>
            <button onClick={onClose} aria-label="Close" className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 bg-slate-50">
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
          {status?.error && (
            <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 mb-3">
              {status.error}
            </p>
          )}

          {applied > 0 && (
            <p className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-3 py-2 mb-3">
              {applied} {applied === 1 ? 'entry' : 'entries'} updated. Nothing is saved until you
              press <span className="font-semibold">Save</span> in the main view.
            </p>
          )}

          {!status?.scannedAt && !scanning && (
            <div className="text-sm text-slate-500 space-y-2">
              <p>No scan run yet. Press <span className="font-semibold">Scan</span> to ask the network.</p>
              <p className="text-xs text-slate-400">
                Apple devices, printers, Chromecasts, NAS boxes and anything running Avahi announce
                a name over multicast DNS. Discovery only ever fills in blanks — a name you typed is
                never replaced.
              </p>
            </div>
          )}

          {scanning && <p className="text-sm text-slate-400">Listening for about five seconds…</p>}

          {status?.scannedAt && !scanning && suggestions.length === 0 && (
            <div className="text-sm text-slate-500 space-y-2">
              <p>Nothing answered.</p>
              <p className="text-xs text-slate-400">
                That is a normal result on a network with no Apple, Google or Avahi devices — and
                also what you see if multicast does not cross your VLANs, which is common. It does
                not indicate a fault.
              </p>
            </div>
          )}

          {suggestions.length > 0 && (
            <>
              <div className="flex items-center justify-between mb-2 text-xs text-slate-500">
                <span>{suggestions.length} discovered · {fillable.length} with something to fill in</span>
                {fillable.length > 0 && (
                  <button onClick={() => setChosen(chosen.size === fillable.length
                            ? new Set() : new Set(fillable.map(s => s.ip)))}
                          className="text-indigo-600 hover:underline">
                    {chosen.size === fillable.length ? 'Select none' : 'Select all'}
                  </button>
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
                {suggestions.map(s => {
                  const canFill = s.canFillName || s.canFillHostname;
                  return (
                    <div key={s.ip} className="flex items-start gap-3 px-3 py-2.5">
                      <input type="checkbox" disabled={!canFill} checked={chosen.has(s.ip)}
                             onChange={() => toggle(s.ip)} className="mt-1 rounded border-slate-300 disabled:opacity-30"
                             aria-label={`Apply discovered details to ${s.ip}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="font-mono text-sm text-slate-700">{s.ip}</span>
                          {s.suggestedName && <span className="text-sm text-slate-800 font-medium">{s.suggestedName}</span>}
                          {s.hostname && <span className="text-xs text-slate-400 font-mono">{s.hostname}.local</span>}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {s.services.map(svc => (
                            <span key={svc} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                              {MDNS_SERVICE_LABELS[svc] || svc}
                            </span>
                          ))}
                          {!s.inInventory && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                              not in your inventory
                            </span>
                          )}
                          {s.inInventory && !canFill && (
                            <span className="text-[10px] text-slate-400">
                              already named{s.currentName ? ` — ${s.currentName}` : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-white flex items-center gap-3 text-xs text-slate-500">
          {status?.scannedAt && <span>Last scan {new Date(status.scannedAt).toLocaleTimeString()}</span>}
          <button onClick={apply} disabled={chosen.size === 0}
                  className="ml-auto px-3 py-1.5 text-sm rounded-lg bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-40 transition-colors">
            Fill in {chosen.size > 0 ? chosen.size : ''} selected
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Network Watch ───────────────────────────────────────────────────────────
// Deliberately separate from the inventory. IP Manager's job is the address
// list; this is a different job, so it gets its own view rather than more
// columns and badges on the main table. It stays entirely invisible — no tab,
// no menu item, no nav button — until it is switched on.


// Optional Pi-hole DHCP lookup. Only useful when Pi-hole is the DHCP server —
// plenty of networks let the router hand out leases, in which case Pi-hole
// knows nothing about device names and this stays off.
function PiholeSection() {
  const [cfg, setCfg] = useState(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const load = () => fetch('/api/pihole/config').then(r => r.json()).then(setCfg).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async (changes) => {
    setBusy(true); setResult(null);
    try {
      const body = { ...cfg, ...changes };
      // An empty password means "leave the stored one alone", so the browser
      // never has to hold the secret just to change an unrelated setting.
      if (password) body.password = password;
      const res = await fetch('/api/pihole/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Could not save');
      setPassword('');
      await load();
      setResult({ ok: true, text: 'Saved.' });
    } catch (err) { setResult({ ok: false, text: err.message }); }
    finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true); setResult(null);
    try {
      const res = await fetch('/api/pihole/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cfg.url, verifyTls: cfg.verifyTls, ...(password ? { password } : {}) }),
      });
      const json = await res.json();
      setResult(json.ok
        ? { ok: true, text: `Connected. ${json.leaseCount} lease${json.leaseCount === 1 ? '' : 's'}, ${json.namedCount} with a hostname.` }
        : { ok: false, text: json.error || json.message || 'Could not connect' });
    } catch (err) { setResult({ ok: false, text: err.message }); }
    finally { setBusy(false); }
  };

  if (!cfg) return null;

  return (
    <div className="border-t border-slate-100 pt-4 space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-slate-800">Name devices from Pi-hole DHCP</h4>
        <p className="text-xs text-slate-500 mt-1">
          If Pi-hole hands out your DHCP leases it already knows what each device calls itself.
          Network Watch can use those names to identify devices it does not recognise.
          Leave this off if your router is the DHCP server — Pi-hole will have nothing to offer.
        </p>
      </div>

      <label className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl cursor-pointer">
        <input type="checkbox" checked={cfg.enabled === true} disabled={busy}
               onChange={e => save({ enabled: e.target.checked })}
               className="mt-0.5 rounded border-slate-300" />
        <span>
          <span className="text-sm font-medium text-slate-700">Use Pi-hole DHCP leases</span>
          <span className="block text-xs text-slate-500 mt-0.5">Off by default. Requires Pi-hole v6 or later.</span>
        </span>
      </label>

      {cfg.enabled && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-sm font-medium text-slate-700 mb-1">Pi-hole address</span>
              <input type="text" value={cfg.url} disabled={busy} placeholder="http://192.168.0.2"
                     onChange={e => setCfg({ ...cfg, url: e.target.value })}
                     onBlur={() => save({})}
                     className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-slate-700 mb-1">
                Application password
                {cfg.passwordConfigured && <span className="ml-1.5 text-xs font-normal text-emerald-600">set</span>}
              </span>
              <input type="password" value={password} disabled={busy} autoComplete="new-password"
                     placeholder={cfg.passwordConfigured ? 'unchanged' : 'from Pi-hole settings'}
                     onChange={e => setPassword(e.target.value)}
                     className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </label>
          </div>

          <p className="text-xs text-slate-400">
            Generate one in Pi-hole under <span className="font-medium">Settings → Web interface / API</span>.
            An application password is used rather than your Pi-hole login so it can be revoked on its own.
            It is stored on this server and never sent back to the browser.
          </p>

          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" checked={cfg.verifyTls !== false} disabled={busy}
                   onChange={e => save({ verifyTls: e.target.checked })}
                   className="rounded border-slate-300" />
            Verify the TLS certificate (turn off only for a self-signed certificate on your own LAN)
          </label>

          <div className="flex items-center gap-2">
            <button onClick={() => save({})} disabled={busy}
                    className="px-3 py-1.5 text-sm rounded-lg bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-50">
              Save
            </button>
            <button onClick={test} disabled={busy}
                    className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              Test connection
            </button>
          </div>

          {result && (
            <p className={`text-xs rounded-lg px-3 py-2 ${result.ok
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border border-amber-200 text-amber-900'}`}>
              {result.text}
            </p>
          )}
          {!result && cfg.lastError && (
            <p className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2">
              Last lookup failed: {cfg.lastError}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function NetworkWatchTab({ onOpen }) {
  const [config, setConfig] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const load = () => fetch('/api/watch/status').then(r => r.json()).then(setConfig).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async (changes) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/watch/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, ...changes }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Could not save');
      await load();
      setMessage(changes.enabled === false
        ? 'Network Watch is off. The ledger has been deleted.'
        : 'Saved.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  };

  const clearLedger = async () => {
    setBusy(true);
    try {
      await fetch('/api/watch/ledger', { method: 'DELETE' });
      await load();
      setMessage('Ledger cleared.');
    } catch { setMessage('Could not clear the ledger.'); }
    finally { setBusy(false); }
  };

  if (!config) return <p className="text-sm text-slate-400">Loading…</p>;

  const kb = ((config.summary?.bytes || 0) / 1024).toFixed(1);
  const capacityUsed = Math.round(((config.summary?.total || 0) / (config.maxIdentities || 1)) * 100);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-slate-800">Network Watch</h3>
        <p className="text-sm text-slate-500 mt-1">
          Keeps a record of the devices seen on your network, so you can tell a device you have
          never seen from one that simply changed address. It appears as its own view once enabled.
        </p>
      </div>

      <label className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl cursor-pointer">
        <input type="checkbox" checked={config.enabled === true} disabled={busy}
               onChange={e => save({ enabled: e.target.checked })}
               className="mt-0.5 rounded border-slate-300" />
        <span>
          <span className="text-sm font-medium text-slate-700">Enable Network Watch</span>
          <span className="block text-xs text-slate-500 mt-0.5">
            Off by default. While off, nothing is recorded and no storage is used.
          </span>
        </span>
      </label>

      {message && <p className="text-xs text-slate-600 bg-slate-100 rounded-lg px-3 py-2">{message}</p>}

      {config.enabled && (
        <>
          {/* Enabling a feature should not leave the user hunting for it. The
              header icon is easy to miss, so the feature opens from the place
              it was switched on, which is also where its icon gets pointed out. */}
          <div className="flex items-center gap-3 p-3 bg-indigo-50 border border-indigo-100 rounded-xl">
            <button onClick={() => onOpen && onOpen()}
                    className="px-3 py-1.5 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors flex-shrink-0">
              Open Network Watch
            </button>
            <p className="text-xs text-indigo-900/70">
              It also lives in the <span className="font-semibold">Tools</span> menu, alongside
              Topology and mDNS Discovery.
            </p>
          </div>

          <div className="p-3 border border-slate-200 rounded-xl space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-slate-700">Storage</span>
              <span className="text-sm font-mono text-slate-600">{kb} KB</span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full"
                   style={{ width: `${Math.min(100, capacityUsed)}%` }} />
            </div>
            <p className="text-xs text-slate-500">
              {config.summary?.total || 0} of {config.maxIdentities} devices recorded.
              One record per device, updated in place — this does not grow as time passes,
              only as new devices appear.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-sm font-medium text-slate-700 mb-1">Forget randomised MACs after</span>
              <div className="flex items-center gap-2">
                <input type="number" min="1" max="3650" value={config.retainRandomDays} disabled={busy}
                       onChange={e => setConfig({ ...config, retainRandomDays: e.target.value })}
                       onBlur={e => save({ retainRandomDays: e.target.value })}
                       className="w-20 px-2 py-1.5 border border-slate-300 rounded-lg text-sm" />
                <span className="text-xs text-slate-500">days</span>
              </div>
              <span className="block text-xs text-slate-400 mt-1">
                Phones randomise their address; these entries are transient.
              </span>
            </label>

            <label className="block">
              <span className="block text-sm font-medium text-slate-700 mb-1">Forget real MACs after</span>
              <div className="flex items-center gap-2">
                <input type="number" min="1" max="3650" value={config.retainKnownDays} disabled={busy}
                       onChange={e => setConfig({ ...config, retainKnownDays: e.target.value })}
                       onBlur={e => save({ retainKnownDays: e.target.value })}
                       className="w-20 px-2 py-1.5 border border-slate-300 rounded-lg text-sm" />
                <span className="text-xs text-slate-500">days</span>
              </div>
              <span className="block text-xs text-slate-400 mt-1">
                Real hardware is worth remembering longer.
              </span>
            </label>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={clearLedger} disabled={busy}
                    className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              Clear the ledger
            </button>
            <span className="text-xs text-slate-400">Forgets every device and starts again.</span>
          </div>

          <PiholeSection />

          <p className="text-xs text-slate-400 border-t border-slate-100 pt-3">
            This phase observes only. It raises no alerts and sends no notifications.
          </p>
        </>
      )}
    </div>
  );
}

function NetworkWatchView({ onClose, onAdd, localEntries = [] }) {
  const modalRef = useModalA11y(typeof onClose === 'function' ? onClose : null);
  const [data, setData] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [filter, setFilter] = useState('all');   // all | unknown | known | random

  const load = () => fetch('/api/watch/devices').then(r => r.json()).then(setData).catch(() => setError('Could not load'));
  useEffect(() => { load(); }, []);

  const scan = async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch('/api/watch/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'The scan failed');
      setData({ enabled: true, devices: json.devices, summary: json.summary, pihole: json.pihole });
      setWarnings(json.warnings || []);
    } catch (err) { setError(err.message); }
    finally { setScanning(false); }
  };

  // The server decides `inInventory` from the saved dataset, but an entry the
  // user has just added is not saved yet. Overlaying the local list makes the
  // row flip the moment it is added, rather than after the next Save — which
  // is what makes working through a list of unknowns feel like progress.
  const localIps = useMemo(() => new Set(
    (localEntries || [])
      .filter(e => e && e.ip && e.assetName && e.assetName !== 'Free' && e.assetName !== 'Reserved')
      .map(e => e.ip)
  ), [localEntries]);

  const devices = (data?.devices || []).map(d =>
    d.inInventory || !d.currentIp || !localIps.has(d.currentIp)
      ? d
      : { ...d, inInventory: true, inventoryName: (localEntries.find(e => e.ip === d.currentIp) || {}).assetName || null }
  );
  const shown = devices.filter(d =>
    filter === 'all' ? true
    : filter === 'unknown' ? (!d.inInventory && !d.random)
    : filter === 'known' ? d.inInventory
    : d.random);

  const summary = data?.summary || {};
  const kb = ((summary.bytes || 0) / 1024).toFixed(1);

  // Recomputed from the overlaid list rather than taken from the server, so the
  // chips agree with the rows while additions are still unsaved.
  const counts = [
    { id: 'all', label: 'All', n: devices.length },
    { id: 'known', label: 'In inventory', n: devices.filter(d => d.inInventory).length },
    { id: 'unknown', label: 'Unrecognised', n: devices.filter(d => !d.inInventory && !d.random).length },
    { id: 'random', label: 'Randomised', n: devices.filter(d => d.random).length },
  ];

  return (
    <div ref={modalRef} role="dialog" aria-modal="true" aria-label="Network Watch" tabIndex={-1}
         className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 outline-none" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Network Watch</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Devices seen on your network · {kb} KB stored
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={scan} disabled={scanning}
                    className="px-3 py-1.5 text-sm rounded-lg bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-50 transition-colors">
              {scanning ? 'Scanning…' : 'Scan now'}
            </button>
            <button onClick={onClose} aria-label="Close" className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>
        </div>

        <div className="px-5 py-2.5 border-b border-slate-100 flex items-center gap-1.5 flex-wrap">
          {counts.map(c => (
            <button key={c.id} onClick={() => setFilter(c.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${
                      filter === c.id ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {c.label} <span className="opacity-60">{c.n}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-4 bg-slate-50">
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

          {/* A scan that found nothing must say why. Silently reporting zero
              devices is indistinguishable from a quiet network. */}
          {data?.pihole?.enabled && data.pihole.error && (
            <div className="mb-3 text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2">
              Pi-hole DHCP lookup failed, so some devices may be unnamed: {data.pihole.error}
            </div>
          )}

          {warnings.length > 0 && (
            <div className="mb-3 text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2 space-y-1">
              {warnings.map((w, i) => <p key={i}>{w}</p>)}
            </div>
          )}

          {devices.length === 0 && !scanning && (
            <div className="text-sm text-slate-500 space-y-2">
              <p>Nothing recorded yet.</p>
              <p className="text-xs text-slate-400">
                Press <span className="font-semibold">Scan now</span>, or enable the background
                discovery sweep in <span className="font-semibold">Settings → ARP &amp; Presence</span>
                to build this up automatically.
              </p>
              <p className="text-xs text-slate-400">
                Discovery needs <span className="font-mono">arp-scan</span> on the server. If a scan
                reports nothing and shows no warning above, check that it is installed and permitted:
                <span className="font-mono block mt-1">setcap cap_net_raw+ep $(which arp-scan)</span>
              </p>
            </div>
          )}

          {scanning && <p className="text-sm text-slate-400">Sweeping the network…</p>}

          {shown.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
              {shown.map(d => (
                <div key={d.mac} className="px-3 py-2.5 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-800">
                        {d.inventoryName || d.name || d.hostname || d.dhcpName || d.vendor || 'Unidentified device'}
                      </span>
                      {d.currentIp && <span className="font-mono text-xs text-slate-500">{d.currentIp}</span>}
                      <span className="font-mono text-[10px] text-slate-400">{d.mac}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {d.inInventory
                        ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">in inventory</span>
                        : <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">not in inventory</span>}
                      {d.random && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500"
                              title="A randomised address. Phones generate these per network, so this is very likely a device you already know.">
                          randomised MAC
                        </span>
                      )}
                      {d.duplicateArp && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600"
                              title="More than one reply came back for this address. Usually a host with two interfaces on the same segment — occasionally worth a second look.">
                          duplicate ARP reply
                        </span>
                      )}
                      {d.dhcpName && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700"
                              title="The name this device gave your DHCP server when it took its lease">
                          DHCP: {d.dhcpName}
                        </span>
                      )}
                      {/* A hypervisor prefix says something more useful than the
                          company that registered it: this is a virtual machine,
                          and which platform it runs on. The registry name stays
                          in the tooltip rather than being discarded. */}
                      {d.platform && !d.random && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700"
                              title={d.vendor ? `Virtual machine · ${d.vendor}` : 'Virtual machine'}>
                          {d.platform} VM
                        </span>
                      )}
                      {d.vendor && !d.platform && !d.random && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{d.vendor}</span>
                      )}
                      <span className="text-[10px] text-slate-400">
                        seen {d.sightings}× · {d.daysSinceSeen === 0 ? 'today' : `${d.daysSinceSeen}d ago`}
                      </span>
                    </div>
                  </div>

                  {/* The missing half of the feature: the view told you about a
                      device and then made you memorise an address, close it and
                      retype everything. This opens the normal edit form with
                      what is already known filled in. */}
                  {!d.inInventory && d.currentIp && onAdd && (
                    <button
                      onClick={() => onAdd(d)}
                      className="flex-shrink-0 px-2.5 py-1 text-xs rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 hover:border-slate-400 transition-colors"
                      title={`Add ${d.currentIp} to the inventory`}>
                      Add
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {devices.length > 0 && shown.length === 0 && (
            <p className="text-sm text-slate-400 italic">Nothing in this category.</p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-white text-xs text-slate-500">
          Observing only — no alerts are sent. Randomised addresses are shown but are almost always
          a phone you already own.
        </div>
      </div>
    </div>
  );
}

function SecurityTab() {
  const [status, setStatus] = useState(null);
  const [setup, setSetup] = useState(null);        // { secret, uri } during enrolment
  const [qrSrc, setQrSrc] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState(null); // shown once, after enabling
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const load = () => fetch('/api/auth/totp').then(r => r.json()).then(setStatus).catch(() => {});
  useEffect(() => { load(); }, []);

  // The QR is rendered client-side with the same lazily-loaded library the IP
  // cards use, so the secret never travels anywhere it does not already go.
  useEffect(() => {
    if (!setup?.uri) { setQrSrc(''); return; }
    let cancelled = false;
    loadQRCode()
      .then(QRCode => QRCode.toDataURL(setup.uri, { width: 200, margin: 1 }))
      .then(src => { if (!cancelled) setQrSrc(src); })
      .catch(() => { if (!cancelled) setQrSrc(''); });
    return () => { cancelled = true; };
  }, [setup]);

  const post = async (path, body) => {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    return { ok: r.ok, data: await r.json().catch(() => ({})) };
  };

  const beginSetup = async () => {
    setBusy(true); setMessage(null);
    const { ok, data } = await post('/api/auth/totp/setup');
    setBusy(false);
    if (!ok) return setMessage({ kind: 'error', text: data.message || 'Could not start setup' });
    setSetup(data);
  };

  const confirmSetup = async () => {
    setBusy(true); setMessage(null);
    const { ok, data } = await post('/api/auth/totp/enable', { code });
    setBusy(false);
    if (!ok) return setMessage({ kind: 'error', text: data.message || 'That code was not correct' });
    setRecoveryCodes(data.recoveryCodes);
    setSetup(null);
    setCode('');
    load();
  };

  const cancelSetup = async () => {
    await post('/api/auth/totp/cancel');
    setSetup(null); setCode(''); setMessage(null);
    load();
  };

  const disable = async () => {
    if (!password) return setMessage({ kind: 'error', text: 'Enter your account password to confirm' });
    if (!confirm('Turn off two-factor authentication?\n\nYou will sign in with your password alone.')) return;
    setBusy(true); setMessage(null);
    const { ok, data } = await post('/api/auth/totp/disable', { password });
    setBusy(false);
    setPassword('');
    if (!ok) return setMessage({ kind: 'error', text: data.message || 'Could not disable' });
    setMessage({ kind: 'ok', text: 'Two-factor authentication is off.' });
    load();
  };

  const regenerate = async () => {
    if (!password) return setMessage({ kind: 'error', text: 'Enter your account password to confirm' });
    setBusy(true); setMessage(null);
    const { ok, data } = await post('/api/auth/totp/recovery-codes', { password });
    setBusy(false);
    setPassword('');
    if (!ok) return setMessage({ kind: 'error', text: data.message || 'Could not generate new codes' });
    setRecoveryCodes(data.recoveryCodes);
    load();
  };

  const copyCodes = () => navigator.clipboard.writeText(recoveryCodes.join('\n'));
  const downloadCodes = () => {
    const blob = new Blob(
      [`IP Manager — two-factor recovery codes\nGenerated ${new Date().toLocaleString()}\n\n${recoveryCodes.join('\n')}\n\nEach code can be used once, instead of an authenticator code, to sign in.\nKeep these somewhere safe and separate from your password manager.\n`],
      { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ip-manager-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!status) return <div className="text-sm text-slate-400">Loading…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-1">Two-factor authentication</h3>
        <p className="text-xs text-slate-500 leading-relaxed">
          Adds a 6-digit code from an authenticator app to your sign-in. Optional and off by default.
          Worth turning on if this server is reachable from the internet.
        </p>
      </div>

      {message && (
        <div className={`text-xs rounded-lg px-3 py-2 border ${
          message.kind === 'ok'
            ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
            : 'text-red-600 bg-red-50 border-red-200'
        }`}>{message.text}</div>
      )}

      {/* Recovery codes — shown once, immediately after they are generated */}
      {recoveryCodes && (
        <div className="border-2 border-amber-300 bg-amber-50 rounded-xl p-4">
          <h4 className="text-sm font-semibold text-amber-900 mb-1">Save your recovery codes now</h4>
          <p className="text-xs text-amber-800 mb-3">
            This is the only time these will be shown. Each one can be used once instead of an
            authenticator code. Without them, losing your phone means recovering over SSH.
          </p>
          <div className="grid grid-cols-2 gap-1.5 font-mono text-sm bg-white rounded-lg p-3 border border-amber-200 mb-3">
            {recoveryCodes.map(c => <div key={c} className="text-slate-700">{c}</div>)}
          </div>
          <div className="flex gap-2">
            <button onClick={copyCodes} className="px-3 py-1.5 bg-white border border-amber-300 text-amber-800 rounded-lg text-xs font-medium hover:bg-amber-100 transition-colors">Copy</button>
            <button onClick={downloadCodes} className="px-3 py-1.5 bg-white border border-amber-300 text-amber-800 rounded-lg text-xs font-medium hover:bg-amber-100 transition-colors">Download</button>
            <button onClick={() => setRecoveryCodes(null)} className="ml-auto px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700 transition-colors">I have saved them</button>
          </div>
        </div>
      )}

      {/* Enrolment */}
      {setup && (
        <div className="border border-slate-200 rounded-xl p-4 space-y-3">
          <h4 className="text-sm font-semibold text-slate-700">Scan this with your authenticator</h4>
          {qrSrc
            ? <img src={qrSrc} alt="QR code for two-factor setup" className="rounded-lg border border-slate-200" width={200} height={200} />
            : <div className="w-[200px] h-[200px] bg-slate-100 rounded-lg animate-pulse" />}
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer hover:text-slate-700">Can't scan? Enter this key manually</summary>
            <code className="block mt-2 font-mono bg-slate-100 rounded p-2 break-all">{setup.secret}</code>
          </details>
          <div>
            <label htmlFor="totp-verify" className="block text-xs font-medium text-slate-600 mb-1">
              Enter the code it shows, to confirm it works
            </label>
            <input
              id="totp-verify"
              type="text"
              inputMode="numeric"
              value={code}
              onChange={e => setCode(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && confirmSetup()}
              placeholder="000000"
              className="w-40 px-3 py-2 border border-slate-300 rounded-lg text-center font-mono tracking-[0.25em] outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={confirmSetup} disabled={busy || !code} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors">
              {busy ? 'Verifying…' : 'Verify and enable'}
            </button>
            <button onClick={cancelSetup} className="px-4 py-2 bg-slate-100 border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors">Cancel</button>
          </div>
          <p className="text-xs text-slate-400">
            Nothing changes until a code verifies — you cannot lock yourself out by mis-scanning.
          </p>
        </div>
      )}

      {/* Current state */}
      {!setup && (
        <div className="border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className={`w-2 h-2 rounded-full ${status.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            <span className="text-sm font-medium text-slate-700">
              {status.enabled ? 'Enabled' : 'Not enabled'}
            </span>
            {status.enabled && (
              <span className="text-xs text-slate-400 ml-auto">
                {status.recoveryCodesRemaining} recovery code{status.recoveryCodesRemaining === 1 ? '' : 's'} left
              </span>
            )}
          </div>

          {!status.enabled ? (
            <button onClick={beginSetup} disabled={busy} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors">
              {busy ? 'Starting…' : 'Set up two-factor authentication'}
            </button>
          ) : (
            <div className="space-y-3">
              {status.recoveryCodesRemaining <= 2 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Only {status.recoveryCodesRemaining} recovery code{status.recoveryCodesRemaining === 1 ? '' : 's'} left — generate a fresh set.
                </p>
              )}
              <div>
                <label htmlFor="confirm-pw" className="block text-xs font-medium text-slate-600 mb-1">
                  Account password (required for the actions below)
                </label>
                <input
                  id="confirm-pw"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-56 px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="••••••••"
                />
              </div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={regenerate} disabled={busy} className="px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg text-xs font-medium hover:bg-amber-100 disabled:opacity-50 transition-colors">
                  New recovery codes
                </button>
                <button onClick={disable} disabled={busy} className="px-3 py-1.5 bg-red-50 border border-red-200 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 disabled:opacity-50 transition-colors">
                  Turn off
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="text-xs text-slate-400 leading-relaxed border-t border-slate-100 pt-4">
        <strong className="text-slate-500">Locked out?</strong> Use a recovery code at the sign-in screen.
        If you have lost those too, run <code className="font-mono bg-slate-100 px-1 rounded">sudo node /opt/ip-manager/scripts/disable-totp.cjs</code> on
        the server and restart the service. Your data and password are untouched.
      </div>
    </div>
  );
}

function ApiKeysTab() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [scope, setScope] = useState('read');
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [revealed, setRevealed] = useState({});
  const [error, setError] = useState(null);

  const load = () => {
    fetch('/api/keys')
      .then(r => r.json())
      .then(d => { setKeys(d.keys || []); setLoading(false); })
      .catch(() => { setError('Could not load API keys'); setLoading(false); });
  };

  useEffect(load, []);

  const create = async () => {
    if (!label.trim()) { setError('Give the key a label so you can tell your clients apart'); return; }
    setCreating(true);
    setError(null);
    try {
      const r = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim(), scope }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Could not create key'); return; }
      setLabel('');
      setScope('read');
      setRevealed(prev => ({ ...prev, [d.id]: true }));
      load();
    } finally {
      setCreating(false);
    }
  };

  const regenerate = async (entry) => {
    if (!confirm(`Regenerate the key for "${entry.label}"?\n\nThe old key stops working immediately and any client using it must be updated.`)) return;
    await fetch(`/api/keys/${entry.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regenerate: true }),
    });
    setRevealed(prev => ({ ...prev, [entry.id]: true }));
    load();
  };

  const revoke = async (entry) => {
    if (!confirm(`Revoke "${entry.label}"?\n\nAnything using this key loses access immediately. Other keys are unaffected.`)) return;
    await fetch(`/api/keys/${entry.id}`, { method: 'DELETE' });
    load();
  };

  const copy = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const relative = (iso) => {
    if (!iso) return 'never';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const baseUrl = window.location.origin;
  const haKey = keys.find(k => k.label === 'Home Assistant') || keys.find(k => k.scope === 'read');

  const yamlExample = haKey ? `# Add to configuration.yaml or a sensor package file
rest:
  - resource: "${baseUrl}/api/ha/summary"
    headers:
      X-API-Key: "${haKey.key}"
    scan_interval: 60
    sensor:
      - name: "Network Devices Online"
        value_template: "{{ value_json.devices_online }}"
        unit_of_measurement: "devices"
        icon: mdi:lan-check
      - name: "Network Devices Offline"
        value_template: "{{ value_json.devices_offline }}"
        unit_of_measurement: "devices"
        icon: mdi:lan-disconnect
      - name: "Domains Expiring Soon"
        value_template: "{{ value_json.domains_expiring_soon }}"
        unit_of_measurement: "domains"
        icon: mdi:domain

  - resource: "${baseUrl}/api/ha/devices"
    headers:
      X-API-Key: "${haKey.key}"
    scan_interval: 60
    sensor:
      - name: "Network Device List"
        value_template: "{{ value_json.count }}"
        unit_of_measurement: "devices"
        json_attributes:
          - devices` : '';

  const [copiedYaml, setCopiedYaml] = useState(false);
  const copyYaml = () => {
    navigator.clipboard.writeText(yamlExample);
    setCopiedYaml(true);
    setTimeout(() => setCopiedYaml(false), 2000);
  };

  if (loading) return <div className="text-sm text-slate-400">Loading API keys…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-1">API Keys</h3>
        <p className="text-xs text-slate-500 leading-relaxed">
          Give each client its own key — Home Assistant, a phone, a script. Revoking one leaves the others working.
          Pass the key as an <code className="font-mono bg-slate-100 px-1 rounded">X-API-Key</code> header.
        </p>
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {/* Create */}
      <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/60">
        <label className="block text-xs font-medium text-slate-600 mb-2">Create a new key</label>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && create()}
            placeholder="e.g. iPhone, Home Assistant"
            className="flex-1 min-w-[180px] px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
          />
          <select
            value={scope}
            onChange={e => setScope(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="read">Read only</option>
            <option value="write">Read &amp; write</option>
          </select>
          <button
            onClick={create}
            disabled={creating}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {creating ? 'Creating…' : 'Create key'}
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-2">
          Home Assistant only needs <strong>read only</strong>. Choose read &amp; write for a client that edits entries.
        </p>
      </div>

      {/* List */}
      {keys.length === 0 ? (
        <p className="text-sm text-slate-400 italic">No API keys yet. Create one above to connect an external client.</p>
      ) : (
        <div className="space-y-2">
          {keys.map(entry => (
            <div key={entry.id} className="border border-slate-200 rounded-xl p-3 bg-white">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="text-sm font-medium text-slate-700">{entry.label}</span>
                <span className={`px-1.5 py-0.5 text-xs font-medium rounded border ${
                  entry.scope === 'write'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-slate-100 text-slate-500 border-slate-200'
                }`}>
                  {entry.scope === 'write' ? 'read & write' : 'read only'}
                </span>
                <span className="text-xs text-slate-400 ml-auto">last used {relative(entry.lastUsedAt)}</span>
              </div>
              <div className="flex gap-2 items-center">
                <code className="flex-1 font-mono text-xs bg-slate-900 text-emerald-300 rounded-lg px-3 py-2 overflow-x-auto whitespace-nowrap">
                  {revealed[entry.id] ? entry.key : '•'.repeat(32)}
                </code>
                <button
                  onClick={() => setRevealed(p => ({ ...p, [entry.id]: !p[entry.id] }))}
                  className="px-2.5 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-200 transition-colors"
                >
                  {revealed[entry.id] ? 'Hide' : 'Show'}
                </button>
                <button
                  onClick={() => copy(entry.key, entry.id)}
                  className="px-2.5 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-200 transition-colors whitespace-nowrap"
                >
                  {copiedId === entry.id ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <div className="flex gap-2 mt-2">
                <button onClick={() => regenerate(entry)} className="px-2.5 py-1 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg text-xs font-medium hover:bg-amber-100 transition-colors">
                  Regenerate
                </button>
                <button onClick={() => revoke(entry)} className="px-2.5 py-1 bg-red-50 border border-red-200 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors">
                  Revoke
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Endpoints */}
      <div>
        <h4 className="text-sm font-semibold text-slate-700 mb-2">Endpoints</h4>
        <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
          {[
            ['GET',    '/api/ha/summary',  'Device counts and domain expiry totals', 'read'],
            ['GET',    '/api/ha/devices',  'Every device with ping and health status', 'read'],
            ['GET',    '/api/ha/domains',  'Tracked domains with expiry dates', 'read'],
            ['GET',    '/api/ips',         'All IP entries', 'read'],
            ['GET',    '/api/ips/:ip',     'A single entry', 'read'],
            ['POST',   '/api/ips',         'Create an entry', 'write'],
            ['PATCH',  '/api/ips/:ip',     'Update one entry', 'write'],
            ['DELETE', '/api/ips/:ip',     'Delete one entry', 'write'],
          ].map(([method, path, desc, needs]) => (
            <div key={method + path} className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 last:border-0">
              <span className={`font-mono font-semibold w-14 shrink-0 ${needs === 'write' ? 'text-amber-600' : 'text-emerald-600'}`}>{method}</span>
              <code className="font-mono text-slate-700 w-40 shrink-0">{path}</code>
              <span className="text-slate-500 flex-1">{desc}</span>
              <span className="text-slate-400 shrink-0">{needs}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Home Assistant YAML */}
      {haKey && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-slate-700">Home Assistant configuration.yaml</label>
            <button onClick={copyYaml} className="text-xs text-emerald-600 hover:text-emerald-700 font-medium">
              {copiedYaml ? '✓ Copied' : 'Copy YAML'}
            </button>
          </div>
          <pre className="bg-slate-900 text-emerald-300 text-xs rounded-xl p-4 overflow-x-auto leading-relaxed whitespace-pre font-mono max-h-64 overflow-y-auto">
            {yamlExample}
          </pre>
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2 flex items-center gap-1.5">
            <span>⚠</span> This YAML contains a live API key — treat it like a password and do not share it publicly.
          </p>
          <p className="text-xs text-slate-400 mt-2">Uses the <strong>{haKey.label}</strong> key. Restart Home Assistant after adding it.</p>
        </div>
      )}
    </div>
  );
}


// Settings Modal Component
// ── Updates Tab (lives inside SettingsModal) ──────────────────────────────────
// Undo "don't show this again" for the release summary. Without this the
// checkbox would be a one-way door, which is a poor thing to offer someone in
// a hurry to close a dialog.
function WhatsNewReset() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => fetch('/api/whats-new').then(r => r.json()).then(setState).catch(() => {});
  useEffect(() => { load(); }, []);

  if (!state) return null;

  const reset = async () => {
    setBusy(true);
    try { await fetch('/api/whats-new/reset', { method: 'POST' }); await load(); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex items-center gap-3 pt-3 mt-3 border-t border-slate-100">
      <span className="text-xs text-slate-500 flex-1">
        {state.suppressed
          ? 'Release summaries are switched off after an update.'
          : 'A short summary is shown once after each update.'}
      </span>
      {/* Available whether or not they are suppressed: "where is it?" is a
          reasonable question, and the answer should not be "wait for the next
          release". Resetting makes the current release show again on reload. */}
      <button onClick={reset} disabled={busy}
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50 flex-shrink-0">
        {state.suppressed ? 'Show them again' : "Show what's new"}
      </button>
    </div>
  );
}

function UpdatesTab() {
  const [versionInfo,  setVersionInfo]  = useState(null);
  const [versionError, setVersionError] = useState(null);
  const [checking,     setChecking]     = useState(false);
  const [entries,      setEntries]      = useState(null);
  const [expanded,     setExpanded]     = useState(null);

  // Update process state
  const [updatePhase,  setUpdatePhase]  = useState('idle'); // idle | running | restarting | done | failed | rolledback
  const [steps,        setSteps]        = useState([]);     // [{n, total, label, status}]
  const [logs,         setLogs]         = useState([]);
  const [errorMsg,     setErrorMsg]     = useState('');
  const [showLog,      setShowLog]      = useState(false);

  const doVersionCheck = (force = false) => {
    setChecking(true); setVersionError(null);
    fetch(`/api/version-check${force ? '?force=1' : ''}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { d.error ? setVersionError(d.error) : setVersionInfo(d); })
      .catch(() => setVersionError('Could not reach GitHub.'))
      .finally(() => setChecking(false));
  };

  useEffect(() => {
    doVersionCheck();
    fetch('/api/changelog', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (!d.error) { setEntries(d.entries || []); if (d.entries?.[0]) setExpanded(d.entries[0].version); } });
  }, []);

  // SSE-based update progress
  const startUpdate = async () => {
    setUpdatePhase('running');
    setSteps([]); setLogs([]); setErrorMsg(''); setShowLog(false);

    const updateStartedAt = new Date().toISOString();

    const startRes = await fetch('/api/update/start', { method: 'POST', credentials: 'include' });
    if (!startRes.ok) {
      const e = await startRes.json().catch(() => ({}));
      setUpdatePhase('failed'); setErrorMsg(e.error || 'Could not start update'); return;
    }

    const es = new EventSource('/api/update/stream');

    // Start a poll that waits for a result whose timestamp is NEWER than when
    // this update run started. This prevents the poll from accepting a stale
    // result from a previous update run if the SSE connection drops early.
    const startResultPoll = () => {
      const poll = setInterval(async () => {
        try {
          const r = await fetch('/api/update/result', { credentials: 'include' });
          if (!r.ok) return; // server not up yet — keep polling
          const result = await r.json();
          // Only accept a result that belongs to this update run
          if (!result || !result.timestamp || result.timestamp <= updateStartedAt) return;
          clearInterval(poll);
          setSteps(prev => prev.map(s => ({ ...s, status: 'done' })));
          setUpdatePhase(result.status === 'success' ? 'done' : 'failed');
          if (result.status !== 'success') setErrorMsg(result.message || 'Update failed');
          doVersionCheck(true);
        } catch { /* still restarting — keep polling */ }
      }, 2000);
    };

    es.onmessage = (e) => {
      const line = e.data;
      if (line.startsWith(':')) return; // SSE keepalive comment — ignore
      if (line.startsWith('STEP:')) {
        const [, n, total, label] = line.split(':');
        setSteps(prev => {
          const next = [...prev];
          // mark previous step done
          if (next.length > 0) next[next.length - 1] = { ...next[next.length - 1], status: 'done' };
          next.push({ n: Number(n), total: Number(total), label, status: 'active' });
          return next;
        });
      } else if (line.startsWith('LOG:') || line.startsWith('OK:')) {
        setLogs(prev => [...prev, line.replace(/^(LOG:|OK:)/, '')]);
      } else if (line.startsWith('RESTARTING:')) {
        setUpdatePhase('restarting');
        setSteps(prev => prev.map((s, i) => i === prev.length - 1 ? { ...s, status: 'active' } : s));
        es.close();
        startResultPoll();
      } else if (line.startsWith('SUCCESS:')) {
        setSteps(prev => prev.map(s => ({ ...s, status: 'done' })));
        setUpdatePhase('done');
        es.close();
        doVersionCheck(true);
      } else if (line.startsWith('FAIL:')) {
        setErrorMsg(line.replace('FAIL:', ''));
        setUpdatePhase('failed');
        es.close();
      } else if (line.startsWith('ROLLBACK:')) {
        setUpdatePhase('rolledback');
        setLogs(prev => [...prev, line.replace('ROLLBACK:', '⟳ ')]);
      } else if (line.startsWith('ROLLBACK_DONE:')) {
        setLogs(prev => [...prev, '✓ Rolled back to previous version']);
        startResultPoll();
      } else if (line.startsWith('DONE:')) {
        es.close();
      }
    };

    es.onerror = () => {
      // Connection dropped — server may be restarting or Nginx timed out
      es.close();
      if (updatePhase !== 'done' && updatePhase !== 'failed') {
        setUpdatePhase('restarting');
        startResultPoll();
      }
    };
  };

  const updateAvailable = versionInfo?.updateAvailable;
  // Progress: count done steps + 0.5 for the currently-active step so the bar
  // advances visibly as soon as each step starts, not only when it finishes.
  const progressPct = steps.length > 0
    ? Math.round(((steps.filter(s => s.status === 'done').length + (steps.some(s => s.status === 'active') ? 0.5 : 0)) / steps[0].total) * 100)
    : 0;

  function renderBody(body) {
    if (!body) return null;
    return body.split(/\n{2,}/).map((para, i) => {
      const parts = para.split(/\*\*(.+?)\*\*/g).map((c, j) =>
        j % 2 === 1 ? <strong key={j}>{c}</strong> : c
      );
      return <p key={i} className="text-sm text-slate-600 leading-relaxed mb-2 last:mb-0">{parts}</p>;
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-slate-800 mb-1">Updates</h3>
        <p className="text-xs text-slate-500">Check for new versions and update directly from the browser. Your data is never modified during an update. If anything goes wrong the app automatically rolls back to the working version.</p>
      </div>

      {/* Version card */}
      <div className="border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-0.5">Installed</p>
            <p className="text-2xl font-bold font-mono text-indigo-600">{versionInfo?.installed ?? APP_VERSION}</p>
          </div>
          <div>
            {checking && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-400">
                <div className="w-3.5 h-3.5 border-2 border-slate-300 border-t-slate-500 rounded-full animate-spin" />
                Checking…
              </div>
            )}
            {!checking && !versionError && versionInfo && !updateAvailable && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-sm font-medium text-emerald-700">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Up to date
              </div>
            )}
            {!checking && !versionError && versionInfo && updateAvailable && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-300 rounded-lg text-sm font-medium text-amber-700">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                Update available
              </div>
            )}
            {!checking && versionError && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-400">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728M5.636 5.636a9 9 0 000 12.728M12 12h.01" />
                </svg>
                Offline
              </div>
            )}
          </div>
        </div>

        {!checking && versionInfo && (
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Latest on GitHub: <span className="font-mono">{versionInfo.latest}</span></span>
            <button onClick={() => doVersionCheck(true)} className="text-indigo-500 hover:text-indigo-700 transition-colors">Check again</button>
          </div>
        )}
        {!checking && versionError && (
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Could not reach GitHub</span>
            <button onClick={() => doVersionCheck(true)} className="text-indigo-500 hover:text-indigo-700 transition-colors">Retry</button>
          </div>
        )}
      </div>

      {/* Update available banner + action */}
      {updateAvailable && updatePhase === 'idle' && (
        <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-amber-800">{versionInfo.latest} is available</p>
              <p className="text-xs text-amber-700 mt-0.5">Click Update to install it now. The app will restart automatically — this takes about 30–60 seconds.</p>
            </div>
            <a href={versionInfo.releaseUrl} target="_blank" rel="noopener noreferrer"
               className="text-xs text-amber-600 hover:text-amber-800 underline underline-offset-2 whitespace-nowrap flex-shrink-0">
              Release notes ↗
            </a>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={startUpdate}
              className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Update now
            </button>
            <span className="text-xs text-amber-600">Or run <code className="font-mono bg-amber-100 px-1 py-0.5 rounded">ip-manager-update</code> on the LXC</span>
          </div>
        </div>
      )}

      {/* Progress UI */}
      {(updatePhase === 'running' || updatePhase === 'restarting' || updatePhase === 'done' || updatePhase === 'failed' || updatePhase === 'rolledback') && (
        <div className="border border-slate-200 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">
              {updatePhase === 'running'     && 'Updating…'}
              {updatePhase === 'restarting'  && 'Restarting service…'}
              {updatePhase === 'done'        && '✓ Update complete'}
              {updatePhase === 'failed'      && '✗ Update failed — rolled back'}
              {updatePhase === 'rolledback'  && '⟳ Rolling back…'}
            </p>
            {(updatePhase === 'done' || updatePhase === 'failed') && (
              <button onClick={() => { setUpdatePhase('idle'); doVersionCheck(true); }}
                className="text-xs text-slate-400 hover:text-slate-600 transition-colors">Dismiss</button>
            )}
          </div>

          {/* Progress bar */}
          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
            {/* Indeterminate shimmer when running but no steps received yet */}
            {(updatePhase === 'running' || updatePhase === 'rolledback') && progressPct === 0 && steps.length === 0 ? (
              <div className="h-2 w-1/3 bg-indigo-400 rounded-full animate-pulse" style={{ animation: 'pulse 1.5s ease-in-out infinite' }} />
            ) : (
              <div
                className={`h-2 rounded-full transition-all duration-500 ${
                  updatePhase === 'done' ? 'bg-emerald-500 w-full' :
                  updatePhase === 'failed' ? 'bg-red-400' :
                  'bg-indigo-500'
                }`}
                style={{ width: updatePhase === 'restarting' ? '90%' : `${updatePhase === 'done' ? 100 : progressPct}%` }}
              />
            )}
          </div>

          {/* Step list */}
          {steps.length > 0 && (
            <div className="space-y-1">
              {steps.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  {s.status === 'done'   && <svg className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                  {s.status === 'active' && <div className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
                  <span className={s.status === 'done' ? 'text-slate-500' : s.status === 'active' ? 'text-slate-700 font-medium' : 'text-slate-400'}>
                    {s.label}
                  </span>
                </div>
              ))}
              {updatePhase === 'restarting' && (
                <div className="flex items-center gap-2 text-xs">
                  <div className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  <span className="text-slate-700 font-medium">Waiting for service to restart…</span>
                </div>
              )}
            </div>
          )}

          {/* Error message */}
          {(updatePhase === 'failed') && errorMsg && (
            <div className="space-y-2">
              <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 font-medium">
                {errorMsg} — the previous version has been restored automatically.
              </div>
              <button onClick={() => setShowLog(v => !v)}
                className="text-xs text-slate-400 hover:text-slate-600 underline transition-colors">
                {showLog ? 'Hide' : 'Show'} error log
              </button>
              {showLog && logs.length > 0 && (
                <pre className="bg-slate-900 text-slate-200 text-xs rounded-lg p-3 max-h-48 overflow-y-auto whitespace-pre-wrap">
                  {logs.join('\n')}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* Manual update note (always visible when idle) */}
      {updatePhase === 'idle' && (
        <div className="text-xs text-slate-400 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2.5">
          You can also update from the LXC at any time by running{' '}
          <code className="font-mono bg-slate-100 px-1 py-0.5 rounded text-slate-600">ip-manager-update</code>.
          Both methods are equivalent — in-browser updates use the same script.
        </div>
      )}

      {/* Release log */}
      {entries && entries.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Release Log</p>
          {entries.map((entry, idx) => (
            <div key={entry.version} className="border border-slate-200 rounded-xl overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                onClick={() => setExpanded(expanded === entry.version ? null : entry.version)}>
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`font-mono text-sm font-semibold flex-shrink-0 ${idx === 0 ? 'text-indigo-600' : 'text-slate-700'}`}>{entry.version}</span>
                  {idx === 0 && <span className="px-2 py-0.5 text-[10px] font-semibold bg-indigo-100 text-indigo-600 rounded-full uppercase tracking-wide flex-shrink-0">Installed</span>}
                  <span className="text-sm text-slate-500 truncate">{entry.title}</span>
                </div>
                <svg className={`w-4 h-4 text-slate-400 flex-shrink-0 ml-2 transition-transform ${expanded === entry.version ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {expanded === entry.version && (
                <div className="px-4 pb-4 pt-1 bg-slate-50 border-t border-slate-100">{renderBody(entry.body)}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Cloud Backup Section (lives inside Backup tab of SettingsModal) ───────────
function SupportTab({ ipData, networks }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const r = await fetch('/api/support/bundle');
      if (!r.ok) throw new Error(`Server returned ${r.status}`);
      const blob = await r.blob();
      const filename = r.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1]
        || `ip-manager-support-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.txt`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const assignedCount = (ipData || []).filter(e => e.assetName !== 'Free' && e.assetName !== 'Reserved').length;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-slate-800">Support Bundle</h3>
        <p className="text-sm text-slate-500 mt-0.5">
          Generate a diagnostic file to send to the developer when something isn't working.
        </p>
      </div>

      {/* What's included */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
        <p className="text-sm font-medium text-slate-700">What's included</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-slate-600">
          {[
            'App version & build info',
            'OS / kernel version',
            'Node.js & npm versions',
            'Disk & memory usage',
            'Service status (systemd)',
            'Last update result',
            'Recent service logs (300 lines)',
            `${networks?.length || 0} network(s), ${assignedCount} assigned entries (count only)`,
          ].map(item => (
            <div key={item} className="flex items-start gap-1.5">
              <span className="text-emerald-500 mt-0.5 flex-shrink-0">✓</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 pt-1 border-t border-slate-200">
          No IP addresses, hostnames, notes, credentials, or personal data are included in the bundle.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleGenerate}
        disabled={generating}
        className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
      >
        {generating
          ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Generating…</>
          : <>↓ Generate &amp; Download Support Bundle</>
        }
      </button>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
        <p className="text-sm font-medium text-slate-700">Prefer to collect logs manually?</p>
        <p className="text-xs text-slate-500">Run these commands on your server and share the output:</p>
        {[
          'cat /opt/ip-manager/server/.update-result.json',
          'sudo journalctl -u ip-manager-api -n 300 --no-pager',
          'sudo bash /opt/ip-manager/scripts/update.sh',
        ].map(cmd => (
          <pre key={cmd} className="text-xs font-mono bg-slate-800 text-slate-100 px-3 py-2 rounded-lg overflow-x-auto">{cmd}</pre>
        ))}
      </div>
    </div>
  );
}

function DnsTab({ networks, dnsConfig, dnsStatus, dnsLoading, onSave, onRun }) {
  const [localCfg, setLocalCfg] = React.useState(() => {
    const init = {};
    (networks || []).forEach(n => {
      const saved = (dnsConfig || {})[n.id] || {};
      init[n.id] = { server: saved.server || '', enabled: saved.enabled !== false };
    });
    return init;
  });
  const [saving, setSaving] = React.useState(null); // networkId being saved

  const handleSave = async (networkId) => {
    setSaving(networkId);
    const cfg = localCfg[networkId] || { server: '', enabled: true };
    await onSave({ networkId, server: cfg.server, enabled: cfg.enabled });
    setSaving(null);
  };

  const fmtTime = (iso) => {
    if (!iso) return 'Never';
    const d = new Date(iso);
    const diffMin = Math.floor((Date.now() - d) / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const h = Math.floor(diffMin / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-slate-800">DNS Reverse Lookup</h3>
        <p className="text-sm text-slate-500 mt-0.5">
          Configure a DNS server per network for PTR record lookups. Each network can point to its own resolver (e.g. a local Pi-hole or router).
        </p>
      </div>

      {(networks || []).map(network => {
        const cfg = localCfg[network.id] || { server: '', enabled: true };
        const saved = (dnsConfig || {})[network.id] || {};
        return (
          <div key={network.id} className="border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-800">{network.networkName}</p>
                <p className="text-xs text-slate-400 font-mono">{network.subnet}</p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-xs text-slate-500">Enabled</span>
                <div
                  onClick={() => setLocalCfg(prev => ({ ...prev, [network.id]: { ...cfg, enabled: !cfg.enabled } }))}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${cfg.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${cfg.enabled ? 'translate-x-4' : 'translate-x-1'}`} />
                </div>
              </label>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={cfg.server}
                onChange={e => setLocalCfg(prev => ({ ...prev, [network.id]: { ...cfg, server: e.target.value } }))}
                placeholder="e.g. 192.168.1.1 (leave blank for system default)"
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm font-mono"
              />
              <button
                type="button"
                onClick={() => handleSave(network.id)}
                disabled={saving === network.id}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {saving === network.id ? 'Saving…' : 'Save'}
              </button>
            </div>

            {saved.lastRun && (
              <p className="text-xs text-slate-400">Last run: {fmtTime(saved.lastRun)}</p>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={onRun}
        disabled={dnsLoading}
        className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
      >
        {dnsLoading
          ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Running…</>
          : '↻ Refresh DNS Now'
        }
      </button>

      {dnsStatus && Object.keys(dnsStatus).length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Cached PTR Records</p>
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-500">IP</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-500">PTR Record</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Object.entries(dnsStatus)
                  .filter(([, v]) => v?.ptr)
                  .map(([ip, v]) => (
                    <tr key={ip}>
                      <td className="px-3 py-2 font-mono text-slate-600">{ip}</td>
                      <td className="px-3 py-2 font-mono text-slate-500">{v.ptr}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsModal({ config, onSave, onClose, onClear, locations, onRenameLocation, onDeleteLocation, tags, onRenameTag, onDeleteTag, canDeleteNetwork, onDeleteNetwork, showFreeInList, onToggleShowFreeInList, ipData, networks, onRestore, dnsConfig, dnsStatus, dnsLoading, onSaveDnsConfig, onRunDns, proxmoxSyncConfig, proxmoxSyncStatus, proxmoxSyncLoading, onSaveProxmoxSyncConfig, onRunProxmoxSync, updateAvailable, initialTab, onOpenWatch }) {
  const modalRef = useModalA11y(typeof onClose === 'function' ? onClose : null);
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
  const [activeTab, setActiveTab] = useState(initialTab || 'network');

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
    if (pwForm.newPassword.length < 8) {
      return setPwError('New password must be at least 8 characters');
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
    { id: 'presence', label: 'ARP & Presence' },
    { id: 'api',      label: 'API Keys' },
    { id: 'security', label: 'Security' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'watch',    label: 'Network Watch' },
    { id: 'activity', label: 'Activity' },
    { id: 'account',  label: 'Account' },
    { id: 'updates',  label: 'Updates' },
    { id: 'support',  label: 'Support' },
  ];

  return (
    <div ref={modalRef} role="dialog" aria-modal="true" aria-label="Settings" tabIndex={-1}
         className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 outline-none" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Settings className="w-5 h-5 text-slate-500" />
              Settings
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">Configure your network and app preferences · <span className="font-mono">{APP_VERSION}</span></p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Body: sidebar + content */}
        <div className="flex flex-1 overflow-hidden">

          {/* Sidebar nav */}
          <div className="w-44 border-r border-slate-100 py-3 flex-shrink-0 bg-slate-50 overflow-y-auto rounded-bl-2xl flex flex-col">
            <div className="flex-1">
              {settingsTabs.map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between ${activeTab === tab.id ? 'bg-white text-slate-800 font-semibold shadow-sm border-r-2 border-emerald-500' : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'}`}
                >
                  {tab.label}
                  {tab.id === 'updates' && updateAvailable && (
                    <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-slate-200 flex-shrink-0">
              <p className="text-xs text-slate-400 font-mono">IP Manager {APP_VERSION}</p>
            </div>
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
              <DnsTab
                networks={networks}
                dnsConfig={dnsConfig}
                dnsStatus={dnsStatus}
                dnsLoading={dnsLoading}
                onSave={onSaveDnsConfig}
                onRun={onRunDns}
              />
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

                  {!proxmoxSyncStatus?.running && !proxmoxSyncStatus?.lastError && proxmoxSyncConfig?.lastRun && (proxmoxSyncStatus?.changesFound ?? 0) === 0 && (proxmoxSyncStatus?.changeLog ?? []).length === 0 && (
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

                {/* Cloud backup section (API mode only) */}
                <ModalSuspense><BackupCloudSection /></ModalSuspense>
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
                            <button type="button" onClick={() => setEditingLoc({ old: loc, draft: loc })} className="text-slate-400 hover:text-blue-500 text-xs ml-1" title="Rename" aria-label="Rename">✎</button>
                            <button type="button" onClick={() => onDeleteLocation(loc)} className="text-slate-400 hover:text-red-500 text-xs" title="Remove from all entries" aria-label="Remove from all entries">✕</button>
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
                            <button type="button" onClick={() => setEditingTag({ old: tag, draft: tag })} className="text-slate-400 hover:text-blue-500 text-xs ml-1" title="Rename tag" aria-label="Rename tag">✎</button>
                            <button type="button" onClick={() => onDeleteTag(tag)} className="text-slate-400 hover:text-red-500 text-xs" title="Remove tag from all entries" aria-label="Remove tag from all entries">✕</button>
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
                      className={inputCls} placeholder="New password (min 8 chars)" />
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

            {/* ── ARP & PRESENCE TAB ── */}
            {activeTab === 'presence' && (
              <ArpPresenceTab />
            )}

            {/* ── API KEYS TAB ── */}
            {activeTab === 'api' && (
              <ApiKeysTab />
            )}

            {/* ── SECURITY TAB ── */}
            {activeTab === 'security' && (
              <SecurityTab />
            )}

            {/* ── NOTIFICATIONS TAB ── */}
            {activeTab === 'notifications' && (
              <NotificationsTab />
            )}

            {/* ── NETWORK WATCH TAB ── */}
            {activeTab === 'watch' && (
              <NetworkWatchTab onOpen={onOpenWatch} />
            )}

            {/* ── ACTIVITY TAB ── */}
            {activeTab === 'activity' && (
              <ActivityTab />
            )}

            {/* ── UPDATES TAB ── */}
            {activeTab === 'updates' && (
              <>
                <UpdatesTab />
                <WhatsNewReset />
              </>
            )}

            {/* ── SUPPORT TAB ── */}
            {activeTab === 'support' && (
              <SupportTab ipData={ipData} networks={networks} />
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

function QRModal({ item, onClose }) {
  const modalRef = useModalA11y(typeof onClose === 'function' ? onClose : null);
  const [mode,   setMode]   = useState('smart'); // 'smart' | 'ip'
  const [qrSrc,  setQrSrc]  = useState('');
  const [copied, setCopied] = useState(false);

  const smartUrl = item.healthPort
    ? `${item.healthScheme || 'http'}://${item.ip}:${item.healthPort}${item.healthPath || '/'}`
    : `http://${item.ip}`;

  const content = mode === 'ip' ? item.ip : smartUrl;

  useEffect(() => {
    let cancelled = false;
    loadQRCode()
      .then(QRCode => QRCode.toDataURL(content, { width: 260, margin: 2, color: { dark: '#1e293b', light: '#ffffff' } }))
      .then(src => { if (!cancelled) setQrSrc(src); })
      .catch(() => { if (!cancelled) setQrSrc(''); });
    return () => { cancelled = true; };
  }, [content]);

  const download = () => {
    const a = document.createElement('a');
    a.href = qrSrc;
    a.download = `qr-${item.ip.replace(/\./g, '-')}.png`;
    a.click();
  };

  const copyContent = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div ref={modalRef} role="dialog" aria-modal="true" aria-label="QR code" tabIndex={-1}
         className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 outline-none" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800">QR Code</h2>
            <p className="text-xs text-slate-500 font-mono mt-0.5">{item.ip} · {item.assetName}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Mode toggle */}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
            <button
              onClick={() => setMode('smart')}
              className={`flex-1 py-2 text-center transition-colors text-xs font-medium ${mode === 'smart' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              {item.healthPort ? 'Service URL' : 'HTTP URL'}
            </button>
            <button
              onClick={() => setMode('ip')}
              className={`flex-1 py-2 text-center transition-colors text-xs font-medium border-l border-slate-200 ${mode === 'ip' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              IP Address
            </button>
          </div>

          {/* QR image */}
          <div className="flex justify-center bg-white rounded-xl border border-slate-100 p-4">
            {qrSrc
              ? <img src={qrSrc} alt="QR code" className="w-48 h-48" />
              : <div className="w-48 h-48 bg-slate-50 rounded-lg flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-slate-300 border-t-indigo-500 rounded-full animate-spin" />
                </div>
            }
          </div>

          {/* Encoded content */}
          <div className="bg-slate-50 rounded-lg px-3 py-2 flex items-center gap-2">
            <span className="font-mono text-xs text-slate-600 flex-1 truncate">{content}</span>
            <button onClick={copyContent} className="p-1 text-slate-400 hover:text-slate-600 flex-shrink-0 transition-colors">
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button onClick={download}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors">
              <Download className="w-4 h-4" />
              Download PNG
            </button>
            <button onClick={onClose}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium rounded-lg transition-colors">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ARP Scan Modal ────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Set once the server confirms the password but asks for a second factor.
  const [totpRequired, setTotpRequired] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  // Only show the first-run hint if the user hasn't successfully changed their
  // password yet. Set by ForceChangePasswordScreen on successful save.
  const showFirstRunHint = !localStorage.getItem('ip-manager-credentials-set');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The password is re-sent with the code so the server never holds a
        // half-authenticated state. No session exists until both factors pass.
        body: JSON.stringify(totpRequired ? { username, password, totpCode } : { username, password }),
      });
      const data = await res.json().catch(() => ({}));

      // Password was right, but a second factor is needed.
      if (res.ok && data.totpRequired) {
        setTotpRequired(true);
        setError('');
        setLoading(false);
        return;
      }

      if (res.ok && data.ok) {
        if (data.usedRecoveryCode) {
          // Worth saying out loud — they have one fewer way back in.
          alert(`Signed in with a recovery code. You have ${data.recoveryCodesRemaining} left.\n\n` +
                `Generate a fresh set in Settings → Security when convenient.`);
        }
        onLogin();
        return;
      }

      if (res.status === 429) {
        setError(data.message || 'Too many attempts. Please wait and try again.');
      } else if (totpRequired) {
        setError(data.message || 'That code was not correct.');
        setTotpCode('');
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
              disabled={totpRequired}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-400"
              placeholder="••••••••"
            />
          </div>

          {totpRequired && (
            <div>
              <label htmlFor="totp-code" className="block text-sm font-medium text-slate-700 mb-1">
                Authentication code
              </label>
              <input
                id="totp-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                value={totpCode}
                onChange={e => setTotpCode(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-center text-lg font-mono tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                placeholder="000000"
              />
              <p className="text-xs text-slate-400 mt-1.5">
                Enter the 6-digit code from your authenticator app, or one of your recovery codes.
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 px-3 py-2 rounded-lg">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password || (totpRequired && !totpCode)}
            className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold py-2.5 rounded-lg transition-colors"
          >
            {loading ? 'Signing in…' : totpRequired ? 'Verify' : 'Sign in'}
          </button>

          {totpRequired && (
            <button
              type="button"
              onClick={() => { setTotpRequired(false); setTotpCode(''); setError(''); }}
              className="w-full text-xs text-slate-400 hover:text-slate-600 transition-colors"
            >
              Start over
            </button>
          )}
        </form>

        {showFirstRunHint && (
          <div className="mt-6 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500 text-center">
            <span className="font-medium">First time?</span> Your initial password was printed in the installer output and saved to the service journal. Run <span className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200">journalctl -u ip-manager-api | grep -A5 "initial credentials"</span> to retrieve it.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Force-change-password screen ──────────────────────────────────────────────
// Shown when the server reports mustChangePassword (i.e. credentials are still
// the literal admin/admin default). Non-dismissible — user must set a new
// password before accessing the app.

function ForceChangePasswordScreen() {
  const [form, setForm] = useState({ newUsername: 'admin', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.newPassword !== form.confirmPassword) return setError('Passwords do not match');
    if (form.newPassword.length < 8) return setError('Password must be at least 8 characters');
    if (!form.newUsername.trim()) return setError('Username cannot be blank');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // currentPassword is known to be 'admin' — that's the only way to reach this screen
        body: JSON.stringify({ currentPassword: 'admin', newUsername: form.newUsername.trim(), newPassword: form.newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem('ip-manager-credentials-set', '1');
        setSuccess(true);
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setError(data.error || 'Failed to update credentials');
      }
    } catch {
      setError('Could not reach the server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-amber-100 rounded-2xl mb-4">
            <AlertTriangle className="w-7 h-7 text-amber-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-800">Set Your Password</h1>
          <p className="text-slate-500 text-sm mt-2">This install is using default credentials. Set a new password to access the app.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Username</label>
            <input
              type="text"
              autoComplete="username"
              value={form.newUsername}
              onChange={e => setForm(f => ({ ...f, newUsername: e.target.value }))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
            <input
              type="password"
              autoFocus
              autoComplete="new-password"
              value={form.newPassword}
              onChange={e => setForm(f => ({ ...f, newPassword: e.target.value }))}
              placeholder="At least 8 characters"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Confirm Password</label>
            <input
              type="password"
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))}
              placeholder="Repeat new password"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 px-3 py-2 rounded-lg">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 text-emerald-600 text-sm bg-emerald-50 px-3 py-2 rounded-lg">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />Password updated — reloading…
            </div>
          )}

          <button
            type="submit"
            disabled={loading || success}
            className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold py-2.5 rounded-lg transition-colors"
          >
            {loading ? 'Saving…' : 'Set Password & Continue'}
          </button>
        </form>
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

// ── Service health check auto-suggest ─────────────────────────────────────────
// Ordered: longer / more-specific phrases first to prevent prefix shadowing.
const PORT_SUGGEST = [
  ['home assistant',       { scheme: 'http',  port: 8123 }],
  ['proxmox',              { scheme: 'https', port: 8006 }],
  ['nginx proxy manager',  { scheme: 'http',  port: 81   }],
  ['portainer',            { scheme: 'https', port: 9443 }],
  ['vaultwarden',          { scheme: 'http',  port: 80   }],
  ['nextcloud',            { scheme: 'https', port: 443  }],
  ['gitea',                { scheme: 'http',  port: 3000 }],
  ['immich',               { scheme: 'http',  port: 2283 }],
  ['sonarr',               { scheme: 'http',  port: 8989 }],
  ['radarr',               { scheme: 'http',  port: 7878 }],
  ['lidarr',               { scheme: 'http',  port: 8686 }],
  ['readarr',              { scheme: 'http',  port: 8787 }],
  ['bazarr',               { scheme: 'http',  port: 6767 }],
  ['prowlarr',             { scheme: 'http',  port: 9696 }],
  ['overseerr',            { scheme: 'http',  port: 5055 }],
  ['jellyseerr',           { scheme: 'http',  port: 5055 }],
  ['jellyfin',             { scheme: 'http',  port: 8096 }],
  ['plex',                 { scheme: 'http',  port: 32400 }],
  ['emby',                 { scheme: 'http',  port: 8096 }],
  ['audiobookshelf',       { scheme: 'http',  port: 13378 }],
  ['kavita',               { scheme: 'http',  port: 5000 }],
  ['pi-hole',              { scheme: 'http',  port: 80   }],
  ['pihole',               { scheme: 'http',  port: 80   }],
  ['adguard',              { scheme: 'http',  port: 3000 }],
  ['unifi',                { scheme: 'https', port: 8443 }],
  ['grafana',              { scheme: 'http',  port: 3000 }],
  ['prometheus',           { scheme: 'http',  port: 9090 }],
  ['influxdb',             { scheme: 'http',  port: 8086 }],
  ['uptime kuma',          { scheme: 'http',  port: 3001 }],
  ['netdata',              { scheme: 'http',  port: 19999 }],
  ['myspeed',              { scheme: 'http',  port: 5216 }],
  ['speedtest',            { scheme: 'http',  port: 80   }],
  ['syncthing',            { scheme: 'http',  port: 8384 }],
  ['qbittorrent',          { scheme: 'http',  port: 8080 }],
  ['transmission',         { scheme: 'http',  port: 9091 }],
  ['deluge',               { scheme: 'http',  port: 8112 }],
  ['sabnzbd',              { scheme: 'http',  port: 8080 }],
  ['nzbget',               { scheme: 'http',  port: 6789 }],
  ['paperless',            { scheme: 'http',  port: 8000 }],
  ['wikijs',               { scheme: 'http',  port: 3000 }],
  ['bookstack',            { scheme: 'http',  port: 80   }],
  ['freshrss',             { scheme: 'http',  port: 80   }],
  ['miniflux',             { scheme: 'http',  port: 8080 }],
  ['bitwarden',            { scheme: 'http',  port: 80   }],
  ['gitlab',               { scheme: 'http',  port: 80   }],
  ['forgejo',              { scheme: 'http',  port: 3000 }],
  ['drone',                { scheme: 'http',  port: 80   }],
  ['woodpecker',           { scheme: 'http',  port: 8000 }],
  ['minio',                { scheme: 'http',  port: 9001 }],
  ['seafile',              { scheme: 'http',  port: 80   }],
  ['filebrowser',          { scheme: 'http',  port: 80   }],
  ['mealie',               { scheme: 'http',  port: 9000 }],
  ['tandoor',              { scheme: 'http',  port: 80   }],
  ['recipes',              { scheme: 'http',  port: 80   }],
  ['nginx',                { scheme: 'http',  port: 80   }],
  ['apache',               { scheme: 'http',  port: 80   }],
  ['traefik',              { scheme: 'http',  port: 8080 }],
  ['caddy',                { scheme: 'http',  port: 80   }],
  ['haproxy',              { scheme: 'http',  port: 80   }],
  ['opnsense',             { scheme: 'https', port: 443  }],
  ['pfsense',              { scheme: 'https', port: 443  }],
  ['truenas',              { scheme: 'http',  port: 80   }],
  ['cockpit',              { scheme: 'https', port: 9090 }],
  ['zabbix',               { scheme: 'http',  port: 80   }],
];

const getHealthSuggest = (apps) => {
  const hay = (apps || '').toLowerCase();
  for (const [keyword, suggestion] of PORT_SUGGEST) {
    if (hay.includes(keyword)) return suggestion;
  }
  return null;
};

// Tries selfh.st CDN icon first; in dark mode requests the -light variant
// (white SVG on dark bg), retrying with the standard coloured icon if missing.
// Falls back to the existing Lucide icon if the CDN has nothing for the slug.
const ServiceIcon = ({ apps, assetName, iconSlug, darkMode, imgClass, lucideClass }) => {
  const [failed, setFailed] = React.useState(false);
  const slug = iconSlug || getServiceSlug(apps, assetName);
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

// Formats an ISO timestamp as a short relative string (e.g. "3m ago", "2h ago", "never")
function formatLastSeen(iso) {
  if (!iso) return null;
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// Returns 'stale' if last seen > 25 hours ago, 'recent' otherwise
function lastSeenAge(iso) {
  if (!iso) return 'none';
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return h > 25 ? 'stale' : 'recent';
}

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

// ── App Logo ───────────────────────────────────────────────────────────────────────────────
function SubnetGridLogo({ size = 32 }) {
  const r = Math.round(size * 0.22);
  const cell = Math.round(size * 0.141);
  const gap  = Math.round(size * 0.031);
  const start = Math.round((size - 4 * cell - 3 * gap) / 2);
  const pos = (i) => start + i * (cell + gap);
  // Colours: slate=outside-range, emerald=assigned, light-emerald=free
  const colours = [
    '#334155','#334155','#334155','#334155',
    '#10b981','#10b981','#10b981','#10b981',
    '#10b981','#10b981','#10b981','#34d399',
    '#10b981','#34d399','#34d399','#334155',
  ];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" xmlns="http://www.w3.org/2000/svg" style={{flexShrink:0}}>
      <rect width={size} height={size} rx={r} fill="#0f172a"/>
      {colours.map((fill, i) => (
        <rect
          key={i}
          x={pos(i % 4)}
          y={pos(Math.floor(i / 4))}
          width={cell}
          height={cell}
          rx={Math.max(1, Math.round(cell * 0.22))}
          fill={fill}
          opacity={fill === '#34d399' ? (i === 11 ? 0.5 : i === 14 ? 0.3 : 0.8) : 1}
        />
      ))}
    </svg>
  );
}

// ── Subnet Visualiser Modal ────────────────────────────────────────────────────────────────
function BulkEditModal({ count, onApply, onClose, types, locations, allTags }) {
  const modalRef = useModalA11y(typeof onClose === 'function' ? onClose : null);
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
    <div ref={modalRef} role="dialog" aria-modal="true" aria-label="Bulk edit entries" tabIndex={-1}
         className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 outline-none" onClick={onClose}>
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
  const modalRef = useModalA11y(typeof onClose === 'function' ? onClose : null);
  const [formData, setFormData] = useState({
    ip: item.ip,
    assetName: item.assetName,
    hostname: item.hostname,
    type: item.type,
    location: item.location,
    apps: item.apps,
    notes: item.notes || '',
    tags: item.tags || [],
    healthScheme: item.healthScheme || 'http',
    healthPort:   item.healthPort   || '',
    healthPath:   item.healthPath   || '/',
    sshUser: item.sshUser || '',
    mac: item.mac || '',
    dependencies: item.dependencies || [],
    iconSlug: item.iconSlug || '',
  });
  const [tagInput, setTagInput] = useState('');
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [depInput, setDepInput] = useState('');
  const [showDepSuggestions, setShowDepSuggestions] = useState(false);
  const [macVendor, setMacVendor] = useState(item.macVendor || '');
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [iconSearch, setIconSearch] = useState('');
  const [iconList, setIconList]     = useState(null); // null=not loaded, 'loading', or [slug,…]

  // Fetch full icon list from selfh.st GitHub when picker is first opened
  useEffect(() => {
    if (!showIconPicker || iconList !== null) return;
    setIconList('loading');
    fetch('https://api.github.com/repos/selfhst/icons/git/trees/main?recursive=1')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => {
        const slugs = (data.tree || [])
          .filter(f => f.path && f.path.startsWith('svg/') && f.path.endsWith('.svg'))
          .map(f => f.path.replace('svg/', '').replace('.svg', ''))
          .sort();
        setIconList(slugs.length ? slugs : null);
      })
      .catch(() => setIconList(null)); // fall back to static map on error
  }, [showIconPicker]);

  // IP change
  const [showIpConflictConfirm, setShowIpConflictConfirm] = useState(false);

  // Host group linking state
  const [pendingLinks,   setPendingLinks]   = useState([]); // IPs to link as secondary on save
  const [pendingUnlinks, setPendingUnlinks] = useState([]); // IPs to unlink on save
  const [linkManualInput, setLinkManualInput] = useState(''); // manual IP entry in Additional IPs

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

  const addDep = (ip) => {
    if (!ip || (formData.dependencies || []).includes(ip)) return;
    setFormData(prev => ({ ...prev, dependencies: [...(prev.dependencies || []), ip] }));
    setDepInput('');
  };
  const removeDep = (ip) => setFormData(prev => ({ ...prev, dependencies: (prev.dependencies || []).filter(d => d !== ip) }));

  const handleSubmit = (e) => {
    e.preventDefault();
    // If IP changed and the new IP is already occupied, require explicit confirmation
    if (ipChanged && conflictEntry && !showIpConflictConfirm) {
      setShowIpConflictConfirm(true);
      return;
    }
    setShowIpConflictConfirm(false);
    // Resolve any pending new-location draft — blur may not have committed
    // yet if the user clicked Save directly from the text input.
    const finalLocation = formData.location === '__new__'
      ? newLocationDraft.trim()
      : formData.location;
    if (finalLocation && formData.location === '__new__') {
      onAddLocation?.(finalLocation);
    }
    onSave(
      { ...item, ...formData, ip: newIp || item.ip, location: finalLocation, macVendor },
      { link: pendingLinks, unlink: pendingUnlinks }
    );
  };

  const isFree = item.assetName === 'Free';
  const isReserved = item.assetName === 'Reserved';

  // IP change detection — only relevant for assigned (non-free, non-reserved) entries
  const newIp = (formData.ip || '').trim();
  const newIpValid = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(newIp);
  const ipChanged = !isFree && !isReserved && newIp !== item.ip && newIpValid;
  const conflictEntry = ipChanged
    ? (allNetworkEntries || []).find(e => e.ip === newIp && e.assetName !== 'Free')
    : null;

  return (
    <div ref={modalRef} role="dialog" aria-modal="true" aria-label="Edit entry" tabIndex={-1}
         className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 outline-none" onClick={onClose}>
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

          {/* IP Address — editable for assigned entries so users can reassign without losing history */}
          {!isFree && !isReserved && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">IP Address</label>
              <input
                type="text"
                value={formData.ip}
                onChange={e => { setFormData({ ...formData, ip: e.target.value }); setShowIpConflictConfirm(false); }}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:border-transparent font-mono text-sm ${
                  ipChanged && !newIpValid ? 'border-red-300 focus:ring-red-400'
                  : ipChanged ? 'border-amber-300 focus:ring-amber-400'
                  : 'border-slate-300 focus:ring-emerald-500'
                }`}
              />
              {ipChanged && newIpValid && !conflictEntry && (
                <p className="text-xs text-amber-600 mt-1">
                  ⚠ The old IP ({item.ip}) will be returned to the free pool and all history will move to {newIp}.
                </p>
              )}
              {ipChanged && !newIpValid && (
                <p className="text-xs text-red-500 mt-1">Enter a valid IPv4 address.</p>
              )}
              {/* Conflict confirmation banner */}
              {showIpConflictConfirm && conflictEntry && (
                <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2">
                  <p className="text-sm font-semibold text-amber-800">⚠ {newIp} is already in use</p>
                  <p className="text-xs text-amber-700">
                    This IP is currently assigned to <strong>{conflictEntry.assetName}</strong>. Proceeding will overwrite that entry and return <strong>{item.ip}</strong> to the free pool.
                  </p>
                  <div className="flex gap-2 pt-1">
                    <button type="submit"
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg transition-colors">
                      Proceed anyway
                    </button>
                    <button type="button" onClick={() => setShowIpConflictConfirm(false)}
                      className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

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

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">MAC Address</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={formData.mac}
                onChange={(e) => {
                  const v = e.target.value;
                  setFormData({ ...formData, mac: v });
                  setMacVendor('');
                }}
                onBlur={async () => {
                  const mac = formData.mac.trim();
                  const hex = mac.replace(/[^0-9a-fA-F]/g, '');
                  if (hex.length >= 6) {
                    try {
                      const r = await fetch(`/api/mac/vendor?mac=${encodeURIComponent(mac)}`);
                      const d = await r.json();
                      if (d.vendor) setMacVendor(d.vendor);
                    } catch {}
                  }
                }}
                placeholder="e.g., DC:A6:32:1A:2B:3C"
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent font-mono text-sm"
              />
              {macVendor && (
                <div className="flex items-center px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500 max-w-[160px] truncate" title={macVendor}>
                  {macVendor}
                </div>
              )}
            </div>
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

          {/* Icon picker */}
          {!isFree && !isReserved && (
            <div>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-6 h-6 flex-shrink-0">
                  <ServiceIcon
                    apps={formData.apps}
                    assetName={formData.assetName}
                    iconSlug={formData.iconSlug}
                    imgClass="w-6 h-6 object-contain"
                    lucideClass="w-5 h-5 text-slate-400"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setShowIconPicker(v => !v)}
                  className="text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                >
                  {showIconPicker ? 'Close picker' : formData.iconSlug ? 'Change icon' : 'Pick icon manually'}
                </button>
                {formData.iconSlug && (
                  <button
                    type="button"
                    onClick={() => { setFormData(prev => ({ ...prev, iconSlug: '' })); setShowIconPicker(false); }}
                    className="text-xs text-slate-400 hover:text-slate-600"
                  >
                    Reset to auto
                  </button>
                )}
              </div>

              {showIconPicker && (
                <div className="mt-2 border border-slate-200 rounded-xl p-3 space-y-2 bg-slate-50">
                  <input
                    type="text"
                    value={iconSearch}
                    onChange={e => setIconSearch(e.target.value)}
                    placeholder="Search icons… (e.g. pihole, nginx, docker)"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm bg-white"
                    autoFocus
                  />
                  {(() => {
                    const q = iconSearch.trim().toLowerCase();

                    // Loading state
                    if (iconList === 'loading') return (
                      <p className="text-xs text-slate-400 text-center py-3">Loading icon library…</p>
                    );

                    // Build hit list — prefer dynamic list, fall back to static map
                    let hits;
                    if (Array.isArray(iconList) && iconList.length) {
                      // Dynamic list: slugs only; show all that match query, capped at 96
                      const filtered = q
                        ? iconList.filter(slug => slug.includes(q))
                        : iconList;
                      hits = filtered.slice(0, 96).map(slug => [slug, slug]);
                    } else {
                      // Static fallback: [keyword, slug] pairs
                      hits = SH_SLUG_MAP.filter(([kw, slug]) =>
                        !q || kw.includes(q) || slug.includes(q)
                      );
                    }

                    if (!hits.length) return <p className="text-xs text-slate-400 text-center py-2">No icons found</p>;
                    const totalCount = Array.isArray(iconList) ? iconList.filter(s => !q || s.includes(q)).length : hits.length;
                    return (
                      <>
                        {totalCount > hits.length && (
                          <p className="text-[10px] text-slate-400 text-center">Showing {hits.length} of {totalCount} — type to narrow results</p>
                        )}
                        <div className="grid grid-cols-4 gap-1.5 max-h-64 overflow-y-auto">
                          {hits.map(([label, slug]) => (
                            <button
                              key={slug + label}
                              type="button"
                              onClick={() => { setFormData(prev => ({ ...prev, iconSlug: slug })); setShowIconPicker(false); setIconSearch(''); }}
                              className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-colors hover:bg-white hover:border-emerald-300 ${formData.iconSlug === slug ? 'bg-emerald-50 border-emerald-400' : 'border-transparent bg-white/60'}`}
                              title={slug}
                            >
                              <img
                                src={`https://cdn.jsdelivr.net/gh/selfhst/icons/svg/${slug}.svg`}
                                alt={label}
                                className="w-7 h-7 object-contain"
                                onError={e => { e.currentTarget.style.display = 'none'; }}
                              />
                              <span className="text-[10px] text-slate-500 truncate w-full text-center leading-tight">{label}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

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

          {/* Dependencies */}
          {!isFree && !isReserved && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Dependencies</label>
              <p className="text-xs text-slate-400 mb-2">Entries this device relies on. A warning badge appears on this card when any dependency goes offline.</p>
              {(formData.dependencies || []).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {(formData.dependencies || []).map(depIp => {
                    const depEntry = (allNetworkEntries || []).find(e => e.ip === depIp);
                    return (
                      <span key={depIp} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                        <span className="font-semibold">{depEntry?.assetName || depIp}</span>
                        <span className="text-amber-500 font-mono text-[10px]">{depIp}</span>
                        <button type="button" onClick={() => removeDep(depIp)} className="hover:text-amber-900 ml-0.5 leading-none">×</button>
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="relative">
                <input
                  type="text"
                  value={depInput}
                  onChange={e => { setDepInput(e.target.value); setShowDepSuggestions(true); }}
                  onFocus={() => setShowDepSuggestions(true)}
                  onKeyDown={e => { if (e.key === 'Escape') setShowDepSuggestions(false); }}
                  onBlur={() => setTimeout(() => setShowDepSuggestions(false), 150)}
                  placeholder="Search by IP or name to add a dependency…"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm"
                />
                {showDepSuggestions && (() => {
                  const suggestions = (allNetworkEntries || []).filter(e =>
                    e.ip !== item.ip &&
                    e.assetName !== 'Free' && e.assetName !== 'Reserved' &&
                    !(formData.dependencies || []).includes(e.ip) &&
                    (depInput === '' ||
                      e.ip.includes(depInput) ||
                      (e.assetName || '').toLowerCase().includes(depInput.toLowerCase()) ||
                      (e.hostname || '').toLowerCase().includes(depInput.toLowerCase()))
                  ).slice(0, 8);
                  return suggestions.length > 0 ? (
                    <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {suggestions.map(e => (
                        <button
                          key={e.ip}
                          type="button"
                          onMouseDown={ev => { ev.preventDefault(); addDep(e.ip); setShowDepSuggestions(false); }}
                          className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-amber-50 hover:text-amber-800 flex items-center gap-3"
                        >
                          <span className="font-mono text-xs text-slate-400 w-28 flex-shrink-0">{e.ip}</span>
                          <span className="truncate font-medium">{e.assetName || '—'}</span>
                          {e.hostname && <span className="truncate text-xs text-slate-400">{e.hostname}</span>}
                        </button>
                      ))}
                    </div>
                  ) : null;
                })()}
              </div>
            </div>
          )}

          {/* Proxmox info panel — read-only, shown only when dedicated fields are present */}
          {item.proxmoxVmid && (
            <div className="pt-2 border-t border-slate-200">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Proxmox</label>
              <div className="flex flex-wrap gap-3 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="flex items-center gap-1.5 text-xs text-slate-600">
                  <span className="text-slate-400 font-medium">VMID</span>
                  <span className="font-mono font-semibold text-slate-700">{item.proxmoxVmid}</span>
                </div>
                <div className="w-px bg-slate-200 self-stretch" />
                <div className="flex items-center gap-1.5 text-xs text-slate-600">
                  <span className="text-slate-400 font-medium">Node</span>
                  <span className="font-mono font-semibold text-slate-700">{item.proxmoxNode || '—'}</span>
                </div>
                <div className="w-px bg-slate-200 self-stretch" />
                <div className="flex items-center gap-1.5 text-xs text-slate-600">
                  <span className="text-slate-400 font-medium">Kind</span>
                  <span className="font-mono font-semibold text-slate-700 uppercase">{item.proxmoxKind || '—'}</span>
                </div>
              </div>
              <p className="text-xs text-slate-400 mt-1">Managed by Proxmox — these fields update automatically via sync.</p>
            </div>
          )}

          {/* Service Health Check — only shown for assigned, non-reserved entries */}
          {!isFree && !isReserved && (
            <div className="pt-2 border-t border-slate-200">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Service Health Check</label>
              <p className="text-xs text-slate-400 mb-2">
                Optional. When a port is set, the server probes this URL every 60 s and shows a coloured dot on the card.
              </p>
              <div className="flex items-center gap-2">
                {/* Scheme selector */}
                <select
                  value={formData.healthScheme}
                  onChange={(e) => setFormData({ ...formData, healthScheme: e.target.value })}
                  className="px-2 py-1.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm bg-white"
                >
                  <option value="http">http</option>
                  <option value="https">https</option>
                </select>
                {/* Port */}
                <input
                  type="number"
                  min="1"
                  max="65535"
                  value={formData.healthPort}
                  onChange={(e) => setFormData({ ...formData, healthPort: e.target.value })}
                  placeholder="Port"
                  className="w-24 px-2 py-1.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                />
                {/* Path */}
                <input
                  type="text"
                  value={formData.healthPath}
                  onChange={(e) => setFormData({ ...formData, healthPath: e.target.value })}
                  placeholder="/"
                  className="flex-1 px-2 py-1.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-mono"
                />
                {/* Auto-suggest button */}
                {(() => {
                  const suggest = getHealthSuggest(formData.apps);
                  if (!suggest) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, healthScheme: suggest.scheme, healthPort: String(suggest.port), healthPath: formData.healthPath || '/' })}
                      title={`Suggest: ${suggest.scheme}:${suggest.port}`}
                      className="px-2 py-1.5 text-xs bg-sky-50 border border-sky-200 text-sky-700 rounded-lg hover:bg-sky-100 whitespace-nowrap"
                    >
                      Auto
                    </button>
                  );
                })()}
                {/* Clear button */}
                {formData.healthPort && (
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, healthPort: '', healthPath: '/', healthScheme: 'http' })}
                    title="Disable health check"
                    className="px-2 py-1.5 text-xs bg-slate-50 border border-slate-200 text-slate-500 rounded-lg hover:bg-slate-100" aria-label="Disable health check">
                    Clear
                  </button>
                )}
              </div>
              {formData.healthPort && (
                <p className="text-xs text-slate-400 mt-1 font-mono">
                  → {formData.healthScheme}://{item.ip}:{formData.healthPort}{formData.healthPath || '/'}
                </p>
              )}
            </div>
          )}

          {/* SSH User — only shown for assigned, non-reserved entries */}
          {!isFree && !isReserved && (
            <div className="pt-2 border-t border-slate-200">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">SSH User</label>
              <p className="text-xs text-slate-400 mb-2">
                Optional. Sets the username for the SSH quick-launch button. Leave blank to use your OS default.
              </p>
              <input
                type="text"
                value={formData.sshUser}
                onChange={(e) => setFormData({ ...formData, sshUser: e.target.value })}
                placeholder="e.g. root, admin"
                className="w-48 px-2 py-1.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-mono"
              />
              {formData.sshUser && formData.hostname && (
                <p className="text-xs text-slate-400 mt-1 font-mono">
                  → ssh://{formData.sshUser}@{formData.hostname}
                </p>
              )}
            </div>
          )}

          {/* Host Group — only shown for assigned, non-reserved entries */}
          {!isFree && !isReserved && (
            <div className="pt-2 border-t border-slate-200">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Additional IPs</label>
              <p className="text-xs text-slate-400 mb-2">
                Link other IPs to this entry to indicate they belong to the same host (e.g. a management NIC, a second VLAN interface). Each linked IP is fully tracked and pinged independently.
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
                        title="Unlink this IP" aria-label="Unlink this IP">×</button>
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
                          title="Remove" aria-label="Remove">×</button>
                      </div>
                    );
                  })}

                  {/* Dropdown to add from tracked entries */}
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
                      <option value="">Select a tracked entry…</option>
                      {linkableEntries.map(e => (
                        <option key={e.ip} value={e.ip}>{e.ip} — {e.assetName}</option>
                      ))}
                    </select>
                  )}

                  {/* Manual IP entry */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={linkManualInput}
                      onChange={e => setLinkManualInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const ip = linkManualInput.trim();
                          if (ip && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip) && ip !== item.ip && !pendingLinks.includes(ip) && !existingSecondaries.find(s => s.ip === ip)) {
                            setPendingLinks(prev => [...prev, ip]);
                            setLinkManualInput('');
                          }
                        }
                      }}
                      placeholder="Or type an IP manually…"
                      className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const ip = linkManualInput.trim();
                        if (ip && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip) && ip !== item.ip && !pendingLinks.includes(ip) && !existingSecondaries.find(s => s.ip === ip)) {
                          setPendingLinks(prev => [...prev, ip]);
                          setLinkManualInput('');
                        }
                      }}
                      className="px-3 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      + Link
                    </button>
                  </div>
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

// ── Domains View Component ────────────────────────────────────────────────────
export default function IPAddressManager() {
  // Auth state: 'checking' while we verify the session, 'ok' when logged in, 'none' when not.
  const [auth, setAuth] = useState('checking');
  // True when the server reports credentials are still the default admin/admin.
  const [mustChangePassword, setMustChangePassword] = useState(false);

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
  const [topLevelVersionInfo, setTopLevelVersionInfo] = useState(null);

  const [ipData, setIpData] = useState([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showProxmoxImport, setShowProxmoxImport] = useState(false);
  const [showARPScan, setShowARPScan] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showCIDR, setShowCIDR] = useState(false);
  const [showSubnet, setShowSubnet] = useState(false);
  const [showTopology, setShowTopology] = useState(false);
  const [showMdns, setShowMdns] = useState(false);
  const [showWatch, setShowWatch] = useState(false);
  const [whatsNew, setWhatsNew] = useState(null);   // { releases } once the server says to show it
  // Network Watch is invisible until switched on: no nav button, no menu item.
  // The core of the app is the address list, and an opt-in feature should not
  // add furniture for people who never turn it on.
  const [watchEnabled, setWatchEnabled] = useState(false);
  // Unrecognised devices only — randomised phone MACs are deliberately excluded,
  // so the badge means "something worth a look" rather than "a phone reconnected".
  const [watchUnknown, setWatchUnknown] = useState(0);
  const [showDomains, setShowDomains] = useState(false);
  const [domains, setDomains] = useState([]);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [qrItem, setQrItem] = useState(null); // entry to show QR for
  const toolsMenuRef = useRef(null);

  // Ping / reachability — { [ip]: 'up' | 'down' }, null = not yet fetched
  const [pingStatus, setPingStatus] = useState({});
  const [pingLoading, setPingLoading] = useState(false);
  const [pingWarning, setPingWarning] = useState(null);
  const [pingLastAt, setPingLastAt] = useState(null); // Date
  // Last seen timestamps — { [ip]: isoString } — populated when lastSeenEnabled on server
  const [lastSeen, setLastSeen] = useState({});

  // Service health checks — { [ip]: { status: 'up'|'down', code: number|null } }
  const [healthStatus, setHealthStatus] = useState({});
  const [healthLoading, setHealthLoading] = useState(false);

  // Proxmox VM live status — { [ip]: { status: 'running'|'stopped'|'paused'|'unknown' } }
  const [proxmoxVmStatus, setProxmoxVmStatus] = useState({});

  // DNS reverse lookup — { [ip]: { ptr: string | null } }
  const [dnsStatus,  setDnsStatus]  = useState({});
  const [dnsLoading, setDnsLoading] = useState(false);
  const [dnsLastAt,  setDnsLastAt]  = useState(null); // Date
  const [dnsConfig, setDnsConfig] = useState({}); // keyed by networkId

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
  const [showNetworkPicker, setShowNetworkPicker] = useState(false);
  const networkPillRef = useRef(null);
  const searchRef = useRef(null);

  // Ask whether there is anything new to announce. Gated on being signed in and
  // past the forced password change: a release summary must never land on top
  // of the login screen or interrupt someone being told to set a password.
  useEffect(() => {
    if (persistMode !== 'api' || auth !== 'ok' || mustChangePassword) return;
    fetch('/api/whats-new')
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j && j.show && j.releases?.length) setWhatsNew(j); })
      .catch(() => {});
  }, [persistMode, auth, mustChangePassword]);

  // Whether Network Watch has been switched on. Re-checked when Settings
  // closes, so enabling it makes the view appear without a page reload.
  useEffect(() => {
    if (persistMode !== 'api' || auth !== 'ok') return;
    fetch('/api/watch/status')
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        setWatchEnabled(j?.enabled === true);
        setWatchUnknown(j?.enabled ? (j.summary?.unknown || 0) : 0);
      })
      .catch(() => { setWatchEnabled(false); setWatchUnknown(0); });
    // Re-checked when Settings or the view closes, so enabling it makes the icon
    // appear and a scan updates the badge without a page reload.
  }, [persistMode, auth, showSettings, showWatch]);

  // ── On mount: check auth status, then detect API and load data ───────────────
  useEffect(() => {
    (async () => {
      // Always check auth status first — if the server is up and we're not
      // logged in, show the login screen immediately.
      try {
        const statusRes = await fetch('/api/auth/status');
        if (statusRes.ok) {
          const { authenticated, mustChangePassword: mcp } = await statusRes.json();
          if (!authenticated) {
            setAuth('none');
            setPersistMode('local'); // fall back to localStorage while logged out
            return;
          }
          if (mcp) setMustChangePassword(true);
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
            skipNextSave.current = true; // freshly loaded from the server
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

  // Debounce handle for saves, and a one-shot guard that suppresses the save
  // which would otherwise fire immediately after loading state from the server.
  const saveTimer = useRef(null);
  const skipNextSave = useRef(false);

  // ── Refresh entries from the server ─────────────────────────────────────────
  // Used after a Proxmox sync, which can add or change entries behind our back.
  const loadData = useCallback(async () => {
    if (persistMode !== 'api') return;
    try {
      const json = await apiGet('/api/ips');
      if (json && Array.isArray(json.data)) {
        skipNextSave.current = true; // this is server state, don't echo it back
        setIpData(json.data.map(item => (item.networkId ? item : { ...item, networkId: 'net-1' })));
      }
    } catch {
      // Leave the current view in place if the refresh fails.
    }
  }, [persistMode]);

  // ── Auto-save IP data ───────────────────────────────────────────────────────
  // Debounced, so a burst of edits produces one write rather than one per
  // keystroke, and skipped immediately after loading server state — otherwise
  // the first render would push what we just received straight back, which is
  // how a concurrent Proxmox sync used to get overwritten.
  useEffect(() => {
    if (persistMode === 'loading') return;
    if (skipNextSave.current) { skipNextSave.current = false; return; }

    if (persistMode !== 'api') {
      try { localStorage.setItem('ip-manager-ip-data', JSON.stringify(ipData)); } catch {}
      return;
    }

    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      apiPut('/api/ips', ipData).catch(() => {});
    }, 600);

    return () => clearTimeout(saveTimer.current);
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
        if (showCIDR)          { setShowCIDR(false);          return; }
        if (showSubnet)        { setShowSubnet(false);        return; }
        if (showTopology)      { setShowTopology(false);      return; }
        if (showMdns)          { setShowMdns(false);          return; }
        if (showWatch)         { setShowWatch(false);         return; }
        if (whatsNew)          { setWhatsNew(null);           return; }
        if (showDomains)       { setShowDomains(false);       return; }
        if (qrItem)            { setQrItem(null);             return; }
        if (showToolsMenu)     { setShowToolsMenu(false);     return; }
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
  }, [editingItem, showSettings, showImport, showProxmoxImport, showARPScan, showHelp, showCIDR, showSubnet, showTopology, showMdns, showWatch, whatsNew, showDomains, qrItem, showToolsMenu, expandedCard, searchTerm]);

  // Close tools menu on outside click
  useEffect(() => {
    if (!showToolsMenu) return;
    const handler = (e) => { if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target)) setShowToolsMenu(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showToolsMenu]);

  useEffect(() => {
    if (!showNetworkPicker) return;
    const handler = (e) => { if (networkPillRef.current && !networkPillRef.current.contains(e.target)) setShowNetworkPicker(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showNetworkPicker]);

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
      if (data.lastSeen) setLastSeen(data.lastSeen);
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

  // ── Service health checks ────────────────────────────────────────────────────
  const fetchHealthStatus = async (force = false) => {
    if (persistMode !== 'api') return;
    setHealthLoading(true);
    try {
      const res = await fetch(`/api/service-health${force ? '?force=1' : ''}`);
      if (!res.ok) return;
      const data = await res.json();
      setHealthStatus(data.results || {});
    } catch { /* silently ignore network errors */ } finally {
      setHealthLoading(false);
    }
  };

  // Initial fetch + 60-second auto-poll
  useEffect(() => {
    if (persistMode !== 'api') return;
    fetchHealthStatus();
    const timer = setInterval(() => fetchHealthStatus(), 60_000);
    return () => clearInterval(timer);
  }, [persistMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Proxmox VM live status ───────────────────────────────────────────────────
  const fetchProxmoxVmStatus = async (force = false) => {
    if (persistMode !== 'api') return;
    try {
      const res = await fetch(`/api/proxmox-vm-status${force ? '?force=1' : ''}`);
      if (!res.ok) return;
      const data = await res.json();
      setProxmoxVmStatus(data.results || {});
    } catch { /* silently ignore — Proxmox may not be configured */ }
  };

  // Initial fetch + 60-second auto-poll
  useEffect(() => {
    if (persistMode !== 'api') return;
    fetchProxmoxVmStatus();
    const timer = setInterval(() => fetchProxmoxVmStatus(), 60_000);
    return () => clearInterval(timer);
  }, [persistMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Version check for toolbar badge — runs once on load, low priority
  useEffect(() => {
    if (persistMode !== 'api') return;
    fetch('/api/version-check', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (!d.error) setTopLevelVersionInfo(d); })
      .catch(() => {});
  }, [persistMode]);

  // ── DNS reverse lookup ───────────────────────────────────────────────────────
  const fetchDnsStatus = async (force = false) => {
    if (persistMode !== 'api') return;
    setDnsLoading(true);
    try {
      const res = await fetch(`/api/dns-status${force ? '?force=1' : ''}`);
      if (!res.ok) return;
      const data = await res.json();
      setDnsStatus(data.results || {});
      setDnsLastAt(data.cachedAt ? new Date(data.cachedAt * 1000) : null); // server returns Unix seconds
      if (data.configs) setDnsConfig(data.configs);
    } catch { /* silently ignore network errors */ } finally {
      setDnsLoading(false);
    }
  };

  const handleSaveDnsConfig = async ({ networkId, server, enabled }) => {
    try {
      await fetch('/api/dns-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ networkId, server, enabled }),
      });
      setDnsConfig(prev => ({
        ...prev,
        [networkId]: { ...(prev[networkId] || {}), server, enabled },
      }));
    } catch {}
  };

  // Load cached DNS results on mount (no auto-poll — runs every 24h server-side)
  useEffect(() => {
    if (persistMode !== 'api') return;
    fetchDnsStatus(false);
  }, [persistMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Domain Tracker ───────────────────────────────────────────────────────────

  const fetchDomains = async () => {
    if (persistMode !== 'api') return;
    try {
      const res = await apiGet('/api/domains');
      if (res && res.data) setDomains(res.data);
    } catch { /* silently ignore */ }
  };

  const getDaysUntilExpiry = (expiryDate) => {
    if (!expiryDate) return null;
    const expiry = new Date(expiryDate);
    const now = new Date();
    const days = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    return days;
  };

  const domainsExpiringWithin30Days = useMemo(() => {
    return domains.filter(d => {
      const days = getDaysUntilExpiry(d.expiry);
      return days !== null && days <= 30;
    }).length;
  }, [domains]);

  // Load domains on mount
  useEffect(() => {
    if (persistMode !== 'api') return;
    fetchDomains();
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

  // Load Proxmox sync config + last-run status on mount
  useEffect(() => {
    if (persistMode !== 'api') return;
    fetchProxmoxSyncConfig();
    fetchProxmoxSyncStatus(); // populates changesFound/changeLog so the log panel renders immediately
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

  // Apply names discovered over mDNS to entries that already exist.
  //
  // Two deliberate constraints. Only fields the server marked fillable are
  // written, so a name the user typed cannot be replaced by whatever a device
  // on the network claims to be called. And the change lands in local state
  // only — the user reviews it and presses Save, exactly as with any other
  // edit. Discovery never writes to the server on its own.
  const applyMdnsSuggestions = (updates) => {
    if (!Array.isArray(updates) || updates.length === 0) return;
    const byIp = new Map(updates.map(u => [u.ip, u]));
    setIpData(prev => prev.map(item => {
      const update = byIp.get(item.ip);
      if (!update) return item;
      const next = { ...item, updatedAt: new Date().toISOString() };
      if (update.assetName !== undefined) next.assetName = update.assetName;
      if (update.hostname !== undefined) next.hostname = update.hostname;
      return next;
    }));
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
    const originalIp = editingItem?.ip;
    const newIp = updatedItem.ip;
    const ipChanged = originalIp && newIp && originalIp !== newIp;
    const stamped = { ...updatedItem, updatedAt: now };
    setIpData(prev => {
      let data = [...prev];

      if (ipChanged) {
        // ── IP address reassignment ──────────────────────────────────────────
        const originalEntry = data.find(e => e.ip === originalIp);

        // Remove the old entry
        data = data.filter(e => e.ip !== originalIp);

        // Return old IP to the free pool (as a bare Free entry)
        data = [...data, { ip: originalIp, assetName: 'Free', networkId: originalEntry?.networkId || activeNetworkId }];

        // Remove whatever was at the new IP (Free or occupied — user confirmed)
        data = data.filter(e => e.ip !== newIp);

        // Carry history forward, adding an IP change record
        const ipChangeRecord = { ts: now, changes: [{ label: 'IP Address', old: originalIp, new: newIp }] };
        const history = [...(originalEntry?.history || []), ipChangeRecord].slice(-20);
        data = [...data, { ...stamped, history }];

        // Update any entries that had the old IP in their dependencies list
        data = data.map(e => {
          if (!(e.dependencies || []).includes(originalIp)) return e;
          return { ...e, dependencies: e.dependencies.map(d => d === originalIp ? newIp : d) };
        });

      } else {
        // ── Normal update (IP unchanged) ───────────────────────────────────
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

  const handleExportExcel = async () => {
    const XLSX = await loadXLSX();
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
  if (mustChangePassword) {
    // Default credentials detected — block access until the password is changed.
    return <ForceChangePasswordScreen />;
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
          onOpenWatch={() => { setShowSettings(false); setShowWatch(true); }}
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
          updateAvailable={topLevelVersionInfo?.updateAvailable}
          initialTab={topLevelVersionInfo?.updateAvailable ? 'updates' : undefined}
        />
      )}

      {/* Import Modal */}
      {showImport && (
        <ModalSuspense>
          <ImportModal
            networkConfig={networkConfig}
            onImport={handleImport}
            onClose={() => setShowImport(false)}
          />
        </ModalSuspense>
      )}

      {/* Proxmox Import Modal */}
      {showProxmoxImport && (
        <ModalSuspense>
          <ProxmoxImportModal
            onImport={handleImport}
            onClose={() => setShowProxmoxImport(false)}
          />
        </ModalSuspense>
      )}

      {/* ARP Scan Modal */}
      {showARPScan && (
        <ModalSuspense>
          <ARPScanModal
            subnet={networkConfig.subnet}
            networkConfig={networkConfig}
            onImport={handleImport}
            onClose={() => setShowARPScan(false)}
          />
        </ModalSuspense>
      )}

      {/* Help Modal */}
      {showHelp && <ModalSuspense><HelpModal onClose={() => setShowHelp(false)} /></ModalSuspense>}

      {/* CIDR Calculator */}
      {showCIDR && <ModalSuspense><CIDRCalculatorModal onClose={() => setShowCIDR(false)} /></ModalSuspense>}

      {/* Subnet Visualiser */}
      {showSubnet && <ModalSuspense><SubnetVisuiserModal network={networkConfig} ipData={networkIpData} onClose={() => setShowSubnet(false)} /></ModalSuspense>}
      {showTopology && <TopologyModal onClose={() => setShowTopology(false)} />}
      {showMdns && <MdnsModal onClose={() => setShowMdns(false)} onApply={applyMdnsSuggestions} />}
      {showWatch && (
        <NetworkWatchView
          onClose={() => setShowWatch(false)}
          localEntries={ipData}
          onAdd={(device) => {
            // Merge onto whatever is already at that address — usually a Free
            // placeholder — so adding never wipes fields that are already set.
            const existing = ipData.find(e => e.ip === device.currentIp);
            const isPlaceholder = !existing || existing.assetName === 'Free' || existing.assetName === 'Reserved';
            setEditingItem({
              ip: device.currentIp,
              networkId: existing?.networkId || activeNetworkId,
              assetName: (!isPlaceholder && existing?.assetName)
                || device.inventoryName || device.name || device.dhcpName || device.hostname || '',
              hostname: existing?.hostname || device.hostname || device.dhcpName || '',
              mac: existing?.mac || device.mac || '',
              // A hypervisor MAC prefix is a reliable signal; anything else is
              // a guess, so it defaults to Physical for the user to correct.
              type: existing?.type || (device.platform ? 'Virtual' : 'Physical'),
              location: existing?.location || '',
              apps: existing?.apps || '',
              notes: existing?.notes || '',
              tags: existing?.tags || [],
            });
          }}
        />
      )}
      {whatsNew && (
        <ModalSuspense>
          <WhatsNewModal
            releases={whatsNew.releases}
            onClose={(suppress) => {
              setWhatsNew(null);
              // Recorded server-side so it is remembered across browsers, and
              // so "don't show again" survives clearing site data.
              fetch('/api/whats-new/seen', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ suppress: suppress === true }),
              }).catch(() => {});
            }}
          />
        </ModalSuspense>
      )}

      {/* Domains View */}
      {showDomains && <ModalSuspense><DomainsView onClose={() => setShowDomains(false)} /></ModalSuspense>}

      {/* QR Code Modal */}
      {qrItem && <QRModal item={qrItem} onClose={() => setQrItem(null)} />}

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
          allNetworkEntries={ipData}
        />
      )}

      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">

        {/* ── Zone row: left identity / right actions ── */}
        <div className="border-b border-slate-100">
          <div className="max-w-7xl mx-auto px-3 sm:px-4">
            <div className="flex items-center h-14 gap-2 sm:gap-3">

              {/* LEFT ZONE */}
              <div className="flex items-center gap-2.5 flex-shrink-0">
                <SubnetGridLogo size={32} />
                <span className="text-[15px] font-bold text-slate-800 hidden sm:block leading-none">IP Address Manager</span>
                <span className="text-[14px] font-bold text-slate-800 block sm:hidden leading-none">IP Manager</span>
              </div>

              <div className="w-px h-5 bg-slate-200 flex-shrink-0 hidden sm:block" />

              {/* Network pill — dropdown when multiple networks, label when single */}
              {networks.length > 1 ? (
                <div className="relative flex-shrink-0" ref={networkPillRef}>
                  <button
                    onClick={() => setShowNetworkPicker(v => !v)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                  >
                    <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                    <span className="max-w-[140px] truncate">{networkConfig.networkName}</span>
                    <ChevronDown className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${showNetworkPicker ? 'rotate-180' : ''}`} />
                  </button>
                  {showNetworkPicker && (
                    <div className="absolute top-full left-0 mt-1.5 w-60 bg-white border border-slate-200 rounded-xl shadow-xl z-30 overflow-hidden py-1">
                      {networks.map(net => (
                        <button
                          key={net.id}
                          onClick={() => { setActiveNetworkId(net.id); clearFilters(); setShowNetworkPicker(false); }}
                          className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors ${
                            net.id === activeNetworkId ? 'bg-slate-800 text-white' : 'text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${net.id === activeNetworkId ? 'bg-emerald-400' : 'bg-emerald-500'}`} />
                          <span className="flex-1 truncate">{net.networkName}</span>
                          <span className={`text-xs font-mono flex-shrink-0 ${net.id === activeNetworkId ? 'text-slate-400' : 'text-slate-400'}`}>{subnetCIDR(net.subnet)}</span>
                        </button>
                      ))}
                      <div className="h-px bg-slate-100 mx-2 my-1" />
                      <button
                        onClick={() => { handleAddNetwork(); setShowNetworkPicker(false); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-50 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5 flex-shrink-0" />
                        Add network
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                  <span className="text-sm font-medium text-slate-500 max-w-[160px] truncate">{networkConfig.networkName}</span>
                </div>
              )}

              {/* Add network — shown only in single-network mode, ghosted */}
              {networks.length === 1 && (
                <button
                  onClick={handleAddNetwork}
                  title="Add another network (e.g. a VLAN or IoT segment)"
                  className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 border border-dashed border-slate-200 hover:border-slate-300 transition-colors" aria-label="Add another network (e.g. a VLAN or IoT segment)">
                  <Plus className="w-3.5 h-3.5 flex-shrink-0" />
                  Add network
                </button>
              )}

              <div className="flex-1" />

              {/* RIGHT ZONE — Desktop */}
              <div className="hidden md:flex items-center gap-1.5">

                {/* Import / Export */}
                <button
                  onClick={() => setShowImport(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <Upload className="w-3.5 h-3.5 flex-shrink-0" />
                  Import
                </button>
                <button
                  onClick={handleExportExcel}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <Download className="w-3.5 h-3.5 flex-shrink-0" />
                  Export
                </button>

                <div className="w-px h-5 bg-slate-200 mx-0.5" />

                {/* Unified Tools dropdown — absorbs network ops + utilities */}
                <div className="relative" ref={toolsMenuRef}>
                  <button
                    onClick={() => setShowToolsMenu(v => !v)}
                    className="relative flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium rounded-lg transition-colors"
                    title={watchUnknown > 0
                      ? `Network operations and utility tools · ${watchUnknown} unrecognised device${watchUnknown === 1 ? '' : 's'} on the network`
                      : 'Network operations and utility tools'}
                    aria-label={watchUnknown > 0
                      ? `Network operations and utility tools, ${watchUnknown} unrecognised device${watchUnknown === 1 ? '' : 's'} on the network`
                      : 'Network operations and utility tools'}>
                    {/* Network Watch lives inside this menu, so its count has to
                        show on the closed button or it is invisible until opened. */}
                    {watchUnknown > 0 && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-400 rounded-full border-2 border-white" />}
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
                    </svg>
                    Tools
                    <ChevronDown className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${showToolsMenu ? 'rotate-180' : ''}`} />
                  </button>

                  {showToolsMenu && (
                    <div className="absolute top-full right-0 mt-1.5 w-64 bg-white border border-slate-200 rounded-xl shadow-xl z-30 overflow-hidden">
                      {persistMode === 'api' && (
                        <>
                          <div className="px-3 pt-3 pb-1">
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Network</p>
                          </div>
                          <button onClick={() => { setShowProxmoxImport(true); setShowToolsMenu(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left">
                            <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0">
                              <svg className="w-4 h-4 text-purple-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M7 8h.01M12 8h.01M17 8h.01"/></svg>
                            </div>
                            <div><p className="text-sm font-medium text-slate-700">Proxmox</p><p className="text-xs text-slate-400">Import &amp; sync VMs / LXCs</p></div>
                          </button>
                          <button onClick={() => { setShowARPScan(true); setShowToolsMenu(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left">
                            <div className="w-8 h-8 rounded-lg bg-teal-100 flex items-center justify-center flex-shrink-0">
                              <Wifi className="w-4 h-4 text-teal-600" />
                            </div>
                            <div><p className="text-sm font-medium text-slate-700">ARP Scan</p><p className="text-xs text-slate-400">Discover active devices on subnet</p></div>
                          </button>
                          <button onClick={() => { fetchPingStatus(true); setShowToolsMenu(false); }} disabled={pingLoading} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left disabled:opacity-60">
                            <div className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center flex-shrink-0">
                              {pingLoading ? <div className="w-4 h-4 border-2 border-sky-300 border-t-sky-600 rounded-full animate-spin" /> : <Zap className="w-4 h-4 text-sky-600" />}
                            </div>
                            <div><p className="text-sm font-medium text-slate-700">Ping All</p><p className="text-xs text-slate-400">{pingLastAt ? `Last: ${pingLastAt.toLocaleTimeString()}` : 'Check reachability of all IPs'}</p></div>
                          </button>
                          <button onClick={() => { fetchDnsStatus(true); setShowToolsMenu(false); }} disabled={dnsLoading} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left disabled:opacity-60">
                            <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                              {dnsLoading ? <div className="w-4 h-4 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin" /> : <Globe className="w-4 h-4 text-violet-600" />}
                            </div>
                            <div><p className="text-sm font-medium text-slate-700">DNS Lookup</p><p className="text-xs text-slate-400">{dnsLastAt ? `Last: ${dnsLastAt.toLocaleString()}` : 'Reverse PTR lookup for all IPs'}</p></div>
                          </button>
                          <div className="h-px bg-slate-100 mx-3 my-1" />
                        </>
                      )}
                      <div className="px-3 pt-2 pb-1">
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Utilities</p>
                      </div>
                      <button onClick={() => { setShowCIDR(true); setShowToolsMenu(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left">
                        <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" /></svg>
                        </div>
                        <div><p className="text-sm font-medium text-slate-700">CIDR Calculator</p><p className="text-xs text-slate-400">Subnet maths — range, mask, host count</p></div>
                      </button>
                      <button onClick={() => { setShowSubnet(true); setShowToolsMenu(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left">
                        <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-emerald-600"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>
                        </div>
                        <div><p className="text-sm font-medium text-slate-700">Subnet Visualiser</p><p className="text-xs text-slate-400">Heat-map grid + planned blocks</p></div>
                      </button>
                      <button onClick={() => { setShowTopology(true); setShowToolsMenu(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left">
                        <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
                          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-indigo-600"><circle cx="3" cy="3" r="2"/><circle cx="13" cy="3" r="2"/><circle cx="8" cy="13" r="2"/><path d="M4.5 4.5 L7 11M11.5 4.5 L9 11M5 3h6"/></svg>
                        </div>
                        <div><p className="text-sm font-medium text-slate-700">Topology</p><p className="text-xs text-slate-400">Device relationships and impact</p></div>
                      </button>
                      {persistMode === 'api' && (
                        <button onClick={() => { setShowMdns(true); setShowToolsMenu(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left">
                          <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-violet-600"><path d="M8 13.5h.01"/><path d="M5.5 11a3.5 3.5 0 0 1 5 0"/><path d="M3 8.5a7 7 0 0 1 10 0"/><path d="M1 6a10.5 10.5 0 0 1 14 0"/></svg>
                          </div>
                          <div><p className="text-sm font-medium text-slate-700">mDNS Discovery</p><p className="text-xs text-slate-400">Find friendly names on the network</p></div>
                        </button>
                      )}
                      {watchEnabled && (
                        <button onClick={() => { setShowWatch(true); setShowToolsMenu(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left">
                          <div className="relative w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-violet-600"><circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4"/></svg>
                            {watchUnknown > 0 && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-400 rounded-full" />}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-700">Network Watch</p>
                            <p className="text-xs text-slate-400">
                              {watchUnknown > 0
                                ? `${watchUnknown} unrecognised device${watchUnknown === 1 ? '' : 's'}`
                                : 'Devices seen on the network'}
                            </p>
                          </div>
                        </button>
                      )}
                      {persistMode === 'api' && <>
                        <div className="h-px bg-slate-100 mx-3 my-1" />
                        <button onClick={() => { setShowDomains(true); setShowToolsMenu(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left">
                          <div className="relative w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center flex-shrink-0">
                            <Globe className="w-4 h-4 text-sky-600" />
                            {domainsExpiringWithin30Days > 0 && <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-red-400 rounded-full" />}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-700">Domains {domainsExpiringWithin30Days > 0 && <span className="ml-1 text-xs text-red-500 font-semibold">{domainsExpiringWithin30Days} expiring</span>}</p>
                            <p className="text-xs text-slate-400">Track domain registrations &amp; expiry</p>
                          </div>
                        </button>
                      </>}
                      <div className="pb-1.5" />
                    </div>
                  )}
                </div>

                <div className="w-px h-5 bg-slate-200 mx-0.5" />

                {/* Icon buttons */}
                <button onClick={() => setDarkMode(d => !d)} className="p-1.5 hover:bg-slate-100 text-slate-500 rounded-lg transition-colors" title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}>
                  {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </button>
                <button onClick={() => setShowHelp(true)} className="p-1.5 hover:bg-slate-100 text-slate-500 rounded-lg transition-colors" title="Help & Reference" aria-label="Help & Reference">
                  <HelpCircle className="w-4 h-4" />
                </button>
                <button onClick={() => setShowSettings(true)} className="relative p-1.5 hover:bg-slate-100 text-slate-600 rounded-lg transition-colors" title={topLevelVersionInfo?.updateAvailable ? `Update available · ${topLevelVersionInfo.latest}` : 'Settings'}>
                  <Settings className="w-4 h-4" />
                  {topLevelVersionInfo?.updateAvailable && <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-amber-400 rounded-full" />}
                </button>
                {persistMode === 'api' && (
                  <button onClick={handleLogout} className="p-1.5 hover:bg-red-50 hover:text-red-500 text-slate-500 rounded-lg transition-colors" title="Sign out" aria-label="Sign out">
                    <LogOut className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* RIGHT ZONE — Mobile: Tools button only */}
              <div className="flex md:hidden items-center gap-1.5">
                <button
                  onClick={() => setShowMobileTools(t => !t)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                    showMobileTools ? 'bg-slate-800 text-white border-slate-800' : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                  }`}
                >
                  <MoreHorizontal className="w-4 h-4" />
                  Tools
                  <ChevronDown className={`w-3 h-3 transition-transform ${showMobileTools ? 'rotate-180' : ''}`} />
                </button>
              </div>

            </div>
          </div>
        </div>

        {/* ── Sub-bar: status chip + subnet + view toggle ── */}
        <div className="bg-slate-50 border-b border-slate-100">
          <div className="max-w-7xl mx-auto px-3 sm:px-4">
            <div className="flex items-center h-9 gap-2">
              {persistMode === 'api' && (
                <div className="flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-md text-xs font-medium border border-emerald-200 whitespace-nowrap" title="Data stored in SQLite on the server — shared across all users">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                  SQLite
                </div>
              )}
              {persistMode === 'local' && (
                <div className="flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-500 rounded-md text-xs font-medium border border-slate-200 whitespace-nowrap" title="Data stored in this browser only — no API server detected">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-400 flex-shrink-0" />
                  Local
                </div>
              )}
              {hasChanges && persistMode !== 'api' && (
                <div className="flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 rounded-md text-xs font-medium border border-amber-200 whitespace-nowrap">
                  <AlertCircle className="w-3 h-3 flex-shrink-0" />
                  Unsaved
                </div>
              )}
              <span className="text-slate-300 text-xs select-none">·</span>
              <span className="text-xs text-slate-400 font-mono">{subnetCIDR(networkConfig.subnet)}</span>
              <div className="flex-1" />
              {/* View toggle */}
              <div className="flex items-center bg-white border border-slate-200 rounded-lg p-0.5">
                <button
                  onClick={() => setViewMode('cards')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    viewMode === 'cards' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >Cards</button>
                <button
                  onClick={() => setViewMode('table')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    viewMode === 'table' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >Table</button>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-3 sm:px-4 pt-3 pb-4">

          {/* ── Mobile tools panel ── */}
          {showMobileTools && (
            <div className="md:hidden mb-3 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">

              {/* Import / Export row */}
              <div className="px-3 pt-3 pb-2.5 border-b border-slate-100 flex gap-2">
                <button
                  onClick={() => { setShowImport(true); setShowMobileTools(false); }}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <Upload className="w-4 h-4 flex-shrink-0" />
                  Import
                </button>
                <button
                  onClick={() => { handleExportExcel(); setShowMobileTools(false); }}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <Download className="w-4 h-4 flex-shrink-0" />
                  Export
                </button>
              </div>

              {/* Network section (API mode only) */}
              {persistMode === 'api' && (
                <>
                  <div className="px-3 pt-3 pb-1">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Network</p>
                  </div>
                  <button onClick={() => { setShowProxmoxImport(true); setShowMobileTools(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left">
                    <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 text-purple-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M7 8h.01M12 8h.01M17 8h.01"/></svg>
                    </div>
                    <div><p className="text-sm font-medium text-slate-700">Proxmox</p><p className="text-xs text-slate-400">Import &amp; sync VMs / LXCs</p></div>
                  </button>
                  <button onClick={() => { setShowARPScan(true); setShowMobileTools(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left">
                    <div className="w-8 h-8 rounded-lg bg-teal-100 flex items-center justify-center flex-shrink-0">
                      <Wifi className="w-4 h-4 text-teal-600" />
                    </div>
                    <div><p className="text-sm font-medium text-slate-700">ARP Scan</p><p className="text-xs text-slate-400">Discover active devices on subnet</p></div>
                  </button>
                  <button onClick={() => { fetchPingStatus(true); setShowMobileTools(false); }} disabled={pingLoading} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left disabled:opacity-60">
                    <div className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center flex-shrink-0">
                      {pingLoading ? <div className="w-4 h-4 border-2 border-sky-300 border-t-sky-600 rounded-full animate-spin" /> : <Zap className="w-4 h-4 text-sky-600" />}
                    </div>
                    <div><p className="text-sm font-medium text-slate-700">Ping All</p><p className="text-xs text-slate-400">{pingLastAt ? `Last: ${pingLastAt.toLocaleTimeString()}` : 'Check reachability of all IPs'}</p></div>
                  </button>
                  <button onClick={() => { fetchDnsStatus(true); setShowMobileTools(false); }} disabled={dnsLoading} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left disabled:opacity-60">
                    <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                      {dnsLoading ? <div className="w-4 h-4 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin" /> : <Globe className="w-4 h-4 text-violet-600" />}
                    </div>
                    <div><p className="text-sm font-medium text-slate-700">DNS Lookup</p><p className="text-xs text-slate-400">{dnsLastAt ? `Last: ${dnsLastAt.toLocaleString()}` : 'Reverse PTR lookup for all IPs'}</p></div>
                  </button>
                  <div className="h-px bg-slate-100 mx-3 my-1" />
                </>
              )}

              {/* Utilities section */}
              <div className="px-3 pt-2 pb-1">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Utilities</p>
              </div>
              <button onClick={() => { setShowCIDR(true); setShowMobileTools(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left">
                <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" /></svg>
                </div>
                <div><p className="text-sm font-medium text-slate-700">CIDR Calculator</p><p className="text-xs text-slate-400">Subnet maths — range, mask, host count</p></div>
              </button>
              <button onClick={() => { setShowSubnet(true); setShowMobileTools(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-emerald-600"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>
                </div>
                <div><p className="text-sm font-medium text-slate-700">Subnet Visualiser</p><p className="text-xs text-slate-400">Heat-map grid + planned blocks</p></div>
              </button>
              <button onClick={() => { setShowTopology(true); setShowMobileTools(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left">
                <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-indigo-600"><circle cx="3" cy="3" r="2"/><circle cx="13" cy="3" r="2"/><circle cx="8" cy="13" r="2"/><path d="M4.5 4.5 L7 11M11.5 4.5 L9 11M5 3h6"/></svg>
                </div>
                <div><p className="text-sm font-medium text-slate-700">Topology</p><p className="text-xs text-slate-400">Device relationships</p></div>
              </button>
              {persistMode === 'api' && (
                <button onClick={() => { setShowMdns(true); setShowMobileTools(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left">
                  <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-violet-600"><path d="M8 13.5h.01"/><path d="M5.5 11a3.5 3.5 0 0 1 5 0"/><path d="M3 8.5a7 7 0 0 1 10 0"/><path d="M1 6a10.5 10.5 0 0 1 14 0"/></svg>
                  </div>
                  <div><p className="text-sm font-medium text-slate-700">mDNS Discovery</p><p className="text-xs text-slate-400">Find friendly names</p></div>
                </button>
              )}
              {watchEnabled && (
                <button onClick={() => { setShowWatch(true); setShowMobileTools(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left">
                  <div className="relative w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-violet-600"><circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4"/></svg>
                    {watchUnknown > 0 && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-400 rounded-full" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-700">Network Watch</p>
                    <p className="text-xs text-slate-400">
                      {watchUnknown > 0 ? `${watchUnknown} unrecognised` : 'Devices seen on the network'}
                    </p>
                  </div>
                </button>
              )}

              {/* App section */}
              <div className="h-px bg-slate-100 mx-3 my-1" />
              <div className="px-3 pt-2 pb-1">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">App</p>
              </div>
              <button onClick={() => { setDarkMode(d => !d); setShowMobileTools(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left">
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                  {darkMode ? <Sun className="w-4 h-4 text-slate-600" /> : <Moon className="w-4 h-4 text-slate-600" />}
                </div>
                <div><p className="text-sm font-medium text-slate-700">{darkMode ? 'Light mode' : 'Dark mode'}</p><p className="text-xs text-slate-400">Toggle display theme</p></div>
              </button>
              {persistMode === 'api' && (
                <button onClick={() => { setShowDomains(true); setShowMobileTools(false); }} className="relative w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left">
                  <div className="relative w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <Globe className="w-4 h-4 text-slate-600" />
                    {domainsExpiringWithin30Days > 0 && (
                      <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-red-400 rounded-full" />
                    )}
                  </div>
                  <div><p className="text-sm font-medium text-slate-700">Domains</p><p className="text-xs text-slate-400">Track domain expirations</p></div>
                </button>
              )}
              <button onClick={() => { setShowHelp(true); setShowMobileTools(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left">
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                  <HelpCircle className="w-4 h-4 text-slate-600" />
                </div>
                <div><p className="text-sm font-medium text-slate-700">Help</p><p className="text-xs text-slate-400">Reference guide and keyboard shortcuts</p></div>
              </button>
              <button onClick={() => { setShowSettings(true); setShowMobileTools(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left">
                <div className="relative w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                  <Settings className="w-4 h-4 text-slate-600" />
                  {topLevelVersionInfo?.updateAvailable && <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-amber-400 rounded-full" />}
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700">Settings</p>
                  <p className="text-xs text-slate-400">{topLevelVersionInfo?.updateAvailable ? `Update available · ${topLevelVersionInfo.latest}` : 'Network config, preferences, updates'}</p>
                </div>
              </button>
              {persistMode === 'api' && (
                <button onClick={handleLogout} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-red-50 transition-colors text-left">
                  <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
                    <LogOut className="w-4 h-4 text-red-500" />
                  </div>
                  <div><p className="text-sm font-medium text-red-600">Sign out</p><p className="text-xs text-slate-400">End your session</p></div>
                </button>
              )}
              <div className="pb-1.5" />
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
              const isExpanded = expandedCard === item.ip;
              const isReserved = item.assetName === 'Reserved';
              const isFree = item.assetName === 'Free';
              const isDHCP = isInDHCPRangeConfig(item.ip);
              const isFixed = isFixedInDHCPConfig(item.ip);

              const isSelected = selectedIPs.has(item.ip);
              return (
                <div
                  key={item.ip}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  aria-label={`${item.assetName || item.hostname || item.ip} — ${item.ip}${isSelected ? ', selected' : ''}`}
                  onClick={() => selectedIPs.size > 0 ? toggleSelect(item.ip, { stopPropagation: () => {} }) : setExpandedCard(isExpanded ? null : item.ip)}
                  onKeyDown={e => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    if (e.target !== e.currentTarget) return; // let inner controls handle their own keys
                    e.preventDefault();
                    if (selectedIPs.size > 0) toggleSelect(item.ip, { stopPropagation: () => {} });
                    else setExpandedCard(isExpanded ? null : item.ip);
                  }}
                  className={`group rounded-xl border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
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
                          role="checkbox"
                          aria-checked={isSelected}
                          tabIndex={0}
                          aria-label={`Select ${item.assetName || item.ip}`}
                          onClick={e => toggleSelect(item.ip, e)}
                          onKeyDown={e => {
                            if (e.key !== 'Enter' && e.key !== ' ') return;
                            e.preventDefault();
                            e.stopPropagation();
                            toggleSelect(item.ip, { stopPropagation: () => {} });
                          }}
                          className={`mt-0.5 w-4 h-4 rounded border-2 flex-shrink-0 cursor-pointer flex items-center justify-center transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500
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
                              iconSlug={item.iconSlug}
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
                        {!isFree && !isReserved && (item.proxmoxVmid || (item.tags || []).includes('proxmox')) && (() => {
                          const vmState = proxmoxVmStatus[item.ip];
                          if (!vmState || vmState.status === 'unknown') return null;
                          const cfg = {
                            running: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: '▶', label: 'running' },
                            stopped: { cls: 'bg-slate-100 text-slate-500 border-slate-200',    icon: '■', label: 'stopped' },
                            paused:  { cls: 'bg-amber-50  text-amber-700  border-amber-200',   icon: '⏸', label: 'paused'  },
                          }[vmState.status];
                          if (!cfg) return null;
                          return (
                            <span
                              title={`Proxmox VM ${vmState.status} — VMID ${vmState.vmid} on ${vmState.node}`}
                              className={`px-2 py-0.5 text-xs font-medium rounded-full border ${cfg.cls}`}
                            >
                              {cfg.icon} {cfg.label}
                            </span>
                          );
                        })()}
                        {!isFree && !isReserved && (() => {
                          const deps = item.dependencies || [];
                          if (!deps.length) return null;
                          const downDeps = deps.filter(depIp =>
                            pingStatus[depIp] === 'down' ||
                            (healthStatus[depIp] && healthStatus[depIp].status === 'down')
                          );
                          if (!downDeps.length) return null;
                          const names = downDeps.map(ip => {
                            const e = networkIpData.find(x => x.ip === ip);
                            return e?.assetName || ip;
                          }).join(', ');
                          return (
                            <span
                              title={`Dependency offline: ${names}`}
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700 border border-red-200"
                            >
                              <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                              dep offline
                            </span>
                          );
                        })()}
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
                        {!isFree && !isReserved && item.healthPort && healthStatus[item.ip] != null && (
                          <span
                            title={`Service ${healthStatus[item.ip].status === 'up' ? 'up' : 'down'}${healthStatus[item.ip].code ? ` (HTTP ${healthStatus[item.ip].code})` : ''} — ${item.healthScheme || 'http'}://${item.ip}:${item.healthPort}${item.healthPath || '/'}`}
                            className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${healthStatus[item.ip].status === 'up' ? 'bg-sky-400' : 'bg-orange-400'}`}
                          />
                        )}
                        {!isFree && !isReserved && lastSeen[item.ip] && (
                          <span
                            title={`Last seen: ${new Date(lastSeen[item.ip]).toLocaleString()}`}
                            className={`inline-flex items-center gap-0.5 text-xs font-mono ml-0.5 ${lastSeenAge(lastSeen[item.ip]) === 'stale' ? 'text-amber-500' : 'text-slate-400'}`}
                          >
                            <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                            {formatLastSeen(lastSeen[item.ip])}
                          </span>
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
                        {item.mac && (
                          <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                            <span className="font-mono">{item.mac}</span>
                            {item.macVendor && <span className="text-slate-400">· {item.macVendor}</span>}
                          </div>
                        )}

                        {/* Additional IPs — shown on the primary card */}
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
                        {persistMode === 'api' && (
                          <div className="mb-4 pb-4 border-b border-slate-100">
                            <DeviceHistory ip={item.ip} />
                          </div>
                        )}
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
                          {(item.dependencies || []).length > 0 && (
                            <div className="col-span-2">
                              <div className="text-slate-400 text-xs uppercase tracking-wide mb-1.5">Dependencies</div>
                              <div className="space-y-1">
                                {(item.dependencies || []).map(depIp => {
                                  const depEntry = networkIpData.find(e => e.ip === depIp);
                                  const ping   = pingStatus[depIp];
                                  const health = healthStatus[depIp];
                                  const isDown = ping === 'down' || (health && health.status === 'down');
                                  const isUp   = ping === 'up'   || (health && health.status === 'up');
                                  return (
                                    <div key={depIp} className="flex items-center gap-2 text-xs">
                                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isDown ? 'bg-red-400' : isUp ? 'bg-emerald-400' : 'bg-slate-300'}`}
                                        title={isDown ? 'Offline' : isUp ? 'Online' : 'Unknown'} />
                                      <span className="font-mono text-slate-500">{depIp}</span>
                                      <span className="text-slate-700 font-medium">{depEntry?.assetName || '—'}</span>
                                      {isDown && <span className="text-red-600 font-semibold ml-auto">offline</span>}
                                    </div>
                                  );
                                })}
                              </div>
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
                                    {(Array.isArray(entry.changes)
                                      ? entry.changes
                                      : Object.entries(entry.changes || {}).map(([key, val]) => ({
                                          label: key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()),
                                          old: val?.from ?? null,
                                          new: val?.to ?? val,
                                        }))
                                    ).map((c, j) => (
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
                          {item.healthPort && (
                            <a
                              href={`${item.healthScheme || 'http'}://${item.ip}:${item.healthPort}${item.healthPath || '/'}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 transition-colors"
                              title={`Open ${item.healthScheme || 'http'}://${item.ip}:${item.healthPort}${item.healthPath || '/'}`}
                            >
                              <Globe className="w-3.5 h-3.5" />
                              {item.healthScheme === 'https' ? 'HTTPS' : 'HTTP'}
                            </a>
                          )}
                          {item.hostname && (
                            <a
                              href={`ssh://${item.sshUser ? `${item.sshUser}@` : ''}${item.hostname}`}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors"
                              title={`SSH to ${item.sshUser ? `${item.sshUser}@` : ''}${item.hostname}`}
                            >
                              <Terminal className="w-3.5 h-3.5" />
                              SSH
                            </a>
                          )}
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
                          {!isFree && !isReserved && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setQrItem(item); }}
                              className="flex items-center justify-center gap-1.5 px-3 py-2 bg-violet-100 hover:bg-violet-200 rounded-lg text-sm text-violet-700 transition-colors"
                              title="Generate QR code for this entry" aria-label="Generate QR code for this entry">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
                                <path d="M14 14h3v3M17 17v3h3M14 20h3"/>
                              </svg>
                              QR
                            </button>
                          )}
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
                            {!isFree && !isReserved && item.healthPort && healthStatus[item.ip] != null && (
                              <span
                                title={`Service ${healthStatus[item.ip].status === 'up' ? 'up' : 'down'}${healthStatus[item.ip].code ? ` (HTTP ${healthStatus[item.ip].code})` : ''} — ${item.healthScheme || 'http'}://${item.ip}:${item.healthPort}${item.healthPath || '/'}`}
                                className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${healthStatus[item.ip].status === 'up' ? 'bg-sky-400' : 'bg-orange-400'}`}
                              />
                            )}
                            {!isFree && !isReserved && lastSeen[item.ip] && (
                              <span
                                title={`Last seen: ${new Date(lastSeen[item.ip]).toLocaleString()}`}
                                className={`inline-flex items-center gap-0.5 text-xs font-mono ${lastSeenAge(lastSeen[item.ip]) === 'stale' ? 'text-amber-500' : 'text-slate-400'}`}
                              >
                                <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                {formatLastSeen(lastSeen[item.ip])}
                              </span>
                            )}
                          </div>
                          {item.mac && (
                            <div className="text-xs text-slate-400 font-mono mt-0.5" title={item.macVendor || item.mac}>
                              {item.mac}
                            </div>
                          )}
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
                          {/* Additional IPs listed under asset name in table */}
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
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {item.type && (
                              <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${getTypeColor(item.type)}`}>
                                {item.type}
                              </span>
                            )}
                            {!isFree && !isReserved && (() => {
                              const vmState = proxmoxVmStatus[item.ip];
                              if (!vmState || vmState.status === 'unknown') return null;
                              const cfg = {
                                running: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: '▶', label: 'running' },
                                stopped: { cls: 'bg-slate-100 text-slate-500 border-slate-200',    icon: '■', label: 'stopped' },
                                paused:  { cls: 'bg-amber-50  text-amber-700  border-amber-200',   icon: '⏸', label: 'paused'  },
                              }[vmState.status];
                              if (!cfg) return null;
                              return (
                                <span
                                  title={`Proxmox VM ${vmState.status} — VMID ${vmState.vmid} on ${vmState.node}`}
                                  className={`px-2 py-0.5 text-xs font-medium rounded-full border ${cfg.cls}`}
                                >
                                  {cfg.icon} {cfg.label}
                                </span>
                              );
                            })()}
                          </div>
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
                                iconSlug={item.iconSlug}
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
                          <div className="flex items-center gap-1.5">
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
                            {!isFree && !isReserved && (
                              <button
                                onClick={() => setQrItem(item)}
                                title="QR code"
                                className="flex items-center justify-center p-1 text-violet-400 hover:text-violet-600 hover:bg-violet-50 rounded transition-colors" aria-label="QR code">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
                                  <path d="M14 14h3v3M17 17v3h3M14 20h3"/>
                                </svg>
                              </button>
                            )}
                          </div>
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
