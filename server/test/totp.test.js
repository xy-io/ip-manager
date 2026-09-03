// ============================================================
//  lib/totp.js — verified against the published RFC test vectors
//
//  A homegrown crypto implementation is only trustworthy if it reproduces the
//  standard's own test vectors exactly. RFC 4226 Appendix D lists ten HOTP
//  values for a known secret; RFC 6238 Appendix B does the same for TOTP.
//  If any of these fail, the implementation is wrong and no authenticator app
//  would interoperate with it.
// ============================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const totp = require('../lib/totp');

// The RFC 4226 test secret: the ASCII string "12345678901234567890".
const RFC_SECRET_ASCII = '12345678901234567890';
const RFC_SECRET_B32 = totp.base32Encode(Buffer.from(RFC_SECRET_ASCII, 'ascii'));

test('base32 round-trips arbitrary bytes', () => {
  for (const input of ['', 'a', 'ab', 'abc', 'abcd', 'abcde', RFC_SECRET_ASCII, 'hello world!']) {
    const buf = Buffer.from(input, 'ascii');
    assert.deepEqual(totp.base32Decode(totp.base32Encode(buf)), buf, `round trip failed for ${JSON.stringify(input)}`);
  }
});

test('base32 encodes the RFC secret to the documented value', () => {
  // "12345678901234567890" in base32 is GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
  assert.equal(RFC_SECRET_B32, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
});

test('base32 decoding tolerates lowercase, spaces and padding', () => {
  const expected = totp.base32Decode(RFC_SECRET_B32);
  assert.deepEqual(totp.base32Decode(RFC_SECRET_B32.toLowerCase()), expected);
  assert.deepEqual(totp.base32Decode('GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ'), expected);
  assert.deepEqual(totp.base32Decode(RFC_SECRET_B32 + '==='), expected);
});

test('base32 rejects characters outside the alphabet', () => {
  assert.throws(() => totp.base32Decode('ABC!DEF'), /Invalid base32/);
});

// ── RFC 4226 Appendix D: the canonical HOTP values ──────────────────────────
test('HOTP reproduces all ten RFC 4226 test vectors', () => {
  const expected = [
    '755224', '287082', '359152', '969429', '338314',
    '254676', '287922', '162583', '399871', '520489',
  ];
  const secret = Buffer.from(RFC_SECRET_ASCII, 'ascii');
  expected.forEach((code, counter) => {
    assert.equal(totp.hotp(secret, counter), code, `HOTP counter ${counter} must be ${code}`);
  });
});

// ── RFC 6238 Appendix B: TOTP at known timestamps (SHA-1 rows) ──────────────
test('TOTP reproduces the RFC 6238 test vectors', () => {
  // The RFC tabulates 8-digit codes; the last six digits are the 6-digit code.
  const vectors = [
    { seconds: 59,          eightDigit: '94287082' },
    { seconds: 1111111109,  eightDigit: '07081804' },
    { seconds: 1111111111,  eightDigit: '14050471' },
    { seconds: 1234567890,  eightDigit: '89005924' },
    { seconds: 2000000000,  eightDigit: '69279037' },
  ];
  for (const { seconds, eightDigit } of vectors) {
    assert.equal(
      totp.generate(RFC_SECRET_B32, seconds, { digits: 8 }),
      eightDigit,
      `8-digit TOTP at t=${seconds}`);
    assert.equal(
      totp.generate(RFC_SECRET_B32, seconds),
      eightDigit.slice(-6),
      `6-digit TOTP at t=${seconds}`);
  }
});

test('the code changes every 30 seconds and is stable within a step', () => {
  // Windows are aligned to multiples of 30, not to an arbitrary offset:
  // 1020–1049 is one step (counter 34), 1050 begins the next.
  const start = 1020;
  const a = totp.generate(RFC_SECRET_B32, start);
  const b = totp.generate(RFC_SECRET_B32, start + 29); // still the same step
  const c = totp.generate(RFC_SECRET_B32, start + 30); // next step
  assert.equal(a, b, 'the code must not change mid-window');
  assert.notEqual(a, c, 'the code must change at the window boundary');
});

// ── Verification ────────────────────────────────────────────────────────────
test('verify accepts the current code and returns its counter', () => {
  const at = 1234567890;
  const code = totp.generate(RFC_SECRET_B32, at);
  const counter = totp.verify(RFC_SECRET_B32, code, { atSeconds: at });
  assert.equal(counter, Math.floor(at / 30));
});

test('verify tolerates one step of clock drift in each direction', () => {
  const at = 1234567890;
  const previous = totp.generate(RFC_SECRET_B32, at - 30);
  const next     = totp.generate(RFC_SECRET_B32, at + 30);
  assert.ok(totp.verify(RFC_SECRET_B32, previous, { atSeconds: at }) !== null, 'previous step should be accepted');
  assert.ok(totp.verify(RFC_SECRET_B32, next,     { atSeconds: at }) !== null, 'next step should be accepted');
});

test('verify rejects codes beyond the drift window', () => {
  const at = 1234567890;
  const tooOld = totp.generate(RFC_SECRET_B32, at - 120);
  const tooNew = totp.generate(RFC_SECRET_B32, at + 120);
  assert.equal(totp.verify(RFC_SECRET_B32, tooOld, { atSeconds: at }), null);
  assert.equal(totp.verify(RFC_SECRET_B32, tooNew, { atSeconds: at }), null);
});

test('verify rejects malformed input without throwing', () => {
  const at = 1234567890;
  for (const bad of ['', '12345', '1234567', 'abcdef', null, undefined, '12 34 56 78', {}, []]) {
    assert.equal(totp.verify(RFC_SECRET_B32, bad, { atSeconds: at }), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test('verify tolerates spaces in a pasted code', () => {
  const at = 1234567890;
  const code = totp.generate(RFC_SECRET_B32, at);
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  assert.ok(totp.verify(RFC_SECRET_B32, spaced, { atSeconds: at }) !== null);
});

test('a code from a different secret is rejected', () => {
  const other = totp.generateSecret();
  const at = 1234567890;
  const code = totp.generate(other, at);
  // Astronomically unlikely to collide, but assert the negative case explicitly.
  if (code !== totp.generate(RFC_SECRET_B32, at)) {
    assert.equal(totp.verify(RFC_SECRET_B32, code, { atSeconds: at }), null);
  }
});

// ── Secrets and enrolment ───────────────────────────────────────────────────
test('generateSecret produces distinct 160-bit base32 secrets', () => {
  const a = totp.generateSecret();
  const b = totp.generateSecret();
  assert.notEqual(a, b);
  assert.equal(totp.base32Decode(a).length, 20, 'RFC 4226 recommends a 160-bit secret');
  assert.match(a, /^[A-Z2-7]+$/, 'must be valid base32');
});

test('otpauthUri is well formed and carries the parameters apps expect', () => {
  const uri = totp.otpauthUri('GEZDGNBVGY3TQOJQ', { account: 'Jay', issuer: 'IP Manager' });
  assert.ok(uri.startsWith('otpauth://totp/'));
  const parsed = new URL(uri);
  assert.equal(parsed.searchParams.get('secret'), 'GEZDGNBVGY3TQOJQ');
  assert.equal(parsed.searchParams.get('issuer'), 'IP Manager');
  assert.equal(parsed.searchParams.get('algorithm'), 'SHA1');
  assert.equal(parsed.searchParams.get('digits'), '6');
  assert.equal(parsed.searchParams.get('period'), '30');
  assert.ok(decodeURIComponent(parsed.pathname).includes('Jay'));
});

// ── Recovery codes ──────────────────────────────────────────────────────────
test('recovery codes are unique, readable and free of ambiguous characters', () => {
  const codes = totp.generateRecoveryCodes(10);
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10, 'codes must not repeat');
  for (const code of codes) {
    assert.match(code, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/, `unexpected format: ${code}`);
    assert.ok(!/[OI01L]/.test(code), `${code} contains an easily-misread character`);
  }
});

test('two batches of recovery codes never overlap', () => {
  const a = new Set(totp.generateRecoveryCodes(10));
  const b = totp.generateRecoveryCodes(10);
  for (const code of b) assert.ok(!a.has(code));
});
