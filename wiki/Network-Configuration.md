# Network Configuration

Before IP Manager can manage your network, you need to tell it about your subnet layout. This is done through the **Settings** panel.

---

## Opening Settings

Click the **⚙️ Settings** icon in the top-right toolbar (desktop), or tap **Settings** in the mobile Tools menu.

---

## Network settings

| Field | Description | Example |
|---|---|---|
| **Network name** | A label for this network | `Home LAN`, `IoT VLAN` |
| **Network address** | Your subnet prefix — trailing zeros are stripped automatically | `192.168.1.0` → `192.168.1` |
| **Subnet mask** | `/24` or `/16` supported | `/24` |
| **DHCP start** | First IP in your DHCP pool | `192.168.1.100` |
| **DHCP end** | Last IP in your DHCP pool | `192.168.1.199` |
| **Static start** | First IP in your static assignment range | `192.168.1.2` |
| **Static end** | Last IP in your static assignment range | `192.168.1.99` |
| **DNS resolver** | IP of your local DNS server for PTR lookups | `192.168.1.53` |

The live preview below the fields shows the calculated CIDR and how many IPs are in each range before you save.

---

## IP ranges explained

| Range | Colour in app | Meaning |
|---|---|---|
| DHCP start → DHCP end | Blue | Managed by your router/DHCP server |
| DHCP Reservations list | Blue with pin | Fixed DHCP assignments (can be anywhere on the network) |
| Static start → Static end | Green (if free) | Available for manual static assignment |
| Assigned static IPs | Various | Claimed entries |

> Free IPs inside the static range appear as green "Available" cards — click one to claim it for a new device.

---

## DNS resolver

Each network has its own DNS resolver setting. This is used for **PTR (reverse DNS) lookups** — resolving an IP address to a hostname.

Set this to:
- Your **Pi-hole** IP if you use Pi-hole for DNS
- Your **Unbound** resolver IP for a local recursive resolver
- Your **router's IP** if it handles DNS
- Leave blank to skip reverse lookups for this network

Mismatches between the stored hostname and the PTR record are flagged with an amber warning on the card.

---

## Multiple networks and VLANs

IP Manager supports unlimited networks. Each network is fully independent — separate IP ranges, separate entries, separate DNS resolver.

**To add a network:**
1. Click the **+** button next to the network tabs at the top of the app
2. Give it a name and configure its subnet
3. Switch between networks using the tabs

Common use cases:
- Main LAN + IoT VLAN
- Home + home office networks
- Lab network + management VLAN

---

## /16 networks

Both `/24` (e.g. `192.168.1.x`) and `/16` (e.g. `172.16.x.x`) networks are supported. For `/16` networks, the app manages the full 65,534-address range and the IP table handles it efficiently.

---

## DHCP reservations

Reservations are fixed DHCP assignments — devices that always get the same IP from the router, identified by MAC address. They can live anywhere on the network, including outside the static range.

Add them under **Settings → DHCP Reservations** by entering the IP address. They appear in the app with a distinct styling so they're easy to identify.
