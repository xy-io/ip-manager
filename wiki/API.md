# API

From **v2.1.0** IP Manager exposes a documented HTTP API for external clients — Home Assistant, scripts, a phone. Clients authenticate with a named API key rather than your account password.

For the Home Assistant sensor endpoints specifically, see [Home Assistant API](Home-Assistant-API).

Building a native client? [iOS Client Handover](iOS-Client-Handover) covers everything added since v2.3.0, with the gotchas.

---

## API keys

Keys are managed in **Settings → API Keys**. Each key has:

| Field | Purpose |
|---|---|
| **Label** | Which client it belongs to — `iPhone`, `Home Assistant`, `backup script` |
| **Scope** | `read only` (GET requests) or `read & write` (all methods) |
| **Last used** | When the key was last accepted, so unused keys are obvious |

Give every client its own key. Revoking one leaves the others working — rotating the key on a lost phone should not take your Home Assistant sensors down with it.

Grant the narrowest scope that works. Home Assistant only ever reads, so a read-only key is correct there; if it leaks, it cannot delete anything.

> **Upgrading from v2.0.x:** your existing Home Assistant key is migrated automatically into the new store as a read-only key labelled "Home Assistant". Nothing needs changing in your `configuration.yaml`.

---

## Client compatibility

`GET /api/capabilities` describes what this server supports, so a client can distinguish an unsupported feature from a broken or unauthorised endpoint:

```json
{
  "apiVersion": "1.0",
  "serverVersion": "2.3.0",
  "capabilities": {
    "inventory": true, "networks": true, "ping": true, "serviceHealth": true,
    "domains": true, "domainWrite": true, "arpScan": true, "arpPresence": true,
    "dns": true, "subnetBlocks": true, "proxmox": true,
    "notifications": true, "activityLog": true,
    "deviceHistory": true, "topology": true, "mdns": true, "networkWatch": true, "piholeDhcp": true, "whatsNew": true, "maintenanceMode": true,
    "pushNotifications": false
  }
}
```

`apiVersion` gains a minor bump for additive changes and a major bump for anything a client must be updated to handle. It is **1.2** as of v2.18.0.

**Test `capabilities`, not `apiVersion` or the server version.** A capability flag answers the only question a client actually has — "can I call this?" — and stays correct when a feature is present but switched off (`networkWatch` is `true` on any server that has the endpoints; whether the user enabled it is answered by `GET /api/watch/status`).

> **Native clients:** from **v2.3.0** every endpoint below accepts `X-API-Key` with no session cookie. Before that, around 48 routes applied session-only authentication internally and returned `401` to key-authenticated callers even though the key was valid. If a client sees `401` on Domains, Ping, Service Health, ARP, DNS or Proxmox, the server is older than v2.3.0.

---

## Authentication

Send the key in the `X-API-Key` header:

```bash
curl -H "X-API-Key: YOUR_KEY" https://ipmanager.example.com/api/ips
```

`GET` requests may instead use an `?api_key=` query parameter, for clients that cannot set headers. **Writes must use the header** — query strings are recorded in Nginx access logs, so a key sent that way ends up written to disk in plain text.

A browser session cookie also authenticates every endpoint; that is what the web UI uses.

### Responses

Successful responses are always `application/json`. No endpoint returns HTML or redirects to a login page.

Every failure uses the same body shape:

```json
{
  "error": "Read-only API key",
  "message": "The key \"iPhone\" has read-only scope and cannot make changes. Give it read & write scope in Settings → API Keys, or use a different key."
}
```

| Status | Meaning |
|---|---|
| `400` | Malformed request — a missing field, or a write with the key in the query string |
| `401` | No key, or the key is not recognised |
| `403` | The key is valid but lacks permission — read-only on a write, or a session-only route |
| `404` | No entry for that IP |
| `409` | Conflict — the entry already exists, or it changed since you read it |
| `423` | Locked — default credentials are still in use; sign in and change them |
| `503` | No API key has been created on this server yet |

### Units

`cachedAt` is **Unix seconds** and `nextIn` is **seconds remaining**, on `/api/ping-status`, `/api/service-health`, `/api/dns-status` and `/api/proxmox-vm-status`. Before v2.3.0 both were milliseconds.

### What keys cannot do

An API key is deliberately refused on account and maintenance routes, regardless of scope. Those require a browser session:

`/api/auth/*` · `/api/keys/*` · `/api/update/*` · `/api/support/*` · `/api/backup/*` · `/api/ha/key` · `/api/audit-log` · `/api/notifications/*`

So a key can never mint another key, change your password, trigger an update, or download a support bundle.

`/api/audit-log` and `/api/notifications/*` are on that list for specific reasons: the audit log records failed-login usernames and source addresses, and the notification configuration could otherwise be repointed at a destination of the caller's choosing. Both stay behind a browser session.

A key used against any of these returns **403**, not 401 — the key is valid, the route is not available to it.

---

## Endpoints

### Convenience fields

Key-authenticated responses from `/api/ips` and `/api/ips/:ip` include two derived fields that the stored record does not contain:

