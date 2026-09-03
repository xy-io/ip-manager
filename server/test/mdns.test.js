// ============================================================
//  mDNS parser tests
//
//  This parser is the only code in the app that consumes unsolicited input
//  from the local network, so the malformed-packet cases below matter more
//  than the happy path. Each one is a packet a hostile or broken device on the
//  LAN could actually send.
// ============================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  decodeMessage, encodeQuery, encodeName, readName, correlate,
  suggestionsFor, serviceTypeOf, instanceLabelOf, TYPES,
} = require('../lib/mdns');

// ── Packet construction helpers ─────────────────────────────────────────────
// Building real wire-format bytes rather than mocking the parser, because the
// bugs worth catching here live in the byte handling.

function header({ questions = 0, answers = 0, additionals = 0 } = {}) {
  const buf = Buffer.alloc(12);
  buf.writeUInt16BE(questions, 4);
  buf.writeUInt16BE(answers, 6);
  buf.writeUInt16BE(additionals, 10);
  return buf;
}

function record(name, type, data) {
  const encodedName = encodeName(name);
  const tail = Buffer.alloc(10);
  tail.writeUInt16BE(type, 0);
  tail.writeUInt16BE(1, 2);        // class IN
  tail.writeUInt32BE(120, 4);      // TTL
  tail.writeUInt16BE(data.length, 8);
  return Buffer.concat([encodedName, tail, data]);
}

const aRecord = (name, ip) => record(name, TYPES.A, Buffer.from(ip.split('.').map(Number)));
const ptrRecord = (name, target) => record(name, TYPES.PTR, encodeName(target));

function srvRecord(name, port, target) {
  const head = Buffer.alloc(6);
  head.writeUInt16BE(0, 0);        // priority
  head.writeUInt16BE(0, 2);        // weight
  head.writeUInt16BE(port, 4);
  return record(name, TYPES.SRV, Buffer.concat([head, encodeName(target)]));
}

function txtRecord(name, strings) {
  const parts = strings.map((s) => Buffer.concat([Buffer.from([s.length]), Buffer.from(s)]));
  return record(name, TYPES.TXT, Buffer.concat(parts));
}

// ── Name encoding ───────────────────────────────────────────────────────────

test('names encode as length-prefixed labels ending in a zero byte', () => {
  const encoded = encodeName('nas.local');
  assert.deepEqual([...encoded], [3, 110, 97, 115, 5, 108, 111, 99, 97, 108, 0]);
});

test('a label longer than 63 bytes is refused rather than truncated', () => {
  assert.throws(() => encodeName(`${'a'.repeat(64)}.local`), /exceeds 63/);
});

test('a query sets the unicast-response bit only when asked', () => {
  const multicast = encodeQuery('_ipp._tcp.local', TYPES.PTR);
  const unicast = encodeQuery('_ipp._tcp.local', TYPES.PTR, { unicastResponse: true });
  assert.equal(multicast.readUInt16BE(multicast.length - 2), 0x0001);
  assert.equal(unicast.readUInt16BE(unicast.length - 2), 0x8001);
});

// ── Decoding good packets ───────────────────────────────────────────────────

test('an A record decodes to a dotted address', () => {
  const packet = Buffer.concat([header({ answers: 1 }), aRecord('nas.local', '192.168.0.50')]);
  const { records } = decodeMessage(packet);
  assert.equal(records.length, 1);
  assert.equal(records[0].name, 'nas.local');
  assert.equal(records[0].data, '192.168.0.50');
});

test('SRV records yield a port and a target host', () => {
  const packet = Buffer.concat([
    header({ answers: 1 }),
    srvRecord('Study Printer._ipp._tcp.local', 631, 'printer.local'),
  ]);
  const { records } = decodeMessage(packet);
  assert.equal(records[0].data.port, 631);
  assert.equal(records[0].data.target, 'printer.local');
});

