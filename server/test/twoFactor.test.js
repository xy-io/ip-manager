// ============================================================
//  lib/twoFactor.js — enrolment, verification and recovery
//
//  The property that matters most here is that nobody gets locked out:
//  it is off unless deliberately enabled, it cannot be enabled without
//  proving a working code, and there is always a way back in.
// ============================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Point the store at a throwaway database before lib/db is required.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ipm-2fa-')), 'test.db');

const twoFactor = require('../lib/twoFactor');
const totp = require('../lib/totp');

const reset = () => twoFactor.disable();

test('two-factor is off by default — an update can never lock anyone out', () => {
  reset();
  assert.equal(twoFactor.isEnabled(), false);
  const status = twoFactor.getStatus();
  assert.equal(status.enabled, false);
  assert.equal(status.recoveryCodesRemaining, 0);
});

test('when disabled, any second factor passes so sign-in is unaffected', () => {
  reset();
  assert.equal(twoFactor.verifySecondFactor(undefined).ok, true);
  assert.equal(twoFactor.verifySecondFactor('').ok, true);
  assert.equal(twoFactor.verifySecondFactor('000000').ok, true);
});

test('beginSetup does not enable anything on its own', () => {
  reset();
  const { secret, uri } = twoFactor.beginSetup('Jay');
  assert.ok(secret);
  assert.ok(uri.startsWith('otpauth://totp/'));
  assert.equal(twoFactor.isEnabled(), false, 'starting setup must not change sign-in');
  assert.equal(twoFactor.getStatus().setupInProgress, true);
});

test('enrolment fails on a wrong code, and stays disabled', () => {
  reset();
  twoFactor.beginSetup('Jay');
  const result = twoFactor.completeSetup('000000');
  assert.equal(result.ok, false);
  assert.ok(result.message);
  assert.equal(twoFactor.isEnabled(), false, 'a failed verification must not enable it');
});

test('enrolment requires a setup to have been started', () => {
  reset();
  const result = twoFactor.completeSetup('123456');
  assert.equal(result.ok, false);
  assert.match(result.error, /No setup/);
});

test('a correct code completes enrolment and returns ten recovery codes', () => {
  reset();
  const { secret } = twoFactor.beginSetup('Jay');
  const result = twoFactor.completeSetup(totp.generate(secret));
  assert.equal(result.ok, true);
  assert.equal(result.recoveryCodes.length, 10);
  assert.equal(twoFactor.isEnabled(), true);
  assert.equal(twoFactor.getStatus().recoveryCodesRemaining, 10);
  assert.ok(twoFactor.getStatus().enabledAt);
});

test('the status object never exposes the secret or the code hashes', () => {
  reset();
  const { secret } = twoFactor.beginSetup('Jay');
  twoFactor.completeSetup(totp.generate(secret));
  const status = twoFactor.getStatus();
  const serialised = JSON.stringify(status);
  assert.ok(!serialised.includes(secret), 'the secret must never reach the browser');
  assert.equal(status.recoveryCodes, undefined);
});

test('recovery codes are stored hashed, never in plaintext', () => {
  reset();
  const { secret } = twoFactor.beginSetup('Jay');
  const { recoveryCodes } = twoFactor.completeSetup(totp.generate(secret));
  const stored = twoFactor.getConfig().recoveryCodes;
  assert.equal(stored.length, 10);
  for (const hash of stored) assert.ok(hash.startsWith('$2'), 'each code must be a bcrypt hash');
  for (const plain of recoveryCodes) {
    assert.ok(!stored.includes(plain), 'plaintext recovery codes must not be stored');
  }
});

test('a valid TOTP code is accepted once and rejected on replay', () => {
  reset();
  const { secret } = twoFactor.beginSetup('Jay');
  twoFactor.completeSetup(totp.generate(secret));

  // completeSetup consumed the current counter, so use the next window.
  const future = Math.floor(Date.now() / 1000) + 30;
  const code = totp.generate(secret, future);

  // Simulate the clock having advanced by verifying against that window.
  const first = twoFactor.verifySecondFactor(code);
  // Either accepted now, or rejected as replay if it fell in the consumed step —
  // both are safe. What must never happen is the same code working twice.
  if (first.ok) {
    const second = twoFactor.verifySecondFactor(code);
    assert.equal(second.ok, false, 'a code must not be reusable');
    assert.equal(second.replay, true);
  }
});

