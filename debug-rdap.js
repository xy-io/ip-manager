#!/usr/bin/env node
// Run on the LXC: node /opt/ip-manager/debug-rdap.js
const https = require('https');
const http = require('http');

const DOMAINS = ['techrant.online', 'greyzone.watch', 'jayallen.pro'];

function fetch(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects <= 0) return reject(new Error('Too many redirects'));
    const lib = url.startsWith('http://') ? http : https;
    console.log(`  → GET ${url}`);
    const req = lib.get(url, { headers: { 'Accept': 'application/rdap+json, application/json' } }, (res) => {
      console.log(`  ← ${res.statusCode} ${res.statusMessage}`);
      console.log(`     headers:`, JSON.stringify(res.headers, null, 2).split('\n').slice(0,10).join('\n'));
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        console.log(`  ↪ redirect to ${next}`);
        return resolve(fetch(next, redirects - 1));
      }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        console.log(`  body length: ${body.length}`);
        console.log(`  body preview: ${body.slice(0, 200)}`);
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function getBootstrap(tld) {
  const res = await fetch('https://data.iana.org/rdap/dns.json');
  const data = JSON.parse(res.body);
  const match = data.services.find(([tlds]) => tlds.includes(tld));
  return match ? match[1][0] : null;
}

(async () => {
  for (const domain of DOMAINS) {
    const tld = domain.split('.').pop();
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Domain: ${domain}  TLD: .${tld}`);
    try {
      const endpoint = await getBootstrap(tld);
      console.log(`RDAP endpoint: ${endpoint}`);
      const url = `${endpoint.replace(/\/?$/, '/')}domain/${domain}`;
      const result = await fetch(url);
      if (result.body.trim()) {
        try {
          const parsed = JSON.parse(result.body);
          const expiry = parsed.events?.find(e => e.eventAction === 'expiration');
          console.log(`  ✓ Parsed OK — expiry: ${expiry?.eventDate || 'not found'}`);
        } catch (e) {
          console.log(`  ✗ JSON parse failed: ${e.message}`);
        }
      } else {
        console.log(`  ✗ Empty body`);
      }
    } catch (err) {
      console.log(`  ✗ Error: ${err.message}`);
    }
  }
})();
