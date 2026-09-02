// ============================================================
//  API keys
//
//  Named, scoped keys let external clients (the iOS app, Home Assistant,
//  scripts) talk to the API without handling the account password. Each key
//  can be revoked on its own, so losing a phone does not mean rotating every
//  other integration.
// ============================================================

'use strict';

const crypto = require('crypto');
const { dbGet, dbSet } = require('./db');

// ── API keys ──────────────────────────────────────────────────────────────────
// Named, scoped keys let external clients (the iOS app, Home Assistant, scripts)
// talk to the API without handling the account password. Each key can be revoked
// on its own, so losing a phone does not mean rotating every other integration.
//
// Stored as: [{ id, label, key, scope, createdAt, lastUsedAt }]
//   scope 'read'  → GET requests only
//   scope 'write' → all methods (implies read)
//
// Keys are bearer credentials. They grant whatever their scope allows, with no
// expiry, so they are compared in constant time, never accepted as a query
// parameter on writes (query strings are recorded in Nginx access logs), and
// refused outright on the account-management routes listed below.

const API_KEY_SESSION_ONLY = [
  '/auth', '/keys', '/update', '/support', '/backup', '/ha/key',
  // The audit log records failed-login usernames and source addresses, and the
  // notification config could be repointed at a destination of the caller's
  // choosing. Both stay behind a browser session.
  '/audit-log', '/notifications',
];

const getApiKeys = () => dbGet('api_keys') || [];
const setApiKeys = (keys) => dbSet('api_keys', keys);

function generateApiKey() {
  return crypto.randomBytes(24).toString('base64url'); // 192-bit, URL-safe
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function findApiKey(candidate) {
  if (!candidate) return null;
  return getApiKeys().find((k) => safeEqual(k.key, candidate)) || null;
}

// Record last use, but at most once a minute per key — otherwise a 60-second
// Home Assistant poll would mean a database write on every request.
function touchApiKey(id) {
  const keys = getApiKeys();
  const entry = keys.find((k) => k.id === id);
  if (!entry) return;
  const now = Date.now();
  if (entry.lastUsedAt && now - new Date(entry.lastUsedAt).getTime() < 60000) return;
  entry.lastUsedAt = new Date(now).toISOString();
  setApiKeys(keys);
}

// Returns null when no key was presented, otherwise an outcome object.
function checkApiKey(req) {
  const headerKey = req.headers['x-api-key'];
  const queryKey  = req.query.api_key;
  const candidate = headerKey || queryKey;
  if (!candidate) return null;

  const found = findApiKey(candidate);
  if (!found) return { ok: false, status: 401, error: 'Invalid API key',
    message: 'The supplied API key was not recognised. Check it in Settings → API Keys, or create a new one.' };

  const isRead = req.method === 'GET' || req.method === 'HEAD';
  if (!isRead && found.scope !== 'write') {
    return { ok: false, status: 403, error: 'Read-only API key',
      message: `The key "${found.label}" has read-only scope and cannot make changes. Give it read & write scope in Settings → API Keys, or use a different key.` };
  }
  if (!isRead && !headerKey) {
    return { ok: false, status: 400, error: 'Key must be sent as a header',
      message: 'Write requests must send the key in the X-API-Key header rather than an api_key query parameter, because query strings are recorded in access logs.' };
  }
  return { ok: true, key: found };
}

// One-time migration: fold the standalone Home Assistant key (v1.33–v2.0.x)
// into the named key store as a read-scoped key, so existing Home Assistant
// configurations keep working untouched.
(function migrateHaKeyIntoApiKeys() {
  const legacy = dbGet('ha_api_key');
  if (!legacy) return;
  const keys = getApiKeys();
  if (keys.some((k) => k.key === legacy)) return;
  keys.push({
    id: crypto.randomUUID(),
    label: 'Home Assistant',
    key: legacy,
    scope: 'read',
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  });
  setApiKeys(keys);
  console.log('[api-keys] Existing Home Assistant key migrated into the named key store (scope: read).');
})();

module.exports = {
  API_KEY_SESSION_ONLY,
  getApiKeys,
  setApiKeys,
  generateApiKey,
  findApiKey,
  touchApiKey,
  checkApiKey,
};
