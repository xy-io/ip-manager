// ============================================================
//  Network helpers — pure functions, no state, no side effects
//
//  Extracted from index.js so they can be unit-tested directly. Requiring
//  index.js starts a listening server, which makes anything defined there
//  untestable in isolation.
// ============================================================

'use strict';

// ── Subnet and interface validation ──────────────────────────────────────────
// arp-scan is invoked with execFile and an argument array, never a shell
// string, so nothing supplied by a caller can be interpreted as shell syntax.
// These validators are belt-and-braces: they also stop a malformed subnet
// reaching arp-scan at all, which produces a clearer error than a scan failure.

// Accepts "192.168", "192.168.1", "10.0.0.0/8" and returns a normalised CIDR,
// or null if the input is not a plain dotted-decimal network.
//   "192.168"     → "192.168.0.0/16"
//   "192.168.1"   → "192.168.1.0/24"
function normaliseSubnetToCidr(subnet) {
  const raw = String(subnet == null ? '' : subnet).trim();
  if (!/^[0-9]{1,3}(\.[0-9]{1,3}){1,3}(\/[0-9]{1,2})?$/.test(raw)) return null;

  let [addr, prefix] = raw.split('/');
  const octets = addr.split('.');
  if (octets.some((o) => Number(o) > 255)) return null;

  if (prefix === undefined) {
    if (octets.length === 2)      { addr = `${addr}.0.0`; prefix = '16'; }
    else if (octets.length === 3) { addr = `${addr}.0`;   prefix = '24'; }
    else                          { prefix = '24'; }
  }
  while (addr.split('.').length < 4) addr += '.0';

  const p = Number(prefix);
  if (!Number.isInteger(p) || p < 8 || p > 32) return null;
  return `${addr}/${p}`;
}

// Network interface names: letters, digits, dot, colon, dash, underscore.
function isValidInterface(iface) {
  return /^[A-Za-z0-9._:-]{1,32}$/.test(String(iface));
}

// Build the arp-scan argument array from subnet + optional interface.
// Returns null when either is invalid, so the caller can reject the request.
function buildArpScanArgs(subnet, iface) {
  const cidr = normaliseSubnetToCidr(subnet);
  if (!cidr) return null;
  const args = [];
  if (iface) {
    if (!isValidInterface(iface)) return null;
    args.push('-I', iface);
  }
  args.push(cidr);
  return args;
}

function buildDiscoveryScanArgs(cidr, iface, bandwidthKbps) {
  const normalised = normaliseSubnetToCidr(cidr);
  if (!normalised) return null;
  const args = [];
  if (iface) {
    if (!isValidInterface(iface)) return null;
    args.push('-I', iface);
  }
  const bw = parseInt(bandwidthKbps, 10);
  if (Number.isInteger(bw) && bw > 0) args.push(`--bandwidth=${bw}K`);
  // No --quiet: it suppresses the OUI vendor decode, and the vendor is worth
  // having. The parser copes with either form regardless, which is what makes
  // this a preference rather than a dependency.
  args.push(normalised);
  return args;
}

// ── Sorting ──────────────────────────────────────────────────────────────────
// Numeric IP sort across all four octets, which matters for /16 networks.
// (The /api/import handler has its own local copy comparing only the last.)
const ipSortKey = (ip) =>
  String(ip || '').split('.').reduce((acc, octet) => (acc * 256) + (parseInt(octet, 10) || 0), 0);
const sortEntriesByIp = (arr) => arr.sort((a, b) => ipSortKey(a.ip) - ipSortKey(b.ip));

const findEntryIndex = (data, ip) => data.findIndex((e) => e.ip === ip);

// ── Status vocabulary ────────────────────────────────────────────────────────
// Translate a pingCache value into the vocabulary the HA API exposes.
// The cache stores 'up' / 'down'. Earlier versions compared against
// 'alive' / 'unreachable', which never matched, so every device was reported
// as "unknown". Both spellings are accepted so the two sides cannot silently
// drift apart again.
function haPingStatus(value) {
  if (value === 'up'   || value === 'alive')       return 'online';
  if (value === 'down' || value === 'unreachable') return 'offline';
  return 'unknown';
}

// ── Client convenience fields ────────────────────────────────────────────────
// `label` saves every client reimplementing the same fallback chain, and
// `serviceUrl` composes the health check settings into the URL a client would
// otherwise have to assemble. Added only for key-authenticated callers: the web
// UI reads /api/ips and writes the whole array back, so injecting derived
// fields there would persist them into stored data.
function decorateEntry(entry) {
  const scheme = entry.healthScheme || 'http';
  const port = entry.healthPort;
  const host = entry.hostname || entry.ip;
  const defaultPort = (scheme === 'https' && String(port) === '443') || (scheme === 'http' && String(port) === '80');
  return {
    ...entry,
    label: entry.assetName || entry.hostname || entry.ip,
    serviceUrl: port
      ? `${scheme}://${host}${defaultPort ? '' : `:${port}`}${entry.healthPath || ''}`
      : null,
  };
}


/**
 * Turn an arp-scan failure into something a user can act on.
 *
 * Discovery previously swallowed these, so a server without arp-scan reported a
 * successful scan that found nothing — indistinguishable from a quiet network.
 * The remedy is nearly always one of two commands, so the message says which.
 */
function describeScanFailure(error) {
  const message = (error && error.message) || String(error || '');
  if (/Operation not permitted|EPERM/i.test(message)) {
    return 'arp-scan lacks raw socket permission. Run: setcap cap_net_raw+ep $(which arp-scan)';
  }
  if (/ENOENT|not found/i.test(message)) {
    return 'arp-scan is not installed. Run: apt-get install arp-scan && setcap cap_net_raw+ep $(which arp-scan)';
  }
  if (/ETIMEDOUT|timed out/i.test(message)) {
    return 'arp-scan timed out. A large subnet can exceed the limit — narrow the range or raise the bandwidth in Settings.';
  }
  return `arp-scan failed: ${message}`;
}


