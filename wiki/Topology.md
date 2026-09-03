# Topology & Device History

From **v2.9.0** IP Manager can show how your devices relate to each other, and what each one has been doing.

Both are derived from information the app already holds. There is nothing to configure.

---

## Device history

Expand any IP card. Above the details you will see:

- **When it last responded** to a ping
- **How many times it has dropped** in the last 30 days
- **A timeline** of every status change — went offline, came back, health check failed, health check recovered

Only **transitions** are recorded. A device that simply stays up produces no entries at all, so the timeline is signal rather than noise. Up to 50 events are kept per device.

This is separate from the [Activity Log](Activity-Log), which is a single system-wide list of the most recent 500 events. On a busy network a quiet device's history would scroll out of that; here it does not.

Deleting an entry removes its history too.

> Device history only starts accumulating from v2.9.0 onwards. It cannot show you what happened before you updated.

---

## Topology

**Tools → Topology** draws every device and the links between them.

### What the lines mean

**Solid lines are dependencies** — the ones you set yourself, in the edit modal under *Dependencies*. They point from the dependent device to the thing it needs.

**Dashed lines are hypervisor links**, worked out automatically. If an entry has a Proxmox node recorded, and that node is itself a tracked device, a link is drawn from the guest to its host. You do not have to set this yourself — every LXC and VM depends on the node it runs on, so the link is drawn for you.

From **v2.9.1** the host is matched loosely, because a Proxmox node called `pve-01` is rarely named exactly that in an inventory. All of these match:

| Your entry | Proxmox node |
|---|---|
| `PVE-01` | `pve-01` |
| `pve-01.example.lan` | `pve-01` |
| `Proxmox (pve-01)` | `pve-01` |

If guests reference a node that is **not** in your inventory, the view tells you which one. Add an entry for the hypervisor itself and the links appear.

**Faint dotted lines are gateway links** — every device on a subnet depending on that subnet's router. These are **off by default**: on a large network they turn the diagram into a star with one node in the middle, which is true but tells you nothing. Turn on **Show gateway links** at the top of the view when you want them.

Gateway links are only drawn where one unambiguous router exists on a network — an entry named router, firewall, gateway, OPNsense, pfSense and so on. If two entries look like routers, none is chosen, because a wrong inferred link is worse than no link.

### Grouping

Devices are shown in columns. A device with a hypervisor is grouped under it; everything else is grouped by network.

### Impact analysis

**Click any device** and the view highlights everything that would be affected if it went down — following the chain, not just direct dependants. If your router is a dependency of the NAS, and the NAS is a dependency of Plex, clicking the router highlights both.

Worth a look before rebooting a switch or a hypervisor.

### Getting more out of it

The picture is only as good as the relationships you have recorded. If it looks sparse, add **Dependencies** to a few important entries in the edit modal — start with the things that would take other things down with them: your router, your main switch, your NAS, your hypervisors.

Proxmox-imported guests get their hypervisor link for free, provided the hypervisor is itself an entry in the inventory. If it isn't, adding it is the single change that fills in the most of the diagram.

Turning on **Show gateway links** is the quick way to see something on a network with no dependencies set — but the links it draws are inferred, not recorded, so it is a starting point rather than a substitute for setting real dependencies.

---

## Notes

- Both views are **read-only**. Nothing here changes your data.
- **Free** and **Reserved** placeholder rows are excluded from the topology.
- Dependencies pointing at entries that no longer exist are ignored rather than drawn as dangling links.
- The layout is deterministic — the same devices appear in the same places each time you open it, rather than shuffling on every load.
- Both are available to API clients: `GET /api/topology`, `GET /api/topology/impact/:ip` and `GET /api/ips/:ip/history`. See [API](API).
