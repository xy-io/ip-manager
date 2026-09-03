// ============================================================
//  Network topology derivation
//
//  A pure function: entries in, nodes and edges out. No database access and no
//  state, so it can be unit-tested directly and reused by any client.
//
//  Nothing here needs to be drawn or configured by the user — every
//  relationship is inferred from data the app already holds:
//
//    dependencies[]           explicit links the user created in the edit modal
//    proxmoxNode / proxmoxVmid  guests belong to their hypervisor
//    networkId                which subnet an entry sits on
// ============================================================

'use strict';

const { haPingStatus } = require('./net');

// Entries the app uses as placeholders rather than real devices.
const PLACEHOLDER_NAMES = new Set(['Free', 'Reserved']);
const isPlaceholder = (entry) => PLACEHOLDER_NAMES.has(entry.assetName);

// ── Name matching ───────────────────────────────────────────────────────────
// Proxmox reports its node name as a bare label ("pve-01"), but the matching
// entry in the inventory is just as likely to be called "PVE-01", "pve-01.lan"
// or "Proxmox (pve-01)". Comparing the raw strings therefore misses most real
// installs, which is what made hypervisor links look broken in v2.9.0.
const normaliseName = (value) => String(value || '').trim().toLowerCase();

// The short form of a name: the first dot-separated label, with any trailing
// domain dropped. "pve-01.the-allens.uk" and "pve-01" become the same key.
const shortName = (value) => normaliseName(value).split('.')[0];

/**
 * Every string by which an entry might be recognised as a hypervisor host.
 * Ordered from most to least specific so the strongest match wins.
 */
function hostAliases(entry) {
  const aliases = [];
  for (const raw of [entry.assetName, entry.hostname]) {
    const full = normaliseName(raw);
    if (!full) continue;
    aliases.push(full);
    const short = shortName(raw);
    if (short && short !== full) aliases.push(short);

    // "Proxmox (pve-01)" and "pve-01 — hypervisor": pull out any bracketed or
    // dash-separated token, so a descriptive asset name still matches.
    // Only *spaced* dashes separate; a bare hyphen is part of the name itself,
    // or "pve-01" would be shredded into "pve" and "01".
    for (const token of full.replace(/\s[–—-]\s/g, ' ').split(/[\s()[\],/]+/)) {
      const cleaned = token.trim();
      if (cleaned.length >= 3 && cleaned !== full) aliases.push(cleaned);
    }
  }
  return aliases;
}

// Names that suggest an entry is the router for its subnet. Used only when
// gateway inference is explicitly requested.
const GATEWAY_PATTERN =
  /\b(router|firewall|gateway|gw|opnsense|pfsense|edgerouter|usg|udm|dream ?machine)\b/i;

/**
 * Build a graph from the current inventory.
 *
 *   entries   ip_data
 *   networks  network definitions (for group labels)
 *   ping      pingCache.results, keyed by IP
 *   health    serviceHealthCache.results, keyed by IP
 *
 *   options   { inferGateway } — off by default, see below
 *
 * Returns { nodes, edges, groups, stats, hints }.
 */
