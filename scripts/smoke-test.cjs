#!/usr/bin/env node
/* ============================================================
 *  IP Address Manager — smoke tests
 *
 *  Verifies a running install end-to-end: authentication, every
 *  API route's status code and response shape, the status caches,
 *  the Home Assistant API, and a set of known security regressions.
 *
 *  Almost entirely read-only. The API-key section (group 4b) creates two
 *  temporary keys and one temporary entry at 203.0.113.253 (TEST-NET-3, never
 *  a real device) and deletes all three afterwards. Pass --read-only to skip
 *  that group entirely and touch nothing at all.
 *
 *  Usage:
 *    SMOKE_USER=Jay SMOKE_PASS='...' node scripts/smoke-test.js
 *
 *  Options:
 *    --url <base>   Base URL          (default http://127.0.0.1:3001)
 *    --build        Also run `npm run build` and fail on error
 *    --read-only    Skip the write tests (group 4b)
 *    --verbose      Print response bodies for failures
 *
 *  Environment:
 *    SMOKE_USER     Username                        (required)
 *    SMOKE_PASS     Password                        (required)
 *    SMOKE_HA_KEY   Home Assistant API key          (optional —
 *                   read from /api/ha/key using the
 *                   session if not supplied)
 *
 *  Exit code 0 = all passed, 1 = one or more failures.
 * ============================================================ */

'use strict';

const { execSync } = require('child_process');
const path = require('path');

// ── Arguments and environment ────────────────────────────────────────────────
const argv    = process.argv.slice(2);
const flag    = (name) => argv.includes(name);
const opt     = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const BASE     = (opt('--url', process.env.BASE_URL || 'http://127.0.0.1:3001')).replace(/\/$/, '');
const USER     = process.env.SMOKE_USER;
const PASS     = process.env.SMOKE_PASS;
let   HA_KEY   = process.env.SMOKE_HA_KEY || null;
let   haKeySource = HA_KEY ? 'SMOKE_HA_KEY' : null;
const VERBOSE   = flag('--verbose');
const DO_BUILD  = flag('--build');
const READ_ONLY = flag('--read-only');

if (!USER || !PASS) {
  console.error('SMOKE_USER and SMOKE_PASS must be set.\n');
  console.error("  SMOKE_USER=Jay SMOKE_PASS='yourpassword' node scripts/smoke-test.js");
  process.exit(1);
}

// ── Output helpers ───────────────────────────────────────────────────────────
const useColour = process.stdout.isTTY;
const c = {
  green: (s) => useColour ? `\x1b[32m${s}\x1b[0m` : s,
  red:   (s) => useColour ? `\x1b[31m${s}\x1b[0m` : s,
  amber: (s) => useColour ? `\x1b[33m${s}\x1b[0m` : s,
  dim:   (s) => useColour ? `\x1b[2m${s}\x1b[0m`  : s,
  bold:  (s) => useColour ? `\x1b[1m${s}\x1b[0m`  : s,
};

const results = { pass: 0, fail: 0, skip: 0, failures: [] };
let currentGroup = '';

function group(name) {
  currentGroup = name;
  console.log(`\n${c.bold(name)}`);
}

function pass(name) {
  results.pass++;
  console.log(`  ${c.green('PASS')}  ${name}`);
}

function fail(name, detail) {
  results.fail++;
  results.failures.push({ group: currentGroup, name, detail });
  console.log(`  ${c.red('FAIL')}  ${name}`);
  if (detail) console.log(`        ${c.dim(detail)}`);
}

function skip(name, why) {
  results.skip++;
  console.log(`  ${c.amber('SKIP')}  ${name} ${c.dim(`(${why})`)}`);
}

/** Run a single assertion. `fn` returns true, or a string describing the failure. */
async function test(name, fn) {
  try {
    const outcome = await fn();
    if (outcome === true || outcome === undefined) return pass(name);
    fail(name, typeof outcome === 'string' ? outcome : 'assertion returned false');
  } catch (err) {
    fail(name, err && err.message ? err.message : String(err));
  }
}

// ── HTTP helper with a one-cookie jar ────────────────────────────────────────
let sessionCookie = null;

