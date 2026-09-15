# First Login & Security

IP Manager is **secure by default** — there is no shared or published default password. A unique random password is generated the first time the server starts and printed at the end of the install script.

---

## Logging in for the first time

1. Open `http://<container-ip>` in your browser
2. Enter the credentials printed at the end of installation
3. A fresh installation with a generated password opens the dashboard. A mandatory password-change screen appears only if the server detects the legacy default credentials `admin` / `admin`.

> Usernames are **case-insensitive**. Passwords are **case-sensitive**.

---

## Changing your password

You can change the generated password in Settings. If legacy default credentials are detected, changing them is required before using the rest of the app.

On the Change Password screen:
- Enter your current password (the one from the installer)
- Enter a new password — **minimum 8 characters**
- Confirm the new password
- Click **Change Password**

After changing it, use the new password for subsequent sign-ins.

---

## Changing your password later

At any time, go to **Settings → Change Password** to update your credentials.

---

## Resetting a lost password

Passwords are stored as bcrypt hashes and cannot be read back from the credentials file. If you forget yours, reset it on the LXC console. The following applies to the standard file-based installation; explicit service environment credentials take precedence over this file.

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
systemctl restart ip-manager-api
```

On restart, the file-based plaintext replacement is migrated to a bcrypt hash. Log in with the replacement password, then change it in Settings if needed. Two-factor authentication remains separate: if you also lost your authenticator and recovery codes, follow [Two-Factor Authentication](Two-Factor-Authentication).

---

## How authentication works

- The standard installation stores the username and a bcrypt password hash in `/opt/ip-manager/server/credentials.env`, outside git tracking.
- Sessions use HTTP-only cookies with `SameSite=Strict`; use HTTPS at your reverse proxy to protect traffic in transit.
- Login attempts are throttled after repeated failures. Sessions expire after seven idle days or thirty days in total.
- Optional authenticator-based sign-in is documented in [Two-Factor Authentication](Two-Factor-Authentication). External clients use their own [API keys](API).
- If the server detects the credentials are still set to `admin` / `admin`, the entire API is locked down (HTTP 423) except for the change-password endpoint — the app will show a mandatory change-password screen until this is resolved
- There is no multi-user support — IP Manager is designed for single-user home lab use

---

## Security notes

- IP Manager does **not** support HTTPS natively — use a reverse proxy (Nginx, Caddy, Traefik) if you need TLS, especially if exposing beyond your LAN
- The app is intended for use on a trusted local network — do not expose it directly to the internet without TLS and appropriate access controls