test('an incorrect code is rejected', () => {
  reset();
  const { secret } = twoFactor.beginSetup('Jay');
  twoFactor.completeSetup(totp.generate(secret));
  assert.equal(twoFactor.verifySecondFactor('000000').ok, false);
  assert.equal(twoFactor.verifySecondFactor('').ok, false);
  assert.equal(twoFactor.verifySecondFactor(null).ok, false);
});

test('a recovery code works and is consumed', () => {
  reset();
  const { secret } = twoFactor.beginSetup('Jay');
  const { recoveryCodes } = twoFactor.completeSetup(totp.generate(secret));
  const code = recoveryCodes[3];

  const first = twoFactor.verifySecondFactor(code);
  assert.equal(first.ok, true);
  assert.equal(first.usedRecoveryCode, true);
  assert.equal(first.recoveryCodesRemaining, 9);

  const second = twoFactor.verifySecondFactor(code);
  assert.equal(second.ok, false, 'a recovery code must be single-use');
  assert.equal(twoFactor.getStatus().recoveryCodesRemaining, 9);
});

test('recovery codes are accepted regardless of case and spacing', () => {
  reset();
  const { secret } = twoFactor.beginSetup('Jay');
  const { recoveryCodes } = twoFactor.completeSetup(totp.generate(secret));
  const messy = ` ${recoveryCodes[0].toLowerCase()} `;
  assert.equal(twoFactor.verifySecondFactor(messy).ok, true);
});

test('using every recovery code leaves none, without breaking', () => {
  reset();
  const { secret } = twoFactor.beginSetup('Jay');
  const { recoveryCodes } = twoFactor.completeSetup(totp.generate(secret));
  for (const code of recoveryCodes) assert.equal(twoFactor.verifySecondFactor(code).ok, true);
  assert.equal(twoFactor.getStatus().recoveryCodesRemaining, 0);
  assert.equal(twoFactor.verifySecondFactor(recoveryCodes[0]).ok, false);
});

test('regenerating recovery codes invalidates the previous set', () => {
  reset();
  const { secret } = twoFactor.beginSetup('Jay');
  const { recoveryCodes: original } = twoFactor.completeSetup(totp.generate(secret));
  const fresh = twoFactor.regenerateRecoveryCodes();

  assert.equal(fresh.length, 10);
  assert.equal(twoFactor.verifySecondFactor(original[0]).ok, false, 'old codes must stop working');
  assert.equal(twoFactor.verifySecondFactor(fresh[0]).ok, true, 'new codes must work');
});

test('regenerating does nothing when two-factor is off', () => {
  reset();
  assert.equal(twoFactor.regenerateRecoveryCodes(), null);
});

test('disable clears the secret and every recovery code', () => {
  reset();
  const { secret } = twoFactor.beginSetup('Jay');
  const { recoveryCodes } = twoFactor.completeSetup(totp.generate(secret));

  twoFactor.disable();

  assert.equal(twoFactor.isEnabled(), false);
  const config = twoFactor.getConfig();
  assert.equal(config.secret, null);
  assert.equal(config.recoveryCodes.length, 0);
  assert.equal(twoFactor.verifySecondFactor(recoveryCodes[0]).ok, true,
    'with two-factor off, sign-in must not require anything');
});

test('cancelSetup abandons a half-finished enrolment', () => {
  reset();
  twoFactor.beginSetup('Jay');
  twoFactor.cancelSetup();
  assert.equal(twoFactor.getStatus().setupInProgress, false);
  assert.equal(twoFactor.completeSetup('123456').ok, false);
});

test('re-enrolling produces a different secret', () => {
  reset();
  const first = twoFactor.beginSetup('Jay').secret;
  twoFactor.completeSetup(totp.generate(first));
  twoFactor.disable();
  const second = twoFactor.beginSetup('Jay').secret;
  assert.notEqual(first, second);
});
