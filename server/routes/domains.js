// ============================================================
//  Domain Tracker routes
//
//  Domain registration data via RDAP (the IANA bootstrap registry), with a
//  daily background refresh and expiry notifications.
// ============================================================

'use strict';

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { getDomains, saveDomains } = require('../lib/domainStore');

module.exports = function registerDomainRoutes(app, deps) {
  const { dbGet, dbSet, recordEvent, requireAuth } = deps;
  // ── Domain Tracker ────────────────────────────────────────────────────────────
  // Tracks domain expirations via RDAP (Registration Data Access Protocol)

  let rdapBootstrap = null; // { services: [[tlds], [urls]], fetchedAt }

  async function getRdapEndpoint(domain) {
    // Fetch IANA RDAP bootstrap data if cache is >24h old
    const now = Date.now();
    if (!rdapBootstrap || (now - rdapBootstrap.fetchedAt) > 24 * 60 * 60 * 1000) {
      try {
        const data = await new Promise((resolve, reject) => {
          https.get('https://data.iana.org/rdap/dns.json', (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
              try {
                resolve(JSON.parse(body));
              } catch (e) {
                reject(e);
              }
            });
          }).on('error', reject);
        });
        rdapBootstrap = { services: data.services || [], fetchedAt: now };
      } catch (err) {
        console.error('[rdap] Failed to fetch bootstrap data:', err.message);
        throw new Error('Could not fetch RDAP bootstrap data');
      }
    }

    // Extract TLD from domain (handle subdomains)
    const parts = domain.toLowerCase().split('.');
    const tld = parts[parts.length - 1];

    // Find matching entry in services array
    for (const service of rdapBootstrap.services) {
      const [tlds, urls] = service;
      if (tlds && tlds.includes(tld) && urls && urls.length > 0) {
        return urls[0];
      }
    }
    throw new Error(`No RDAP endpoint found for TLD: ${tld}`);
  }

  // Fetch a URL following redirects, returning parsed JSON
  function rdapFetch(url, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
      if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
      const lib = url.startsWith('http://') ? http : https;
      lib.get(url, { headers: { 'Accept': 'application/rdap+json, application/json' } }, (res) => {
        // Follow redirects
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          const redirectUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, url).href;
          return resolve(rdapFetch(redirectUrl, maxRedirects - 1));
        }
        if (res.statusCode === 404) {
          res.resume();
          return reject(new Error(`Domain not found in registry (404)`));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} from RDAP server`));
        }
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          const trimmed = body.trim();
          if (!trimmed) return reject(new Error('Empty response from RDAP server'));
          try {
            resolve(JSON.parse(trimmed));
          } catch (e) {
            reject(new Error('Invalid JSON from RDAP server'));
          }
        });
      }).on('error', reject);
    });
  }

  async function rdapLookup(domain) {
    try {
      const endpoint = await getRdapEndpoint(domain);
      const url = `${endpoint.replace(/\/?$/, '/')}domain/${domain.toLowerCase()}`;

      const data = await rdapFetch(url);

      // Parse RDAP response
      let expiry = null;
      let registered = null;
      let nameservers = [];
      let registrar = null;
      let registrarUrl = null;
      let status = [];

      if (data.events) {
        const expiryEvent = data.events.find(e => e.eventAction === 'expiration');
        if (expiryEvent && expiryEvent.eventDate) expiry = expiryEvent.eventDate;

        const regEvent = data.events.find(e => e.eventAction === 'registration');
        if (regEvent && regEvent.eventDate) registered = regEvent.eventDate;
      }

      if (data.nameservers) {
        // Normalize to lowercase
        nameservers = data.nameservers
          .map(ns => (ns.ldhName || ns.unicodeName || '').toLowerCase())
          .filter(Boolean);
      }

      if (data.entities) {
        const registrarEntity = data.entities.find(e => e.roles && e.roles.includes('registrar'));
        if (registrarEntity) {
          // Parse vcardArray for human-readable name (fn) and URL first
          if (registrarEntity.vcardArray && Array.isArray(registrarEntity.vcardArray[1])) {
            const vcard = registrarEntity.vcardArray[1];
            const fnEntry = vcard.find(item => Array.isArray(item) && item[0] === 'fn');
            if (fnEntry && fnEntry[3]) registrar = fnEntry[3];
            const urlEntry = vcard.find(item => Array.isArray(item) && item[0] === 'url');
            if (urlEntry && urlEntry[3]) registrarUrl = urlEntry[3];
          }
          // Fall back to legalName, then handle (which may be a numeric IANA ID)
          if (!registrar) registrar = registrarEntity.legalName || null;
          // Only use handle if it looks like a name (not a pure number)
          if (!registrar && registrarEntity.handle && !/^\d+$/.test(registrarEntity.handle)) {
            registrar = registrarEntity.handle;
          }
        }
      }

      if (data.status) {
        status = data.status;
      }

      return {
        domain,
        registrar: registrar || null,
        registrarUrl: registrarUrl || null,
        expiry,
        registered,
        nameservers,
        status,
        lastChecked: new Date().toISOString(),
      };
    } catch (err) {
      throw new Error(`RDAP lookup failed for ${domain}: ${err.message}`);
    }
  }

  // Domain storage helpers
  // API endpoints for domains
  app.get('/api/domains', requireAuth, (req, res) => {
    // Envelope for consistency with /api/ips and /api/networks.
    res.json({ data: getDomains() });
  });

  app.post('/api/domains', requireAuth, async (req, res) => {
    const { domain } = req.body || {};

    // Basic domain validation
    if (!domain || typeof domain !== 'string' || !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/i.test(domain)) {
      return res.status(400).json({ error: 'Invalid domain format' });
    }

    const domains = getDomains();
    const id = crypto.randomUUID();
    let entry = { id, domain: domain.toLowerCase(), error: null };
    let errorFlag = false;

    try {
      const result = await rdapLookup(domain);
      entry = { ...entry, ...result, error: null };
    } catch (err) {
      errorFlag = true;
      entry = {
        ...entry,
        registrar: null,
        registrarUrl: null,
        expiry: null,
        registered: null,
        nameservers: [],
        status: [],
        lastChecked: new Date().toISOString(),
        error: err.message,
      };
    }

    domains.push(entry);
    saveDomains(domains);
    res.json({ ...entry, errorFlag });
  });

  app.delete('/api/domains/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    let domains = getDomains();
    domains = domains.filter(d => d.id !== id);
    saveDomains(domains);
    res.json({ ok: true });
  });

  app.post('/api/domains/:id/refresh', requireAuth, async (req, res) => {
    const { id } = req.params;
    let domains = getDomains();
    const index = domains.findIndex(d => d.id === id);

    if (index === -1) {
      return res.status(404).json({ error: 'Domain not found' });
    }

    const entry = domains[index];

    try {
      const result = await rdapLookup(entry.domain);
      domains[index] = { ...entry, ...result, error: null };
    } catch (err) {
      domains[index] = {
        ...entry,
        lastChecked: new Date().toISOString(),
        error: err.message,
      };
    }

    saveDomains(domains);
    res.json(domains[index]);
  });

  // Daily auto-refresh of domains
  async function refreshDomainsCache() {
    const domains = getDomains();
    console.log(`[domains] Starting auto-refresh of ${domains.length} domain(s)...`);

    for (let i = 0; i < domains.length; i++) {
      const entry = domains[i];
      try {
        const result = await rdapLookup(entry.domain);
        domains[i] = { ...entry, ...result, error: null };
      } catch (err) {
        domains[i] = {
          ...entry,
          lastChecked: new Date().toISOString(),
          error: err.message,
        };
      }
      // Small delay to avoid hammering the RDAP server
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    saveDomains(domains);

    // Alert once per refresh cycle for anything expiring within 30 days. The
    // cycle runs daily, so this is a daily reminder rather than a per-poll spam.
    try {
      const now = Date.now();
      for (const d of domains) {
        if (!d.expiry) continue;
        const days = Math.ceil((new Date(d.expiry) - now) / 86400000);
        if (days >= 0 && days <= 30) {
          recordEvent({
            type: 'domain.expiring',
            message: `${d.domain} expires in ${days} day${days === 1 ? '' : 's'}`,
            meta: { domain: d.domain, daysUntilExpiry: days, expiry: d.expiry },
          });
        }
      }
    } catch (e) {
      console.warn(`[notify] domain expiry check failed: ${e.message}`);
    }

    console.log('[domains] Auto-refresh complete');
  }

  // Auto-refresh every 24 hours
  const DOMAINS_INTERVAL = 24 * 60 * 60 * 1000;
  setInterval(refreshDomainsCache, DOMAINS_INTERVAL);
};
