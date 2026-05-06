# Troubleshooting

Common issues and how to fix them.

---

## Can't log in

**"Invalid username or password"**
- Usernames are case-insensitive but passwords are case-sensitive — double-check the password
- Retrieve your credentials: `cat /opt/ip-manager/server/credentials.env`
- If the file is empty, see [Retrieving a lost password](First-Login#retrieving-a-lost-password)

**Stuck on Change Password screen**
- This appears when the server detects `admin`/`admin` credentials. Enter `admin` as the current password and set a new one.
- If you've already changed your password but still see this screen, check `credentials.env` — the file may be empty or malformed.

---

## App won't load / Nginx 502

The Node.js service may not be running.

```bash
systemctl status ip-manager
systemctl restart ip-manager
journalctl -u ip-manager -n 30 --no-pager
```

If the service keeps crashing, check the logs for the specific error.

**Port conflict** — if something else is using port 3000:
```bash
lsof -i :3000
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
- If many domains are failing simultaneously, the IANA bootstrap cache may be stale — restart the service: `systemctl restart ip-manager`

---

## GUI update hangs

- The update is likely still running — check progress: `journalctl -u ip-manager -f`
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

```bash
# Service status
systemctl status ip-manager

# Live service logs
journalctl -u ip-manager -f

# Last 50 log lines
journalctl -u ip-manager -n 50 --no-pager

# Restart service
systemctl restart ip-manager

# View credentials
cat /opt/ip-manager/server/credentials.env

# Check installed version
cat /opt/ip-manager/package.json | grep version

# Run update manually
ip-manager-update

# Check Nginx
systemctl status nginx
nginx -t
```

---

## Getting help

If you've worked through the above and are still stuck, [open an issue on GitHub](https://github.com/xy-io/ip-manager/issues) with:
- Your IP Manager version (`cat /opt/ip-manager/package.json | grep version`)
- Relevant log output (`journalctl -u ip-manager -n 50 --no-pager`)
- A description of what you expected vs. what happened
