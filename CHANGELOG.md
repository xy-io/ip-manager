# Changelog

All notable changes to IP Address Manager are documented here, newest first.

The current version's release notes are always shown in [README.md](./README.md).

---

## v1.29.1

**Fix: upgrade path for existing installs + username case sensitivity**

Three issues found during testing of v1.29.0:

- **Upgrade bug** — existing installs that had an empty `credentials.env` (created by older versions of `install.sh` via `touch`) were having a random password generated on first server restart, locking out users who expected to log in with `admin/admin`. Fixed: if `credentials.env` exists but contains no credentials, the server now falls back to `admin/admin` (triggering the password-change lockout screen) rather than generating a new random password. Random generation now only happens when the file doesn't exist at all (genuine first-run).
- **Username case sensitivity** — usernames are now compared case-insensitively at login (passwords remain case-sensitive). `Admin`, `ADMIN`, and `admin` all match the same account.
- **"First time?" login hint** — the recovery hint on the login screen is now hidden after the user has successfully set a new password, so it doesn't appear on every subsequent login.

---

## v1.29.0

**Security: eliminate default-credential window**

Fresh installs no longer ship with a known password. On first start the server generates a unique random password (96-bit, URL-safe), saves it to `credentials.env`, and logs it to the service journal. The installer echoes these credentials at the end of its output — one copy-paste and you're in.

**Two layers of protection:**

- **No shared default** — every install gets its own generated password. There is no `admin/admin` to guess.
- **Lockout safety net** — if credentials ever match the literal `admin/admin` (old installs, manual edits), the API refuses every route except login and change-password until the password is updated. The app shows a non-dismissible "Set Your Password" screen on login.

**For existing installs with a custom password** — nothing changes. The upgrade deploys silently and the app behaves identically.

**For existing installs still on `admin/admin`** — after upgrading you can still log in, but you'll be required to set a new password before accessing the app. No data is lost.

**Credential recovery** — if you lose the initial password:
```
journalctl -u ip-manager-api | grep -A5 "initial credentials"
```

**Other changes in this release:**
- `server/credentials.env` removed from git tracking and added to `.gitignore`
- Minimum password length raised from 4 to 8 characters

---

## v1.28.0

**DNS resolver per network · Custom icon picker**

### DNS resolver per network

Each network now has its own DNS resolver configuration (Settings → DNS). Previously a single global DNS server was used for all reverse-lookup scans; now you can point each subnet at a different resolver — handy for multi-site or multi-VLAN setups where PTR records live on different nameservers.

Existing installs are migrated automatically: the previous single-server config is preserved and mapped to your first network (`net-1`). No data is lost.

### Custom icon picker

