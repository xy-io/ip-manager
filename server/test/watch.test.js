// ============================================================
//  Network Watch ledger tests
//
//  The property under test is mostly *storage*. A device ledger is the kind of
//  structure that looks fine for a month and fills a disk in a year, so most
//  of what follows simulates time passing or a hostile network rather than
//  checking a return value.
// ============================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  normaliseMac, isRandomisedMac, recordSightings, pruneLedger, evictToCap,
  ledgerBytes, describeLedger, protectedMacsFor, summarise, DEFAULT_CONFIG, LIMITS,
} = require('../lib/watch');

const iso = (daysAgo = 0) => new Date(Date.now() - daysAgo * 86400000).toISOString();

// Build a distinct MAC for index `i`. Hex, not decimal: an earlier version of
// these tests padded decimal values, which produced invalid three-character
// groups above 99 and quietly generated far fewer devices than each test
// claimed to be exercising.
const hex2 = (n) => (n & 0xff).toString(16).padStart(2, '0');
const macFor = (i, prefix = 'b8:27:eb') => `${prefix}:00:${hex2(i >> 8)}:${hex2(i)}`;

// ── MAC handling ────────────────────────────────────────────────────────────

test('MAC addresses normalise to lowercase colon-separated form', () => {
  assert.equal(normaliseMac('AA-BB-CC-DD-EE-FF'), 'aa:bb:cc:dd:ee:ff');
  assert.equal(normaliseMac('aabb.ccdd.eeff'), 'aa:bb:cc:dd:ee:ff');
  assert.equal(normaliseMac('AA:BB:CC:DD:EE:FF'), 'aa:bb:cc:dd:ee:ff');
});

test('non-MACs and meaningless MACs are rejected', () => {
  assert.equal(normaliseMac(''), null);
  assert.equal(normaliseMac(null), null);
  assert.equal(normaliseMac('not a mac'), null);
  assert.equal(normaliseMac('aa:bb:cc:dd:ee'), null, 'too short');
  assert.equal(normaliseMac('00:00:00:00:00:00'), null, 'the null address is not an identity');
  assert.equal(normaliseMac('ff:ff:ff:ff:ff:ff'), null, 'broadcast is not an identity');
});

test('randomised MACs are identified by the locally-administered bit', () => {
  // The second hex digit of the first octet being 2, 6, A or E means the
  // address was generated, not burned in. This is the check that stops every
  // phone rejoin looking like an intruder.
  for (const prefix of ['02', '06', '0a', '0e', 'a2', '7e', 'de']) {
    assert.equal(isRandomisedMac(`${prefix}:11:22:33:44:55`), true, `${prefix} should be randomised`);
  }
  for (const prefix of ['00', '04', '08', '0c', 'b8', 'dc', '3c']) {
    assert.equal(isRandomisedMac(`${prefix}:11:22:33:44:55`), false, `${prefix} should be real`);
  }
});

test('a real Apple OUI is not mistaken for a randomised address', () => {
  assert.equal(isRandomisedMac('3c:22:fb:11:22:33'), false);
  assert.equal(isRandomisedMac('b8:27:eb:11:22:33'), false, 'Raspberry Pi OUI');
});

// ── Storage: flat over time ─────────────────────────────────────────────────
// The central claim of the design. Pi.Alert appends a row per connect and
// disconnect, so its storage grows with time for ever. This must not.

test('storage does not grow as the same devices are seen again and again', () => {
  const devices = Array.from({ length: 90 }, (_, i) => ({
    mac: macFor(i),
    ip: `192.168.0.${(i % 254) + 1}`,
    vendor: 'Raspberry Pi Foundation',
  }));

  let ledger = recordSightings([], devices);
  const afterFirstScan = ledgerBytes(ledger);
  const countAfterFirstScan = ledger.length;

  // A scan every 15 minutes for a year.
  for (let i = 0; i < 35040; i += 1) ledger = recordSightings(ledger, devices);

  assert.equal(ledger.length, countAfterFirstScan, 'a year of scanning must not add records');
  // Only the sighting counters grow, by a handful of digits each.
  assert.ok(ledgerBytes(ledger) < afterFirstScan * 1.2,
    `a year of scanning grew storage from ${afterFirstScan} to ${ledgerBytes(ledger)} bytes`);
});

