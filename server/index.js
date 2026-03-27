// ============================================================
//  IP Address Manager — SQLite API Server
//  Listens on 127.0.0.1:3001 (proxied by Nginx at /api/)
// ============================================================

const express = require('express');
const Database = require('better-sqlite3');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const https = require('https');
const http  = require('http');
const path = require('path');
const fs = require('fs');
const { exec, execFile } = require('child_process');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// ── Credentials ───────────────────────────────────────────────────────────────
// Reads from IP_MANAGER_USERNAME / IP_MANAGER_PASSWORD env vars.
// If not set, falls back to a credentials.env file.
// The file path can be overridden with CREDENTIALS_FILE env var (useful when
// the server directory is read-only, e.g. deployed under /opt).
// If that doesn't exist either, defaults to admin / admin (with a warning).

// Resolve the credentials file path once at startup.
const CREDENTIALS_FILE = process.env.CREDENTIALS_FILE || path.join(__dirname, 'credentials.env');

function loadCredentials() {
  if (process.env.IP_MANAGER_USERNAME && process.env.IP_MANAGER_PASSWORD) {
    return {
      username: process.env.IP_MANAGER_USERNAME,
      password: process.env.IP_MANAGER_PASSWORD,
    };
  }
  const envFile = CREDENTIALS_FILE;
  if (fs.existsSync(envFile)) {
    const lines = fs.readFileSync(envFile, 'utf8').split('\n');
    const env = {};
    lines.forEach(line => {
      const [k, ...rest] = line.split('=');
      if (k && rest.length) env[k.trim()] = rest.join('=').trim();
    });
    if (env.IP_MANAGER_USERNAME && env.IP_MANAGER_PASSWORD) {
      return { username: env.IP_MANAGER_USERNAME, password: env.IP_MANAGER_PASSWORD };
    }
  }
  console.warn(`[auth] No credentials configured — using defaults (admin/admin). Set CREDENTIALS_FILE env var or create ${CREDENTIALS_FILE} to persist your own.`);
  return { username: 'admin', password: 'admin' };
}

let credentials = loadCredentials();

// ── Session store ─────────────────────────────────────────────────────────────
// Simple in-memory map of token → expiry. Sessions are cleared on server restart.

const SESSION_COOKIE = 'ip-manager-session';
const sessions = new Map(); // token → expires timestamp (0 = browser-session only)

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, 0); // 0 = no absolute expiry, lives until server restart or logout
  return token;
}

function isValidSession(token) {
  if (!token || !sessions.has(token)) return false;
  const expires = sessions.get(token);
  if (expires && Date.now() > expires) {
    sessions.delete(token);
    return false;
  }
  return true;
}

// ── Auth middleware ───────────────────────────────────────────────────────────
// Applied to all /api/* routes except /api/auth/*

function requireAuth(req, res, next) {
  if (isValidSession(req.cookies[SESSION_COOKIE])) return next();
  res.status(401).json({ error: 'Unauthorised' });
}

// ── Auth routes (unprotected) ─────────────────────────────────────────────────

app.post('/api/auth/login', (req, res) => {
  // Reload credentials on each login attempt so changes to credentials.env
  // take effect without restarting the server
  credentials = loadCredentials();
  const { username, password } = req.body || {};
  if (username === credentials.username && password === credentials.password) {
    const token = createSession();
    // httpOnly prevents JS access; sameSite=strict prevents CSRF
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict' });
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Invalid username or password' });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies[SESSION_COOKIE];
  if (token) sessions.delete(token);
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

app.get('/api/auth/status', (req, res) => {
  res.json({ authenticated: isValidSession(req.cookies[SESSION_COOKIE]) });
});

// Change credentials — requires a valid session AND the current password
app.post('/api/auth/change-password', (req, res) => {
  if (!isValidSession(req.cookies[SESSION_COOKIE])) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  const { currentPassword, newUsername, newPassword } = req.body || {};
  if (!currentPassword || !newUsername || !newPassword) {
    return res.status(400).json({ error: 'currentPassword, newUsername and newPassword are required' });
  }
  // Reload to pick up any manual edits to credentials.env
  credentials = loadCredentials();
  if (currentPassword !== credentials.password) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  // Write the new credentials to credentials.env (or CREDENTIALS_FILE if set)
  const envFile = CREDENTIALS_FILE;
  const content = `IP_MANAGER_USERNAME=${newUsername}\nIP_MANAGER_PASSWORD=${newPassword}\n`;
  try {
    fs.writeFileSync(envFile, content, 'utf8');
    credentials = { username: newUsername, password: newPassword };
    // Invalidate all existing sessions so everyone must re-login
    sessions.clear();
    res.clearCookie(SESSION_COOKIE);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not write credentials file: ' + err.message });
  }
});

// ── Proxmox integration ───────────────────────────────────────────────────────

// Low-level helper: makes a single GET request to the Proxmox API.
// Returns the parsed `data` field of the JSON response.
function proxmoxFetch(host, port, apiPath, token, ignoreTls) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host,
      port,
      path: `/api2/json${apiPath}`,
      method: 'GET',
      headers: { Authorization: `PVEAPIToken=${token}` },
      rejectUnauthorized: !ignoreTls,
      timeout: 8000,
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const body = JSON.parse(raw);
          resolve(body.data ?? body);
        } catch {
          reject(new Error('Invalid JSON from Proxmox'));
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', reject);
    req.end();
  });
}

// Extract valid IPv4 addresses from a list, skipping loopback and link-local.
function filterIPs(ips) {
  return ips.filter(ip =>
    ip &&
    /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) &&
    !ip.startsWith('127.') &&
    !ip.startsWith('169.254.')
  );
}

