import React, { useState, useMemo } from 'react';
import { Search, Server, Monitor, Wifi, HardDrive, Camera, Shield, Globe, Filter, X, MapPin, Cpu, Box, CircleDot, ChevronDown, ChevronUp, Copy, Check, Zap, Download, Edit3, Plus, Trash2, Save, AlertCircle } from 'lucide-react';
import * as XLSX from 'xlsx';

// Network configuration
const NETWORK_CONFIG = {
  dhcpStart: 1,
  dhcpEnd: 170,
  staticStart: 171,
  staticEnd: 254,
  fixedInDHCP: [6, 50],
};

// Initial IP address data from the Excel spreadsheet
const initialIpData = [
  { assetName: "Home Assistant", hostname: "homeassistant.the-allens.uk", ip: "192.168.0.6", type: "Virtual", location: "Proxmox1", apps: "Home Assistant" },
  { assetName: "Synology", hostname: "nas.the-allens.uk", ip: "192.168.0.50", type: "Physical", location: "Office", apps: "Synology NAS" },
  { assetName: "Tapo C210 Office camera", hostname: "C210_A186FB.the-allens.uk", ip: "192.168.0.143", type: "Physical", location: "Office", apps: "Camera" },
  { assetName: "Linkwarden", hostname: "linkwarden.the-allens.uk", ip: "192.168.0.170", type: "Virtual", location: "Proxmox2", apps: "Linkwarden" },
  { assetName: "Free", hostname: "", ip: "192.168.0.171", type: "", location: "", apps: "" },
  { assetName: "Free", hostname: "", ip: "192.168.0.172", type: "", location: "", apps: "" },
  { assetName: "Free", hostname: "", ip: "192.168.0.173", type: "", location: "", apps: "" },
  { assetName: "Free", hostname: "", ip: "192.168.0.174", type: "", location: "", apps: "" },
  { assetName: "Free", hostname: "", ip: "192.168.0.175", type: "", location: "", apps: "" },
  { assetName: "Free", hostname: "", ip: "192.168.0.176", type: "", location: "", apps: "" },
  { assetName: "Free", hostname: "", ip: "192.168.0.177", type: "", location: "", apps: "" },
  { assetName: "Free", hostname: "", ip: "192.168.0.178", type: "", location: "", apps: "" },
  { assetName: "Free", hostname: "", ip: "192.168.0.179", type: "", location: "", apps: "" },
  { assetName: "Free", hostname: "", ip: "192.168.0.180", type: "", location: "", apps: "" },
  { assetName: "Free", hostname: "", ip: "192.168.0.181", type: "", location: "", apps: "" },
  { assetName: "Free", hostname: "", ip: "192.168.0.182", type: "", location: "", apps: "" },
  { assetName: "Free", hostname: "", ip: "192.168.0.183", type: "", location: "", apps: "" },
  { assetName: "Free", hostname: "", ip: "192.168.0.184", type: "", location: "", apps: "" },
  { assetName: "Free", hostname: "", ip: "192.168.0.185", type: "", location: "", apps: "" },
  { assetName: "Free", hostname: "", ip: "192.168.0.186", type: "", location: "", apps: "" },
  { assetName: "Free", hostname: "", ip: "192.168.0.187", type: "", location: "", apps: "" },
  { assetName: "Homebridge", hostname: "homebridge.the-allens.uk", ip: "192.168.0.188", type: "Virtual", location: "Proxmox1", apps: "HomeBridge" },
  { assetName: "BRW105BAD1DCB9A", hostname: "", ip: "192.168.0.189", type: "Physical", location: "Office", apps: "Printer DHCP Reservation" },
  { assetName: "Reolink 520 Garden Camera", hostname: "520-garden.the-allens.uk", ip: "192.168.0.190", type: "Physical", location: "Garage", apps: "Camera" },
  { assetName: "Reolink 520 Drive Camera", hostname: "520-drive.the-allens.uk", ip: "192.168.0.191", type: "Physical", location: "Garage", apps: "Camera" },
  { assetName: "Reolink 1212A Side Gate Camera", hostname: "1212-gate.the-allen.uk", ip: "192.168.0.192", type: "Physical", location: "House", apps: "Camera" },
  { assetName: "SLZB-06", hostname: "SLZB-06.the-allens.uk", ip: "192.168.0.193", type: "Physical", location: "Garage", apps: "Zigbee LAN Adaptor" },
  { assetName: "Free", hostname: "", ip: "192.168.0.194", type: "", location: "", apps: "" },
  { assetName: "Free", hostname: "", ip: "192.168.0.195", type: "", location: "", apps: "" },
  { assetName: "maycocklettings-Ghost CLI", hostname: "maycock.the-allens.uk", ip: "192.168.0.196", type: "Virtual", location: "Proxmox2", apps: "Ghost Blog" },
  { assetName: "Ghost[techrant.online]-Docker", hostname: "techrant.online", ip: "192.168.0.197", type: "Virtual", location: "Proxmox3", apps: "Ghost Blog" },
  { assetName: "Pihole 3 DNS (backup)", hostname: "pihole3.the-allens.uk", ip: "192.168.0.198", type: "Virtual", location: "Proxmox6", apps: "Pihole3" },
  { assetName: "Docker2", hostname: "docker2.the-allens.uk", ip: "192.168.0.199", type: "Virtual", location: "Proxmox5", apps: "Docker" },
  { assetName: "DCS", hostname: "dcs.the-allens.uk", ip: "192.168.0.200", type: "Virtual", location: "Proxmox2", apps: "DCS" },
  { assetName: "Uptime Monitor", hostname: "uptime.the-allens.uk", ip: "192.168.0.201", type: "Virtual", location: "Proxmox1", apps: "Uptime" },
  { assetName: "Linux App Server", hostname: "linuxapp.the-allens.uk", ip: "192.168.0.202", type: "Virtual", location: "Proxmox2", apps: "" },
  { assetName: "Tailscale VPN Gateway", hostname: "tailscale.the-allens.uk", ip: "192.168.0.203", type: "Virtual", location: "Proxmox2", apps: "" },
  { assetName: "TruNAS-2", hostname: "truenas-2.the-allens.uk", ip: "192.168.0.204", type: "Virtual", location: "Proxmox5", apps: "TrueNAS" },
  { assetName: "TrueNAS", hostname: "truenas.the-allens.uk", ip: "192.168.0.205", type: "Virtual", location: "Proxmox3", apps: "TrueNAS" },
  { assetName: "Free", hostname: "", ip: "192.168.0.206", type: "", location: "", apps: "" },
  { assetName: "NUT (Rpi)", hostname: "nut.the-allens.uk", ip: "192.168.0.207", type: "Physical", location: "Garage", apps: "NUT" },
  { assetName: "Win-VDI (Windows Production client)", hostname: "https://192.168.0.228:8006/", ip: "192.168.0.208", type: "Virtual", location: "Proxmox2", apps: "" },
  { assetName: "Unifi AC-Lite Access Point", hostname: "", ip: "192.168.0.209", type: "Physical", location: "Garage", apps: "" },
  { assetName: "Unifi FlexHD Access Point", hostname: "", ip: "192.168.0.210", type: "Physical", location: "House", apps: "" },
  { assetName: "Unifi FlexHD Access Point", hostname: "", ip: "192.168.0.211", type: "Physical", location: "Office", apps: "" },
  { assetName: "Unifi Controller", hostname: "unificontroller.the-allens.uk", ip: "192.168.0.212", type: "Virtual", location: "Proxmox1", apps: "" },
  { assetName: "Unifi Flex 2.5G 8-port", hostname: "", ip: "192.168.0.213", type: "Physical", location: "Office", apps: "" },
  { assetName: "Unifi AC-Lite Access Point", hostname: "", ip: "192.168.0.214", type: "Physical", location: "Loft", apps: "" },
  { assetName: "NTFY Notification Service", hostname: "ntfy.the-allens.uk", ip: "192.168.0.215", type: "Virtual", location: "Proxmox3", apps: "NTFY" },
  { assetName: "Tautulli", hostname: "tautulli.the-allens.uk", ip: "192.168.0.216", type: "Virtual", location: "Proxmox2", apps: "Tautulli" },
  { assetName: "Tailscale VPN Exit Node", hostname: "tailscale-exitnode.the-allens.uk", ip: "192.168.0.217", type: "Virtual", location: "Proxmox2", apps: "Tailscale" },
  { assetName: "Zigbee2MQTT", hostname: "zigbee.the-allens.uk", ip: "192.168.0.218", type: "Virtual", location: "Proxmox2", apps: "Zigbee2MQTT" },
  { assetName: "Dupliciti Backup", hostname: "backup.the-allens.uk", ip: "192.168.0.219", type: "Virtual", location: "Proxmox1", apps: "Dupliciti" },
  { assetName: "Radarr", hostname: "radarr.the-allens.uk", ip: "192.168.0.220", type: "Virtual", location: "Proxmox2", apps: "Radarr" },
  { assetName: "Sonarr", hostname: "sonarr.the-allens.uk", ip: "192.168.0.221", type: "Virtual", location: "Proxmox2", apps: "Sonarr" },
  { assetName: "Nzbget", hostname: "nzbget.the-allens.uk", ip: "192.168.0.222", type: "Virtual", location: "Proxmox2", apps: "Nzbget" },
  { assetName: "Bazarr", hostname: "bazarr.the-allens.uk", ip: "192.168.0.223", type: "Virtual", location: "Proxmox2", apps: "Bazarr" },
  { assetName: "Ghost(jayallen.pro)-DOCKER", hostname: "blog.the-allens.uk", ip: "192.168.0.224", type: "Virtual", location: "Proxmox3", apps: "Ghost Blog" },
  { assetName: "Ghost(jayallen.pro)", hostname: "jayallen.pro", ip: "192.168.0.225", type: "Virtual", location: "Proxmox2", apps: "Ghost Blog" },
  { assetName: "readarr", hostname: "readarr.the-allens.uk", ip: "192.168.0.226", type: "Virtual", location: "Proxmox3", apps: "Readarr" },
  { assetName: "Proxmox1 Quanta Host", hostname: "proxmox1.the-allens.uk", ip: "192.168.0.227", type: "Physical", location: "Garage", apps: "Proxmox" },
  { assetName: "Proxmox Beelink Standalone Host", hostname: "proxmox6.the-allens.uk", ip: "192.168.0.228", type: "Physical", location: "Garage", apps: "Proxmox" },
  { assetName: "Proxmox2 Quanta Host", hostname: "proxmox2.the-allens.uk", ip: "192.168.0.229", type: "Physical", location: "Office", apps: "Proxmox" },
  { assetName: "Proxmox5 HP Z440 Server", hostname: "proxmox5.the-allens.uk", ip: "192.168.0.230", type: "Physical", location: "Garage", apps: "Proxmox" },
  { assetName: "Plex", hostname: "plex.the-allens.uk", ip: "192.168.0.231", type: "Virtual", location: "Proxmox1", apps: "Plex" },
  { assetName: "Proxmox Backup Server", hostname: "proxmoxbackup.the-allens.uk", ip: "192.168.0.232", type: "Physical", location: "Office", apps: "Proxmox Backup" },
  { assetName: "Proxmox3 Dell Host", hostname: "proxmox3.the-allens.uk", ip: "192.168.0.233", type: "Physical", location: "Garage", apps: "Proxmox" },
  { assetName: "Dell iDRAC", hostname: "", ip: "192.168.0.234", type: "Physical", location: "Garage", apps: "Dell iDrac" },
  { assetName: "Proxmox4 Whitebox Host", hostname: "proxmox4.the-allens.uk", ip: "192.168.0.235", type: "Physical", location: "Proxmox4", apps: "Proxmox" },
  { assetName: "Docker", hostname: "docker.the-allens.uk", ip: "192.168.0.236", type: "Virtual", location: "Proxmox5", apps: "Docker" },
  { assetName: "NETGEAR ProSAFE Plus Switch 16port", hostname: "", ip: "192.168.0.237", type: "Physical", location: "Office", apps: "" },
  { assetName: "Unifi USW Ultra 60w 8-port", hostname: "", ip: "192.168.0.238", type: "Physical", location: "House", apps: "" },
  { assetName: "Unifi Flex Mini 2.5g 5-port", hostname: "", ip: "192.168.0.239", type: "Physical", location: "Garage", apps: "" },
  { assetName: "D-Link 24port Managed Switch", hostname: "", ip: "192.168.0.240", type: "Physical", location: "Garage", apps: "" },
  { assetName: "Mikrotik 4port 10GBe SFP+ Switch - Garage", hostname: "", ip: "192.168.0.241", type: "Physical", location: "Garage", apps: "" },
  { assetName: "Mikrotik 4port 10GBe SFP+ Switch - Office", hostname: "", ip: "192.168.0.242", type: "Physical", location: "Office", apps: "" },
  { assetName: "nginx", hostname: "nginx.the-allens.uk", ip: "192.168.0.243", type: "Virtual", location: "Proxmox3", apps: "nginx" },
  { assetName: "PiAlert", hostname: "pialert.the-allens.uk", ip: "192.168.0.244", type: "Virtual", location: "Proxmox2", apps: "Pi Alert Scanning" },
  { assetName: "myspeed", hostname: "myspeed.the-allens.uk", ip: "192.168.0.245", type: "Virtual", location: "Proxmox2", apps: "Speedtest" },
  { assetName: "Beszel", hostname: "monitor.the-allens.uk", ip: "192.168.0.246", type: "Virtual", location: "Proxmox3", apps: "Beszel server monitoring" },
  { assetName: "Domain Monitor", hostname: "domainmonitor.the-allens.uk", ip: "192.168.0.247", type: "Virtual", location: "Proxmox3", apps: "Domain Monitoring" },
  { assetName: "Reserved", hostname: "", ip: "192.168.0.248", type: "", location: "", apps: "" },
  { assetName: "Pihole 2 DNS (secondary)", hostname: "pihole2.the-allens.uk", ip: "192.168.0.249", type: "Virtual", location: "Proxmox2", apps: "Pihole2" },
  { assetName: "PiHole DNS", hostname: "pihole.the-allens.uk", ip: "192.168.0.250", type: "Virtual", location: "Proxmox1", apps: "PiHole" },
  { assetName: "Reserved", hostname: "", ip: "192.168.0.251", type: "", location: "", apps: "" },
  { assetName: "Reserved", hostname: "", ip: "192.168.0.252", type: "", location: "", apps: "" },
  { assetName: "Reserved", hostname: "", ip: "192.168.0.253", type: "", location: "", apps: "" },
  { assetName: "OPNsense/Unifi Gateway Max", hostname: "opnsense.the-allens.uk", ip: "192.168.0.254", type: "Virtual", location: "Proxmox", apps: "Firewall" },
];