async function req(method, urlPath, { body, headers = {}, useSession = true } = {}) {
  const url = `${BASE}${urlPath}`;
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (useSession && sessionCookie) h['Cookie'] = sessionCookie;

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
  } catch (err) {
    throw new Error(`request failed (${method} ${urlPath}): ${err.message}`);
  }

  const setCookie = res.headers.get('set-cookie');
  if (setCookie && setCookie.includes('ip-manager-session=')) {
    sessionCookie = setCookie.split(';')[0];
  }

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON — fine */ }

  return { status: res.status, json, text, headers: res.headers };
}

const GET  = (p, o) => req('GET',  p, o);
const POST = (p, b, o) => req('POST', p, { ...o, body: b });

// ── Assertion helpers ────────────────────────────────────────────────────────
function expectStatus(res, expected, label) {
  const list = Array.isArray(expected) ? expected : [expected];
  if (list.includes(res.status)) return true;
  const body = VERBOSE && res.text ? ` — body: ${res.text.slice(0, 200)}` : '';
  return `${label}: expected HTTP ${list.join(' or ')}, got ${res.status}${body}`;
}

function expectKeys(obj, keys, label) {
  if (obj === null || typeof obj !== 'object') return `${label}: expected an object, got ${obj === null ? 'null' : typeof obj}`;
  const missing = keys.filter((k) => !(k in obj));
  return missing.length ? `${label}: missing key(s) ${missing.join(', ')}` : true;
}

// ── 1. Reachability and authentication ───────────────────────────────────────
async function testAuth() {
  group('1. Reachability and authentication');

  await test('server is reachable', async () => {
    const res = await GET('/api/auth/status', { useSession: false });
    return expectStatus(res, 200, 'GET /api/auth/status');
  });

  await test('unauthenticated status reports authenticated:false', async () => {
    const res = await GET('/api/auth/status', { useSession: false });
    if (res.status !== 200) return `expected HTTP 200, got ${res.status}`;
    if (res.json?.authenticated !== false) return `expected authenticated:false, got ${JSON.stringify(res.json)}`;
    return true;
  });

  await test('protected route rejects an unauthenticated request', async () => {
    const res = await GET('/api/ips', { useSession: false });
    return expectStatus(res, 401, 'GET /api/ips without session');
  });

  await test('login rejects a wrong password', async () => {
    const res = await POST('/api/auth/login', { username: USER, password: 'definitely-not-the-password' }, { useSession: false });
    return expectStatus(res, 401, 'POST /api/auth/login with bad password');
  });

  await test('login rejects an unknown username', async () => {
    const res = await POST('/api/auth/login', { username: 'no-such-user', password: PASS }, { useSession: false });
    return expectStatus(res, 401, 'POST /api/auth/login with bad username');
  });

  await test('login succeeds with correct credentials', async () => {
    const res = await POST('/api/auth/login', { username: USER, password: PASS }, { useSession: false });
    if (res.status !== 200) return `expected HTTP 200, got ${res.status} — check SMOKE_USER / SMOKE_PASS`;
    if (res.json?.ok !== true) return `expected { ok: true }, got ${JSON.stringify(res.json)}`;
    return true;
  });

  await test('login issued a session cookie', () => {
    if (!sessionCookie) return 'no ip-manager-session cookie was set by login';
    return true;
  });

  await test('username comparison is case-insensitive', async () => {
    const saved = sessionCookie;
    const res = await POST('/api/auth/login', { username: USER.toUpperCase(), password: PASS }, { useSession: false });
    sessionCookie = saved; // keep the original session for the rest of the run
    return expectStatus(res, 200, 'login with uppercased username');
  });
}

// ── 2. Protected endpoints ───────────────────────────────────────────────────
// `dataIsArray` means the route returns { data: [...] } where data may be null
// until the first save — the client falls back to defaults in that case.
const PROTECTED_ROUTES = [
  { path: '/api/health',               keys: null },
  { path: '/api/ips',                  keys: ['data'], dataIsArray: true },
  { path: '/api/config',               keys: ['data'] },
  { path: '/api/networks',             keys: ['data'], dataIsArray: true },
  { path: '/api/domains',              keys: null },
  { path: '/api/dns-config',           keys: null },
  { path: '/api/arp-presence/config',  keys: null },
  { path: '/api/arp-presence/status',  keys: null },
  { path: '/api/backup/config',        keys: null },
  { path: '/api/backup/status',        keys: null },
  { path: '/api/proxmox-sync/config',  keys: null },
  { path: '/api/proxmox-sync/status',  keys: ['lastRun', 'changesFound', 'running'] },
  { path: '/api/ha/key',               keys: ['enabled'] },
  { path: '/api/update/result',        keys: null },
];

