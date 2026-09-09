// ============================================================
//  Pi-hole DHCP lease lookup
//
//  When Pi-hole is the DHCP server it already knows what every device calls
//  itself, because each one supplied a hostname when it took its lease. That
//  turns an unrecognised MAC address in Network Watch into "living-room-hue"
//  without anybody typing anything.
//
//  Entirely optional and off by default: plenty of networks let the router
//  hand out leases, in which case Pi-hole has nothing useful to say.
//
//  ── Session handling is the part worth getting right ──────────────────────
//  Pi-hole v6 replaced the old static API token with session authentication:
//  POST the password to /api/auth, receive a SID with a validity in seconds,
//  then send that SID as X-FTL-SID. Two documented properties make the naive
//  implementation wrong:
//
//    * logins are RATE LIMITED — authenticating on every request will start
//      returning 429
//    * concurrent sessions are CAPPED — leaking a session per request will
//      eventually lock the app out of its own Pi-hole
//
//  So the SID is cached and reused until shortly before it expires, and there
//  is an explicit logout for when the configuration changes.
// ============================================================

'use strict';

const http = require('http');
const https = require('https');

// A lease list from a home network is a few kilobytes. This is a ceiling on a
// response we did not generate, not an expectation.
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 8000;

// Re-authenticate this long before the session actually expires, so a request
// is never issued with a SID that dies in flight.
const SESSION_SAFETY_MARGIN_MS = 30 * 1000;

const DEFAULT_CONFIG = {
  enabled: false,
  url: '',
  password: '',
  verifyTls: true,
};

/**
 * Normalise and validate the base URL.
 *
 * Returns null for anything that is not a plain http(s) origin, so a malformed
 * or hostile value is refused before it reaches the HTTP client rather than
 * being interpolated into a request.
 */
function normaliseBaseUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  // Only prepend a scheme when there is genuinely none. Testing for
  // /^https?:\/\// alone was wrong: "ftp://pi.hole" has a scheme but not a
  // matching one, so it became "http://ftp://pi.hole", which URL happily parses
  // as the host "ftp". A wrong address is bad; a wrong address that looks
  // accepted is worse.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text);
  if (hasScheme && !/^https?:\/\//i.test(text)) return null;

  let parsed;
  try {
    parsed = new URL(hasScheme ? text : `http://${text}`);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;
  // Credentials embedded in the URL would end up in logs; the password field
  // is the supported way to authenticate.
  if (parsed.username || parsed.password) return null;
  const port = parsed.port ? `:${parsed.port}` : '';
  return `${parsed.protocol}//${parsed.hostname}${port}`;
}

// ── Response parsing ────────────────────────────────────────────────────────

/**
 * Pull the session out of an /api/auth response.
 * Returns null rather than throwing, so a surprising body is a failed login
 * rather than a crashed scan.
 */
function parseSession(body) {
  const session = body && body.session;
  if (!session || typeof session.sid !== 'string' || !session.sid) return null;
  const validity = Number(session.validity);
  return {
    sid: session.sid,
    csrf: typeof session.csrf === 'string' ? session.csrf : null,
    // Pi-hole's default is 300s. Treat an absent or absurd value as five
    // minutes rather than trusting it or giving up.
    validitySeconds: Number.isFinite(validity) && validity > 0 && validity < 86400 ? validity : 300,
  };
}

/**
 * Parse /api/dhcp/leases into { mac, ip, hostname } records.
 *
 * Every field is optional as far as this function is concerned: a lease with
 * no hostname is common (a device that did not supply one), and a lease with
 * no MAC is useless but must not break the rest of the list.
 */
function parseLeases(body) {
  const leases = body && Array.isArray(body.leases) ? body.leases : [];
  const out = [];
  for (const lease of leases) {
    if (!lease || typeof lease !== 'object') continue;
    const mac = typeof lease.hwaddr === 'string' ? lease.hwaddr.trim().toLowerCase() : null;
    const ip = typeof lease.ip === 'string' ? lease.ip.trim() : null;
    if (!mac && !ip) continue;
    let hostname = typeof lease.name === 'string' ? lease.name.trim() : '';
    // Pi-hole reports an unnamed lease as "*" or an empty string. Neither is a
    // name, and storing one would make a device look identified when it is not.
    if (!hostname || hostname === '*') hostname = null;
    out.push({
      mac,
      ip,
      hostname: hostname ? hostname.slice(0, 64) : null,
      expires: Number.isFinite(Number(lease.expires)) ? Number(lease.expires) : null,
    });
  }
  return out;
}

/** Index leases by MAC and by IP, so a sighting can be matched either way. */
function indexLeases(leases) {
  const byMac = new Map();
  const byIp = new Map();
  for (const lease of leases || []) {
    if (lease.mac && !byMac.has(lease.mac)) byMac.set(lease.mac, lease);
    if (lease.ip && !byIp.has(lease.ip)) byIp.set(lease.ip, lease);
  }
  return { byMac, byIp };
}

/**
 * Add DHCP hostnames to a set of sightings.
 *
 * Matching prefers MAC, because a lease follows the device rather than the
 * address. Falls back to IP for the case where ARP saw a different MAC form.
 *
 * Pure, and never overwrites a name that came from a better source: mDNS gives
 * a device's own advertised name, which beats a DHCP hostname.
 */
function enrichSightings(sightings, leases) {
  const { byMac, byIp } = indexLeases(leases);
  return (sightings || []).map((sighting) => {
    const mac = sighting.mac ? String(sighting.mac).toLowerCase() : null;
    const lease = (mac && byMac.get(mac)) || (sighting.ip && byIp.get(sighting.ip)) || null;
    if (!lease || !lease.hostname) return sighting;
    return {
      ...sighting,
      hostname: sighting.hostname || lease.hostname,
      dhcpName: lease.hostname,
    };
  });
}

// ── HTTP ────────────────────────────────────────────────────────────────────

function request(baseUrl, path, { method = 'GET', body = null, sid = null, verifyTls = true } = {}) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(path, baseUrl);
    } catch (err) {
      return reject(new Error(`Invalid Pi-hole URL: ${err.message}`));
    }

    const lib = target.protocol === 'https:' ? https : http;
    const payload = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const headers = { Accept: 'application/json' };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = payload.length;
    }
    // The header form is used rather than the cookie form: cookies additionally
    // require a CSRF token, and the query-string form would put the session ID
    // into Pi-hole's own access log.
    if (sid) headers['X-FTL-SID'] = sid;

    const req = lib.request(target, {
      method,
      headers,
      timeout: REQUEST_TIMEOUT_MS,
      // Self-signed certificates are the norm for a LAN service. Verification
      // stays on by default and is only relaxed when the user asks.
      ...(target.protocol === 'https:' && !verifyTls ? { rejectUnauthorized: false } : {}),
    }, (res) => {
      const chunks = [];
      let length = 0;
      res.on('data', (chunk) => {
        length += chunk.length;
        if (length > MAX_RESPONSE_BYTES) {
          req.destroy();
          return reject(new Error('Pi-hole response was unreasonably large'));
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* handled by callers */ }
        resolve({ status: res.statusCode, json, text });
      });
    });

    req.on('timeout', () => { req.destroy(new Error(`Pi-hole did not respond within ${REQUEST_TIMEOUT_MS}ms`)); });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Client ──────────────────────────────────────────────────────────────────

/**
 * A Pi-hole client that holds at most one session.
 *
 * `httpRequest` is injectable so the session lifecycle can be tested without a
 * Pi-hole — which matters, because the interesting behaviour here is *not*
 * re-authenticating, and that is invisible from a single successful call.
 */
