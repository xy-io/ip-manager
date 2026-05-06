# Installation

IP Manager runs as a Node.js + Nginx service, best deployed inside a **Proxmox LXC container**. The install script handles everything automatically.

---

## Prerequisites

- A Proxmox host (or any Ubuntu/Debian server)
- Ubuntu **24.04** LXC (recommended) — 22.04 also works
- **512 MB RAM** minimum, 1 GB recommended
- 1 CPU core
- Outbound internet access

---

## 1. Create the LXC container

In the Proxmox web UI:

1. Download the **Ubuntu 24.04** template if you don't have it (`local → CT Templates → Templates`)
2. Create a new container:
   - **Disk**: 4 GB+
   - **CPU**: 1 core
   - **Memory**: 512 MB (1024 MB recommended)
   - **Network**: bridged to your LAN, with a static IP
3. Start the container and open a console or SSH in as root

---

## 2. Run the install script

```bash
curl -fsSL https://raw.githubusercontent.com/xy-io/ip-manager/main/install.sh | bash
```

The script will:
- Install Node.js, npm, fping, arp-scan, and git
- Clone the repository to `/opt/ip-manager`
- Build the frontend
- Install and start the `ip-manager` systemd service
- Configure Nginx as a reverse proxy on **port 80**
- Generate a **unique random password** for first login
- Print your credentials at the end

> **Save the credentials printed at the end of the install.** They are also logged to the systemd journal and stored in `/opt/ip-manager/server/credentials.env`.

---

## 3. Log in

Open your browser and navigate to the container's IP address:

```
http://<container-ip>
```

Use the username and password printed at the end of the install script. You will be prompted to change the password on first login.

See [First Login & Security](First-Login) for next steps.

---

## 4. Configure your network

After logging in, open **Settings** (⚙️ icon) and enter your network details — subnet, DHCP range, and static range. See [Network Configuration](Network-Configuration).

---

## Retrieving your credentials

If you lose the install-time credentials, retrieve them from the systemd journal:

```bash
journalctl -u ip-manager --no-pager | grep -i password
```

Or read them directly:

```bash
cat /opt/ip-manager/server/credentials.env
```

---

## File locations

| Path | Purpose |
|---|---|
| `/opt/ip-manager/` | Application root |
| `/opt/ip-manager/server/credentials.env` | Username and password |
| `/opt/ip-manager/server/data.db` | SQLite database (all your data) |
| `/etc/nginx/sites-available/ip-manager` | Nginx config |
| `systemctl status ip-manager` | Service status |

---

## Running behind a subdomain or reverse proxy

If you want to access IP Manager via a hostname (e.g. `ipmanager.home.lab`) rather than a bare IP, point your existing reverse proxy or Pi-hole DNS entry at the container's IP on port 80. No additional configuration is needed inside IP Manager.

---

## Next steps

- [First Login & Security](First-Login)
- [Network Configuration](Network-Configuration)
- [Importing Devices](Importing-Devices)
