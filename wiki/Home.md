# IP Manager

A clean, fast web app for managing your home network's IP addresses — built to replace the spreadsheet you've been using for years.

Deploy it as a lightweight LXC container on Proxmox and get a live dashboard showing every device on your network, their status, services, and more.

---

## Quick links

| | |
|---|---|
| 🚀 [Installation](Installation) | Deploy to an LXC in under 5 minutes |
| 🔑 [First Login & Security](First-Login) | Set up your credentials |
| ⚙️ [Network Configuration](Network-Configuration) | Tell the app about your subnet |
| 📥 [Importing Devices](Importing-Devices) | ARP scan, Proxmox import, CSV/Excel |
| 💙 [Service Health Checks](Service-Health-Checks) | HTTP/HTTPS probes per device |
| 🌐 [Domain Tracker](Domain-Tracker) | Track domain expiry via RDAP |
| 💾 [Backup & Restore](Backup-and-Restore) | Export and restore your data |
| 🔄 [Updating](Updating) | Keep the app up to date |
| 🛠 [Troubleshooting](Troubleshooting) | Common issues and fixes |

---

## What it does

- **Live ping monitoring** — every IP gets a green/red status dot, refreshed every 60 seconds via fping
- **Service health checks** — optional HTTP/HTTPS probe per entry; sky-blue = up, orange = down
- **ARP scan & discovery** — one-click sweep finds everything on your subnet
- **Proxmox integration** — import VMs and LXC containers directly from the API, with scheduled background sync
- **DNS reverse lookup** — PTR records resolved against your own DNS server (Pi-hole, Unbound, etc.)
- **Domain Tracker** — track domain expiry via IANA RDAP, no API keys needed, 1,400+ TLDs supported
- **Multi-network / VLAN** — manage multiple subnets independently, switch between them instantly
- **500+ service icons** — automatic logos for Home Assistant, Proxmox, Sonarr, Pi-hole, and many more
- **Import & export** — CSV/Excel import with column mapping; export to formatted .xlsx
- **Backup & restore** — single JSON file captures everything; restore on any machine in one click
- **QR codes** — generate a QR code for any IP entry
- **CIDR & subnet calculators** — built-in network calculators in the Tools menu
- **Secure by default** — unique random password generated on first install; lockout enforced if defaults are detected

---

## Requirements

- **Proxmox LXC** (Ubuntu 24.04 recommended) — or any Linux host running Node.js 18+
- **512 MB RAM** minimum for the container
- **1 CPU core**
- Outbound internet access (for RDAP lookups, icon fetching, and updates)

---

## License

PolyForm Noncommercial — free for personal and home lab use. Source available on [GitHub](https://github.com/xy-io/ip-manager).
