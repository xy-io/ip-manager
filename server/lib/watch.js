// ============================================================
//  Network Watch — the device ledger (phase 1)
//
//  A record of every distinct device identity seen on the network, so the app
//  can tell "a device I have never seen" from "a device that changed address".
//  Phase 1 observes and reports. It raises no alerts and sends no
//  notifications; that is phase 2.
//
//  ── Storage is the design constraint ──────────────────────────────────────
//  Pi.Alert keeps a sessions table with a row per connect and disconnect, so
//  its database grows with *time* and never stops. That is the mistake this
//  module exists to avoid.
//
//  Here there is exactly one row per identity, updated in place. Storage is
//  therefore O(distinct devices), not O(time): a network of 90 devices costs
//  the same after three years as it does after a week. On top of that:
//
//    * a hard cap on identity count, with eviction when it is reached
//    * caps on every array and string inside a record, so one record cannot
//      grow without limit either
//    * age-based pruning, aggressive for randomised MACs and lenient for real
//      ones
//    * a byte ceiling checked on write, as a backstop for all of the above
//
//  Nothing is written at all while the feature is switched off.
// ============================================================

'use strict';

const { virtualPlatform } = require('./net');

// ── Limits ──────────────────────────────────────────────────────────────────
// Chosen so a home network never approaches them and a hostile one cannot pass
// them. At ~250 bytes per record, 1000 identities is roughly 250 kB.
const MAX_IDENTITIES = 1000;
const MAX_IPS_PER_IDENTITY = 5;
const MAX_SERVICES_PER_IDENTITY = 8;
const MAX_STRING = 64;
const MAX_LEDGER_BYTES = 512 * 1024;   // 512 kB backstop

const DEFAULT_CONFIG = {
  enabled: false,             // opt-in: nothing happens until this is true
  retainRandomDays: 14,       // randomised MACs are transient by nature
  retainKnownDays: 180,       // real hardware is worth remembering longer
  maxIdentities: MAX_IDENTITIES,
};

const clampString = (value, max = MAX_STRING) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max) : text;
};

// ── MAC handling ────────────────────────────────────────────────────────────

const MAC_PATTERN = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/;

/** Normalise to lowercase colon-separated form, or null if it is not a MAC. */
function normaliseMac(mac) {
  if (!mac) return null;
  const hex = String(mac).replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (hex.length !== 12) return null;
  const formatted = hex.match(/.{2}/g).join(':');
  if (!MAC_PATTERN.test(formatted)) return null;
  if (formatted === '00:00:00:00:00:00' || formatted === 'ff:ff:ff:ff:ff:ff') return null;
  return formatted;
}

/**
 * Is this a randomised (locally administered) address rather than a real
 * burned-in one?
 *
 * The second-least-significant bit of the first octet is the locally
 * administered flag. iOS and Android set it when they randomise their MAC per
 * network, which is why a MAC-only tool reports every phone rejoin as a new
 * device. Detecting it is the single cheapest noise reduction available, and
 * Pi.Alert does not do it.
 */
function isRandomisedMac(mac) {
  const normalised = normaliseMac(mac);
  if (!normalised) return false;
  return (parseInt(normalised.slice(0, 2), 16) & 0x02) !== 0;
}

// ── Ledger records ──────────────────────────────────────────────────────────

/**
 * Fold one sighting into an existing record, or create one.
 *
 * Everything here is bounded: arrays are capped and de-duplicated, strings are
 * truncated, and the sighting *count* is incremented rather than a sighting
 * being appended. That last point is what keeps storage flat over time.
 */
