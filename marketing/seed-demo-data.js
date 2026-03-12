/**
 * IP Manager — Demo Data Seed Script
 * Paste this into the browser console while the app is open (localhost:5173 or your LXC IP).
 * It populates localStorage with a realistic home lab network, then reloads the page.
 *
 * To clear and return to your real data, run:  localStorage.clear(); location.reload();
 */

const NETWORK = {
  id: "net-1",
  networkName: "Home Lab",
  subnet: "192.168.0",
  dhcpEnabled: true,
  dhcpStart: 1,
  dhcpEnd: 150,
  staticStart: 151,
  staticEnd: 254,
  fixedInDHCP: [2, 6, 10, 20, 30],
};

const IP_DATA = [
  // ── Core Infrastructure ──────────────────────────────────────────────────
  {
    ip: "192.168.0.1",   hostname: "router.home.lab",      label: "Router",
    type: "Physical",    location: "Rack",                  tags: ["gateway", "network"],
    notes: "UniFi Dream Machine Pro — main gateway",       status: "static",
  },
  {
    ip: "192.168.0.2",   hostname: "switch-core.home.lab", label: "Core Switch",
    type: "Physical",    location: "Rack",                  tags: ["network", "poe"],
    notes: "UniFi USW-Pro-24-PoE",                         status: "static",
  },
  {
    ip: "192.168.0.3",   hostname: "ap-lounge.home.lab",   label: "AP — Lounge",
    type: "Physical",    location: "Lounge",                tags: ["wifi", "unifi"],
    notes: "UniFi U6-LR access point",                     status: "static",
  },
  {
    ip: "192.168.0.4",   hostname: "ap-office.home.lab",   label: "AP — Office",
    type: "Physical",    location: "Office",                tags: ["wifi", "unifi"],
    notes: "UniFi U6-Lite",                                status: "static",
  },
  {
    ip: "192.168.0.6",   hostname: "pihole.home.lab",      label: "Pi-hole DNS",
    type: "Virtual",     location: "Proxmox1",              tags: ["dns", "pihole", "lxc"],
    notes: "Primary DNS — Pi-hole + Unbound recursive resolver",  status: "static",
  },
  {
    ip: "192.168.0.7",   hostname: "pihole2.home.lab",     label: "Pi-hole DNS 2",
    type: "Virtual",     location: "Proxmox2",              tags: ["dns", "pihole", "lxc"],
    notes: "Fallback DNS",                                 status: "static",
  },

  // ── Storage ──────────────────────────────────────────────────────────────
  {
    ip: "192.168.0.10",  hostname: "nas.home.lab",         label: "Synology NAS",
    type: "Physical",    location: "Rack",                  tags: ["storage", "synology", "nas"],
    notes: "DS923+ — 4×8TB drives, RAID5. SMB shares + Docker host",  status: "static",
  },
  {
    ip: "192.168.0.11",  hostname: "backup.home.lab",      label: "Backup NAS",
    type: "Physical",    location: "Garage",                tags: ["storage", "backup"],
    notes: "DS220+ offsite-style local backup",            status: "static",
  },

  // ── Proxmox Cluster ──────────────────────────────────────────────────────
  {
    ip: "192.168.0.20",  hostname: "pve1.home.lab",        label: "Proxmox Node 1",
    type: "Physical",    location: "Rack",                  tags: ["proxmox", "hypervisor"],
    notes: "Ryzen 9 5900X · 128GB ECC · primary compute node",  status: "static",
  },
  {
    ip: "192.168.0.21",  hostname: "pve2.home.lab",        label: "Proxmox Node 2",
    type: "Physical",    location: "Rack",                  tags: ["proxmox", "hypervisor"],
    notes: "Intel i9-12900K · 64GB · secondary compute node",   status: "static",
  },
  {
    ip: "192.168.0.22",  hostname: "pve3.home.lab",        label: "Proxmox Node 3",
    type: "Physical",    location: "Rack",                  tags: ["proxmox", "hypervisor"],
    notes: "HP ProDesk mini — low power, always-on services",   status: "static",
  },

  // ── VMs & LXCs ───────────────────────────────────────────────────────────
  {
    ip: "192.168.0.30",  hostname: "homeassistant.home.lab", label: "Home Assistant",
    type: "Virtual",     location: "Proxmox1",               tags: ["ha", "automation", "vm"],
    notes: "Home Assistant OS VM — zigbee2mqtt, Z-Wave",   status: "static",
  },
  {
    ip: "192.168.0.31",  hostname: "plex.home.lab",         label: "Plex Media Server",
    type: "Virtual",     location: "Proxmox1",               tags: ["media", "plex", "vm"],
    notes: "Plex with hardware transcoding via iGPU passthrough",  status: "static",
  },
  {
    ip: "192.168.0.32",  hostname: "jellyfin.home.lab",     label: "Jellyfin",
    type: "Virtual",     location: "Proxmox2",               tags: ["media", "jellyfin", "lxc"],
    notes: "Jellyfin media server — backup to Plex",       status: "static",
  },
  {
    ip: "192.168.0.33",  hostname: "nextcloud.home.lab",    label: "Nextcloud",
    type: "Virtual",     location: "Proxmox1",               tags: ["cloud", "nextcloud", "vm"],
    notes: "Nextcloud AIO — files, calendar, contacts",    status: "static",
  },
  {
    ip: "192.168.0.34",  hostname: "gitea.home.lab",        label: "Gitea",
    type: "Virtual",     location: "Proxmox2",               tags: ["git", "dev", "lxc"],
    notes: "Self-hosted Git — mirrors GitHub repos",       status: "static",
  },
  {
    ip: "192.168.0.35",  hostname: "vaultwarden.home.lab",  label: "Vaultwarden",
    type: "Virtual",     location: "Proxmox3",               tags: ["security", "passwords", "lxc"],
    notes: "Bitwarden-compatible password manager",        status: "static",
  },
  {
    ip: "192.168.0.36",  hostname: "grafana.home.lab",      label: "Grafana",
    type: "Virtual",     location: "Proxmox2",               tags: ["monitoring", "grafana", "lxc"],
    notes: "Dashboards — Prometheus, InfluxDB, Loki",      status: "static",
  },
  {
    ip: "192.168.0.37",  hostname: "prometheus.home.lab",   label: "Prometheus",
    type: "Virtual",     location: "Proxmox2",               tags: ["monitoring", "metrics", "lxc"],
    notes: "Metrics collection — node exporters, cAdvisor",  status: "static",
  },
  {
    ip: "192.168.0.38",  hostname: "traefik.home.lab",      label: "Traefik",
    type: "Virtual",     location: "Proxmox1",               tags: ["proxy", "traefik", "lxc"],
    notes: "Reverse proxy + Let's Encrypt for internal TLS",  status: "static",
  },
  {
    ip: "192.168.0.39",  hostname: "portainer.home.lab",    label: "Portainer",
    type: "Virtual",     location: "Proxmox3",               tags: ["docker", "portainer", "lxc"],
    notes: "Docker management UI",                         status: "static",
  },
  {
    ip: "192.168.0.40",  hostname: "uptime.home.lab",       label: "Uptime Kuma",
    type: "Virtual",     location: "Proxmox3",               tags: ["monitoring", "uptime", "lxc"],
    notes: "Service uptime monitoring with push alerts",   status: "static",
  },
  {
    ip: "192.168.0.41",  hostname: "immich.home.lab",       label: "Immich",
    type: "Virtual",     location: "Proxmox1",               tags: ["photos", "immich", "vm"],
    notes: "Self-hosted Google Photos replacement",        status: "static",
  },
  {
    ip: "192.168.0.42",  hostname: "paperless.home.lab",    label: "Paperless-ngx",
    type: "Virtual",     location: "Proxmox2",               tags: ["documents", "paperless", "lxc"],
    notes: "Document archiving and OCR",                   status: "static",
  },
  {
    ip: "192.168.0.43",  hostname: "adguard.home.lab",      label: "AdGuard Home",
    type: "Virtual",     location: "Proxmox3",               tags: ["dns", "adguard", "lxc"],
    notes: "Secondary DNS / DHCP fallback",                status: "static",
  },
  {
    ip: "192.168.0.44",  hostname: "wireguard.home.lab",    label: "WireGuard VPN",
    type: "Virtual",     location: "Proxmox1",               tags: ["vpn", "wireguard", "lxc"],
    notes: "Remote access VPN — phones + laptops",         status: "static",
  },
  {
    ip: "192.168.0.45",  hostname: "linkwarden.home.lab",   label: "Linkwarden",
    type: "Virtual",     location: "Proxmox2",               tags: ["bookmarks", "lxc"],
    notes: "Bookmark manager with snapshots",              status: "static",
  },
  {
    ip: "192.168.0.46",  hostname: "ntfy.home.lab",         label: "ntfy",
    type: "Virtual",     location: "Proxmox3",               tags: ["notifications", "lxc"],
    notes: "Push notification broker",                     status: "static",
  },
  {
    ip: "192.168.0.47",  hostname: "speedtest.home.lab",    label: "Speedtest Tracker",
    type: "Virtual",     location: "Proxmox2",               tags: ["monitoring", "lxc"],
    notes: "Scheduled ISP speed tests with history",       status: "static",
  },

  // ── DHCP Devices ─────────────────────────────────────────────────────────
  {
    ip: "192.168.0.80",  hostname: "macbook-jay.home.lab",  label: "MacBook Pro — Jay",
    type: "Physical",    location: "Office",                 tags: ["laptop", "apple"],
    notes: "M3 Pro MacBook Pro",                           status: "dhcp",
  },
  {
    ip: "192.168.0.81",  hostname: "macbook-sarah.home.lab",label: "MacBook Air — Sarah",
    type: "Physical",    location: "Lounge",                 tags: ["laptop", "apple"],
    notes: "",                                             status: "dhcp",
  },
  {
    ip: "192.168.0.82",  hostname: "ipad-lounge.home.lab",  label: "iPad",
    type: "Physical",    location: "Lounge",                 tags: ["tablet", "apple"],
    notes: "",                                             status: "dhcp",
  },
  {
    ip: "192.168.0.83",  hostname: "appletv.home.lab",      label: "Apple TV 4K",
    type: "Physical",    location: "Lounge",                 tags: ["media", "apple"],
    notes: "",                                             status: "dhcp",
  },
  {
    ip: "192.168.0.84",  hostname: "printer-office.home.lab",label: "Office Printer",
    type: "Physical",    location: "Office",                 tags: ["printer"],
    notes: "Brother MFC-L3770CDW",                        status: "dhcp",
  },
  {
    ip: "192.168.0.85",  hostname: "cam-front.home.lab",    label: "Front Door Camera",
    type: "Physical",    location: "Front",                  tags: ["camera", "security"],
    notes: "Reolink RLC-810A PoE",                        status: "dhcp",
  },
  {
    ip: "192.168.0.86",  hostname: "cam-back.home.lab",     label: "Back Garden Camera",
    type: "Physical",    location: "Garden",                 tags: ["camera", "security"],
    notes: "Reolink RLC-810A PoE",                        status: "dhcp",
  },
  {
    ip: "192.168.0.87",  hostname: "cam-garage.home.lab",   label: "Garage Camera",
    type: "Physical",    location: "Garage",                 tags: ["camera", "security"],
    notes: "",                                             status: "dhcp",
  },
  {
    ip: "192.168.0.88",  hostname: "zigbee-bridge.home.lab",label: "Zigbee Bridge",
    type: "Physical",    location: "Rack",                   tags: ["iot", "zigbee"],
    notes: "Sonoff Zigbee 3.0 USB dongle via VM passthrough",  status: "dhcp",
  },
  {
    ip: "192.168.0.90",  hostname: "sonos-kitchen.home.lab",label: "Sonos — Kitchen",
    type: "Physical",    location: "Kitchen",                tags: ["audio", "sonos"],
    notes: "",                                             status: "dhcp",
  },
  {
    ip: "192.168.0.91",  hostname: "sonos-lounge.home.lab", label: "Sonos — Lounge",
    type: "Physical",    location: "Lounge",                 tags: ["audio", "sonos"],
    notes: "",                                             status: "dhcp",
  },
];

// ── Build the data structure the app expects ────────────────────────────────
const entries = IP_DATA.map((d, i) => ({
  id: `entry-${i + 1}`,
  ip: d.ip,
  lastOctet: parseInt(d.ip.split(".")[3]),
  label: d.label,
  hostname: d.hostname,
  type: d.type || "Physical",
  location: d.location || "",
  tags: d.tags || [],
  notes: d.notes || "",
  status: d.status || "static",
  isFree: false,
  isReserved: false,
  createdAt: new Date(Date.now() - Math.random() * 1e10).toISOString(),
  updatedAt: new Date().toISOString(),
}));

const networkConfig = { ...NETWORK };
const networks = [networkConfig];
const ipStore = { "net-1": entries };

// ── Write to localStorage ────────────────────────────────────────────────────
localStorage.setItem("ip-manager-networks",       JSON.stringify(networks));
localStorage.setItem("ip-manager-network-config", JSON.stringify(networkConfig));
localStorage.setItem("ip-manager-ip-data",        JSON.stringify(ipStore));

console.log(`✅ Seeded ${entries.length} entries across Home Lab network. Reloading…`);
setTimeout(() => location.reload(), 800);
