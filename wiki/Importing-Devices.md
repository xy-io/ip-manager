# Importing Devices

IP Manager has three ways to populate your IP table: **ARP scan**, **Proxmox import**, and **CSV/Excel import**. You can use any combination of all three.

---

## ARP Scan

ARP scan broadcasts a single ARP request per IP on your subnet and collects responses from every device that replies. It's fast, passive, and requires no credentials.

### Running a scan

1. Open the **Tools** menu → **ARP Scan**
2. Click **Start Scan**
3. The app sweeps your configured static range and shows every responding device
4. Devices not yet in your IP table are pre-selected for import
5. Review the list, adjust the selection, then click **Import Selected**

### What gets imported

- IP address
- Hostname (from reverse DNS if available)
- MAC address

You can edit any entry after import to add a device type, service, tags, notes, and icon.

### Requirements

- `arp-scan` must be installed on the server (the install script handles this)
- The IP Manager server must be on the same broadcast domain as the devices you want to discover

---

## Proxmox Import

Pull all VMs and LXC containers directly from your Proxmox cluster — including their IPs, node location, and power state.

### Setup

1. Open **Settings → Proxmox**
2. Enter:
   - **Proxmox host** — the IP or hostname of your Proxmox node or cluster VIP
   - **API token** — create one in Proxmox under `Datacenter → Permissions → API Tokens` (read-only access is sufficient)
3. Click **Test Connection** to verify

### Running an import

1. Open **Tools → Proxmox Import**
2. The app fetches all VMs and LXC containers across all nodes
3. Existing entries are matched by IP — duplicates are skipped
4. Select what you want to import and click **Import Selected**

### Background sync

Once Proxmox is configured, IP Manager can keep your records up to date automatically. Set a sync interval in **Settings → Proxmox → Sync interval**. The sync detects:
- New VMs and containers
- HA failovers (node changes)
- Power state changes

### Multi-NIC VMs

VMs with multiple network interfaces have all their IPs imported. The primary IP becomes the main card; secondary IPs are linked to it automatically.

---

## CSV / Excel Import

Already tracking IPs in a spreadsheet? Import it in three steps.

### Supported formats

- `.csv` — comma or semicolon delimited
- `.xlsx` / `.xls` — Excel workbooks (first sheet is used)

### Import steps

1. Open **Tools → Import CSV/Excel**
2. Upload your file
3. **Map columns** — drag your column headers to the matching IP Manager fields:
   - IP Address *(required)*
   - Name / hostname
   - Type (server, VM, IoT, etc.)
   - Location
   - Service
   - Tags
   - Notes
4. Choose **merge** or **replace**:
   - **Merge** — adds new entries; updates existing IPs if the IP already exists
   - **Replace** — clears the current network and replaces with the imported data
5. Click **Import**

### Tips

- The IP column is the only required field — everything else is optional
- Type values are matched case-insensitively to the app's device types
- Tags should be comma-separated within a single cell

---

## Editing entries after import

After any import method, click any card or table row to open the **Edit** modal. From there you can set:

- **Name** — displayed label
- **Hostname** — used for DNS mismatch detection
- **Type** — Server, VM, LXC, Desktop, IoT, Camera, Switch, etc.
- **Location** — physical or logical location label
- **Service** — the primary service running (triggers icon auto-suggestion)
- **Tags** — freeform, comma-separated
- **Notes** — free text
- **Icon** — choose from 500+ service icons via the picker
- **Health check URL** — optional HTTP/HTTPS endpoint for service monitoring
- **Secondary IPs** — link other IPs belonging to the same host
