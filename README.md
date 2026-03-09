# 🌐 IP Address Manager

A clean, fast web app for managing your home network's IP addresses — built to replace the Excel spreadsheet you've been using for years.

![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite)
![Tailwind](https://img.shields.io/badge/Tailwind-3-38BDF8?style=flat-square&logo=tailwindcss)
![Nginx](https://img.shields.io/badge/Nginx-ready-009639?style=flat-square&logo=nginx)
![License](https://img.shields.io/badge/license-PolyForm_NC-blue?style=flat-square)

---

## What It Does

Managing a home lab network across servers, VMs, containers, cameras, switches, and IoT devices gets complicated fast. This tool gives you a single place to:

- **Look up any IP address** instantly by name, hostname, service, location, or tag
- **See what's running** on each address — service, container type, host/hypervisor, physical location
- **Track free IPs** in your static range with one-click claiming for new servers or containers
- **Edit any entry** — change the asset name, hostname, type, location, service, tags, and notes via a clean modal form
- **Release IPs** back to the free pool when you decommission something
- **Manage multiple networks / VLANs** — add a second (or third) subnet and switch between them with tabs; each network is fully isolated
- **Full backup & restore** — download a single JSON file containing all networks, all IP entries, tags, notes, and change history; restore it on any machine in one click
- **Import from CSV / Excel** — 3-step modal with column mapping, validation, and merge or replace modes
- **Export to Excel** — downloads a fully formatted `.xlsx` preserving all your data
- **Switch views** between Cards (visual) and Table (dense, sortable) layouts
- **Keyboard shortcuts** — `/` to search, `Esc` to clear/close, `t`/`c` to switch views
- **Configure your network** — subnet, DHCP range, static range, and DHCP reservations via the Settings panel — no code editing required

### Network-Aware

The app understands your network layout and is fully configurable via the ⚙️ Settings panel. Both **/24 and /16 networks** are supported:

| Range | Type |
|---|---|
| DHCP start – DHCP end | DHCP pool (managed by your router / DHCP server) |
| Entries in the Reservations list | Fixed DHCP reservations — can be anywhere on the network, inside or outside the DHCP pool |
| Static start – Static end | Static assignments |
| Green entries | Free — available to claim |

You can paste your full network address (e.g. `192.168.0.0` or `172.16.0.0`) and the app strips trailing zeros automatically to derive the correct prefix.

### v1.9 Features

**Login / authentication** — The app is now protected by a username and password login screen. Default credentials are `admin` / `admin`. After signing in, go to **Settings → Account** to set your own username and password — no server access required. Credentials are stored in `server/credentials.env` on the LXC. Sessions persist for the lifetime of the browser tab; a sign-out button appears in the header.

### v1.8 Features

**Multi-network / VLAN support** — Click **Add Network** (next to the ⚙️ Settings button) to add a second subnet — e.g. a dedicated IoT VLAN or a separate 172.16.x.x management segment. Network tabs appear at the top of the page; switching tabs instantly scopes all views, stats, free IPs, and search to that network. Each network has its own independent config. Delete a network (and all its entries) from Settings → Danger Zone when no longer needed.

**Full backup & restore** — Settings → Backup & Restore → **Download Full Backup** exports a single `.json` file containing every network config, every IP entry across all networks, all tags, notes, and full change history. **Restore from Backup** reads that file, shows you a preview (export date, network count, entry count), and requires explicit confirmation before replacing anything. Use it to migrate to a new server or as a safety snapshot before a major change.

**Hide free IP cards** — Settings → Display → toggle **Show free IP cards in main list**. Leave it on for normal use; turn it off if you manage a `/16` network where tens of thousands of green "Free" cards would slow the browser. The Free Static IPs panel in the header still works either way — only the per-card rendering in the main list is suppressed. Preference is stored per browser.

### v1.7 Features

**Bulk selection & bulk edit** — Checkboxes on every card and table row let you select multiple IPs at once. Selecting items reveals a bulk action bar. The Bulk Edit modal lets you add tags (appended to existing), set type, or set location across all selected entries at once. A Release button returns selected IPs to the free pool.

**Change history / audit log** — Every save records a timestamped diff of what changed (field by field, old value → new value). Bulk edits are flagged with a "bulk" badge. History is visible in the expanded card view, newest first, capped at 20 entries per IP.

**Location management** — New Locations section in Settings lets you manage physical locations: rename a location across all entries, delete a location, or add new locations before any entry uses them.

**Free IPs in main list** — Free static IPs are computed from the static range minus assigned entries. They appear as searchable "Available" cards/rows in the main view. Clicking an Available IP claims it instantly.

---

## Screenshots

> Cards view showing assigned and free IPs, with the Edit modal open.

![IP Address Manager Preview](./preview.png)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Tailwind CSS 3, Lucide Icons |
| Build tool | Vite 5 |
| API server | Node.js + Express |
| Database | SQLite via `better-sqlite3` |
| Excel export | SheetJS (xlsx) |
| Web server | Nginx (reverse proxy + static files) |
| Runtime | Node.js 20 LTS |

---

## Installation

There are two ways to run this — locally for development, or on an LXC container on your Proxmox host for an always-on deployment.

---

### Option A — Local Development

Ideal for making changes or testing on your own machine.

**Prerequisites:** [Node.js 18+](https://nodejs.org)

```bash
# 1. Clone the repo
git clone https://github.com/xy-io/ip-manager.git
cd ip-manager

# 2. Install dependencies
npm install

# 3. Start the dev server
npm run dev
```

Open **http://localhost:5173** in your browser.

---

### Option B — LXC Container on Proxmox (Recommended)

Deploys the app as a production build served by Nginx on port 80. One script does everything.

#### Step 1 — Create the LXC container

In the Proxmox web UI:

1. Click **Create CT**
2. Use an **Ubuntu 24.04** template
3. Recommended specs:
   - CPU: 1 core
   - RAM: 512 MB
   - Disk: 4 GB
4. Give it a static IP in your static range
5. Start the container

#### Step 2 — SSH into the container

```bash
ssh root@<container-ip>
```

#### Step 3 — Run the install script

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/xy-io/ip-manager/main/install.sh)
```

The script will:

1. Update apt packages
2. Install `git`, `curl`, and `nginx`
3. Install Node.js 20 LTS
4. Clone this repository to `/opt/ip-manager`
5. Run `npm install` and `npm run build`
6. Configure Nginx to serve the app on **port 80**
7. Create an `ip-manager-update` command for future updates

When it finishes, open the container's IP in your browser and you're done.

---

## Data Persistence

The app supports two persistence modes and switches between them automatically:

| Mode | When | What it means |
|---|---|---|
| 🟢 **SQLite** | LXC/Nginx deployment | Data stored in `server/ip-manager.db` on the server — shared across all users and browsers |
| ⚪ **Local** | Local dev (`npm run dev`) | Data stored in your browser's localStorage — private to that browser |

On startup the app sends a quick health check to `/api/health`. If the API responds, it loads data from SQLite and shows the green **SQLite** badge in the header. If not, it falls back to localStorage automatically.

All saves happen automatically in both modes. The **Export** button downloads a formatted `.xlsx` of the current network. For a complete backup of all networks and all data, use **Settings → Backup & Restore → Download Full Backup** — this produces a `.json` file that can be fully restored later.

**Clearing all data:** open ⚙️ Settings → scroll to the **Danger Zone** section → Clear All Network Data. This wipes all IP entries and persists the change through the normal save path.

---

## Updating

When new code is pushed to GitHub, your stored IP data is untouched by updates.

### LXC / Nginx deployment

```bash
ip-manager-update
```

This pulls the latest code, wipes and reinstalls `node_modules` for a clean platform-native build, rebuilds the app, restarts the API service, and reloads Nginx — all in one command.

### Local development

```bash
git pull
npm install  # only needed if package.json changed
npm run dev
```

---

## Project Structure

```
ip-manager/
├── src/
│   ├── IPAddressManager.jsx   # Main React component (all logic and UI)
│   ├── main.jsx               # React entry point
│   └── index.css              # Tailwind base styles
├── server/
│   ├── index.js               # Express + SQLite API server (port 3001)
│   ├── package.json           # Server dependencies
│   ├── credentials.env        # Login credentials (edit to change username/password)
│   └── ip-manager.db          # SQLite database (created on first run)
├── public/
│   └── favicon.svg
├── index.html
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── package.json
├── install.sh                 # LXC one-line install script
└── IP_Manager_Roadmap.docx    # Feature roadmap
```

---

## Roadmap

See [`IP_Manager_Roadmap.docx`](./IP_Manager_Roadmap.docx) for the full three-phase roadmap.

**Phase 1 — near-term (Q1–Q2 2026):**
- ✅ Tag support, sort controls, last modified date, keyboard shortcuts — shipped
- ✅ Bulk selection & bulk edit, Location management, Free IPs in main list — shipped in v1.7
- ✅ Change history / audit log — shipped in v1.7
- ✅ Multi-network / VLAN support, Full backup & restore, Hide free IP cards toggle — shipped in v1.8
- ✅ Login screen & credential management — shipped in v1.9
- ✅ Proxmox one-shot import — discover all VMs and LXCs from a Proxmox host and import in one click — shipped in v1.10
- **PWA / Offline support** — install to home screen; works without network access

**Phase 2 — mid-term (Q3–Q4 2026):**
- **Multiple IPs per host** — support servers/VMs with more than one NIC or VLAN leg
- **Ping / reachability** — live status indicators per IP
- **Proxmox scheduled sync** — automatically re-discover and update Proxmox entries on a schedule
- **Pi-hole import (v6)** — one-shot import of Pi-hole v6 local DNS records to populate or enrich existing entries
- **ARP scan — one-shot** — scan the configured subnet on demand from the server; returns IP, MAC address, and hostname (where available); cross-references against existing entries to highlight untracked devices and unclaimed IPs
- **Service health checks** — HTTP probes with UP/DOWN badges

**Phase 3 — longer-term (2027+):**
- **Proxmox live status** — real-time VM/LXC power state badges using the Proxmox API
- **Pi-hole DNS validation** — flag entries where the hostname stored in the IP manager doesn't match what Pi-hole v6 resolves; amber warning badge on the card
- **ARP scan — background** — periodic scheduled scans (rate-limited, subnet-scoped) that update a "last seen" timestamp on each card and surface newly appeared devices automatically
- Network topology map, uptime alerts, REST API, network scanner
- **Multi-user auth** — per-user accounts with role-based access (read-only vs admin)

---

## Network Configuration

No code editing required. Click the **⚙️ Settings** icon in the app header to configure:

| Setting | Description |
|---|---|
| Network name | Display name shown in the header and network tabs |
| Subnet | Your network prefix — paste the full address (`192.168.0.0`) or just the prefix (`192.168.1` for /24, `192.168` for /16). Trailing zeros are stripped automatically. |
| DHCP range | Start and end of the DHCP pool (single octets for /24, e.g. `1`/`170`; two octets for /16, e.g. `2.20`/`2.250`) |
| DHCP Reservations | Host portions of IPs with DHCP reservations — can be anywhere on the network, not just within the DHCP pool |
| Static range | Start and end of your static assignments |
| Locations | Add, rename, or remove physical location labels for the active network |
| Display | Toggle whether free IP cards appear in the main list (turn off for large /16 networks) |
| Backup & Restore | Download a full `.json` backup or restore from a previous backup |
| Account | Change the login username and password without touching the server |
| Delete Network | Removes the active network and all its IP entries (shown only when multiple networks exist) |

Settings are saved automatically and persist across sessions.

---

## Importing Your IP Data

Click the **Import** button in the app header to load your own data from a `.csv`, `.xlsx`, or `.xls` file. The import flow is three steps:

**Step 1 — Upload**
Drag and drop a file onto the upload zone, or click to browse. A downloadable CSV template with the correct headers is available if you're starting from scratch.

**Step 2 — Map Columns**
The importer auto-detects common column name variations (e.g. `hostname`, `host name`, `fqdn` all map to Hostname automatically). If your headers aren't recognised, use the dropdowns to match each field manually.

**Step 3 — Confirm & Import**
A summary shows how many rows are ready to import and how many were skipped (with reasons). Choose your import mode:

| Mode | Behaviour |
|---|---|
| **Merge** | Adds new entries; updates existing ones matched by IP address. Existing entries not in the file are left untouched. |
| **Replace** | Replaces all current data with the imported rows. Use with caution. |

**Supported columns**

| Column | Required | Notes |
|---|---|---|
| `ip` | ✅ | Full IPv4 (`192.168.0.10`). On /24 networks, last-octet shorthand (`10`) is expanded to your subnet automatically. |
| `hostname` | ✅ | FQDN or short name |
| `type` | ✅ | e.g. `LXC`, `VM`, `Physical`, `IoT` |
| `service` | ✅ | App or service running on the host |
| `name` | — | Display / asset name (falls back to hostname prefix if omitted) |
| `location` | — | Physical location or rack |
| `host` | — | Hypervisor or host machine |
| `notes` | — | Free-text notes |
| `status` | — | `assigned` or `free` (defaults to `assigned`) |

---

## License

© 2026 Jay Allen — free for personal and non-commercial use under the [PolyForm Noncommercial License 1.0.0](./LICENSE). Commercial use is not permitted without explicit permission.