test('TXT records decode into their component strings', () => {
  const packet = Buffer.concat([
    header({ answers: 1 }),
    txtRecord('printer._ipp._tcp.local', ['ty=Office Printer', 'rp=ipp/print']),
  ]);
  const { records } = decodeMessage(packet);
  assert.deepEqual(records[0].data, ['ty=Office Printer', 'rp=ipp/print']);
});

test('the question section is walked, not assumed to be absent', () => {
  // A response that echoes the question must still yield its answer. Getting
  // this wrong shifts every subsequent offset and decodes nothing.
  const question = Buffer.concat([encodeName('_ipp._tcp.local'), Buffer.from([0, 12, 0, 1])]);
  const packet = Buffer.concat([
    header({ questions: 1, answers: 1 }),
    question,
    aRecord('printer.local', '192.168.0.7'),
  ]);
  const { records } = decodeMessage(packet);
  assert.equal(records.length, 1);
  assert.equal(records[0].data, '192.168.0.7');
});

test('records in the additional section are read as well as answers', () => {
  // Most responders put the A record in additionals — ignoring that section
  // would mean discovering service names with no address to attach them to.
  const packet = Buffer.concat([
    header({ answers: 1, additionals: 1 }),
    ptrRecord('_ipp._tcp.local', 'Study._ipp._tcp.local'),
    aRecord('printer.local', '192.168.0.7'),
  ]);
  const { records } = decodeMessage(packet);
  assert.equal(records.length, 2);
});

test('a compressed name is followed to its target', () => {
  const packet = Buffer.concat([
    header({ answers: 2 }),
    aRecord('nas.local', '192.168.0.50'),          // 'nas.local' starts at offset 12
    Buffer.concat([
      Buffer.from([0xc0, 12]),                      // pointer back to offset 12
      (() => { const t = Buffer.alloc(10); t.writeUInt16BE(TYPES.A, 0); t.writeUInt16BE(1, 2); t.writeUInt32BE(120, 4); t.writeUInt16BE(4, 8); return t; })(),
      Buffer.from([192, 168, 0, 51]),
    ]),
  ]);
  const { records } = decodeMessage(packet);
  assert.equal(records.length, 2);
  assert.equal(records[1].name, 'nas.local', 'the compressed name should resolve');
  assert.equal(records[1].data, '192.168.0.51');
});

// ── Hostile and malformed packets ───────────────────────────────────────────

test('a self-referential compression pointer does not hang', () => {
  // Two bytes that, parsed naively, loop forever. This is the cheapest denial
  // of service any device on the network could attempt.
  const packet = Buffer.concat([header({ answers: 1 }), Buffer.from([0xc0, 12])]);
  const { records } = decodeMessage(packet);
  assert.deepEqual(records, []);
});

test('a forward compression pointer is refused', () => {
  const packet = Buffer.concat([header({ answers: 1 }), Buffer.from([0xc0, 200, 0, 0])]);
  assert.deepEqual(decodeMessage(packet).records, []);
});

test('a mutual pointer loop between two names terminates', () => {
  const body = Buffer.from([0xc0, 14, 0xc0, 12]);   // offset 12 → 14 → 12
  const packet = Buffer.concat([header({ answers: 1 }), body]);
  const { records } = decodeMessage(packet);
  assert.ok(Array.isArray(records), 'parsing must return rather than loop');
});

test('a record claiming more data than the packet holds is dropped', () => {
  const name = encodeName('nas.local');
  const tail = Buffer.alloc(10);
  tail.writeUInt16BE(TYPES.A, 0);
  tail.writeUInt16BE(1, 2);
  tail.writeUInt32BE(120, 4);
  tail.writeUInt16BE(60000, 8);          // claims 60 kB of payload
  const packet = Buffer.concat([header({ answers: 1 }), name, tail, Buffer.from([1, 2])]);
  assert.deepEqual(decodeMessage(packet).records, []);
});

