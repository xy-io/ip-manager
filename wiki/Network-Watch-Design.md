# Network Watch — design proposal

> **Status: proposed, not built.** Working name. This document exists to settle the design before any code is written.

An opt-in monitoring layer that answers the question Pi.Alert answers — *is there something on my network that should not be there?* — but answers it with everything IP Manager already knows, rather than with a MAC address alone.

**Off by default.** Nothing changes for an existing install until it is switched on in Settings.

---

## Why not just clone Pi.Alert

Pi.Alert keeps a ledger of MAC addresses and alerts when it sees one it has not seen before. That is the whole model. It works, and it produces a well-documented amount of noise, for two structural reasons:

**It has one signal.** A MAC address is either in the ledger or it is not. There is no way to express "this is my phone with a new random MAC" or "this is a NAS that has never moved in three years and just changed vendor" — both are simply *new*.

**iOS and Android randomise their MAC per network.** Every phone rejoin can present as a brand new device. Pi.Alert's mitigation is a "skip repeated notifications for X hours" setting: a volume knob, not a fix. It does not detect that the address is randomised, though this is trivially checkable — the second-least-significant bit of the first octet is the locally-administered flag, so a second hex digit of `2`, `6`, `A` or `E` means the address is not a real burned-in one.

IP Manager is in a different position, because it has been told what the network is *supposed* to look like.

---

## The idea

**Pi.Alert asks "is this MAC new?". Network Watch asks "does this contradict what I know?"**

Five capabilities follow from that, and none of them are available to a tool that only has a MAC ledger.

### 1. Correlated incidents, not individual events

This is the headline, and the reason the feature is worth building at all.

When a switch fails and thirty devices stop responding, Pi.Alert sends thirty notifications. IP Manager knows the dependency graph — it shipped in v2.9.0 — so it can send **one**:

> **Switch offline.** 30 dependent devices affected: NAS, Plex, 3 cameras, …

The impact analysis already exists and is already tested. Grouping alerts by root cause is mostly a matter of asking it before dispatching rather than after.

*Depends on:* dependency links being recorded. Weak on an inventory where nobody has filled them in — which makes the v2.9.1 automatic hypervisor links more valuable than they first appeared, since they populate the graph without anyone doing anything.

### 2. Identity by correlation, not by MAC

A device is not "unknown" because its MAC is new. It is unknown because *nothing* about it matches anything on record.

Signals available to correlate, all of which the app already collects:

| Signal | Source |
|---|---|
| MAC address | ARP scan |
| Vendor | `oui-data`, already bundled |
| mDNS name and advertised services | v2.10.0 |
| Hostname | DNS PTR lookup |
| IP and subnet position | inventory |
| Proxmox guest identity | Proxmox sync |

A phone presenting a fresh random MAC but the same mDNS name, same vendor and same advertised services is obviously the same phone. Pi.Alert cannot reach that conclusion. This is the single largest quality difference, and it removes most of the noise at source rather than suppressing it after the fact.

**Caveat:** correlation is heuristic. It must present as *"this looks like your existing iPhone"* and be overridable, never as a silent merge. A wrong merge hides a real intruder, which is the one failure this feature cannot afford.

### 3. Expectations, not just changes

Because the inventory records intent, expectations can be stated per device or per range, and an alert fires only when reality contradicts one:

- *This device should always be reachable* — a NAS going quiet matters; a laptop going quiet does not
- *This range should be empty* — an unknown device in the static range is worth waking up for; one in the DHCP pool is Tuesday
- *This device's MAC should never change* — a new MAC on a fixed-IP server is the shape of ARP spoofing

Pi.Alert has one global notion of "always connected". This is per-device and derived from data already present.

### 4. Behavioural baseline

Device history (v2.9.0) records what normal looks like for each device. A device up 100% of the time for sixty days going offline is a real event. A laptop up 30% of the time going offline is not news. Pi.Alert treats the two identically.

*Depends on:* accumulated history. Useless for the first couple of weeks after enabling, and the UI should say so rather than appearing broken.

### 5. Graded severity instead of a single "changed"

| Observation | Severity | Why |
|---|---|---|
| Unknown device in static range | **High** | Should not be possible |
| New MAC on a known fixed IP | **High** | Consistent with spoofing |
| Vendor change on a known device | **High** | Consistent with impersonation |
| Rogue DHCP server responding | **High** | Breaks the network, hard to diagnose by hand |
| Unknown device in DHCP pool | Low | A visitor's phone |
| Known device on a new IP | Low | A lease renewal |
| Randomised MAC, otherwise unrecognised | Info | Logged, never notified |

---

## Notification policy

The test any alert must pass: **if it fires, you should get up and look.** Anything weaker teaches you to mute the channel, and a muted alert system is worse than none — it fails silently on the day it matters.

Rules that follow:

1. **Off by default**, opt in per severity.
2. **Randomised MACs never notify.** Visible in the UI, absent from the notification channel.
3. **Confirmation before alerting** — seen in *N* consecutive scans, reusing the `minOfflineCycles` flap-guard pattern that already works for ping.
4. **Digest by default; instant only for High.** One "3 new devices today" beats three interruptions.
5. **Self-silencing.** Anything that alerts repeatedly is suppressed automatically, and says so *once*, rather than continuing until the user mutes everything.
6. **Grouped by root cause** — see capability 1.

---

## What this needs that does not exist yet

**A persistent device ledger.** The only real architectural addition. MACs are captured during discovery today but live in `discoveryState.lastResults` — in memory, lost on restart. The ledger records first seen, last seen, observed IPs, vendor, and correlation signals per identity.

Design constraints:

- **Growth.** Randomised MACs accumulate junk indefinitely. Needs a pruning policy — expire randomised identities that have not been seen in *N* days — decided up front, not bolted on.
- **Size.** At 87 devices this is trivial. It should still be capped, like the audit log and device history before it.
- **Privacy.** A ledger of every device that has ever joined the network, including guests' phones, is more sensitive than anything the app currently stores. It must be excluded from support bundles by the existing redaction path.

---

## Suggested phasing

Separate releases, so a failure is unambiguous — the same discipline used for the v2.5.0 split.

| Phase | Content |
|---|---|
| **1** | Device ledger, randomised-MAC detection, identity correlation. No alerting at all — just a Network Watch view showing what is out there. Proves the data before anything can wake anyone up. |
| **2** | Expectations, graded severity, confirmation counts, digest delivery. Alerting switched on, still opt-in. |
| **3** | Dependency-grouped incidents, behavioural baselining. The capabilities that need phases 1 and 2 to exist first. |
| **Later** | Rogue DHCP detection — useful and self-contained, but a separate scanning mechanism with its own risks. |

---

## Deliberately excluded

- **Pi-hole DNS log and dnsmasq lease scraping.** Real value, but it means reading another application's files and tracking its format. IP Manager integrates with Pi-hole over supported interfaces; this would not be one.
- **Feature parity with NetAlertX.** The active successor to Pi.Alert has a plugin system, many scan backends and a team. Chasing it produces a worse copy of a maintained app. The goal here is a smaller feature that is better at the part that matters.
