# Roadmap

Ideas and planned improvements for IP Address Manager. This is a living document — items move into releases as they're implemented.

Items are roughly ordered by priority but nothing here is a firm commitment or timeline.

---

## Next release

Known defects and hardening work, in the order they should be tackled. These come ahead of new features.

### Maintainability — frontend split remains
The server split shipped in v2.5.0. `src/IPAddressManager.jsx` (~9,400 lines) has not been split yet, and deliberately so: the smoke suite exercises the API, not the interface, so a frontend extraction can only be verified as far as "it still builds". The v2.5.0 server split turned up two path bugs that both a syntax check and a successful build would have missed — the equivalent mistakes in the frontend would reach users.

Doing it safely needs one of: a component test setup, or extraction restricted to pure helpers and leaf components one at a time with manual checking between each.

### Performance — what is left
Bundle size was the only user-visible performance problem, and v2.6.0 halved it by loading `xlsx` and `qrcode` on demand. What remains is not urgent at present scale:

- **Lazy-load the heavy modals** — Help (714 lines), Subnet Visualiser, Import, Backup and the calculators are all rarely opened and could be split out the same way. Worth roughly another 15–20% of the main chunk. Easier once components are extracted, but achievable with `React.lazy` beforehand.
- **Memoise list rows** — three status polls a minute each re-render all entries. At 87 entries this is tens of milliseconds and imperceptible; it matters north of ~500 entries or on older hardware. Needs the card and row components extracted first.
- **Virtualise long lists** — same trigger point, same prerequisite.

Debounced saves shipped in v2.4.0.

---

## Planned

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

---

## Not planned here — iOS client

The native iOS app is developed separately and is **not** part of this roadmap. Requirements will arrive as specific requests.

Recorded only so the context is not lost if that happens:

- **APNs push** — server-side Apple Push Notification support, so alerts reach the app when it is closed. Needs device-token registration and removal endpoints, per-device preferences, and payloads carrying an event id, type, IP or domain, title and body. The v2.2.0 event system already detects and deduplicates the relevant transitions, so this would be a delivery channel rather than new detection logic. Also needs an Apple Developer account and push key, and the payload shape agreed with whoever builds the app. `GET /api/capabilities` reports `pushNotifications: false`.
- **Three endpoints Siri intents would want** — search entries by name, a merged per-device status view (entry plus ping plus health in one call, currently three), and a next-free-IP endpoint (that calculation lives only in the web frontend today).

Nothing here is being built unless asked for.

---

## Completed

See [CHANGELOG.md](./CHANGELOG.md) for a full history of released features.

| Version | Feature |
|---------|---------|
| v2.7.0 | Unit test suite (53 tests) over auth, network and redaction logic |
| v2.6.0 | On-demand loading of xlsx and qrcode — initial bundle halved |
| v2.5.0 | Server split into lib/ and routes/ modules — pure code movement |
| v2.4.0 | Command-injection fixes, bundle redaction, rate limiting, session expiry, three correctness bugs |
| v2.3.0 | Full API-key compatibility, structured errors, capabilities endpoint |
| v2.2.0 | Outbound notifications (ntfy/webhook), activity log, accessibility pass |
| v2.1.0 | Public API with named, scoped access keys; per-entry CRUD endpoints |
| v2.0.2 | Unauthenticated `/api/proxmox/discover` fixed; Home Assistant device status fixed; smoke-test script added |
| v2.0.1 | Bcrypt hash detection hotfix and automatic double-hash recovery |
| v2.0.0 | Bcrypt password hashing — no plaintext credentials on disk |
| v1.33.0 | Home Assistant JSON API |
| v1.32.0 | SSH username per entry |
| v1.31.0 | Domain Tracker RDAP fixes and UI refresh |
| v1.30.0 | Domain Tracker |
| v1.29.0 | Unique generated passwords, default-creds lockout |
| v1.28.0 | DNS resolver per network, custom icon picker |
