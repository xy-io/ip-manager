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
  args.push('--quiet', normalised);
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

module.exports = {
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
