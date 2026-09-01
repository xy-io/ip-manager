# Activity Log

From **v2.2.0** IP Manager keeps a system-level record of what has happened: who signed in, what changed, and when. Find it in **Settings → Activity**.

This is distinct from the per-entry change history you reach from an individual IP card. That records *what* changed about one device; this records *everything that happened to the system*, including events with no entry attached — sign-ins, API key changes, configuration updates.

---

## What is recorded

| Category | Events |
|---|---|
| **Sign-in** | Successful sign-ins, failed attempts (with the attempted username and source address), password and username changes |
| **API keys** | Keys created, regenerated, renamed, revoked — with the label and scope |
| **Entries** | Individual entries created, updated or deleted through the API, including which fields changed |
| **Devices** | Devices going offline and coming back, health checks failing and recovering |
| **Config** | Network configuration changes, notification settings changes |

Each entry records the event type, a readable message, a timestamp, and the **actor** — either `session` for something done through the web UI, `key:<label>` for something done with an API key, or `system` for automatic events like a device going offline.

Where a request is involved, the source address is recorded too.

---

## Retention

The most recent **500 events** are kept. Older ones are discarded automatically — there is no growth to manage, and no separate log file to rotate.

The log lives in the application database, so it is included in your [backups](Backup-and-Restore).

**Clear** empties it. That action is itself recorded, so a cleared log is not silently indistinguishable from an empty one.

---

## Reading it

Filter by category using the buttons at the top. Event types are colour-coded — red for failed sign-ins, orange for something going down, green for recovery.

Timestamps are shown relative ("14m ago"); hover for the exact time.

---

## Security notes

The log contains the usernames people tried to sign in with and the addresses they came from. That is exactly what makes it useful after a suspicious event, and exactly why it is protected:

- **Session-only.** An API key cannot read the activity log, regardless of scope. Neither can it clear it.
- It is included in database backups, so treat a backup file as containing this information.
- It is *not* included in the support bundle.

If your instance is reachable from the internet, the sign-in filter is the quickest way to see whether anyone is trying the door. Enable the `auth.login.failed` [notification](Notifications) if you want to be told at the time rather than finding out later.

---

## API

`GET /api/audit-log?limit=100&type=auth` returns recent entries, newest first, optionally filtered by type prefix. `DELETE /api/audit-log` clears it. Both require a browser session — see [API](API).
