// ============================================================
//  mDNS / DNS-SD discovery
//
//  Asks the local network what it is called. Apple devices, printers,
//  Chromecasts, most NAS boxes and anything running Avahi announce themselves
//  over multicast DNS, which gives us friendly names for IPs that an ARP sweep
//  can only report as MAC addresses.
//
//  ── A note on trust ───────────────────────────────────────────────────────
//  Everything decoded here arrives unsolicited from the local network. Any
//  device on the LAN — including a compromised one — can send whatever bytes it
//  likes to this parser. It is therefore written to be hostile-input safe:
//
//    * every read is bounds-checked against the buffer before it happens
//    * name compression pointers are followed with a strict budget, because a
//      pointer that references itself is a two-byte denial of service
//    * record counts and name lengths are capped regardless of what the header
//      claims, so a lying length field cannot make us allocate or loop
//    * a malformed record ends parsing of that packet rather than throwing
//
//  Nothing discovered is ever written to the inventory automatically. The scan
//  produces *suggestions*, which a human accepts or ignores. A device that
//  announces itself as "Router" does not get to rename your router.
// ============================================================

'use strict';

const dgram = require('node:dgram');

const MDNS_ADDRESS = '224.0.0.251';
const MDNS_PORT = 5353;

// Record types we understand. Anything else is skipped, not guessed at.
const TYPE_A = 1;
const TYPE_PTR = 12;
const TYPE_TXT = 16;
const TYPE_AAAA = 28;
const TYPE_SRV = 33;

// The DNS-SD meta-query: "what kinds of service exist here?"
const SERVICE_ENUMERATION = '_services._dns-sd._udp.local';

// Asked directly, because plenty of devices answer a specific query while
// ignoring the meta-query. These cover the things a home network actually has.
const COMMON_SERVICES = [
  '_airplay._tcp.local',      // Apple TV, HomePod, AirPlay speakers
  '_raop._tcp.local',         // AirPlay audio
  '_companion-link._tcp.local', // Apple devices
  '_googlecast._tcp.local',   // Chromecast, Google/Nest speakers
  '_ipp._tcp.local',          // printers
  '_ipps._tcp.local',
  '_printer._tcp.local',
  '_pdl-datastream._tcp.local',
  '_smb._tcp.local',          // NAS and file shares
  '_afpovertcp._tcp.local',
  '_nfs._tcp.local',
  '_ssh._tcp.local',
  '_sftp-ssh._tcp.local',
  '_http._tcp.local',
  '_https._tcp.local',
  '_workstation._tcp.local',  // Avahi on Linux hosts
  '_device-info._tcp.local',
  '_homekit._tcp.local',
  '_hap._tcp.local',          // HomeKit accessories
  '_esphomelib._tcp.local',   // ESPHome
  '_hue._tcp.local',
  '_spotify-connect._tcp.local',
];

// ── Limits ──────────────────────────────────────────────────────────────────
// Every one of these exists to bound what a hostile or broken packet can cost
// us. They are deliberately generous compared with real traffic.
const MAX_PACKET = 9000;        // a jumbo frame; real mDNS is far smaller
const MAX_NAME_LENGTH = 255;    // RFC 1035 limit on a domain name
const MAX_LABEL_LENGTH = 63;    // RFC 1035 limit on a single label
const MAX_POINTER_HOPS = 16;    // a compression loop never survives this
const MAX_RECORDS = 256;        // per packet, whatever the header claims

// ── Name encoding ───────────────────────────────────────────────────────────

/** Encode a dotted name as length-prefixed labels ending in a zero byte. */
function encodeName(name) {
  const parts = String(name).split('.').filter(Boolean);
  const chunks = [];
  for (const part of parts) {
    const label = Buffer.from(part, 'utf8');
    if (label.length > MAX_LABEL_LENGTH) {
      throw new Error(`label "${part}" exceeds ${MAX_LABEL_LENGTH} bytes`);
    }
    chunks.push(Buffer.from([label.length]), label);
  }
  chunks.push(Buffer.from([0]));
  return Buffer.concat(chunks);
}

/**
 * Read a name starting at `offset`, following compression pointers.
 *
 * Returns { name, offset } where `offset` is the position after the name *in
 * the record stream* — following a pointer does not advance the caller, which
 * is the detail that makes compressed names work.
 *
 * Returns null on anything malformed rather than throwing, so one bad record
 * cannot abort a packet that is otherwise useful.
 */