// Discover all VMs and LXCs across all nodes on a Proxmox host.
// Returns { entries: [...], noIp: [...] }
async function discoverProxmox(host, port, token, ignoreTls) {
  const entries = [];
  const noIp    = [];
  const nodes   = await proxmoxFetch(host, port, '/nodes', token, ignoreTls);

  for (const { node } of nodes) {
    // ── LXC containers ──────────────────────────────────────────────────────
    let lxcs = [];
    try { lxcs = await proxmoxFetch(host, port, `/nodes/${node}/lxc`, token, ignoreTls); }
    catch { /* node may have no LXC service */ }

    for (const lxc of lxcs) {
      let ips = [];
      try {
        const ifaces = await proxmoxFetch(host, port, `/nodes/${node}/lxc/${lxc.vmid}/interfaces`, token, ignoreTls);
        if (Array.isArray(ifaces)) {
          ips = filterIPs(ifaces.map(i => (i.inet || '').split('/')[0]));
        }
      } catch { /* container may be stopped */ }

      const base = {
        assetName:    lxc.name || `CT-${lxc.vmid}`,
        hostname:     lxc.name || '',
        type:         'LXC',
        location:     node,
        apps:         '',
        tags:         ['proxmox'],
        updatedAt:    new Date().toISOString(),
        // Dedicated Proxmox metadata — kept separate from user-editable notes
        proxmoxVmid: String(lxc.vmid),
        proxmoxNode:  node,
        proxmoxKind:  'lxc',
      };
      if (ips.length) {
        // Auto-group multi-IP containers with a shared hostId (Option A)
        const hostId = ips.length > 1 ? `host-${lxc.vmid}-${node}` : undefined;
        entries.push({ ...base, ip: ips[0], ...(hostId ? { hostId, isPrimary: true } : {}) });
        ips.slice(1).forEach(ip => entries.push({ ...base, ip, assetName: `${base.assetName} (${ip})`, ...(hostId ? { hostId, isPrimary: false } : {}) }));
      } else {
        noIp.push({ ...base, ip: '', _vmid: lxc.vmid, _node: node });
      }
    }

    // ── QEMU virtual machines ───────────────────────────────────────────────
    let vms = [];
    try { vms = await proxmoxFetch(host, port, `/nodes/${node}/qemu`, token, ignoreTls); }
    catch { /* node may have no QEMU service */ }

    for (const vm of vms) {
      let ips = [];
      try {
        // Guest agent required — silently skipped if unavailable
        const agent = await proxmoxFetch(host, port, `/nodes/${node}/qemu/${vm.vmid}/agent/network-get-interfaces`, token, ignoreTls);
        if (agent?.result && Array.isArray(agent.result)) {
          ips = filterIPs(
            agent.result.flatMap(iface =>
              (iface['ip-addresses'] || [])
                .filter(a => a['ip-address-type'] === 'ipv4')
                .map(a => a['ip-address'])
            )
          );
        }
      } catch { /* no guest agent installed */ }

      const base = {
        assetName:   vm.name || `VM-${vm.vmid}`,
        hostname:    vm.name || '',
        type:        'Virtual',
        location:    node,
        apps:        '',
        tags:        ['proxmox'],
        updatedAt:   new Date().toISOString(),
        // Dedicated Proxmox metadata — kept separate from user-editable notes
        proxmoxVmid: String(vm.vmid),
        proxmoxNode:  node,
        proxmoxKind:  'qemu',
      };
      if (ips.length) {
        const hostId = ips.length > 1 ? `host-${vm.vmid}-${node}` : undefined;
        entries.push({ ...base, ip: ips[0], ...(hostId ? { hostId, isPrimary: true } : {}) });
        ips.slice(1).forEach(ip => entries.push({ ...base, ip, assetName: `${base.assetName} (${ip})`, ...(hostId ? { hostId, isPrimary: false } : {}) }));
      } else {
        noIp.push({ ...base, ip: '', _vmid: vm.vmid, _node: node });
      }
    }
  }

  return { entries, noIp };
}

// POST /api/proxmox/discover — proxies to Proxmox API (avoids browser CORS/TLS issues)
app.post('/api/proxmox/discover', async (req, res) => {
  const { host: rawHost, apiToken, ignoreTls } = req.body || {};
  if (!rawHost || !apiToken) {
    return res.status(400).json({ error: 'host and apiToken are required' });
  }

  // Normalise host: strip protocol, extract optional port
  let host = rawHost.replace(/^https?:\/\//i, '').trim().replace(/\/+$/, '');
  let port = 8006;
  const colonIdx = host.lastIndexOf(':');
  if (colonIdx > 0 && !host.includes(']')) { // ignore IPv6 colons
    const maybePort = parseInt(host.slice(colonIdx + 1));
    if (!isNaN(maybePort)) { port = maybePort; host = host.slice(0, colonIdx); }
  }

  try {
    const result = await discoverProxmox(host, port, apiToken, !!ignoreTls);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `Could not connect to Proxmox: ${err.message}` });
  }
});

// ── Database setup ────────────────────────────────────────────────────────────

const DB_PATH = path.join(__dirname, 'ip-manager.db');
const db = new Database(DB_PATH);

