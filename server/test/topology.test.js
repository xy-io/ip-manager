// ============================================================
//  lib/topology.js — graph derivation
//
//  Pure derivation, so it can be tested exhaustively. The cases that matter
//  are the ones that would draw a wrong or broken picture: dangling links,
//  self-references, cycles, and placeholder rows leaking into the graph.
// ============================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { buildTopology, impactOf } = require('../lib/topology');

const networks = [{ id: 'net-1', name: 'Home LAN' }];

test('an empty inventory produces an empty graph rather than throwing', () => {
  const t = buildTopology([], [], {}, {});
  assert.deepEqual(t.nodes, []);
  assert.deepEqual(t.edges, []);
  assert.equal(t.stats.devices, 0);
});

test('handles being called with nothing at all', () => {
  const t = buildTopology();
  assert.equal(t.nodes.length, 0);
});

test('Free and Reserved placeholders are excluded', () => {
  const entries = [
    { ip: '10.0.0.1', assetName: 'NAS', networkId: 'net-1' },
    { ip: '10.0.0.2', assetName: 'Free', networkId: 'net-1' },
    { ip: '10.0.0.3', assetName: 'Reserved', networkId: 'net-1' },
  ];
  const t = buildTopology(entries, networks, {}, {});
  assert.equal(t.nodes.length, 1);
  assert.equal(t.nodes[0].label, 'NAS');
});

test('entries without an IP are ignored', () => {
  const t = buildTopology([{ assetName: 'Broken' }, { ip: '10.0.0.1', assetName: 'Real' }], networks, {}, {});
  assert.equal(t.nodes.length, 1);
});

test('labels fall back from assetName to hostname to IP', () => {
  const entries = [
    { ip: '10.0.0.1', assetName: 'NAS', hostname: 'nas.lan' },
    { ip: '10.0.0.2', hostname: 'printer.lan' },
    { ip: '10.0.0.3' },
  ];
  const t = buildTopology(entries, networks, {}, {});
  assert.deepEqual(t.nodes.map(n => n.label), ['NAS', 'printer.lan', '10.0.0.3']);
});

test('ping status is carried onto each node', () => {
  const entries = [
    { ip: '10.0.0.1', assetName: 'Up' },
    { ip: '10.0.0.2', assetName: 'Down' },
    { ip: '10.0.0.3', assetName: 'Unknown' },
  ];
  const t = buildTopology(entries, networks, { '10.0.0.1': 'up', '10.0.0.2': 'down' }, {});
  assert.deepEqual(t.nodes.map(n => n.status), ['online', 'offline', 'unknown']);
  assert.equal(t.stats.online, 1);
  assert.equal(t.stats.offline, 1);
});

test('devices group by network, and by hypervisor when they have one', () => {
  const entries = [
    { ip: '10.0.0.1', assetName: 'Router', networkId: 'net-1' },
    { ip: '10.0.0.2', assetName: 'VM one', networkId: 'net-1', proxmoxNode: 'pve-01' },
    { ip: '10.0.0.3', assetName: 'VM two', networkId: 'net-1', proxmoxNode: 'pve-01' },
  ];
  const t = buildTopology(entries, networks, {}, {});
  const groupIds = t.nodes.map(n => n.group);
  assert.equal(groupIds[0], 'net:net-1', 'a plain device groups by network');
  assert.equal(groupIds[1], 'host:pve-01', 'a guest groups by its hypervisor');
  assert.equal(groupIds[2], 'host:pve-01');

  const hostGroup = t.groups.find(g => g.id === 'host:pve-01');
  assert.equal(hostGroup.kind, 'hypervisor');
  assert.equal(hostGroup.nodeCount, 2);
});

test('an entry with no network lands in an Unassigned group', () => {
  const t = buildTopology([{ ip: '10.0.0.1', assetName: 'Orphan' }], networks, {}, {});
  assert.equal(t.nodes[0].group, 'net:unassigned');
  assert.equal(t.groups[0].label, 'Unassigned');
});

test('dependency links become edges', () => {
  const entries = [
    { ip: '10.0.0.1', assetName: 'NAS' },
    { ip: '10.0.0.2', assetName: 'Plex', dependencies: ['10.0.0.1'] },
  ];
  const t = buildTopology(entries, networks, {}, {});
  assert.equal(t.edges.length, 1);
  assert.deepEqual(t.edges[0], { from: '10.0.0.2', to: '10.0.0.1', kind: 'dependency' });
});

// A deleted device would otherwise leave an arrow pointing at nothing.
test('dependencies on entries that no longer exist are dropped', () => {
  const entries = [{ ip: '10.0.0.2', assetName: 'Plex', dependencies: ['10.0.0.99'] }];
  const t = buildTopology(entries, networks, {}, {});
  assert.equal(t.edges.length, 0, 'must not draw an edge into nowhere');
});

