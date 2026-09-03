# Two-Factor Authentication

From **v2.8.0** you can add a 6-digit code from an authenticator app to your sign-in.

It is **optional and off by default**. Nothing about your login changes unless you deliberately turn it on.

---

## Should you turn it on?

**Yes, if your instance is reachable from the internet.** Rate limiting slows an attacker down; a second factor stops them outright, even if your password leaks from somewhere else.

**Probably not, if it only ever answers on your LAN.** Anyone who can reach it is already inside your network, and you would be adding friction to every sign-in for very little gain.

API keys are unaffected either way — Home Assistant, scripts and any mobile client carry on exactly as before, because a machine cannot produce a code.

---

## Turning it on

1. Open **Settings → Security**
2. Click **Set up two-factor authentication**
3. Scan the QR code with your authenticator app — Google Authenticator, Aegis, 1Password, Bitwarden, or anything else that handles `otpauth://` links. If you cannot scan, expand **Can't scan?** for the key to type in.
4. Enter the 6-digit code your app shows, to prove it is working
5. **Save the ten recovery codes.** They are shown once and never again.

The verification step in (4) is deliberate: two-factor does not switch on until a code from your app has actually been accepted, so a mis-scanned QR cannot leave you locked out.

---

## Signing in afterwards

Enter your username and password as usual, then the 6-digit code on the next screen. The code changes every 30 seconds; the previous and next one are also accepted, so a slightly wrong clock is not a problem.

A code works **once**. If you sign in and straight back out, wait for the next code rather than reusing the one on screen.

---

## Recovery codes

Ten are generated when you enable two-factor. Each works **once**, entered in the code box instead of an authenticator code.

- Keep them somewhere separate from your password manager — if both are on the same lost phone they are no help
- The number remaining is shown in **Settings → Security**, with a warning at two or fewer
- **New recovery codes** issues a fresh ten and invalidates the old set
- They are stored as bcrypt hashes, so nobody with database access can read them

---

## If you are locked out

Three ways back in, in order of convenience.

### 1. You have a recovery code

Enter it at the sign-in screen where the 6-digit code is asked for. Then go to **Settings → Security** and either re-enrol a new authenticator or generate fresh recovery codes.

### 2. You are already signed in somewhere

**Settings → Security → Turn off**, confirming with your account password.

### 3. You have lost the authenticator *and* the codes

SSH to the server:

```bash
sudo node /opt/ip-manager/scripts/disable-totp.cjs
sudo systemctl restart ip-manager-api
```

Two-factor is removed and you can sign in with your password alone. **Your username, password and all data are untouched** — only the second factor is cleared. The action is recorded in the [activity log](Activity-Log), so it can never happen invisibly.

Anyone able to run that command already has root on the server, so it grants no access they did not already have.

---

## How it works

Standard TOTP, as specified in RFC 6238: SHA-1, 6 digits, a 30-second period. That is the combination every authenticator app supports.

The implementation is about thirty lines on Node's built-in crypto rather than a third-party dependency, and it is verified against the **published RFC 4226 and RFC 6238 test vectors** — all ten HOTP values and all five TOTP timestamps reproduce exactly. That is what guarantees any authenticator app will interoperate with it.

Other details worth knowing:

- Codes are compared in **constant time**, so timing cannot leak information
- A used code is **rejected on replay**, even within its 30-second window
- **Wrong codes count towards the login throttle** — six digits is only a million possibilities and would otherwise be brute-forceable
- The secret is stored in the **application database**, not `credentials.env`. That file has been removed by stray git operations more than once, and losing your second factor alongside it would mean an unnecessary lockout. It is included in your [backups](Backup-and-Restore).
- Enabling, disabling, failed codes and recovery-code use are all recorded in the [activity log](Activity-Log)

---

## Troubleshooting

**"That code did not match" during setup**
Check the authenticator entry says *IP Manager*, and that the server clock is right — `timedatectl` on the LXC. TOTP depends on both ends agreeing on the time.

**Codes suddenly stop working**
Almost always server clock drift. `timedatectl` will show whether NTP is synchronised.

**"That code has already been used"**
Each code works once. Wait for your app to roll to the next one.

**I restored a backup and two-factor came back**
The secret lives in the database, so restoring an older backup restores whatever two-factor state it held. Use a recovery code from that era, or the SSH command above.
