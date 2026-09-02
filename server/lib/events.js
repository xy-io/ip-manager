// ============================================================
//  Events — audit log and outbound notifications
//
//  One path for anything worth recording. recordEvent() appends to a capped
//  audit log and, when the event type is enabled, pushes a notification to a
//  webhook or an ntfy topic. Everything is best-effort: a failing webhook must
//  never break the request that triggered it.
// ============================================================

'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { dbGet, dbSet } = require('./db');

// ── Events: audit log and outbound notifications ──────────────────────────────
// One path for anything worth recording. recordEvent() appends to a capped
// audit log and, if the event type is enabled, pushes a notification out to a
// webhook or an ntfy topic. Everything is best-effort: a failing webhook must
// never break the request that triggered it.

const AUDIT_LIMIT = 500; // entries kept; oldest are discarded

const NOTIFY_EVENTS = {
  'device.offline':  'A tracked device stops responding to ping',
  'device.online':   'A device that was offline comes back',
  'health.down':     'A service health check starts failing',
  'health.up':       'A failing health check recovers',
  'domain.expiring': 'A tracked domain is within 30 days of expiry',
  'backup.failed':   'A scheduled cloud backup fails',
  'update.completed':'An app update finishes',
  'auth.login.failed': 'A failed login attempt',
};

const defaultNotificationConfig = () => ({
  enabled: false,
  type: 'ntfy',            // 'ntfy' | 'webhook'
  url: '',
  events: Object.fromEntries(Object.keys(NOTIFY_EVENTS).map((k) => [
    k, ['device.offline', 'health.down', 'domain.expiring', 'backup.failed'].includes(k),
  ])),
  minOfflineCycles: 2,     // consecutive failed cycles before alerting (flap guard)
});

function getNotificationConfig() {
  return { ...defaultNotificationConfig(), ...(dbGet('notification_config') || {}) };
}

function getAuditLog() { return dbGet('audit_log') || []; }

/**
 * Record something noteworthy.
 *   type     dot-separated event id, e.g. 'auth.login.failed'
 *   message  human-readable one-liner
 *   meta     optional structured detail
 *   req      optional request, used to record the actor and source IP
 */
function recordEvent({ type, message, meta = {}, req = null }) {
  const event = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    type,
    message,
    meta,
    actor: req ? (req.apiKey ? `key:${req.apiKey.label}` : 'session') : 'system',
    source: req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null) : null,
  };

  try {
    const log = getAuditLog();
    log.unshift(event);
    dbSet('audit_log', log.slice(0, AUDIT_LIMIT));
  } catch (e) {
    console.error(`[audit] Could not write audit entry: ${e.message}`);
  }

  dispatchNotification(event);
  return event;
}

// Fire-and-forget delivery. Never throws into the caller.
function dispatchNotification(event) {
  let cfg;
  try { cfg = getNotificationConfig(); } catch { return; }
  if (!cfg.enabled || !cfg.url) return;
  if (!cfg.events || !cfg.events[event.type]) return;

  const priority = ['device.offline', 'health.down', 'backup.failed'].includes(event.type) ? 'high' : 'default';

  try {
    const target = new URL(cfg.url);
    const lib = target.protocol === 'http:' ? http : https;

    let body, headers;
    if (cfg.type === 'ntfy') {
      body = event.message;
      headers = {
        'Content-Type': 'text/plain; charset=utf-8',
        'Title': 'IP Manager',
        'Priority': priority,
        'Tags': event.type.startsWith('device') ? 'satellite' : 'warning',
      };
    } else {
      body = JSON.stringify({
        type: event.type,
        message: event.message,
        meta: event.meta,
        timestamp: event.ts,
        source: 'ip-manager',
      });
      headers = { 'Content-Type': 'application/json' };
    }

    const payload = Buffer.from(body, 'utf8');
    headers['Content-Length'] = payload.length;

    const request = lib.request({
      hostname: target.hostname,
      port: target.port || (target.protocol === 'http:' ? 80 : 443),
      path: target.pathname + target.search,
      method: 'POST',
      headers,
      timeout: 8000,
    }, (res) => {
      res.resume(); // drain
      if (res.statusCode >= 400) {
        console.warn(`[notify] ${cfg.type} responded ${res.statusCode} for ${event.type}`);
      }
    });

    request.on('timeout', () => { request.destroy(new Error('timeout')); });
    request.on('error', (err) => console.warn(`[notify] delivery failed for ${event.type}: ${err.message}`));
    request.write(payload);
    request.end();
  } catch (err) {
    console.warn(`[notify] could not dispatch ${event.type}: ${err.message}`);
  }
}

module.exports = {
  AUDIT_LIMIT,
  NOTIFY_EVENTS,
  defaultNotificationConfig,
  getNotificationConfig,
  getAuditLog,
  recordEvent,
  dispatchNotification,
};