function applySighting(existing, sighting, now) {
  const mac = normaliseMac(sighting.mac);
  if (!mac) return null;

  const record = existing ? { ...existing } : {
    mac,
    random: isRandomisedMac(mac),
    firstSeen: now,
    sightings: 0,
    ips: [],
    services: [],
    vendor: null,
    hostname: null,
    name: null,
  };

  record.lastSeen = now;
  // A counter, not a list. This is the difference between storage that is flat
  // over time and storage that grows with every scan for ever.
  record.sightings = Math.min((record.sightings || 0) + 1, Number.MAX_SAFE_INTEGER);

  if (sighting.ip) {
    // Most recent address first, de-duplicated, capped.
    record.ips = [sighting.ip, ...(record.ips || []).filter((ip) => ip !== sighting.ip)]
      .slice(0, MAX_IPS_PER_IDENTITY);
  }

  if (Array.isArray(sighting.services) && sighting.services.length) {
    const merged = new Set([...(record.services || []), ...sighting.services]);
    record.services = [...merged].slice(0, MAX_SERVICES_PER_IDENTITY).sort();
  }

  // Later observations win for these, because a name learned from mDNS is
  // better than one inferred from a reverse lookup, and vendors do not change.
  if (sighting.vendor) record.vendor = clampString(sighting.vendor);
  if (sighting.hostname) record.hostname = clampString(sighting.hostname);
  if (sighting.name) record.name = clampString(sighting.name);
  // Recorded separately from `hostname` so the view can say where a name came
  // from: "this is what it told your DHCP server it was called".
  if (sighting.dhcpName) record.dhcpName = clampString(sighting.dhcpName);
  // Sticky once seen: a duplicate ARP reply is worth remembering even if the
  // next sweep happens not to catch it.
  if (sighting.duplicate) record.duplicateArp = true;

  return record;
}

// ── Pruning and eviction ────────────────────────────────────────────────────

const daysBetween = (laterIso, earlierIso) =>
  (new Date(laterIso).getTime() - new Date(earlierIso).getTime()) / 86400000;

/**
 * Drop records that have aged out. Randomised addresses go quickly — they are
 * transient by construction and keeping them is what fills a disk. Real
 * hardware is kept far longer, because "I have not seen this in four months"
 * is a useful thing to be able to say.
 *
 * `protectedMacs` are never dropped: an identity currently in the inventory
 * stays regardless of age.
 */
function pruneLedger(records, config, now, protectedMacs = new Set()) {
  const { retainRandomDays, retainKnownDays } = { ...DEFAULT_CONFIG, ...config };
  return records.filter((record) => {
    if (protectedMacs.has(record.mac)) return true;
    const age = daysBetween(now, record.lastSeen);
    const limit = record.random ? retainRandomDays : retainKnownDays;
    return age <= limit;
  });
}

/**
 * Enforce the identity cap. Eviction order is deliberate: randomised addresses
 * go before real ones, and within each group the least recently seen goes
 * first. Identities in the inventory are never evicted — a cap must not be
 * able to delete a device the user is actually tracking.
 */
function evictToCap(records, cap, protectedMacs = new Set()) {
  const limit = Math.max(1, Math.min(cap || MAX_IDENTITIES, MAX_IDENTITIES));
  if (records.length <= limit) return records;

  const kept = records.filter((r) => protectedMacs.has(r.mac));
  const evictable = records.filter((r) => !protectedMacs.has(r.mac));

  // Best to keep last: real addresses ahead of randomised ones, then most
  // recently seen ahead of least.
  evictable.sort((a, b) => {
    if (a.random !== b.random) return a.random ? 1 : -1;
    return new Date(b.lastSeen) - new Date(a.lastSeen);
  });

  const room = Math.max(0, limit - kept.length);
  return [...kept, ...evictable.slice(0, room)];
}

/**
 * Approximate stored size, so the UI can show what this is costing.
 *
 * An empty ledger is reported as 0 rather than the 2 bytes of "[]", because
 * when the feature is off no row is written at all — claiming otherwise would
 * undercut the one number a user checks to confirm it is costing them nothing.
 */
function ledgerBytes(records) {
  if (!records || records.length === 0) return 0;
  try { return Buffer.byteLength(JSON.stringify(records), 'utf8'); }
  catch { return 0; }
}

