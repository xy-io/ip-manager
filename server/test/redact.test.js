// ============================================================
//  lib/redact.js — support bundle secret redaction
//
//  The bundle is the thing users paste into issues and send to whoever is
//  helping them. Anything that leaks here leaks publicly.
// ============================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { redactSecrets } = require('../lib/redact');

test('redacts the generated first-run credentials block', () => {
  const journal = [
    '═══════════════════════════════════════════════════════════════',
    ' IP Manager — initial credentials (change after first login):',
    '   username : admin',
    '   password : rSxeXR0RSb9flrNX',
    ' Saved to: /opt/ip-manager/server/credentials.env',
  ].join('\n');
  const out = redactSecrets(journal);
  assert.ok(!out.includes('rSxeXR0RSb9flrNX'), 'password must not survive');
  assert.ok(out.includes('[redacted]'));
  assert.ok(out.includes('username : admin'), 'the username is not a secret');
});

test('redacts environment-style credential assignments', () => {
  const out = redactSecrets('IP_MANAGER_PASSWORD=hunter2\nIP_MANAGER_USERNAME=Jay');
  assert.ok(!out.includes('hunter2'));
  assert.ok(out.includes('IP_MANAGER_USERNAME=Jay'), 'the username line is left alone');
});

test('redacts bcrypt hashes wherever they appear', () => {
  const hash = '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8I9dVsEm0abcdefghij';
  assert.equal(hash.length, 60, 'test fixture should be a realistic bcrypt hash');
  const out = redactSecrets(`stored hash is ${hash} for user Jay`);
  assert.ok(!out.includes(hash));
  assert.ok(out.includes('[redacted-hash]'));
});

test('redacts API keys and bearer tokens echoed into logs', () => {
  const out = redactSecrets([
    'X-API-Key: j8yOb1sp9Q8Skhh2pQEYvv69uBz5fDqK',
    'Authorization: Bearer abc123.def456-ghi789',
    'api_key = j8yOb1sp9Q8Skhh2pQEYvv69uBz5fDqK',
  ].join('\n'));
  assert.ok(!out.includes('j8yOb1sp9Q8Skhh2pQEYvv69uBz5fDqK'));
  assert.ok(!out.includes('abc123.def456-ghi789'));
});

test('leaves ordinary log lines untouched', () => {
  const lines = [
    '[proxmox-sync] No changes detected',
    '[ping] 87 hosts checked, 71 up',
    'IP Manager API listening on 127.0.0.1:3001',
    'Database: /opt/ip-manager/server/ip-manager.db',
  ].join('\n');
  assert.equal(redactSecrets(lines), lines);
});

test('handles empty and missing input without throwing', () => {
  assert.equal(redactSecrets(''), '');
  assert.equal(redactSecrets(null), null);
  assert.equal(redactSecrets(undefined), undefined);
});

test('redaction is case-insensitive on field names', () => {
  const out = redactSecrets('Password: secret1\nPASSWORD = secret2\ntoken: secret3');
  for (const s of ['secret1', 'secret2', 'secret3']) {
    assert.ok(!out.includes(s), `${s} should be redacted`);
  }
});
