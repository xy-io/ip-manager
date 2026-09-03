// ============================================================
//  TOTP — time-based one-time passwords (RFC 6238)
//
//  Implemented directly on Node's crypto rather than pulling in a dependency:
//  the algorithm is about thirty lines, and this file is verified against the
//  published RFC 4226 and RFC 6238 test vectors in test/totp.test.js.
//
//  Compatible with Google Authenticator, Aegis, 1Password, Bitwarden and
//  anything else that speaks otpauth:// — SHA-1, 6 digits, 30-second period,
//  which is the combination every authenticator app supports.
// ============================================================

'use strict';

const crypto = require('crypto');

const DIGITS = 6;
const PERIOD = 30;              // seconds per code
const DEFAULT_WINDOW = 1;       // accept the previous and next step, for clock skew

// ── Base32 (RFC 4648), the encoding authenticator apps expect ────────────────
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += B32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const idx = B32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// ── HOTP (RFC 4226) ──────────────────────────────────────────────────────────
// The counter is packed big-endian into eight bytes, HMAC-SHA1'd with the
// secret, then dynamically truncated to the required number of digits.
function hotp(secretBuffer, counter, digits = DIGITS) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = crypto.createHmac('sha1', secretBuffer).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset]     & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) <<  8) |
     (digest[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, '0');
}

// ── TOTP (RFC 6238) ──────────────────────────────────────────────────────────
const counterFor = (seconds, period = PERIOD) => Math.floor(seconds / period);

/** Current code for a base32 secret. `atSeconds` allows testing at a fixed time. */
function generate(base32Secret, atSeconds = Math.floor(Date.now() / 1000), { digits = DIGITS, period = PERIOD } = {}) {
  return hotp(base32Decode(base32Secret), counterFor(atSeconds, period), digits);
}

/**
 * Verify a submitted code, tolerating clock drift of `window` steps either way.
 * Returns the matching counter (so the caller can reject replays) or null.
 * The comparison is constant-time to avoid leaking information through timing.
 */
function verify(base32Secret, token, {
  atSeconds = Math.floor(Date.now() / 1000),
  window = DEFAULT_WINDOW,
  digits = DIGITS,
  period = PERIOD,
} = {}) {
  const candidate = String(token == null ? '' : token).replace(/\s+/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(candidate)) return null;

  const secret = base32Decode(base32Secret);
  const centre = counterFor(atSeconds, period);

  for (let drift = -window; drift <= window; drift++) {
    const counter = centre + drift;
    if (counter < 0) continue;
    const expected = hotp(secret, counter, digits);
    const a = Buffer.from(expected);
    const b = Buffer.from(candidate);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return counter;
  }
  return null;
}

/** A fresh 160-bit secret, the size RFC 4226 recommends, base32 encoded. */
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/**
 * otpauth:// URI for the enrolment QR code.
 * The label is what shows in the authenticator app's list.
 */
function otpauthUri(base32Secret, { account = 'admin', issuer = 'IP Manager' } = {}) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: base32Secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Recovery codes: readable, unambiguous, and generated from a CSPRNG. */
function generateRecoveryCodes(count = 10) {
  // Crockford-style alphabet: no O/0, I/1 confusion when read off a screen.
  const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  const codes = [];
  for (let i = 0; i < count; i++) {
    const bytes = crypto.randomBytes(10);
    let code = '';
    for (let j = 0; j < 10; j++) {
      code += alphabet[bytes[j] % alphabet.length];
      if (j === 4) code += '-';
    }
    codes.push(code);
  }
  return codes;
}

module.exports = {
  DIGITS,
  PERIOD,
  base32Encode,
  base32Decode,
  hotp,
  generate,
  verify,
  generateSecret,
  otpauthUri,
  generateRecoveryCodes,
};
