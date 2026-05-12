# What's New

For the full release history see the [CHANGELOG](https://github.com/xy-io/ip-manager/blob/main/CHANGELOG.md) and [GitHub Releases](https://github.com/xy-io/ip-manager/releases).

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
