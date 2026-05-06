# First Login & Security

IP Manager is **secure by default** — there is no shared or published default password. A unique random password is generated the first time the server starts and printed at the end of the install script.

---

## Logging in for the first time

1. Open `http://<container-ip>` in your browser
2. Enter the credentials printed at the end of installation
3. You will be taken directly to a **Change Password** screen — this is mandatory and cannot be skipped

> Usernames are **case-insensitive**. Passwords are **case-sensitive**.

---

## Changing your password

On first login the app forces a password change before you can do anything else.

On the Change Password screen:
- Enter your current password (the one from the installer)
- Enter a new password — **minimum 8 characters**
- Confirm the new password
- Click **Change Password**

Once changed, the login screen's "first run" hint disappears and you can log in normally going forward.

---

## Changing your password later

At any time, go to **Settings → Change Password** to update your credentials.

---

## Retrieving a lost password

If you forget your password, reset it directly on the LXC console:

```bash
# Open a shell on the container, then:
nano /opt/ip-manager/server/credentials.env
```

Edit the file to set a new password:

```
IP_MANAGER_USERNAME=admin
IP_MANAGER_PASSWORD=yournewpassword
```

Then restart the service:

```bash
systemctl restart ip-manager
```

Log in with the new credentials and change the password via Settings.

---

## How authentication works

- Credentials are stored in `/opt/ip-manager/server/credentials.env`, outside of git tracking
- Sessions use secure HTTP-only cookies
- If the server detects the credentials are still set to `admin` / `admin`, the entire API is locked down (HTTP 423) except for the change-password endpoint — the app will show a mandatory change-password screen until this is resolved
- There is no multi-user support — IP Manager is designed for single-user home lab use

---

## Security notes

- IP Manager does **not** support HTTPS natively — use a reverse proxy (Nginx, Caddy, Traefik) if you need TLS, especially if exposing beyond your LAN
- The app is intended for use on a trusted local network — do not expose it directly to the internet without TLS and appropriate access controls
