# 🌐 IP Address Manager

A clean, fast web app for managing your home network's static IP addresses — built to replace the Excel spreadsheet you've been using for years.

![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react)
![Vite](https://img.shields.io/badge/Vite-4-646CFF?style=flat-square&logo=vite)
![Tailwind](https://img.shields.io/badge/Tailwind-3-38BDF8?style=flat-square&logo=tailwindcss)
![Nginx](https://img.shields.io/badge/Nginx-ready-009639?style=flat-square&logo=nginx)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)

---

## What It Does

Managing a home lab network across servers, VMs, containers, cameras, switches, and IoT devices gets complicated fast. This tool gives you a single place to:

- **Look up any IP address** instantly by name, hostname, service, or location
- **See what's running** on each address — service, container type, host/hypervisor, physical location
- **Track free IPs** in your static range with one-click claiming for new servers or containers
- **Edit any entry** — change the asset name, hostname, type, location, or service via a clean modal form
- **Release IPs** back to the free pool when you decommission something
- **Export to Excel** — downloads a fully formatted `.xlsx` with all your changes, preserving the original spreadsheet structure
- **Switch views** between Cards (visual) and Table (dense) layouts
- **Configure your network** — set your subnet, DHCP range, static range, and fixed reservations via the built-in Settings panel — no code editing required

### Network-Aware

The app understands your network layout and is fully configurable via the ⚙️ Settings panel:

| Range | Type |
|---|---|
| `.1` – `.100` | DHCP pool (managed by your router / DHCP server) |
| `.5`, `.10` | Fixed reservations within the DHCP range |
| `.101` – `.254` | Static assignments |
| Green entries | Free — available to claim |

All ranges are configurable — works with any subnet (192.168.x, 10.x.x, 172.16.x, etc.).

---

## Screenshots

> Cards view showing assigned and free IPs, with the Edit modal open.

![IP Address Manager Preview](./preview.png)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Tailwind CSS 3, Lucide Icons |
| Build tool | Vite 4 |
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
4. Give it a static IP in your static range (`.171`–`.254`)
5. Start the container

#### Step 2 — SSH into the container

```bash
ssh root@192.168.0.XXX
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

When it finishes, you'll see:

```
============================================
   Installation Complete!
============================================

  App URL:     http://192.168.0.XXX
  App files:   /opt/ip-manager
  Nginx log:   /var/log/nginx/ip-manager.access.log

  To update the app later, run:
    ip-manager-update
```

Open the URL in your browser and you're done.

---

## Data Persistence

The app supports two persistence modes and switches between them automatically:

| Mode | When | What it means |
|---|---|---|
| 🟢 **SQLite** | LXC/Nginx deployment | Data stored in `server/ip-manager.db` on the server — shared across all users and browsers |
| ⚪ **Local** | Local dev (`npm run dev`) | Data stored in your browser's localStorage — private to that browser |

On startup the app sends a quick health check to `/api/health`. If the API responds, it loads data from SQLite and shows the green **SQLite** badge in the header. If not (e.g. running locally without the server), it falls back to localStorage automatically and shows the **Local** badge.

All saves happen automatically in both modes — there's nothing to click. The **Download Excel** button is still available any time you want a portable backup.

**Resetting data (Local mode only):** open DevTools (`F12`) → Application → Local Storage → delete `ip-manager-ip-data`.

---

## Updating

When new code changes are pushed to GitHub, here's how to get them — your stored IP data is untouched by code updates.

### LXC / Nginx deployment

SSH into the container and run:

```bash
ip-manager-update
```

This pulls the latest code, rebuilds the app, restarts the API service, and reloads Nginx — all in one command. Your SQLite database is untouched.

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
- **Tag support** — custom tags per entry (e.g. `media`, `IoT`, `cameras`) with filter support
- **Sort controls** — click column headers to sort in Table view
- **Last modified date** — timestamp each entry to spot stale records

**Phase 2 — mid-term (Q3–Q4 2026):**
- **Multiple IPs per host** — support servers/VMs with more than one NIC or lease (prerequisite for VLAN support)
- **VLAN & multi-network** — tag IPs with one or more VLANs; manage multiple subnets side-by-side
- **Ping / reachability** — live status indicators per IP
- **Proxmox integration** — auto-discover VMs and LXCs
- **Service health checks** — HTTP probes with UP/DOWN badges

**Phase 3 — longer-term (2027+):**
- Network topology map, uptime alerts, REST API, network scanner, multi-user auth

---

## Network Configuration

No code editing required. Click the **⚙️ Settings** icon in the app header to configure:

| Setting | Description |
|---|---|
| Network name | Display name shown in the header |
| Subnet | Your network prefix (e.g. `192.168.1`, `10.0.0`) |
| DHCP range | Start and end of the DHCP pool |
| Static range | Start and end of your static assignments |
| Fixed in DHCP | Comma-separated last octets of fixed reservations |

Settings are saved to localStorage and persist across sessions.

---

## Importing Your IP Data

Click the **Import** button in the app header to load your own data from a `.csv`, `.xlsx`, or `.xls` file. The import flow is three steps:

**Step 1 — Upload**
Drag and drop a file onto the upload zone, or click to browse. A downloadable CSV template with the correct headers is available here if you're starting from scratch.

**Step 2 — Map Columns**
The importer auto-detects common column name variations (e.g. `hostname`, `host name`, `fqdn` all map to Hostname automatically). If your headers aren't recognised, use the dropdowns to match each field manually. A preview of the first five rows is shown so you can verify the mapping looks right before continuing.

**Step 3 — Confirm & Import**
A summary shows how many rows are ready to import and how many were skipped (with reasons — missing required fields, invalid IP format, etc.). Choose your import mode before confirming:

| Mode | Behaviour |
|---|---|
| **Merge** | Adds new entries; updates existing ones matched by IP address. Existing entries not in the file are left untouched. |
| **Replace** | Replaces all current data with the imported rows. Use with caution. |

**Supported columns**

| Column | Required | Notes |
|---|---|---|
| `ip` | ✅ | Full IPv4 (`192.168.0.10`) or last-octet shorthand (`10` → expanded to your subnet automatically) |
| `hostname` | ✅ | FQDN or short name |
| `type` | ✅ | e.g. `LXC`, `VM`, `Physical`, `IoT` |
| `service` | ✅ | App or service running on the host |
| `name` | — | Display / asset name (falls back to hostname prefix if omitted) |
| `location` | — | Physical location or rack |
| `host` | — | Hypervisor or host machine (accepts `proxmox_host`, `hypervisor`, `vm host`, etc.) |
| `notes` | — | Free-text notes |
| `status` | — | `assigned` or `free` (defaults to `assigned`) |

---

## License

© 2026 Jay Allen — free for personal and non-commercial use under the [PolyForm Noncommercial License 1.0.0](./LICENSE). Commercial use is not permitted without explicit permission.
