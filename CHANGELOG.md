# Changelog

All notable changes to IP Address Manager are documented here, newest first.

The current version's release notes are always shown in [README.md](./README.md).

---

## v1.22

**ARP & Presence** — Two new opt-in features in a dedicated **Settings → ARP & Presence** tab, both disabled by default.

**Last Seen Timestamps** piggybacks on the existing 60-second ping cycle — zero extra network traffic. When enabled, the server records the last time each IP responded to a ping and displays a small clock icon with a relative timestamp (e.g. *3m ago*, *2h ago*) inline with the IP address on cards and in the table. Timestamps older than 25 hours turn amber as a visual stale indicator. Data persists across restarts and can be cleared from settings.

**Background Discovery Scan** schedules a periodic ARP sweep scoped to each network's static range, surfacing devices that aren't yet tracked in the manager. Subnet-aware defaults apply automatically: /24 networks scan every 15 minutes at 1000 Kbps; /16 or larger networks default to hourly at 200 Kbps to avoid flooding large subnets. Both the interval and bandwidth cap are user-configurable. A **Scan Now** button allows an immediate manual sweep. Untracked devices found within the static range are listed in the settings tab with IP, MAC, and vendor; they can be imported via the existing ARP Scan toolbar button. The scan requires `arp-scan` with raw socket capability (installed automatically by the update script).

---

## v1.21

**In-browser updates** — A new **Updates** section in **Settings** lets you check for new versions and apply them directly from the browser without touching the LXC. When a newer version is available on GitHub, an amber badge appears on the Settings gear icon and on the Updates tab. Clicking **Update now** runs the same update script used by the terminal command, streams live progress to a step-by-step progress bar, and restarts the service automatically. If any step fails (git pull, npm install, build, or server packages), the app automatically rolls back to the last working version, restarts, and shows a full error log you can use to investigate. The manual terminal command (`ip-manager-update`) continues to work exactly as before — in-browser updates use the same underlying script. The **Settings → Updates** tab also shows the full release log (parsed from the changelog) so you can read what changed in every version without leaving the app. GitHub releases are now published automatically via a GitHub Actions workflow on every push to `main` that bumps the version in `package.json`.

---

## v1.20

**Proxmox metadata — dedicated fields** — The VMID, node, and kind that were previously embedded in the user-editable Notes field (`VMID: 139 | Node: proxmox2 | Status: running`) are now stored as dedicated `proxmoxVmid`, `proxmoxNode`, and `proxmoxKind` fields. A one-time startup migration runs automatically — no action required. The Notes field is now entirely user-owned; editing it can no longer break Proxmox sync or VM status polling. A read-only **Proxmox** panel (VMID · Node · Kind) appears in the Edit modal for Proxmox entries, clearly labelled as managed automatically. The VM status badge now gates on `proxmoxVmid` being set. Proxmox sync updates `proxmoxNode` directly on HA failover rather than rewriting notes.

Also in this release: **version number** now visible in both the Settings and Help & Reference modals — in the header subtitle and pinned at the bottom of each sidebar.

---

## v1.19

**Proxmox VM live status** — Every entry tagged `proxmox` now shows a small power-state badge alongside its type badge (LXC / Virtual), both on cards and in the table Type column. Badges: **▶ running** (emerald), **■ stopped** (slate), **⏸ paused** (amber). Hovering the badge shows the VMID and node name. The server polls Proxmox every 60 seconds using the existing API credentials stored for scheduled sync — no extra configuration required. Status is fetched via a targeted lightweight API call per entry using the VMID and node parsed from the notes field written by the importer (`VMID: X | Node: Y`); no full node scan is needed. Results are cached for 30 seconds. Entirely read-only: no commands are ever sent to Proxmox. A new **Proxmox VM Status** section has been added to the in-app Help & Reference guide.

---

## v1.18

