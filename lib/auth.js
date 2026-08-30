// lib/auth.js
// Password hashing using node's built-in scrypt (no native deps).
const crypto = require('crypto');

const KEYLEN = 64;
const COST = 16384;
const BLOCK = 8;
const PARALLEL = 1;

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, KEYLEN, {
    N: COST,
    r: BLOCK,
    p: PARALLEL,
  });
  return `${salt}:${derived.toString('hex')}`;
}

function verifyPassword(plain, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, expected] = stored.split(':');
  const derived = crypto.scryptSync(plain, salt, KEYLEN, {
    N: COST,
    r: BLOCK,
    p: PARALLEL,
  });
  const a = Buffer.from(expected, 'hex');
  if (a.length !== derived.length) return false;
  return crypto.timingSafeEqual(a, derived);
}

module.exports = { hashPassword, verifyPassword };