function createClient({ httpRequest = request } = {}) {
  let session = null;        // { sid, expiresAt }
  let inFlight = null;       // de-duplicates concurrent logins

  const clearSession = () => { session = null; };

  async function login(config) {
    const base = normaliseBaseUrl(config.url);
    if (!base) throw new Error('Set a valid Pi-hole address, for example http://192.168.0.2');
    if (!config.password) throw new Error('A Pi-hole application password is required');

    const res = await httpRequest(base, '/api/auth', {
      method: 'POST',
      body: { password: config.password },
      verifyTls: config.verifyTls !== false,
    });

    if (res.status === 401) {
      throw new Error('Pi-hole rejected the password. Generate an application password in Pi-hole under Settings → Web interface / API.');
    }
    if (res.status === 429) {
      throw new Error('Pi-hole is rate limiting login attempts. Wait a minute and try again.');
    }
    if (res.status !== 200) {
      throw new Error(`Pi-hole returned HTTP ${res.status} when authenticating`);
    }

    const parsed = parseSession(res.json);
    if (!parsed) throw new Error('Pi-hole authenticated but returned no session id');

    session = {
      sid: parsed.sid,
      expiresAt: Date.now() + parsed.validitySeconds * 1000 - SESSION_SAFETY_MARGIN_MS,
    };
    return session;
  }

  /** Reuse the cached session where possible; log in at most once concurrently. */
  async function ensureSession(config) {
    if (session && Date.now() < session.expiresAt) return session;
    if (!inFlight) {
      inFlight = login(config).finally(() => { inFlight = null; });
    }
    return inFlight;
  }

  async function fetchLeases(config) {
    const base = normaliseBaseUrl(config.url);
    if (!base) throw new Error('Set a valid Pi-hole address, for example http://192.168.0.2');

    const current = await ensureSession(config);
    let res = await httpRequest(base, '/api/dhcp/leases', {
      sid: current.sid,
      verifyTls: config.verifyTls !== false,
    });

    // A session can be invalidated early — Pi-hole restarted, or the session
    // cap evicted ours. One retry with a fresh login, then give up rather than
    // looping against a rate limiter.
    if (res.status === 401) {
      clearSession();
      const renewed = await ensureSession(config);
      res = await httpRequest(base, '/api/dhcp/leases', {
        sid: renewed.sid,
        verifyTls: config.verifyTls !== false,
      });
    }

    if (res.status === 404) {
      throw new Error('This Pi-hole has no DHCP lease endpoint. It is either older than v6, or not acting as your DHCP server.');
    }
    if (res.status === 401) {
      // Still refused after a fresh login. Retrying again would only feed the
      // rate limiter, so stop and say something the user can act on.
      clearSession();
      throw new Error('Pi-hole rejected the session even after re-authenticating. Check the application password.');
    }
    if (res.status !== 200) {
      throw new Error(`Pi-hole returned HTTP ${res.status} for the DHCP leases`);
    }

    return parseLeases(res.json);
  }

  /** Release the session. Called when the configuration changes. */
  async function logout(config) {
    if (!session) return;
    const base = normaliseBaseUrl(config && config.url);
    const sid = session.sid;
    clearSession();
    if (!base) return;
    // Best effort: a failed logout costs Pi-hole one session slot until it
    // times out on its own, which is not worth surfacing.
    try {
      await httpRequest(base, '/api/auth', {
        method: 'DELETE', sid,
        verifyTls: !config || config.verifyTls !== false,
      });
    } catch { /* ignored deliberately */ }
  }

  return {
    login, ensureSession, fetchLeases, logout, clearSession,
    hasSession: () => !!(session && Date.now() < session.expiresAt),
  };
}

module.exports = {
  createClient,
  normaliseBaseUrl,
  parseSession,
  parseLeases,
  indexLeases,
  enrichSightings,
  DEFAULT_CONFIG,
  REQUEST_TIMEOUT_MS,
  SESSION_SAFETY_MARGIN_MS,
};
