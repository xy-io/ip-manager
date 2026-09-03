#!/usr/bin/env node
/* ============================================================
 *  Emergency: turn off two-factor authentication
 *
 *  For one situation only — you have lost your authenticator AND your recovery
 *  codes, so you cannot get past the sign-in screen to turn it off in Settings.
 *
 *  Usage, on the server:
 *      sudo node /opt/ip-manager/scripts/disable-totp.cjs
 *      sudo systemctl restart ip-manager-api
 *
 *  Your username, password and all other data are untouched. Only the second
 *  factor is removed, and you will be able to sign in with your password alone.
 *
 *  Anyone who can run this already has root on the server, so it grants no
 *  access they did not already have.
 * ============================================================ */

'use strict';

const path = require('path');
const fs = require('fs');

const APP_DIR = path.resolve(__dirname, '..');
const DB_PATH = process.env.DB_PATH || path.join(APP_DIR, 'server', 'ip-manager.db');

if (!fs.existsSync(DB_PATH)) {
  console.error(`\nCould not find the database at:\n  ${DB_PATH}\n`);
  console.error('If IP Manager is installed somewhere other than /opt/ip-manager, run this');
  console.error('script from inside that directory, or set DB_PATH:\n');
  console.error('  DB_PATH=/path/to/server/ip-manager.db node scripts/disable-totp.cjs\n');
  process.exit(1);
}

let Database;
try {
  Database = require(path.join(APP_DIR, 'server', 'node_modules', 'better-sqlite3'));
} catch {
  try {
    Database = require('better-sqlite3');
  } catch {
    console.error('\nCould not load better-sqlite3. Run this from the installation directory:\n');
    console.error('  cd /opt/ip-manager && node scripts/disable-totp.cjs\n');
    process.exit(1);
  }
}

const db = new Database(DB_PATH);

const row = db.prepare('SELECT value FROM store WHERE key = ?').get('totp_config');
if (!row) {
  console.log('\nTwo-factor authentication is not configured. Nothing to do.\n');
  process.exit(0);
}

let config;
try {
  config = JSON.parse(row.value);
} catch {
  config = null;
}

if (!config || config.enabled !== true) {
  console.log('\nTwo-factor authentication is already off. Nothing to do.\n');
  process.exit(0);
}

// Reset to the same shape lib/twoFactor.js uses for "off", so the app reads it
// back cleanly rather than finding a half-deleted record.
const cleared = {
  enabled: false,
  secret: null,
  pendingSecret: null,
  recoveryCodes: [],
  enabledAt: null,
  lastCounter: null,
};
db.prepare('INSERT OR REPLACE INTO store (key, value) VALUES (?, ?)')
  .run('totp_config', JSON.stringify(cleared));

// Record it in the activity log, so this never happens invisibly.
try {
  const auditRow = db.prepare('SELECT value FROM store WHERE key = ?').get('audit_log');
  const log = auditRow ? JSON.parse(auditRow.value) : [];
  log.unshift({
    id: `cli-${Date.now()}`,
    ts: new Date().toISOString(),
    type: 'auth.totp.disabled',
    message: 'Two-factor authentication disabled from the command line (recovery)',
    meta: { via: 'scripts/disable-totp.cjs' },
    actor: 'system',
    source: null,
  });
  db.prepare('INSERT OR REPLACE INTO store (key, value) VALUES (?, ?)')
    .run('audit_log', JSON.stringify(log.slice(0, 500)));
} catch {
  // The audit entry is a nicety; never let it stop the recovery.
}

db.close();

console.log(`
Two-factor authentication has been disabled.

  Database : ${DB_PATH}

Restart the service so the change takes effect:

  sudo systemctl restart ip-manager-api

You can then sign in with your username and password alone. Your credentials
and all other data are unchanged. Re-enrol from Settings → Security when you
have a working authenticator again.
`);
