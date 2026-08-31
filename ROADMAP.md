# Roadmap

Ideas and planned improvements for IP Address Manager. This is a living document — items move into releases as they're implemented.

Items are roughly ordered by priority but nothing here is a firm commitment or timeline.

---

## Next release

Known defects and hardening work, in the order they should be tackled. These come ahead of new features.

### Security hardening
- **Argument-safe shell invocation** — `subnet` and `cidr` are interpolated into shell strings for `arp-scan`, and the rclone password is quoted with `JSON.stringify`, which is not shell-safe. Move to `execFile` with argument arrays.
- **Support-bundle redaction** — the bundle embeds recent journal lines, which on a recently installed server still contain the generated startup password. Strip credential lines before writing.
- **Login rate limiting** — no throttle on failed logins, and each attempt runs a bcrypt comparison, making it both brute-forceable and a cheap CPU drain.
- **Session expiry** — sessions never expire and the session map grows without bound.

### Correctness
- **Proxmox sync refresh** — `loadData()` is called but never defined, so the IP list stops refreshing after a sync.
- **Card expansion state** — tracked by list index rather than IP, so sorting or a status poll expands the wrong card.
- **Read-modify-write race** — Proxmox sync rewrites the whole entry array, discarding edits made while it was running.

### Performance
- Memoise list rows — a status poll currently re-renders every entry three times a minute.
- Virtualise long lists; debounce the full-dataset save on each mutation.

### Accessibility
- Modals need `role="dialog"`, focus traps, and focus restoration; icon-only buttons need labels; clickable `div`s should be real controls.

### Maintainability
- Split `server/index.js` (~2,400 lines) into route modules and `src/IPAddressManager.jsx` (~8,900 lines) into components. Best done alongside the performance work, since memoising rows requires extracting them anyway.

---

## Planned

### Public API with named access keys

A stable, documented API for external clients — the iOS app first, but equally anything else that wants to read or change data without driving the web UI.

**Authentication: named API keys, in the style of Sonarr/Radarr.** Generate a key in Settings, copy it into the client, revoke it when you no longer want that client to have access. The client never handles your password, so nothing sensitive is stored on the device, and a compromised client is revoked without changing your password or disturbing any other client.

Improvements on the single-global-key design those apps use:

- **Multiple keys, each with a label** (`iPhone`, `Home Assistant`, `iPad`) and a created date. Rotating the phone's key must not take Home Assistant's sensors down, which a single shared key would.
- **A scope per key — `read` or `read-write`.** Home Assistant only ever reads; if that key leaks it should not be able to delete entries. The iOS app gets `read-write`.
- **Last-used timestamp** per key, so a key nothing has touched in months is obviously safe to revoke.

The existing Home Assistant key is the prototype for this and should migrate into the same table as a `read`-scoped key named "Home Assistant", so nothing breaks for existing users.

**Endpoint work required.** The current write path replaces the entire entry array in one `PUT /api/ips`, which is unworkable for a mobile client — editing one device would mean sending all of them back, and a concurrent Proxmox sync would silently discard one side of the change. Needed:

- `POST /api/ips` — create a single entry
- `PATCH /api/ips/:ip` — update a single entry
- `DELETE /api/ips/:ip` — remove a single entry
- A version or `ETag` on each entry so a stale client receives a conflict instead of overwriting newer data

Domains already follow this per-resource pattern (`POST /api/domains`, `DELETE /api/domains/:id`) and are the model to copy.

**Security notes.** Keys are bearer credentials: no expiry, no second factor, and full access within their scope. That tradeoff is proportionate for a self-hosted tool, provided that the key is accepted in the `X-API-Key` header and **never** as a query parameter on writes (query strings are recorded in Nginx access logs), rate limiting covers key authentication as well as login, and TLS is used wherever the instance is reachable beyond the LAN.

**Sequencing.** Depends on the session persistence and rate-limiting work in the security batch above — keys must survive a restart, which the current in-memory session map does not. Should land before the iOS app is started, so the client is not written against an auth model that is about to change.

*Deferred: QR-code pairing. Would make onboarding a phone easier, and the app already bundles a QR generator, but not needed for a first version.*

### Outbound notifications (webhooks / ntfy)
Push a notification when a device goes offline, a health check starts failing, or a domain approaches expiry — without needing Home Assistant in the middle. Highest value for the least work of anything on this list, and depends on nothing else.

### Audit log
A system-level record of logins, configuration changes, and updates. Entry-level history already exists; this is the missing counterpart, and worth having before multi-user.

### Automated test suite
The smoke tests added in v2.0.2 cover the API surface. Unit coverage of the auth and IP-maths helpers would have caught the v2.0.0 bcrypt regression before release.

### Passkey / WebAuthn authentication
Replace (or supplement) the username/password login with passkey support. Passkeys are phishing-resistant, require no password to remember, and are natively supported by all modern browsers and operating systems. The implementation would store a public key and credential ID per user, handle the WebAuthn challenge-response handshake, and fall back gracefully to password login for browsers that don't support it.

Should come **after** the session-expiry and rate-limiting work above — building it on the current session handling would mean redoing it.

### Two-factor authentication (TOTP)
TOTP (Google Authenticator / Aegis / similar) as an optional second factor on top of the existing password login.

### Multi-user support
Currently single-user. Allow multiple named accounts with role-based access (read-only viewer vs. full admin). Useful for shared home lab environments.

### IPv6 support
First-class support for IPv6 addresses and subnets alongside the existing IPv4 management.

### Network topology map
Visual diagram of the network showing device relationships — upstream router, switches, VLANs, connected devices. Read-only, auto-generated from existing entry data.

---

## Under Consideration

- **Dark mode persistence** — remember last-used theme across sessions (currently resets on page load)
- **Bulk tag editor** — apply or remove tags across multiple entries at once
- **Device history log** — track when an entry was last seen online, log state changes over time
- **SNMP / mDNS discovery** — passive discovery of new devices on the network without requiring manual entry
- **iOS app** — native client for at-a-glance status and quick lookups. Blocked on the public API above; a wrapper around the web UI would be quicker but gives up offline caching, push notifications, and widgets

---

## Completed

See [CHANGELOG.md](./CHANGELOG.md) for a full history of released features.

| Version | Feature |
|---------|---------|
| v2.0.2 | Unauthenticated `/api/proxmox/discover` fixed; Home Assistant device status fixed; smoke-test script added |
| v2.0.1 | Bcrypt hash detection hotfix and automatic double-hash recovery |
| v2.0.0 | Bcrypt password hashing — no plaintext credentials on disk |
| v1.33.0 | Home Assistant JSON API |
| v1.32.0 | SSH username per entry |
| v1.31.0 | Domain Tracker RDAP fixes and UI refresh |
| v1.30.0 | Domain Tracker |
| v1.29.0 | Unique generated passwords, default-creds lockout |
| v1.28.0 | DNS resolver per network, custom icon picker |
