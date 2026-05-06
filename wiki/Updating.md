# Updating

IP Manager can be updated via the **in-app GUI updater** or by running the **update script** directly on the server.

---

## Check the current version

The installed version is shown in **Settings → About**, and in the top of the Settings panel subtitle.

The latest available version is checked automatically and shown in the Settings panel with a **Update Available** banner when a newer release exists.

---

## Method 1: In-app GUI update

1. Open **Settings**
2. If an update is available, click **Update Now**
3. A progress panel shows live output from the update process — fetching, building, restarting
4. The app reloads automatically when the update is complete

> The GUI updater runs the same script as Method 2 under the hood. Progress is streamed live so you can see exactly what's happening.

---

## Method 2: Update script (CLI)

SSH into the LXC container and run:

```bash
ip-manager-update
```

This command is installed globally by the install script. It will:

1. Pull the latest code from GitHub
2. Run any database migrations
3. Install updated dependencies (`npm install`)
4. Rebuild the frontend (`npm run build`)
5. Restart the `ip-manager` service

The update takes 1–3 minutes depending on connection speed.

---

## What the update preserves

- ✅ All your IP entries, networks, tags, notes
- ✅ Domain Tracker data
- ✅ Your credentials (`credentials.env` is not touched by git)
- ✅ App settings and Proxmox configuration
- ✅ The SQLite database

---

## Before updating

It's good practice to [create a backup](Backup-and-Restore) before updating, especially for major version bumps.

---

## Migrating from older versions

### Upgrading from pre-v1.29 (before secure-by-default)

If your install was set up before v1.29, your `credentials.env` file may be empty or tracked by git. The update script handles this automatically:

- If `credentials.env` is tracked by git, it is un-tracked before pulling (so git doesn't conflict with it)
- If `credentials.env` is empty, the server falls back to `admin`/`admin` and forces a password change on next login

### Nginx timeout (pre-v1.28)

Older installs had Nginx configured with a 30-second proxy timeout, which could cause the GUI updater to appear to hang. The update script patches this to 300 seconds automatically.

---

## Troubleshooting updates

**Update appears to hang in the GUI**
- The update may still be running in the background — check via CLI: `journalctl -u ip-manager -f`
- If it genuinely stalled, run `ip-manager-update` from the CLI instead

**Service won't start after update**
```bash
journalctl -u ip-manager -n 50 --no-pager
```
This shows the last 50 lines of service logs. Common causes: missing dependency, port conflict, syntax error in a config file.

**Rolled back / want to revert**
```bash
cd /opt/ip-manager
git log --oneline -10          # find the commit you want to revert to
git checkout <commit-hash>
npm run build
systemctl restart ip-manager
```
