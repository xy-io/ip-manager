# Notifications

From **v2.2.0** IP Manager can push an alert when something on your network changes — a device drops off, a health check starts failing, a domain is about to expire. It sends directly to [ntfy](https://ntfy.sh) or any webhook endpoint, so Home Assistant is not required.

Configure it in **Settings → Notifications**.

---

## Choosing a destination

### ntfy

The simplest option. Pick a topic name, point the app at it, and install the ntfy app on your phone.

```
https://ntfy.sh/my-ipmanager-alerts-7fx2
```

Alerts arrive as plain-text push notifications titled "IP Manager", with high priority for anything actually broken.

> Choose a **hard-to-guess topic name**. On the public ntfy.sh server, anyone who knows your topic can read your alerts — and they contain device names and IP addresses. A random suffix is enough. Self-hosting ntfy avoids the issue entirely.

### Webhook

Any endpoint that accepts a JSON `POST`:

```json
{
  "type": "device.offline",
  "message": "NAS (192.168.0.50) is offline",
  "meta": { "ip": "192.168.0.50", "consecutiveFailures": 2 },
  "timestamp": "2026-08-05T10:15:00.000Z",
  "source": "ip-manager"
}
```

Useful for Discord or Slack relays, n8n, Node-RED, or your own script.

---

## Testing before enabling

**Send test** delivers a message using the saved URL regardless of whether notifications are switched on, so you can confirm delivery first. If nothing arrives:

- Check the URL is exactly right, including `https://`
- Confirm the server itself can reach it — the request comes from the LXC, not your browser: `curl -d "test" https://ntfy.sh/your-topic`
- Look at the service log: `journalctl -u ip-manager-api -f` shows `[notify]` lines for failures

---

## Events

| Event | Fires when |
|---|---|
| `device.offline` | A tracked device stops responding to ping |
| `device.online` | A device that was offline comes back |
| `health.down` | A service health check starts failing |
| `health.up` | A failing health check recovers |
| `domain.expiring` | A tracked domain is within 30 days of expiry |
| `backup.failed` | A scheduled cloud backup fails |
| `update.completed` | An app update finishes |
| `auth.login.failed` | A failed sign-in attempt |

Each can be switched on or off independently. By default, `device.offline`, `health.down`, `domain.expiring` and `backup.failed` are on — the four that mean something is wrong.

`auth.login.failed` is off by default. Turn it on if your instance is reachable from the internet and you want to know about attempts against it, but expect noise if it is publicly exposed.

---

## Flap protection

Pings run every 60 seconds and a single dropped packet is common, especially over wifi. Alerting on the first missed ping would be unusable.

So a device must fail **a number of consecutive cycles** before `device.offline` fires — two by default, which is roughly two minutes. Set it between 1 and 10 in Settings.

The alert fires **once**, not every cycle, and only sends again after the device has recovered and gone down a second time. Recovery sends a single `device.online` message.

Health checks have no such delay. A health check is a deliberate HTTP probe of a service you nominated, so a single failure is already meaningful.

After a server restart the first ping cycle is used purely to establish a baseline — otherwise everything that happened to be switched off would alert at once.

---

## Domain expiry

The domain refresh runs every 24 hours, and anything within 30 days of expiry raises `domain.expiring` on each pass. That makes it a daily reminder rather than a one-off you might miss.

---

## Privacy

Alerts contain device names, IP addresses, and domain names. That is inherent — an alert saying "something is offline" would be useless. But it means the destination should be one you control or trust:

- The message body goes to whatever URL you configure; IP Manager does not filter it
- On public ntfy.sh, topic names are the only access control
- Use `https://` so the alert is encrypted in transit
- Only a signed-in user can change the destination — an API key cannot, whatever its scope, so a leaked key cannot be used to redirect your alerts

---

## Troubleshooting

**Nothing arrives, no errors in the log**
The event may not be enabled, or notifications may be off entirely. Check both, then use **Send test**, which bypasses those toggles.

**`[notify] delivery failed: getaddrinfo ENOTFOUND`**
The server cannot resolve the hostname. Check DNS inside the container.

**`[notify] ntfy responded 403`**
The topic requires authentication, or your ntfy server has access control enabled.

**Too many alerts**
Raise the consecutive-cycle threshold, or turn off `device.online` so recoveries are silent.

**A device alerts every night**
Something is going to sleep. Either raise the threshold or take that device out of ping monitoring.