test('a header claiming more records than are present stops cleanly', () => {
  const packet = Buffer.concat([header({ answers: 50 }), aRecord('nas.local', '10.0.0.1')]);
  const { records } = decodeMessage(packet);
  assert.equal(records.length, 1, 'one real record, not fifty imagined ones');
});

test('a truncated packet decodes to nothing rather than throwing', () => {
  assert.deepEqual(decodeMessage(Buffer.from([0, 1, 2])).records, []);
  assert.deepEqual(decodeMessage(Buffer.alloc(0)).records, []);
  assert.deepEqual(decodeMessage(null).records, []);
});

test('an oversized packet is rejected outright', () => {
  assert.deepEqual(decodeMessage(Buffer.alloc(20000)).records, []);
});

test('a label with reserved high bits is refused', () => {
  const packet = Buffer.concat([header({ answers: 1 }), Buffer.from([0x80, 1, 2, 3])]);
  assert.deepEqual(decodeMessage(packet).records, []);
});

test('an A record with the wrong payload length yields no address', () => {
  const packet = Buffer.concat([
    header({ answers: 1 }),
    record('nas.local', TYPES.A, Buffer.from([192, 168])),
  ]);
  const { records } = decodeMessage(packet);
  assert.equal(records[0].data, null, 'a two-byte address is not an address');
});

// ── Name interpretation ─────────────────────────────────────────────────────

test('service types are extracted from instance names', () => {
  assert.equal(serviceTypeOf('Study._ipp._tcp.local'), '_ipp._tcp');
  assert.equal(serviceTypeOf('_googlecast._tcp.local'), '_googlecast._tcp');
  assert.equal(serviceTypeOf('nas.local'), null);
});

test('instance labels are unescaped', () => {
  assert.equal(instanceLabelOf('Living Room._airplay._tcp.local'), 'Living Room');
  assert.equal(instanceLabelOf('Jay\\032Office._ipp._tcp.local'), 'Jay Office');
  assert.equal(instanceLabelOf('nas.local'), null);
});

// ── Correlation ─────────────────────────────────────────────────────────────

test('a service instance is joined to an address through its SRV target', () => {
  const packet = Buffer.concat([
    header({ answers: 3 }),
    ptrRecord('_ipp._tcp.local', 'Study Printer._ipp._tcp.local'),
    srvRecord('Study Printer._ipp._tcp.local', 631, 'printer.local'),
    aRecord('printer.local', '192.168.0.7'),
  ]);
  const devices = correlate(decodeMessage(packet).records);
  assert.equal(devices.length, 1);
  assert.equal(devices[0].ip, '192.168.0.7');
  assert.equal(devices[0].hostname, 'printer');
  assert.equal(devices[0].suggestedName, 'Study Printer');
  assert.deepEqual(devices[0].services, ['_ipp._tcp']);
});

test('a host with an address but no services is still reported', () => {
  const packet = Buffer.concat([header({ answers: 1 }), aRecord('nas.local', '192.168.0.50')]);
  const devices = correlate(decodeMessage(packet).records);
  assert.equal(devices.length, 1);
  assert.equal(devices[0].hostname, 'nas');
  assert.equal(devices[0].suggestedName, null);
});

test('an instance whose target has no address is dropped, not guessed at', () => {
  const packet = Buffer.concat([
    header({ answers: 1 }),
    srvRecord('Ghost._airplay._tcp.local', 7000, 'nowhere.local'),
  ]);
  assert.deepEqual(correlate(decodeMessage(packet).records), []);
});

test('multiple services on one address collapse into a single device', () => {
  const packet = Buffer.concat([
    header({ answers: 5 }),
    srvRecord('Study._ipp._tcp.local', 631, 'printer.local'),
    srvRecord('Study._printer._tcp.local', 515, 'printer.local'),
    srvRecord('Study._http._tcp.local', 80, 'printer.local'),
    aRecord('printer.local', '192.168.0.7'),
    aRecord('printer.local', '192.168.0.7'),
  ]);
  const devices = correlate(decodeMessage(packet).records);
  assert.equal(devices.length, 1);
  assert.deepEqual(devices[0].services, ['_http._tcp', '_ipp._tcp', '_printer._tcp']);
});

