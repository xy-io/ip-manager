# Security Policy

## Supported Versions

Only the latest release of IP Address Manager receives security updates.

| Version | Supported |
|---------|-----------|
| Latest  | ✅        |
| Older   | ❌        |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report security concerns privately by emailing: **xyio-dev@protonmail.com**

Include as much detail as you can:
- A description of the vulnerability and its potential impact
- Steps to reproduce
- Any suggested fix, if you have one

You can expect an acknowledgement within 48 hours and a resolution or update within 14 days depending on severity.

## Scope

This project is designed for **self-hosted, private network use** (typically on a home lab LXC container behind a firewall). It is not intended to be exposed to the public internet. With that context in mind, the following are in scope:

- Authentication bypass or session hijacking
- SQL injection or data exfiltration via the API
- Remote code execution via any endpoint
- Privilege escalation on the host system

The following are **out of scope**:
- Attacks that require physical access to the host
- Issues only exploitable by an already-authenticated admin user
- Denial of service against a single self-hosted instance

## Security Considerations for Deployment

- Change the default credentials (`admin` / `admin`) immediately after installation via **Settings → Account**
- Do not expose port 80 directly to the internet — keep the app behind your firewall or a VPN (e.g. Tailscale)
- The API server listens on `127.0.0.1:3001` and is only accessible via the Nginx proxy — do not change this
- rclone credentials stored in `server/rclone.conf` are mode `600` and owned by `www-data`
