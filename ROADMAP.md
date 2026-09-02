# Roadmap

Ideas and planned improvements for IP Address Manager. This is a living document — items move into releases as they're implemented.

Items are roughly ordered by priority but nothing here is a firm commitment or timeline.

---

## Next release

Known defects and hardening work, in the order they should be tackled. These come ahead of new features.

### Maintainability — next up (v2.5.0)
- Split `server/index.js` into route modules and `src/IPAddressManager.jsx` into components. Planned as a pure code-movement release with no behaviour change, so that any smoke-test failure unambiguously indicates a refactor mistake.

### Performance — follows the split
- **Memoise list rows** — a status poll re-renders every entry three times a minute because nothing below the root is memoised. Requires the card and row components to be extracted first, which is what the split does.
- **Virtualise long lists** — fine at 90 entries, painful at 500, unusable on a /16. Also easier once rows are their own components.

Debounced saves shipped in v2.4.0.

---

## Planned

### APNs push notifications
Server-side Apple Push Notification support, so alerts reach the iOS app when it is closed. Without it, iOS background refresh is opportunistic and cannot guarantee delivery. Requires: registering, updating and removing device tokens; per-device notification preferences; sending pushes for host down/recovered, service down, new ARP discovery, and domain expiry at 30, 15, 10 and 1 day; an event identifier, event type, IP or domain identifier, title and body in each payload; and deduplication so a repeated alert is not resent and a recovery is only sent after a genuine state transition.

The v2.2.0 event system already detects and deduplicates exactly these transitions, so this is largely a delivery channel rather than new detection logic. `GET /api/capabilities` reports `pushNotifications: false` until it exists.

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
- **iOS app** — native client for at-a-glance status and quick lookups. The v2.3.0 API is the foundation; a client authenticates with a read & write key created in Settings. Siri intents would additionally want name search, a merged per-device status view, and a next-free-IP endpoint

---

## Completed

See [CHANGELOG.md](./CHANGELOG.md) for a full history of released features.

| Version | Feature |
|---------|---------|
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