test('devices come back sorted by address, not by discovery order', () => {
  const packet = Buffer.concat([
    header({ answers: 3 }),
    aRecord('c.local', '192.168.0.100'),
    aRecord('a.local', '192.168.0.9'),
    aRecord('b.local', '192.168.0.20'),
  ]);
  const devices = correlate(decodeMessage(packet).records);
  assert.deepEqual(devices.map((d) => d.ip), ['192.168.0.9', '192.168.0.20', '192.168.0.100']);
});

// ── Suggestions ─────────────────────────────────────────────────────────────
// The safety property of the whole feature: a device that announces itself
// cannot rename anything the user typed.

test('a name the user entered is never suggested away', () => {
  const devices = [{ ip: '10.0.0.5', hostname: 'nas', suggestedName: 'Definitely Not Your NAS', services: [] }];
  const entries = [{ ip: '10.0.0.5', assetName: 'Synology NAS', hostname: 'synology' }];
  const [s] = suggestionsFor(devices, entries);
  assert.equal(s.canFillName, false, 'an existing asset name must be left alone');
  assert.equal(s.canFillHostname, false, 'an existing hostname must be left alone');
  assert.equal(s.currentName, 'Synology NAS');
});

test('a blank field on an existing entry may be filled', () => {
  const devices = [{ ip: '10.0.0.5', hostname: 'nas', suggestedName: 'Study NAS', services: [] }];
  const entries = [{ ip: '10.0.0.5', assetName: '', hostname: '' }];
  const [s] = suggestionsFor(devices, entries);
  assert.equal(s.canFillName, true);
  assert.equal(s.canFillHostname, true);
});

test('a Free placeholder counts as blank, and as not yet known', () => {
  const devices = [{ ip: '10.0.0.5', hostname: 'nas', suggestedName: 'Study NAS', services: [] }];
  const entries = [{ ip: '10.0.0.5', assetName: 'Free' }];
  const [s] = suggestionsFor(devices, entries);
  assert.equal(s.known, false);
  assert.equal(s.canFillName, true);
});

test('a device absent from the inventory is flagged as new', () => {
  const devices = [{ ip: '10.0.0.99', hostname: 'newthing', suggestedName: 'New Thing', services: [] }];
  const [s] = suggestionsFor(devices, []);
  assert.equal(s.inInventory, false);
  assert.equal(s.known, false);
  assert.equal(s.canFillName, true);
});

test('suggestionsFor does not mutate the entries it is given', () => {
  const entries = [{ ip: '10.0.0.5', assetName: '', hostname: '' }];
  const snapshot = JSON.stringify(entries);
  suggestionsFor([{ ip: '10.0.0.5', hostname: 'nas', suggestedName: 'NAS', services: [] }], entries);
  assert.equal(JSON.stringify(entries), snapshot, 'discovery must never write to the inventory');
});

// ── The scan loop ───────────────────────────────────────────────────────────
// Exercised with an injected socket, so the full pipeline — send, receive,
// decode, correlate, close — is covered without needing a network or a real
// device. Without this, the only proof the scan works is running it on a LAN
// that happens to have Apple kit on it.

const { EventEmitter } = require('node:events');
const { scan } = require('../lib/mdns');

class FakeSocket extends EventEmitter {
  constructor({ failMembership = false, replies = [] } = {}) {
    super();
    this.sent = [];
    this.closed = false;
    this.replies = replies;
    this.failMembership = failMembership;
  }
  bind() { setImmediate(() => this.emit('listening')); }
  addMembership() { if (this.failMembership) throw new Error('no multicast here'); }
  setMulticastTTL() {}
  send(buf, _o, _l, _p, _a, cb) {
    this.sent.push(buf);
    // Answer the first query only, the way a single responder would.
    if (this.sent.length === 1) {
      for (const reply of this.replies) setImmediate(() => this.emit('message', reply));
    }
    if (cb) cb(null);
  }
  close() { this.closed = true; }
}