async function testProtectedRoutes() {
  group('2. Protected endpoints respond correctly');

  for (const route of PROTECTED_ROUTES) {
    await test(`GET ${route.path}`, async () => {
      const res = await GET(route.path);
      const statusCheck = expectStatus(res, 200, `GET ${route.path}`);
      if (statusCheck !== true) return statusCheck;
      if (route.keys) {
        const keyCheck = expectKeys(res.json, route.keys, route.path);
        if (keyCheck !== true) return keyCheck;
      }
      if (route.dataIsArray && res.json.data !== null && !Array.isArray(res.json.data)) {
        return `expected data to be an array or null, got ${typeof res.json.data}`;
      }
      return true;
    });
  }

  // /api/subnet-blocks is per-network and requires a ?network= parameter.
  await test('GET /api/subnet-blocks rejects a missing network parameter', async () => {
    const res = await GET('/api/subnet-blocks');
    return expectStatus(res, 400, 'GET /api/subnet-blocks without ?network=');
  });

  await test('GET /api/subnet-blocks returns blocks for a real network', async () => {
    const networks = await GET('/api/networks');
    const list = networks.json?.data;
    if (!Array.isArray(list) || !list.length) return true; // no networks configured yet
    const id = list[0].id ?? list[0].networkId;
    if (!id) return 'could not determine a network id from /api/networks';
    const res = await GET(`/api/subnet-blocks?network=${encodeURIComponent(id)}`);
    const statusCheck = expectStatus(res, 200, `GET /api/subnet-blocks?network=${id}`);
    if (statusCheck !== true) return statusCheck;
    const keyCheck = expectKeys(res.json, ['networkId', 'blocks'], '/api/subnet-blocks');
    if (keyCheck !== true) return keyCheck;
    return Array.isArray(res.json.blocks) ? true : 'blocks is not an array';
  });
}

// ── 3. Status caches and value domains ───────────────────────────────────────
let pingResults = null;

async function testStatusCaches() {
  group('3. Status caches');

  await test('GET /api/ping-status returns a results map', async () => {
    const res = await GET('/api/ping-status');
    const statusCheck = expectStatus(res, 200, 'GET /api/ping-status');
    if (statusCheck !== true) return statusCheck;
    const keyCheck = expectKeys(res.json, ['results', 'cachedAt'], '/api/ping-status');
    if (keyCheck !== true) return keyCheck;
    pingResults = res.json.results || {};
    return true;
  });

  await test("ping values are only 'up' or 'down'", () => {
    if (!pingResults) return 'ping-status did not return results';
    const values = [...new Set(Object.values(pingResults))];
    if (!values.length) return true; // cache not yet warm — not a failure
    const unexpected = values.filter((v) => v !== 'up' && v !== 'down');
    return unexpected.length ? `unexpected ping value(s): ${unexpected.join(', ')}` : true;
  });

  await test('GET /api/service-health returns a results map', async () => {
    const res = await GET('/api/service-health');
    const statusCheck = expectStatus(res, 200, 'GET /api/service-health');
    if (statusCheck !== true) return statusCheck;
    return expectKeys(res.json, ['results', 'cachedAt'], '/api/service-health');
  });
}

