// ============================================================
//  lib/apikeys.js — key storage and scope enforcement
//
//  Runs against a throwaway database via DB_PATH, so the real one is never
//  touched. The scope rules here are what stop a read-only key writing and a
//  leaked key being used from a URL that ends up in access logs.
// ============================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Point the store at a temp database before anything requires lib/db.
const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ipm-keys-')), 'test.db');
process.env.DB_PATH = tmpDb;

const keys = require('../lib/apikeys');

const makeKey = (label, scope) => {
  const entry = {
    id: `${label}-id`,
    label,
    key: keys.generateApiKey(),
    scope,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };
  keys.setApiKeys([...keys.getApiKeys(), entry]);
  return entry;
};

const req = (method, headers = {}, query = {}) => ({ method, headers, query });

test('the temp database is used, never the real one', () => {
  assert.ok(fs.existsSync(tmpDb), 'DB_PATH override should have created the temp database');
  assert.ok(!tmpDb.includes('ip-manager/server/ip-manager.db'));
});

test('generateApiKey produces long, unique, URL-safe keys', () => {
  const a = keys.generateApiKey();
  const b = keys.generateApiKey();
  assert.notEqual(a, b);
  assert.ok(a.length >= 32, 'keys should carry real entropy');
  assert.match(a, /^[A-Za-z0-9_-]+$/, 'keys must be URL-safe');
});

test('an unknown key is rejected with 401', () => {
  makeKey('reader', 'read');
  const outcome = keys.checkApiKey(req('GET', { 'x-api-key': 'not-a-real-key' }));
  assert.equal(outcome.ok, false);
  assert.equal(outcome.status, 401);
  assert.ok(outcome.message, 'errors must carry a human-readable message');
});

test('no key at all returns null so the caller can fall back to a session', () => {
  assert.equal(keys.checkApiKey(req('GET')), null);
});

test('a read key may read', () => {
  const entry = makeKey('read-ok', 'read');
  const outcome = keys.checkApiKey(req('GET', { 'x-api-key': entry.key }));
  assert.equal(outcome.ok, true);
  assert.equal(outcome.key.label, 'read-ok');
});

test('a read key may not write, and gets 403 rather than 401', () => {
  const entry = makeKey('read-only', 'read');
  for (const method of ['POST', 'PATCH', 'DELETE', 'PUT']) {
    const outcome = keys.checkApiKey(req(method, { 'x-api-key': entry.key }));
    assert.equal(outcome.ok, false, `${method} must be refused`);
    assert.equal(outcome.status, 403, `${method} must be 403 (valid key, wrong scope), not 401`);
  }
});

test('a write key may both read and write', () => {
  const entry = makeKey('writer', 'write');
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    assert.equal(keys.checkApiKey(req(method, { 'x-api-key': entry.key })).ok, true, `${method} should be allowed`);
  }
});

test('a key in the query string may read but never write', () => {
  const entry = makeKey('query-key', 'write');
  assert.equal(keys.checkApiKey(req('GET', {}, { api_key: entry.key })).ok, true,
    'query parameter is allowed for reads, for clients that cannot set headers');

  const write = keys.checkApiKey(req('POST', {}, { api_key: entry.key }));
  assert.equal(write.ok, false);
  assert.equal(write.status, 400, 'writes via query string must be refused — they land in access logs');
});

test('the header is preferred when both header and query are supplied', () => {
  const entry = makeKey('both', 'write');
  const outcome = keys.checkApiKey(req('POST', { 'x-api-key': entry.key }, { api_key: 'wrong' }));
  assert.equal(outcome.ok, true);
});

test('account and maintenance routes are session-only', () => {
  for (const prefix of ['/auth', '/keys', '/update', '/support', '/backup', '/ha/key', '/audit-log', '/notifications']) {
    assert.ok(keys.API_KEY_SESSION_ONLY.includes(prefix), `${prefix} must stay session-only`);
  }
});

test('touchApiKey records last use and is throttled to avoid a write per request', () => {
  const entry = makeKey('touch-me', 'read');
  keys.touchApiKey(entry.id);
  const first = keys.getApiKeys().find(k => k.id === entry.id).lastUsedAt;
  assert.ok(first, 'first use should be recorded');

  keys.touchApiKey(entry.id);
  const second = keys.getApiKeys().find(k => k.id === entry.id).lastUsedAt;
  assert.equal(second, first, 'a second use within the minute must not rewrite the database');
});

test('touchApiKey ignores an unknown id without throwing', () => {
  assert.doesNotThrow(() => keys.touchApiKey('no-such-id'));
});

test('keys survive a round trip through the store', () => {
  const entry = makeKey('persisted', 'write');
  const found = keys.getApiKeys().find(k => k.key === entry.key);
  assert.ok(found);
  assert.equal(found.scope, 'write');
  assert.equal(found.label, 'persisted');
});
