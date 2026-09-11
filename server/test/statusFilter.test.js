// ============================================================
//  Status filtering
//
//  The whole point of an "offline" filter is to produce a short list of things
//  that need attention. Free and Reserved rows are placeholders, not devices —
//  they never answer a ping, so treating them as offline would bury the real
//  problems under every unused address on the network.
// ============================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const path = require('path');

function run(script) {
  const file = path.join(__dirname, '..', '..', 'src', 'shared', 'common.js');
  return execFileSync(process.execPath, ['--input-type=module', '-e',
    `import { matchesStatusFilter } from ${JSON.stringify(file)};\n${script}`],
    { encoding: 'utf8' }).trim();
}

test('an empty filter matches everything', () => {
  const out = run(`
    console.log(JSON.stringify([
      matchesStatusFilter({ assetName: 'NAS' }, 'down', ''),
      matchesStatusFilter({ assetName: 'Free' }, undefined, ''),
    ]));`);
  assert.deepEqual(JSON.parse(out), [true, true]);
});

test('ping state maps to the filter vocabulary', () => {
  const out = run(`
    console.log(JSON.stringify([
      matchesStatusFilter({ assetName: 'NAS' }, 'up', 'online'),
      matchesStatusFilter({ assetName: 'NAS' }, 'down', 'offline'),
      matchesStatusFilter({ assetName: 'NAS' }, undefined, 'unknown'),
      matchesStatusFilter({ assetName: 'NAS' }, 'up', 'offline'),
    ]));`);
  assert.deepEqual(JSON.parse(out), [true, true, true, false]);
});

test('placeholders are never included by a status filter', () => {
  // The regression this guards: on a /24 with 170 free addresses, an offline
  // filter that included them would return 170 rows instead of the handful
  // that are genuinely down.
  const out = run(`
    console.log(JSON.stringify([
      matchesStatusFilter({ assetName: 'Free' }, undefined, 'offline'),
      matchesStatusFilter({ assetName: 'Reserved' }, undefined, 'offline'),
      matchesStatusFilter({ assetName: 'Free' }, undefined, 'unknown'),
      matchesStatusFilter({ assetName: 'Free' }, 'down', 'offline'),
    ]));`);
  assert.deepEqual(JSON.parse(out), [false, false, false, false],
    'a placeholder must never satisfy a status filter, whatever ping reports');
});

test('a device with no ping result is unknown, not offline', () => {
  // Before the first poll completes nothing has a result. Reporting all of it
  // as offline would be alarming and wrong.
  const out = run(`
    console.log(JSON.stringify([
      matchesStatusFilter({ assetName: 'NAS' }, undefined, 'offline'),
      matchesStatusFilter({ assetName: 'NAS' }, null, 'offline'),
      matchesStatusFilter({ assetName: 'NAS' }, undefined, 'unknown'),
    ]));`);
  assert.deepEqual(JSON.parse(out), [false, false, true]);
});

test('a missing entry never matches', () => {
  const out = run(`
    console.log(JSON.stringify([
      matchesStatusFilter(null, 'down', 'offline'),
      matchesStatusFilter(undefined, 'down', 'offline'),
    ]));`);
  assert.deepEqual(JSON.parse(out), [false, false]);
});

// ── Maintenance ─────────────────────────────────────────────────────────────
// A host taken down on purpose — a rebuild, a disk swap — is not a fault.
// Counting it as offline buries the real failures, and worse, trains people to
// ignore the offline count during any planned work.

test('a device in maintenance is not counted as offline', () => {
  const out = run(`
    console.log(JSON.stringify([
      matchesStatusFilter({ assetName: 'NAS', maintenance: true }, 'down', 'offline'),
      matchesStatusFilter({ assetName: 'NAS', maintenance: true }, undefined, 'offline'),
    ]));`);
  assert.deepEqual(JSON.parse(out), [false, false],
    'the whole point of the flag is that it does not show up as a failure');
});

test('maintenance is its own state, not a kind of online', () => {
  // Folding it into "online" would be a lie — the host genuinely is not there.
  const out = run(`
    console.log(JSON.stringify([
      matchesStatusFilter({ assetName: 'NAS', maintenance: true }, 'down', 'maintenance'),
      matchesStatusFilter({ assetName: 'NAS', maintenance: true }, 'down', 'online'),
      matchesStatusFilter({ assetName: 'NAS' }, 'down', 'maintenance'),
    ]));`);
  assert.deepEqual(JSON.parse(out), [true, false, false]);
});

test('a normal device is unaffected by the maintenance rule', () => {
  const out = run(`
    console.log(JSON.stringify([
      matchesStatusFilter({ assetName: 'NAS', maintenance: false }, 'down', 'offline'),
      matchesStatusFilter({ assetName: 'NAS' }, 'down', 'offline'),
    ]));`);
  assert.deepEqual(JSON.parse(out), [true, true]);
});

test('a flagged device that is answering again is reported', () => {
  // Without this the flag is an alert silenced for ever, and nothing ever
  // reminds anyone it is still set.
  const file = path.join(__dirname, '..', '..', 'src', 'shared', 'common.js');
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    `import { maintenanceButResponding } from ${JSON.stringify(file)};
     console.log(JSON.stringify([
       maintenanceButResponding({ maintenance: true }, 'up'),
       maintenanceButResponding({ maintenance: true }, 'down'),
       maintenanceButResponding({ maintenance: false }, 'up'),
       maintenanceButResponding(null, 'up'),
     ]));`], { encoding: 'utf8' }).trim();
  assert.deepEqual(JSON.parse(out), [true, false, false, false]);
});

// ── One rule, two runtimes ──────────────────────────────────────────────────
// "Is this device a fault?" is decided in two places: server/lib/net.js for the
// Home Assistant summary and notification suppression, src/shared/common.js for
// the offline count and filter. The server is CommonJS and loads a native
// database module; the frontend copy is ESM and must stay importable by Vite.
// They cannot be one file, so instead they are held to the same answers — which
// is the guarantee that actually matters. Without this, a device could vanish
// from the count while still firing alerts, and nothing would notice.

test('the server and frontend agree on what counts as offline', () => {
  const { countsAsOffline: server } = require('../lib/net');

  const entries = [
    { assetName: 'NAS' },
    { assetName: 'NAS', maintenance: true },
    { assetName: 'NAS', maintenance: false },
    { assetName: 'NAS', maintenance: 'false' },   // the truthy-string footgun
    { assetName: 'NAS', maintenance: 1 },
    { assetName: 'Free' },
    { assetName: 'Free', maintenance: true },
    { assetName: 'Reserved' },
    {},
    null,
  ];
  const pings = ['up', 'down', undefined];

  const cases = [];
  for (const e of entries) for (const p of pings) cases.push([e, p]);

  const file = path.join(__dirname, '..', '..', 'src', 'shared', 'common.js');
  const frontend = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    `import { countsAsOffline } from ${JSON.stringify(file)};
     const cases = ${JSON.stringify(cases)};
     console.log(JSON.stringify(cases.map(([e, p]) => countsAsOffline(e, p))));`],
    { encoding: 'utf8' }).trim());

  const fromServer = cases.map(([e, p]) => server(e, p));

  const disagreements = cases
    .map((c, i) => ({ entry: c[0], ping: c[1], server: fromServer[i], frontend: frontend[i] }))
    .filter((r) => r.server !== r.frontend);

  assert.deepEqual(disagreements, [],
    'server/lib/net.js and src/shared/common.js disagree about which devices are offline');
});