function buildTopology(entries = [], networks = [], ping = {}, health = {}, options = {}) {
  const { inferGateway = false } = options || {};
  const real = (entries || []).filter((e) => e && e.ip && !isPlaceholder(e));
  const byIp = new Map(real.map((e) => [e.ip, e]));
  const networkName = new Map((networks || []).map((n) => [n.id, n.name || n.id]));

  // ── Groups ────────────────────────────────────────────────────────────────
  // A device belongs to its hypervisor if it has one, otherwise to its network.
  // Hypervisor grouping is the more informative of the two, so it wins.
  const groups = new Map();

  const ensureGroup = (id, label, kind) => {
    if (!groups.has(id)) groups.set(id, { id, label, kind, nodeCount: 0 });
    return groups.get(id);
  };

  for (const entry of real) {
    if (entry.proxmoxNode) {
      ensureGroup(`host:${entry.proxmoxNode}`, entry.proxmoxNode, 'hypervisor');
    } else {
      const netId = entry.networkId || 'unassigned';
      ensureGroup(`net:${netId}`, networkName.get(netId) || 'Unassigned', 'network');
    }
  }

  // ── Nodes ─────────────────────────────────────────────────────────────────
  const nodes = real.map((entry) => {
    const groupId = entry.proxmoxNode
      ? `host:${entry.proxmoxNode}`
      : `net:${entry.networkId || 'unassigned'}`;
    groups.get(groupId).nodeCount += 1;

    const healthEntry = health[entry.ip];
    return {
      id: entry.ip,
      label: entry.assetName || entry.hostname || entry.ip,
      ip: entry.ip,
      type: entry.type || null,
      group: groupId,
      status: haPingStatus(ping[entry.ip]),
      health: healthEntry ? healthEntry.status : null,
      isHypervisorGuest: !!entry.proxmoxNode,
      proxmoxKind: entry.proxmoxKind || null,
      tags: entry.tags || [],
    };
  });

  // ── Edges ─────────────────────────────────────────────────────────────────
  const edges = [];
  const seen = new Set();

  const addEdge = (from, to, kind) => {
    if (from === to) return;                    // a device cannot depend on itself
    const key = `${kind}:${from}->${to}`;
    if (seen.has(key)) return;                  // duplicates collapse
    seen.add(key);
    edges.push({ from, to, kind });
  };

  // Index every entry that could serve as a hypervisor host, by each of the
  // names it might be known as. Guests are excluded — a container can never be
  // the node it runs on — but an entry carrying proxmoxNode without a vmid is
  // the host itself and stays eligible.
  const hostIndex = new Map();
  for (const candidate of real) {
    if (candidate.proxmoxVmid) continue;
    for (const alias of hostAliases(candidate)) {
      if (!hostIndex.has(alias)) hostIndex.set(alias, candidate);
    }
  }

  const resolveHost = (nodeName) => {
    const full = normaliseName(nodeName);
    return hostIndex.get(full) || hostIndex.get(shortName(nodeName)) || null;
  };

  // Node names Proxmox reported that match no entry. Surfaced as a hint rather
  // than silently dropped, because the fix — add the hypervisor to the
  // inventory — is not something the user can guess from an empty diagram.
  const untrackedHosts = new Set();

  for (const entry of real) {
    // Explicit dependency links, drawn from the dependent to what it needs.
    for (const target of entry.dependencies || []) {
      // Skip links to entries that no longer exist, rather than drawing edges
      // into nowhere — deleting a device would otherwise leave dangling arrows.
      if (byIp.has(target)) addEdge(entry.ip, target, 'dependency');
    }

    // A guest implicitly depends on its hypervisor, when that hypervisor is
    // itself a tracked entry we can point at.
    if (entry.proxmoxNode) {
      const host = resolveHost(entry.proxmoxNode);
      if (host && host.ip !== entry.ip) addEdge(entry.ip, host.ip, 'hypervisor');
      else if (!host) untrackedHosts.add(entry.proxmoxNode);
    }
  }

  // ── Gateway inference (opt-in) ────────────────────────────────────────────
  // Every device on a subnet does depend on its router, but drawing that by
  // default turns an 87-device network into a star with one node in the middle
  // and tells the user nothing they did not know. It is therefore a toggle.
  //
  // Only applied where a single unambiguous router exists on the network: two
  // candidates means guessing, and a wrong inferred edge is worse than none.
  const gatewaysByNetwork = new Map();
  if (inferGateway) {
    const candidates = new Map();
    for (const entry of real) {
      const netId = entry.networkId || 'unassigned';
      const looksLikeGateway =
        GATEWAY_PATTERN.test(entry.assetName || '') || GATEWAY_PATTERN.test(entry.hostname || '');
      if (!looksLikeGateway) continue;
      if (!candidates.has(netId)) candidates.set(netId, []);
      candidates.get(netId).push(entry);
    }

    for (const [netId, found] of candidates) {
      if (found.length === 1) gatewaysByNetwork.set(netId, found[0]);
    }

    for (const entry of real) {
      const gateway = gatewaysByNetwork.get(entry.networkId || 'unassigned');
      if (!gateway || gateway.ip === entry.ip) continue;
      // A guest already reaches the network through its hypervisor, so linking
      // it to the router as well duplicates a path that is already drawn.
      if (entry.proxmoxVmid && resolveHost(entry.proxmoxNode)) continue;
      addEdge(entry.ip, gateway.ip, 'gateway');
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const stats = {
    devices: nodes.length,
    online: nodes.filter((n) => n.status === 'online').length,
    offline: nodes.filter((n) => n.status === 'offline').length,
    dependencyLinks: edges.filter((e) => e.kind === 'dependency').length,
    hypervisorLinks: edges.filter((e) => e.kind === 'hypervisor').length,
    gatewayLinks: edges.filter((e) => e.kind === 'gateway').length,
    groups: groups.size,
  };

  // Why the diagram might look emptier than expected. The UI shows these
  // instead of an unexplained scattering of unconnected boxes.
  const hints = {
    untrackedHosts: [...untrackedHosts].sort(),
    gatewayInferred: inferGateway,
    gatewaysFound: [...gatewaysByNetwork.values()].map((g) => g.ip),
    noLinks: edges.length === 0 && nodes.length > 0,
  };

  return {
    nodes,
    edges,
    groups: [...groups.values()].sort((a, b) => b.nodeCount - a.nodeCount),
    stats,
    hints,
  };
}

/**
 * Which devices would be affected if `ip` went down — the transitive set of
 * things that depend on it, directly or through a chain.
 */
function impactOf(ip, edges) {
  const dependants = new Map();
  for (const edge of edges) {
    if (!dependants.has(edge.to)) dependants.set(edge.to, []);
    dependants.get(edge.to).push(edge.from);
  }

  const affected = new Set();
  const queue = [ip];
  while (queue.length) {
    const current = queue.shift();
    for (const dependant of dependants.get(current) || []) {
      if (!affected.has(dependant)) {
        affected.add(dependant);
        queue.push(dependant);      // follow the chain, but never revisit
      }
    }
  }
  affected.delete(ip);
  return [...affected];
}

module.exports = { buildTopology, impactOf };
