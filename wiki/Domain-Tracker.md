# Domain Tracker

The Domain Tracker lets you monitor domain registration expiry alongside your IP entries — all in one place. It uses IANA RDAP to fetch registrar details, expiry dates, and nameservers automatically. No API keys or third-party services required.

---

## Opening the Domain Tracker

Click **Tools → Domains** in the toolbar. On mobile, tap the Tools menu and select Domains.

---

## Adding a domain

1. Click **Add Domain**
2. Type the domain name (e.g. `example.com`) — subdomains are not supported, root domains only
3. Press Enter or click **Add**

The app will immediately look up the domain via RDAP and show the result. This usually takes 1–3 seconds.

---

## What gets fetched

For each domain, IP Manager retrieves:

| Field | Description |
|---|---|
| **Registrar** | The company the domain is registered with |
| **Expiry date** | When the registration expires |
| **Days until expiry** | Calculated from today |
| **Nameservers** | The authoritative nameservers |
| **Last checked** | When the data was last fetched |

---

## Expiry status colours

Domain cards use a colour-coded left border and badge:

| Colour | Meaning |
|---|---|
| 🟢 Green | More than 60 days until expiry |
| 🟡 Amber | 30–60 days until expiry |
| 🔴 Red | Less than 30 days until expiry, or already expired |
| ⚪ Grey | Expiry date unknown (RDAP lookup failed) |

A red notification dot also appears on the **Tools → Domains** button in the header whenever any domain is within 30 days of expiry.

---

## Automatic refresh

All tracked domains are re-checked automatically **once every 24 hours** in the background. You don't need to do anything to keep the data fresh.

### Manual refresh

To refresh a single domain immediately, click the **↻** button on its card.

---

## Supported TLDs

Domain Tracker uses the **IANA RDAP bootstrap registry**, which covers **1,400+ TLDs** including:

- All legacy TLDs: `.com`, `.net`, `.org`, `.co.uk`, etc.
- New generic TLDs: `.app`, `.dev`, `.io`, `.tech`, `.online`, `.watch`, `.pro`, `.xyz`, and hundreds more
- Country-code TLDs: most ccTLDs that publish RDAP endpoints

Some ccTLDs do not operate public RDAP servers (notably a few older ones). For these, the card will show "Could not fetch RDAP data" — this is a limitation of the TLD's registry, not the app.

---

## Troubleshooting domain lookups

**"Could not fetch RDAP data"**
- The domain's TLD registry may not support RDAP, or their server may be temporarily unavailable
- Try the manual refresh button — transient failures are common
- Some older ccTLDs (e.g. certain `.uk` variants) have non-standard RDAP implementations

**Registrar shown as a number**
- This was a bug in versions prior to v1.31, where the IANA numeric registrar ID was displayed instead of the name. Update to v1.31 or later to fix this.

**Nameservers shown in ALL CAPS**
- Also fixed in v1.31 — nameservers are now normalised to lowercase.

---

## Notes

- Only **root domains** can be tracked (e.g. `example.com`, not `sub.example.com`)
- Domain data is stored in the local SQLite database alongside your IP entries
- Deleting a domain from the tracker does not affect the domain registration itself