/**
 * Parse arp-scan output into { ip, mac, vendor } records.
 *
 * The vendor column is OPTIONAL, and that is the whole point of this function
 * living here. arp-scan omits the OUI vendor decode when run with --quiet, so
 * its output drops from three columns to two:
 *
 *   192.168.0.50   00:11:32:aa:bb:cc   Synology Incorporated   (normal)
 *   192.168.0.50   00:11:32:aa:bb:cc                           (--quiet)
 *
 * The background discovery sweep passes --quiet while the manual scan does
 * not. A parser that required the third column therefore discarded every line
 * of a discovery sweep and returned zero devices, on a server where arp-scan
 * was installed, permitted, and working perfectly — which is exactly what it
 * did, silently, until v2.11.3.
 */
function parseArpScanOutput(output) {
  const ipMacLine = /^(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})(?:\s+(.*))?$/;
  return String(output || '').split('\n').reduce((acc, line) => {
    const m = line.trim().match(ipMacLine);
    if (!m) return acc;

    let vendor = (m[3] || '').trim();

    // arp-scan appends "(DUP: 2)" when an address answers more than once. It is
    // a property of the response, not part of the vendor name, and it was
    // being displayed as though the manufacturer were called
    // "Raspberry Pi Foundation (DUP: 2)".
    let duplicate = false;
    const dup = vendor.match(/\s*\(DUP:\s*(\d+)\)\s*$/i);
    if (dup) {
      duplicate = true;
      vendor = vendor.slice(0, dup.index).trim();
    }

    // arp-scan writes "(Unknown)" when the OUI is not in ITS database. Ours is
    // a different database and frequently does know the vendor — Proxmox's
    // bc:24:11 prefix among them — so this must be reported as "no vendor"
    // rather than as the literal string, or the fallback lookup never runs.
    if (/^\(?unknown/i.test(vendor)) vendor = '';

    acc.push({ ip: m[1], mac: m[2], vendor: vendor || null, ...(duplicate ? { duplicate: true } : {}) });
    return acc;
  }, []);
}


// ── Virtualisation platforms ────────────────────────────────────────────────
// Some OUI prefixes belong to hypervisors rather than to hardware makers. The
// IEEE name is accurate but buries the useful fact — that the device is a
// virtual machine, and which platform it runs on:
//
//   bc:24:11  ->  "Proxmox Server Solutions GmbH"   really: a Proxmox guest
//   08:00:27  ->  "PCS Systemtechnik GmbH"          really: VirtualBox
//   00:15:5d  ->  "Microsoft Corporation"           really: Hyper-V
//   52:54:00  ->  not in the IEEE database at all   really: QEMU/KVM
//
// Reported separately from the vendor so the interface can say where a device
// came from without discarding the underlying registry name.
const VIRTUAL_PLATFORMS = {
  '525400': 'QEMU / KVM',
  'bc2411': 'Proxmox',
  '00155d': 'Hyper-V',
  '005056': 'VMware',
  '000c29': 'VMware',
  '000569': 'VMware',
  '001c14': 'VMware',
  '080027': 'VirtualBox',
  '0a0027': 'VirtualBox',
  '00163e': 'Xen',
  '001c42': 'Parallels',
  '024200': 'Docker',
};

/**
 * The virtualisation platform a MAC prefix belongs to, or null for real
 * hardware. Deliberately conservative: an unrecognised prefix returns null
 * rather than a guess, because claiming a physical device is a VM is worse
 * than saying nothing.
 */
function virtualPlatform(mac) {
  const hex = String(mac || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (hex.length < 6) return null;
  return VIRTUAL_PLATFORMS[hex.slice(0, 6)] || null;
}


// ── Maintenance ─────────────────────────────────────────────────────────────
// A host taken down deliberately — a rebuild, a disk swap — is not a fault.
// Counting it as offline buries the real failures and, worse, trains people to
// ignore the offline count during any planned work.
//
// The flag suppresses *alerting and counting*, never monitoring: the device is
// still pinged and its true status still reported, because you want to see the
// moment it comes back.

/** Is this entry deliberately out of service? */
function inMaintenance(entry) {
  return !!(entry && entry.maintenance === true);
}

/**
 * Should this entry contribute to an offline count or raise an offline alert?
 *
 * Deliberately one function used by every counter — the offline filter, the
 * Home Assistant sensors, the topology stats and the notification path. A
 * second copy of this rule is how a device ends up excluded from one count and
 * not another.
 */
function countsAsOffline(entry, ping) {
  if (!entry) return false;
  if (entry.assetName === 'Free' || entry.assetName === 'Reserved') return false;
  if (inMaintenance(entry)) return false;
  return ping === 'down';
}

/**
 * A maintenance flag with no end is a permanently silenced alert. This reports
 * a device that is flagged but answering again, so the interface can prompt for
 * the flag to be cleared rather than letting it rot.
 */
function maintenanceButResponding(entry, ping) {
  return inMaintenance(entry) && ping === 'up';
}

module.exports = {
  describeScanFailure,
  inMaintenance,
  countsAsOffline,
  maintenanceButResponding,
  virtualPlatform,
  VIRTUAL_PLATFORMS,
  parseArpScanOutput,
  normaliseSubnetToCidr,
  isValidInterface,
  buildArpScanArgs,
  buildDiscoveryScanArgs,
  ipSortKey,
  sortEntriesByIp,
  findEntryIndex,
  haPingStatus,
  decorateEntry,
};