// Helper functions
const getUniqueValues = (data, key) => {
  const values = [...new Set(data.map(item => item[key]).filter(Boolean))];
  return values.sort();
};

const getServiceIcon = (apps, assetName) => {
  const combined = `${apps} ${assetName}`.toLowerCase();
  if (combined.includes('camera') || combined.includes('reolink') || combined.includes('tapo')) return Camera;
  if (combined.includes('proxmox')) return Server;
  if (combined.includes('docker')) return Box;
  if (combined.includes('pihole') || combined.includes('dns')) return Shield;
  if (combined.includes('nas') || combined.includes('truenas') || combined.includes('synology')) return HardDrive;
  if (combined.includes('unifi') || combined.includes('wifi') || combined.includes('access point')) return Wifi;
  if (combined.includes('ghost') || combined.includes('blog') || combined.includes('nginx')) return Globe;
  if (combined.includes('switch') || combined.includes('mikrotik') || combined.includes('netgear')) return Monitor;
  return Cpu;
};

const getTypeColor = (type) => {
  if (type === 'Virtual') return 'bg-purple-100 text-purple-800 border-purple-200';
  if (type === 'Physical') return 'bg-blue-100 text-blue-800 border-blue-200';
  return 'bg-gray-100 text-gray-500 border-gray-200';
};