// ── 4. Home Assistant API ────────────────────────────────────────────────────
async function testHomeAssistant() {
  group('4. Home Assistant API');

  // Prefer the key the server is actually storing. A stale SMOKE_HA_KEY would
  // otherwise fail every HA test for a reason that has nothing to do with the
  // endpoints themselves.
  const stored = await GET('/api/ha/key');
  const storedKey = stored.status === 200 && stored.json?.enabled ? stored.json.key : null;

  if (storedKey && HA_KEY && storedKey !== HA_KEY) {
    console.log(`  ${c.amber('NOTE')}  SMOKE_HA_KEY does not match the key stored on the server — using the stored key`);
    HA_KEY = storedKey;
    haKeySource = '/api/ha/key';
  } else if (!HA_KEY && storedKey) {
    HA_KEY = storedKey;
    haKeySource = '/api/ha/key';
  }

  if (!HA_KEY) {
    skip('all Home Assistant tests', 'no key set in Settings → Home Assistant');
    return;
  }

  console.log(`  ${c.dim(`using API key from ${haKeySource}`)}`);

  const withKey = { headers: { 'X-API-Key': HA_KEY }, useSession: false };

  await test('HA endpoint rejects a missing API key', async () => {
    const res = await GET('/api/ha/summary', { useSession: false });
    return expectStatus(res, [401, 503], 'GET /api/ha/summary without key');
  });

  await test('HA endpoint rejects a wrong API key', async () => {
    const res = await GET('/api/ha/summary', { headers: { 'X-API-Key': 'wrong-key' }, useSession: false });
    return expectStatus(res, [401, 503], 'GET /api/ha/summary with bad key');
  });

  let summary = null;

  await test('GET /api/ha/summary returns the expected shape', async () => {
    const res = await GET('/api/ha/summary', withKey);
    const statusCheck = expectStatus(res, 200, 'GET /api/ha/summary');
    if (statusCheck !== true) return statusCheck;
    summary = res.json;
    return expectKeys(res.json, [
      'devices_total', 'devices_online', 'devices_offline', 'devices_unknown',
      'networks', 'domains_total', 'domains_expiring_soon', 'domains_expired', 'updated',
    ], '/api/ha/summary');
  });

  await test('HA device counts add up to the total', () => {
    if (!summary) return 'summary unavailable';
    const sum = summary.devices_online + summary.devices_offline + summary.devices_unknown;
    return sum === summary.devices_total
      ? true
      : `online+offline+unknown (${sum}) !== devices_total (${summary.devices_total})`;
  });

  // Regression guard: the ping cache stores 'up'/'down'. If the HA layer compares
  // against different strings, every device silently reports "unknown" while the
  // ping cache is full of live results. This is exactly the v1.33–v2.0.1 bug.
  await test('HA reports device status rather than all-unknown', () => {
    if (!summary) return 'summary unavailable';
    if (!pingResults || !Object.keys(pingResults).length) return true; // cache cold
    const liveCount = Object.values(pingResults).filter((v) => v === 'up' || v === 'down').length;
    if (liveCount === 0) return true;
    if (summary.devices_online === 0 && summary.devices_offline === 0 && summary.devices_unknown > 0) {
      return `ping cache holds ${liveCount} live result(s) but HA reports every device as unknown `
           + `(online=0, offline=0, unknown=${summary.devices_unknown}) — status string mismatch between `
           + `the ping cache and the HA endpoints`;
    }
    return true;
  });

  await test('GET /api/ha/devices returns a device list', async () => {
    const res = await GET('/api/ha/devices', withKey);
    const statusCheck = expectStatus(res, 200, 'GET /api/ha/devices');
    if (statusCheck !== true) return statusCheck;
    const keyCheck = expectKeys(res.json, ['devices', 'count', 'updated'], '/api/ha/devices');
    if (keyCheck !== true) return keyCheck;
    if (!Array.isArray(res.json.devices)) return 'devices is not an array';
    if (res.json.count !== res.json.devices.length) {
      return `count (${res.json.count}) !== devices.length (${res.json.devices.length})`;
    }
    const bad = res.json.devices
      .map((d) => d.ping)
      .filter((p) => !['online', 'offline', 'unknown'].includes(p));
    return bad.length ? `unexpected ping value(s) in device list: ${[...new Set(bad)].join(', ')}` : true;
  });

  await test('GET /api/ha/domains returns a domain list', async () => {
    const res = await GET('/api/ha/domains', withKey);
    const statusCheck = expectStatus(res, 200, 'GET /api/ha/domains');
    if (statusCheck !== true) return statusCheck;
    return expectKeys(res.json, ['domains', 'count', 'updated'], '/api/ha/domains');
  });

  await test('HA API key also works as a query parameter', async () => {
    const res = await GET(`/api/ha/summary?api_key=${encodeURIComponent(HA_KEY)}`, { useSession: false });
    return expectStatus(res, 200, 'GET /api/ha/summary?api_key=');
  });
}

