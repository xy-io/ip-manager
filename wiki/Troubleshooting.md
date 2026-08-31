# Troubleshooting

Common issues and how to fix them.

---

## Can't log in

**"Invalid username or password"**
- Usernames are case-insensitive but passwords are case-sensitive — double-check the password
- Check your **username** with `cat /opt/ip-manager/server/credentials.env`. From v2.0.0 onwards the password in that file is a bcrypt hash (`$2a$12$…`) and **cannot be read back** — that is deliberate. Only the username is legible.
- If you have lost the password, see [Retrieving a lost password](First-Login#retrieving-a-lost-password)

**Can't log in immediately after upgrading to v2.0.0**
- This is a known defect in v2.0.0 only, fixed in v2.0.1. The upgrade hashed an already-hashed password, so no password could match.
- Fix: run `ip-manager-update` to get v2.0.1 or later. On the next restart the problem is detected and fresh credentials are generated and written to the journal:
  ```bash
  journalctl -u ip-manager-api | grep -A5 "double-hash recovery"
  ```
- Log in with those credentials, then set your own password in **Settings**.

**Stuck on Change Password screen**
- This appears when the server detects `admin`/`admin` credentials. Enter `admin` as the current password and set a new one.
- If you've already changed your password but still see this screen, check `credentials.env` — the file may be empty or malformed.

---

## Home Assistant sensors show 0 or "unknown"

**Every device reports `unknown`, and `devices_online` / `devices_offline` are always `0`**
- A defect present from v1.33.0 to v2.0.1: the HA endpoints compared ping results against the wrong values, so nothing ever matched. Fixed in **v2.0.2** — run `ip-manager-update`.

**All HA endpoints return 401**
- The API key you are sending does not match one stored on the server. Open **Settings → API Keys** and copy the current key, or create a new one and update your `configuration.yaml`.
- Confirm the key works: `curl -H "X-API-Key: YOUR_KEY" http://127.0.0.1:3001/api/ha/summary`

**All HA endpoints return 503**
- No API key has been generated yet. Open **Settings → API Keys** and create one.

**A key returns 403 on a write**
- The key is read-only. Change its scope in **Settings → API Keys**, or use a read & write key.

**A key returns 400 on a write**
- Writes must send the key in the `X-API-Key` header, not as an `?api_key=` query parameter. Query strings are recorded in Nginx access logs, so keys sent that way end up on disk in plain text.

See [Home Assistant API](Home-Assistant-API) for sensor setup and [API](API) for the full endpoint reference.

---

## App won't load / Nginx 502

The Node.js service may not be running.

```bash
systemctl status ip-manager-api
systemctl restart ip-manager-api
journalctl -u ip-manager-api -n 30 --no-pager
```

If the service keeps crashing, check the logs for the specific error.

**Port conflict** — the API listens on port 3001:
```bash
lsof -i :3001
```

---

## Ping dots not updating

- Check that `fping` is installed: `which fping`
- The server pings on a 60-second cycle — wait at least a minute after loading
- Ensure the IP Manager server can reach the devices being pinged (same subnet, no firewall blocking ICMP)

---

## ARP scan finds nothing

- `arp-scan` must be installed: `which arp-scan`
- The LXC container needs to be on the same broadcast domain as your devices
- Try running manually: `arp-scan --localnet` — if this works but the app doesn't, check the app logs
- Some Proxmox bridge configurations isolate LXC containers — ensure the bridge is set to promiscuous mode or that the container has the correct network interface

---

## Proxmox import fails

**"Connection refused" or "Unauthorized"**
- Verify the Proxmox host IP and port (default: 8006)
- Check your API token has at least read-only access (`VM.Audit`, `Datastore.Audit`)
- Ensure the IP Manager container can reach Proxmox: `curl -k https://<proxmox-ip>:8006`

**No VMs/containers appear**
- The API token must have access to the correct node or cluster
- Confirm the token is not expired in Proxmox → Datacenter → Permissions → API Tokens

---

## Domain Tracker: "Could not fetch RDAP data"

- Some TLDs don't publish public RDAP servers — this is a registry limitation, not a bug
- Try refreshing — transient failures are common
- Check if the IANA bootstrap is reachable from the server: `curl https://data.iana.org/rdap/dns.json`
- If many domains are failing simultaneously, the IANA bootstrap cache may be stale — restart the service: `systemctl restart ip-manager-api`

---

## GUI update hangs

- The update is likely still running — check progress: `journalctl -u ip-manager-api -f`
- If genuinely stuck, run the update manually: `ip-manager-update`
- Pre-v1.28 installs had a 30-second Nginx timeout; the update script patches this, but if you're upgrading from a very old version you may need to run the update from CLI the first time

---

## Service health checks always show orange

- The health check URL must be reachable **from the LXC container**, not from your browser
- Test from the container: `curl -k <your-health-check-url>`
- If the service redirects HTTP → HTTPS, use the HTTPS URL directly in the health check field
- Check there's no firewall rule blocking the container from reaching that IP/port

---

## Icons not loading

Icons are fetched from the selfh.st CDN. If icons don't load:
- Check the container has outbound internet access: `curl https://cdn.jsdelivr.net`
- Some corporate or filtered networks block CDN traffic — icons will fall back to Lucide vector icons in this case

---

## Useful commands

The service is named **`ip-manager-api`**.

```bash
# Service status
systemctl status ip-manager-api

# Live service logs
journalctl -u ip-manager-api -f

# Last 50 log lines
journalctl -u ip-manager-api -n 50 --no-pager

# Restart service
systemctl restart ip-manager-api

# View username (the password is a bcrypt hash from v2.0.0 onwards)
cat /opt/ip-manager/server/credentials.env

# Check installed version
grep version /opt/ip-manager/package.json

# Run update manually
ip-manager-update

# Verify the install end-to-end (add --read-only to skip the write tests)
cd /opt/ip-manager && SMOKE_USER=yourname SMOKE_PASS='yourpassword' node scripts/smoke-test.cjs

# Check Nginx
systemctl status nginx
nginx -t
```

---

## Getting help

If you've worked through the above and are still stuck, [open an issue on GitHub](https://github.com/xy-io/ip-manager/issues) with:
- Your IP Manager version (`grep version /opt/ip-manager/package.json`)
- Relevant log output (`journalctl -u ip-manager-api -n 50 --no-pager`)
- The output of the [smoke test](Testing) — it identifies most problems in one run
- A description of what you expected vs. what happened

The quickest way to gather all of this is **Settings → Support → Download support bundle**, which packages system info, service status, and recent logs into a single file.

> **Before sharing a support bundle**, open it and check the log section. On a recently installed server it can still contain the generated startup password.
