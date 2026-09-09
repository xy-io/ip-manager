# Network Watch

Added in **v2.11.0**. **Off by default.**

A record of the device identities seen on your network, so you can tell *something I have never seen* from *something that simply changed address*.

It is a separate job from managing an address list, so it gets a separate view. Until you switch it on there is no view, no menu item and no button — the app looks exactly as it did before.

---

## Phase 1: it watches, it does not warn

This release raises **no alerts and sends no notifications**.

That is deliberate rather than unfinished. A monitoring feature that cries wolf gets muted, and a muted alert system is worse than none — it fails silently on the day it matters. So the ledger runs first, you see what it actually records on your network, and only then is it allowed to interrupt you. Alerting is phase 2.

---

## Turning it on

**Settings → Network Watch → Enable Network Watch.**

An **Open Network Watch** button appears as soon as you tick the box — that is the quickest way in.

From then on it lives in the **Tools** menu, alongside Topology and mDNS Discovery. A dot appears on the Tools button when there are unrecognised devices; randomised phone MACs are left out of that count, so it only shows when something is genuinely worth checking.

Populate it either by pressing **Scan now**, or by enabling the background sweep in **Settings → ARP & Presence**, which will feed the ledger on its own schedule.

### If a scan finds nothing

Discovery uses `arp-scan` on the server. If that is missing or lacks permission, the view will say so and name the fix:

```bash
apt-get install arp-scan
setcap cap_net_raw+ep $(which arp-scan)
```

Without it, discovery falls back to the kernel ARP cache — which only sees devices the server has recently talked to, so results will be sparse but not empty. Before **v2.11.2** this failure was silent: the scan reported success with zero devices.

**If you are on v2.11.2 or earlier and scans find nothing even though `arp-scan` is installed and permitted**, that is a separate bug fixed in **v2.11.3**: the sweep passed `--quiet`, which removes the vendor column from arp-scan's output, and the parser discarded every line that lacked it. Update.

The sweep scans each network's **whole subnet**, not only the static range — the static range only affects the new-host banner elsewhere in the app.

---

## What it records

One record per device identity, keyed on MAC address:

| | |
|---|---|
| **MAC address** | The identity itself |
| **Vendor** | Resolved from the IEEE OUI database |
| **Addresses** | The last few IPs it has held, most recent first |
| **Name** | From mDNS, where a scan has found one |
| **First and last seen** | |
| **Sightings** | A count |

Devices are grouped into four categories, which is most of the value:

- **In inventory** — the ledger matched it to an entry you already manage
- **Unrecognised** — a real device that is not in your inventory
- **Randomised** — an address a phone generated, almost certainly a device you already own

A **Proxmox VM** style badge (also QEMU / KVM, Hyper-V, VMware, VirtualBox, Xen, Parallels, Docker) means the MAC prefix belongs to a hypervisor rather than a hardware maker — so the device is a virtual machine. The IEEE registry name is in the tooltip. An unrecognised prefix shows the plain vendor instead: claiming a physical device is a VM would be worse than saying nothing.

A **duplicate ARP reply** badge means more than one reply came back for that address. Usually a host with two interfaces on the same segment, but it is also the shape of ARP spoofing, so it is shown rather than discarded. Once seen it stays, even if a later sweep does not observe it.

---

## Adding a device to your inventory

Added in **v2.15.0**.

Anything marked **not in inventory** has an **Add** button. It opens the normal edit form with what is already known filled in — address, name, MAC, and a type guessed from the vendor — so you only supply what the network could not tell you: location, tags, and whether it matters.

The row flips to *in inventory* as soon as you add it and the **Unrecognised** count drops, so a list of unknowns shrinks visibly as you work through it. The entry is written when you **Save**, like any other change.

If a `Free` placeholder already exists at that address, the form merges onto it rather than replacing it.

There is no "add all" button, deliberately: adding seventeen half-filled entries in one click leaves seventeen rows to tidy up, which is worse than the problem it solves.

---

## Naming unrecognised devices from Pi-hole

Added in **v2.13.0**. **Optional, off by default.**

If Pi-hole is your DHCP server, it already knows what every device calls itself — each one supplied a hostname when it took its lease. Network Watch can use those names, so a row that read `e4:5f:01:aa:bb:cc` becomes `living-room-hue`.

**Settings → Network Watch → Name devices from Pi-hole DHCP.**

You need:

- Your Pi-hole address, e.g. `http://192.168.0.2`
- An **application password**, generated in Pi-hole under *Settings → Web interface / API*

An application password is used rather than your Pi-hole login so it can be revoked independently and works alongside two-factor authentication. **Test connection** reports how many leases were found and how many carry a hostname.

**Leave it off if your router hands out DHCP.** Pi-hole will not have the leases, and this will do nothing for you.

### How names are chosen

A DHCP hostname is a *fallback*, never an override:

1. A name you typed
2. An mDNS name — the device's own advertised name
3. The DHCP hostname
4. The vendor, from the MAC

