// ============================================================
//  IP Address Manager — SQLite API Server
//  Listens on 127.0.0.1:3001 (proxied by Nginx at /api/)
// ============================================================

const express = require('express');
const Database = require('better-sqlite3');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// ── Credentials ───────────────────────────────────────────────────────────────
// Reads from IP_MANAGER_USERNAME / IP_MANAGER_PASSWORD env vars.
// If not set, falls back to a credentials.env file in the server directory.
// If that doesn't exist either, defaults to admin / admin (with a warning).

function loadCredentials() {
  if (process.env.IP_MANAGER_USERNAME && process.env.IP_MANAGER_PASSWORD) {
    return {
      username: process.env.IP_MANAGER_USERNAME,
      password: process.env.IP_MANAGER_PASSWORD,
    };
  }
  const envFile = path.join(__dirname, 'credentials.env');
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
  console.warn('[auth] No credentials configured — using defaults (admin/admin). Create server/credentials.env to set your own.');
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
  // Write the new credentials to credentials.env
  const envFile = path.join(__dirname, 'credentials.env');
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

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = 3001;
const HOST = '127.0.0.1'; // only accessible via Nginx proxy, not directly from outside

app.listen(PORT, HOST, () => {
  console.log(`IP Manager API listening on ${HOST}:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`Auth: username="${credentials.username}"`);
});
