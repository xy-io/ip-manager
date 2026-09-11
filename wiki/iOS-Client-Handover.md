# iOS client handover

Everything the server gained between **v2.3.0** (the last release shaped specifically for a native client) and **v2.15.1**, written for whoever is building the iOS app.

The native app is developed separately and is not planned here. This page exists so that work does not have to reverse-engineer the server.

---

## Start here

```
GET /api/capabilities
```

```json
{
  "apiVersion": "1.1",
  "serverVersion": "2.15.1",
  "capabilities": {
    "inventory": true, "networks": true, "ping": true, "serviceHealth": true,
    "domains": true, "domainWrite": true, "arpScan": true, "arpPresence": true,
    "dns": true, "subnetBlocks": true, "proxmox": true,
    "notifications": true, "activityLog": true,
    "deviceHistory": true, "topology": true, "mdns": true,
    "networkWatch": true, "piholeDhcp": true, "whatsNew": true,
    "pushNotifications": false
  }
}
```

**Branch on `capabilities`, never on `serverVersion` or `apiVersion`.** A capability flag answers the only question the client has — *can I call this?* Version strings require the client to know which release introduced what, which is a table that rots.

`apiVersion` went `1.0` → `1.1` for everything below. All of it is **additive**: no existing endpoint changed shape, so a v2.3.0-era client keeps working untouched.

**A capability being `true` does not mean the feature is switched on.** Several are opt-in and off by default. `networkWatch: true` means the endpoints exist; whether the user enabled it comes from `GET /api/watch/status`. Handle "supported but disabled" as a distinct state from "not supported" or the client will show empty screens with no explanation.

---

## What is new since v2.3.0

| Capability | Added | Opt-in? | Summary |
|---|---|---|---|
| `deviceHistory` | v2.9.0 | No | Per-device status timeline and outage count |
| `topology` | v2.9.0 | No | Device relationship graph with impact analysis |
| `mdns` | v2.10.0 | No | Discover friendly names over multicast DNS |
| `networkWatch` | v2.11.0 | **Yes, off by default** | Ledger of every device identity seen |
| `piholeDhcp` | v2.13.0 | **Yes, off by default** | Name unknown devices from Pi-hole DHCP leases |
| `whatsNew` | v2.14.0 | No | Release notes for the first load after an update |

---

## Device history

```
GET /api/ips/:ip/history?days=30
```

```json
{
  "ip": "192.168.0.50",
  "lastSeen": "2026-09-11T08:14:22.000Z",
  "currentStatus": "online",
  "outageCount": 3,
  "events": [
    { "ts": "2026-09-10T22:04:11.000Z", "type": "offline" },
    { "ts": "2026-09-10T22:19:02.000Z", "type": "online" }
  ]
}
```

`404` for an IP with no entry. `days` is clamped to 1–365.

**Only transitions are recorded**, capped at 50 events per device, so a device that stays up produces nothing. An empty `events` array is normal and means "nothing has changed", not "no data". Say that in the UI rather than showing a blank panel.

`currentStatus` is `online` | `offline` | `unknown` — the same vocabulary as `/api/ping-status`.

---

## Topology

```
GET /api/topology
GET /api/topology?gateway=1
```

```json
{
  "nodes": [{ "id": "192.168.0.50", "label": "NAS", "ip": "192.168.0.50",
              "type": "Physical", "group": "net:net-1", "status": "online",
              "health": null, "isHypervisorGuest": false, "tags": [] }],
  "edges": [{ "from": "192.168.0.20", "to": "192.168.0.10", "kind": "hypervisor" }],
  "groups": [{ "id": "host:pve-01", "label": "pve-01", "kind": "hypervisor", "nodeCount": 4 }],
  "stats": { "devices": 87, "online": 71, "offline": 16,
             "dependencyLinks": 12, "hypervisorLinks": 9, "gatewayLinks": 0, "groups": 5 },
  "hints": { "untrackedHosts": ["pve-99"], "gatewayInferred": false,
             "gatewaysFound": [], "noLinks": false },
  "generatedAt": "2026-09-11T08:14:22.000Z"
}
```