**Service health checks** — Opt-in HTTP/HTTPS probe per entry. Open the Edit modal for any assigned IP and scroll to the new **Service Health Check** section. Set the scheme (http/https), port, and path; a sky-blue **Auto** button pre-fills sensible defaults for 60+ known applications (Home Assistant, Proxmox, Sonarr, Grafana, Pi-hole, Gitea, and many more). The server runs a lightweight GET request against every configured endpoint every 60 seconds using Node's built-in `http`/`https` modules — no extra packages required. TLS certificate errors are always ignored (self-signed certs are the norm in home-lab setups). Results appear as a second coloured dot alongside the ping dot: **sky blue** = service up (HTTP < 500), **orange** = service down (timeout, connection refused, or HTTP 5×). Hovering the dot shows the probe URL and last status code. Clearing the port field disables the check for that entry.

---

## v1.17

**selfh.st service icons** — IP cards and the table view now attempt to display the real logo for the service running on each host, pulled from the [selfh.st/icons](https://selfh.st/icons) library (1,000+ self-hosted app icons served via jsDelivr CDN). A curated map of 100+ common services (Home Assistant, Proxmox, Sonarr, Pi-hole, Vaultwarden, Nextcloud, Gitea, Immich, and many more) maps service names to CDN slugs. Multi-word phrases are matched before shorter keywords so "Nginx Proxy Manager" resolves to the correct icon rather than the generic Nginx one. Dark mode automatically requests the `-light` variant of each icon. Two-level fallback: if the light variant is missing the coloured icon is tried; if neither exists the existing Lucide icon is shown. Icon matching is scoped to the service name field only — a hostname that happens to contain a keyword can no longer hijack the icon for an unrelated service.

**IP sort order** — The cards view now always renders entries in numerical IP order (e.g. .1, .2, .10 … .254) regardless of when they were added or imported. Previously, claiming a free IP placed its card at the end of the list. Both cards and table views now use the same sorted pipeline.

**Mobile responsive toolbar** — On screens narrower than 768 px the full toolbar collapses to three compact items: status badge, Cards / Table toggle, and a **Tools ▾** dropdown button. Tapping Tools expands an inline panel with all action buttons (Proxmox, ARP Scan, Ping, DNS, Import, Export, Add Network, Dark mode, Help, Settings, Sign out). Tapping any button in the panel auto-closes it.

**Mobile header improvements** — Title font scales down to stay on one line; the Network Overview box (DHCP / Static / Reservations info) is hidden on mobile to save vertical space; tag filter chips scroll horizontally in a single row rather than wrapping across multiple lines.

**Sync result logs** — Both **Settings → Proxmox Scheduled Sync** and **Settings → DNS Reverse Lookup** now have a Run Now / Sync Now button with a result panel below it. The Proxmox panel shows: a spinner while running, a green "no drift" state, a red error block on failure, or an amber per-entry diff list (IP, name, and field-level from → to for node, asset name, and notes). The DNS panel shows: a spinner while resolving, a summary header (N resolved · M unresolved), a scrollable list of resolved PTR records, and a separate section for IPs with no PTR record.

---

## v1.16

**Multiple IPs per host (host grouping)** — A server or VM with multiple network interfaces can now have all its IPs linked together. Open the Edit modal for the primary IP, scroll to the new **Secondary IPs** section, and pick any other entry from the dropdown to link it. The primary card shows secondary IP addresses as small blue chips; secondary cards show a "↳ Primary name" label. The same display appears in table view. Unlinking removes the association instantly. The data model uses a lightweight `hostId` field — existing data is unaffected. Proxmox import automatically groups entries when a single VM or LXC reports multiple IP addresses (multi-NIC or multi-VLAN setups).

---

## v1.15

**Proxmox scheduled sync** — Background sync that re-queries Proxmox on a configurable schedule (default hourly, minimum 15 min) and updates any entries tagged `proxmox` that have drifted — primarily for HA failover where a VM/LXC migrates to a different node. Changes recorded in each entry's change history. Configured in **Settings → Proxmox Scheduled Sync** with a Sync Now button for manual runs.

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
