// ============================================================
//  Pi-hole client tests
//
//  The behaviour that matters here is what does NOT happen: the client must
//  not authenticate on every request. Pi-hole rate-limits logins and caps
//  concurrent sessions, so a client that logs in each time works perfectly in
//  a single manual test and then locks the app out in production.
//
//  A fake transport records every call, which is the only way to assert an
//  absence.
// ============================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  createClient, normaliseBaseUrl, parseSession, parseLeases, indexLeases,
  enrichSightings, SESSION_SAFETY_MARGIN_MS,
} = require('../lib/pihole');

// A transport that answers like Pi-hole v6 and records what it was asked.
function fakePihole({ validity = 300, failLoginWith = null, leases = null, expireAfter = null } = {}) {
  const calls = [];
  let issued = 0;
  let liveSids = new Set();

  const transport = async (base, path, opts = {}) => {
    calls.push({ path, method: opts.method || 'GET', sid: opts.sid || null });

    if (path === '/api/auth' && (opts.method || 'GET') === 'POST') {
      if (failLoginWith) return { status: failLoginWith, json: null };
      issued += 1;
      const sid = `sid-${issued}`;
      liveSids.add(sid);
      return { status: 200, json: { session: { valid: true, sid, csrf: 'csrf', validity } } };
    }

    if (path === '/api/auth' && opts.method === 'DELETE') {
      liveSids.delete(opts.sid);
      return { status: 204, json: null };
    }

    if (path === '/api/dhcp/leases') {
      if (!liveSids.has(opts.sid)) return { status: 401, json: null };
      // Evict only the FIRST session, the way a Pi-hole restart or the session
      // cap would. An earlier version expired every session, which made a
      // correct single retry look like an infinite loop.
      if (expireAfter !== null && opts.sid === 'sid-1'
          && calls.filter((c) => c.path === '/api/dhcp/leases').length > expireAfter) {
        liveSids.delete(opts.sid);
        return { status: 401, json: null };
      }
      return {
        status: 200,
        json: {
          leases: leases || [
            { expires: 1752678469, hwaddr: '7c:b2:7d:88:0f:11', ip: '192.168.0.31', name: 'windows-pc' },
            { expires: 1752678470, hwaddr: 'b8:27:eb:00:11:22', ip: '192.168.0.120', name: 'living-room-hue' },
          ],
        },
      };
    }
    return { status: 404, json: null };
  };

  return { transport, calls, loginCount: () => calls.filter((c) => c.path === '/api/auth' && c.method === 'POST').length };
}

const CONFIG = { enabled: true, url: 'http://192.168.0.2', password: 'app-password', verifyTls: true };

// ── URL handling ────────────────────────────────────────────────────────────

test('a bare host is accepted and normalised', () => {
  assert.equal(normaliseBaseUrl('192.168.0.2'), 'http://192.168.0.2');
  assert.equal(normaliseBaseUrl('  pi.hole  '), 'http://pi.hole');
  assert.equal(normaliseBaseUrl('https://pi.hole:8443/admin'), 'https://pi.hole:8443');
});

test('anything that is not a plain http origin is refused', () => {
  for (const bad of ['', null, undefined, 'file:///etc/passwd', 'ftp://pi.hole', 'not a url', '://']) {
    assert.equal(normaliseBaseUrl(bad), null, `should refuse ${JSON.stringify(bad)}`);
  }
});

test('credentials embedded in the URL are refused', () => {
  // They would end up in logs; the password field is the supported route.
  assert.equal(normaliseBaseUrl('http://admin:secret@pi.hole'), null);
});

// ── Response parsing ────────────────────────────────────────────────────────

test('a session is parsed from the documented shape', () => {
  const s = parseSession({ session: { valid: true, sid: 'abc=', csrf: 'x', validity: 300 } });
  assert.equal(s.sid, 'abc=');
  assert.equal(s.validitySeconds, 300);
});

test('a missing or absurd validity falls back to five minutes', () => {
  assert.equal(parseSession({ session: { sid: 'a' } }).validitySeconds, 300);
  assert.equal(parseSession({ session: { sid: 'a', validity: -1 } }).validitySeconds, 300);
  assert.equal(parseSession({ session: { sid: 'a', validity: 999999 } }).validitySeconds, 300);
});

test('a response with no session yields null rather than throwing', () => {
  for (const body of [null, {}, { session: {} }, { session: { sid: '' } }, 'nonsense']) {
    assert.equal(parseSession(body), null);
  }
});