`edges[].kind` is `dependency` (set by the user), `hypervisor` (inferred from Proxmox), or `gateway` (only present with `?gateway=1`).

```
GET /api/topology/impact/:ip?gateway=1
```

Returns `{ ip, affected: [node…], count }` — everything that would be affected if that device went down, **following chains transitively**, not just direct dependants.

**Pass the same `gateway` value to both endpoints.** Impact is computed over the graph you asked for; mismatching them highlights devices the diagram shows no path to.

**Use `hints`.** `untrackedHosts` names Proxmox nodes that have guests but no inventory entry — the client should say so rather than drawing an unexplained gap. `noLinks: true` means the graph has nodes and no edges at all, which usually means nobody has set any dependencies.

Layout is the client's business; the server returns a graph, not coordinates. The web client lays out deterministically in columns by group, deliberately avoiding a force-directed simulation — it photographs well and makes it impossible to find the same device twice.

---

## mDNS discovery

```
GET  /api/mdns/status
POST /api/mdns/scan          { "timeoutMs": 4000 }     // 1000–15000
```

```json
{
  "scannedAt": "2026-09-11T08:14:22.000Z",
  "error": null,
  "deviceCount": 12,
  "suggestions": [{
    "ip": "192.168.0.7", "hostname": "printer", "suggestedName": "Study Printer",
    "services": ["_ipp._tcp", "_http._tcp"],
    "known": true, "inInventory": true,
    "currentName": "Office printer", "currentHostname": "printer",
    "canFillHostname": false, "canFillName": false
  }]
}
```

**Honour `canFillName` and `canFillHostname`.** They are the server's judgement about what is safe to overwrite — a name the user typed is never proposed away. A client that applies `suggestedName` unconditionally will silently rename things people named deliberately.

The scan takes as long as `timeoutMs`, so run it off the main thread and show progress. **Finding nothing is a normal result**: multicast does not cross VLANs or subnets, and many networks have nothing that announces itself. Say that rather than implying a fault.

Applying a suggestion is a normal `PATCH /api/ips/:ip`. There is no "apply" endpoint, deliberately — discovery proposes, the client decides.

---

## Network Watch — opt-in, off by default

```
GET    /api/watch/status
GET    /api/watch/devices
PUT    /api/watch/config     { "enabled": true, "retainRandomDays": 14, "retainKnownDays": 180 }
POST   /api/watch/scan
POST   /api/watch/prune
DELETE /api/watch/ledger
```

While disabled: `/devices` returns `{ enabled: false, devices: [] }` and `/scan` returns **409**. Check `status.enabled` first and offer to switch it on, rather than showing an empty list.

```json
{
  "enabled": true,
  "devices": [{
    "mac": "e4:5f:01:aa:bb:cc", "random": false,
    "firstSeen": "2026-09-01T…", "lastSeen": "2026-09-11T…", "sightings": 412,
    "ips": ["192.168.0.120"], "services": [], "vendor": "Raspberry Pi Trading",
    "hostname": "living-room-hue", "name": null, "dhcpName": "living-room-hue",
    "duplicateArp": false, "platform": null,
    "currentIp": "192.168.0.120", "inInventory": false, "inventoryName": null,
    "daysSinceSeen": 0, "transient": false
  }],
  "summary": { "total": 104, "known": 87, "unknown": 15, "randomised": 2,
               "bytes": 28160, "capacity": 1000 },
  "pihole": { "enabled": true, "error": null, "leaseCount": 41 }
}
```

**`random: true` means a randomised MAC** — the locally-administered bit is set, which iOS and Android do per network. These are almost always a phone you already own. They are **excluded from `summary.unknown`** on purpose: counting them is the structural reason Pi.Alert generates so much noise. A client that surfaces them as intruders reintroduces exactly that problem.

**`platform`** is a virtualisation platform name (`Proxmox`, `QEMU / KVM`, `Hyper-V`, `VMware`, `VirtualBox`, `Xen`, `Parallels`, `Docker`) or `null`. When set, the device is a VM — more useful than `vendor`, which would read "Proxmox Server Solutions GmbH". Show the platform and keep the vendor as secondary detail.

