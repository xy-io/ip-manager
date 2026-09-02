// ============================================================
//  Sessions and login rate limiting
//
//  Both are deliberately in-memory only. Sessions do not survive a restart,
//  and neither do failed-login counters — so a misconfiguration can never
//  lock anyone out permanently, and there is no state to migrate.
// ============================================================

'use strict';

const crypto = require('crypto');

// ── Session store ─────────────────────────────────────────────────────────────
// Simple in-memory map of token → expiry. Sessions are cleared on server restart.

const SESSION_COOKIE = 'ip-manager-session';
const sessions = new Map(); // token → { expires, lastSeen }

// Sessions used to live until the server restarted, and the map grew without
// bound. They now expire on a sliding window: active use keeps a session alive,
// but one left idle is discarded. Both values are generous — this is a home
// network tool, and being logged out mid-task is its own kind of failure.
const SESSION_IDLE_MS     = 7  * 24 * 60 * 60 * 1000; // 7 days without use
const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days regardless
const SESSION_SWEEP_MS    = 60 * 60 * 1000;           // tidy up hourly

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  sessions.set(token, { expires: now + SESSION_ABSOLUTE_MS, lastSeen: now });
  return token;
}

function isValidSession(token) {
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;

  const now = Date.now();
  if (now > session.expires || now - session.lastSeen > SESSION_IDLE_MS) {
    sessions.delete(token);
    return false;
  }
  session.lastSeen = now; // sliding window: using the app keeps you signed in
  return true;
}

// Periodic sweep so expired entries are released even if nothing touches them.
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now > session.expires || now - session.lastSeen > SESSION_IDLE_MS) sessions.delete(token);
  }
}, SESSION_SWEEP_MS).unref?.();

// ── Login rate limiting ──────────────────────────────────────────────────────
// Failed sign-ins are tracked per source address. Deliberately in memory only:
// a restart clears every counter, so a misconfiguration can never permanently
// lock anyone out. Successful sign-in clears that address immediately.
const LOGIN_MAX_ATTEMPTS = 10;                 // failures before throttling
const LOGIN_WINDOW_MS    = 15 * 60 * 1000;     // rolling window
const LOGIN_LOCKOUT_MS   = 15 * 60 * 1000;     // how long throttling lasts
const loginAttempts = new Map();               // ip → { count, first, blockedUntil }

function loginClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function loginThrottleStatus(req) {
  const record = loginAttempts.get(loginClientIp(req));
  if (!record) return null;
  const now = Date.now();
  if (record.blockedUntil && now < record.blockedUntil) {
    return { retryAfterSeconds: Math.ceil((record.blockedUntil - now) / 1000) };
  }
  return null;
}

function recordLoginFailure(req) {
  const ip = loginClientIp(req);
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (!record || now - record.first > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, first: now, blockedUntil: 0 });
    return;
  }
  record.count += 1;
  if (record.count >= LOGIN_MAX_ATTEMPTS) {
    record.blockedUntil = now + LOGIN_LOCKOUT_MS;
    record.count = 0;
    record.first = now;
    console.warn(`[auth] Too many failed sign-ins from ${ip} — throttled for ${LOGIN_LOCKOUT_MS / 60000} minutes`);
  }
}

function clearLoginFailures(req) {
  loginAttempts.delete(loginClientIp(req));
}

// Keep the attempt map from growing: drop records nothing has touched.
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of loginAttempts) {
    const idle = now - record.first > LOGIN_WINDOW_MS;
    const unblocked = !record.blockedUntil || now > record.blockedUntil;
    if (idle && unblocked) loginAttempts.delete(ip);
  }
}, SESSION_SWEEP_MS).unref?.();

module.exports = {
  SESSION_COOKIE,
  createSession,
  isValidSession,
  destroySession: (token) => sessions.delete(token),
  clearAllSessions: () => sessions.clear(),
  loginThrottleStatus,
  recordLoginFailure,
  clearLoginFailures,
};