test('leases parse into mac, ip and hostname', () => {
  const leases = parseLeases({
    leases: [{ expires: 1752678469, hwaddr: '7C:B2:7D:88:0F:11', ip: '172.30.0.11', name: 'windows' }],
  });
  assert.equal(leases.length, 1);
  assert.deepEqual(leases[0], { mac: '7c:b2:7d:88:0f:11', ip: '172.30.0.11', hostname: 'windows', expires: 1752678469 });
});

test('an unnamed lease reports no hostname rather than a placeholder', () => {
  // Pi-hole uses "*" for a device that supplied no hostname. Storing that
  // would make an unidentified device look identified.
  const leases = parseLeases({ leases: [
    { hwaddr: 'aa:bb:cc:dd:ee:01', ip: '10.0.0.1', name: '*' },
    { hwaddr: 'aa:bb:cc:dd:ee:02', ip: '10.0.0.2', name: '' },
    { hwaddr: 'aa:bb:cc:dd:ee:03', ip: '10.0.0.3' },
  ] });
  assert.equal(leases.length, 3);
  for (const l of leases) assert.equal(l.hostname, null);
});

test('malformed lease lists do not throw', () => {
  assert.deepEqual(parseLeases(null), []);
  assert.deepEqual(parseLeases({}), []);
  assert.deepEqual(parseLeases({ leases: 'not an array' }), []);
  assert.deepEqual(parseLeases({ leases: [null, 42, {}] }), []);
});

test('a hostname is truncated rather than stored whole', () => {
  const leases = parseLeases({ leases: [{ hwaddr: 'aa:bb:cc:dd:ee:01', ip: '10.0.0.1', name: 'n'.repeat(500) }] });
  assert.ok(leases[0].hostname.length <= 64);
});

// ── Enrichment ──────────────────────────────────────────────────────────────

test('a DHCP hostname is attached by MAC', () => {
  const leases = parseLeases({ leases: [{ hwaddr: 'b8:27:eb:00:11:22', ip: '192.168.0.120', name: 'living-room-hue' }] });
  const [out] = enrichSightings([{ mac: 'B8:27:EB:00:11:22', ip: '192.168.0.120' }], leases);
  assert.equal(out.dhcpName, 'living-room-hue');
  assert.equal(out.hostname, 'living-room-hue');
});