function readName(buffer, offset) {
  const labels = [];
  let hops = 0;
  let cursor = offset;
  let afterPointer = null;   // where the caller resumes, once we have jumped
  let totalLength = 0;

  for (;;) {
    if (cursor < 0 || cursor >= buffer.length) return null;
    const length = buffer[cursor];

    // 0x00 — end of the name.
    if (length === 0) {
      cursor += 1;
      return { name: labels.join('.'), offset: afterPointer !== null ? afterPointer : cursor };
    }

    // 0xC0 — the top two bits set mark a pointer to an earlier name.
    if ((length & 0xc0) === 0xc0) {
      if (cursor + 1 >= buffer.length) return null;
      if (++hops > MAX_POINTER_HOPS) return null;   // compression loop
      const target = ((length & 0x3f) << 8) | buffer[cursor + 1];
      // A pointer must point strictly backwards. Forward or self-referential
      // pointers are the shape a loop takes, and no legitimate encoder emits
      // one, so refusing them costs nothing.
      if (target >= cursor) return null;
      if (afterPointer === null) afterPointer = cursor + 2;
      cursor = target;
      continue;
    }

    // Anything else with high bits set is reserved and not something we parse.
    if ((length & 0xc0) !== 0) return null;

    if (length > MAX_LABEL_LENGTH) return null;
    if (cursor + 1 + length > buffer.length) return null;
    totalLength += length + 1;
    if (totalLength > MAX_NAME_LENGTH) return null;

    labels.push(buffer.toString('utf8', cursor + 1, cursor + 1 + length));
    cursor += 1 + length;
  }
}

// ── Message decoding ────────────────────────────────────────────────────────

/**
 * Decode an mDNS response into a flat list of records.
 * Returns { records: [...] } — never throws, never partially trusts a header.
 */
function decodeMessage(buffer) {
  const records = [];
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.length > MAX_PACKET) {
    return { records };
  }

  const counts = {
    questions:   buffer.readUInt16BE(4),
    answers:     buffer.readUInt16BE(6),
    authorities: buffer.readUInt16BE(8),
    additionals: buffer.readUInt16BE(10),
  };

  let offset = 12;

  // Skip the question section. Its names are compressed too, so it has to be
  // walked rather than jumped over.
  for (let i = 0; i < Math.min(counts.questions, MAX_RECORDS); i += 1) {
    const parsed = readName(buffer, offset);
    if (!parsed) return { records };
    offset = parsed.offset + 4;              // QTYPE + QCLASS
    if (offset > buffer.length) return { records };
  }

  const total = Math.min(
    counts.answers + counts.authorities + counts.additionals,
    MAX_RECORDS
  );

  for (let i = 0; i < total; i += 1) {
    const parsed = readName(buffer, offset);
    if (!parsed) break;
    offset = parsed.offset;
    if (offset + 10 > buffer.length) break;

    const type = buffer.readUInt16BE(offset);
    const ttl = buffer.readUInt32BE(offset + 4);
    const dataLength = buffer.readUInt16BE(offset + 8);
    offset += 10;

    // The length field is attacker-controlled. Believe it only if the bytes
    // are actually present.
    if (dataLength < 0 || offset + dataLength > buffer.length) break;

    const record = { name: parsed.name, type, ttl, data: null };

    switch (type) {
      case TYPE_A:
        if (dataLength === 4) {
          record.data = `${buffer[offset]}.${buffer[offset + 1]}.${buffer[offset + 2]}.${buffer[offset + 3]}`;
        }
        break;

      case TYPE_AAAA:
        // Recorded so the record is not mistaken for absent, but IPv6 is not
        // part of the inventory yet, so nothing consumes it.
        if (dataLength === 16) record.data = null;
        break;

      case TYPE_PTR: {
        const target = readName(buffer, offset);
        record.data = target ? target.name : null;
        break;
      }

      case TYPE_SRV: {
        if (dataLength >= 7) {
          const target = readName(buffer, offset + 6);
          record.data = target ? { port: buffer.readUInt16BE(offset + 4), target: target.name } : null;
        }
        break;
      }

      case TYPE_TXT: {
        // TXT is a sequence of length-prefixed strings. Walked with the same
        // suspicion as everything else.
        const entries = [];
        let cursor = offset;
        const end = offset + dataLength;
        while (cursor < end) {
          const length = buffer[cursor];
          if (cursor + 1 + length > end) break;
          entries.push(buffer.toString('utf8', cursor + 1, cursor + 1 + length));
          cursor += 1 + length;
        }
        record.data = entries;
        break;
      }

      default:
        break;
    }

    records.push(record);
    offset += dataLength;
  }

  return { records };
}

