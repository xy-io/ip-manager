# What's New

For the full release history see the [CHANGELOG](https://github.com/xy-io/ip-manager/blob/main/CHANGELOG.md) and [GitHub Releases](https://github.com/xy-io/ip-manager/releases).

---

## v2.2.0 — Notifications, activity log & accessibility

- **Outbound notifications.** Alerts when a device drops off, a health check fails, a domain nears expiry, or a backup fails — pushed to an [ntfy](https://ntfy.sh) topic or any webhook. No Home Assistant required. Configure in **Settings → Notifications**, pick which events to send, and use **Send test** to check delivery before switching it on. See [Notifications](Notifications).
- **Flap protection.** A device must miss a configurable number of consecutive ping cycles (two by default, about two minutes) before an offline alert fires, and it fires once rather than every minute. A single dropped packet never wakes you up.
- **Activity log.** A record of sign-ins including failed attempts, API key changes, configuration updates, entry edits, and device status changes — the last 500 events, filterable, in **Settings → Activity**. See [Activity Log](Activity-Log).
- **Both are session-only.** An API key cannot read the activity log or repoint notifications at another destination, whatever its scope.
- **Accessibility.** All eleven dialogs now announce themselves properly, move focus in on open, trap Tab inside, close on Escape, and restore focus on close. Icon-only buttons have accessible names, and IP cards and their checkboxes can be operated from the keyboard.

---

## v2.1.0 — Public API with named access keys

External clients — a phone, a script, Home Assistant — can now talk to IP Manager with their own API key instead of your account password.

- **Named, scoped API keys.** Create one per client in **Settings → API Keys**, each with a label and a scope of *read only* or *read & write*. Revoking one leaves the others working, so rotating the key on a lost phone no longer takes your Home Assistant sensors down with it. Each key shows when it was last used, making stale ones easy to spot.
- **Your existing Home Assistant key is migrated automatically** into the new store as a read-only key labelled "Home Assistant". Nothing in your `configuration.yaml` needs to change.
- **Per-entry endpoints** — `POST /api/ips`, `PATCH /api/ips/:ip`, `DELETE /api/ips/:ip` and `GET /api/ips/:ip`. Previously the only way to write was to replace the entire dataset, which meant an external client editing one device had to send every other device back, and a concurrent Proxmox sync would silently discard one side of the change.
- **Optimistic concurrency** — send `expectedLastModified` with an update and it is rejected with `409` if the entry changed since you read it, instead of quietly overwriting newer data.
- **Keys cannot manage the account.** Regardless of scope, an API key is refused on `/api/auth`, `/api/keys`, `/api/update`, `/api/support`, `/api/backup` and `/api/ha/key` — so a key can never mint another key, change your password, or download a support bundle.
- **Writes must use the `X-API-Key` header**, never an `?api_key=` query parameter, because query strings are recorded in Nginx access logs.

See [API](API) for the full reference.

---

## v2.0.2 — Security fix & Home Assistant status fix

- **`/api/proxmox/discover` required no authentication.** The route sat above the blanket auth middleware, so anyone able to reach the server could invoke it — and it connects to whatever host it is given. It now applies the auth middleware directly. No stored data was exposed, but an unauthenticated caller could use the server to probe other hosts on your network. **Update if your instance is reachable beyond your LAN.**
- **Home Assistant reported every device as "unknown".** The ping cache stores `up`/`down` while the HA endpoints compared against `alive`/`unreachable`, which never matched — so `devices_online` and `devices_offline` have read `0` on every install since the API shipped in v1.33.0. Both endpoints now share one translation helper that accepts either spelling. If you built automations on these sensors, **they will start reporting real values after this update.**
- **New smoke-test script** (`scripts/smoke-test.cjs`) — read-only end-to-end verification of authentication, every API route, the status caches, the Home Assistant API, and known security regressions. Both defects above were found by it. See [Testing](Testing).

---

## v2.0.1 — Hotfix: bcrypt hash detection

> **If you updated to v2.0.0 and cannot log in**, run `ip-manager-update`. On the next restart the problem is detected automatically and fresh credentials are written to the service journal:
> ```
> journalctl -u ip-manager-api | grep -A5 "double-hash recovery"
> ```
> Log in with those, then change your password in Settings.

- **Fixed hash detection** — `bcryptjs` produces `$2a$`-prefixed hashes but v2.0.0 only recognised `$2b$`, so the migration re-ran on every login attempt and hashed the hash. No password could then match.
- **Automatic recovery** — a double-hashed password is now detected on startup and replaced with fresh generated credentials, logged to the journal. No manual file editing needed.
- **Safer credential restore during updates** — the update script only restores a backed-up `credentials.env` if git deleted the file outright, not when its contents merely changed. Restoring on any change was undoing the bcrypt migration.

---

## v2.0 — Bcrypt password hashing *(major release)*

Passwords are no longer stored in plaintext on disk.

- `credentials.env` now stores a **bcrypt hash** (cost factor 12) instead of the raw password — the hash cannot be reversed to recover your password
- **Zero action required from existing users** — the server automatically migrates your plaintext password to a hash on first restart after upgrading; you log in with the same credentials as always
- First-run generated passwords are hashed before being written to disk; the one-time plaintext is only ever shown in the service journal
- Password changes via Settings also hash the new password immediately — plaintext never touches disk from v2.0 onwards
- Uses `bcryptjs` (pure JavaScript) — no native compilation, works on all architectures

See the [Roadmap](https://github.com/xy-io/ip-manager/blob/main/ROADMAP.md) for what's coming next, including passkey authentication.

---

## v1.33 — Home Assistant JSON API

New read-only REST API for integrating with Home Assistant or any automation platform.

- **`GET /api/ha/summary`** — device totals (online/offline/unknown), network count, domain expiry stats
- **`GET /api/ha/devices`** — per-device list with IP, name, type, tags, ping status, and health check result
- **`GET /api/ha/domains`** — all tracked domains with expiry dates and urgency status
- API key authentication — generate a key in **Settings → Home Assistant**, pass it as `X-API-Key` header or `?api_key=` parameter
- Ready-to-paste Home Assistant YAML snippet auto-generated in the Settings tab

---

## v1.32 — SSH username per entry

- Set a per-entry SSH username in the edit modal (e.g. `root` for Proxmox, `admin` for a router)
- SSH quick-launch button opens `ssh://user@hostname` using the configured user
- Live preview in the edit form shows the exact URL before saving
- Leaving the field blank preserves previous behaviour (OS default user)

---

## v1.31 — Domain Tracker: RDAP fixes & UI refresh

- **Fixed registrar names** — previously showed as numeric IANA IDs (e.g. "1068", "1910"). Now reads the human-readable name from vCard data.
- **Fixed .online / .watch / .pro lookups** — RDAP servers for these TLDs issue HTTP redirects; the lookup now follows them automatically.
- **Normalised nameserver case** — nameservers are stored and displayed entirely in lowercase.
- **Redesigned domain cards** — colour-coded left border, expiry date shown alongside the days badge, registrar as a hyperlink, cleaner error state.
- **Modal header** — retitled "Domain Tracker", shows total count and an expiring-within-30-days warning.

---

## v1.30 — Domain Tracker

New **Domains** section (Tools → Domains) for tracking domain registrations alongside your IP entries.

- RDAP-powered — fetches registrar, expiry date, and nameservers automatically via IANA bootstrap
- No API keys required; works for 1,400+ TLDs
- Colour-coded expiry badges: green (>60 days), amber (30–60), red (<30)
- Red notification dot on the Domains button when a renewal is due
- Automatic background refresh every 24 hours

---

## v1.29 — Security: no more default passwords

- Fresh installs generate a unique random password on first start — never ships with `admin`/`admin`
- Credentials logged to the systemd journal and printed by the installer
- If default credentials are detected, the API locks down and the app forces a password change before anything else can be done

---

## v1.28 — Per-network DNS resolver & icon picker

- Each network now has its own DNS resolver for PTR lookups
- Icon picker sources the full selfh.st library (500+ icons) via the GitHub API
- GUI update now streams live progress via SSE (no more silent hangs)

---

## v1.27 — Service health checks

- Opt-in HTTP/HTTPS probe per IP entry
- Sky-blue dot = service responding; orange = down
- Port auto-suggest for 60+ known services
- TLS errors on self-signed certificates are silently ignored

---

## v1.26 — QR codes & calculators

- QR code generator for any IP entry
- Built-in CIDR calculator
- Subnet splitter tool

---

## Earlier releases

See the full [CHANGELOG](https://github.com/xy-io/ip-manager/blob/main/CHANGELOG.md) on GitHub.
