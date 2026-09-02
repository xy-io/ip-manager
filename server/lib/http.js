// ============================================================
//  HTTP response helpers
// ============================================================

'use strict';

// Structured error responses. Every API failure returns the same shape so a
// client can show something useful without parsing prose:
//   { "error": "Short error", "message": "Human-readable explanation" }
function apiError(res, status, error, message) {
  return res.status(status).json({ error, message });
}

// Cache timestamps are exposed to clients as Unix seconds, and countdowns as
// seconds, rather than the milliseconds used internally. Clients schedule
// refreshes off these values, so the unit has to be unambiguous.
const toEpochSeconds = (ms) => (ms ? Math.floor(ms / 1000) : 0);
const toSecondsRemaining = (intervalMs, sinceMs) =>
  Math.max(0, Math.round((intervalMs - (Date.now() - sinceMs)) / 1000));

module.exports = { apiError, toEpochSeconds, toSecondsRemaining };