/** Build a query packet for one or more names. */
function encodeQuery(names, type = TYPE_PTR, { unicastResponse = false } = {}) {
  const list = Array.isArray(names) ? names : [names];
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0);                  // ID — zero for multicast DNS
  header.writeUInt16BE(0, 2);                  // flags — standard query
  header.writeUInt16BE(list.length, 4);        // question count

  // The top bit of QCLASS is the "unicast response wanted" flag. Set when we
  // could not bind port 5353 and therefore cannot hear multicast replies.
  const qclass = unicastResponse ? 0x8001 : 0x0001;

  const questions = list.map((name) => {
    const encoded = encodeName(name);
    const tail = Buffer.alloc(4);
    tail.writeUInt16BE(type, 0);
    tail.writeUInt16BE(qclass, 2);
    return Buffer.concat([encoded, tail]);
  });

  return Buffer.concat([header, ...questions]);
}

// ── Correlation ─────────────────────────────────────────────────────────────

const stripLocal = (name) => String(name || '').replace(/\.local\.?$/i, '');

/** The service type from an instance name: "Study._ipp._tcp.local" → "_ipp._tcp". */
function serviceTypeOf(name) {
  const match = String(name || '').match(/(_[^.]+\._(?:tcp|udp))\.local\.?$/i);
  return match ? match[1].toLowerCase() : null;
}

/** The human-facing part of an instance name: "Study Printer._ipp._tcp.local" → "Study Printer". */
function instanceLabelOf(name) {
  const match = String(name || '').match(/^(.+?)\._[^.]+\._(?:tcp|udp)\.local\.?$/i);
  if (!match) return null;
  // DNS-SD escapes dots and spaces in instance names.
  return match[1].replace(/\\([.\\])/g, '$1').replace(/\\032/g, ' ').trim() || null;
}

/**
 * Fold a pile of records from many responses into one entry per IP address.
 *
 * The join is: A record gives hostname → IP. SRV record gives instance →
 * hostname. PTR record gives service type → instance. Chaining those backwards
 * turns "192.168.0.42" into "Study Printer, a printer".
 */
function correlate(records) {
  const addressOf = new Map();     // hostname → ip
  const srvTargets = new Map();    // instance name → hostname
  const instances = new Set();

  for (const record of records) {
    if (record.type === TYPE_A && record.data) {
      addressOf.set(String(record.name).toLowerCase(), record.data);
    } else if (record.type === TYPE_SRV && record.data && record.data.target) {
      srvTargets.set(record.name, String(record.data.target).toLowerCase());
      instances.add(record.name);
    } else if (record.type === TYPE_PTR && record.data && serviceTypeOf(record.data)) {
      instances.add(record.data);
    }
  }

  const byIp = new Map();
  const ensure = (ip) => {
    if (!byIp.has(ip)) byIp.set(ip, { ip, hostname: null, names: [], services: [] });
    return byIp.get(ip);
  };

  // Hostnames first, so every host with an address exists even if it advertises
  // no services at all.
  for (const [hostname, ip] of addressOf) {
    ensure(ip).hostname = stripLocal(hostname);
  }

  for (const instance of instances) {
    const target = srvTargets.get(instance);
    const ip = target ? addressOf.get(target) : null;
    if (!ip) continue;                      // an instance we cannot place
    const entry = ensure(ip);
    const service = serviceTypeOf(instance);
    const label = instanceLabelOf(instance);
    if (service && !entry.services.includes(service)) entry.services.push(service);
    if (label && !entry.names.includes(label)) entry.names.push(label);
  }

  for (const entry of byIp.values()) {
    entry.services.sort();
    // The longest instance name is generally the most descriptive: "Kitchen
    // HomePod" beats "HomePod". A weak heuristic, but this only ever produces
    // a suggestion someone else confirms.
    entry.suggestedName = entry.names.slice().sort((a, b) => b.length - a.length)[0] || null;
  }

  return [...byIp.values()].sort((a, b) => {
    const pa = a.ip.split('.').map(Number);
    const pb = b.ip.split('.').map(Number);
    for (let i = 0; i < 4; i += 1) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
  });
}

// ── Scanning ────────────────────────────────────────────────────────────────

/**
 * Run one discovery sweep and resolve with the devices found.
 *
 * Deliberately a one-shot scan rather than a background listener. A listener
 * would find marginally more, at the cost of a socket held open for the life of
 * the process and a failure mode nobody would ever notice — the quiet kind of
 * bug that is worst in a self-hosted app.
 *
 * `createSocket` is injectable so the scan logic can be tested without a
 * network.
 */
