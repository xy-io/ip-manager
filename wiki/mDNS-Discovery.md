# mDNS Discovery

Added in **v2.10.0**.

An ARP sweep finds every device on your subnet, but it can only tell you an IP and a MAC address. mDNS asks a different question — *what do you call yourself?* — and most devices are happy to answer.

**Tools → mDNS Discovery** runs a scan and offers what it hears.

---

## What it finds

Apple devices, HomePods and Apple TVs, Chromecasts and Nest speakers, network printers, NAS boxes, HomeKit accessories, ESPHome nodes, Philips Hue bridges, and any Linux host running Avahi — all announce themselves over multicast DNS without being configured to.

For each one the scan can recover:

| | |
|---|---|
| **Hostname** | `printer.local` → `printer` |
| **Friendly name** | `Study Printer`, `Kitchen HomePod` |
| **Services** | Printer, AirPlay, Chromecast, File share, SSH, Web… |

---

## Applying what it finds

Discovered devices are matched against your inventory by IP. Anything with a blank field that discovery could fill is pre-selected; press **Fill in selected**.

Two rules govern this, both deliberate:

**It only fills blanks.** A name you typed is never replaced. Anything on your network can claim to be called anything, and a device that announces itself as "Router" does not get to rename your router.

**The scan never writes to the server.** Applying suggestions is a local edit, exactly like typing in the table — you review it and press **Save**. Discovery proposes; you decide.

Devices found that are not in your inventory at all are listed and marked, but not added. Use the ARP scan for adding devices; this view is for naming the ones you have.

---

## When nothing is found

An empty result is common and usually not a fault:

- **Multicast does not cross subnets or VLANs.** Only devices on the same broadcast domain as the IP Manager container can answer. If your devices are on a different VLAN, this will find nothing, and that is working as designed.
- **Not everything announces itself.** Windows PCs, most IoT sensors and anything with mDNS disabled will be silent.
- **Some containers block multicast.** The scan falls back to asking for unicast replies, which reduces what it hears but keeps it working.

If you see a warning about the multicast join failing, discovery is running in that reduced mode. It is worth trying, but expect fewer results.

---

## How it works

A one-shot scan, not a background listener. It opens a socket, asks for the standard DNS-SD service list plus about twenty common service types, listens for roughly five seconds, then closes.

That is a deliberate choice. A permanent listener would find slightly more, at the cost of a socket held open for the life of the process and a failure mode nobody would notice — the sort of quiet bug that is worst in something self-hosted.

There is no new dependency. The DNS-SD implementation sits on Node's built-in `dgram`.

### A note on safety

This is the only part of the app that parses unsolicited packets from the local network, which makes it the only part any device on your LAN can send arbitrary bytes to. It is written accordingly:

- Every read is bounds-checked against the buffer before it happens
- Name-compression pointers are followed with a strict budget and must point backwards — a pointer referencing itself is otherwise a two-byte denial of service
- Record counts and name lengths are capped regardless of what a packet's header claims
- A malformed record ends parsing of that packet rather than throwing, so one broken device cannot take discovery down for the network

38 unit tests cover this, most of them malformed and hostile packets rather than the happy path. See [Testing](Testing).

---

## API

| Method | Path | Scope |
|---|---|---|
| `GET` | `/api/mdns/status` | read |
| `POST` | `/api/mdns/scan` | write |

`POST` accepts an optional `timeoutMs` between 1000 and 15000, defaulting to 4000. Both return `suggestions`, each carrying `canFillName` and `canFillHostname` — the server's judgement about what is safe to overwrite. A client should honour those flags rather than applying names unconditionally.

The scan result is held in memory only and is cleared on restart. It is a cache of something the network will happily tell you again, and stale names are worse than none.

See [API](API) for the full reference.
