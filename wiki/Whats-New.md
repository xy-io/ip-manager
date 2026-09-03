# What's New

For the full release history see the [CHANGELOG](https://github.com/xy-io/ip-manager/blob/main/CHANGELOG.md) and [GitHub Releases](https://github.com/xy-io/ip-manager/releases).

---

## v2.9.1 — Hypervisor links that actually appear

If your topology view looked emptier than expected, this is why. v2.9.0 only linked a guest to its Proxmox host when your entry was named *exactly* as Proxmox reports the node — same spelling, same case, no domain. Most inventories do not name things that way, so the links were quietly missing.

Matching is now forgiving: `PVE-01`, `pve-01.example.lan` and `Proxmox (pve-01)` all match node `pve-01`. And if guests point at a hypervisor that is not in your inventory at all, the view now names it and tells you to add it, instead of showing nothing.

**Show gateway links** is a new toggle at the top of the view. Every device on a subnet does depend on its router, so this draws that — but it is off by default, because on a large network it produces a star with one node in the middle and buries the relationships you actually recorded. It only applies where one unambiguous router exists on a network.

---

## v2.9.0 — Device history & network topology

Two new views over information the app already had.

**Device history** — expand any IP card to see when it last responded, how many times it has dropped in the last 30 days, and a timeline of every status change. Only transitions are recorded, so a device that just stays up adds nothing.

**Network topology** — a new **Tools → Topology** view showing every device and how they relate. Nothing to configure: it draws the dependency links you created in the edit modal, and works out which guests belong to which Proxmox host on its own.

**Click any device to see its blast radius** — everything that would be affected if it went down, following dependency chains. Handy before rebooting a switch or a hypervisor.

The more dependency links you fill in on your entries, the more useful the picture becomes.

---

## v2.8.0 — Two-factor authentication

Optional, and **off by default** — nothing about your sign-in changes unless you switch it on.

Turn it on in **Settings → Security**. Scan the QR with Google Authenticator, Aegis, 1Password or similar, enter the code it shows to prove it works, and save the ten recovery codes you are given.

**You cannot lock yourself out.** Three ways back in:

1. **Settings → Security**, while signed in — turn it off with your password
2. **A recovery code**, entered instead of an authenticator code at sign-in
3. **`sudo node /opt/ip-manager/scripts/disable-totp.cjs`** on the server, then restart the service — for when you have lost both. Your password and data are untouched.

Worth turning on if your instance is reachable from the internet. Not really necessary if it only ever answers on your LAN.

**Home Assistant and any other API client are unaffected** — two-factor applies to the browser login only.

See [Two-Factor Authentication](Two-Factor-Authentication).

---

## v2.7.0 — Unit test suite

Developer-facing only; nothing changes in the app.

53 unit tests now cover the server logic that has historically broken — subnet validation, secret redaction, the credentials bcrypt migration, session expiry, login throttling and API key scopes. Run them with `npm test`.

Every test corresponds to a real past failure rather than being written for coverage. The suite was checked by deliberately reintroducing two old bugs and confirming it catches both.

See [Testing](Testing).

---

## v2.6.0 — Faster first load

The app's JavaScript bundle has been **halved** — from 277 kB to 127 kB gzipped.

Two libraries, `xlsx` (spreadsheet import/export) and `qrcode`, were being downloaded on every single page load despite being used by only three features. They now load the first time you actually use them.

**What changes for you:** the app loads faster, particularly on a phone or a slow connection. The first time in a session that you open the QR modal, import a spreadsheet or export to Excel, there is a brief pause while that library downloads; it is then cached and every later use is instant.

Nothing else changes — same features, same data, same API.

---

## v2.5.0 — Server code split

Infrastructure only. **Nothing changes for you** — no new features, no behaviour changes, no data changes.

`server/index.js` had reached 3,325 lines. Credentials, sessions, API keys, the event system, the database layer, and the Domain Tracker and cloud-backup routes now live in `server/lib/` and `server/routes/`, taking the main file down to about 2,350 lines. Everything else is byte-for-byte the same logic in a different file.

The full 102-check smoke suite was run against the real server before the refactor and after every extraction step, with the results diffed each time. All identical.

Worth knowing: the process caught a bug where moving credential loading into a subdirectory would have changed where the server looks for `credentials.env` — it would have found nothing, assumed a fresh install, and generated new credentials, locking you out. That is now explicitly guarded and tested.

---

## v2.4.0 — Security hardening & correctness fixes

No new features. This release fixes things that were wrong.

**Security**

- **Two command-injection paths closed.** The `subnet` field was interpolated into a shell string for `arp-scan`, and the rclone backup password was quoted with `JSON.stringify` — which quotes for JavaScript, not for a shell. Both now use argument arrays with no shell involved, plus strict validation of subnets and interface names.
- **The support bundle no longer contains credentials.** It embeds recent log lines, which on a fresh or recovered install still hold the generated startup password. Passwords, hashes, API keys and bearer tokens are redacted before the bundle is written. **If you have shared a support bundle previously, treat the credentials in it as exposed.**
- **Login rate limiting** — ten failures from one address in fifteen minutes triggers a fifteen-minute throttle, checked before the password comparison runs. A successful sign-in clears it, and a restart clears everything, so you can never be permanently locked out.
- **Sessions expire** — seven days idle, thirty days absolute, on a sliding window. Continued use keeps you signed in.

**Fixes**

- The IP list **stopped refreshing after a Proxmox sync** — the refresh function was called but never existed.
- **The wrong card expanded** when the list had been sorted or a status poll had just run; expansion was tracked by list position rather than by IP.
- **Saves are debounced** and no longer echo freshly-loaded server data straight back, which could overwrite a Proxmox sync running at that moment.

---

## v2.3.0 — Full API-key compatibility for native clients

Groundwork for the iOS app, led by a bug fix that made key authentication largely unusable.

- **API keys now work on every endpoint.** Around 48 routes — Domains, Ping, Service Health, ARP, DNS, Proxmox and others — checked only for a session cookie. A valid key passed the main middleware and was then rejected by the route itself, so external clients got `401` from most of the API. Fixed.
- **Structured JSON errors** — every failure returns `{ "error", "message" }`. `401` for a missing or invalid key, `403` for a valid key without permission, `409` for an edit conflict. Nothing returns HTML or a login redirect.
- **`GET /api/capabilities`** — a feature map so a client can tell "not supported" apart from "broken".
- **Timestamps are Unix seconds**, and countdowns are seconds, on the status endpoints. They were milliseconds, which would have made a client's refresh scheduling wrong by a factor of a thousand.
- **The Proxmox API token is no longer returned to API keys** — `tokenConfigured` replaces it. Proxmox routes also answer properly when Proxmox has never been configured.
- **`label` and `serviceUrl`** are added to entries for API clients, so each client does not reimplement the same fallbacks.

See [API](API) for the full reference.

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