function scan({ timeoutMs = 4000, createSocket = null, logger = null } = {}) {
  return new Promise((resolve) => {
    const records = [];
    let settled = false;
    let socket;

    const note = (message) => { if (logger) logger(message); };

    const finish = (extra = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket && socket.close(); } catch { /* already closed */ }
      resolve({ devices: correlate(records), recordCount: records.length, ...extra });
    };

    const timer = setTimeout(finish, Math.min(30000, Math.max(500, timeoutMs)));

    try {
      socket = createSocket
        ? createSocket()
        : dgram.createSocket({ type: 'udp4', reuseAddr: true });
    } catch (err) {
      return finish({ error: `Could not open a socket: ${err.message}` });
    }

    socket.on('error', (err) => finish({ error: `mDNS socket error: ${err.message}` }));

    socket.on('message', (message) => {
      if (settled) return;
      try {
        const decoded = decodeMessage(message);
        // Cap the total across the whole scan, not just per packet: a chatty
        // or hostile network cannot grow this without bound.
        for (const record of decoded.records) {
          if (records.length >= 4096) break;
          records.push(record);
        }
      } catch (err) {
        // A packet we cannot parse is a packet we ignore. It is not a reason to
        // fail the scan — one broken device would take discovery down for the
        // whole network.
        note(`mDNS: ignoring an undecodable packet (${err.message})`);
      }
    });

    socket.on('listening', () => {
      // Binding 5353 lets us hear multicast replies, which is much the better
      // outcome. It can fail when Avahi already holds the port, so we ask for
      // unicast replies instead and carry on with reduced coverage rather than
      // failing the feature outright.
      let unicastResponse = true;
      try {
        socket.addMembership(MDNS_ADDRESS);
        socket.setMulticastTTL(255);
        unicastResponse = false;
      } catch (err) {
        note(`mDNS: multicast join failed (${err.message}); asking for unicast replies`);
      }

      const send = (names) => {
        let packet;
        try {
          packet = encodeQuery(names, TYPE_PTR, { unicastResponse });
        } catch (err) {
          return note(`mDNS: skipping a malformed query (${err.message})`);
        }
        socket.send(packet, 0, packet.length, MDNS_PORT, MDNS_ADDRESS, (err) => {
          if (err) note(`mDNS: send failed (${err.message})`);
        });
      };

      send([SERVICE_ENUMERATION]);
      // Questions are split across packets: some stacks silently drop a query
      // carrying a large number of questions.
      for (let i = 0; i < COMMON_SERVICES.length; i += 4) {
        send(COMMON_SERVICES.slice(i, i + 4));
      }
    });

    try {
      socket.bind({ port: MDNS_PORT, exclusive: false });
    } catch (err) {
      note(`mDNS: could not bind ${MDNS_PORT} (${err.message}); using an ephemeral port`);
      try {
        socket.bind();
      } catch (bindErr) {
        finish({ error: `Could not bind a socket: ${bindErr.message}` });
      }
    }
  });
}

/**
 * Match discovered devices against the inventory and describe what could be
 * filled in. Produces suggestions only — this function never mutates entries.
 */
function suggestionsFor(devices, entries) {
  const byIp = new Map((entries || []).filter((e) => e && e.ip).map((e) => [e.ip, e]));
  const isPlaceholder = (e) => e.assetName === 'Free' || e.assetName === 'Reserved';

  return (devices || []).map((device) => {
    const entry = byIp.get(device.ip);
    const known = !!entry && !isPlaceholder(entry);

    // Only ever offer to fill a blank or replace a value the app itself would
    // have written. A name the user typed is never something we suggest away.
    const hostnameIsBlank = !entry || !entry.hostname;
    const nameIsBlank = !entry || !entry.assetName || isPlaceholder(entry);

    return {
      ip: device.ip,
      hostname: device.hostname,
      suggestedName: device.suggestedName,
      services: device.services,
      known,
      inInventory: !!entry,
      currentName: entry ? entry.assetName || null : null,
      currentHostname: entry ? entry.hostname || null : null,
      canFillHostname: !!device.hostname && hostnameIsBlank
        && (!entry || entry.hostname !== device.hostname),
      canFillName: !!device.suggestedName && nameIsBlank,
    };
  });
}

module.exports = {
  scan,
  decodeMessage,
  encodeQuery,
  encodeName,
  readName,
  correlate,
  suggestionsFor,
  serviceTypeOf,
  instanceLabelOf,
  stripLocal,
  COMMON_SERVICES,
  SERVICE_ENUMERATION,
  TYPES: { A: TYPE_A, PTR: TYPE_PTR, TXT: TYPE_TXT, AAAA: TYPE_AAAA, SRV: TYPE_SRV },
};