| Field | Meaning |
|---|---|
| `label` | `assetName`, falling back to `hostname`, then `ip` |
| `serviceUrl` | Composed from `healthScheme`, `hostname` or `ip`, `healthPort` and `healthPath`; `null` when no health port is set |

They are omitted for session-authenticated requests, because the web UI writes the whole array back and would otherwise persist them.

### The `maintenance` field

`maintenance` is a boolean on an entry, and is the difference between *this host has failed* and *I took this host down*. Set it and the device is excluded from offline counts and offline notifications, but keeps reporting its true `ping` state.

```bash
curl -X PATCH https://ipmanager.example.com/api/ips/192.168.0.42 \
  -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"maintenance": true}'
```

**It must be a JSON boolean.** Anything else is rejected with `400` rather than coerced, because the string `"false"` is truthy and would silently suppress every offline alert for that device.

Nothing on the server clears the flag. A client should surface a device that is flagged *and* responding, so the flag does not become a permanently silenced alert — `GET /api/ha/devices` gives both fields needed to detect that.

Setting or clearing it records an `entry.maintenance.on` / `entry.maintenance.off` event in the activity log, so a suppressed alert can be explained after the fact.

Available from **v2.18.0**; check `capabilities.maintenanceMode`.

### Entries

| Method | Path | Scope | Description |
|---|---|---|---|
| `GET` | `/api/ips` | read | All entries, as `{ "data": [ … ] }` |
| `GET` | `/api/ips/:ip` | read | A single entry |
| `POST` | `/api/ips` | write | Create an entry |
| `PATCH` | `/api/ips/:ip` | write | Update the supplied fields of one entry |
| `DELETE` | `/api/ips/:ip` | write | Delete one entry |
| `PUT` | `/api/ips` | write | Replace the **entire** dataset — used by the web UI; external clients should not use this |

### Networks and configuration

| Method | Path | Scope | Description |
|---|---|---|---|
| `GET` | `/api/networks` | read | All configured networks |
| `GET` | `/api/config` | read | Legacy single-network configuration |
| `GET` | `/api/subnet-blocks?network=<id>` | read | Planned blocks for a network |
| `GET` | `/api/arp-presence/status` | read | Last-seen times plus the discovery block used for new-host alerts |
| `GET` | `/api/dns-status` | read | PTR results and per-network resolver configuration |
| `POST` | `/api/arp/scan` | write | Run an ARP sweep |
| `GET` | `/api/proxmox-sync/config` | read | Returns a valid disabled object when Proxmox is unconfigured. `token` is `null` for key-authenticated callers; use `tokenConfigured` |
| `GET` | `/api/proxmox-sync/status` | read | Last and running sync state |
| `POST` | `/api/proxmox-sync/run` | write | Start a sync |
| `GET` | `/api/proxmox-vm-status` | read | Cached guest status |
| `GET` | `/api/capabilities` | read | Feature map, see above |
| `GET` | `/api/topology?gateway=1` | read | Nodes, edges, groups, stats and hints derived from the inventory. A node flagged for maintenance reports `status: "maintenance"` and `maintenance: true`, and is counted in `stats.maintenance` rather than `stats.online` or `stats.offline`. `gateway=1` additionally infers a link from every device to its subnet's router; omitted by default |
| `GET` | `/api/topology/impact/:ip?gateway=1` | read | Devices that would be affected if this one went down, following dependency chains. Pass the same `gateway` value used to draw the graph |
| `GET` | `/api/ips/:ip/history?days=30` | read | That device's status-change timeline, outage count and last-seen time |
| `GET` | `/api/mdns/status` | read | The most recent mDNS scan, matched against the inventory |
| `POST` | `/api/mdns/scan` | write | Run a discovery sweep. Optional `timeoutMs` (1000–15000, default 4000). Returns suggestions only — it never modifies any entry |
| `GET` | `/api/watch/status` | read | Network Watch configuration, storage used and limits |
| `GET` | `/api/watch/devices` | read | The device ledger, matched against the inventory. Empty while the feature is off |
| `PUT` | `/api/watch/config` | write | Enable or disable, and set retention. Disabling deletes the ledger |
| `POST` | `/api/watch/scan` | write | Sweep now and fold the results in. `409` while the feature is off |
| `POST` | `/api/watch/prune` | write | Apply retention immediately |
| `DELETE` | `/api/watch/ledger` | write | Forget every recorded device |
| `GET` | `/api/pihole/config` | read | Pi-hole DHCP lookup settings. **Never returns the password** — only `passwordConfigured` |
| `PUT` | `/api/pihole/config` | write | Enable or disable and set the address. An omitted or empty `password` leaves the stored one unchanged; `clearPassword: true` removes it |
| `GET` | `/api/whats-new` | read | Release notes newer than the version last acknowledged, and whether to show them |
| `POST` | `/api/whats-new/seen` | write | Acknowledge. `{ "suppress": true }` stops them permanently |
| `POST` | `/api/whats-new/reset` | write | Undo a permanent suppression |
| `POST` | `/api/pihole/test` | write | Try settings without saving them. Returns `{ ok, leaseCount, namedCount }` or `{ ok: false, error }` |

### Discovery and identification

