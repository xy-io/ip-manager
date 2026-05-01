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
// Priority order:
//   1. IP_MANAGER_USERNAME / IP_MANAGER_PASSWORD environment variables
//   2. credentials.env file (path overridable via CREDENTIALS_FILE env var)
//   3a. File exists but is empty/invalid → existing install upgrading from old
//       version — fall back to admin/admin. The lockout middleware (below) will
//       force the user to set a real password through the UI on next login.
//   3b. File does not exist at all → fresh install — generate a unique random
//       password, persist it, and log it to the service journal.

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
    // File exists but has no valid credentials — this is an existing install
    // that was set up before v1.29 (install.sh used to touch an empty file).
    // Return admin/admin so the user can still log in; the lockout middleware
    // will then require them to set a real password through the app UI.
    console.warn('[auth] credentials.env exists but contains no credentials — treating as admin/admin. Login will require a password change.');
    return { username: 'admin', password: 'admin' };
  }
  // File does not exist — genuine first run. Generate a random password,
  // persist it so it survives restarts, and log it once to the journal.
  // Recovery: journalctl -u ip-manager-api | grep -A5 "initial credentials"
  const username = 'admin';
  const password = crypto.randomBytes(12).toString('base64url'); // 16 URL-safe chars, 96 bits
  try {
    fs.writeFileSync(envFile, `IP_MANAGER_USERNAME=${username}\nIP_MANAGER_PASSWORD=${password}\n`, { mode: 0o600 });
  } catch (e) {
    console.error(`[auth] Could not write credentials file (${envFile}): ${e.message}`);
  }
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' IP Manager — initial credentials (change after first login):');
  console.log(`   username : ${username}`);
  console.log(`   password : ${password}`);
  console.log(' Saved to: ' + envFile);
  console.log(' To retrieve later:');
  console.log('   journalctl -u ip-manager-api | grep -A5 "initial credentials"');
  console.log('═══════════════════════════════════════════════════════════════');
  return { username, password };
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

// ── Default-credentials lockout (safety net) ──────────────────────────────────
// If the live credentials are still admin/admin, every API route except
// /api/auth/* returns 423 Locked until the password is changed.
// This catches old installs that haven't yet migrated away from the default.

function isDefaultCreds() {
  return credentials.username === 'admin' && credentials.password === 'admin';
}

function requireNotDefault(req, res, next) {
  if (isDefaultCreds()) {
    return res.status(423).json({
      error: 'default-credentials',
      message: 'Default credentials must be changed before the API is available.',
    });
  }
  next();
}

// ── Auth routes (unprotected) ─────────────────────────────────────────────────