// ── 4b. API keys and per-entry endpoints ─────────────────────────────────────
// Creates two temporary keys and a temporary entry, then removes all three.
// This is the only part of the run that writes, and it cleans up after itself.
async function testApiKeys() {
  group('4b. API keys and per-entry endpoints');

  const TEST_IP = '203.0.113.253'; // TEST-NET-3, never a real device
  let readKey = null, writeKey = null, readId = null, writeId = null;

  await test('GET /api/keys lists keys', async () => {
    const res = await GET('/api/keys');
    const statusCheck = expectStatus(res, 200, 'GET /api/keys');
    if (statusCheck !== true) return statusCheck;
    return Array.isArray(res.json?.keys) ? true : 'expected { keys: [...] }';
  });

  await test('POST /api/keys rejects a missing label', async () => {
    const res = await POST('/api/keys', { scope: 'read' });
    return expectStatus(res, 400, 'POST /api/keys without label');
  });

  await test('POST /api/keys rejects an invalid scope', async () => {
    const res = await POST('/api/keys', { label: 'smoke-test-bad', scope: 'admin' });
    return expectStatus(res, 400, 'POST /api/keys with bad scope');
  });

  await test('POST /api/keys creates a read key', async () => {
    const res = await POST('/api/keys', { label: 'smoke-test-read', scope: 'read' });
    if (res.status !== 200) return `expected HTTP 200, got ${res.status}`;
    readKey = res.json?.key; readId = res.json?.id;
    if (!readKey || !readId) return 'response did not include a key and id';
    return res.json.scope === 'read' ? true : `expected scope 'read', got '${res.json.scope}'`;
  });

  await test('POST /api/keys creates a write key', async () => {
    const res = await POST('/api/keys', { label: 'smoke-test-write', scope: 'write' });
    if (res.status !== 200) return `expected HTTP 200, got ${res.status}`;
    writeKey = res.json?.key; writeId = res.json?.id;
    return writeKey && writeId ? true : 'response did not include a key and id';
  });

  const asKey = (k) => ({ headers: { 'X-API-Key': k }, useSession: false });

  await test('a read key can read entries', async () => {
    if (!readKey) return 'no read key';
    const res = await GET('/api/ips', asKey(readKey));
    return expectStatus(res, 200, 'GET /api/ips with read key');
  });

  await test('an invalid key is rejected', async () => {
    const res = await GET('/api/ips', asKey('not-a-real-key'));
    return expectStatus(res, 401, 'GET /api/ips with bogus key');
  });

  await test('a read key CANNOT write', async () => {
    if (!readKey) return 'no read key';
    const res = await req('POST', '/api/ips', { body: { ip: TEST_IP }, ...asKey(readKey) });
    if (res.status === 403) return true;
    return `read-only key was allowed to POST — expected HTTP 403, got ${res.status}`;
  });

  await test('a key CANNOT be used as a query parameter for writes', async () => {
    if (!writeKey) return 'no write key';
    const res = await req('POST', `/api/ips?api_key=${encodeURIComponent(writeKey)}`, { body: { ip: TEST_IP }, useSession: false });
    if (res.status === 400) return true;
    return `write via query parameter was allowed — expected HTTP 400, got ${res.status}. `
         + `Query strings are recorded in Nginx access logs.`;
  });

  await test('a key CANNOT manage keys', async () => {
    if (!writeKey) return 'no write key';
    const res = await GET('/api/keys', asKey(writeKey));
    return expectStatus(res, 401, 'GET /api/keys with an API key');
  });

  await test('a key CANNOT download a support bundle', async () => {
    if (!writeKey) return 'no write key';
    const res = await GET('/api/support/bundle', asKey(writeKey));
    return expectStatus(res, 401, 'GET /api/support/bundle with an API key');
  });

  await test('a write key can create an entry', async () => {
    if (!writeKey) return 'no write key';
    const res = await req('POST', '/api/ips', {
      body: { ip: TEST_IP, assetName: 'smoke-test-temp', type: 'other' },
      ...asKey(writeKey),
    });
    if (res.status !== 201) return `expected HTTP 201, got ${res.status}`;
    return res.json?.lastModified ? true : 'created entry has no lastModified timestamp';
  });

  await test('creating a duplicate entry is rejected', async () => {
    if (!writeKey) return 'no write key';
    const res = await req('POST', '/api/ips', { body: { ip: TEST_IP }, ...asKey(writeKey) });
    return expectStatus(res, 409, 'POST /api/ips duplicate');
  });

  await test('GET /api/ips/:ip returns the single entry', async () => {
    const res = await GET(`/api/ips/${TEST_IP}`);
    const statusCheck = expectStatus(res, 200, `GET /api/ips/${TEST_IP}`);
    if (statusCheck !== true) return statusCheck;
    return res.json?.ip === TEST_IP ? true : `expected ip ${TEST_IP}, got ${res.json?.ip}`;
  });

  await test('PATCH updates one entry without touching the rest', async () => {
    const before = await GET('/api/ips');
    const countBefore = (before.json?.data || []).length;
    const res = await req('PATCH', `/api/ips/${TEST_IP}`, { body: { assetName: 'smoke-test-renamed' }, ...asKey(writeKey) });
    if (res.status !== 200) return `expected HTTP 200, got ${res.status}`;
    if (res.json?.assetName !== 'smoke-test-renamed') return 'assetName was not updated';
    const after = await GET('/api/ips');
    const countAfter = (after.json?.data || []).length;
    return countBefore === countAfter ? true : `entry count changed from ${countBefore} to ${countAfter}`;
  });

  await test('PATCH rejects a stale write (conflict detection)', async () => {
    const res = await req('PATCH', `/api/ips/${TEST_IP}`, {
      body: { assetName: 'stale', expectedLastModified: '2000-01-01T00:00:00.000Z' },
      ...asKey(writeKey),
    });
    return expectStatus(res, 409, 'PATCH with stale expectedLastModified');
  });

  await test('PATCH on an unknown IP returns 404', async () => {
    const res = await req('PATCH', '/api/ips/203.0.113.254', { body: { assetName: 'x' }, ...asKey(writeKey) });
    return expectStatus(res, 404, 'PATCH unknown IP');
  });

  await test('DELETE removes the entry', async () => {
    const res = await req('DELETE', `/api/ips/${TEST_IP}`, asKey(writeKey));
    if (res.status !== 200) return `expected HTTP 200, got ${res.status}`;
    const check = await GET(`/api/ips/${TEST_IP}`);
    return check.status === 404 ? true : `entry still present after delete (HTTP ${check.status})`;
  });

  // Clean up the temporary keys.
  await test('temporary test keys removed', async () => {
    const failures = [];
    for (const id of [readId, writeId].filter(Boolean)) {
      const res = await req('DELETE', `/api/keys/${id}`);
      if (res.status !== 200) failures.push(`${id} -> HTTP ${res.status}`);
    }
    if (failures.length) return `could not delete: ${failures.join(', ')} — remove them by hand in Settings → API Keys`;
    const remaining = await GET('/api/keys');
    const strays = (remaining.json?.keys || []).filter((k) => k.label.startsWith('smoke-test-'));
    return strays.length ? `${strays.length} smoke-test key(s) left behind` : true;
  });
}