**`duplicateArp`** means more than one reply came back for that address. Usually a host with two interfaces on the same segment; also the shape of ARP spoofing. Worth surfacing quietly, not alarming.

**Name precedence**, if the client composes its own label: `inventoryName` → `name` (mDNS) → `hostname` → `dhcpName` → `vendor`.

`POST /api/watch/scan` runs an ARP sweep, so it is slow — seconds, not milliseconds. The response carries `warnings[]` and `found`:

```json
{ "found": 0, "warnings": ["arp-scan is not installed. Run: apt-get install arp-scan …"] }
```

**Show `warnings`.** A sweep that finds nothing with no explanation is indistinguishable from a quiet network — that exact silence was a real bug (v2.11.2).

Storage is bounded and reported: `summary.bytes` against `summary.capacity`. One record per device, updated in place, so it does not grow over time.

---

## Pi-hole DHCP lookup — opt-in, off by default

```
GET  /api/pihole/config
PUT  /api/pihole/config    { "enabled": true, "url": "http://…:8080", "password": "…", "verifyTls": true }
POST /api/pihole/test      { "url": "…", "password": "…" }
```

`GET` returns `{ enabled, url, verifyTls, passwordConfigured, lastError, leaseCount }`.

**The password is write-only.** It is never returned in any form — only `passwordConfigured: true`. An omitted or empty `password` on `PUT` leaves the stored one unchanged, so the client can save other settings without holding the secret. `clearPassword: true` removes it.

`POST /api/pihole/test` returns `{ ok: true, leaseCount, namedCount }` or `{ ok: false, error }` with an **actionable** message — wrong port, unresolvable host, untrusted certificate. Surface `error` verbatim; it is written to be read by a person.

This only affects naming inside Network Watch. It does not appear anywhere else in the API.

---

## Release notes

```
GET  /api/whats-new
POST /api/whats-new/seen    { "suppress": false }
POST /api/whats-new/reset
```

```json
{ "show": true, "version": "2.15.1", "suppressed": false,
  "releases": [{ "version": "2.15.1", "title": "…",
                 "paragraphs": ["Text with **bold** and `code` markers."] }] }
```

Paragraphs contain `**bold**` and `` `code` `` markers. **Render them as attributed text, never by building HTML** — the web client parses them into elements precisely so release notes can never become an injection point.

Probably not worth building in the app: the notes describe the *server*, and an app release cycle is separate.

---

## Things that have not changed

- **Authentication.** `X-API-Key` on every endpoint; `?api_key=` for GETs only. Unchanged since v2.3.0.
- **Error shape.** Every failure is `{ error, message }` with `message` written for a person.
- **Status codes.** `400` malformed · `401` no/unknown key · `403` valid key, wrong scope or session-only route · `404` no such entry · `409` conflict · `423` default credentials in use · `503` no key created yet.
- **Optimistic concurrency.** `expectedLastModified` on `PATCH /api/ips/:ip` still returns `409` with the current entry when something changed underneath. Still the right thing for a phone used alongside the web UI.
- **Units.** `cachedAt` in Unix seconds, `nextIn` in seconds remaining.

---

## Still not implemented

`pushNotifications` is `false` and there is no APNs support. The v2.2.0 event system already detects and de-duplicates the transitions that would be pushed, so this is a delivery channel rather than new detection logic — but it needs device-token registration endpoints, an Apple Developer account and push key, and an agreed payload shape.

Three endpoints Siri intents would want, which do not exist: search entries by name, a merged per-device status view (entry + ping + health in one call, currently three), and next-free-IP (that calculation lives only in the web front end).

---

## Two design rules worth carrying across

**Alerting is always optional.** Every monitoring feature added here is off by default and opt-in per severity. If the app grows notifications, the same rule should hold — a monitoring feature that cries wolf gets muted, and a muted alert is worse than none because it fails silently on the day it matters.

**Suggestions never overwrite.** mDNS names, DHCP names and vendor lookups are all offered, never applied. Anything on a network can claim to be called anything.

---

See [API](API) for the complete endpoint reference.