const getLocationColor = (location) => {
  const colors = {
    'Garage': 'bg-amber-100 text-amber-800',
    'Office': 'bg-green-100 text-green-800',
    'House': 'bg-sky-100 text-sky-800',
    'Loft': 'bg-rose-100 text-rose-800',
    'Proxmox1': 'bg-indigo-100 text-indigo-800',
    'Proxmox2': 'bg-violet-100 text-violet-800',
    'Proxmox3': 'bg-fuchsia-100 text-fuchsia-800',
    'Proxmox4': 'bg-pink-100 text-pink-800',
    'Proxmox5': 'bg-cyan-100 text-cyan-800',
    'Proxmox6': 'bg-teal-100 text-teal-800',
    'Proxmox': 'bg-slate-100 text-slate-800',
  };
  return colors[location] || 'bg-gray-100 text-gray-600';
};

const isInDHCPRange = (ip) => {
  const lastOctet = parseInt(ip.split('.')[3]);
  return lastOctet >= NETWORK_CONFIG.dhcpStart && lastOctet <= NETWORK_CONFIG.dhcpEnd;
};

const isFixedInDHCP = (ip) => {
  const lastOctet = parseInt(ip.split('.')[3]);
  return NETWORK_CONFIG.fixedInDHCP.includes(lastOctet);
};

