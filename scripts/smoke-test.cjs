#!/usr/bin/env node
/* ============================================================
 *  IP Address Manager — smoke tests
 *
 *  Verifies a running install end-to-end: authentication, every
 *  API route's status code and response shape, the status caches,
 *  the Home Assistant API, and a set of known security regressions.
 *
 *  READ-ONLY. Makes no writes and mutates no data. Safe to run
 *  against a live server.
 *
 *  Usage:
 *    SMOKE_USER=Jay SMOKE_PASS='...' node scripts/smoke-test.js
 *
 *  Options:
 *    --url <base>   Base URL          (default http://127.0.0.1:3001)
 *    --build        Also run `npm run build` and fail on error
 *    --verbose      Print response bodies for failures
 *
 *  Environment:
 *    SMOKE_USER     Username                        (required)
 *    SMOKE_PASS     Password                        (required)
 *    SMOKE_HA_KEY   Home Assistant API key          (optional —
 *                   HA tests are skipped if absent)
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
const HA_KEY   = process.env.SMOKE_HA_KEY || null;
const VERBOSE  = flag('--verbose');
const DO_BUILD = flag('--build');

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
const PROTECTED_ROUTES = [
  { path: '/api/health',               keys: null },
  { path: '/api/ips',                  keys: null,  isArray: true },
  { path: '/api/config',               keys: null },
  { path: '/api/networks',             keys: null },
  { path: '/api/domains',              keys: null },
  { path: '/api/dns-config',           keys: null },
  { path: '/api/arp-presence/config',  keys: null },
  { path: '/api/arp-presence/status',  keys: null },
  { path: '/api/subnet-blocks',        keys: null },
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
      if (route.isArray && !Array.isArray(res.json)) return `expected an array, got ${typeof res.json}`;
      if (route.keys) return expectKeys(res.json, route.keys, route.path);
      return true;
    });
  }
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

  if (!HA_KEY) {
    skip('all Home Assistant tests', 'SMOKE_HA_KEY not set');
    return;
  }

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
  console.log(c.dim(`HA key: ${HA_KEY ? 'provided' : 'not provided — HA tests will be skipped'}`));

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
