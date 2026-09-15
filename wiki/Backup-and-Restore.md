# Backup & Restore

Verified against **v2.18.0**. IP Manager offers a portable inventory export and optional scheduled backups. A JSON export is not a complete server backup.

## What the JSON backup includes

Both the browser download and scheduled backup contain `version`, `exportedAt`, `networks` and `ipData`:

- Network definitions and the configuration stored in those definitions, including address ranges and reservations.
- IP inventory entries and fields stored on those entries, including names, hostnames, tags, notes, service settings and maintenance flags.

They do **not** export the separate Domain Tracker records, account credentials, API keys, two-factor configuration, notification or cloud-backup configuration, activity log, device-status history, or Network Watch observation ledger. The JSON file is therefore not equivalent to the SQLite database or a full container backup.

## Download an inventory backup

1. Open **Settings → Backup** and find **Backup & Restore**.
2. Click **Download Full Backup (.json)**. Despite the button name, its scope is the networks and inventory described above.
3. Keep the downloaded file somewhere separate from the server.

## Restore an inventory backup

1. Open **Settings → Backup → Backup & Restore**.
2. Click **Restore from Backup…** and choose the JSON file.
3. Review the export date, network count and entry count.
4. Click **Yes, Restore Now**.

Restore replaces the current networks and IP inventory rather than merging them. It does not restore the separate records and settings excluded from the export. Download the current inventory first if you might need to undo the replacement.

## Scheduled backups

Under **Settings → Backup → Scheduled Cloud Backup**, IP Manager can upload the same inventory JSON through **rclone**.

Supported setup options include S3-compatible object storage (such as R2, B2, S3, Wasabi or MinIO), SFTP, a local or mounted network directory, Dropbox and Google Drive. Dropbox and Google Drive require the one-time terminal authentication step shown in the form.

1. If rclone is missing, follow the panel’s installation guidance via **Settings → Updates**.
2. Use **Add / replace remote** to configure a destination, then select that remote.
3. Set its destination path and test the connection.
4. Choose **daily**, **weekly**, or **manual**; set a time and, for weekly backups, a day.
5. Set retention, enable the schedule, and save it.
6. Run a backup manually and check its reported result before relying on the schedule.

Scheduling uses the server’s local time and runs inside the API process. The server must be running and able to reach the destination. Retention removes older matching backup files at that destination. Backup-failure alerts can be configured under [Notifications](Notifications).

Backup destinations receive inventory names, addresses and notes. Use a destination you control and protect its credentials. A local/network destination must already be mounted and writable by the service account.

## Full server recovery

For recovery of the whole installation, use a Proxmox container backup or a consistent backup of the application database **and** its separate configuration files. The default database is `/opt/ip-manager/server/ip-manager.db`, not `server/data.db`.

A database backup contains more state than the portable inventory export, but credentials and rclone configuration also live in files outside it. Protect `/opt/ip-manager/server/credentials.env` and `/opt/ip-manager/server/rclone.conf` separately when present. Preserve any deployment-specific environment configuration too.

Do not copy only a live SQLite `.db` file and assume it is complete: pending writes can be in its WAL file. Use a consistent container snapshot or SQLite’s backup facility. For example, with the `sqlite3` utility installed and an existing protected backup directory:

```bash
sqlite3 /opt/ip-manager/server/ip-manager.db ".backup '/path/to/backup/ip-manager.db'"
```

A raw database is restored at the server level, with the service stopped and correct file ownership; it cannot be uploaded through the JSON restore dialog. Test full recovery on a separate installation before relying on it.
