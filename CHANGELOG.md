# Changelog

All notable changes to IP Address Manager are documented here, newest first.

The current version's release notes are always shown in [README.md](./README.md).

---

## v1.14

**DNS reverse lookup** — Click the violet **DNS** button in the header (API mode only) to run a reverse PTR lookup for every tracked IP address. Results are compared against the hostname stored in each entry: if they match, nothing extra is shown; if the entry has no stored hostname, the PTR record is displayed in grey as a useful fill-in; if the PTR differs from the stored hostname, it is shown in amber with a ⚠ prefix — useful for catching stale DNS records. The lookup runs automatically every 24 hours in the background. Configure a specific DNS server in **Settings → DNS Reverse Lookup**, or leave blank to use the system resolver. Uses Node's built-in `dns` module — no additional packages required.

**Logout button** — The header sign-out button now shows a **Sign out** label alongside the LogOut icon, replacing the ambiguous ✕.

**Help & Reference improvements** — Added Backup & Restore and DNS Lookup sections to the Help modal.

---

## v1.13

**Help & Reference modal** — Click the **?** icon in the header to open a full reference guide covering: Overview & header bar, Status Indicators (ping dots, type badges), Managing IPs, Networks & Settings, Proxmox Import, ARP Scan, Ping / Reachability, Backup & Restore, Import & Export, DNS Lookup, and Keyboard Shortcuts. Navigation sidebar on the left; scrollable content panel on the right. Closes with Esc.

---

## v1.12

**Ping / reachability badges** — Every assigned IP card and table row now shows a coloured status dot inline with the IP address: 🟢 green = online, 🔴 red = offline, grey = status not yet known. The server runs `fping` against all tracked IPs, caches results for 20 seconds, and refreshes the cache automatically every 60 seconds in the background — no user action required. A sky-blue **Ping** button in the header forces an immediate refresh and shows a spinner while in-flight; hovering it shows the last-checked timestamp. If `fping` is missing or lacks the required `CAP_NET_RAW` capability, an amber warning banner explains exactly what to run to fix it. `fping` is now installed and granted raw-socket capability automatically by the install and update scripts.

---

## v1.11

**ARP network scan** — Click the teal **ARP Scan** button in the header (API mode only) to sweep your subnet for active devices. The server runs `arp-scan`, returns each device's IP, MAC address, vendor, and hostname (where resolvable via reverse DNS), then cross-references against your existing entries. Results are shown in a table with status badges — **✓ Tracked** (already in the manager), **◯ Untracked** (on your subnet but not yet recorded), or **⊘ Out of range**. Untracked devices are pre-selected for import with one click. The subnet is pre-filled from your network settings but can be edited. `arp-scan` is installed automatically by the install script; the server falls back to the kernel ARP cache if it isn't available.

**DHCP toggle** — Network Settings now has an Enabled/Disabled toggle on the DHCP Pool section. Turn DHCP off for networks where everything is statically assigned — the DHCP range fields collapse and all IPs are treated as static.

**Multi-network settings fixes** — Resolved a bug where changes to a second network's name, subnet, or ranges appeared to have no effect (a silent crash caused by numeric vs string type mismatch in the form).

**Credential change fix** — Resolved a bug where changing username/password in Settings → Account had no effect (an inner `<form>` nested inside the outer settings form was silently intercepted by the browser).

---

## v1.10

**Proxmox one-shot import** — Click the purple **Proxmox** button in the header to connect to your Proxmox host using an API token. The app discovers all VMs and LXC containers with IP addresses and presents them in a preview table. Choose Merge (safe, incremental) or Replace mode, select which entries to import, and click Import. Requires a Proxmox API token with the PVEAuditor role.

**Tag management in Settings** — Settings → Tags lets you see all tags across the active network, rename a tag (updates every entry that uses it), add pre-defined tags before assigning them to any entry, and delete a tag from all entries at once. The Edit modal now shows a dropdown of existing tags as you type so you can pick from the current set rather than retyping. Tags display in alphabetical order everywhere.

---

## v1.9

**Login / authentication** — The app is now protected by a username and password login screen. Default credentials are `admin` / `admin`. After signing in, go to **Settings → Account** to set your own username and password — no server access required. Credentials are stored in `server/credentials.env` on the LXC. Sessions persist for the lifetime of the browser tab; a sign-out button appears in the header.

---

## v1.8

**Multi-network / VLAN support** — Click **Add Network** (next to the ⚙️ Settings button) to add a second subnet — e.g. a dedicated IoT VLAN or a separate 172.16.x.x management segment. Network tabs appear at the top of the page; switching tabs instantly scopes all views, stats, free IPs, and search to that network. Each network has its own independent config. Delete a network (and all its entries) from Settings → Danger Zone when no longer needed.

**Full backup & restore** — Settings → Backup & Restore → **Download Full Backup** exports a single `.json` file containing every network config, every IP entry across all networks, all tags, notes, and full change history. **Restore from Backup** reads that file, shows you a preview (export date, network count, entry count), and requires explicit confirmation before replacing anything. Use it to migrate to a new server or as a safety snapshot before a major change.

**Hide free IP cards** — Settings → Display → toggle **Show free IP cards in main list**. Leave it on for normal use; turn it off if you manage a `/16` network where tens of thousands of green "Free" cards would slow the browser. The Free Static IPs panel in the header still works either way. Preference is stored per browser.

---

## v1.7

**Bulk selection & bulk edit** — Checkboxes on every card and table row let you select multiple IPs at once. Selecting items reveals a bulk action bar. The Bulk Edit modal lets you add tags (appended to existing), set type, or set location across all selected entries at once. A Release button returns selected IPs to the free pool.

**Change history / audit log** — Every save records a timestamped diff of what changed (field by field, old value → new value). Bulk edits are flagged with a "bulk" badge. History is visible in the expanded card view, newest first, capped at 20 entries per IP.

**Location management** — New Locations section in Settings lets you manage physical locations: rename a location across all entries, delete a location, or add new locations before any entry uses them.

**Free IPs in main list** — Free static IPs are computed from the static range minus assigned entries. They appear as searchable "Available" cards/rows in the main view. Clicking an Available IP claims it instantly.
