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
