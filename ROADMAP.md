# Roadmap

Ideas and planned improvements for IP Address Manager. This is a living document — items move into releases as they're implemented.

Items are roughly ordered by priority but nothing here is a firm commitment or timeline.

---

## Planned

### Passkey / WebAuthn authentication
Replace (or supplement) the username/password login with passkey support. Passkeys are phishing-resistant, require no password to remember, and are natively supported by all modern browsers and operating systems. The implementation would store a public key and credential ID per user, handle the WebAuthn challenge-response handshake, and fall back gracefully to password login for browsers that don't support it. The existing bcrypt credential system (v2.0.0) provides a solid foundation to build on top of.

### Two-factor authentication (TOTP)
TOTP (Google Authenticator / Aegis / similar) as an optional second factor on top of the existing password login.

### Multi-user support
Currently single-user. Allow multiple named accounts with role-based access (read-only viewer vs. full admin). Useful for shared home lab environments.

### IPv6 support
First-class support for IPv6 addresses and subnets alongside the existing IPv4 management.

### Webhook / push notifications
Outbound webhook calls (or ntfy / Apprise integration) when a device goes offline, a domain approaches expiry, or a health check starts failing — without needing Home Assistant as the middleman.

### Network topology map
Visual diagram of the network showing device relationships — upstream router, switches, VLANs, connected devices. Read-only, auto-generated from existing entry data.

---

## Under Consideration

- **Dark mode persistence** — remember last-used theme across sessions (currently resets on page load)
- **Bulk tag editor** — apply or remove tags across multiple entries at once
- **Device history log** — track when an entry was last seen online, log state changes over time
- **SNMP / mDNS discovery** — passive discovery of new devices on the network without requiring manual entry
- **Mobile app** — native iOS/Android wrapper around the existing web UI

---

## Completed

See [CHANGELOG.md](./CHANGELOG.md) for a full history of released features.

| Version | Feature |
|---------|---------|
| v2.0.0 | Bcrypt password hashing — no plaintext credentials on disk |
| v1.33.0 | Home Assistant JSON API |
| v1.32.0 | SSH username per entry |
| v1.31.0 | Domain Tracker RDAP fixes and UI refresh |
| v1.30.0 | Domain Tracker |
| v1.29.0 | Unique generated passwords, default-creds lockout |
| v1.28.0 | DNS resolver per network, custom icon picker |
