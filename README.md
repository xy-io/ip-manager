# 🌐 IP Address Manager

A clean, fast web app for managing your home network's IP addresses — built to replace the Excel spreadsheet you've been using for years.

[![Website](https://img.shields.io/badge/website-xy--io.github.io%2Fip--manager-10b981?style=flat-square&logo=githubpages)](https://xy-io.github.io/ip-manager/)
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
- **Ping / reachability** — live green/red status dots on every IP; auto-refreshes every 60 seconds in the background

### Network-Aware

The app understands your network layout and is fully configurable via the ⚙️ Settings panel. Both **/24 and /16 networks** are supported:

| Range | Type |
|---|---|
| DHCP start – DHCP end | DHCP pool (managed by your router / DHCP server) |
| Entries in the Reservations list | Fixed DHCP reservations — can be anywhere on the network, inside or outside the DHCP pool |
| Static start – Static end | Static assignments |
| Green entries | Free — available to claim |

You can paste your full network address (e.g. `192.168.0.0` or `172.16.0.0`) and the app strips trailing zeros automatically to derive the correct prefix.

### v1.16 Features

**Multiple IPs per host (Option A — host grouping)** — A server or VM with multiple network interfaces can now have all its IPs linked together in the manager. Open the Edit modal for the primary IP, scroll to the new **Secondary IPs** section, and pick any other entry from the dropdown to link it. The primary card shows the secondary IP addresses as small blue chips; secondary cards show a "↳ Primary name" label so you always know which host they belong to. The same display appears in table view. Unlinking removes the association instantly. The data model uses a lightweight `hostId` field on each entry — existing data is unaffected, and the grouping can be upgraded to a richer model later without any migration risk. Proxmox import now automatically groups entries when a single VM or LXC reports multiple IP addresses (multi-NIC or multi-VLAN setups).

→ Full version history: [CHANGELOG.md](./CHANGELOG.md)

---

## Screenshots

> Cards view — light mode, showing 91 IP entries with status dots, type badges, location chips, and tags.

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
2. Install `git`, `curl`, `nginx`, and `arp-scan`
3. Install Node.js 20 LTS
4. Clone this repository to `/opt/ip-manager`
5. Run `npm install` and `npm run build`
6. Set correct file ownership so the service user can write the database and credentials
7. Configure Nginx to serve the app on **port 80**
8. Create an `ip-manager-update` command for future updates

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
- ✅ Tag management in Settings — add, rename, delete tags; suggestions dropdown on edit modal — shipped in v1.10
- ✅ ARP network scan — one-shot subnet sweep, cross-references against manager, import untracked devices — shipped in v1.11
- ✅ DHCP toggle — disable DHCP pool per network for fully static setups — shipped in v1.11

**Phase 2 — mid-term (Q3–Q4 2026):**
- ✅ **Ping / reachability** — live green/red status dots on every IP, auto-poll every 60 s, manual refresh button — shipped in v1.12
- ✅ **Help & Reference modal** — full in-app reference guide with 11 sections — shipped in v1.13
- ✅ **DNS reverse lookup** — PTR lookup for all tracked IPs, mismatch detection, configurable DNS server — shipped in v1.14
- ✅ **Proxmox scheduled sync** — background sync with HA failover detection, configurable interval, change history — shipped in v1.15
- ✅ **Multiple IPs per host** — link secondary IPs to a primary entry; chips on cards and table rows; Proxmox auto-groups multi-NIC VMs — shipped in v1.16
- **Service health checks** — HTTP/HTTPS probes with UP/DOWN badges alongside ping
- **ARP scan — background** — periodic scheduled sweeps that update a "last seen" timestamp and surface newly appeared or disappeared devices automatically

**Phase 3 — longer-term (2027+):**
- **Proxmox live status** — real-time VM/LXC power state badges using the Proxmox API
- **Wake-on-LAN** — send a WoL magic packet to any device with a known MAC address directly from the UI
- **ARP scan — scheduled background** — rate-limited, subnet-scoped background scans with "last seen" timestamps
- Network topology map, uptime alerts, REST API
- **Multi-user auth** — per-user accounts with role-based access (read-only vs admin)
- **iOS native app** — native iPhone/iPad app for at-a-glance network status and quick IP lookups on the go

---

## Network Configuration

No code editing required. Click the **⚙️ Settings** icon in the app header to configure:

| Setting | Description |
|---|---|
| Network name | Display name shown in the header and network tabs |
| Subnet | Your network prefix — paste the full address (`192.168.0.0`) or just the prefix (`192.168.1` for /24, `192.168` for /16). Trailing zeros are stripped automatically. |
| DHCP enabled | Toggle the DHCP pool on or off. Disable for networks where everything is statically assigned. |
| DHCP range | Start and end of the DHCP pool (single octets for /24, e.g. `1`/`170`; two octets for /16, e.g. `2.20`/`2.250`). Hidden when DHCP is disabled. |
| DHCP Reservations | Host portions of IPs with DHCP reservations — can be anywhere on the network, not just within the DHCP pool. Hidden when DHCP is disabled. |
| Static range | Start and end of your static assignments |
| Locations | Add, rename, or remove physical location labels for the active network |
| Display | Toggle whether free IP cards appear in the main list (turn off for large /16 networks) |
| Backup & Restore | Download a full `.json` backup or restore from a previous backup |
| Account | Change the login username and password without touching the server |
| Delete Network | Removes the active network and all its IP entries (shown only when multiple networks exist) |

Settings are saved automatically and persist across sessions.

---

## Proxmox Integration

The purple **Proxmox** button in the app header lets you discover all VMs and LXC containers from a Proxmox host and import them in one click. It requires a Proxmox API token — here's how to set one up.

### Step 1 — Create the API token

1. Open your Proxmox web UI and go to **Datacenter → Permissions → API Tokens**
2. Click **Add**
3. Set **User** to `root@pam` (or any Proxmox user with read access)
4. Set **Token ID** to something memorable, e.g. `ipmanager`
5. Leave **Privilege Separation** _unchecked_ — this lets the token inherit the user's full permissions without needing extra role assignments
6. Click **Add** — **copy the token secret immediately**; it will not be shown again

> **If you left Privilege Separation checked** you need to assign a role manually: go to **Datacenter → Permissions → Add → API Token Permission**, set Path to `/`, select your token, and set Role to **PVEAuditor**.

### Step 2 — Note the token format

The token string follows this pattern:

```
USER@REALM!TOKENID=SECRET-UUID
```

Example:

```
root@pam!ipmanager=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Paste this full string into the **API Token** field in the import modal.

### Step 3 — Run the import

1. Click the purple **Proxmox** button in the app header
2. Enter your Proxmox host IP or hostname (port defaults to 8006)
3. Paste the API token
4. Leave **Ignore TLS certificate errors** checked if you're using a self-signed cert (the default for most home lab setups)
5. Click **Discover VMs & LXCs** — the app queries the Proxmox API and lists all containers and VMs with IP addresses
6. Review the results, select the entries you want, choose **Merge** or **Replace**, and click **Import**

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "401 Unauthorized" | Wrong token string or token was deleted | Re-create the token and copy the full `USER@REALM!TOKENID=SECRET` string |
| VM has no IP in results | QEMU guest agent not running inside the VM | Install and enable `qemu-guest-agent` inside the VM, then restart it |
| LXC has no IP | Container is stopped | Start the container — stopped LXCs don't report network interfaces |
| "certificate verify failed" | Self-signed TLS cert on Proxmox | Enable **Ignore TLS certificate errors** in the modal |
| Connection refused | Wrong host/port or firewall | Verify the IP and that port 8006 is reachable from the IP manager's LXC |

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
