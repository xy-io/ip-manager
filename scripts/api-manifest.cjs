#!/usr/bin/env node
/* ============================================================
 *  API surface manifest
 *
 *  Writes a snapshot of everything a client can observe: every route, every
 *  capability flag, and the served apiVersion.
 *
 *  The committed manifest is what makes an API change *visible in review*.
 *  A test compares the live surface against it, so adding, removing or renaming
 *  a route fails the build until the manifest is regenerated — and regenerating
 *  is the moment the author is forced to ask whether the documentation, the
 *  capability list and the client handover need updating too.
 *
 *    node scripts/api-manifest.cjs           # check, exit 1 on drift
 *    node scripts/api-manifest.cjs --write   # accept the current surface
 * ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'server', 'api-manifest.json');

function currentSurface() {
  const files = [
    path.join(ROOT, 'server', 'index.js'),
    path.join(ROOT, 'server', 'routes', 'domains.js'),
    path.join(ROOT, 'server', 'routes', 'backup.js'),
  ];
  const routes = [];
  for (const file of files) {
    let src;
    try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const pattern = /app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g;
    let m;
    while ((m = pattern.exec(src)) !== null) routes.push(`${m[1].toUpperCase()} ${m[2]}`);
  }

  const index = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  const capBlock = index.slice(index.indexOf('capabilities: {'));
  const capabilities = [...capBlock.slice(0, capBlock.indexOf('},'))
    .matchAll(/^\s*([A-Za-z]+):\s*(true|false)/gm)].map((m) => `${m[1]}: ${m[2]}`);

  return {
    apiVersion: (index.match(/apiVersion:\s*'([^']+)'/) || [])[1] || null,
    routes: routes.sort(),
    capabilities: capabilities.sort(),
  };
}

const surface = currentSurface();

if (process.argv.includes('--write')) {
  fs.writeFileSync(MANIFEST, `${JSON.stringify(surface, null, 2)}\n`);
  console.log(`Wrote ${surface.routes.length} routes and ${surface.capabilities.length} capabilities to server/api-manifest.json`);
  console.log('\nNow confirm, for this change:');
  console.log('  1. wiki/API.md documents any new endpoint');
  console.log('  2. wiki/iOS-Client-Handover.md covers anything a client must know');
  console.log('  3. apiVersion is bumped if the surface changed');
  console.log('  4. the CHANGELOG entry states the API impact');
  process.exit(0);
}

let recorded;
try {
  recorded = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
} catch {
  console.error('No manifest found. Create it with: node scripts/api-manifest.cjs --write');
  process.exit(1);
}

const diff = (label, before, after) => {
  const added = after.filter((x) => !before.includes(x));
  const removed = before.filter((x) => !after.includes(x));
  if (added.length) console.error(`  ${label} added:\n${added.map((x) => `    + ${x}`).join('\n')}`);
  if (removed.length) console.error(`  ${label} removed:\n${removed.map((x) => `    - ${x}`).join('\n')}`);
  return added.length + removed.length;
};

let changes = 0;
changes += diff('routes', recorded.routes || [], surface.routes);
changes += diff('capabilities', recorded.capabilities || [], surface.capabilities);
if (recorded.apiVersion !== surface.apiVersion) {
  console.error(`  apiVersion: ${recorded.apiVersion} -> ${surface.apiVersion}`);
  changes += 1;
}

if (!changes) {
  console.log(`API surface unchanged — ${surface.routes.length} routes, ${surface.capabilities.length} capabilities, apiVersion ${surface.apiVersion}`);
  process.exit(0);
}

console.error('\nThe API surface changed. Before accepting it, confirm:');
console.error('  1. wiki/API.md documents any new endpoint');
console.error('  2. wiki/iOS-Client-Handover.md covers anything a client must know');
console.error('  3. apiVersion is bumped (minor for additive, major for breaking)');
console.error('  4. the CHANGELOG entry states the API impact');
console.error('\nThen: node scripts/api-manifest.cjs --write');
process.exit(1);