The DHCP name is recorded separately and shown as a badge, so it is always clear where a name came from. A lease Pi-hole reports as `*` means the device supplied no hostname, and is treated as unnamed rather than as a device called "asterisk".

### Notes

- The password is stored on the server and **never returned to the browser**. Saving another setting does not require re-entering it.
- Pi-hole rate-limits logins and caps concurrent sessions, so the session is cached and reused — twenty lease lookups cost one login.
- A Pi-hole that is unreachable **never fails a scan**. The sweep is useful without it; the failure is shown in the view instead.
- Requires **Pi-hole v6 or later**. Earlier versions have no DHCP lease endpoint, and the view will say so.

### If the connection is refused

`Nothing is listening on 192.168.0.250:80` almost always means the port, not the address. Pi-hole v6 runs its own web server and it is frequently not on port 80 — especially in Docker, or where something else already uses that port.

On the Pi-hole box:

```bash
pihole-FTL --config webserver.port
```

Then include the port in the address, for example `http://192.168.0.250:8080`. From **v2.13.1** the view says this rather than reporting a raw `ECONNREFUSED`.

---

## Your phones are not intruders

Modern iOS and Android generate a **fresh MAC address per network** as a privacy measure. To a tool that only knows MAC addresses, every phone rejoining the WiFi is a brand new device. This is the structural reason Pi.Alert produces the volume of notifications it does, and its answer is a "skip repeated notifications for X hours" setting — a volume knob rather than a fix.

A randomised address is identifiable: the second-least-significant bit of the first octet is the *locally administered* flag, so a second hex digit of `2`, `6`, `A` or `E` means the address was generated rather than burned in.

Network Watch checks that, labels those devices for what they are, and leaves them out of the "unrecognised" count.

On a test network with two phones and one genuinely unknown device, Network Watch reports **one** unrecognised device. A MAC-only tool reports three.

This does mean a determined intruder could set a locally-administered MAC to be filed as a phone. That is a fair trade for phase 1, where nothing is being alerted on anyway, and phase 2's severity grading will use more than the address alone.

---

## Storage

This is the part that was designed most carefully, because a device ledger is exactly the kind of structure that looks fine for a month and fills a disk in a year.

**One row per device, updated in place.** Not a row per connection. Storage is proportional to how many devices you have, not how long the app has been running. A simulated year of scanning every fifteen minutes adds **no records at all** — only the sighting counters tick up.

| Situation | Records | Stored |
|---|---|---|
| A network of 87 devices | 87 | 24 KB |
| The same, plus a year of visitors' phones | 327 | 91 KB |
| A 300-device home lab | 300 | 83 KB |
| At the hard cap | 1000 | 279 KB |
| Every field of every record maxed out | 900 | 508 KB |

On top of that:

- **A cap on identity count** (1000), with eviction when reached — randomised addresses go first, then least recently seen. **A device in your inventory is never evicted**, so a flood of fabricated addresses cannot push your own devices out.
- **Caps inside each record** — at most 5 addresses, 8 services, and 64 characters per name — so one record cannot grow without limit either.
- **A 512 kB ceiling** checked on write, as a backstop for all of the above.

The view shows exactly what it is currently costing.

### Retention

| | Default | Why |
|---|---|---|
| Randomised MACs | 14 days | Transient by construction; keeping them is what fills a disk |
| Real MACs | 180 days | "I have not seen this since April" is worth being able to say |

Both are configurable. Devices in your inventory are exempt from both.

---

## Privacy

A record of every device that has ever joined your network — including guests' phones — is more sensitive than the inventory itself. So:

- **Nothing is written while the feature is off.** Not an empty record: no database row at all.
- **Disabling it deletes the ledger.** Keeping that history for a feature you have switched off is not a defensible default.
- **It is excluded from backups**, which export only your networks and inventory.
- **It is excluded from support bundles**, so sharing diagnostics does not share a list of everyone's devices.
- **Clear the ledger** at any time from Settings.

---

## API

| Method | Path | Scope |
|---|---|---|
| `GET` | `/api/watch/status` | read |
| `GET` | `/api/watch/devices` | read |
| `PUT` | `/api/watch/config` | write |
| `POST` | `/api/watch/scan` | write |
| `POST` | `/api/watch/prune` | write |
| `DELETE` | `/api/watch/ledger` | write |

`/devices` returns an empty list while the feature is off, and `/scan` returns `409`. See [API](API).

---

## What comes next

**Phase 2 — alerting.** Per-device expectations ("this NAS should always be reachable", "this range should be empty"), graded severity, a confirmation count before anything fires, and digest delivery so routine findings arrive as one summary rather than a stream.

**Phase 3 — correlated incidents.** Using the [Topology](Topology) dependency graph so a failed switch produces *one* notification naming the affected devices, rather than one per device.

See [the design document](https://github.com/xy-io/ip-manager/blob/main/wiki/Network-Watch-Design.md) for the reasoning.