/**
 * Fold a batch of sightings into the ledger and apply every bound.
 *
 * Pure: takes the current records, returns the new ones. Nothing here reads or
 * writes the database, which is what makes the growth behaviour testable
 * without waiting three years to see it.
 */
function recordSightings(records, sightings, {
  config = DEFAULT_CONFIG,
  now = new Date().toISOString(),
  protectedMacs = new Set(),
} = {}) {
  const byMac = new Map((records || []).map((r) => [r.mac, r]));

  for (const sighting of sightings || []) {
    const mac = normaliseMac(sighting && sighting.mac);
    if (!mac) continue;                       // no MAC, no identity
    const updated = applySighting(byMac.get(mac), sighting, now);
    if (updated) byMac.set(mac, updated);
  }

  let next = pruneLedger([...byMac.values()], config, now, protectedMacs);
  next = evictToCap(next, config.maxIdentities, protectedMacs);

  // Backstop. If the caps above somehow still leave an oversized ledger, shed
  // the least valuable records until it fits rather than writing it anyway.
  while (next.length > 1 && ledgerBytes(next) > MAX_LEDGER_BYTES) {
    next = evictToCap(next, next.length - Math.ceil(next.length * 0.1), protectedMacs);
  }

  next.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
  return next;
}

// ── Presentation ────────────────────────────────────────────────────────────

/**
 * Decorate the ledger for display: which identities correspond to inventory
 * entries, and which do not.
 *
 * Phase 1 only describes. It deliberately does not decide that anything is
 * suspicious, because acting on that judgement is phase 2 and the judgement
 * should be watched before it is trusted.
 */
function describeLedger(records, entries = [], now = new Date().toISOString()) {
  const byIp = new Map((entries || [])
    .filter((e) => e && e.ip && e.assetName !== 'Free' && e.assetName !== 'Reserved')
    .map((e) => [e.ip, e]));

  return (records || []).map((record) => {
    const currentIp = record.ips && record.ips[0] ? record.ips[0] : null;
    const entry = currentIp ? byIp.get(currentIp) : null;
    return {
      ...record,
      // Derived at display time rather than stored: the mapping improves as
      // prefixes are added, and it is a property of the MAC, not an observation.
      platform: virtualPlatform(record.mac),
      currentIp,
      inInventory: !!entry,
      inventoryName: entry ? entry.assetName || entry.hostname || null : null,
      daysSinceSeen: Math.floor(daysBetween(now, record.lastSeen)),
      // A device seen once, days ago, is different from one seen constantly.
      transient: (record.sightings || 0) <= 2,
    };
  });
}

/** Which MACs correspond to devices in the inventory, and so must never be evicted. */
function protectedMacsFor(records, entries) {
  const trackedIps = new Set((entries || [])
    .filter((e) => e && e.ip && e.assetName !== 'Free' && e.assetName !== 'Reserved')
    .map((e) => e.ip));
  const macs = new Set();
  for (const record of records || []) {
    if ((record.ips || []).some((ip) => trackedIps.has(ip))) macs.add(record.mac);
  }
  return macs;
}

/** Headline numbers for the view and the status endpoint. */
function summarise(records, entries = []) {
  const described = describeLedger(records, entries);
  return {
    total: described.length,
    known: described.filter((d) => d.inInventory).length,
    unknown: described.filter((d) => !d.inInventory && !d.random).length,
    randomised: described.filter((d) => d.random).length,
    bytes: ledgerBytes(records),
    capacity: MAX_IDENTITIES,
  };
}

module.exports = {
  normaliseMac,
  isRandomisedMac,
  applySighting,
  recordSightings,
  pruneLedger,
  evictToCap,
  ledgerBytes,
  describeLedger,
  protectedMacsFor,
  summarise,
  DEFAULT_CONFIG,
  LIMITS: {
    MAX_IDENTITIES,
    MAX_IPS_PER_IDENTITY,
    MAX_SERVICES_PER_IDENTITY,
    MAX_STRING,
    MAX_LEDGER_BYTES,
  },
};
