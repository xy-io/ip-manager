// ============================================================
//  Database — single key/value store
//
//  Everything the app persists lives in one `store` table as JSON, keyed by
//  name (ip_data, networks, api_keys, audit_log, …). Simple, flexible, and
//  trivially backed up: the whole database is one file.
// ============================================================

'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'ip-manager.db');
const db = new Database(DB_PATH);

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

module.exports = { db, dbGet, dbSet, DB_PATH };