| Method | Path | Scope | Description |
|---|---|---|---|
| `GET` | `/api/health` | read | `{ ok, mode }`. Unauthenticated-friendly liveness check used by the web client to detect API mode |
| `GET` | `/api/mac/vendor?mac=…` | read | IEEE OUI lookup for one MAC. `{ mac, vendor }`, `vendor` is `null` when unknown |
| `POST` | `/api/proxmox/discover` | write | Probe a Proxmox host for reachable nodes before configuring sync |
| `GET` | `/api/arp-presence/config` | read | Background discovery sweep settings and last-seen tracking |
| `POST` | `/api/arp-presence/config` | write | Update them |
| `POST` | `/api/arp-presence/scan` | write | Run the background discovery sweep now |
| `POST` | `/api/arp-presence/clear-last-seen` | write | Forget stored last-seen timestamps |
| `GET` | `/api/dns-config` | read | Per-network resolver configuration |
| `POST` | `/api/dns-config` | write | Update it |
| `POST` | `/api/import` | write | Bulk import. `{ rows, mode, networkId }` where `mode` is `merge` or `replace`. **Prefer the per-entry endpoints** — this replaces or merges wholesale |

### Domains

| Method | Path | Scope | Description |
|---|---|---|---|
| `DELETE` | `/api/domains/:id` | write | Stop tracking a domain |
| `POST` | `/api/domains/:id/refresh` | write | Re-query RDAP for one domain now |

### Server and updates

| Method | Path | Scope | Description |
|---|---|---|---|
| `GET` | `/api/version-check` | read | `{ current, latest, updateAvailable }` — compares against the published release |
| `GET` | `/api/changelog` | read | The raw CHANGELOG, for showing release notes in a client |

Update *execution* (`/api/update/*`) is session-only and cannot be triggered with a key.

### Status

| Method | Path | Scope | Description |
|---|---|---|---|
| `GET` | `/api/ping-status` | read | `{ results, warning, cachedAt, nextIn, lastSeen }` — values are exactly `up`, `down` or `unknown`, keyed by the same IP strings as `/api/ips` |
| `GET` | `/api/service-health` | read | Health check results keyed by IP |
| `GET` | `/api/domains` | read | Tracked domains |

### Home Assistant

| Method | Path | Scope | Description |
|---|---|---|---|
| `GET` | `/api/ha/summary` | read | Device counts and domain expiry totals. Includes `devices_maintenance`; flagged devices are excluded from `devices_online` and `devices_offline` |
| `GET` | `/api/ha/devices` | read | Every device with ping and health status, plus `maintenance` (boolean). `ping` reports the true observed state regardless of the flag |
| `GET` | `/api/ha/domains` | read | Domains with expiry dates and urgency |

---

## Working with entries

### Create

```bash
curl -X POST https://ipmanager.example.com/api/ips \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"ip":"192.168.0.42","assetName":"Office printer","type":"printer","hostname":"printer.lan"}'
```

Returns `201` with the created entry, or `409` if that IP already exists.

### Update

`PATCH` merges the fields you send and leaves everything else alone — you never need to send the whole entry, let alone the whole dataset.

```bash
curl -X PATCH https://ipmanager.example.com/api/ips/192.168.0.42 \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"assetName":"Office printer (2nd floor)"}'
```

The `ip` field cannot be changed — delete the entry and create a new one instead.

### Avoiding lost updates

Every entry carries a `lastModified` timestamp. Send it back as `expectedLastModified` and the update is rejected with `409` if anything changed in the meantime — a background Proxmox sync, or the web UI open in another tab.

```json
{
  "assetName": "New name",
  "expectedLastModified": "2026-08-05T09:12:44.108Z"
}
```

A `409` response includes the current entry so a client can merge and retry. Omitting `expectedLastModified` means last write wins, which is fine for a single client but not for a phone used alongside the web UI.

### Delete

```bash
curl -X DELETE https://ipmanager.example.com/api/ips/192.168.0.42 \
  -H "X-API-Key: YOUR_KEY"
```

---

## Security

API keys are **bearer credentials**: whoever holds one has whatever access its scope allows, with no expiry and no second factor. That is the same model Sonarr, Radarr and similar tools use, and it is reasonable for a self-hosted application — provided you treat a key like a password.

- Use HTTPS wherever the instance is reachable beyond your LAN. The key is sent on every request.
- Never paste a key into an issue, forum post, or screenshot. Revoke and regenerate if you do.
- Prefer read-only. Only the clients that genuinely edit data need write scope.
- Revoke keys you no longer use — the "last used" column makes the stale ones easy to spot.
- Keys are stored in the application database, not in `credentials.env`, and are unrelated to your login. Changing your password does not invalidate them; revoking a key does not affect your login.

---

## Verifying

The bundled smoke test exercises key authentication, scope enforcement, and the entry endpoints:

```bash
cd /opt/ip-manager
SMOKE_USER=yourname SMOKE_PASS='yourpassword' node scripts/smoke-test.cjs
```

It creates a temporary key and a temporary entry at `203.0.113.253`, then removes both. Pass `--read-only` to skip that. See [Testing](Testing).