const groupIPsIntoRanges = (ips) => {
  if (ips.length === 0) return [];
  const sorted = [...ips].sort((a, b) => parseInt(a.split('.')[3]) - parseInt(b.split('.')[3]));
  const ranges = [];
  let rangeStart = parseInt(sorted[0].split('.')[3]);
  let rangeEnd = rangeStart;

  for (let i = 1; i < sorted.length; i++) {
    const current = parseInt(sorted[i].split('.')[3]);
    if (current === rangeEnd + 1) {
      rangeEnd = current;
    } else {
      ranges.push({ start: rangeStart, end: rangeEnd });
      rangeStart = current;
      rangeEnd = current;
    }
  }
  ranges.push({ start: rangeStart, end: rangeEnd });
  return ranges;
};

// Edit Modal Component
function EditModal({ item, onSave, onClose, onMarkFree, locations, types }) {
  const [formData, setFormData] = useState({
    assetName: item.assetName,
    hostname: item.hostname,
    type: item.type,
    location: item.location,
    apps: item.apps,
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({ ...item, ...formData });
  };

  const isFree = item.assetName === 'Free';
  const isReserved = item.assetName === 'Reserved';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-slate-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-800">
                {isFree ? 'Claim IP Address' : 'Edit IP Entry'}
              </h2>
              <p className="text-sm text-slate-500 font-mono mt-1">{item.ip}</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Asset Name *</label>
            <input
              type="text"
              required
              value={formData.assetName}
              onChange={(e) => setFormData({ ...formData, assetName: e.target.value })}
              placeholder="e.g., My New Container"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Hostname</label>
            <input
              type="text"
              value={formData.hostname}
              onChange={(e) => setFormData({ ...formData, hostname: e.target.value })}
              placeholder="e.g., myserver.the-allens.uk"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-white"
              >
                <option value="">Select type...</option>
                <option value="Virtual">Virtual</option>
                <option value="Physical">Physical</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Location</label>
              <select
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-white"
              >
                <option value="">Select location...</option>
                {locations.map(loc => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
                <option value="__new__">+ Add new location</option>
              </select>
            </div>
          </div>

          {formData.location === '__new__' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">New Location Name</label>
              <input
                type="text"
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                placeholder="e.g., Basement"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Service / Apps</label>
            <input
              type="text"
              value={formData.apps}
              onChange={(e) => setFormData({ ...formData, apps: e.target.value })}
              placeholder="e.g., Docker, Plex, Home Assistant"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors"
            >
              <Save className="w-4 h-4" />
              {isFree ? 'Claim IP' : 'Save Changes'}
            </button>

            {!isFree && !isReserved && (
              <button
                type="button"
                onClick={() => onMarkFree(item.ip)}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-100 hover:bg-rose-200 text-rose-700 font-medium rounded-lg transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Release IP
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

// Main Component
export default function IPAddressManager() {
  // Editable state
  const [ipData, setIpData] = useState(initialIpData);
  const [hasChanges, setHasChanges] = useState(false);

  // UI state
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [showReserved, setShowReserved] = useState(false);
  const [expandedCard, setExpandedCard] = useState(null);
  const [viewMode, setViewMode] = useState('cards');
  const [showFreeIPs, setShowFreeIPs] = useState(false);
  const [copiedIP, setCopiedIP] = useState(null);
  const [editingItem, setEditingItem] = useState(null);

  // Derived data
  const locations = useMemo(() => {
    const fromData = getUniqueValues(ipData, 'location');
    return [...new Set([...fromData, 'Garage', 'Office', 'House', 'Loft', 'Proxmox1', 'Proxmox2', 'Proxmox3', 'Proxmox4', 'Proxmox5', 'Proxmox6'])].sort();
  }, [ipData]);

  const types = useMemo(() => getUniqueValues(ipData, 'type'), [ipData]);

  const freeStaticIPs = useMemo(() => {
    return ipData
      .filter(item => item.assetName === 'Free')
      .map(item => item.ip)
      .sort((a, b) => parseInt(a.split('.')[3]) - parseInt(b.split('.')[3]));
  }, [ipData]);

  const freeIPRanges = useMemo(() => groupIPsIntoRanges(freeStaticIPs), [freeStaticIPs]);

  const filteredData = useMemo(() => {
    return ipData.filter(item => {
      if (!showReserved && item.assetName === 'Reserved') return false;

      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = !searchTerm ||
        item.assetName.toLowerCase().includes(searchLower) ||
        item.hostname.toLowerCase().includes(searchLower) ||
        item.ip.toLowerCase().includes(searchLower) ||
        item.apps.toLowerCase().includes(searchLower) ||
        item.location.toLowerCase().includes(searchLower) ||
        (item.assetName === 'Free' && 'free'.includes(searchLower)) ||
        (item.assetName === 'Free' && 'available'.includes(searchLower));

      const matchesType = !selectedType || item.type === selectedType;
      const matchesLocation = !selectedLocation || item.location === selectedLocation;

      return matchesSearch && matchesType && matchesLocation;
    });
  }, [ipData, searchTerm, selectedType, selectedLocation, showReserved]);

  const stats = useMemo(() => {
    const active = ipData.filter(i => i.assetName !== 'Reserved' && i.assetName !== 'Free');
    const staticAssigned = ipData.filter(i => {
      const lastOctet = parseInt(i.ip.split('.')[3]);
      return lastOctet >= NETWORK_CONFIG.staticStart && lastOctet <= NETWORK_CONFIG.staticEnd &&
             i.assetName !== 'Reserved' && i.assetName !== 'Free';
    });
    return {
      total: ipData.length,
      active: active.length,
      virtual: active.filter(i => i.type === 'Virtual').length,
      physical: active.filter(i => i.type === 'Physical').length,
      reserved: ipData.filter(i => i.assetName === 'Reserved').length,
      freeStatic: freeStaticIPs.length,
      staticAssigned: staticAssigned.length,
      dhcpPoolSize: NETWORK_CONFIG.dhcpEnd - NETWORK_CONFIG.dhcpStart + 1 - NETWORK_CONFIG.fixedInDHCP.length,
    };
  }, [ipData, freeStaticIPs]);

  // Actions
  const clearFilters = () => {
    setSearchTerm('');
    setSelectedType('');
    setSelectedLocation('');
  };

  const copyToClipboard = (ip) => {
    navigator.clipboard.writeText(ip);
    setCopiedIP(ip);
    setTimeout(() => setCopiedIP(null), 2000);
  };

  const handleSaveItem = (updatedItem) => {
    setIpData(prev => prev.map(item =>
      item.ip === updatedItem.ip ? updatedItem : item
    ));
    setHasChanges(true);
    setEditingItem(null);
    setExpandedCard(null);
  };

  const handleMarkFree = (ip) => {
    setIpData(prev => prev.map(item =>
      item.ip === ip
        ? { ...item, assetName: 'Free', hostname: '', type: '', location: '', apps: '' }
        : item
    ));
    setHasChanges(true);
    setEditingItem(null);
    setExpandedCard(null);
  };

  const handleExportExcel = () => {
    // Prepare data for Excel
    const excelData = ipData.map(item => ({
      'AssetName': item.assetName,
      'Hostname': item.hostname,
      'IP Address': item.ip,
      'Virtual/Physical': item.type,
      'Location': item.location,
      'Apps': item.apps,
    }));

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);

    // Set column widths
    ws['!cols'] = [
      { wch: 35 }, // AssetName
      { wch: 35 }, // Hostname
      { wch: 15 }, // IP Address
      { wch: 15 }, // Virtual/Physical
      { wch: 15 }, // Location
      { wch: 25 }, // Apps
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'IP Addresses');

    // Generate filename with date
    const date = new Date().toISOString().split('T')[0];
    const filename = `IP_Addresses_${date}.xlsx`;

    // Download
    XLSX.writeFile(wb, filename);
    setHasChanges(false);
  };

  const hasActiveFilters = searchTerm || selectedType || selectedLocation;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Edit Modal */}
      {editingItem && (
        <EditModal
          item={editingItem}
          onSave={handleSaveItem}
          onClose={() => setEditingItem(null)}
          onMarkFree={handleMarkFree}
          locations={locations}
          types={types}
        />
      )}

      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-800">IP Address Manager</h1>
              <p className="text-sm text-slate-500">Home Network · 192.168.0.0/24</p>
            </div>
            <div className="flex gap-2 items-center">
              {hasChanges && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-sm border border-amber-200">
                  <AlertCircle className="w-4 h-4" />
                  Unsaved changes
                </div>
              )}
              <button
                onClick={handleExportExcel}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors"
              >
                <Download className="w-4 h-4" />
                Download Excel
              </button>
              <button
                onClick={() => setViewMode('cards')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  viewMode === 'cards'
                    ? 'bg-slate-800 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Cards
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  viewMode === 'table'
                    ? 'bg-slate-800 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Table
              </button>
            </div>
          </div>

          {/* Network Overview */}
          <div className="mb-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div className="flex flex-wrap gap-6 text-sm">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" />
                <span className="text-slate-600">
                  <span className="font-medium">DHCP Pool:</span> .1–.170
                  <span className="text-slate-400 ml-1">({stats.dhcpPoolSize} dynamic)</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-emerald-500" />
                <span className="text-slate-600">
                  <span className="font-medium">Static Range:</span> .171–.254
                  <span className="text-slate-400 ml-1">({stats.staticAssigned} assigned, {stats.freeStatic} free)</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-blue-500" />
                <span className="text-slate-600">
                  <span className="font-medium">Fixed in DHCP:</span> .6, .50
                </span>
              </div>
            </div>
          </div>

          {/* Stats Bar */}
          <div className="flex flex-wrap gap-4 mb-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
              <span className="text-slate-600">{stats.active} Active</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-purple-500"></div>
              <span className="text-slate-600">{stats.virtual} Virtual</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-500"></div>
              <span className="text-slate-600">{stats.physical} Physical</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-slate-300"></div>
              <span className="text-slate-600">{stats.reserved} Reserved</span>
            </div>
            <button
              onClick={() => setShowFreeIPs(!showFreeIPs)}
              className={`flex items-center gap-2 px-3 py-1 rounded-full transition-colors ${
                showFreeIPs
                  ? 'bg-emerald-100 text-emerald-800 ring-2 ring-emerald-300'
                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              }`}
            >
              <CircleDot className="w-3 h-3" />
              <span className="font-medium">{stats.freeStatic} Free Static</span>
              {showFreeIPs ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>

          {/* Free Static IPs Panel */}
          {showFreeIPs && (
            <div className="mb-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-emerald-800 flex items-center gap-2">
                  <CircleDot className="w-4 h-4" />
                  {freeStaticIPs.length} Free Static IP Addresses
                  <span className="text-xs font-normal text-emerald-600">(.171–.254 range)</span>
                </h3>
                <span className="text-xs text-emerald-600">Click to claim or copy</span>
              </div>

              {freeStaticIPs.length > 0 ? (
                <>
                  <div className="mb-3 text-sm text-emerald-700">
                    <span className="font-medium">Available ranges: </span>
                    {freeIPRanges.map((range, idx) => (
                      <span key={idx}>
                        {range.start === range.end
                          ? `.${range.start}`
                          : `.${range.start}–.${range.end}`}
                        {idx < freeIPRanges.length - 1 ? ', ' : ''}
                      </span>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
                    {freeStaticIPs.map(ip => {
                      const item = ipData.find(i => i.ip === ip);
                      return (
                        <button
                          key={ip}
                          onClick={() => setEditingItem(item)}
                          className="group px-3 py-1.5 font-mono text-xs rounded-lg transition-all bg-white text-emerald-700 hover:bg-emerald-500 hover:text-white border border-emerald-200 hover:border-emerald-500 flex items-center gap-2"
                        >
                          {ip.replace('192.168.0.', '.')}
                          <Plus className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-3 pt-3 border-t border-emerald-200 flex items-center gap-4">
                    <span className="text-sm text-emerald-700">Quick claim: </span>
                    <button
                      onClick={() => setEditingItem(ipData.find(i => i.ip === freeStaticIPs[0]))}
                      className="flex items-center gap-1 font-mono text-sm font-semibold text-emerald-800 hover:text-emerald-600"
                    >
                      <Plus className="w-4 h-4" />
                      {freeStaticIPs[0]}
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-emerald-700 text-sm">No free static IPs available. Release an IP to make it available.</p>
              )}
            </div>
          )}

          {/* Search and Filters */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search IP, hostname, service, or location..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent text-sm"
              />
            </div>

            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400 text-sm bg-white"
            >
              <option value="">All Types</option>
              {types.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>

            <select
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400 text-sm bg-white"
            >
              <option value="">All Locations</option>
              {locations.map(loc => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>

            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={showReserved}
                onChange={(e) => setShowReserved(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-slate-600 focus:ring-slate-400"
              />
              Show Reserved
            </label>

            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 px-3 py-2 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Results Count */}
      <div className="max-w-7xl mx-auto px-4 py-3">
        <p className="text-sm text-slate-500">
          Showing {filteredData.length} of {showReserved ? ipData.length : stats.active + stats.freeStatic} addresses
          {hasChanges && <span className="ml-2 text-amber-600">• Changes pending export</span>}
        </p>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 pb-8">
        {viewMode === 'cards' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredData.map((item, index) => {
              const Icon = getServiceIcon(item.apps, item.assetName);
              const isExpanded = expandedCard === index;
              const isReserved = item.assetName === 'Reserved';
              const isFree = item.assetName === 'Free';
              const isDHCP = isInDHCPRange(item.ip);
              const isFixed = isFixedInDHCP(item.ip);

              return (
                <div
                  key={item.ip}
                  onClick={() => setExpandedCard(isExpanded ? null : index)}
                  className={`rounded-xl border transition-all ${
                    isFree
                      ? 'bg-emerald-50 border-emerald-300 border-2 cursor-pointer hover:bg-emerald-100'
                      : isReserved
                        ? 'bg-white border-dashed border-slate-200 opacity-60 cursor-pointer'
                        : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-md cursor-pointer'
                  } ${isExpanded ? 'ring-2 ring-slate-400' : ''}`}
                >
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className={`p-2 rounded-lg ${isFree ? 'bg-emerald-200' : isReserved ? 'bg-slate-50' : 'bg-slate-100'}`}>
                        {isFree ? (
                          <CircleDot className="w-5 h-5 text-emerald-600" />
                        ) : (
                          <Icon className={`w-5 h-5 ${isReserved ? 'text-slate-300' : 'text-slate-600'}`} />
                        )}
                      </div>
                      <div className="flex gap-1.5">
                        {isFree && (
                          <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-500 text-white">
                            AVAILABLE
                          </span>
                        )}
                        {!isFree && isDHCP && !isFixed && (
                          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                            DHCP
                          </span>
                        )}
                        {!isFree && isFixed && (
                          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700 border border-blue-200">
                            Fixed
                          </span>
                        )}
                        {!isFree && !isDHCP && item.type && (
                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${getTypeColor(item.type)}`}>
                            {item.type}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mb-2">
                      <div className={`font-mono text-lg font-semibold ${isFree ? 'text-emerald-700' : 'text-slate-800'}`}>{item.ip}</div>
                      <div className={`text-sm ${isFree ? 'text-emerald-600 font-semibold' : isReserved ? 'text-slate-400 italic' : 'font-medium text-slate-700'}`}>
                        {isFree ? 'Available for use' : item.assetName}
                      </div>
                    </div>

                    {isFree && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingItem(item);
                        }}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 rounded-lg text-sm text-white font-medium transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        Claim This IP
                      </button>
                    )}

                    {!isReserved && !isFree && (
                      <>
                        {item.hostname && (
                          <div className="text-xs text-slate-500 font-mono truncate mb-2">
                            {item.hostname}
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2">
                          {item.location && (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${getLocationColor(item.location)}`}>
                              <MapPin className="w-3 h-3" />
                              {item.location}
                            </span>
                          )}
                          {item.apps && (
                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 text-slate-600">
                              {item.apps}
                            </span>
                          )}
                        </div>
                      </>
                    )}

                    {isExpanded && !isFree && (
                      <div className="mt-4 pt-4 border-t border-slate-100">
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <div className="text-slate-400 text-xs uppercase tracking-wide">Type</div>
                            <div className="text-slate-700">{item.type || '—'}</div>
                          </div>
                          <div>
                            <div className="text-slate-400 text-xs uppercase tracking-wide">Location</div>
                            <div className="text-slate-700">{item.location || '—'}</div>
                          </div>
                          <div>
                            <div className="text-slate-400 text-xs uppercase tracking-wide">IP Range</div>
                            <div className="text-slate-700">
                              {isDHCP ? (isFixed ? 'Fixed (DHCP)' : 'DHCP Pool') : 'Static'}
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-400 text-xs uppercase tracking-wide">Service/App</div>
                            <div className="text-slate-700">{item.apps || '—'}</div>
                          </div>
                          <div className="col-span-2">
                            <div className="text-slate-400 text-xs uppercase tracking-wide">Hostname</div>
                            <div className="text-slate-700 font-mono text-xs break-all">{item.hostname || '—'}</div>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              copyToClipboard(item.ip);
                            }}
                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm text-slate-700 transition-colors"
                          >
                            {copiedIP === item.ip ? (
                              <>
                                <Check className="w-4 h-4 text-emerald-600" />
                                <span className="text-emerald-600">Copied!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-4 h-4" />
                                Copy IP
                              </>
                            )}
                          </button>
                          {!isReserved && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingItem(item);
                              }}
                              className="flex items-center justify-center gap-2 px-3 py-2 bg-blue-100 hover:bg-blue-200 rounded-lg text-sm text-blue-700 transition-colors"
                            >
                              <Edit3 className="w-4 h-4" />
                              Edit
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">IP Address</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Asset Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Hostname</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Range</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Location</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Service</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredData.map((item) => {
                    const isReserved = item.assetName === 'Reserved';
                    const isFree = item.assetName === 'Free';
                    const isDHCP = isInDHCPRange(item.ip);
                    const isFixed = isFixedInDHCP(item.ip);
                    return (
                      <tr
                        key={item.ip}
                        className={`transition-colors ${
                          isFree
                            ? 'bg-emerald-50 hover:bg-emerald-100'
                            : isReserved
                              ? 'opacity-50 hover:bg-slate-50'
                              : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="px-4 py-3">
                          <button
                            onClick={() => copyToClipboard(item.ip)}
                            className={`font-mono text-sm font-medium flex items-center gap-2 ${
                              isFree ? 'text-emerald-700 hover:text-emerald-800' : 'text-slate-800 hover:text-emerald-600'
                            }`}
                          >
                            {item.ip}
                            {copiedIP === item.ip && <Check className="w-3 h-3 text-emerald-600" />}
                          </button>
                        </td>
                        <td className={`px-4 py-3 text-sm ${
                          isFree ? 'text-emerald-600 font-semibold' : isReserved ? 'text-slate-400 italic' : 'text-slate-700'
                        }`}>
                          {isFree ? '✓ Available' : item.assetName}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500 max-w-xs truncate">
                          {item.hostname || '—'}
                        </td>
                        <td className="px-4 py-3">
                          {isFree ? (
                            <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-500 text-white">
                              FREE
                            </span>
                          ) : isDHCP ? (
                            isFixed ? (
                              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">
                                Fixed
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">
                                DHCP
                              </span>
                            )
                          ) : (
                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 text-emerald-700">
                              Static
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {item.type && (
                            <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${getTypeColor(item.type)}`}>
                              {item.type}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {item.location && (
                            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getLocationColor(item.location)}`}>
                              {item.location}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">{item.apps || '—'}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => setEditingItem(item)}
                            className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded transition-colors ${
                              isFree
                                ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            {isFree ? <Plus className="w-3 h-3" /> : <Edit3 className="w-3 h-3" />}
                            {isFree ? 'Claim' : 'Edit'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {filteredData.length === 0 && (
          <div className="text-center py-12">
            <Filter className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-700 mb-1">No results found</h3>
            <p className="text-slate-500">Try adjusting your search or filters</p>
          </div>
        )}
      </div>
    </div>
  );
}