test('a self-dependency is ignored', () => {
  const entries = [{ ip: '10.0.0.1', assetName: 'Odd', dependencies: ['10.0.0.1'] }];
  const t = buildTopology(entries, networks, {}, {});
  assert.equal(t.edges.length, 0);
});

test('duplicate dependencies collapse to one edge', () => {
  const entries = [
    { ip: '10.0.0.1', assetName: 'NAS' },
    { ip: '10.0.0.2', assetName: 'Plex', dependencies: ['10.0.0.1', '10.0.0.1'] },
  ];
  const t = buildTopology(entries, networks, {}, {});
  assert.equal(t.edges.length, 1);
});

test('a guest is linked to its hypervisor when the hypervisor is tracked', () => {
  const entries = [
    { ip: '10.0.0.1', assetName: 'pve-01' },
    { ip: '10.0.0.2', assetName: 'VM one', proxmoxNode: 'pve-01' },
  ];
  const t = buildTopology(entries, networks, {}, {});
  const link = t.edges.find(e => e.kind === 'hypervisor');
  assert.ok(link, 'expected a hypervisor edge');
  assert.equal(link.from, '10.0.0.2');
  assert.equal(link.to, '10.0.0.1');
});

test('no hypervisor edge is drawn when the host is not a tracked entry', () => {
  const entries = [{ ip: '10.0.0.2', assetName: 'VM one', proxmoxNode: 'pve-99' }];
  const t = buildTopology(entries, networks, {}, {});
  assert.equal(t.edges.filter(e => e.kind === 'hypervisor').length, 0);
});

test('stats summarise the graph', () => {
  const entries = [
    { ip: '10.0.0.1', assetName: 'pve-01' },
    { ip: '10.0.0.2', assetName: 'VM', proxmoxNode: 'pve-01', dependencies: ['10.0.0.1'] },
  ];
  const t = buildTopology(entries, networks, { '10.0.0.1': 'up', '10.0.0.2': 'up' }, {});
  assert.equal(t.stats.devices, 2);
  assert.equal(t.stats.online, 2);
  assert.equal(t.stats.dependencyLinks, 1);
  assert.equal(t.stats.hypervisorLinks, 1);
});

// ── Impact analysis ─────────────────────────────────────────────────────────
test('impactOf finds direct dependants', () => {
  const entries = [
    { ip: '10.0.0.1', assetName: 'NAS' },
    { ip: '10.0.0.2', assetName: 'Plex', dependencies: ['10.0.0.1'] },
    { ip: '10.0.0.3', assetName: 'Sonarr', dependencies: ['10.0.0.1'] },
  ];
  const { edges } = buildTopology(entries, networks, {}, {});
  assert.deepEqual(impactOf('10.0.0.1', edges).sort(), ['10.0.0.2', '10.0.0.3']);
});

test('impactOf follows chains transitively', () => {
  const entries = [
    { ip: '10.0.0.1', assetName: 'Router' },
    { ip: '10.0.0.2', assetName: 'NAS', dependencies: ['10.0.0.1'] },
    { ip: '10.0.0.3', assetName: 'Plex', dependencies: ['10.0.0.2'] },
  ];
  const { edges } = buildTopology(entries, networks, {}, {});
  assert.deepEqual(impactOf('10.0.0.1', edges).sort(), ['10.0.0.2', '10.0.0.3']);
});

// A circular dependency is a user error, but it must not hang the server.
test('impactOf terminates on a dependency cycle', () => {
  const entries = [
    { ip: '10.0.0.1', assetName: 'A', dependencies: ['10.0.0.2'] },
    { ip: '10.0.0.2', assetName: 'B', dependencies: ['10.0.0.1'] },
  ];
  const { edges } = buildTopology(entries, networks, {}, {});
  assert.deepEqual(impactOf('10.0.0.1', edges), ['10.0.0.2']);
  assert.deepEqual(impactOf('10.0.0.2', edges), ['10.0.0.1']);
});

test('impactOf returns nothing for a device nothing depends on', () => {
  const entries = [
    { ip: '10.0.0.1', assetName: 'NAS' },
    { ip: '10.0.0.2', assetName: 'Plex', dependencies: ['10.0.0.1'] },
  ];
  const { edges } = buildTopology(entries, networks, {}, {});
  assert.deepEqual(impactOf('10.0.0.2', edges), []);
});

// ── Hypervisor name matching (v2.9.1) ───────────────────────────────────────
// v2.9.0 compared the Proxmox node name against assetName and hostname with
// ===, so every install whose host entry was named anything other than the
// exact node string drew no hypervisor links at all. Each case below is a
// realistic way a host gets named.

