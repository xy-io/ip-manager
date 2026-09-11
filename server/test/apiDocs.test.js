// ============================================================
//  API documentation coverage
//
//  A standing rule, enforced rather than remembered: a platform change must
//  update the API documentation in the same release. The web front end and the
//  native client are built from different places, and the only thing keeping
//  them in step is the written contract — so an endpoint that exists but is
//  undocumented is invisible to the client that most needs it.
//
//  When this fails it is not asking for prose. It is telling you that
//  something is callable which nobody outside this repository knows about.
//
//  An audit at v2.15.1 found 42 undocumented routes, of which 14 were
//  genuinely reachable with an API key.
// ============================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const API_DOC = path.join(ROOT, 'wiki', 'API.md');

// Routes behind a browser session are refused to API keys entirely. They are
// documented as a class rather than individually, because no client can call
// them. Kept in step with API_KEY_SESSION_ONLY in server/lib/apikeys.js.
const SESSION_ONLY_PREFIXES = [
  '/api/auth', '/api/keys', '/api/update', '/api/support',
  '/api/backup', '/api/ha/key', '/api/audit-log', '/api/notifications',
];

function allRoutes() {
  const files = [
    path.join(ROOT, 'server', 'index.js'),
    path.join(ROOT, 'server', 'routes', 'domains.js'),
    path.join(ROOT, 'server', 'routes', 'backup.js'),
  ];
  const routes = [];
  for (const file of files) {
    let src;
    try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const pattern = /app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g;
    let match;
    while ((match = pattern.exec(src)) !== null) {
      routes.push({ method: match[1].toUpperCase(), path: match[2] });
    }
  }
  return routes;
}

const isSessionOnly = (route) =>
  SESSION_ONLY_PREFIXES.some((prefix) => route.path.startsWith(prefix));

test('every API-key-reachable route appears in the API documentation', () => {
  const doc = fs.readFileSync(API_DOC, 'utf8');
  const undocumented = allRoutes()
    .filter((r) => !isSessionOnly(r))
    .filter((r) => !doc.includes(r.path));

  assert.deepEqual(undocumented.map((r) => `${r.method} ${r.path}`), [],
    'these routes are callable with an API key but are not in wiki/API.md — '
    + 'a native client has no way to discover them');
});

test('every session-only prefix is named in the documentation', () => {
  // Not naming them means a client author tries the route and gets a 403 with
  // no explanation of why it is refused.
  const doc = fs.readFileSync(API_DOC, 'utf8');
  const missing = SESSION_ONLY_PREFIXES.filter((prefix) => !doc.includes(prefix));
  assert.deepEqual(missing, [],
    'these prefixes refuse API keys but are not documented as session-only');
});

test('the session-only list matches the one the server enforces', () => {
  // Two copies of the same list is exactly how documentation drifts from
  // behaviour. If the server gains a session-only prefix, this fails until the
  // list above and the documentation are both updated.
  //
  // Read from the source text rather than imported: requiring apikeys.js pulls
  // in the database layer and its native module, which would make a pure
  // documentation check fail on any machine that cannot compile SQLite.
  const src = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'apikeys.js'), 'utf8');
  const block = src.slice(src.indexOf('API_KEY_SESSION_ONLY = ['));
  const list = block.slice(0, block.indexOf('];'));
  const fromServer = [...list.matchAll(/'(\/[^']+)'/g)].map((m) => `/api${m[1]}`).sort();
  assert.ok(fromServer.length > 4, `expected the session-only list, parsed ${fromServer.length}`);
  assert.deepEqual([...SESSION_ONLY_PREFIXES].sort(), fromServer,
    'server/lib/apikeys.js and this test disagree about which routes are session-only');
});

test('every advertised capability is documented', () => {
  // A capability flag is a promise to clients. One that appears in
  // /api/capabilities but nowhere in the documentation is a promise nobody
  // can act on.
  const doc = fs.readFileSync(API_DOC, 'utf8');
  const src = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  const block = src.slice(src.indexOf('capabilities: {'));
  const flags = [...block.slice(0, block.indexOf('},')).matchAll(/^\s*([A-Za-z]+):\s*(true|false)/gm)]
    .map((m) => m[1]);

  assert.ok(flags.length > 10, `expected the capability list, parsed ${flags.length} flags`);
  const missing = flags.filter((flag) => !doc.includes(flag));
  assert.deepEqual(missing, [], 'capability flags absent from wiki/API.md');
});

test('the documented apiVersion matches the one the server reports', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  const served = (src.match(/apiVersion:\s*'([^']+)'/) || [])[1];
  assert.ok(served, 'could not find apiVersion in the server');

  const doc = fs.readFileSync(API_DOC, 'utf8');
  assert.ok(doc.includes(`"apiVersion": "${served}"`) || doc.includes(`**${served}**`),
    `the server reports apiVersion ${served}, which does not appear in wiki/API.md`);
});

test('the client handover page covers every opt-in feature', () => {
  // The handover exists so the native client does not have to reverse-engineer
  // the server. A feature that is off by default is the easiest to miss,
  // because a client author testing against a default install never sees it.
  const handover = fs.readFileSync(path.join(ROOT, 'wiki', 'iOS-Client-Handover.md'), 'utf8');
  for (const feature of ['networkWatch', 'piholeDhcp', 'mdns', 'topology', 'deviceHistory']) {
    assert.ok(handover.includes(feature), `${feature} is missing from the client handover`);
  }
});