// ── 5. Security regressions ──────────────────────────────────────────────────
// Every /api/* route except /api/auth/* and /api/ha/* must require a session.
// Routes registered above the auth middleware silently bypass it, which is how
// /api/proxmox/discover ended up publicly reachable.
const MUST_REQUIRE_AUTH = [
  { method: 'POST', path: '/api/proxmox/discover', body: {} },
  { method: 'POST', path: '/api/arp/scan',         body: {} },
  { method: 'POST', path: '/api/import',           body: {} },
  { method: 'PUT',  path: '/api/ips',              body: [] },
  { method: 'PUT',  path: '/api/config',           body: {} },
  { method: 'PUT',  path: '/api/networks',         body: [] },
];

async function testSecurityRegressions() {
  group('5. Security regressions');

  for (const route of MUST_REQUIRE_AUTH) {
    await test(`${route.method} ${route.path} requires a session`, async () => {
      const res = await req(route.method, route.path, { body: route.body, useSession: false });
      if (res.status === 401 || res.status === 423) return true;
      return `route is reachable without authentication — returned HTTP ${res.status}. `
           + `It is probably registered above the app.use('/api', requireAuth) middleware.`;
    });
  }

  // NOTE: the support bundle embeds the last 300 journal lines. On a freshly
  // installed server those lines still contain the generated startup password,
  // so this check fails. On a long-running server the block has scrolled out of
  // range and it passes. A pass here therefore means "no credentials in this
  // bundle right now", not "the bundle can never leak credentials".
  await test('support bundle does not leak credentials', async () => {
    const res = await GET('/api/support/bundle');
    if (res.status !== 200) return `expected HTTP 200, got ${res.status}`;
    const body = res.text || '';
    const leaks = [];
    if (body.includes(PASS)) leaks.push('the account password');
    if (/IP_MANAGER_PASSWORD\s*=/.test(body)) leaks.push('IP_MANAGER_PASSWORD');
    if (/\$2[aby]\$\d{2}\$/.test(body)) leaks.push('a bcrypt hash');
    if (HA_KEY && body.includes(HA_KEY)) leaks.push('the Home Assistant API key');
    if (/initial credentials/i.test(body)) leaks.push('the generated startup credentials block');
    return leaks.length ? `support bundle contains ${leaks.join(', ')}` : true;
  });
}