// Single key/value store table — simple and flexible
db.exec(`
  CREATE TABLE IF NOT EXISTS store (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

const dbGet = (key) => {
  const row = db.prepare('SELECT value FROM store WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : null;
};

const dbSet = (key, value) => {
  db.prepare('INSERT OR REPLACE INTO store (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
};

// ── One-time data migration ───────────────────────────────────────────────────
// Extracts the "VMID: X | Node: Y | Status: Z" system metadata that was
// previously embedded in the user-editable notes field into dedicated
// proxmoxVmid / proxmoxNode / proxmoxKind fields.  Runs once on startup;
// safe to repeat (already-migrated entries are skipped).
(function migrateProxmoxNotes() {
  const ipData = dbGet('ip_data');
  if (!Array.isArray(ipData)) return;

  let changed = 0;
  for (const entry of ipData) {
    // Already migrated
    if (entry.proxmoxVmid) continue;
    // Only applies to proxmox-tagged entries with the known notes pattern
    if (!(entry.tags || []).includes('proxmox')) continue;
    const parsed = parseProxmoxNotes(entry.notes);
    if (!parsed) continue;

    entry.proxmoxVmid = String(parsed.vmid);
    entry.proxmoxNode = parsed.node;
    // Determine kind from type field set at import time
    entry.proxmoxKind = entry.type === 'LXC' ? 'lxc' : 'qemu';

    // Strip the system metadata line from notes, leaving any real user notes
    // The full pattern is the entire string "VMID: X | Node: Y | Status: Z"
    const cleaned = (entry.notes || '')
      .replace(/VMID:\s*\d+\s*\|\s*Node:\s*[^\|]+\s*\|\s*Status:\s*\S+/gi, '')
      .trim();
    entry.notes = cleaned;
    changed++;
  }

  if (changed > 0) {
    dbSet('ip_data', ipData);
    console.log(`[migration] Extracted Proxmox metadata from notes for ${changed} entr${changed === 1 ? 'y' : 'ies'}`);
  }
})();

// ── Protected routes ──────────────────────────────────────────────────────────
// All /api/* routes below this point require a valid session.

app.use('/api', requireAuth);

// Health check — used by the React app to detect API mode
app.get('/api/health', (req, res) => {
  res.json({ ok: true, mode: 'sqlite' });
});

// IP data
app.get('/api/ips', (req, res) => {
  const data = dbGet('ip_data');
  res.json({ data }); // null if not yet saved — client falls back to hardcoded defaults
});

app.put('/api/ips', (req, res) => {
  if (!Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Expected an array of IP entries' });
  }
  dbSet('ip_data', req.body);
  res.json({ ok: true });
});

// Network config (legacy single-config endpoint — kept for migration)
app.get('/api/config', (req, res) => {
  const data = dbGet('network_config');
  res.json({ data }); // null if not yet saved — client falls back to defaults
});

app.put('/api/config', (req, res) => {
  if (typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Expected a config object' });
  }
  dbSet('network_config', req.body);
  res.json({ ok: true });
});

// Networks array (multi-network support — supersedes /api/config)
app.get('/api/networks', (req, res) => {
  const data = dbGet('networks');
  res.json({ data }); // null until first save — client migrates from /api/config
});

app.put('/api/networks', (req, res) => {
  if (!Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Expected an array of network configs' });
  }
  dbSet('networks', req.body);
  res.json({ ok: true });
});

// Import — merge or replace IP data (network-aware)
app.post('/api/import', (req, res) => {
  const { rows, mode, networkId } = req.body;
  if (!Array.isArray(rows)) {
    return res.status(400).json({ error: 'Expected rows array' });
  }

  const sortByIp = (arr) =>
    arr.sort((a, b) => {
      const aO = parseInt((a.ip || '').split('.')[3] || 0);
      const bO = parseInt((b.ip || '').split('.')[3] || 0);
      return aO - bO;
    });

  if (mode === 'replace') {
    if (networkId) {
      // Replace only entries belonging to this network; leave other networks intact
      const current = dbGet('ip_data') || [];
      const others = current.filter(r => r.networkId !== networkId);
      dbSet('ip_data', sortByIp([...others, ...rows]));
    } else {
      dbSet('ip_data', sortByIp(rows));
    }
    return res.json({ imported: rows.length, skipped: 0, errors: [] });
  }

  // Merge: add new rows, update existing ones matched by IP
  const current = dbGet('ip_data') || [];
  const ipMap = new Map(current.map(r => [r.ip, r]));
  rows.forEach(r => ipMap.set(r.ip, r));
  const merged = sortByIp(Array.from(ipMap.values()));
  dbSet('ip_data', merged);
  res.json({ imported: rows.length, skipped: 0, errors: [] });
});

// ── ARP scanning ──────────────────────────────────────────────────────────────

const { execSync }   = require('child_process');
const dnsPromises    = require('dns').promises;

// Escape a single shell argument safely
function shellEsc(arg) {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

// Parse arp-scan stdout — tab-separated: IP \t MAC \t Vendor
// Skips header/footer lines that don't match the IP pattern
function parseArpScanOutput(output) {
  const ipMacLine = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})\s+(.+)$/;
  return output.split('\n').reduce((acc, line) => {
    const m = line.trim().match(ipMacLine);
    if (m) acc.push({ ip: m[1], mac: m[2], vendor: m[3].trim() });
    return acc;
  }, []);
}

// Fallback: read the kernel ARP cache from /proc/net/arp
// Only shows recently-seen devices but requires no extra tools
function parseArpCache() {
  const content = fs.readFileSync('/proc/net/arp', 'utf8');
  const ipRx  = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
  const macRx = /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/i;
  return content.split('\n').slice(1).reduce((acc, line) => {
    const p = line.trim().split(/\s+/);
    if (p.length >= 4 && ipRx.test(p[0]) && macRx.test(p[3]) && p[3] !== '00:00:00:00:00:00') {
      acc.push({ ip: p[0], mac: p[3], vendor: 'Unknown (ARP cache)' });
    }
    return acc;
  }, []);
}

// Reverse-DNS lookup — silently returns '' on any failure
async function reverseLookup(ip) {
  try {
    const names = await dnsPromises.reverse(ip);
    return names[0] || '';
  } catch {
    return '';
  }
}

// Build the arp-scan command from subnet + optional interface
// Normalises "192.168.1" → "192.168.1.0/24"  and  "192.168" → "192.168.0.0/16"
function buildArpScanCmd(subnet, iface) {
  let cidr = subnet;
  if (!cidr.includes('/')) {
    const octets = cidr.split('.');
    if (octets.length === 2)      cidr = `${cidr}.0.0/16`;
    else if (octets.length === 3) cidr = `${cidr}.0/24`;
  }
  const ifaceFlag = iface ? `-I ${shellEsc(iface)} ` : '';
  return `arp-scan ${ifaceFlag}${cidr}`;
}

// POST /api/arp/scan
// Body: { subnet: "192.168.1", interface?: "eth0" }
// Returns: { results: [{ ip, mac, vendor, hostname, status }], method: 'arp-scan'|'arp-cache' }
app.post('/api/arp/scan', async (req, res) => {
  const { subnet, interface: iface } = req.body || {};
  if (!subnet) return res.status(400).json({ error: 'subnet is required' });

  let raw = [];
  let method = 'arp-scan';
  let scanWarning = null;

  try {
    const cmd = buildArpScanCmd(subnet, iface);
    const stdout = execSync(cmd, { encoding: 'utf8', timeout: 30000,
                                   stdio: ['pipe', 'pipe', 'pipe'] });
    raw = parseArpScanOutput(stdout);
  } catch (err) {
    // arp-scan not installed or lacks raw socket capability — fall back to kernel ARP cache.
    // Most likely cause: service runs as www-data without CAP_NET_RAW.
    // Fix: run  setcap cap_net_raw+ep $(which arp-scan)  on the server.
    console.warn('[arp-scan] Primary scan failed:', err.message, '— falling back to /proc/net/arp');
    method = 'arp-cache';
    scanWarning = err.message.includes('Operation not permitted') || err.message.includes('EPERM')
      ? 'arp-scan lacks raw socket permission. Run: setcap cap_net_raw+ep $(which arp-scan)'
      : err.message.includes('not found') || err.message.includes('ENOENT')
      ? 'arp-scan is not installed. Run: apt-get install arp-scan && setcap cap_net_raw+ep $(which arp-scan)'
      : `arp-scan failed: ${err.message}`;
    try {
      raw = parseArpCache();
    } catch (fallbackErr) {
      return res.status(500).json({ error: `Scan failed: ${err.message}. Fallback also failed: ${fallbackErr.message}` });
    }
  }

  // Reverse-DNS lookups in parallel (best-effort)
  const withHostnames = await Promise.all(
    raw.map(async entry => ({ ...entry, hostname: await reverseLookup(entry.ip) }))
  );

  // Cross-reference against stored IP data
  const ipData = dbGet('ip_data') || [];
  const inManager = new Set(ipData.map(e => e.ip));

  // Determine subnet prefix for "is this IP in range?" check
  const prefix = subnet.replace(/\/\d+$/, '').split('.').filter(Boolean);

  const results = withHostnames.map(entry => {
    const tracked = inManager.has(entry.ip);
    const inRange = entry.ip.split('.').slice(0, prefix.length).join('.') === prefix.join('.');
    return {
      ...entry,
      status: tracked ? 'Tracked' : inRange ? 'Untracked' : 'OutOfRange',
    };
  }).sort((a, b) => {
    const aOct = a.ip.split('.').map(Number);
    const bOct = b.ip.split('.').map(Number);
    for (let i = 0; i < 4; i++) {
      if (aOct[i] !== bOct[i]) return aOct[i] - bOct[i];
    }
    return 0;
  });

  res.json({ results, method, total: results.length, scanWarning });
});

// ── Ping / reachability ───────────────────────────────────────────────────────

let pingCache = { results: {}, timestamp: 0, warning: null };
const PING_CACHE_TTL = 20 * 1000; // 20 s — serve cached results within this window
const PING_INTERVAL  = 60 * 1000; // 60 s — background re-scan cadence

function getTrackedIPs() {
  const rows = dbGet('ip_data') || [];
  return rows
    .filter(r => r.ip && r.status !== 'free')
    .map(r => r.ip);
}

function runFping(ips) {
  return new Promise((resolve) => {
    if (!ips.length) return resolve({ results: {}, warning: null });

    // Use execFile (not exec/shell) so error messages never include the full
    // command string with every IP address in it.
    //
    // fping flags:
    //   -a  print only alive hosts to stdout (one per line)
    //   -q  quiet — suppress per-packet stats on stderr
    //   -t  per-host timeout in ms
    //
    // NOTE: do NOT use -c (count mode). In count mode fping writes stats to
    // stderr instead of printing alive hosts to stdout, so -a has no effect
    // and stdout comes back empty — every host appears down regardless.
    // Without -c, fping sends one probe per host by default (correct behaviour).
    //
    // Exit codes:  0 = all alive,  1 = some unreachable (normal),  other = error
    const args = ['-a', '-q', '-t', '500', ...ips];
    execFile('fping', args, { timeout: 15000 }, (err, stdout) => {
      if (err) {
        // err.code === 1 means "some hosts unreachable" — that is normal; parse stdout as usual.
        if (err.code === 1) {
          const alive = new Set(stdout.trim().split('\n').filter(Boolean));
          const results = {};
          for (const ip of ips) results[ip] = alive.has(ip) ? 'up' : 'down';
          return resolve({ results, warning: null });
        }

        // err.code === 'ENOENT' → binary not found on PATH
        // err.code === 'EPERM' or err.errno === -1 → lacks CAP_NET_RAW
        let warning;
        if (err.code === 'ENOENT') {
          warning = 'fping is not installed. Run the update script (ip-manager-update) to install it automatically, or manually: apt-get install fping && setcap cap_net_raw+ep $(which fping)';
        } else if (err.code === 'EPERM' || err.code === 1 || (err.stderr || '').includes('Operation not permitted')) {
          warning = 'fping lacks raw socket permission. Run: setcap cap_net_raw+ep $(which fping)';
        } else {
          // Never expose the raw error — it can contain hundreds of IP addresses.
          warning = 'fping encountered an error — ping status unavailable. Check server logs for details.';
        }
        console.warn('[ping] fping error (code=%s):', err.code, err.message ? err.message.slice(0, 120) : '');
        return resolve({ results: {}, warning });
      }

      const alive = new Set(stdout.trim().split('\n').filter(Boolean));
      const results = {};
      for (const ip of ips) results[ip] = alive.has(ip) ? 'up' : 'down';
      resolve({ results, warning: null });
    });
  });
}

async function refreshPingCache() {
  const ips = getTrackedIPs();
  if (!ips.length) return;
  const { results, warning } = await runFping(ips);
  pingCache = { results, timestamp: Date.now(), warning };
}

// Background poller — runs immediately on startup, then every PING_INTERVAL
refreshPingCache();
setInterval(refreshPingCache, PING_INTERVAL);

// GET /api/ping-status — returns cached results; forces refresh if cache is stale
app.get('/api/ping-status', requireAuth, async (req, res) => {
  const force = req.query.force === '1';
  const stale = (Date.now() - pingCache.timestamp) > PING_CACHE_TTL;
  if (force || stale) await refreshPingCache();
  res.json({
    results:   pingCache.results,
    warning:   pingCache.warning,
    cachedAt:  pingCache.timestamp,
    nextIn:    Math.max(0, PING_INTERVAL - (Date.now() - pingCache.timestamp)),
  });
});

// ── Service health checks ─────────────────────────────────────────────────────
// Opt-in HTTP/HTTPS probe per entry.  Entries with a non-empty `healthPort`
// field are included in the background scan.  TLS cert errors are always
// ignored (self-signed certs are the norm in home-lab environments).

let serviceHealthCache = { results: {}, timestamp: 0 };
const HEALTH_CACHE_TTL = 20 * 1000; // 20 s — serve cached within this window
const HEALTH_INTERVAL  = 60 * 1000; // 60 s — background re-scan cadence

function probeService(scheme, ip, port, path, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const mod = scheme === 'https' ? https : http;
    const options = {
      hostname: ip,
      port:     parseInt(port, 10),
      path:     path || '/',
      method:   'GET',
      timeout:  timeoutMs,
      rejectUnauthorized: false,
      headers: { 'User-Agent': 'IPManager-HealthCheck/1.0', 'Connection': 'close' },
    };
    const req = mod.request(options, (res) => {
      res.resume(); // drain body so socket is released
      resolve({ status: res.statusCode < 500 ? 'up' : 'down', code: res.statusCode });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 'down', code: null }); });
    req.on('error',   () =>                  resolve({ status: 'down', code: null }));
    req.end();
  });
}

async function runServiceHealthChecks() {
  const rows = dbGet('ip_data') || [];
  const targets = rows.filter(r => r.ip && r.status !== 'free' && r.healthPort);
  if (!targets.length) return;

  const probes = targets.map(r =>
    probeService(r.healthScheme || 'http', r.ip, r.healthPort, r.healthPath || '/')
      .then(result => ({ ip: r.ip, ...result }))
  );
  const settled = await Promise.all(probes);
  const results = {};
  for (const { ip, status, code } of settled) results[ip] = { status, code };
  serviceHealthCache = { results, timestamp: Date.now() };
}

// Background poller — runs immediately on startup, then every HEALTH_INTERVAL
runServiceHealthChecks();
setInterval(runServiceHealthChecks, HEALTH_INTERVAL);

// GET /api/service-health — returns cached results; forces refresh if stale or ?force=1
app.get('/api/service-health', requireAuth, async (req, res) => {
  const force = req.query.force === '1';
  const stale = (Date.now() - serviceHealthCache.timestamp) > HEALTH_CACHE_TTL;
  if (force || stale) await runServiceHealthChecks();
  res.json({
    results:  serviceHealthCache.results,
    cachedAt: serviceHealthCache.timestamp,
    nextIn:   Math.max(0, HEALTH_INTERVAL - (Date.now() - serviceHealthCache.timestamp)),
  });
});

// ── Proxmox VM live status ────────────────────────────────────────────────────
// Polls the running/stopped/paused state of every Proxmox-tagged entry.
// Matches entries via the "VMID: X | Node: Y" pattern written into the notes
// field by the importer and sync — no schema changes required.
// Read-only: we query state only, never send commands to Proxmox.

let proxmoxVmStatusCache = { results: {}, timestamp: 0 };
const PROXMOX_STATUS_TTL      = 30 * 1000; // 30 s — serve cached within this window
const PROXMOX_STATUS_INTERVAL = 60 * 1000; // 60 s — background re-scan cadence

// Parse "VMID: 101 | Node: pve1" from the notes field written by importer/sync.
function parseProxmoxNotes(notes) {
  if (!notes) return null;
  const vmidMatch = notes.match(/VMID:\s*(\d+)/i);
  const nodeMatch = notes.match(/Node:\s*([^\s|]+)/i);
  if (!vmidMatch || !nodeMatch) return null;
  return { vmid: vmidMatch[1], node: nodeMatch[1].trim() };
}

async function runProxmoxVmStatusCheck() {
  const config = getProxmoxSyncConfig();
  if (!config.host || !config.token) return; // not configured — skip silently

  // Normalise host / port (same logic as sync and discover endpoints)
  let host = config.host.replace(/^https?:\/\//i, '').trim().replace(/\/+$/, '');
  let port = 8006;
  const colonIdx = host.lastIndexOf(':');
  if (colonIdx > 0 && !host.includes(']')) {
    const maybePort = parseInt(host.slice(colonIdx + 1));
    if (!isNaN(maybePort)) { port = maybePort; host = host.slice(0, colonIdx); }
  }

  const ipData = dbGet('ip_data') || [];
  // Use dedicated fields first; fall back to parsing notes for entries imported
  // before this change was made (migration may not have run yet on first boot)
  const targets = ipData.filter(e => {
    if (!e.ip) return false;
    if (e.proxmoxVmid && e.proxmoxNode) return true;
    // Legacy fallback: proxmox-tagged entry with parseable notes
    return (e.tags || []).includes('proxmox') && parseProxmoxNotes(e.notes);
  });
  if (!targets.length) return;

  const probes = targets.map(async (entry) => {
    // Prefer dedicated fields; fall back to parsed notes for legacy entries
    let vmid = entry.proxmoxVmid;
    let node  = entry.proxmoxNode;
    let kind  = entry.proxmoxKind || (entry.type === 'LXC' ? 'lxc' : 'qemu');
    if (!vmid || !node) {
      const parsed = parseProxmoxNotes(entry.notes);
      if (!parsed) return null;
      vmid = parsed.vmid;
      node = parsed.node;
    }
    try {
      const data = await proxmoxFetch(
        host, port,
        `/nodes/${node}/${kind}/${vmid}/status/current`,
        config.token, !!config.ignoreTLS
      );
      return { ip: entry.ip, status: data.status || 'unknown', vmid, node, kind };
    } catch {
      return { ip: entry.ip, status: 'unknown', vmid, node, kind };
    }
  });

  const settled = (await Promise.all(probes)).filter(Boolean);
  const results = {};
  for (const { ip, status, vmid, node, kind } of settled) {
    results[ip] = { status, vmid, node, kind };
  }
  proxmoxVmStatusCache = { results, timestamp: Date.now() };
}

// Background poller — only fires if Proxmox is configured
runProxmoxVmStatusCheck();
setInterval(runProxmoxVmStatusCheck, PROXMOX_STATUS_INTERVAL);

// GET /api/proxmox-vm-status — returns cached VM state; forces refresh if stale or ?force=1
app.get('/api/proxmox-vm-status', requireAuth, async (req, res) => {
  const force = req.query.force === '1';
  const stale = (Date.now() - proxmoxVmStatusCache.timestamp) > PROXMOX_STATUS_TTL;
  if (force || stale) await runProxmoxVmStatusCheck();
  res.json({
    results:  proxmoxVmStatusCache.results,
    cachedAt: proxmoxVmStatusCache.timestamp,
    nextIn:   Math.max(0, PROXMOX_STATUS_INTERVAL - (Date.now() - proxmoxVmStatusCache.timestamp)),
  });
});

// ── In-browser update ─────────────────────────────────────────────────────────
// POST /api/update/start  — spawns scripts/update.sh --api-mode as root via sudo
// GET  /api/update/stream — SSE stream of live progress events
// GET  /api/update/result — last persisted result (survives service restart)
//
// Security: requireAuth on all endpoints; sudo is locked to the specific script
// via a sudoers entry added by install.sh.  No shell injection is possible
// because no user input is passed to the command.

const UPDATE_SCRIPT   = path.join(__dirname, '..', 'scripts', 'update.sh');
const UPDATE_RESULT   = path.join(__dirname, '.update-result.json');

let updateState = {
  running:   false,
  lines:     [],      // buffered for late-connecting SSE clients
  listeners: new Set(),
};

function broadcastUpdate(line) {
  updateState.lines.push(line);
  for (const send of updateState.listeners) { try { send(line); } catch {} }
}

app.post('/api/update/start', requireAuth, (req, res) => {
  if (updateState.running) {
    return res.status(409).json({ error: 'Update already in progress' });
  }
  // Check script exists
  if (!fs.existsSync(UPDATE_SCRIPT)) {
    return res.status(500).json({ error: 'Update script not found at ' + UPDATE_SCRIPT });
  }

  updateState = { running: true, lines: [], listeners: new Set() };
  res.json({ ok: true });

  // Run as root via sudoers entry (www-data ALL=(ALL) NOPASSWD: /bin/bash <script>)
  const child = require('child_process').spawn(
    'sudo', ['bash', UPDATE_SCRIPT, '--api-mode'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  const onLine = data => {
    const text = data.toString();
    text.split('\n').filter(l => l.trim()).forEach(broadcastUpdate);
  };
  child.stdout.on('data', onLine);
  child.stderr.on('data', onLine);

  child.on('close', code => {
    broadcastUpdate(code === 0 ? 'DONE:complete' : 'DONE:error');
    updateState.running = false;
    // Listeners will disconnect on their own; clear after a delay
    setTimeout(() => { updateState.listeners.clear(); }, 30000);
  });
});

app.get('/api/update/stream', requireAuth, (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = line => res.write(`data: ${line}\n\n`);

  // Replay buffered lines so a late-connecting client catches up
  updateState.lines.forEach(send);

  if (!updateState.running) {
    // Nothing running — close immediately after replay
    res.end();
    return;
  }

  updateState.listeners.add(send);
  req.on('close', () => updateState.listeners.delete(send));
});

app.get('/api/update/result', requireAuth, (req, res) => {
  try {
    if (!fs.existsSync(UPDATE_RESULT)) return res.json(null);
    const data = JSON.parse(fs.readFileSync(UPDATE_RESULT, 'utf8'));
    res.json(data);
  } catch {
    res.json(null);
  }
});

// GET /api/version-check — compares installed version against latest GitHub release
// Result is cached for 1 hour to avoid hammering the GitHub API.
const GITHUB_REPO       = 'xy-io/ip-manager';
const VERSION_CHECK_TTL = 60 * 60 * 1000; // 1 hour
let versionCheckCache   = { result: null, fetchedAt: 0 };

function fetchLatestGitHubRelease() {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com',
      path:     `/repos/${GITHUB_REPO}/releases/latest`,
      method:   'GET',
      headers:  { 'User-Agent': 'ip-manager-version-check', 'Accept': 'application/vnd.github.v3+json' },
    };
    const req = https.request(opts, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Invalid JSON from GitHub')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

app.get('/api/version-check', requireAuth, async (req, res) => {
  const force = req.query.force === '1';
  const stale = (Date.now() - versionCheckCache.fetchedAt) > VERSION_CHECK_TTL;
  if (force || stale || !versionCheckCache.result) {
    try {
      const data   = await fetchLatestGitHubRelease();
      const latest = (data.tag_name || '').replace(/^v/, '');
      // Read installed version from package.json (single source of truth)
      const pkgPath   = path.join(__dirname, '..', 'package.json');
      const pkgJson   = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const installed = (pkgJson.version || '0.0').replace(/^v/, '');
      // Simple numeric comparison: split on '.' and compare each segment
      function versionGt(a, b) {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
          const diff = (pa[i] || 0) - (pb[i] || 0);
          if (diff !== 0) return diff > 0;
        }
        return false;
      }
      versionCheckCache = {
        result: {
          installed:       `v${installed}`,
          latest:          `v${latest}`,
          updateAvailable: versionGt(latest, installed),
          releaseUrl:      data.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`,
          releaseName:     data.name || `v${latest}`,
          checkedAt:       Date.now(),
        },
        fetchedAt: Date.now(),
      };
    } catch (err) {
      // Network unreachable or GitHub down — return degraded response, don't crash
      return res.json({ error: 'Could not reach GitHub', detail: err.message });
    }
  }
  res.json(versionCheckCache.result);
});