const printerResponse = () => Buffer.concat([
  header({ answers: 3 }),
  ptrRecord('_ipp._tcp.local', 'Study Printer._ipp._tcp.local'),
  srvRecord('Study Printer._ipp._tcp.local', 631, 'printer.local'),
  aRecord('printer.local', '192.168.0.7'),
]);

test('a scan collects responses and returns correlated devices', async () => {
  const socket = new FakeSocket({ replies: [printerResponse()] });
  const result = await scan({ timeoutMs: 500, createSocket: () => socket });
  assert.equal(result.devices.length, 1);
  assert.equal(result.devices[0].ip, '192.168.0.7');
  assert.equal(result.devices[0].suggestedName, 'Study Printer');
  assert.ok(socket.closed, 'the socket must be closed when the scan finishes');
});

test('a scan sends the service enumeration query and the common types', async () => {
  const socket = new FakeSocket();
  await scan({ timeoutMs: 300, createSocket: () => socket });
  assert.ok(socket.sent.length > 1, 'expected the meta-query plus batched service queries');
  assert.ok(socket.sent[0].includes(Buffer.from('_services')), 'first query should enumerate services');
});

test('a scan finishes even when nothing answers', async () => {
  const result = await scan({ timeoutMs: 300, createSocket: () => new FakeSocket() });
  assert.deepEqual(result.devices, []);
  assert.equal(result.error, undefined);
});

test('a scan survives an undecodable packet without failing', async () => {
  // One broken device on the network must not take discovery down for the rest.
  const socket = new FakeSocket({ replies: [Buffer.from([0xff, 0xff, 0xff]), printerResponse()] });
  const result = await scan({ timeoutMs: 500, createSocket: () => socket });
  assert.equal(result.devices.length, 1, 'the good response should still be used');
});

test('a scan falls back to unicast queries when multicast is unavailable', async () => {
  // Binding alongside Avahi, or a container without multicast, must degrade
  // rather than fail — this is the common case in an LXC.
  const socket = new FakeSocket({ failMembership: true, replies: [printerResponse()] });
  const result = await scan({ timeoutMs: 500, createSocket: () => socket });
  const qclass = socket.sent[0].readUInt16BE(socket.sent[0].length - 2);
  assert.equal(qclass, 0x8001, 'should request a unicast response');
  assert.equal(result.devices.length, 1);
});

test('a socket error resolves the scan instead of leaving it pending', async () => {
  // A scan that never resolves would leave the endpoint returning 409 forever.
  const socket = new FakeSocket();
  const promise = scan({ timeoutMs: 5000, createSocket: () => socket });
  setImmediate(() => socket.emit('error', new Error('EACCES')));
  const result = await promise;
  assert.match(result.error, /EACCES/);
  assert.deepEqual(result.devices, []);
});

test('a scan that cannot open a socket at all reports the failure', async () => {
  const result = await scan({
    timeoutMs: 300,
    createSocket: () => { throw new Error('no sockets'); },
  });
  assert.match(result.error, /no sockets/);
});

test('records are capped so a chatty network cannot exhaust memory', async () => {
  const flood = Array.from({ length: 200 }, () => Buffer.concat([
    header({ answers: 40 }),
    ...Array.from({ length: 40 }, (_, i) => aRecord(`h${i}.local`, `10.0.0.${i + 1}`)),
  ]));
  const socket = new FakeSocket({ replies: flood });
  const result = await scan({ timeoutMs: 800, createSocket: () => socket });
  assert.ok(result.recordCount <= 4096, `record count should be capped, got ${result.recordCount}`);
});