app.post('/api/auth/login', (req, res) => {
  // Reload credentials on each login attempt so changes to credentials.env
  // take effect without restarting the server
  credentials = loadCredentials();
  const { username, password } = req.body || {};
  // Username comparison is case-insensitive; password remains case-sensitive.
  if ((username || '').toLowerCase() === credentials.username.toLowerCase() && password === credentials.password) {
    const token = createSession();
    // httpOnly prevents JS access; sameSite=strict prevents CSRF
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict' });
    return res.json({ ok: true, mustChangePassword: isDefaultCreds() });
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
  const authenticated = isValidSession(req.cookies[SESSION_COOKIE]);
  res.json({ authenticated, mustChangePassword: authenticated && isDefaultCreds() });
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

// Lockout: block all non-/auth/ routes when default credentials are in use.
// /auth/ routes are registered above this point and are unaffected.
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  return requireNotDefault(req, res, next);
});
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

// ── ARP Presence config ───────────────────────────────────────────────────────
// Shared config for both "last seen timestamps" and "background discovery scan".
// Stored in the DB under 'arp_presence_config'; never touched without explicit
// user action in Settings → ARP & Presence.

function getArpPresenceConfig() {
  return dbGet('arp_presence_config') || {
    lastSeenEnabled:           false,
    discoveryEnabled:          false,
    discoveryIntervalMinutes:  null,   // null = subnet-aware auto default
    discoveryBandwidthKbps:    null,   // null = subnet-aware auto default
    discoveryInterface:        '',
    lastDiscoveryRun:          null,
  };
}

// Detect CIDR prefix length from a subnet string like "192.168.1" or "192.168"
function subnetPrefixLen(subnet) {
  if (subnet.includes('/')) return parseInt(subnet.split('/')[1]) || 24;
  const octets = (subnet || '').split('.').filter(Boolean).length;
  if (octets === 2) return 16;
  return 24; // default /24
}

// In-memory last-seen map { [ip]: isoString }
// Persisted to DB under 'last_seen_data'; loaded at startup.
let lastSeenData = (function () { return dbGet('last_seen_data') || {}; })();

// ── Background discovery scan ─────────────────────────────────────────────────
// Scheduled arp-scan sweep scoped to each network's static range.
// Subnet-aware rate limiting: /24 → 15 min / 1000 Kbps; /16 → 60 min / 200 Kbps.
// Both defaults are overridable in settings.

let discoveryState = {
  running:     false,
  lastRun:     null,
  lastResults: [],   // [{ ip, mac, vendor, networkId, tracked, inStaticRange }]
  lastError:   null,
};
let discoveryTimer = null;

function getDiscoveryDefaults(prefixLen) {
  if (prefixLen <= 16) return { intervalMinutes: 60, bandwidthKbps: 200 };
  return { intervalMinutes: 15, bandwidthKbps: 1000 };
}

function buildDiscoveryScanCmd(cidr, iface, bandwidthKbps) {
  const ifaceFlag = iface ? `-I ${shellEsc(iface)} ` : '';
  const bwFlag    = bandwidthKbps ? `--bandwidth=${bandwidthKbps}K ` : '';
  return `arp-scan ${ifaceFlag}${bwFlag}--quiet ${cidr}`;
}

async function runDiscoveryScan() {
  if (discoveryState.running) return;
  const config = getArpPresenceConfig();
  if (!config.discoveryEnabled) return;

  discoveryState = { ...discoveryState, running: true, lastError: null };

  try {
    const networks = dbGet('networks') || [];
    const ipData   = dbGet('ip_data')   || [];
    const inManager = new Set(ipData.map(e => e.ip));
    const allResults = [];

    for (const network of networks) {
      const subnetRaw = network.subnet || '';
      if (!subnetRaw) continue;

      // Normalise subnet to CIDR
      let cidr = subnetRaw;
      if (!cidr.includes('/')) {
        const octets = cidr.split('.').filter(Boolean);
        if (octets.length === 2)      cidr = `${cidr}.0.0/16`;
        else if (octets.length === 3) cidr = `${cidr}.0/24`;
      }

      const prefixLen = subnetPrefixLen(subnetRaw);
      const defaults  = getDiscoveryDefaults(prefixLen);
      const bw        = config.discoveryBandwidthKbps ?? defaults.bandwidthKbps;

      let raw = [];
      try {
        const cmd    = buildDiscoveryScanCmd(cidr, config.discoveryInterface || '', bw);
        const stdout = execSync(cmd, { encoding: 'utf8', timeout: 180000, stdio: ['pipe', 'pipe', 'pipe'] });
        raw = parseArpScanOutput(stdout);
      } catch (err) {
        console.warn(`[discovery] arp-scan failed for ${cidr}:`, err.message);
        continue;
      }

      // Determine static range for this network (last-octet bounds for /24; full range for /16)
      const staticStart = network.dhcpEnabled === false ? 1 : (network.staticStart ?? 1);
      const staticEnd   = network.dhcpEnabled === false ? 254 : (network.staticEnd ?? 254);
      const subnetPrefix = cidr.replace(/\/\d+$/, '').split('.').slice(0, prefixLen / 8).join('.');

      for (const device of raw) {
        const lastOctet = parseInt(device.ip.split('.').pop() || '0', 10);
        const inRange   = device.ip.startsWith(subnetPrefix + '.');
        const inStatic  = inRange && (prefixLen >= 24
          ? (lastOctet >= staticStart && lastOctet <= staticEnd)
          : true);
        allResults.push({
          ...device,
          networkId:     network.id,
          networkName:   network.name || network.subnet,
          tracked:       inManager.has(device.ip),
          inStaticRange: inStatic,
        });
      }
    }

    const lastRun = new Date().toISOString();
    discoveryState = { running: false, lastRun, lastResults: allResults, lastError: null };

    // Persist last-run timestamp
    const updated = getArpPresenceConfig();
    dbSet('arp_presence_config', { ...updated, lastDiscoveryRun: lastRun });
    console.log(`[discovery] Scan complete: ${allResults.length} devices found`);
  } catch (err) {
    discoveryState = { ...discoveryState, running: false, lastError: err.message };
    console.error('[discovery] Error:', err.message);
  }
}

function scheduleDiscoveryScan() {
  if (discoveryTimer) { clearInterval(discoveryTimer); discoveryTimer = null; }
  const config = getArpPresenceConfig();
  if (!config.discoveryEnabled) return;

  // Determine interval: use configured value or subnet-aware default (pick smallest network)
  const networks = dbGet('networks') || [];
  const smallestPrefix = networks.reduce((min, n) => {
    const p = subnetPrefixLen(n.subnet || '');
    return p > min ? p : min; // larger prefix = smaller subnet = more aggressive default
  }, 24);
  const defaults  = getDiscoveryDefaults(smallestPrefix);
  const intervalMs = Math.max(
    15 * 60 * 1000,
    ((config.discoveryIntervalMinutes ?? defaults.intervalMinutes) * 60 * 1000)
  );

  discoveryTimer = setInterval(runDiscoveryScan, intervalMs);
  console.log(`[discovery] Scheduled every ${Math.round(intervalMs / 60000)} min`);
}

// Restore schedule on startup
(function () {
  const config = getArpPresenceConfig();
  if (config.discoveryEnabled) scheduleDiscoveryScan();
})();

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

  // Update last-seen timestamps for every IP that responded — only if enabled
  const presenceConfig = getArpPresenceConfig();
  if (presenceConfig.lastSeenEnabled) {
    const now = new Date().toISOString();
    let changed = false;
    for (const [ip, status] of Object.entries(results)) {
      if (status === 'up') {
        lastSeenData[ip] = now;
        changed = true;
      }
    }
    if (changed) dbSet('last_seen_data', lastSeenData);
  }
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
    lastSeen:  lastSeenData,  // { [ip]: isoString } — populated when lastSeenEnabled
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
// POST /api/update/start  — spawns scripts/update.sh --api-mode
// GET  /api/update/stream — SSE stream of live progress events
// GET  /api/update/result — last persisted result (survives service restart)
//
// The service runs as root inside the LXC container, so no sudo is needed.
// requireAuth is enforced on all endpoints.

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

  // Service runs as root inside the LXC — invoke the update script directly.
  const child = require('child_process').spawn(
    '/usr/bin/bash', [UPDATE_SCRIPT, '--api-mode'],
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
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // tells nginx not to buffer this SSE stream
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

// ── Support bundle ────────────────────────────────────────────────────────────
// GET /api/support/bundle — collects system diagnostics into a downloadable text file.
// Contains NO IP data, hostnames, notes, or credentials — only system/runtime info.

app.get('/api/support/bundle', requireAuth, async (req, res) => {
  const run = (cmd) => new Promise(resolve => {
    exec(cmd, { timeout: 10000 }, (err, stdout, stderr) => {
      resolve((stdout || stderr || err?.message || '(no output)').trim());
    });
  });

  let appVersion = 'unknown';
  let ipCount = 0;
  let networkCount = 0;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    appVersion = pkg.version;
  } catch {}
  try { const d = dbGet('ip_data');       ipCount      = Array.isArray(d) ? d.filter(e => e.assetName !== 'Free' && e.assetName !== 'Reserved').length : 0; } catch {}
  try { const d = dbGet('networks');      networkCount = Array.isArray(d) ? d.length : 0; } catch {}

  const [uname, nodeVer, npmVer, diskInfo, memInfo, svcStatus, svcLogs, updateResult, rcloneVer] = await Promise.all([
    run('uname -a'),
    run('node --version'),
    run('npm --version'),
    run('df -h /opt/ip-manager 2>/dev/null || df -h /'),
    run('free -h'),
    run('systemctl status ip-manager-api --no-pager 2>/dev/null || echo "systemctl not available"'),
    run('journalctl -u ip-manager-api -n 300 --no-pager 2>/dev/null || echo "journalctl not available"'),
    run('cat /opt/ip-manager/server/.update-result.json 2>/dev/null || echo "(no update result on file)"'),
    run('rclone --version 2>/dev/null | head -1 || echo "rclone not installed"'),
  ]);

  const sep = (title) => `\n${'='.repeat(60)}\n  ${title}\n${'='.repeat(60)}\n`;

  const bundle = [
    `IP Address Manager — Support Bundle`,
    `Generated : ${new Date().toISOString()}`,
    `App version: v${appVersion}`,
    `Networks   : ${networkCount}`,
    `Assigned entries: ${ipCount}`,
    sep('SYSTEM'),
    uname,
    sep('RUNTIME'),
    `Node.js : ${nodeVer}`,
    `npm     : ${npmVer}`,
    `rclone  : ${rcloneVer}`,
    sep('DISK SPACE'),
    diskInfo,
    sep('MEMORY'),
    memInfo,
    sep('SERVICE STATUS'),
    svcStatus,
    sep('LAST UPDATE RESULT'),
    updateResult,
    sep('RECENT SERVICE LOGS (last 300 lines)'),
    svcLogs,
  ].join('\n');

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ip-manager-support-${ts}.txt"`);
  res.send(bundle);
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

function getDnsConfigs() {
  const existing = dbGet('dns_configs');
  if (existing && typeof existing === 'object') return existing;
  // Migrate from old single dns_config
  const old = dbGet('dns_config');
  if (old && typeof old === 'object') {
    const migrated = { 'net-1': { server: old.server || '', enabled: old.enabled !== false, lastRun: old.lastRun || null } };
    dbSet('dns_configs', migrated);
    return migrated;
  }
  return {};
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
  const configs  = getDnsConfigs();
  const networks = dbGet('networks') || [];
  const allRows  = dbGet('ip_data')  || [];
  const results  = {};
  const updatedConfigs = { ...configs };

  await Promise.all(
    networks.map(async (network) => {
      const cfg = configs[network.id] || { server: '', enabled: true };
      if (!cfg.enabled) return;
      const ips = allRows
        .filter(r => r.networkId === network.id && r.ip && r.assetName !== 'Free' && r.assetName !== 'Reserved')
        .map(r => r.ip);
      if (!ips.length) return;
      const resolver = makeResolver(cfg.server);
      await Promise.all(ips.map(async (ip) => {
        results[ip] = { ptr: await ptrLookup(resolver, ip) };
      }));
      updatedConfigs[network.id] = { ...cfg, lastRun: new Date().toISOString() };
    })
  );

  dbSet('dns_configs', updatedConfigs);
  dnsCache = { results, timestamp: Date.now(), warning: null };
  console.log(`[dns] Reverse lookup complete for ${Object.keys(results).length} IPs across ${networks.length} network(s)`);
}

// Background poller — every 24 h; does NOT run immediately at startup
// (DNS is a slow operation; we fetch cached results on first page load instead)
setInterval(refreshDnsCache, DNS_INTERVAL);

// GET /api/dns-config — returns per-network config map
app.get('/api/dns-config', requireAuth, (req, res) => {
  res.json({ configs: getDnsConfigs() });
});

// POST /api/dns-config — update one network's DNS config
app.post('/api/dns-config', requireAuth, (req, res) => {
  const { networkId, server, enabled } = req.body || {};
  if (!networkId) return res.status(400).json({ error: 'networkId required' });
  const configs = getDnsConfigs();
  configs[networkId] = { ...(configs[networkId] || {}), server: (server || '').trim(), enabled: enabled !== false };
  dbSet('dns_configs', configs);
  res.json({ ok: true });
});

// GET /api/dns-status
app.get('/api/dns-status', requireAuth, async (req, res) => {
  const forceParam = req.query.force === '1';
  const trackedIPs = (dbGet('ip_data') || [])
    .filter(r => r.ip && r.assetName !== 'Free' && r.assetName !== 'Reserved')
    .map(r => r.ip);
  const hasUncachedIPs = trackedIPs.some(ip => !(ip in dnsCache.results));
  if (forceParam || !dnsCache.timestamp || hasUncachedIPs) await refreshDnsCache();
  res.json({
    results:  dnsCache.results,
    warning:  dnsCache.warning,
    cachedAt: dnsCache.timestamp,
    configs:  getDnsConfigs(),
  });
});

// ── ARP Presence API ──────────────────────────────────────────────────────────
// Settings and status for "Last Seen Timestamps" and "Background Discovery Scan"

// GET /api/arp-presence/config
app.get('/api/arp-presence/config', requireAuth, (req, res) => {
  const config = getArpPresenceConfig();

  // Compute subnet-aware defaults so the frontend can show them as placeholders
  const networks = dbGet('networks') || [];
  const smallestPrefix = networks.reduce((min, n) => {
    const p = subnetPrefixLen(n.subnet || '');
    return p > min ? p : min;
  }, 24);
  const defaults = getDiscoveryDefaults(smallestPrefix);

  res.json({
    lastSeenEnabled:            config.lastSeenEnabled          === true,
    discoveryEnabled:           config.discoveryEnabled         === true,
    discoveryIntervalMinutes:   config.discoveryIntervalMinutes ?? null,
    discoveryBandwidthKbps:     config.discoveryBandwidthKbps   ?? null,
    discoveryInterface:         config.discoveryInterface        || '',
    lastDiscoveryRun:           config.lastDiscoveryRun          || null,
    // Subnet-aware auto-defaults shown in UI as placeholder hints
    defaultIntervalMinutes:     defaults.intervalMinutes,
    defaultBandwidthKbps:       defaults.bandwidthKbps,
    subnetPrefixLen:            smallestPrefix,
  });
});

// POST /api/arp-presence/config — save settings and reschedule
app.post('/api/arp-presence/config', requireAuth, (req, res) => {
  const {
    lastSeenEnabled,
    discoveryEnabled,
    discoveryIntervalMinutes,
    discoveryBandwidthKbps,
    discoveryInterface,
  } = req.body || {};

  const current = getArpPresenceConfig();
  const updated = {
    ...current,
    lastSeenEnabled:           lastSeenEnabled  === true,
    discoveryEnabled:          discoveryEnabled === true,
    discoveryIntervalMinutes:  discoveryIntervalMinutes != null
      ? Math.max(5, parseInt(discoveryIntervalMinutes) || 15)
      : null,
    discoveryBandwidthKbps:    discoveryBandwidthKbps != null
      ? Math.max(50, parseInt(discoveryBandwidthKbps) || 1000)
      : null,
    discoveryInterface: (discoveryInterface || '').trim(),
  };
  dbSet('arp_presence_config', updated);
  scheduleDiscoveryScan(); // apply new schedule immediately
  res.json({ ok: true });
});

// GET /api/arp-presence/status — current discovery state + last seen summary
app.get('/api/arp-presence/status', requireAuth, (req, res) => {
  const config = getArpPresenceConfig();
  res.json({
    lastSeen:       lastSeenData,          // { [ip]: isoString }
    discovery: {
      running:      discoveryState.running,
      lastRun:      discoveryState.lastRun,
      lastResults:  discoveryState.lastResults,
      lastError:    discoveryState.lastError,
    },
    lastSeenEnabled:  config.lastSeenEnabled  === true,
    discoveryEnabled: config.discoveryEnabled === true,
  });
});

// POST /api/arp-presence/scan — manual immediate discovery scan
app.post('/api/arp-presence/scan', requireAuth, (req, res) => {
  if (discoveryState.running) {
    return res.json({ ok: false, message: 'Scan already in progress' });
  }
  res.json({ ok: true, message: 'Scan started' });
  runDiscoveryScan(); // fire and forget — client polls /status for results
});

// POST /api/arp-presence/clear-last-seen — clears stored lastSeen data
app.post('/api/arp-presence/clear-last-seen', requireAuth, (req, res) => {
  lastSeenData = {};
  dbSet('last_seen_data', {});
  res.json({ ok: true });
});

// ── Subnet Blocks (Planned Blocks for Subnet Visualiser) ─────────────────────
// Stored in settings table as JSON under key `subnet_blocks_{networkId}`

// GET /api/subnet-blocks?network=net-1
app.get('/api/subnet-blocks', requireAuth, (req, res) => {
  const { network } = req.query;
  if (!network) return res.status(400).json({ error: 'network param required' });
  const key = `subnet_blocks_${network}`;
  const blocks = dbGet(key) || [];
  res.json({ networkId: network, blocks });
});

// POST /api/subnet-blocks — save blocks for a network
app.post('/api/subnet-blocks', requireAuth, (req, res) => {
  const { networkId, blocks } = req.body;
  if (!networkId) return res.status(400).json({ error: 'networkId required' });
  const key = `subnet_blocks_${networkId}`;
  dbSet(key, Array.isArray(blocks) ? blocks : []);
  res.json({ ok: true });
});

// ── MAC Vendor Lookup ─────────────────────────────────────────────────────────
// Uses the bundled oui-data npm package (IEEE OUI database, ~4 MB JSON).
// Loaded once on first request and cached in memory.

let ouiDb = null;
function getOuiDb() {
  if (!ouiDb) {
    try {
      ouiDb = require('oui-data');
    } catch (e) {
      console.warn('[oui] oui-data not available:', e.message);
      ouiDb = {};
    }
  }
  return ouiDb;
}

function lookupVendor(mac) {
  if (!mac) return null;
  // Normalise: strip separators, uppercase, take first 6 hex chars
  const prefix = mac.replace(/[^0-9a-fA-F]/g, '').toUpperCase().substring(0, 6);
  if (prefix.length < 6) return null;
  const db = getOuiDb();
  const entry = db[prefix];
  if (!entry) return null;
  // oui-data values are multi-line; first line is the vendor name
  return entry.split('\n')[0].trim() || null;
}

// GET /api/mac/vendor?mac=XX:XX:XX:XX:XX:XX
app.get('/api/mac/vendor', requireAuth, (req, res) => {
  const { mac } = req.query;
  if (!mac) return res.status(400).json({ error: 'mac query param required' });
  const vendor = lookupVendor(mac);
  res.json({ mac, vendor: vendor || null });
});

// ── Cloud Backup ──────────────────────────────────────────────────────────────
// Uses rclone for cloud storage (S3-compatible, SFTP, Dropbox, Google Drive).
// rclone config is stored at server/rclone.conf (owned by www-data, mode 600).
// Scheduling is handled in-process with setTimeout (no system cron needed).

const RCLONE_CONF = path.join(__dirname, 'rclone.conf');

function getBackupConfig() {
  return dbGet('backup_config') || {
    enabled:     false,
    schedule:    'daily',   // 'daily' | 'weekly' | 'manual'
    time:        '02:00',
    dayOfWeek:   0,         // 0=Sunday … 6=Saturday (weekly only)
    remoteName:  '',
    remotePath:  'ip-manager-backups/',
    retention:   7,
    lastRun:     null,
    lastStatus:  null,      // 'ok' | 'error'
    lastError:   null,
  };
}

function isRcloneAvailable() {
  try { require('child_process').execSync('which rclone', { timeout: 3000 }); return true; }
  catch { return false; }
}

// Build the backup payload (same schema as the manual browser backup)
function buildBackupPayload() {
  return JSON.stringify({
    version:    '1.8',
    exportedAt: new Date().toISOString(),
    networks:   dbGet('networks')  || [],
    ipData:     dbGet('ip_data')   || [],
  }, null, 2);
}

let backupTimer   = null;
let backupRunning = false;

// Delete files in a remote path that exceed the retention count.
// File names embed a sortable timestamp so lexicographic order = age order.
async function pruneOldBackups(remoteName, remotePath) {
  const retention = getBackupConfig().retention;
  if (!retention || retention <= 0) return;
  return new Promise((resolve) => {
    execFile('rclone', ['--config', RCLONE_CONF, 'lsf', `${remoteName}:${remotePath}`],
      { timeout: 20000 }, (err, stdout) => {
        if (err) return resolve();
        const files = stdout.trim().split('\n')
          .map(f => f.trim())
          .filter(f => f.startsWith('ip-manager-backup-') && f.endsWith('.json'))
          .sort(); // lexicographic = chronological for our filename format
        if (files.length <= retention) return resolve();
        const toDelete = files.slice(0, files.length - retention);
        let pending = toDelete.length;
        if (!pending) return resolve();
        toDelete.forEach(file => {
          execFile('rclone', ['--config', RCLONE_CONF, 'deletefile', `${remoteName}:${remotePath}${file}`],
            { timeout: 15000 }, () => { if (--pending === 0) resolve(); });
        });
      });
  });
}

async function runBackup() {
  if (backupRunning) return { ok: false, message: 'Backup already running' };
  const config = getBackupConfig();
  if (!config.remoteName) return { ok: false, message: 'No remote configured' };
  if (!isRcloneAvailable()) return { ok: false, message: 'rclone not installed' };

  backupRunning = true;
  const ts      = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const fname   = `ip-manager-backup-${ts}.json`;
  const tmpFile = `/tmp/${fname}`;
  const remotePath = config.remotePath.endsWith('/') ? config.remotePath : config.remotePath + '/';

  try {
    fs.writeFileSync(tmpFile, buildBackupPayload());

    await new Promise((resolve, reject) => {
      execFile('rclone', ['--config', RCLONE_CONF, 'copy', tmpFile,
        `${config.remoteName}:${remotePath}`, '--log-level', 'ERROR'],
        { timeout: 60000 }, (err, _out, stderr) => {
          err ? reject(new Error((stderr || err.message).trim())) : resolve();
        });
    });

    await pruneOldBackups(config.remoteName, remotePath);

    const now     = new Date().toISOString();
    const updated = { ...config, lastRun: now, lastStatus: 'ok', lastError: null };
    dbSet('backup_config', updated);
    console.log(`[backup] Uploaded ${fname} → ${config.remoteName}:${remotePath}`);
    return { ok: true };
  } catch (err) {
    const now     = new Date().toISOString();
    const updated = { ...config, lastRun: now, lastStatus: 'error', lastError: err.message };
    dbSet('backup_config', updated);
    console.error('[backup] Failed:', err.message);
    return { ok: false, message: err.message };
  } finally {
    backupRunning = false;
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

function scheduleBackup() {
  if (backupTimer) { clearTimeout(backupTimer); backupTimer = null; }
  const config = getBackupConfig();
  if (!config.enabled || !config.remoteName || config.schedule === 'manual') return;

  const now  = new Date();
  const [h, m] = (config.time || '02:00').split(':').map(Number);
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  if (config.schedule === 'weekly') {
    const target = config.dayOfWeek ?? 0;
    while (next.getDay() !== target) next.setDate(next.getDate() + 1);
  }

  const delay = next - now;
  console.log(`[backup] Next run: ${next.toISOString()} (in ${Math.round(delay / 60000)} min)`);
  backupTimer = setTimeout(async () => {
    await runBackup();
    scheduleBackup(); // reschedule for next run
  }, delay);
}

// GET /api/backup/config
app.get('/api/backup/config', requireAuth, (req, res) => {
  const c = getBackupConfig();
  res.json({ ...c, rcloneAvailable: isRcloneAvailable(), rcloneConfExists: fs.existsSync(RCLONE_CONF) });
});

// POST /api/backup/config — save and reschedule
app.post('/api/backup/config', requireAuth, (req, res) => {
  const { enabled, schedule, time, dayOfWeek, remoteName, remotePath, retention } = req.body || {};
  const updated = {
    ...getBackupConfig(),
    enabled:    enabled === true,
    schedule:   ['daily', 'weekly', 'manual'].includes(schedule) ? schedule : 'daily',
    time:       /^\d{1,2}:\d{2}$/.test(time) ? time : '02:00',
    dayOfWeek:  Math.min(6, Math.max(0, parseInt(dayOfWeek) || 0)),
    remoteName: (remoteName || '').trim(),
    remotePath: (remotePath || 'ip-manager-backups/').trim(),
    retention:  Math.max(0, parseInt(retention) || 7),
  };
  dbSet('backup_config', updated);
  scheduleBackup();
  res.json({ ok: true });
});

// GET /api/backup/status
app.get('/api/backup/status', requireAuth, (req, res) => {
  const c = getBackupConfig();
  res.json({ running: backupRunning, lastRun: c.lastRun, lastStatus: c.lastStatus, lastError: c.lastError });
});

// POST /api/backup/run — manual trigger (fire-and-forget; poll /status)
app.post('/api/backup/run', requireAuth, (req, res) => {
  if (backupRunning) return res.json({ ok: false, message: 'Backup already running' });
  res.json({ ok: true, message: 'Backup started' });
  runBackup();
});

// GET /api/backup/remotes — list rclone remotes from rclone.conf
app.get('/api/backup/remotes', requireAuth, (req, res) => {
  if (!fs.existsSync(RCLONE_CONF)) return res.json({ remotes: [] });
  execFile('rclone', ['--config', RCLONE_CONF, 'listremotes'], { timeout: 8000 }, (err, stdout) => {
    if (err) return res.json({ remotes: [] });
    const remotes = stdout.trim().split('\n').filter(r => r.endsWith(':')).map(r => r.slice(0, -1));
    res.json({ remotes });
  });
});

// POST /api/backup/configure-remote — write rclone config section for GUI-configurable providers
app.post('/api/backup/configure-remote', requireAuth, (req, res) => {
  const { provider, name, config: cfg } = req.body || {};
  if (!name || !provider) return res.status(400).json({ error: 'name and provider required' });

  const remoteName = name.replace(/[^a-zA-Z0-9_-]/g, '-');
  let lines = [];

  if (provider === 's3') {
    const { accessKey, secretKey, endpoint, region, s3Provider } = cfg || {};
    lines = [
      `[${remoteName}]`, `type = s3`,
      `provider = ${s3Provider || 'Other'}`,
      `access_key_id = ${(accessKey || '').trim()}`,
      `secret_access_key = ${(secretKey || '').trim()}`,
    ];
    if (endpoint && endpoint.trim()) lines.push(`endpoint = ${endpoint.trim()}`);
    if (region  && region.trim())   lines.push(`region = ${region.trim()}`);
  } else if (provider === 'sftp') {
    const { host, port, user, password } = cfg || {};
    // Obscure the password using rclone's own tool (XOR-based, reversible)
    let obscuredPass = '';
    if (password) {
      try {
        obscuredPass = require('child_process')
          .execSync(`rclone obscure ${JSON.stringify(password)}`, { timeout: 5000 })
          .toString().trim();
      } catch { obscuredPass = password; }
    }
    lines = [
      `[${remoteName}]`, `type = sftp`,
      `host = ${(host || '').trim()}`,
      `port = ${parseInt(port) || 22}`,
      `user = ${(user || '').trim()}`,
    ];
    if (obscuredPass) lines.push(`pass = ${obscuredPass}`);
  } else if (provider === 'local') {
    const { localPath } = cfg || {};
    lines = [`[${remoteName}]`, `type = alias`, `remote = ${(localPath || '/mnt/backup').trim()}`];
  } else if (provider === 'dropbox' || provider === 'gdrive') {
    // OAuth providers: token pasted in by the user
    const { token } = cfg || {};
    if (!token) return res.status(400).json({ error: 'token required for OAuth providers' });
    const rcloneType = provider === 'gdrive' ? 'drive' : 'dropbox';
    lines = [`[${remoteName}]`, `type = ${rcloneType}`, `token = ${token.trim()}`];
    if (provider === 'gdrive') lines.push('scope = drive.file');
  } else {
    return res.status(400).json({ error: `Unknown provider: ${provider}` });
  }

  // Merge into existing config file — replace any section with the same name
  let existing = fs.existsSync(RCLONE_CONF) ? fs.readFileSync(RCLONE_CONF, 'utf8') : '';
  // Strip the old section (everything from [remoteName] to the next [ or EOF)
  existing = existing.replace(new RegExp(`\\[${remoteName}\\][^\\[]*`, 'g'), '').trim();
  const newConf = (existing ? existing + '\n\n' : '') + lines.join('\n') + '\n';
  fs.writeFileSync(RCLONE_CONF, newConf, { mode: 0o600 });

  res.json({ ok: true, remoteName });
});

// POST /api/backup/test — verify rclone can reach the configured remote
app.post('/api/backup/test', requireAuth, (req, res) => {
  const { remoteName, remotePath } = req.body || {};
  if (!remoteName) return res.status(400).json({ error: 'remoteName required' });
  if (!fs.existsSync(RCLONE_CONF)) return res.status(400).json({ error: 'No rclone config found — add a remote first' });
  const dest = `${remoteName}:${(remotePath || '').trim()}`;
  execFile('rclone', ['--config', RCLONE_CONF, 'lsd', dest, '--max-depth', '1'],
    { timeout: 20000 }, (err, _out, stderr) => {
      if (err) return res.json({ ok: false, error: (stderr || err.message).trim() });
      res.json({ ok: true });
    });
});

// Restore backup schedule on server startup
scheduleBackup();

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = 3001;
const HOST = '127.0.0.1'; // only accessible via Nginx proxy, not directly from outside

app.listen(PORT, HOST, () => {
  console.log(`IP Manager API listening on ${HOST}:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`Auth: username="${credentials.username}"`);
});
