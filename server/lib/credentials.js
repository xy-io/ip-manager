// ============================================================
//  Credentials
//
//  Loading, the bcrypt migration, and the live credential pair. The pair is
//  mutable (a password change replaces it) so it is held here and reached
//  through getCredentials/setCredentials rather than exported directly —
//  exporting the value itself would hand callers a stale copy.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 12; // cost factor — ~300ms per hash on modest hardware

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
// NOTE: '..' because this module lives in server/lib/ — the file itself must
// stay at server/credentials.env, which is what install.sh, update.sh and the
// documentation all reference.
const CREDENTIALS_FILE = process.env.CREDENTIALS_FILE || path.join(__dirname, '..', 'credentials.env');

function loadCredentials() {
  // ── 1. Environment variable override (highest priority) ──────────────────────
  if (process.env.IP_MANAGER_USERNAME && process.env.IP_MANAGER_PASSWORD) {
    return {
      username: process.env.IP_MANAGER_USERNAME,
      password: process.env.IP_MANAGER_PASSWORD,
    };
  }

  const envFile = CREDENTIALS_FILE;

  // ── 2. credentials.env exists ─────────────────────────────────────────────────
  if (fs.existsSync(envFile)) {
    const lines = fs.readFileSync(envFile, 'utf8').split('\n');
    const env = {};
    lines.forEach(line => {
      if (line.startsWith('#')) return; // skip comment lines
      const [k, ...rest] = line.split('=');
      if (k && rest.length) env[k.trim()] = rest.join('=').trim();
    });

    if (env.IP_MANAGER_USERNAME && env.IP_MANAGER_PASSWORD) {
      const username = env.IP_MANAGER_USERNAME;
      const storedPassword = env.IP_MANAGER_PASSWORD;

      // ── Bcrypt migration (v2.0.0+) ──────────────────────────────────────────
      // If the password is plaintext (not a bcrypt hash), hash it now and
      // rewrite the file. Runs once per install on first start after upgrade.
      // The user logs in with the same password — nothing changes for them.
      if (!storedPassword.startsWith('$2')) {
        console.log('[auth] Migrating plaintext password to bcrypt hash (one-time upgrade to v2.0.0)…');
        const hashed = bcrypt.hashSync(storedPassword, BCRYPT_ROUNDS);
        const content = `# IP Manager credentials — password is bcrypt-hashed (v2.0.0+)\nIP_MANAGER_USERNAME=${username}\nIP_MANAGER_PASSWORD=${hashed}\n`;
        try {
          fs.writeFileSync(envFile, content, { mode: 0o600 });
          console.log('[auth] Password hashed and saved successfully.');
        } catch (e) {
          console.error(`[auth] Could not write hashed credentials (${envFile}): ${e.message}`);
        }
        return { username, password: hashed };
      }

      // ── Double-hash recovery (v2.0.1) ────────────────────────────────────────
      // A bug in v2.0.0 caused bcryptjs's $2a$ hashes to be mistaken for
      // plaintext and re-hashed on every login attempt, producing a hash-of-hash
      // that no real password can ever match. Detect this by checking whether the
      // stored hash is itself a bcrypt hash of another bcrypt hash — i.e. the
      // 60-char $2... value starts with the prefix bcrypt uses for its own output.
      // We can't reverse a hash-of-hash, so generate a fresh password and log it.
      if (bcrypt.getRounds(storedPassword) && bcrypt.compareSync(storedPassword.substring(0, 72), storedPassword)) {
        // The stored "hash" successfully verifies against the first 72 chars of
        // itself — a hallmark of a hash-of-hash. Generate fresh credentials.
        console.error('[auth] WARNING: double-hashed password detected (v2.0.0 bug). Generating new credentials…');
        const newPlain = crypto.randomBytes(12).toString('base64url');
        const newHash  = bcrypt.hashSync(newPlain, BCRYPT_ROUNDS);
        const content  = `# IP Manager credentials — password is bcrypt-hashed (v2.0.0+)\nIP_MANAGER_USERNAME=${username}\nIP_MANAGER_PASSWORD=${newHash}\n`;
        try { fs.writeFileSync(envFile, content, { mode: 0o600 }); } catch (e) { /* best effort */ }
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(' IP Manager — NEW credentials generated (v2.0.0 double-hash recovery)');
        console.log(`   username : ${username}`);
        console.log(`   password : ${newPlain}`);
        console.log(' Log in with these credentials, then change your password in Settings.');
        console.log(' To retrieve later:');
        console.log('   journalctl -u ip-manager-api | grep -A5 "double-hash recovery"');
        console.log('═══════════════════════════════════════════════════════════════');
        return { username, password: newHash };
      }

      return { username, password: storedPassword };
    }

    // File exists but contains no valid credentials — pre-v1.29 install that
    // had an empty file created by install.sh. Fall back to admin/admin so the
    // lockout middleware can prompt the user to set a real password.
    console.warn('[auth] credentials.env exists but contains no credentials — treating as admin/admin. Login will require a password change.');
    return { username: 'admin', password: 'admin' };
  }

  // ── 3. No file — genuine first run ───────────────────────────────────────────
  // Generate a unique random password, hash it before writing to disk, and
  // log the plaintext once to the journal for the user to retrieve.
  // Recovery: journalctl -u ip-manager-api | grep -A5 "initial credentials"
  const username = 'admin';
  const plainPassword = crypto.randomBytes(12).toString('base64url'); // 96-bit, URL-safe
  const hashedPassword = bcrypt.hashSync(plainPassword, BCRYPT_ROUNDS);
  try {
    const content = `# IP Manager credentials — password is bcrypt-hashed (v2.0.0+)\nIP_MANAGER_USERNAME=${username}\nIP_MANAGER_PASSWORD=${hashedPassword}\n`;
    fs.writeFileSync(envFile, content, { mode: 0o600 });
  } catch (e) {
    console.error(`[auth] Could not write credentials file (${envFile}): ${e.message}`);
  }
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' IP Manager — initial credentials (change after first login):');
  console.log(`   username : ${username}`);
  console.log(`   password : ${plainPassword}`);
  console.log(' Saved to: ' + envFile + ' (password stored as bcrypt hash)');
  console.log(' To retrieve later:');
  console.log('   journalctl -u ip-manager-api | grep -A5 "initial credentials"');
  console.log('═══════════════════════════════════════════════════════════════');
  return { username, password: hashedPassword };
}

let credentials = loadCredentials();

const getCredentials = () => credentials;
const setCredentials = (next) => { credentials = next; };
const reloadCredentials = () => { credentials = loadCredentials(); return credentials; };

// Handles both plaintext 'admin' (pre-v2.0 fallback path) and a bcrypt hash of 'admin'
function isDefaultCreds() {
  if (credentials.username !== 'admin') return false;
  if (credentials.password === 'admin') return true;
  if (credentials.password.startsWith('$2')) return bcrypt.compareSync('admin', credentials.password);
  return false;
}

module.exports = {
  BCRYPT_ROUNDS,
  CREDENTIALS_FILE,
  loadCredentials,
  reloadCredentials,
  getCredentials,
  setCredentials,
  isDefaultCreds,
};
