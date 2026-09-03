// ============================================================
//  Two-factor authentication state
//
//  Optional and off by default. Nothing about anyone's login changes until
//  they deliberately enable it, which is what makes shipping this safe.
//
//  Stored in the database rather than credentials.env: that file has been
//  deleted or rewritten by git operations more than once, and losing the
//  second factor along with it would mean a lockout.
//
//  Three ways out if the authenticator is lost:
//    1. Settings → Security, while signed in (needs the account password)
//    2. A one-time recovery code, entered instead of a TOTP code at sign-in
//    3. scripts/disable-totp.cjs over SSH, for when you cannot sign in at all
// ============================================================

'use strict';

const bcrypt = require('bcryptjs');
const { dbGet, dbSet } = require('./db');
const totp = require('./totp');

const STORE_KEY = 'totp_config';
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_HASH_ROUNDS = 10; // lower than the password: these are high-entropy already

const defaults = () => ({
  enabled: false,
  secret: null,            // base32, only set once a code has been verified
  pendingSecret: null,     // during enrolment, before verification
  recoveryCodes: [],       // bcrypt hashes — the plaintext is shown once and never stored
  enabledAt: null,
  lastCounter: null,       // replay guard: a code cannot be used twice
});

function getConfig() {
  return { ...defaults(), ...(dbGet(STORE_KEY) || {}) };
}

function saveConfig(config) {
  dbSet(STORE_KEY, config);
}

/** Safe to expose to the browser: no secret, no hashes. */
function getStatus() {
  const c = getConfig();
  return {
    enabled: c.enabled,
    enabledAt: c.enabledAt,
    recoveryCodesRemaining: c.recoveryCodes.length,
    setupInProgress: !!c.pendingSecret && !c.enabled,
  };
}

const isEnabled = () => getConfig().enabled === true;

/**
 * Begin enrolment: generate a secret and hold it as pending. Nothing changes
 * about sign-in until a code generated from it has been verified.
 */
function beginSetup(account) {
  const config = getConfig();
  const secret = totp.generateSecret();
  config.pendingSecret = secret;
  saveConfig(config);
  return { secret, uri: totp.otpauthUri(secret, { account: account || 'admin' }) };
}

/**
 * Finish enrolment by proving a working code. Returns the recovery codes in
 * plaintext — the only time they exist outside the user's own records.
 */
function completeSetup(code) {
  const config = getConfig();
  if (!config.pendingSecret) {
    return { ok: false, error: 'No setup in progress', message: 'Start setup again from Settings → Security.' };
  }

  const counter = totp.verify(config.pendingSecret, code);
  if (counter === null) {
    return {
      ok: false,
      error: 'Incorrect code',
      message: 'That code did not match. Check your authenticator app is showing the right entry, and that the server clock is correct.',
    };
  }

  const plainCodes = totp.generateRecoveryCodes(RECOVERY_CODE_COUNT);
  config.secret = config.pendingSecret;
  config.pendingSecret = null;
  config.enabled = true;
  config.enabledAt = new Date().toISOString();
  // Deliberately NOT recording this counter as used. Enrolment is not a
  // sign-in — it is proof of setup from an already-authenticated session — and
  // consuming the counter here would reject the user's very next sign-in if it
  // happened inside the same 30-second window, with the baffling message that
  // their brand new code had "already been used".
  config.lastCounter = null;
  config.recoveryCodes = plainCodes.map((c) => bcrypt.hashSync(c, RECOVERY_HASH_ROUNDS));
  saveConfig(config);

  return { ok: true, recoveryCodes: plainCodes };
}

/** Abandon an enrolment that was started but never confirmed. */
function cancelSetup() {
  const config = getConfig();
  config.pendingSecret = null;
  saveConfig(config);
}

/**
 * Check a submitted second factor. Accepts either a TOTP code or one of the
 * recovery codes; a recovery code is consumed on use.
 * Returns { ok, usedRecoveryCode, recoveryCodesRemaining }.
 */
function verifySecondFactor(submitted) {
  const config = getConfig();
  if (!config.enabled) return { ok: true, usedRecoveryCode: false };

  const value = String(submitted == null ? '' : submitted).trim();
  if (!value) return { ok: false, usedRecoveryCode: false };

  // A six-digit value is a TOTP code; anything else is treated as a recovery code.
  const counter = totp.verify(config.secret, value);
  if (counter !== null) {
    // Replay guard: the same code must not work twice, even inside its window.
    if (config.lastCounter !== null && counter <= config.lastCounter) {
      return { ok: false, usedRecoveryCode: false, replay: true };
    }
    config.lastCounter = counter;
    saveConfig(config);
    return { ok: true, usedRecoveryCode: false };
  }

  // Recovery codes are compared against every stored hash, then consumed.
  const normalised = value.toUpperCase().replace(/\s+/g, '');
  for (let i = 0; i < config.recoveryCodes.length; i++) {
    if (bcrypt.compareSync(normalised, config.recoveryCodes[i])) {
      config.recoveryCodes.splice(i, 1);
      saveConfig(config);
      return { ok: true, usedRecoveryCode: true, recoveryCodesRemaining: config.recoveryCodes.length };
    }
  }

  return { ok: false, usedRecoveryCode: false };
}

/** Turn it off completely and forget the secret and codes. */
function disable() {
  saveConfig(defaults());
}

/** Issue a fresh set of recovery codes, invalidating the old ones. */
function regenerateRecoveryCodes() {
  const config = getConfig();
  if (!config.enabled) return null;
  const plainCodes = totp.generateRecoveryCodes(RECOVERY_CODE_COUNT);
  config.recoveryCodes = plainCodes.map((c) => bcrypt.hashSync(c, RECOVERY_HASH_ROUNDS));
  saveConfig(config);
  return plainCodes;
}

module.exports = {
  STORE_KEY,
  RECOVERY_CODE_COUNT,
  getConfig,
  getStatus,
  isEnabled,
  beginSetup,
  completeSetup,
  cancelSetup,
  verifySecondFactor,
  disable,
  regenerateRecoveryCodes,
};
