# API

From **v2.1.0** IP Manager exposes a documented HTTP API for external clients — Home Assistant, scripts, a phone. Clients authenticate with a named API key rather than your account password.

For the Home Assistant sensor endpoints specifically, see [Home Assistant API](Home-Assistant-API).

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

## Authentication

Send the key in the `X-API-Key` header:

```bash
curl -H "X-API-Key: YOUR_KEY" https://ipmanager.example.com/api/ips
```

`GET` requests may instead use an `?api_key=` query parameter, for clients that cannot set headers. **Writes must use the header** — query strings are recorded in Nginx access logs, so a key sent that way ends up written to disk in plain text.

A browser session cookie also authenticates every endpoint; that is what the web UI uses.

### Responses

| Status | Meaning |
|---|---|
| `401` | No key, or the key is not recognised |
| `403` | Valid key, but read-only and the request was a write |
| `400` | A write was attempted with the key in the query string |
| `404` | No entry for that IP |
| `409` | Conflict — the entry already exists, or it changed since you read it |
| `423` | Locked — default credentials are still in use; log in and change them |

### What keys cannot do

An API key is deliberately refused on account and maintenance routes, regardless of scope. Those require a browser session:

`/api/auth/*` · `/api/keys/*` · `/api/update/*` · `/api/support/*` · `/api/backup/*` · `/api/ha/key`

So a key can never mint another key, change your password, trigger an update, or download a support bundle.

---

## Endpoints

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

### Status

| Method | Path | Scope | Description |
|---|---|---|---|
| `GET` | `/api/ping-status` | read | `{ "results": { "<ip>": "up" \| "down" }, … }` |
| `GET` | `/api/service-health` | read | Health check results keyed by IP |
| `GET` | `/api/domains` | read | Tracked domains |

### Home Assistant

| Method | Path | Scope | Description |
|---|---|---|---|
| `GET` | `/api/ha/summary` | read | Device counts and domain expiry totals |
| `GET` | `/api/ha/devices` | read | Every device with ping and health status |
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
