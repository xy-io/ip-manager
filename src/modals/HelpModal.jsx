import { useState } from 'react';
import { X, HelpCircle } from 'lucide-react';
import { APP_VERSION, useModalA11y } from '../shared/common';

function HelpModal({ onClose }) {
  const modalRef = useModalA11y(typeof onClose === 'function' ? onClose : null);
  const [activeSection, setActiveSection] = useState('overview');

  const sections = [
    { id: 'overview',   label: 'Overview' },
    { id: 'status',     label: 'Status Indicators' },
    { id: 'managing',   label: 'Managing IPs' },
    { id: 'networks',   label: 'Networks & Settings' },
    { id: 'proxmox',    label: 'Proxmox Import' },
    { id: 'proxmoxsync', label: 'Proxmox Sync' },
    { id: 'proxmoxstatus', label: 'Proxmox VM Status' },
    { id: 'hostgroup',  label: 'Multiple IPs per Host' },
    { id: 'arp',        label: 'ARP Scan' },
    { id: 'ping',       label: 'Ping / Reachability' },
    { id: 'health',     label: 'Service Health' },
    { id: 'presence',   label: 'ARP & Presence' },
    { id: 'cidr',       label: 'CIDR Calculator' },
    { id: 'qr',         label: 'QR Codes' },
    { id: 'mac',        label: 'MAC Address' },
    { id: 'quicklaunch', label: 'Quick Launch' },
    { id: 'subnetvis',  label: 'Subnet Visualiser' },
    { id: 'backup',     label: 'Backup & Restore' },
    { id: 'importexp',  label: 'Import & Export' },
    { id: 'dns',        label: 'DNS Lookup' },
    { id: 'updates',    label: 'Updates' },
    { id: 'shortcuts',  label: 'Keyboard Shortcuts' },
  ];

  /* ── shared style helpers ── */
  const H2 = ({ children }) => <h3 className="text-base font-bold text-slate-800 mb-2">{children}</h3>;
  const H3 = ({ children }) => <h4 className="text-sm font-semibold text-slate-700 mt-4 mb-1.5">{children}</h4>;
  const P  = ({ children }) => <p className="text-sm text-slate-600 leading-relaxed mb-3">{children}</p>;
  const Kbd = ({ children }) => <kbd className="inline-block px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-xs font-mono text-slate-700">{children}</kbd>;
  const Badge = ({ color, children }) => {
    const colors = {
      green:  'bg-emerald-100 text-emerald-700 border-emerald-200',
      amber:  'bg-amber-100 text-amber-700 border-amber-200',
      blue:   'bg-blue-100 text-blue-700 border-blue-200',
      slate:  'bg-slate-100 text-slate-600 border-slate-200',
      violet: 'bg-violet-100 text-violet-700 border-violet-200',
    };
    return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${colors[color] || colors.slate}`}>{children}</span>;
  };
  const Row = ({ label, children }) => (
    <div className="flex gap-3 py-2 border-b border-slate-100 last:border-0">
      <div className="w-32 flex-shrink-0 text-xs font-semibold text-slate-500 pt-0.5">{label}</div>
      <div className="text-sm text-slate-600 flex-1">{children}</div>
    </div>
  );

  /* ── section content ── */
  const content = {
    overview: (
      <div>
        <H2>Overview</H2>
        <P>IP Address Manager gives you a single place to track every device on your home lab network — replacing the Excel spreadsheet you've been using for years.</P>
        <P>Each IP address gets a <strong>card</strong> (or a table row) showing the asset name, hostname, device type, service/app, physical location, tags, and notes. Free IPs in your static range are shown as green "Available" cards so you can claim them instantly.</P>

        <H3>Views</H3>
        <P><strong>Cards</strong> — visual grid, ideal for browsing. Click a card to expand its details and history. Press <Kbd>c</Kbd> to switch.</P>
        <P><strong>Table</strong> — dense, sortable list. Click any column header to sort. Press <Kbd>t</Kbd> to switch.</P>

        <H3>The header bar</H3>
        <div className="text-sm text-slate-600 space-y-1.5">
          <Row label="SQLite badge">Server mode — data saved to the server database and shared across all users/browsers.</Row>
          <Row label="Local badge">Browser-only mode — no server detected; data saved to this browser's localStorage.</Row>
          <Row label="Proxmox">Discover and import VMs & LXC containers from a Proxmox host.</Row>
          <Row label="ARP Scan">Sweep your subnet for active devices and import untracked ones.</Row>
          <Row label="Ping">Force an immediate reachability check of all tracked IPs.</Row>
          <Row label="DNS">Run a reverse DNS (PTR) lookup for all tracked IPs — see what your DNS server thinks each IP is called.</Row>
          <Row label="Import">Load IP data from a CSV or Excel file.</Row>
          <Row label="Export">Download all data as a formatted .xlsx file.</Row>
          <Row label="⚙">Network Settings — subnet, DHCP range, DNS server, locations, tags, backup & restore.</Row>
        </div>
      </div>
    ),

    status: (
      <div>
        <H2>Status Indicators</H2>

        <H3>Ping dots (next to each IP address)</H3>
        <div className="space-y-2 mb-4">
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400 flex-shrink-0" />
            <span><strong>Green</strong> — device responded to the last ping. Online.</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-400 flex-shrink-0" />
            <span><strong>Red</strong> — no response. Offline or unreachable.</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-300 flex-shrink-0" />
            <span><strong>Grey</strong> — status not yet known. Ping hasn't run yet, or the server is starting up.</span>
          </div>
          <P>Free (available) and Reserved IPs are not pinged — dots only appear on assigned entries.</P>
        </div>

        <H3>Service health dots (opt-in, shown alongside ping dot)</H3>
        <div className="space-y-2 mb-4">
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-sky-400 flex-shrink-0" />
            <span><strong>Sky blue</strong> — HTTP/HTTPS probe received a response (status &lt; 500). Service up.</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-400 flex-shrink-0" />
            <span><strong>Orange</strong> — connection failed, timed out, or HTTP 5xx. Service down.</span>
          </div>
          <P>The health dot only appears when a port has been configured in the entry's Edit modal. Hover the dot to see the probe URL and last status code.</P>
        </div>

        <H3>Card / row badges</H3>
        <div className="space-y-2">
          <div className="flex items-center gap-3"><Badge color="green">AVAILABLE</Badge><span className="text-sm text-slate-600">Free IP — click to claim it for a new device.</span></div>
          <div className="flex items-center gap-3"><Badge color="amber">DHCP</Badge><span className="text-sm text-slate-600">IP falls inside your DHCP pool — assigned dynamically by your router.</span></div>
          <div className="flex items-center gap-3"><Badge color="blue">Fixed</Badge><span className="text-sm text-slate-600">DHCP reservation — the router always gives this device the same IP.</span></div>
          <div className="flex items-center gap-3"><Badge color="slate">LXC / VM / Physical…</Badge><span className="text-sm text-slate-600">Device type — shown when the IP is in the static range and has no other badge.</span></div>
          <div className="flex items-center gap-3"><Badge color="violet">tag name</Badge><span className="text-sm text-slate-600">Tags assigned to the entry — searchable and filterable.</span></div>
          <div className="flex items-center gap-3">
            <span className="px-2 py-0.5 text-xs font-medium rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200 whitespace-nowrap">▶ running</span>
            <span className="text-sm text-slate-600">Proxmox VM/LXC power state — shown on proxmox-tagged entries. See <strong>Proxmox VM Status</strong> for details.</span>
          </div>
        </div>
      </div>
    ),

    managing: (
      <div>
        <H2>Managing IPs</H2>

        <H3>Claiming a free IP</H3>
        <P>Click any green <Badge color="green">AVAILABLE</Badge> card to open the edit form. Fill in the details and click <strong>Save</strong>. The IP moves from free to assigned immediately.</P>

        <H3>Editing an entry</H3>
        <P>Click any card or table row to expand it, then click the <strong>Edit</strong> button. You can change the asset name, hostname, type, service/app, location, tags, and notes. Every save is recorded in the change history shown at the bottom of the expanded card.</P>

        <H3>Releasing an IP</H3>
        <P>Open the edit form for an assigned entry and click <strong>Release IP</strong> (shown at the bottom). The entry reverts to a free card. All its data is cleared.</P>

        <H3>Bulk operations</H3>
        <P>Hover any card to reveal a checkbox in the top-left corner. Click it (or click multiple cards while holding nothing — just click the checkbox) to select entries. A bulk action bar appears at the bottom of the screen with options to:</P>
        <ul className="list-disc list-inside text-sm text-slate-600 space-y-1 mb-3 ml-2">
          <li>Edit type, location, or tags across all selected entries at once</li>
          <li>Delete all selected entries</li>
          <li>Clear the selection</li>
        </ul>

        <H3>Searching & filtering</H3>
        <P>The search bar at the top filters by any field — name, hostname, IP, service, location, tag, or notes. Press <Kbd>/</Kbd> from anywhere to jump to it. Press <Kbd>Esc</Kbd> to clear.</P>
        <P>Use the <strong>Filter</strong> button next to the search bar to narrow by type, location, or tag.</P>

        <H3>Copy an IP</H3>
        <P>In Table view, click any IP address to copy it to the clipboard instantly. In Card view, expand the card and use the <strong>Copy IP</strong> button.</P>
      </div>
    ),

    networks: (
      <div>
        <H2>Networks & Settings</H2>
        <P>Click the <strong>⚙</strong> icon in the header to open Settings for the active network.</P>

        <H3>Network ranges</H3>
        <P>The app understands your network layout so it can colour-code entries correctly:</P>
        <div className="text-sm text-slate-600 space-y-1 mb-3">
          <Row label="Subnet">Your network prefix — e.g. <code className="font-mono bg-slate-100 px-1 rounded text-xs">192.168.0.0</code> or <code className="font-mono bg-slate-100 px-1 rounded text-xs">192.168.0</code>. Trailing zeros are stripped automatically.</Row>
          <Row label="DHCP enabled">Toggle the DHCP pool on or off. Disable for fully static networks.</Row>
          <Row label="DHCP range">Start and end of the pool your router manages. Entries here get the amber DHCP badge.</Row>
          <Row label="DHCP Reservations">Host-portion octets of IPs that are fixed DHCP leases. Can be anywhere on the network — inside or outside the pool.</Row>
          <Row label="Static range">The range you manage manually. Free IPs are shown as Available cards.</Row>
        </div>

        <H3>Locations</H3>
        <P>Location labels (e.g. "Server Room", "Loft", "Office") can be added, renamed, or deleted in Settings → Locations. Changes apply to all entries using that label instantly.</P>

        <H3>Tags</H3>
        <P>Tags let you group entries by any criteria you choose (e.g. "Production", "IoT", "Monitoring"). Manage them in Settings → Tags — rename or delete a tag and it updates every entry that uses it.</P>

        <H3>Multiple networks / VLANs</H3>
        <P>Click <strong>Add Network</strong> in the header to create a second subnet. Each network has its own IP entries, ranges, locations, and settings. Switch between networks using the tabs below the header. A network can be deleted from its own Settings panel.</P>

        <H3>Backup & Restore</H3>
        <P>Settings → Backup downloads a single <code className="font-mono bg-slate-100 px-1 rounded text-xs">.json</code> file containing all networks, all IP entries, tags, and change history. Restore it on any machine in one click. Always take a backup before a Restore — it replaces all current data.</P>
      </div>
    ),

    proxmox: (
      <div>
        <H2>Proxmox Import</H2>
        <P>Click the purple <strong>Proxmox</strong> button to discover all VMs and LXC containers from a Proxmox host and import them in one click.</P>

        <H3>What you need</H3>
        <P>A Proxmox API token. Here's how to create one:</P>
        <ol className="list-decimal list-inside text-sm text-slate-600 space-y-1.5 mb-3 ml-1">
          <li>In the Proxmox web UI, go to <strong>Datacenter → Permissions → API Tokens</strong></li>
          <li>Click <strong>Add</strong></li>
          <li>Set <strong>User</strong> to <code className="font-mono bg-slate-100 px-1 rounded text-xs">root@pam</code></li>
          <li>Set <strong>Token ID</strong> to something memorable, e.g. <code className="font-mono bg-slate-100 px-1 rounded text-xs">ipmanager</code></li>
          <li>Leave <strong>Privilege Separation</strong> unchecked</li>
          <li>Click <strong>Add</strong> — <strong>copy the secret immediately</strong>, it won't be shown again</li>
        </ol>
        <P>Token format: <code className="font-mono bg-slate-100 px-1 rounded text-xs">root@pam!ipmanager=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</code></P>

        <H3>Running the import</H3>
        <P>Enter the Proxmox host IP or hostname (port defaults to 8006), paste the token, leave <em>Ignore TLS certificate errors</em> checked for self-signed certs, and click <strong>Discover VMs & LXCs</strong>.</P>

        <H3>Import modes</H3>
        <Row label="Merge">Adds new entries; updates existing ones matched by IP. Existing entries not in the Proxmox results are left untouched. Safe for incremental syncs.</Row>
        <div className="mb-3" />
        <Row label="Replace">Replaces all entries in the active network with what Proxmox returned. Use with caution — take a backup first.</Row>

        <H3>VMs not showing an IP?</H3>
        <P>VMs need the <strong>QEMU guest agent</strong> installed and running inside the VM so Proxmox can read the IP. LXC containers report IPs automatically. Stopped containers may not report interfaces.</P>
      </div>
    ),

    proxmoxsync: (
      <div>
        <H2>Proxmox Scheduled Sync</H2>
        <P>Once you've imported entries via the Proxmox button, the scheduled sync keeps them up to date automatically — no manual re-import needed. Its main purpose is detecting <strong>HA failovers</strong>: when Proxmox High Availability migrates a VM or LXC to a different node, the stored node name in your manager goes stale. The sync catches this and corrects it.</P>

        <H3>What it updates</H3>
        <P>Only entries already tagged <code className="font-mono bg-slate-100 px-1 rounded text-xs">proxmox</code> are ever touched — user-managed entries are ignored even if their IP matches something in Proxmox. For each matching entry, the sync checks:</P>
        <div className="space-y-2 mb-3">
          <Row label="Location (node)">The Proxmox node the VM or LXC is currently running on. This is the primary HA failover signal.</Row>
          <div className="mb-1" />
          <Row label="Asset name">Updated if Proxmox reports a different name for the VMID.</Row>
          <div className="mb-1" />
          <Row label="Proxmox fields">The internal VMID, node, and kind fields are kept in sync. These appear in the read-only Proxmox panel in the Edit modal — separate from the user-editable Notes field.</Row>
        </div>
        <P>Every change is written into the entry's change history, visible in the expanded card view — so you can see exactly what moved and when.</P>

        <H3>Setting it up</H3>
        <P>Go to <strong>Settings → Proxmox Scheduled Sync</strong> and enter the same host and API token you use for the one-shot import. Choose a sync interval (default 1 hour, minimum 15 minutes), tick <strong>Enable automatic sync</strong>, and click <strong>Save</strong>.</P>

        <H3>Sync Now</H3>
        <P>The <strong>Sync Now</strong> button in the same Settings section triggers an immediate run. It shows a spinner while running and updates the last-run time and change count when done. The IP cards refresh automatically if any entries were changed.</P>

        <H3>Things it won't do</H3>
        <P>The sync never adds new entries — if a new VM appears in Proxmox, you still import it manually via the Proxmox button. It also won't overwrite fields you've customised (like tags, service, or location) on entries that aren't tagged <code className="font-mono bg-slate-100 px-1 rounded text-xs">proxmox</code>.</P>
      </div>
    ),

    proxmoxstatus: (
      <div>
        <H2>Proxmox VM Status</H2>
        <P>For every entry tagged <code className="font-mono bg-slate-100 px-1 rounded text-xs">proxmox</code>, the app polls Proxmox every 60 seconds and shows the current power state of the VM or LXC directly on the card and table row.</P>

        <H3>State badges</H3>
        <div className="space-y-2 mb-4">
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="px-2 py-0.5 text-xs font-medium rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">▶ running</span>
            <span>VM or LXC is powered on and running.</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="px-2 py-0.5 text-xs font-medium rounded-full border bg-slate-100 text-slate-500 border-slate-200">■ stopped</span>
            <span>VM or LXC is shut down.</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="px-2 py-0.5 text-xs font-medium rounded-full border bg-amber-50 text-amber-700 border-amber-200">⏸ paused</span>
            <span>VM is suspended (QEMU pause state).</span>
          </div>
        </div>
        <P>The badge appears alongside the type badge (LXC / Virtual) in the top-right of the card and in the Type column of the table. Hovering it shows the VMID and node name. No badge is shown if the state can't be determined or Proxmox is not configured.</P>

        <H3>How it works</H3>
        <P>The VMID, node, and kind are stored as dedicated fields on each entry — separate from the user-editable Notes field. The server makes a targeted lightweight API call to Proxmox for each entry — no full node scan is needed. Results are cached for 30 seconds and auto-refreshed every 60 seconds in the background. This is entirely read-only; no commands are ever sent to Proxmox.</P>

        <H3>Requirements</H3>
        <P>Proxmox sync credentials must be configured in <strong>Settings → Proxmox Scheduled Sync</strong>. The same API token is reused — no extra configuration needed. If credentials are not set, the status badges are simply not shown.</P>

        <H3>Proxmox panel in Edit modal</H3>
        <P>Open the Edit modal for any Proxmox-tagged entry and you'll see a read-only <strong>Proxmox</strong> panel showing the VMID, node, and kind. This information is managed automatically and cannot be edited — it updates via the scheduled sync. The Notes field below it is entirely yours to use freely.</P>
      </div>
    ),

    hostgroup: (
      <div>
        <H2>Multiple IPs per Host</H2>
        <P>A server or VM with multiple network interfaces (multi-NIC or multi-VLAN) can have all its IP entries linked together so they clearly belong to the same host. Each group has one <strong>primary</strong> entry and one or more <strong>additional</strong> entries — each fully tracked and pinged independently.</P>

        <H3>Linking IPs</H3>
        <P>Open the Edit modal for the IP you want to be the primary. Scroll to the <strong>Additional IPs</strong> section at the bottom of the form. Use the dropdown to pick any other standalone (non-free, non-grouped) entry — including entries from other networks — then click <strong>+ Link</strong>. You can link as many as you need. Click <strong>Save</strong> — the association is stored immediately.</P>

        <H3>How it looks</H3>
        <div className="space-y-2 mb-3">
          <Row label="Primary card / row">Shows small blue chip badges listing each additional IP address, so you can see all interfaces at a glance.</Row>
          <div className="mb-1" />
          <Row label="Additional IP card / row">Shows a <span className="font-mono text-xs bg-slate-100 px-1 rounded">↳ Primary name</span> label so you always know which host it belongs to.</Row>
        </div>
        <P>The same indicators appear in both Cards view and Table view.</P>

        <H3>Unlinking IPs</H3>
        <P>Open the Edit modal for the primary entry. In the Additional IPs section, each linked entry has an <strong>×</strong> button — click it to remove the association, then save. You can also unlink from the linked entry's edit modal; it will be detached from the group.</P>

        <H3>Proxmox auto-grouping</H3>
        <P>When you import from Proxmox and a single VM or LXC reports multiple IP addresses (because it has multiple NICs or is connected to multiple VLANs), the importer automatically groups those IPs — the first address becomes the primary and the rest become additional IPs. No manual linking required.</P>
      </div>
    ),

    arp: (
      <div>
        <H2>ARP Scan</H2>
        <P>Click the teal <strong>ARP Scan</strong> button to sweep your subnet for active devices using ARP broadcast packets. This finds everything that's online — not just what's already in the manager.</P>

        <H3>How it works</H3>
        <P>The server runs <code className="font-mono bg-slate-100 px-1 rounded text-xs">arp-scan</code> against your subnet, then cross-references the results against your existing entries.</P>

        <H3>Result statuses</H3>
        <div className="space-y-2 mb-3">
          <div className="flex items-center gap-3 text-sm text-slate-600"><Badge color="green">✓ Tracked</Badge><span>Already in the manager. No action needed.</span></div>
          <div className="flex items-center gap-3 text-sm text-slate-600"><Badge color="amber">◯ Static</Badge><span>On your subnet, in the static range, not yet recorded. <strong>Pre-selected</strong> for import.</span></div>
          <div className="flex items-center gap-3 text-sm text-slate-600"><Badge color="blue">~ DHCP</Badge><span>In the DHCP pool. Deselected by default — you may not want to track dynamic leases.</span></div>
          <div className="flex items-center gap-3 text-sm text-slate-600"><Badge color="slate">⊘ Out of range</Badge><span>Responded but outside your configured subnet range.</span></div>
        </div>

        <H3>Importing results</H3>
        <P>Select the entries you want to add (use <strong>Static only</strong> for a quick pick of just the static-range devices), then click <strong>Import</strong>. Entries are merged into the active network.</P>

        <H3>Troubleshooting</H3>
        <P>If the scan returns only a handful of IPs almost instantly, the server is falling back to the kernel ARP cache (devices that recently talked to the server) rather than doing a real scan. This usually means <code className="font-mono bg-slate-100 px-1 rounded text-xs">arp-scan</code> lacks raw socket permission — run the update script (<code className="font-mono bg-slate-100 px-1 rounded text-xs">ip-manager-update</code>) to fix it automatically.</P>
      </div>
    ),

    ping: (
      <div>
        <H2>Ping / Reachability</H2>
        <P>Every assigned IP card and table row shows a coloured dot next to the IP address indicating whether the device is currently reachable.</P>

        <H3>Dot colours</H3>
        <div className="space-y-2 mb-4">
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400 flex-shrink-0" />
            <span><strong>Green</strong> — responded to ping. Online.</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-400 flex-shrink-0" />
            <span><strong>Red</strong> — no response. Offline or unreachable.</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-300 flex-shrink-0" />
            <span><strong>Grey</strong> — not yet checked (server just started, or fping unavailable).</span>
          </div>
        </div>

        <H3>Auto-refresh</H3>
        <P>The server pings all tracked IPs every <strong>60 seconds</strong> in the background using <code className="font-mono bg-slate-100 px-1 rounded text-xs">fping</code>. Results are cached and served instantly to the browser — the browser also polls every 60 seconds. You don't need to do anything; dots stay current automatically.</P>

        <H3>Manual refresh</H3>
        <P>Click the sky-blue <strong>Ping</strong> button in the header to force an immediate refresh. The button shows a spinner while the scan is running. Hovering it shows when the last check completed.</P>

        <H3>Troubleshooting</H3>
        <P>If you see an amber "Ping unavailable" banner, <code className="font-mono bg-slate-100 px-1 rounded text-xs">fping</code> is either not installed or lacks raw socket permission. Run the update script (<code className="font-mono bg-slate-100 px-1 rounded text-xs">ip-manager-update</code>) on the server to install and configure it automatically.</P>
      </div>
    ),

    health: (
      <div>
        <H2>Service Health</H2>
        <P>Service health checks let you verify that an application is actually responding on its HTTP/HTTPS port — useful for detecting a service that is running but has crashed, or a port that has changed.</P>

        <H3>How it works</H3>
        <P>When a port is configured for an entry, the server makes a lightweight HTTP GET request to that URL every 60 seconds. Any response with a status code below 500 is counted as <strong>up</strong> (this includes redirects and auth pages). Connection failures, timeouts, and 5xx responses are counted as <strong>down</strong>. TLS certificate errors are always ignored — self-signed certificates are common in home-lab environments.</P>

        <H3>Dot colours</H3>
        <div className="space-y-2 mb-4">
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-sky-400 flex-shrink-0" />
            <span><strong>Sky blue</strong> — service responded (HTTP &lt; 500). Up.</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-400 flex-shrink-0" />
            <span><strong>Orange</strong> — no response, timeout, or HTTP 5xx. Down.</span>
          </div>
        </div>
        <P>The health dot appears <em>alongside</em> the ping dot. An entry can be green (ping up) and orange (service down) if the host is alive but the app has crashed.</P>

        <H3>Configuring a health check</H3>
        <P>Open the Edit modal for any assigned entry. Scroll to the <strong>Service Health Check</strong> section. Set the scheme (http/https), port, and path. If the service name field matches a known application, an <strong>Auto</strong> button pre-fills suggested values. Leave the port blank to disable the health check for that entry.</P>

        <H3>Hovering the dot</H3>
        <P>Hovering the dot shows the full probe URL and the last HTTP status code received, so you can quickly verify it is pointing at the right endpoint.</P>
      </div>
    ),

    presence: (
      <div>
        <H2>ARP &amp; Presence</H2>
        <P>The ARP &amp; Presence features in <strong>Settings → ARP &amp; Presence</strong> give you two independent capabilities for tracking device activity on your network. Both are disabled by default.</P>

        <H3>Last Seen Timestamps</H3>
        <P>When enabled, the server records the last time each IP address responded to a ping. This piggybacks on the existing 60-second ping cycle — no extra network traffic is generated. A small clock icon with a relative time (e.g. <em>3m ago</em>, <em>2h ago</em>) appears inline with the IP address on both cards and in the table.</P>
        <P>If a device has been offline or hasn't been seen for more than 25 hours, the timestamp turns amber as a visual indicator that it may be stale. Hovering the timestamp shows the exact date and time.</P>
        <P>Last-seen data is stored server-side and persists across page reloads and service restarts. You can clear all stored data from the Settings → ARP &amp; Presence tab at any time.</P>

        <H3>Background Discovery Scan</H3>
        <P>When enabled, the server periodically runs an ARP sweep across your network's static range to detect devices that aren't yet tracked in the manager. Results are shown in Settings → ARP &amp; Presence; untracked devices can then be imported via the ARP Scan button in the toolbar.</P>

        <H3>Rate limiting &amp; subnet awareness</H3>
        <div className="space-y-0.5 mb-3">
          <Row label="/24 subnet">{'/24 networks default to a 15-minute scan interval and 1000 Kbps bandwidth cap.'}</Row>
          <Row label="/16 or larger">{'/16+ networks default to a 60-minute interval and 200 Kbps cap to avoid flooding large subnets.'}</Row>
        </div>
        <P>Both the interval and bandwidth cap can be overridden in settings. You can also pin a specific network interface (e.g. <code className="font-mono bg-slate-100 px-1 rounded text-xs">eth0</code>) if the server has multiple interfaces.</P>

        <H3>Requirements</H3>
        <P>Background discovery uses <code className="font-mono bg-slate-100 px-1 rounded text-xs">arp-scan</code>, the same tool used by the manual ARP Scan. If it's not installed or lacks raw socket capability, the scan will silently skip and log an error. Run the update script (<code className="font-mono bg-slate-100 px-1 rounded text-xs">ip-manager-update</code>) to install and configure it automatically.</P>
      </div>
    ),

    cidr: (
      <div>
        <H2>CIDR Calculator</H2>
        <P>The CIDR Calculator is a quick-reference tool for subnet arithmetic. Open it via the <strong>Tools</strong> dropdown in the toolbar (wrench icon).</P>

        <H3>How to use it</H3>
        <P>Type any IP address with a prefix length — e.g. <code className="font-mono bg-slate-100 px-1 rounded text-xs">192.168.1.0/24</code> or <code className="font-mono bg-slate-100 px-1 rounded text-xs">10.0.0.1/16</code> — into the input field. Results update as you type, with no submit button needed.</P>

        <H3>What it calculates</H3>
        <div className="space-y-0.5 mb-3">
          <Row label="Network">The network address for the given prefix.</Row>
          <Row label="Broadcast">The broadcast address for the subnet.</Row>
          <Row label="Usable range">First and last usable host addresses.</Row>
          <Row label="Subnet mask">Dotted-decimal form (e.g. 255.255.255.0).</Row>
          <Row label="Wildcard mask">The inverse of the subnet mask.</Row>
          <Row label="Total hosts">Total addresses in the subnet (including network + broadcast).</Row>
          <Row label="Usable hosts">Addresses available for hosts (total minus 2).</Row>
          <Row label="Next network">The first address of the next subnet of the same size.</Row>
          <Row label="IP class">Classful class of the IP (A / B / C / D / E).</Row>
          <Row label="Binary">Dot-separated binary representation of the IP address.</Row>
        </div>

        <H3>Quick-fill from a card</H3>
        <P>There is no direct one-click fill yet — open the calculator from the Tools dropdown and type your subnet manually. The calculator works entirely client-side: no data is sent to the server.</P>
      </div>
    ),

    qr: (
      <div>
        <H2>QR Codes</H2>
        <P>Generate a QR code for any tracked device — useful for printing asset labels, scanning with a phone to jump straight to an admin UI, or quickly sharing an IP address.</P>

        <H3>How to open it</H3>
        <P>In <strong>card view</strong>, expand a card and click the violet <strong>QR</strong> button in the action row. In <strong>table view</strong>, click the QR icon in the Actions column for that row. The QR modal opens with a 256 × 256 pixel code and a mode toggle.</P>

        <H3>Content modes</H3>
        <div className="space-y-0.5 mb-3">
          <Row label="Service URL">Encodes the full URL from the device's Service/App URL field (e.g. <code className="font-mono bg-slate-100 px-1 rounded text-xs">http://192.168.1.10:8080</code>). Only available if a URL is set.</Row>
          <Row label="IP Address">Encodes the bare IP address (e.g. <code className="font-mono bg-slate-100 px-1 rounded text-xs">192.168.1.10</code>). Always available.</Row>
        </div>
        <P>The modal defaults to Service URL mode when a URL is present, or IP Address mode otherwise.</P>

        <H3>Saving the QR code</H3>
        <P>Click <strong>Download PNG</strong> to save the QR image to your computer (named after the device, e.g. <code className="font-mono bg-slate-100 px-1 rounded text-xs">pi-hole-qr.png</code>). Click <strong>Copy text</strong> to copy the encoded URL or IP to your clipboard.</P>

        <H3>Technical note</H3>
        <P>QR codes are generated entirely in the browser using the <code className="font-mono bg-slate-100 px-1 rounded text-xs">qrcode</code> library — no data leaves your local network.</P>
      </div>
    ),

    mac: (
      <div>
        <H2>MAC Address</H2>
        <P>Each IP entry can store a MAC address and its associated hardware vendor. This is purely informational — the app does not use the MAC address for any network operations.</P>

        <H3>Adding a MAC address</H3>
        <P>Open the edit modal for any assigned entry (click the pencil icon or expand a card and click <strong>Edit</strong>). The <strong>MAC Address</strong> field is below the Hostname field. Type the MAC in any standard format (e.g. <code className="font-mono bg-slate-100 px-1 rounded text-xs">DC:A6:32:1A:2B:3C</code>, <code className="font-mono bg-slate-100 px-1 rounded text-xs">dc-a6-32-1a-2b-3c</code>, or <code className="font-mono bg-slate-100 px-1 rounded text-xs">DCA6321A2B3C</code>). When you move focus out of the field, the app looks up the OUI prefix and displays the vendor name alongside the field (e.g. <em>Raspberry Pi Trading Ltd</em>).</P>

        <H3>Vendor lookup</H3>
        <P>Vendor names are resolved by querying the bundled IEEE OUI database on the server — no internet connection is required. The first six hex digits (the OUI prefix) identify the manufacturer. If no match is found the field is left blank.</P>

        <H3>Where it appears</H3>
        <P>Once saved, the MAC address appears in small monospace text below the IP address on expanded cards and in the table's IP column, with the vendor name shown as a tooltip and inline where space allows.</P>
      </div>
    ),

    quicklaunch: (
      <div>
        <H2>Quick Launch</H2>
        <P>Expanded cards have two quick-launch link buttons that open in a new browser tab, letting you jump straight to a device's web UI or SSH session without having to remember the address.</P>

        <H3>HTTP / HTTPS button</H3>
        <P>Appears in the card action row when a <strong>Service Health Check</strong> port is configured for the entry. Clicking it opens <code className="font-mono bg-slate-100 px-1 rounded text-xs">{"{scheme}://{ip}:{port}{path}"}</code> in a new tab, using the same scheme (http/https), port, and path you set for health monitoring. This makes it a zero-extra-configuration shortcut — if you've already set up health checks, the button is ready.</P>

        <H3>SSH button</H3>
        <P>Appears when the entry has a <strong>Hostname</strong> set. Clicking it invokes an <code className="font-mono bg-slate-100 px-1 rounded text-xs">ssh://hostname</code> URL, which your OS hands off to whatever SSH client is registered (e.g. Terminal on macOS, PuTTY on Windows). If no SSH client is registered for the <code className="font-mono bg-slate-100 px-1 rounded text-xs">ssh://</code> scheme, nothing will happen — you may need to register one.</P>

        <H3>Note</H3>
        <P>Both buttons are read-only links — they never send any commands to the server. The HTTP button is a shortcut for things you'd navigate to manually anyway.</P>
      </div>
    ),

    subnetvis: (
      <div>
        <H2>Subnet Visualiser</H2>
        <P>The Subnet Visualiser shows the entire address space of the current network as a 16×16 heat-map grid (256 cells, one per last octet from .0 to .255). Open it via the <strong>Tools</strong> dropdown.</P>

        <H3>Reading the grid</H3>
        <div className="space-y-0.5 mb-3">
          <Row label="Emerald green">Assigned — the IP is tracked and in use.</Row>
          <Row label="Light green">Free static — in your static range but unclaimed.</Row>
          <Row label="Light grey">DHCP pool — managed by your router.</Row>
          <Row label="Amber">Reserved — a DHCP reservation in Settings.</Row>
          <Row label="Near-white">Outside configured range.</Row>
        </div>
        <P>Hover any cell to see a tooltip with the full IP, asset name, and range classification.</P>

        <H3>Planned Blocks</H3>
        <P>Below the grid is a <strong>Planned Blocks</strong> section. Blocks let you overlay named colour regions on top of the standard colours to mark intent (e.g. "IoT devices .200–.220", "Security cameras .221–.240"). Each block has a name, start and end last-octet, and a colour picked from a palette.</P>
        <P>Blocks are stored server-side per network and persist across sessions. The last block in the list takes priority if ranges overlap. Remove a block with the × button.</P>

        <H3>Note</H3>
        <P>The Subnet Visualiser is a read-only planning aid — it doesn't change any IP entries or network configuration. Changes to assignments are made via the normal add/edit/release flow.</P>
      </div>
    ),

    importexp: (
      <div>
        <H2>Import & Export</H2>

        <H3>Importing from CSV or Excel</H3>
        <P>Click <strong>Import</strong> in the header. Drag and drop a <code className="font-mono bg-slate-100 px-1 rounded text-xs">.csv</code>, <code className="font-mono bg-slate-100 px-1 rounded text-xs">.xlsx</code>, or <code className="font-mono bg-slate-100 px-1 rounded text-xs">.xls</code> file onto the upload zone, or click to browse. A downloadable CSV template with the correct column headers is available from the import screen.</P>

        <H3>Column mapping</H3>
        <P>Common header variations are detected automatically (e.g. <em>hostname</em>, <em>host name</em>, and <em>fqdn</em> all map to Hostname). Use the dropdowns to fix any columns that weren't auto-detected.</P>

        <H3>Supported columns</H3>
        <div className="space-y-0.5 mb-3">
          <Row label="ip (required)">Full IPv4 address. On /24 networks, last-octet shorthand (e.g. 42) expands to your subnet automatically.</Row>
          <Row label="hostname (required)">FQDN or short name.</Row>
          <Row label="type (required)">e.g. LXC, VM, Physical, IoT.</Row>
          <Row label="service (required)">App or service running on the host.</Row>
          <Row label="name">Display / asset name. Falls back to the hostname prefix if omitted.</Row>
          <Row label="location">Physical location or rack label.</Row>
          <Row label="host">Hypervisor or parent host.</Row>
          <Row label="notes">Free-text notes.</Row>
          <Row label="status">assigned or free (defaults to assigned).</Row>
        </div>

        <H3>Import modes</H3>
        <Row label="Merge">Adds new entries; updates existing ones by IP. Safe for incremental updates.</Row>
        <div className="mb-2"/>
        <Row label="Replace">Replaces all entries in the active network. Use with caution — take a backup first.</Row>

        <H3>Exporting</H3>
        <P>Click <strong>Export</strong> in the header to download a formatted <code className="font-mono bg-slate-100 px-1 rounded text-xs">.xlsx</code> file containing all entries in the active network, preserving all fields.</P>
      </div>
    ),

    backup: (
      <div>
        <H2>Backup & Restore</H2>
        <P>Backup and Restore live in <strong>Settings (⚙)</strong> — they are distinct from Export, which only downloads the active network as a spreadsheet. A backup captures <em>everything</em>.</P>

        <H3>What a backup includes</H3>
        <P>A full backup is a single <code className="font-mono bg-slate-100 px-1 rounded text-xs">.json</code> file containing all networks, all IP entries across every network, all tags, all notes, all custom locations, and the complete change history. It contains everything needed to fully restore the app on a new machine or after a server rebuild.</P>

        <H3>Downloading a backup</H3>
        <P>Open <strong>Settings (⚙)</strong> and scroll to the <strong>Backup & Restore</strong> section. Click <strong>Download Full Backup (.json)</strong>. Save the file somewhere safe — an external drive, cloud storage, or another server. The filename includes today's date so you can keep multiple versions.</P>
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800 mb-3">
          <strong>Tip:</strong> Take a backup before any major change — restoring a network, importing a large dataset, or upgrading the server. It takes two seconds and gives you a full rollback point.
        </div>

        <H3>Restoring from a backup</H3>
        <P>In <strong>Settings (⚙) → Backup & Restore</strong>, click <strong>Restore from Backup…</strong> and select your <code className="font-mono bg-slate-100 px-1 rounded text-xs">.json</code> file. A preview panel shows the backup date, how many networks it contains, and how many IP entries. Review it, then click <strong>Yes, Restore Now</strong>.</P>
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 mb-3">
          <strong>Warning:</strong> A restore replaces <em>all</em> current data — every network and every IP entry — with the contents of the backup file. This cannot be undone. Always download a fresh backup first if you want a way back.
        </div>

        <H3>Difference between Backup and Export</H3>
        <div className="space-y-0">
          <Row label="Backup (.json)">Everything — all networks, all entries, tags, notes, history. Use for disaster recovery, server migrations, and full snapshots.</Row>
          <Row label="Export (.xlsx)">The active network only, as a formatted spreadsheet. Use for sharing data, reporting, or opening in Excel.</Row>
        </div>
      </div>
    ),

    dns: (
      <div>
        <H2>DNS Lookup</H2>
        <P>The DNS Lookup feature runs a <strong>reverse DNS (PTR) lookup</strong> for every tracked IP address and displays the result alongside each entry. It answers the question: "What does DNS think this IP is called?"</P>

        <H3>What is a PTR record?</H3>
        <P>When you look up a hostname you get an IP address (a forward lookup). A PTR record is the reverse — given an IP address, it returns the hostname registered in DNS. For example, <code className="font-mono bg-slate-100 px-1 rounded text-xs">192.168.0.171</code> might resolve to <code className="font-mono bg-slate-100 px-1 rounded text-xs">server.home.lab</code> if that PTR record exists on your DNS server.</P>

        <H3>Running a DNS lookup</H3>
        <P>Click the <strong>DNS</strong> button in the header to run an immediate reverse lookup for all tracked IPs. The lookup also runs automatically in the background every 24 hours — you only need to click the button when you want a fresh result right now.</P>

        <H3>How results are displayed</H3>
        <P>IP Manager compares each PTR result against the hostname you have stored for that entry and only shows something when it adds new information:</P>
        <div className="space-y-0 mb-3">
          <Row label="Match">PTR record matches the stored hostname — nothing extra is shown. Your DNS and your records agree; no need to repeat it.</Row>
          <Row label="No hostname stored">No hostname on the entry — the PTR result is shown in grey beneath the IP as a useful fill-in.</Row>
          <Row label="Mismatch">PTR differs from the stored hostname — shown in amber as <code className="font-mono bg-slate-100 px-1 rounded text-xs">⚠ DNS: other-name.domain</code>. Worth investigating — could be a stale DNS record or a typo in your entry.</Row>
        </div>

        <H3>Configuring the DNS server</H3>
        <P>By default, lookups use the system resolver on the server (whatever is configured in <code className="font-mono bg-slate-100 px-1 rounded text-xs">/etc/resolv.conf</code>). To use a specific server — your Pi-hole, your router, or a public resolver — open <strong>Settings (⚙) → DNS Reverse Lookup</strong> and enter the IP address of the server you want to use (e.g. <code className="font-mono bg-slate-100 px-1 rounded text-xs">192.168.0.6</code> or <code className="font-mono bg-slate-100 px-1 rounded text-xs">1.1.1.1</code>). Leave the field blank to return to the system default.</P>

        <H3>Why might a lookup return nothing?</H3>
        <div className="space-y-0">
          <Row label="No PTR record">The IP has no reverse DNS entry. Common for DHCP clients — most home routers don't create PTR records automatically.</Row>
          <Row label="Wrong DNS server">The configured DNS server doesn't hold your LAN's reverse zone. Try setting it to your local DNS (e.g. Pi-hole or router IP).</Row>
          <Row label="Disabled">DNS lookup is disabled in Settings. Toggle it on to resume background lookups.</Row>
        </div>
      </div>
    ),

    updates: (
      <div>
        <H2>Updates</H2>
        <P>IP Address Manager can check for new versions and update itself directly from the browser — no terminal access to the LXC required.</P>

        <H3>Checking for updates</H3>
        <P>Open <strong>Settings → Updates</strong>. The app checks GitHub for the latest release and compares it against the installed version. If you're up to date, a green <Badge color="green">Up to date</Badge> badge is shown alongside the installed version number. If a newer release is available, an amber <Badge color="amber">Update available</Badge> badge appears — and an amber dot shows on the Settings gear icon in the toolbar so you can see it without opening Settings.</P>

        <H3>Installing an update</H3>
        <P>When an update is available, click <strong>Update now</strong> in the Settings → Updates panel. The update runs in five steps and streams live progress to the screen:</P>
        <div className="space-y-1 mb-3 ml-2">
          <Row label="1. Fetch code">Pulls the latest version from GitHub using <code className="font-mono bg-slate-100 px-1 rounded text-xs">git pull</code>.</Row>
          <Row label="2. Dependencies">Installs any new or updated frontend packages.</Row>
          <Row label="3. Build">Compiles the React app into optimised static files.</Row>
          <Row label="4. Server pkgs">Updates server-side packages if needed.</Row>
          <Row label="5. Restart">Restarts the API service — the browser reconnects automatically within a few seconds.</Row>
        </div>
        <P>Total time is typically 30–60 seconds. The page reconnects on its own once the service is back up — no manual refresh needed.</P>

        <H3>Automatic rollback on failure</H3>
        <P>If any step fails, the app automatically reverts to the previous working version: it resets the code to the last good commit, rebuilds, and restarts. A red error banner explains what went wrong, and a <strong>Show error log</strong> toggle reveals the full output so you can investigate or share with the developer.</P>
        <P>A rollback means your instance stays running on the old version — nothing is left in a broken state.</P>

        <H3>Manual updates (terminal)</H3>
        <P>The terminal command <code className="font-mono bg-slate-100 px-1 rounded text-xs">ip-manager-update</code> on the LXC continues to work exactly as before. Both methods run the same underlying script — in-browser updates are not a replacement, just a convenience layer on top.</P>

        <H3>Release notes</H3>
        <P>The <strong>Release Log</strong> section at the bottom of the Updates tab shows every version with its full release notes, parsed directly from the app's changelog. Click any version row to expand it.</P>
      </div>
    ),

    shortcuts: (
      <div>
        <H2>Keyboard Shortcuts</H2>
        <P>These shortcuts work anywhere in the app, as long as you're not typing in an input field.</P>
        <div className="mt-2 space-y-0">
          {[
            ['/','Focus the search bar'],
            ['Esc','Clear search — or close the open modal — or collapse the expanded card (in that order)'],
            ['t','Switch to Table view'],
            ['c','Switch to Cards view'],
          ].map(([key, desc]) => (
            <div key={key} className="flex items-start gap-4 py-3 border-b border-slate-100 last:border-0">
              <div className="flex-shrink-0 w-12"><Kbd>{key}</Kbd></div>
              <span className="text-sm text-slate-600">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    ),
  };

  return (
    <div ref={modalRef} role="dialog" aria-modal="true" aria-label="Help and reference" tabIndex={-1}
         className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 outline-none" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[82vh] flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-slate-600" />
            <h2 className="text-lg font-bold text-slate-800">Help & Reference</h2>
            <span className="px-1.5 py-0.5 text-xs font-mono font-medium bg-slate-100 text-slate-500 rounded border border-slate-200">{APP_VERSION}</span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">

          {/* Sidebar */}
          <div className="w-48 border-r border-slate-100 py-3 flex-shrink-0 overflow-y-auto bg-slate-50 rounded-bl-2xl flex flex-col">
            <div className="flex-1">
              {sections.map(s => (
                <button
                  key={s.id}
                  onClick={() => setActiveSection(s.id)}
                  className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                    activeSection === s.id
                      ? 'bg-white text-slate-800 font-semibold border-r-2 border-slate-800'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-slate-200 flex-shrink-0">
              <p className="text-xs text-slate-400 font-mono">IP Manager {APP_VERSION}</p>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {content[activeSection]}
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Import Modal ──────────────────────────────────────────────────────────────

export default HelpModal;