test('a sighting increments a counter rather than appending to a list', () => {
  const device = [{ mac: 'b8:27:eb:11:22:33', ip: '10.0.0.1' }];
  let ledger = recordSightings([], device);
  for (let i = 0; i < 500; i += 1) ledger = recordSightings(ledger, device);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].sightings, 501);
  assert.equal(Array.isArray(ledger[0].sightings), false, 'sightings must not be a list');
});

// ── Storage: bounded under attack ───────────────────────────────────────────

test('a flood of unique MACs cannot grow the ledger past its cap', () => {
  // Anything on the network can send an ARP reply per fabricated MAC. The
  // ledger must survive that without filling the disk.
  const flood = Array.from({ length: 50000 }, (_, i) => ({
    mac: `02:00:${hex2(i >> 16)}:${hex2(i >> 8)}:${hex2(i)}:01`,
    ip: '10.0.0.99',
  }));

  const ledger = recordSightings([], flood);
  assert.ok(ledger.length <= LIMITS.MAX_IDENTITIES,
    `expected at most ${LIMITS.MAX_IDENTITIES} records, got ${ledger.length}`);
  assert.ok(ledgerBytes(ledger) <= LIMITS.MAX_LEDGER_BYTES,
    `ledger exceeded its byte ceiling at ${ledgerBytes(ledger)} bytes`);
});

test('a lower configured cap is honoured, not just the hard ceiling', () => {
  // The flood test above passes even without the identity cap, because the byte
  // backstop clamps to the same hard ceiling. This isolates the configured cap.
  const many = Array.from({ length: 400 }, (_, i) => ({
    mac: macFor(i),
    ip: '10.0.0.1',
  }));
  const ledger = recordSightings([], many, { config: { ...DEFAULT_CONFIG, maxIdentities: 50 } });
  assert.equal(ledger.length, 50, 'the configured cap must be applied, not just the hard limit');
});

test('one record cannot grow without limit either', () => {
  // A device that changes address constantly, and advertises endless services.
  let ledger = [];
  for (let i = 0; i < 200; i += 1) {
    ledger = recordSightings(ledger, [{
      mac: 'b8:27:eb:11:22:33',
      ip: `10.0.${Math.floor(i / 254)}.${(i % 254) + 1}`,
      services: [`_svc${i}._tcp`],
    }]);
  }
  assert.equal(ledger.length, 1);
  assert.ok(ledger[0].ips.length <= LIMITS.MAX_IPS_PER_IDENTITY, 'addresses must be capped');
  assert.ok(ledger[0].services.length <= LIMITS.MAX_SERVICES_PER_IDENTITY, 'services must be capped');
});

test('long strings are truncated rather than stored whole', () => {
  const ledger = recordSightings([], [{
    mac: 'b8:27:eb:11:22:33',
    ip: '10.0.0.1',
    vendor: 'V'.repeat(5000),
    hostname: 'h'.repeat(5000),
    name: 'n'.repeat(5000),
  }]);
  assert.ok(ledger[0].vendor.length <= LIMITS.MAX_STRING);
  assert.ok(ledger[0].hostname.length <= LIMITS.MAX_STRING);
  assert.ok(ledger[0].name.length <= LIMITS.MAX_STRING);
});

test('the most recent address is kept when the cap evicts older ones', () => {
  let ledger = [];
  for (let i = 1; i <= 20; i += 1) {
    ledger = recordSightings(ledger, [{ mac: 'b8:27:eb:11:22:33', ip: `10.0.0.${i}` }]);
  }
  assert.equal(ledger[0].ips[0], '10.0.0.20', 'the current address must survive');
});