Service icons can now be overridden per entry. When editing an entry the icon preview appears below the Service/Apps field. Clicking **"Pick icon manually"** opens a search panel backed by the [selfh.st](https://selfh.st) icon library — type a keyword, pick from the grid, and the icon is saved with the entry. Auto-detected icons still work as before when no manual override is set; click **"Reset to auto"** to revert.

---

## v1.27.5

**Fix: GUI updates on LXC — remove sudo dependency**

The API service now runs as `root` inside the LXC container. Previously it ran as `www-data` and relied on a sudoers entry to escalate privileges for in-browser updates. In LXC containers the container root is already isolated, so user separation within the container adds complexity without security benefit.

**For existing installs** — run one CLI update (`sudo bash /opt/ip-manager/scripts/update.sh`) and the update script will automatically patch the systemd service to `User=root`, reload the daemon, and remove the legacy sudoers entry. GUI updates will work immediately after.

**For fresh installs** — `install.sh` now creates the service as `User=root` from the start and skips the sudoers setup entirely.

---

## v1.27.4

**Support bundle**

New **Settings → Support** tab with a one-click "Generate & Download Support Bundle" button. Clicking it downloads a plain-text diagnostic file containing app version, OS/kernel info, Node.js & npm versions, rclone version, disk & memory usage, systemd service status, the last update result, and the most recent 300 lines of service logs.

No IP addresses, hostnames, notes, credentials, or personal data are included — only system and runtime diagnostics. The Support tab also lists the three manual terminal commands for users who prefer to collect logs that way.

---

## v1.27.3

**Reassign IP address without losing history**

The IP address on any assigned entry is now editable directly in the Edit modal. Previously the only way to move an entry to a different IP was to release it (losing all history, notes, tags, and dependencies) and re-claim the new IP from scratch.

**How it works** — change the IP field and save. The entry — including its full history, notes, tags, health config, dependencies, and host-group links — moves to the new IP. A history record is added noting the old and new address. The old IP is automatically returned to the free pool.

**Conflict handling** — if the target IP is already assigned to another device, a warning banner appears before save naming the conflicting entry. The user can proceed (which overwrites the conflicting entry and frees the old IP) or cancel.

**Dependency chain** — any other entries that listed the old IP as a dependency are automatically updated to point to the new IP.

---

## v1.27.2

**Consolidate Additional IPs — rename Secondary IPs**

The separate lightweight "Additional IPs" field introduced in v1.27.1 has been removed in favour of a single, unified concept. The existing host-linking feature (previously called "Secondary IPs") is renamed to **Additional IPs** throughout the UI and help text.

Each linked IP is a fully tracked entry — pinged independently, searchable, shown on its own card, with its own history. The link can span any network (multi-NIC, multi-VLAN, multi-subnet). The rename makes the intent clearer without changing any underlying behaviour or data.

---

## v1.27.1

**Additional IPs**

Lightweight opt-in field to associate extra IP addresses with an entry — useful for multi-NIC devices without creating separate tracked entries.

**Edit modal** — new "Additional IPs" section after the Hostname field (collapsed by default; click "+ Add additional IPs" to expand). Enter any valid IPv4 address and add it as a chip. Chips are removable. The primary IP is excluded. These IPs are stored on the entry but are not individually pinged.

**Search** — additional IPs are included in the search index, so searching for any of them surfaces the parent entry.

**Card view** — additional IP chips appear below the primary IP in a muted `bg-slate-100` style to distinguish them from the primary.

**Table view** — additional IP chips appear below the MAC/DNS row in the IP column, consistent with the card view styling.

---

## v1.27.0

**Dependency mapping**

Link any entry to the devices it relies on — when a dependency goes offline, a red "dep offline" badge appears immediately on the card.

**Edit modal** — new Dependencies field with a searchable picker (search by IP, name, or hostname). Selected dependencies are shown as removable amber chips. An entry cannot depend on itself.

**Card badge** — a red ⚠ "dep offline" badge appears in the badge row whenever one or more dependencies are confirmed down (ping failure or health check failure). The tooltip names the offline devices. The badge disappears automatically when all dependencies are back online.

**Expanded card** — the dependency list shows each linked entry with its IP, name, and a live status dot (green = up, red = down, grey = not yet pinged).

**Status logic** — ping failure or health check failure both trigger the warning. Entries that haven't been pinged yet do not trigger a false warning.

---

## v1.26.0

**Scheduled cloud backup**

Automatic backups of all IP entries, network configs, tags, notes, and change history to any cloud storage provider — configured entirely from the browser via Settings → Backup.

**Provider support** — GUI configuration (no terminal) for S3-compatible storage (Backblaze B2, Cloudflare R2, AWS S3, Wasabi, MinIO), SFTP, and local/network paths. Dropbox and Google Drive are also supported via a one-time token paste (run `rclone authorize` on any machine with a browser, paste the token into the UI).

**Scheduling** — daily or weekly at a chosen time, or manual-only. Next run is calculated in-process (no system cron required).

**Retention** — configurable keep-last-N policy; older backups are pruned automatically after each successful run.

**Remote management** — add multiple named remotes, select the active one, test connection before enabling. Each backup is a dated JSON file (`ip-manager-backup-YYYY-MM-DD_HH-MM-SS.json`) — the same format as the manual download, so it can be restored via the existing Restore button.

**Powered by rclone** — MIT-licensed, no attribution required. Installed automatically on new LXC deployments and silently added on first update for existing users.

---

## v1.25.1

**Mobile header fixes**

- App name now visible on mobile — shows "IP Manager" on narrow screens instead of being hidden
- Mobile Tools panel redesigned to match the desktop dropdown: two-section card layout (Network + Utilities + App) with icon squares and description lines, replacing the old coloured button grid

---

## v1.25.0

**Redesigned header — two-zone layout and app logo**

The toolbar has been completely restructured to reduce visual clutter and establish a clear hierarchy between identity and actions.

**Two-zone header** — The header is now split into a left zone (identity) and a right zone (actions). Left zone: the new app logo + wordmark, followed by the active network name. When multiple networks exist, the network name becomes a dropdown pill for switching — replacing the old tab row. A ghosted Add network button sits next to it, subdued so it doesn't compete with primary actions. Right zone: Import, Export, a unified Tools dropdown, and three icon buttons (dark mode, settings, sign out). The SQLite/Local status badge and subnet CIDR move to a quiet sub-bar beneath the main row, alongside the Cards/Table view toggle.

**Subnet Grid logo** — A 4×4 grid of rounded squares in the app's emerald and slate colours, echoing the Subnet Visualiser heat-map. The top row is slate (outside range), the middle rows are emerald (assigned IPs), and the bottom-right cells fade to lighter emerald (free). Renders at any size from 16px (favicon-scale) to 64px. Dark background matches the app's header aesthetic at all sizes.

**Consolidated Tools dropdown** — The standalone Proxmox, ARP Scan, Ping, and DNS buttons have moved off the main toolbar into the Tools menu, which now has two sections: Network (Proxmox, ARP Scan, Ping All, DNS Lookup) and Utilities (CIDR Calculator, Subnet Visualiser). Each item shows a description line and a coloured icon. The result is a main toolbar that goes from 15 items to 7.

---

## v1.24.2

**Subnet Visualiser grid layout fix** — Row labels and cells are now placed inside a single CSS grid (17 columns: label + 16 cells), so each label is anchored to its row and shares the exact same height as its cells. Previously the labels were in a separate flex column with height: 100%, which caused them to expand independently of the cells — resulting in large blank scroll areas between labels.

---

## v1.24.1

**Subnet Visualiser improvements** — polish pass on the heat-map grid.

Row labels (.0, .16, .32 … .240) now appear on the left edge of the grid so you can read off any address without counting cells. A usage summary bar above the grid shows total assigned, DHCP pool, and free static counts as coloured chips. A dashed boundary line separates the DHCP pool from the static range when both are enabled — making the split between managed and manually assigned space immediately visible. Planned block cells now show the IP count for that block in small text, so you can see at a glance how many addresses a planned reservation will consume. The Add Block form submits on Enter.

---

## v1.24

**MAC addresses, quick-launch, and Subnet Visualiser** — Three new quality-of-life additions.

**MAC Address field** — Every IP entry now has an optional MAC address field (in the edit modal, below Hostname). When you tab out of the field the server looks up the OUI prefix in the bundled IEEE database (no internet required) and shows the vendor name inline — e.g. *Raspberry Pi Trading Ltd*. The MAC and vendor are stored with the entry and displayed in small monospace text below the IP on expanded cards and in the table's IP column.

**Quick-launch buttons** — Expanded cards now show link buttons that open in a new tab: an **HTTP/HTTPS** button (appears when a Service Health Check port is configured — reuses the scheme, port, and path you already set), and an **SSH** button (appears when a hostname is set — opens an ssh://hostname URL handed off to your OS's SSH client).

**Subnet Visualiser** — A new modal in the **Tools** dropdown shows the full /24 address space as a 16×16 heat-map grid (256 cells, one per last octet). Cell colours reflect whether each address is assigned, free static, in the DHCP pool, reserved, or outside range. Below the grid, a **Planned Blocks** section lets you overlay named colour regions (e.g. IoT devices .200–.220) to mark intent. Blocks are stored server-side per network and persist across sessions.

Help & Reference updated with new **MAC Address**, **Quick Launch**, and **Subnet Visualiser** sections.

---

## v1.23

**Tools dropdown + CIDR Calculator + QR Codes** — A new **Tools** dropdown in the toolbar (wrench icon) provides a scalable home for utility tools without cluttering the main action bar.

**CIDR Calculator** is the first tool in the dropdown. Type any CIDR notation (e.g. 192.168.1.0/24) and instantly see: network and broadcast addresses, first/last usable host, subnet mask, wildcard mask, total and usable host counts, the next network of the same size, IP class, and the full binary representation of the address. Entirely client-side — no server call.

**QR Codes** — Every tracked device now has a QR button (violet, in the expanded card action row and the table Actions column). The modal lets you toggle between two content modes: **Service URL** (encodes the device's URL field, e.g. http://192.168.1.10:8080) and **IP Address** (encodes the bare IP). Download the code as a PNG or copy the text to the clipboard. Generated entirely in the browser — no data leaves your network.

Help & Reference updated with new **CIDR Calculator** and **QR Codes** sections.

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
