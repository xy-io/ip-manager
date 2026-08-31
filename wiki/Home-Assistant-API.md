# Home Assistant API

IP Manager exposes a small read-only JSON API so Home Assistant — or any other automation platform — can pull live network data. It uses its own API key rather than your login, so nothing needs to know your password.

Added in **v1.33.0**. Device status reporting was broken until **v2.0.2** — see [Known issues](#known-issues) below.

---

## Generating an API key

1. Open **Settings → API Keys**
2. Enter a label (e.g. `Home Assistant`), leave the scope as **Read only**, and click **Create key**
3. Copy the key, or use **Copy YAML** to grab a ready-made configuration block with your server's URL already filled in

The key is independent of your login credentials. You can regenerate or revoke it at any time — doing so immediately invalidates the old key but leaves your other keys working.

> **Upgrading from v2.0.x:** your existing key was migrated automatically as a read-only key labelled "Home Assistant". Nothing in your `configuration.yaml` needs to change.

Home Assistant only reads data, so a **read-only** key is the right choice — if it ever leaks it cannot modify anything. See [API](API) for the full endpoint reference and the write endpoints.

> The generated YAML contains your live API key. Treat it like a password: don't paste it into public issues, forums, or screenshots.

---

## Endpoints

All three are read-only `GET` requests. Authenticate with an `X-API-Key` header, or an `?api_key=` query parameter if your client can't set headers.

### `GET /api/ha/summary`

Network overview — the most useful endpoint for dashboard sensors.

```json
{
  "devices_total": 87,
  "devices_online": 71,
  "devices_offline": 16,
  "devices_unknown": 0,
  "networks": 1,
  "domains_total": 11,
  "domains_expiring_soon": 1,
  "domains_expired": 0,
  "updated": "2026-08-05T10:15:00.000Z"
}
```

### `GET /api/ha/devices`

Every tracked entry with its current status.

| Field | Meaning |
|---|---|
| `ip` | IP address |
| `name` | Asset name, falling back to hostname, then IP |
| `hostname` | Hostname, or `null` |
| `type` | Device type, or `null` |
| `network` | Network name, or `null` |
| `tags` | Array of tags |
| `ping` | `online`, `offline`, or `unknown` |
| `health` | Service health check result, or `null` if not enabled |
| `health_code` | HTTP status code from the health check, or `null` |

### `GET /api/ha/domains`

Tracked domains with expiry information. Each entry includes `days_until_expiry` and a `status` of `ok`, `warning`, `critical`, `expired`, or `unknown`.

---

## Home Assistant configuration

Add to `configuration.yaml` or a sensor package file. **Settings → Home Assistant → Copy YAML** generates this for you with the correct URL and key.

```yaml
rest:
  - resource: "https://ipmanager.example.com/api/ha/summary"
    headers:
      X-API-Key: "your-api-key-here"
    scan_interval: 60
    sensor:
      - name: "Network Devices Online"
        value_template: "{{ value_json.devices_online }}"
        unit_of_measurement: "devices"
        icon: mdi:lan-check
      - name: "Network Devices Offline"
        value_template: "{{ value_json.devices_offline }}"
        unit_of_measurement: "devices"
        icon: mdi:lan-disconnect
      - name: "Domains Expiring Soon"
        value_template: "{{ value_json.domains_expiring_soon }}"
        unit_of_measurement: "domains"
        icon: mdi:domain

  - resource: "https://ipmanager.example.com/api/ha/devices"
    headers:
      X-API-Key: "your-api-key-here"
    scan_interval: 60
    sensor:
      - name: "Network Device List"
        value_template: "{{ value_json.count }}"
        unit_of_measurement: "devices"
        json_attributes:
          - devices
```

Restart Home Assistant after adding it and the sensors will appear.

### Example automation

Alert when a device you care about goes offline:

```yaml
automation:
  - alias: "Alert when NAS goes offline"
    trigger:
      - platform: template
        value_template: >
          {{ state_attr('sensor.network_device_list', 'devices')
             | selectattr('ip', 'eq', '192.168.0.50')
             | map(attribute='ping') | first == 'offline' }}
        for: "00:05:00"
    action:
      - service: notify.mobile_app
        data:
          message: "NAS is not responding to ping"
```

---

## Testing from the command line

```bash
curl -H "X-API-Key: your-api-key-here" http://127.0.0.1:3001/api/ha/summary
```

| Response | Meaning |
|---|---|
| `200` with JSON | Working |
| `401 Invalid API key` | The key doesn't match the one stored on the server — copy it again from Settings |
| `503 HA API not enabled` | No key has been generated yet |

---

## Known issues

**Every device reports `unknown` (fixed in v2.0.2)**

Between v1.33.0 and v2.0.1 the endpoints compared ping results against the wrong internal values, so `devices_online` and `devices_offline` always read `0` and every device in `/api/ha/devices` reported `unknown`. Run `ip-manager-update` to get v2.0.2 or later.

If you built automations against these sensors while the bug was present, they will begin reporting real values after updating — worth checking that nothing fires unexpectedly the first time.

---

## Security notes

- The API is **read-only**. There is no endpoint that modifies data.
- The key is stored in the app's database, not in `credentials.env`, and is unrelated to your login.
- From v2.1.0 each client can have its own key, so revoking the phone's key does not disturb Home Assistant.
- The HA endpoints are deliberately exempt from session-cookie authentication so Home Assistant can poll them. They are protected only by the API key — so treat that key as a credential.
- If your instance is reachable from the internet, put it behind a reverse proxy with TLS. The key is sent in a header on every request.
