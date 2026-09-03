// ============================================================
//  Per-device history
//
//  The activity log records device transitions, but it is a single capped list
//  across the whole system — on a busy network a given device's events scroll
//  out of it quickly. This keeps a separate, small ring per device so the
//  timeline on a card is actually useful.
//
//  Only transitions are recorded, never steady state, so a device that stays
//  up writes nothing at all.
// ============================================================

'use strict';

const { dbGet, dbSet } = require('./db');

const STORE_KEY = 'device_history';
const MAX_PER_DEVICE = 50;   // roughly a year of ordinary flapping
const MAX_DEVICES = 1000;    // hard ceiling so the store cannot grow without bound

const getAll = () => dbGet(STORE_KEY) || {};

/** Newest first. */
function getHistory(ip) {
  return getAll()[ip] || [];
}

/**
 * Append an event for one device.
 *   type   'offline' | 'online' | 'health.down' | 'health.up'
 *   detail optional short string, e.g. an HTTP status code
 */
function record(ip, type, detail = null) {
  if (!ip || !type) return;
  try {
    const all = getAll();
    const events = all[ip] || [];
    events.unshift({ ts: new Date().toISOString(), type, detail });
    all[ip] = events.slice(0, MAX_PER_DEVICE);

    // Ceiling guard: if somehow tracking a huge number of devices, drop the
    // ones whose most recent event is oldest.
    const ips = Object.keys(all);
    if (ips.length > MAX_DEVICES) {
      ips
        .sort((a, b) => new Date(all[b][0]?.ts || 0) - new Date(all[a][0]?.ts || 0))
        .slice(MAX_DEVICES)
        .forEach((stale) => delete all[stale]);
    }

    dbSet(STORE_KEY, all);
  } catch (e) {
    // History is a nicety — never let it break a ping cycle.
    console.warn(`[history] Could not record ${type} for ${ip}: ${e.message}`);
  }
}

/** Forget devices that are no longer tracked, so deleting an entry cleans up. */
function prune(trackedIps) {
  try {
    const keep = new Set(trackedIps);
    const all = getAll();
    let changed = false;
    for (const ip of Object.keys(all)) {
      if (!keep.has(ip)) { delete all[ip]; changed = true; }
    }
    if (changed) dbSet(STORE_KEY, all);
  } catch { /* best effort */ }
}

/**
 * Summarise a device's recent behaviour — the part that is actually useful at
 * a glance: how often it has dropped, and when it last did.
 */
function summarise(ip, sinceDays = 30) {
  const cutoff = Date.now() - sinceDays * 86400000;
  const events = getHistory(ip).filter((e) => new Date(e.ts).getTime() >= cutoff);
  const outages = events.filter((e) => e.type === 'offline');
  return {
    events,
    outageCount: outages.length,
    lastOutage: outages.length ? outages[0].ts : null,
    windowDays: sinceDays,
  };
}

module.exports = { STORE_KEY, MAX_PER_DEVICE, getHistory, record, prune, summarise };
