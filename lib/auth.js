'use strict';
const crypto = require('node:crypto');

const N = 16384, R = 8, P = 2, KEYLEN = 64;

function scrypt(password, salt, opts) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEYLEN, { N: opts.N, r: opts.r, p: opts.p, maxmem: 128 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Format: scrypt$N$r$p$salt(base64)$hash(base64) – eigener Salt pro Passwort, asynchron (blockiert den Server nicht). */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, saltB64, hashB64] = parts;
    const expected = Buffer.from(hashB64, 'base64');
    const key = await scrypt(password, Buffer.from(saltB64, 'base64'), { N: +n, r: +r, p: +p });
    return key.length === expected.length && crypto.timingSafeEqual(key, expected);
  } catch { return false; }
}

let dummy;
/** Für unbekannte Benutzer: gleiche Rechenzeit, damit Benutzernamen nicht per Timing erraten werden können. */
async function fakeVerify(password) {
  if (!dummy) dummy = await hashPassword(crypto.randomBytes(8).toString('hex'));
  await verifyPassword(password, dummy);
  return false;
}

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
function generatePassword(len = 14) {
  let out = '';
  while (out.length < len) {
    const b = crypto.randomBytes(1)[0];
    if (b < 256 - (256 % ALPHABET.length)) out += ALPHABET[b % ALPHABET.length]; // ohne Modulo-Bias
  }
  return out;
}

function checkPasswordPolicy(password, username) {
  if (typeof password !== 'string') return 'Passwort fehlt.';
  if (password.length < 10) return 'Das Passwort muss mindestens 10 Zeichen lang sein.';
  if (password.length > 128) return 'Das Passwort darf höchstens 128 Zeichen lang sein.';
  if (username && password.toLowerCase() === String(username).toLowerCase()) return 'Das Passwort darf nicht dem Benutzernamen entsprechen.';
  return null;
}

module.exports = { hashPassword, verifyPassword, fakeVerify, sha256, newToken, generatePassword, checkPasswordPolicy };
