// ============================================================
//  lib/sessions.js — session lifetime and login throttling
//
//  Both are in-memory by design. The tests below care most about the two
//  failure modes that would hurt a real user: being locked out permanently,
//  and being signed out while actively using the app.
// ============================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const sessions = require('../lib/sessions');

test('a fresh session is valid and its token is unguessable', () => {
  const token = sessions.createSession();
  assert.ok(sessions.isValidSession(token));
  assert.equal(typeof token, 'string');
  assert.ok(token.length >= 32, 'token should carry real entropy');
});

test('an unknown or empty token is never valid', () => {
  assert.equal(sessions.isValidSession('not-a-real-token'), false);
  assert.equal(sessions.isValidSession(''), false);
  assert.equal(sessions.isValidSession(undefined), false);
  assert.equal(sessions.isValidSession(null), false);
});

test('two sessions get different tokens', () => {
  assert.notEqual(sessions.createSession(), sessions.createSession());
});

test('destroySession invalidates only that session', () => {
  const a = sessions.createSession();
  const b = sessions.createSession();
  sessions.destroySession(a);
  assert.equal(sessions.isValidSession(a), false);
  assert.ok(sessions.isValidSession(b), 'signing out one client must not sign out another');
});

test('clearAllSessions invalidates everything (used after a password change)', () => {
  const a = sessions.createSession();
  const b = sessions.createSession();
  sessions.clearAllSessions();
  assert.equal(sessions.isValidSession(a), false);
  assert.equal(sessions.isValidSession(b), false);
});

test('SESSION_COOKIE is the name the app and tests both expect', () => {
  assert.equal(sessions.SESSION_COOKIE, 'ip-manager-session');
});

// ── Login throttle ───────────────────────────────────────────────────────────
// The throttle is keyed on source address, so each test uses its own.
const reqFrom = (ip) => ({ headers: {}, socket: { remoteAddress: ip } });

test('the throttle allows attempts below the threshold', () => {
  const req = reqFrom('203.0.113.1');
  for (let i = 0; i < 9; i++) {
    sessions.recordLoginFailure(req);
    assert.equal(sessions.loginThrottleStatus(req), null, `must not throttle at attempt ${i + 1}`);
  }
});

test('the throttle engages on the tenth failure and reports a retry delay', () => {
  const req = reqFrom('203.0.113.2');
  for (let i = 0; i < 10; i++) sessions.recordLoginFailure(req);
  const status = sessions.loginThrottleStatus(req);
  assert.ok(status, 'must throttle after ten failures');
  assert.ok(status.retryAfterSeconds > 0);
  assert.ok(status.retryAfterSeconds <= 15 * 60, 'lockout should not exceed fifteen minutes');
});

test('throttling one address does not affect another', () => {
  const attacker = reqFrom('203.0.113.3');
  const user = reqFrom('203.0.113.4');
  for (let i = 0; i < 10; i++) sessions.recordLoginFailure(attacker);
  assert.ok(sessions.loginThrottleStatus(attacker));
  assert.equal(sessions.loginThrottleStatus(user), null, 'an unrelated address must be unaffected');
});

test('a successful sign-in clears the failure count immediately', () => {
  const req = reqFrom('203.0.113.5');
  for (let i = 0; i < 9; i++) sessions.recordLoginFailure(req);
  sessions.clearLoginFailures(req);
  for (let i = 0; i < 9; i++) sessions.recordLoginFailure(req);
  assert.equal(sessions.loginThrottleStatus(req), null,
    'the counter must have restarted, not resumed');
});

test('the throttle prefers X-Forwarded-For when behind a proxy', () => {
  const viaProxy = { headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' }, socket: { remoteAddress: '10.0.0.1' } };
  const other    = { headers: { 'x-forwarded-for': '198.51.100.8' }, socket: { remoteAddress: '10.0.0.1' } };
  for (let i = 0; i < 10; i++) sessions.recordLoginFailure(viaProxy);
  assert.ok(sessions.loginThrottleStatus(viaProxy), 'the forwarded address should be throttled');
  assert.equal(sessions.loginThrottleStatus(other), null,
    'a different client behind the same proxy must not be throttled');
});

test('an address with no history is not throttled', () => {
  assert.equal(sessions.loginThrottleStatus(reqFrom('203.0.113.99')), null);
});
