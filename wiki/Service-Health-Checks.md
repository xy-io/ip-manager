# Service Health Checks

Service health checks probe an HTTP or HTTPS endpoint for each IP entry and display the result as a coloured dot alongside the standard ping status.

---

## Status indicators

| Dot colour | Meaning |
|---|---|
| 🟢 Green | Device is reachable (ping) |
| 🔵 Sky blue | Service endpoint is responding (HTTP 2xx) |
| 🟠 Orange | Service endpoint is not responding or returned an error |
| 🔴 Red | Device is unreachable (ping failed) |

A device can be pingable but have its service down (green + orange), or be fully healthy (green + blue).

---

## Enabling a health check

1. Open the **Edit** modal for any IP entry (click the card or row)
2. Scroll to **Health Check URL**
3. Enter the full URL to probe — e.g. `http://192.168.1.10:8096` or `https://192.168.1.20`
4. Click **Save**

The app will begin probing on the next 60-second cycle.

### Port auto-suggest

When you type a service name in the **Service** field, the app suggests a health check URL automatically for 60+ known services:

| Service | Suggested port |
|---|---|
| Home Assistant | 8123 |
| Jellyfin | 8096 |
| Plex | 32400 |
| Portainer | 9000 |
| Proxmox | 8006 |
| Sonarr | 8989 |
| Radarr | 7878 |
| Pi-hole | 80 |
| Vaultwarden | 80 |
| Nextcloud | 443 |
| Grafana | 3000 |
| ... and many more | |

---

## Self-signed certificates

Health checks silently ignore TLS certificate errors. If a service is running on HTTPS with a self-signed or private-CA certificate, it will still show as healthy (sky-blue) as long as it returns a 2xx response.

---

## Refresh interval

Health checks run on the same 60-second cycle as ping monitoring. There is currently no per-entry interval configuration — all checks run together.

---

## Notes

- Health checks are performed **server-side** — the IP Manager server makes the HTTP request, not your browser. This means the URL must be reachable from the LXC container, not just your browser.
- If IP Manager is on the same subnet as your devices, internal IPs work directly.
- Any HTTP response in the 2xx range counts as healthy. Redirects (3xx) are not followed by default — if your service redirects HTTP → HTTPS, use the HTTPS URL directly.