test('a lease is matched by IP when the MAC does not line up', () => {
  const leases = parseLeases({ leases: [{ hwaddr: 'ff:ff:ff:ff:ff:fe', ip: '192.168.0.77', name: 'printer' }] });
  const [out] = enrichSightings([{ mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.0.77' }], leases);
  assert.equal(out.dhcpName, 'printer');
});

test('an mDNS name is not replaced by a DHCP hostname', () => {
  // mDNS is the device's own advertised name and is the better label.
  const leases = parseLeases({ leases: [{ hwaddr: 'b8:27:eb:00:11:22', ip: '10.0.0.5', name: 'generic-dhcp-name' }] });
  const [out] = enrichSightings([{ mac: 'b8:27:eb:00:11:22', ip: '10.0.0.5', hostname: 'kitchen-homepod' }], leases);
  assert.equal(out.hostname, 'kitchen-homepod', 'the better name must win');
  assert.equal(out.dhcpName, 'generic-dhcp-name', 'but the DHCP name is still recorded');
});

test('a sighting with no matching lease is returned untouched', () => {
  const [out] = enrichSightings([{ mac: 'aa:bb:cc:dd:ee:ff', ip: '10.0.0.9' }], []);
  assert.equal(out.dhcpName, undefined);
  assert.equal(out.hostname, undefined);
});

test('enrichSightings does not mutate its input', () => {
  const sightings = [{ mac: 'b8:27:eb:00:11:22', ip: '10.0.0.5' }];
  const snapshot = JSON.stringify(sightings);
  enrichSightings(sightings, parseLeases({ leases: [{ hwaddr: 'b8:27:eb:00:11:22', ip: '10.0.0.5', name: 'x' }] }));
  assert.equal(JSON.stringify(sightings), snapshot);
});

test('leases index by both MAC and IP', () => {
  const { byMac, byIp } = indexLeases(parseLeases({ leases: [{ hwaddr: 'aa:bb:cc:dd:ee:01', ip: '10.0.0.1', name: 'a' }] }));
  assert.ok(byMac.has('aa:bb:cc:dd:ee:01'));
  assert.ok(byIp.has('10.0.0.1'));
});

// ── Session lifecycle — the point of the whole module ───────────────────────

test('repeated lease fetches reuse one session', async () => {
  const pihole = fakePihole();
  const client = createClient({ httpRequest: pihole.transport });
  for (let i = 0; i < 20; i += 1) await client.fetchLeases(CONFIG);
  assert.equal(pihole.loginCount(), 1,
    `expected a single login for 20 fetches, got ${pihole.loginCount()} — Pi-hole rate limits logins`);
});

test('concurrent fetches do not each start their own login', async () => {
  const pihole = fakePihole();
  const client = createClient({ httpRequest: pihole.transport });
  await Promise.all(Array.from({ length: 10 }, () => client.fetchLeases(CONFIG)));
  assert.equal(pihole.loginCount(), 1, 'a burst must not open ten sessions');
});

test('an expired session is renewed exactly once', async () => {
  // Validity below the safety margin means the cached session is always
  // considered stale, which is the shape of a session that expires mid-use.
  const pihole = fakePihole({ validity: Math.floor(SESSION_SAFETY_MARGIN_MS / 1000) - 1 });
  const client = createClient({ httpRequest: pihole.transport });
  await client.fetchLeases(CONFIG);
  await client.fetchLeases(CONFIG);
  assert.equal(pihole.loginCount(), 2, 'each stale session should trigger one fresh login');
});

test('a session invalidated by Pi-hole is retried once, not endlessly', async () => {
  const pihole = fakePihole({ expireAfter: 1 });
  const client = createClient({ httpRequest: pihole.transport });
  await client.fetchLeases(CONFIG);
  const leases = await client.fetchLeases(CONFIG);   // must succeed via one retry
  assert.ok(Array.isArray(leases), 'the retry should have returned leases');
  assert.ok(pihole.loginCount() <= 2, `retry must be bounded, saw ${pihole.loginCount()} logins`);
});

test('a wrong password produces an actionable message and no session', async () => {
  const pihole = fakePihole({ failLoginWith: 401 });
  const client = createClient({ httpRequest: pihole.transport });
  await assert.rejects(() => client.fetchLeases(CONFIG), /application password/i);
  assert.equal(client.hasSession(), false);
});

test('rate limiting is reported as rate limiting', async () => {
  const pihole = fakePihole({ failLoginWith: 429 });
  const client = createClient({ httpRequest: pihole.transport });
  await assert.rejects(() => client.fetchLeases(CONFIG), /rate limiting/i);
});

test('a Pi-hole that is not the DHCP server says so', async () => {
  const transport = async (base, path, opts = {}) => {
    if (path === '/api/auth' && opts.method === 'POST') {
      return { status: 200, json: { session: { sid: 's', validity: 300 } } };
    }
    return { status: 404, json: null };
  };
  const client = createClient({ httpRequest: transport });
  await assert.rejects(() => client.fetchLeases(CONFIG), /not acting as your DHCP server|older than v6/i);
});

test('logging out releases the session so the cap is not leaked', async () => {
  const pihole = fakePihole();
  const client = createClient({ httpRequest: pihole.transport });
  await client.fetchLeases(CONFIG);
  assert.equal(client.hasSession(), true);
  await client.logout(CONFIG);
  assert.equal(client.hasSession(), false);
  assert.ok(pihole.calls.some((c) => c.path === '/api/auth' && c.method === 'DELETE'), 'expected a logout call');
});

test('a failed logout does not throw into the caller', async () => {
  const client = createClient({ httpRequest: async (b, p, o) => {
    if (p === '/api/auth' && o.method === 'POST') return { status: 200, json: { session: { sid: 's', validity: 300 } } };
    if (o.method === 'DELETE') throw new Error('network gone');
    return { status: 200, json: { leases: [] } };
  } });
  await client.fetchLeases(CONFIG);
  await client.logout(CONFIG);   // must not reject
  assert.equal(client.hasSession(), false);
});

test('a missing password is refused before any request is made', async () => {
  const pihole = fakePihole();
  const client = createClient({ httpRequest: pihole.transport });
  await assert.rejects(() => client.fetchLeases({ ...CONFIG, password: '' }), /password is required/i);
  assert.equal(pihole.calls.length, 0, 'nothing should have been sent');
});

test('an invalid address is refused before any request is made', async () => {
  const pihole = fakePihole();
  const client = createClient({ httpRequest: pihole.transport });
  await assert.rejects(() => client.fetchLeases({ ...CONFIG, url: 'nope://x' }), /valid Pi-hole address/i);
  assert.equal(pihole.calls.length, 0);
});

test('the session id travels in a header, never in the query string', async () => {
  const pihole = fakePihole();
  const client = createClient({ httpRequest: pihole.transport });
  await client.fetchLeases(CONFIG);
  const fetch = pihole.calls.find((c) => c.path === '/api/dhcp/leases');
  assert.ok(fetch.sid, 'the SID should be passed for the header');
  assert.ok(!fetch.path.includes('sid='), 'a SID in the URL would be written to Pi-hole access logs');
});