// ── Pruning ─────────────────────────────────────────────────────────────────

test('randomised addresses are pruned quickly and real ones are kept', () => {
  const now = iso(0);
  const records = [
    { mac: '02:11:22:33:44:55', random: true,  lastSeen: iso(20), sightings: 1, ips: [] },
    { mac: '02:11:22:33:44:66', random: true,  lastSeen: iso(5),  sightings: 1, ips: [] },
    { mac: 'b8:27:eb:11:22:33', random: false, lastSeen: iso(20), sightings: 1, ips: [] },
    { mac: 'b8:27:eb:11:22:44', random: false, lastSeen: iso(300), sightings: 1, ips: [] },
  ];
  const kept = pruneLedger(records, DEFAULT_CONFIG, now).map((r) => r.mac);
  assert.ok(!kept.includes('02:11:22:33:44:55'), 'a 20-day-old randomised MAC should go');
  assert.ok(kept.includes('02:11:22:33:44:66'), 'a 5-day-old randomised MAC should stay');
  assert.ok(kept.includes('b8:27:eb:11:22:33'), 'a 20-day-old real MAC should stay');
  assert.ok(!kept.includes('b8:27:eb:11:22:44'), 'a 300-day-old real MAC should go');
});

test('a device in the inventory is never pruned, however old', () => {
  const records = [{ mac: 'b8:27:eb:11:22:33', random: false, lastSeen: iso(9999), sightings: 1, ips: ['10.0.0.5'] }];
  const kept = pruneLedger(records, DEFAULT_CONFIG, iso(0), new Set(['b8:27:eb:11:22:33']));
  assert.equal(kept.length, 1, 'a tracked device must not vanish from its own ledger');
});

// ── Eviction ────────────────────────────────────────────────────────────────

test('eviction sheds randomised addresses before real ones', () => {
  const records = [
    { mac: '02:00:00:00:00:01', random: true,  lastSeen: iso(0), ips: [] },
    { mac: '02:00:00:00:00:02', random: true,  lastSeen: iso(0), ips: [] },
    { mac: 'b8:27:eb:00:00:01', random: false, lastSeen: iso(9), ips: [] },
  ];
  const kept = evictToCap(records, 1).map((r) => r.mac);
  assert.deepEqual(kept, ['b8:27:eb:00:00:01'], 'the real address should be the survivor');
});

test('eviction keeps the most recently seen within a group', () => {
  const records = [
    { mac: 'b8:27:eb:00:00:01', random: false, lastSeen: iso(30), ips: [] },
    { mac: 'b8:27:eb:00:00:02', random: false, lastSeen: iso(1),  ips: [] },
  ];
  assert.deepEqual(evictToCap(records, 1).map((r) => r.mac), ['b8:27:eb:00:00:02']);
});

test('a cap can never evict a device that is in the inventory', () => {
  // Otherwise a flood of fabricated MACs could push the user's own devices out
  // of their ledger, which would be an attack rather than a limit.
  //
  // The tracked device is deliberately the *worst* candidate by every ordering
  // rule — randomised and least recently seen — so only the protection can
  // explain its survival. An earlier version of this test used a real, recent
  // MAC and passed even with protection removed, because the sort happened to
  // favour it.
  const tracked = { mac: '02:00:00:00:ff:ff', random: true, lastSeen: iso(400), ips: ['10.0.0.5'] };
  const noise = Array.from({ length: 500 }, (_, i) => ({
    mac: macFor(i), random: false, lastSeen: iso(0), ips: [],
  }));
  const kept = evictToCap([tracked, ...noise], 10, new Set([tracked.mac]));
  assert.ok(kept.some((r) => r.mac === tracked.mac), 'the tracked device must survive');
  assert.ok(kept.length <= 10);
});

