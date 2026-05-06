# Backup & Restore

IP Manager stores everything in a local SQLite database. You can export a full backup as a single JSON file at any time and restore it on any machine.

---

## What's included in a backup

- All networks and their configuration (subnet, DHCP range, static range, DNS resolver)
- All IP entries — names, types, services, tags, notes, icons, health check URLs
- DHCP reservations
- Domain Tracker entries
- Change history
- App settings

---

## Creating a backup

1. Click **Tools → Backup & Restore** (or the download icon in the toolbar)
2. Click **Download Backup**
3. A `.json` file is downloaded to your browser — keep this somewhere safe

> Back up before every update, before making large changes, or on a regular schedule. The backup file is human-readable JSON.

---

## Restoring from a backup

1. Open **Tools → Backup & Restore**
2. Click **Restore from File**
3. Select your `.json` backup file
4. Confirm the restore

> ⚠️ Restoring **replaces all current data**. There is no merge — the restore is a full overwrite. Make a fresh backup before restoring if you want to keep your current data.

---

## Migrating to a new machine

1. Create a backup on the old machine (see above)
2. Install IP Manager on the new machine ([Installation](Installation))
3. Log in and complete the first-run password change
4. Go to **Tools → Backup & Restore → Restore from File**
5. Upload the backup from the old machine

Everything will be exactly as you left it.

---

## Automatic backups

IP Manager does not currently schedule automatic backups. Consider:

- A cron job on the LXC host to copy `/opt/ip-manager/server/data.db` to a backup location
- A Proxmox backup of the entire LXC container (recommended — captures everything)

### Manual database backup via CLI

```bash
cp /opt/ip-manager/server/data.db /path/to/backup/data-$(date +%Y%m%d).db
```

The SQLite `.db` file and the JSON export are equivalent — either can be used for disaster recovery. The JSON export is more portable (works across versions); the raw `.db` file is faster for same-version restores.