// GET /api/changelog — parses CHANGELOG.md and returns structured version list
app.get('/api/changelog', requireAuth, (req, res) => {
  try {
    const clPath = path.join(__dirname, '..', 'CHANGELOG.md');
    const raw = fs.readFileSync(clPath, 'utf8');
    // Split on ## v headings to get per-version blocks
    const blocks = raw.split(/^## (v[\d.]+)/m).slice(1);
    const entries = [];
    for (let i = 0; i < blocks.length; i += 2) {
      const version = blocks[i].trim();
      const body    = (blocks[i + 1] || '').replace(/^---\s*$/m, '').trim();
      // Extract bold title before the em-dash as a short heading
      const titleMatch = body.match(/^\*\*(.+?)\*\*/);
      const title   = titleMatch ? titleMatch[1] : version;
      entries.push({ version, title, body });
    }
    res.json({ entries });
  } catch (err) {
    res.status(500).json({ error: 'Could not read changelog', detail: err.message });
  }
});

// ── Proxmox scheduled sync ────────────────────────────────────────────────────
// Periodically re-queries Proxmox and updates any entries that have drifted
// (e.g. a VM or LXC migrated to a different node after an HA failover).
// Only updates entries already tagged 'proxmox' — never auto-adds new ones.

let proxmoxSyncCache = { lastRun: null, changesFound: 0, changeLog: [], running: false, lastError: null };
let proxmoxSyncTimer  = null;
const PROXMOX_SYNC_MIN_INTERVAL = 15 * 60 * 1000; // 15 min floor

function getProxmoxSyncConfig() {
  return dbGet('proxmox_sync_config') || {
    host: '', token: '', ignoreTLS: true, enabled: false, intervalMinutes: 60,
    lastRun: null, changesFound: 0,
  };
}

function scheduleProxmoxSync() {
  if (proxmoxSyncTimer) { clearInterval(proxmoxSyncTimer); proxmoxSyncTimer = null; }
  const config = getProxmoxSyncConfig();
  if (!config.enabled || !config.host || !config.token) return;
  const interval = Math.max(PROXMOX_SYNC_MIN_INTERVAL, (config.intervalMinutes || 60) * 60 * 1000);
  proxmoxSyncTimer = setInterval(runProxmoxSync, interval);
  console.log(`[proxmox-sync] Scheduled every ${config.intervalMinutes || 60} min`);
}

async function runProxmoxSync() {
  if (proxmoxSyncCache.running) return; // prevent overlapping runs
  const config = getProxmoxSyncConfig();
  if (!config.enabled || !config.host || !config.token) return;

  proxmoxSyncCache = { ...proxmoxSyncCache, running: true, lastError: null };
  console.log('[proxmox-sync] Starting sync…');

  try {
    // Normalise host / port (same logic as the discover endpoint)
    let host = config.host.replace(/^https?:\/\//i, '').trim().replace(/\/+$/, '');
    let port = 8006;
    const colonIdx = host.lastIndexOf(':');
    if (colonIdx > 0 && !host.includes(']')) {
      const maybePort = parseInt(host.slice(colonIdx + 1));
      if (!isNaN(maybePort)) { port = maybePort; host = host.slice(0, colonIdx); }
    }

    const { entries } = await discoverProxmox(host, port, config.token, !!config.ignoreTLS);
    const ipData = dbGet('ip_data') || [];
    const ipMap  = new Map(ipData.map(e => [e.ip, e]));

    let changesFound = 0;
    const changeLog  = [];

    for (const proxEntry of entries) {
      const existing = ipMap.get(proxEntry.ip);
      // Skip IPs not in the manager, and skip entries not tagged 'proxmox'
      // (we don't want to stomp over user-managed entries just because the IP
      //  happened to be reused by a Proxmox VM at some point)
      if (!existing) continue;
      if (!(existing.tags || []).includes('proxmox')) continue;

      const changes = {};

      // Node change — the primary HA failover signal
      if (proxEntry.location && proxEntry.location !== existing.location) {
        changes.location = { from: existing.location, to: proxEntry.location };
        existing.location = proxEntry.location;
      }
      // Name / asset name change
      if (proxEntry.assetName && proxEntry.assetName !== existing.assetName) {
        changes.assetName = { from: existing.assetName, to: proxEntry.assetName };
        existing.assetName = proxEntry.assetName;
      }
      // Keep dedicated Proxmox fields in sync (VMID shouldn't change, node may on HA failover)
      if (proxEntry.proxmoxNode && proxEntry.proxmoxNode !== existing.proxmoxNode) {
        existing.proxmoxNode = proxEntry.proxmoxNode;
      }
      if (proxEntry.proxmoxKind && !existing.proxmoxKind) {
        existing.proxmoxKind = proxEntry.proxmoxKind;
      }
      if (proxEntry.proxmoxVmid && !existing.proxmoxVmid) {
        existing.proxmoxVmid = proxEntry.proxmoxVmid;
      }

      if (Object.keys(changes).length > 0) {
        existing.updatedAt = new Date().toISOString();
        // Prepend to per-entry change history (same format as manual edits)
        if (!existing.history) existing.history = [];
        existing.history.unshift({ at: existing.updatedAt, by: 'proxmox-sync', changes });
        if (existing.history.length > 20) existing.history = existing.history.slice(0, 20);
        changesFound++;
        changeLog.push({ ip: existing.ip, name: existing.assetName, changes });
      }
    }

    if (changesFound > 0) {
      dbSet('ip_data', ipData);
      console.log(`[proxmox-sync] Updated ${changesFound} entr${changesFound === 1 ? 'y' : 'ies'}`);
    } else {
      console.log('[proxmox-sync] No changes detected');
    }

    const lastRun = new Date().toISOString();
    proxmoxSyncCache = { lastRun, changesFound, changeLog: changeLog.slice(0, 50), running: false, lastError: null };

    // Persist last-run metadata (not the full change log)
    dbSet('proxmox_sync_config', { ...config, lastRun, changesFound });

  } catch (err) {
    console.error('[proxmox-sync] Error:', err.message);
    proxmoxSyncCache = { ...proxmoxSyncCache, running: false, lastError: err.message };
  }
}

// GET /api/proxmox-sync/config
app.get('/api/proxmox-sync/config', requireAuth, (req, res) => {
  const c = getProxmoxSyncConfig();
  res.json({
    host:            c.host            || '',
    token:           c.token           || '',
    ignoreTLS:       c.ignoreTLS       !== false,
    enabled:         c.enabled         === true,
    intervalMinutes: c.intervalMinutes || 60,
    lastRun:         c.lastRun         || null,
    changesFound:    c.changesFound    || 0,
  });
});

// POST /api/proxmox-sync/config — save settings and reschedule
app.post('/api/proxmox-sync/config', requireAuth, (req, res) => {
  const { host, token, ignoreTLS, enabled, intervalMinutes } = req.body || {};
  const current = getProxmoxSyncConfig();
  const updated = {
    ...current,
    host:            (host  || '').trim(),
    token:           (token || '').trim(),
    ignoreTLS:       ignoreTLS !== false,
    enabled:         enabled === true,
    intervalMinutes: Math.max(15, parseInt(intervalMinutes) || 60),
  };
  dbSet('proxmox_sync_config', updated);
  scheduleProxmoxSync(); // apply new schedule immediately
  res.json({ ok: true });
});

// GET /api/proxmox-sync/status — in-memory run state
app.get('/api/proxmox-sync/status', requireAuth, (req, res) => {
  res.json({
    lastRun:      proxmoxSyncCache.lastRun,
    changesFound: proxmoxSyncCache.changesFound,
    changeLog:    proxmoxSyncCache.changeLog,
    running:      proxmoxSyncCache.running,
    lastError:    proxmoxSyncCache.lastError,
  });
});

// POST /api/proxmox-sync/run — manual immediate trigger
app.post('/api/proxmox-sync/run', requireAuth, (req, res) => {
  if (proxmoxSyncCache.running) {
    return res.json({ ok: false, message: 'Sync already in progress' });
  }
  res.json({ ok: true, message: 'Sync started' });
  runProxmoxSync(); // fire and forget — client polls /status for results
});

// Restore schedule on server startup (uses persisted config)
scheduleProxmoxSync();

// ── DNS reverse lookup ────────────────────────────────────────────────────────
// Runs PTR lookups for all tracked IPs.
// Uses Node's built-in dns.Resolver so we can point at a custom server (e.g.
// a Pi-hole or router) without any extra npm dependencies.

const dnsModule = require('dns');

let dnsCache = { results: {}, timestamp: 0, warning: null };
const DNS_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

function getDnsConfig() {
  return dbGet('dns_config') || { server: '', enabled: true, lastRun: null };
}

// Build a Resolver pointed at the configured server; fall back to system resolver.
function makeResolver(server) {
  const resolver = new dnsModule.Resolver();
  if (server && server.trim()) {
    try {
      resolver.setServers([server.trim()]);
    } catch (e) {
      console.warn('[dns] Invalid server address "%s":', server, e.message);
    }
  }
  return resolver;
}

// PTR lookup for one IP — resolves to hostname string or null on any failure.
function ptrLookup(resolver, ip) {
  return new Promise((resolve) => {
    resolver.reverse(ip, (err, names) => {
      if (err || !names || !names[0]) return resolve(null);
      // Strip trailing dot that some resolvers append
      resolve(names[0].replace(/\.$/, ''));
    });
  });
}

async function refreshDnsCache() {
  const config = getDnsConfig();
  if (!config.enabled) return;

  const rows = dbGet('ip_data') || [];
  const ips  = rows.filter(r => r.ip && r.status !== 'free').map(r => r.ip);
  if (!ips.length) return;

  const resolver = makeResolver(config.server);
  const results  = {};

  // Run all lookups concurrently — each one silently returns null on failure
  await Promise.all(
    ips.map(async (ip) => {
      results[ip] = { ptr: await ptrLookup(resolver, ip) };
    })
  );

  // Persist last-run timestamp to config
  const newConfig = { ...config, lastRun: new Date().toISOString() };
  dbSet('dns_config', newConfig);

  dnsCache = { results, timestamp: Date.now(), warning: null };
  console.log(`[dns] Reverse lookup complete for ${ips.length} IPs`);
}

// Background poller — every 24 h; does NOT run immediately at startup
// (DNS is a slow operation; we fetch cached results on first page load instead)
setInterval(refreshDnsCache, DNS_INTERVAL);

// GET /api/dns-config
app.get('/api/dns-config', requireAuth, (req, res) => {
  const config = getDnsConfig();
  res.json({ server: config.server || '', enabled: config.enabled !== false, lastRun: config.lastRun || null });
});

// POST /api/dns-config — update DNS server and enable/disable flag
app.post('/api/dns-config', requireAuth, (req, res) => {
  const { server, enabled } = req.body || {};
  const current = getDnsConfig();
  const updated = { ...current, server: (server || '').trim(), enabled: enabled !== false };
  dbSet('dns_config', updated);
  res.json({ ok: true });
});

// GET /api/dns-status — returns cached results; ?force=1 triggers an immediate refresh
app.get('/api/dns-status', requireAuth, async (req, res) => {
  const forceParam = req.query.force === '1';

  // Always refresh if:
  //  a) caller requested force, or
  //  b) cache is empty (server just started), or
  //  c) ip_data contains IPs that are not in the cache — i.e. a new network or
  //     new entries were added since the last run.  Without this check the
  //     second (and any subsequent) network would never appear in results.
  const trackedIPs = (dbGet('ip_data') || [])
    .filter(r => r.ip && r.status !== 'free')
    .map(r => r.ip);
  const hasUncachedIPs = trackedIPs.some(ip => !(ip in dnsCache.results));

  if (forceParam || !dnsCache.timestamp || hasUncachedIPs) await refreshDnsCache();
  const config = getDnsConfig();
  res.json({
    results:  dnsCache.results,
    warning:  dnsCache.warning,
    cachedAt: dnsCache.timestamp,
    config:   { server: config.server || '', enabled: config.enabled !== false, lastRun: config.lastRun || null },
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = 3001;
const HOST = '127.0.0.1'; // only accessible via Nginx proxy, not directly from outside

app.listen(PORT, HOST, () => {
  console.log(`IP Manager API listening on ${HOST}:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`Auth: username="${credentials.username}"`);
});