test('pruning a protected device is likewise not merely a sort accident', () => {
  const records = [{ mac: '02:00:00:00:ff:ff', random: true, lastSeen: iso(400), sightings: 1, ips: ['10.0.0.5'] }];
  assert.equal(pruneLedger(records, DEFAULT_CONFIG, iso(0), new Set(['02:00:00:00:ff:ff'])).length, 1);
  assert.equal(pruneLedger(records, DEFAULT_CONFIG, iso(0), new Set()).length, 0,
    'without protection the same record must be pruned — proving protection is what saved it');
});

test('protectedMacsFor identifies ledger entries that match the inventory', () => {
  const records = [
    { mac: 'b8:27:eb:00:00:01', ips: ['10.0.0.5'] },
    { mac: 'b8:27:eb:00:00:02', ips: ['10.0.0.99'] },
  ];
  const entries = [{ ip: '10.0.0.5', assetName: 'NAS' }, { ip: '10.0.0.99', assetName: 'Free' }];
  const macs = protectedMacsFor(records, entries);
  assert.ok(macs.has('b8:27:eb:00:00:01'));
  assert.ok(!macs.has('b8:27:eb:00:00:02'), 'a Free placeholder is not a tracked device');
});

// ── Description ─────────────────────────────────────────────────────────────

test('ledger entries are matched against the inventory for display', () => {
  const records = recordSightings([], [
    { mac: 'b8:27:eb:00:00:01', ip: '10.0.0.5' },
    { mac: 'b8:27:eb:00:00:02', ip: '10.0.0.77' },
  ]);
  const described = describeLedger(records, [{ ip: '10.0.0.5', assetName: 'NAS' }]);
  const known = described.find((d) => d.currentIp === '10.0.0.5');
  const unknown = described.find((d) => d.currentIp === '10.0.0.77');
  assert.equal(known.inInventory, true);
  assert.equal(known.inventoryName, 'NAS');
  assert.equal(unknown.inInventory, false);
});

test('the summary separates known, unknown and randomised', () => {
  const records = recordSightings([], [
    { mac: 'b8:27:eb:00:00:01', ip: '10.0.0.5' },     // known
    { mac: 'b8:27:eb:00:00:02', ip: '10.0.0.77' },    // unknown, real
    { mac: '02:00:00:00:00:03', ip: '10.0.0.78' },    // randomised
  ]);
  const s = summarise(records, [{ ip: '10.0.0.5', assetName: 'NAS' }]);
  assert.equal(s.total, 3);
  assert.equal(s.known, 1);
  assert.equal(s.unknown, 1, 'randomised addresses must not be counted as unknown devices');
  assert.equal(s.randomised, 1);
  assert.ok(s.bytes > 0);
});

test('a sighting with no usable MAC is ignored rather than stored', () => {
  const ledger = recordSightings([], [
    { ip: '10.0.0.1' },
    { mac: '00:00:00:00:00:00', ip: '10.0.0.2' },
    { mac: 'rubbish', ip: '10.0.0.3' },
  ]);
  assert.deepEqual(ledger, []);
});

test('the ledger is returned most recently seen first', () => {
  const records = [
    { mac: 'b8:27:eb:00:00:01', random: false, lastSeen: iso(5), sightings: 1, ips: [] },
    { mac: 'b8:27:eb:00:00:02', random: false, lastSeen: iso(1), sightings: 1, ips: [] },
  ];
  const ledger = recordSightings(records, []);
  assert.equal(ledger[0].mac, 'b8:27:eb:00:00:02');
});

test('an empty ledger reports zero bytes, not the two bytes of "[]"', () => {
  // While the feature is off no row is written at all. Reporting 2 bytes would
  // undercut the one number a user checks to confirm it costs them nothing.
  assert.equal(ledgerBytes([]), 0);
  assert.equal(ledgerBytes(null), 0);
  assert.ok(ledgerBytes([{ mac: 'b8:27:eb:00:00:01', ips: [] }]) > 0);
});
