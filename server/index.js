// ============================================================
//  IP Address Manager — SQLite API Server
//  Listens on 127.0.0.1:3001 (proxied by Nginx at /api/)
// ============================================================

const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
app.use(express.json({ limit: '2mb' }));

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

// ── Routes ────────────────────────────────────────────────────────────────────

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

// Network config
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

// Import — merge or replace IP data
app.post('/api/import', (req, res) => {
  const { rows, mode } = req.body;
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
    dbSet('ip_data', sortByIp(rows));
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
});