// ── 6. Build ─────────────────────────────────────────────────────────────────
async function testBuild() {
  group('6. Frontend build');

  if (!DO_BUILD) {
    skip('npm run build', 'pass --build to enable');
    return;
  }

  await test('npm run build succeeds', () => {
    const repoRoot = path.resolve(__dirname, '..');
    try {
      execSync('npm run build', { cwd: repoRoot, stdio: 'pipe', timeout: 300000 });
      return true;
    } catch (err) {
      const out = `${err.stdout || ''}${err.stderr || ''}`.trim().split('\n').slice(-8).join('\n');
      return `build failed:\n${out}`;
    }
  });
}

// ── Runner ───────────────────────────────────────────────────────────────────
(async function main() {
  console.log(c.bold('\nIP Address Manager — smoke tests'));
  console.log(c.dim(`Target: ${BASE}`));
  console.log(c.dim(`User:   ${USER}`));
  console.log(c.dim(`HA key: ${HA_KEY ? 'provided' : 'read from the server after login'}`));
  console.log(c.dim(`Mode:   ${READ_ONLY ? 'read-only' : 'includes write tests (temporary key + entry, cleaned up)'}`));

  const started = Date.now();

  await testAuth();

  if (!sessionCookie) {
    console.log(`\n${c.red('Login failed — cannot run authenticated tests.')}`);
    console.log(c.dim('Check SMOKE_USER and SMOKE_PASS, then re-run.'));
    process.exit(1);
  }

  await testProtectedRoutes();
  await testStatusCaches();
  await testHomeAssistant();
  if (READ_ONLY) {
    group('4b. API keys and per-entry endpoints');
    skip('all write tests', '--read-only');
  } else {
    await testApiKeys();
  }
  await testSecurityRegressions();
  await testBuild();

  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\n${c.bold('Summary')}`);
  console.log(`  ${c.green(`${results.pass} passed`)}  ${results.fail ? c.red(`${results.fail} failed`) : '0 failed'}  ${c.amber(`${results.skip} skipped`)}  ${c.dim(`(${seconds}s)`)}`);

  if (results.failures.length) {
    console.log(`\n${c.bold('Failures')}`);
    for (const f of results.failures) {
      console.log(`  ${c.red('×')} ${c.dim(f.group)} — ${f.name}`);
      if (f.detail) console.log(`    ${f.detail}`);
    }
    console.log('');
    process.exit(1);
  }

  console.log(`\n${c.green('All checks passed.')}\n`);
  process.exit(0);
})();
