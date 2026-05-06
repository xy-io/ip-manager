# What's New

For the full release history see the [CHANGELOG](https://github.com/xy-io/ip-manager/blob/main/CHANGELOG.md) and [GitHub Releases](https://github.com/xy-io/ip-manager/releases).

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
