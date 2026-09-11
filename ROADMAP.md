# Roadmap

Ideas and planned improvements for IP Address Manager. This is a living document — items move into releases as they're implemented.

Items are roughly ordered by priority but nothing here is a firm commitment or timeline.

---

## Next release

Known defects and hardening work, in the order they should be tackled. These come ahead of new features.

### Maintainability — frontend split remains
The server split shipped in v2.5.0. `src/IPAddressManager.jsx` has not been fully split, though v2.12.0 moved eight modals out (~10,500 → ~9,600 lines in the main file).

The blocker was that a frontend extraction could only be verified as far as "it still builds". **v2.12.0 addressed that**: `npm run check:modals` renders each extracted component server-side and fails on a missing reference — it caught three modals that compiled cleanly and would have opened blank. Extending that harness to cover more components is the prerequisite for going further.

What remains in the main file is the application shell, the entry table and the edit and settings modals, which hold shared state and are harder to lift out than the leaf modals were.

### Performance — what is left
Bundle size was the only user-visible performance problem, and v2.6.0 halved it by loading `xlsx` and `qrcode` on demand. What remains is not urgent at present scale:

- **Memoise list rows** — three status polls a minute each re-render all entries. At 87 entries this is tens of milliseconds and imperceptible; it matters north of ~500 entries or on older hardware. Needs the card and row components extracted first.
- **Virtualise long lists** — same trigger point, same prerequisite.

Debounced saves shipped in v2.4.0.

---

## Planned

### Passkey / WebAuthn authentication
Replace (or supplement) the username/password login with passkey support. Passkeys are phishing-resistant, require no password to remember, and are natively supported by all modern browsers and operating systems. The implementation would store a public key and credential ID per user, handle the WebAuthn challenge-response handshake, and fall back gracefully to password login for browsers that don't support it.

Should come **after** the session-expiry and rate-limiting work above — building it on the current session handling would mean redoing it.

### Multi-user support
Currently single-user. Allow multiple named accounts with role-based access (read-only viewer vs. full admin). Useful for shared home lab environments.

### IPv6 support
First-class support for IPv6 addresses and subnets alongside the existing IPv4 management.

---

### Network Watch — phases 2 and 3
Phase 1 (the device ledger) shipped in **v2.11.0**. What remains:

**Phase 2 — alerting.** Per-device expectations, graded severity, confirmation counts before anything fires, and digest delivery. Still opt-in, still off by default.

**Phase 3 — correlated incidents.** Group alerts by root cause using the dependency graph, so a failed switch produces one notification naming the affected devices rather than one per device. Plus behavioural baselining from device history, so "this has been up for 60 days and just dropped" is treated differently from a laptop that comes and goes.

**Later — rogue DHCP detection.** Useful and self-contained, but a separate scanning mechanism with its own risks.

The original assessment, for reference:

**Opt-in, off by default.** A monitoring layer that answers what Pi.Alert answers — *is something on my network that should not be there?* — using everything the app already knows, rather than a MAC ledger alone.

The differentiators, none of which are available to a MAC-only tool: alerts **grouped by root cause** using the v2.9.0 dependency graph (one "switch offline, 30 devices affected" instead of thirty notifications); **identity by correlation** across MAC, vendor, mDNS name and services, so a phone with a fresh randomised MAC is recognised rather than reported as an intruder; **per-device expectations** instead of one global "always connected" flag; and **graded severity**, so an unknown device in the static range is treated differently from one in the DHCP pool.

Needs one new persistent structure — a device ledger — with a pruning policy for randomised MACs decided up front, and exclusion from support bundles.

Full design, including the notification policy and phasing, in [wiki/Network-Watch-Design.md](./wiki/Network-Watch-Design.md).

---

### All devices view — the network as it actually is

A third mode on the home view, beside cards and table: **Inventory** (the default) and **All devices**.

The inventory shows what you manage, which is largely the static range. It cannot answer "what is actually on my network", because everything holding a DHCP lease is invisible to it. This merges the two into one list, marking which rows are managed and which are merely present.

**Not a "DHCP" tab.** A DHCP-only view excludes every static device, so it never answers the whole question either. The useful list is everything, with provenance.

**Sources, merged.** Pi-hole leases where configured (authoritative, named), plus ARP discovery results (works everywhere, no Pi-hole needed). Each row shows where it came from, and the view degrades gracefully when only one source is available.

**Reuses what exists.** Search and sort carry over from the main list; the **Add** button from v2.15.0 appears on rows that are not in the inventory, so the view is an on-ramp rather than a dead end. Read-only otherwise.

**The line this must hold**, or it should not be built:

| View | Answers |
|---|---|
| Inventory | What do I manage? Editable. |
| All devices | What is on the network right now? Reference. |
| [Network Watch](./wiki/Network-Watch.md) | Is this expected? History and identity over time. Opt-in. |

Network Watch already lists observed devices, so the risk is two places showing the same thing. If that distinction cannot be made obvious on screen, the right answer is to send people to Network Watch instead of building a second list.

**Scope discipline.** A view toggle, not a new top-level concept — the inventory stays the default and this adds no settings of its own. It stops being justified the moment it grows its own configuration.

---

## Under Consideration

- **Dark mode persistence** — remember last-used theme across sessions (currently resets on page load)
- **Bulk tag editor** — apply or remove tags across multiple entries at once
- **SNMP discovery** — passive discovery via SNMP for managed switches and routers (mDNS shipped in v2.10.0)

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
| v2.18.0 | Maintenance flag: deliberately-offline hosts excluded from counts and alerts |
| v2.17.0 | Offline filter on the main list, with a live count |
| v2.16.0 | API reference completed and enforced by test; client handover page |
| v2.15.1 | The what's new dialog appears for installs updating into the feature |
| v2.15.0 | Add discovered devices to the inventory from Network Watch; modal Escape ordering fixed |
| v2.14.0 | "What's new" dialog on the first load after an update, sourced from the wiki |
| v2.13.2 | Vendor lookup fallback fixed; duplicate ARP replies flagged rather than shown as a vendor name |
| v2.13.1 | Pi-hole connection errors translated into actionable advice |
| v2.13.0 | Optional Pi-hole DHCP lease lookup — names unrecognised devices in Network Watch |
| v2.12.0 | Eight modals lazily loaded — initial bundle down 23%, plus a modal render check |
| v2.11.3 | arp-scan --quiet output parsed correctly — the actual cause of empty discovery sweeps |
| v2.11.2 | Discovery scan failures reported rather than swallowed; Network Watch moved into Tools |
| v2.11.1 | Network Watch discoverability — open from Settings, count badge on the header icon |
| v2.11.0 | Network Watch phase 1 — opt-in bounded device ledger with randomised-MAC detection |
| v2.10.0 | mDNS/DNS-SD discovery — friendly names from the network, dependency-free |
| v2.9.1 | Forgiving hypervisor name matching, untracked-host hints, optional gateway links |
| v2.9.0 | Per-device history timeline and network topology view with impact analysis |
| v2.8.0 | Optional two-factor authentication (TOTP) with recovery codes |
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
