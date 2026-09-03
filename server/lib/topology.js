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

/**
 * Build a graph from the current inventory.
 *
 *   entries   ip_data
 *   networks  network definitions (for group labels)
 *   ping      pingCache.results, keyed by IP
 *   health    serviceHealthCache.results, keyed by IP
 *
 * Returns { nodes, edges, groups, stats }.
 */
function buildTopology(entries = [], networks = [], ping = {}, health = {}) {
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
      const host = real.find(
        (candidate) =>
          !candidate.proxmoxNode &&
          (candidate.assetName === entry.proxmoxNode || candidate.hostname === entry.proxmoxNode)
      );
      if (host) addEdge(entry.ip, host.ip, 'hypervisor');
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const stats = {
    devices: nodes.length,
    online: nodes.filter((n) => n.status === 'online').length,
    offline: nodes.filter((n) => n.status === 'offline').length,
    dependencyLinks: edges.filter((e) => e.kind === 'dependency').length,
    hypervisorLinks: edges.filter((e) => e.kind === 'hypervisor').length,
    groups: groups.size,
  };

  return {
    nodes,
    edges,
    groups: [...groups.values()].sort((a, b) => b.nodeCount - a.nodeCount),
    stats,
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