test('the hypervisor host is matched case-insensitively', () => {
  const entries = [
    { ip: '10.0.0.1', assetName: 'PVE-01' },
    { ip: '10.0.0.2', assetName: 'VM one', proxmoxNode: 'pve-01', proxmoxVmid: 100 },
  ];
  const t = buildTopology(entries, networks, {}, {});
  assert.equal(t.stats.hypervisorLinks, 1);
});

test('a fully qualified hostname matches a bare node name', () => {
  const entries = [
    { ip: '10.0.0.1', assetName: 'Proxmox host', hostname: 'pve-01.the-allens.uk' },
    { ip: '10.0.0.2', assetName: 'VM one', proxmoxNode: 'pve-01', proxmoxVmid: 100 },
  ];
  const t = buildTopology(entries, networks, {}, {});
  assert.equal(t.stats.hypervisorLinks, 1);
  assert.equal(t.edges[0].to, '10.0.0.1');
});

test('a descriptive asset name containing the node name matches', () => {
  const entries = [
    { ip: '10.0.0.1', assetName: 'Proxmox (pve-01)' },
    { ip: '10.0.0.2', assetName: 'VM one', proxmoxNode: 'pve-01', proxmoxVmid: 100 },
  ];
  const t = buildTopology(entries, networks, {}, {});
  assert.equal(t.stats.hypervisorLinks, 1);
});

test('a guest is never treated as the hypervisor it runs on', () => {
  // Two guests, no host entry. Neither may be chosen as the other's host.
  const entries = [
    { ip: '10.0.0.2', assetName: 'pve-01', proxmoxNode: 'pve-01', proxmoxVmid: 100 },
    { ip: '10.0.0.3', assetName: 'VM two', proxmoxNode: 'pve-01', proxmoxVmid: 101 },
  ];
  const t = buildTopology(entries, networks, {}, {});
  assert.equal(t.stats.hypervisorLinks, 0);
  assert.deepEqual(t.hints.untrackedHosts, ['pve-01']);
});

test('a host entry carrying its own node name but no vmid stays eligible', () => {
  const entries = [
    { ip: '10.0.0.1', assetName: 'pve-01', proxmoxNode: 'pve-01' },
    { ip: '10.0.0.2', assetName: 'VM one', proxmoxNode: 'pve-01', proxmoxVmid: 100 },
  ];
  const t = buildTopology(entries, networks, {}, {});
  assert.equal(t.stats.hypervisorLinks, 1);
  assert.equal(t.hints.untrackedHosts.length, 0);
});

test('an untracked hypervisor is reported as a hint, not silently dropped', () => {
  const entries = [{ ip: '10.0.0.2', assetName: 'VM one', proxmoxNode: 'pve-99', proxmoxVmid: 100 }];
  const t = buildTopology(entries, networks, {}, {});
  assert.deepEqual(t.hints.untrackedHosts, ['pve-99']);
  assert.equal(t.hints.noLinks, true);
});

// ── Gateway inference ───────────────────────────────────────────────────────

test('gateway links are off unless explicitly requested', () => {
  const entries = [
    { ip: '10.0.0.1', assetName: 'Router', networkId: 'net-1' },
    { ip: '10.0.0.5', assetName: 'NAS', networkId: 'net-1' },
  ];
  assert.equal(buildTopology(entries, networks, {}, {}).stats.gatewayLinks, 0);
  assert.equal(
    buildTopology(entries, networks, {}, {}, { inferGateway: true }).stats.gatewayLinks, 1);
});

test('gateway inference is skipped when two candidates are ambiguous', () => {
  const entries = [
    { ip: '10.0.0.1', assetName: 'Router', networkId: 'net-1' },
    { ip: '10.0.0.2', assetName: 'Backup firewall', networkId: 'net-1' },
    { ip: '10.0.0.5', assetName: 'NAS', networkId: 'net-1' },
  ];
  const t = buildTopology(entries, networks, {}, {}, { inferGateway: true });
  assert.equal(t.stats.gatewayLinks, 0, 'guessing between two routers is worse than no edge');
});

test('a guest already linked to its host gets no duplicate gateway edge', () => {
  const entries = [
    { ip: '10.0.0.1', assetName: 'Router', networkId: 'net-1' },
    { ip: '10.0.0.2', assetName: 'pve-01', networkId: 'net-1' },
    { ip: '10.0.0.3', assetName: 'VM', networkId: 'net-1', proxmoxNode: 'pve-01', proxmoxVmid: 100 },
  ];
  const t = buildTopology(entries, networks, {}, {}, { inferGateway: true });
  const from = t.edges.filter(e => e.from === '10.0.0.3');
  assert.equal(from.length, 1);
  assert.equal(from[0].kind, 'hypervisor');
});

test('the gateway does not depend on itself', () => {
  const entries = [{ ip: '10.0.0.1', assetName: 'Router', networkId: 'net-1' }];
  const t = buildTopology(entries, networks, {}, {}, { inferGateway: true });
  assert.equal(t.edges.length, 0);
});
