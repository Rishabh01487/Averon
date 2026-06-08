// ══════════════════════════════════════════════════════════════════════════════
// AVERON AUTH MIDDLEWARE — JWT + bcrypt + Session Management
// ══════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const C = require('../config/constants');

// ── JWT Implementation (zero-dependency) ─────────────────────────────────────
// We implement JWT from scratch using Node's crypto module.
// This avoids the `jsonwebtoken` dependency while maintaining full JWT spec.

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(64).toString('hex');

function base64url(str) {
  return Buffer.from(str).toString('base64url');
}

function base64urlDecode(str) {
  return Buffer.from(str, 'base64url').toString('utf8');
}

function signJWT(payload, secret, expiresIn) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);

  let expSeconds;
  if (typeof expiresIn === 'string') {
    const match = expiresIn.match(/^(\d+)(m|h|d)$/);
    if (match) {
      const val = parseInt(match[1]);
      const unit = match[2];
      expSeconds = val * (unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400);
    } else {
      expSeconds = 900; // 15min default
    }
  } else {
    expSeconds = expiresIn || 900;
  }

  const fullPayload = { ...payload, iat: now, exp: now + expSeconds };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(fullPayload));
  const signature = crypto.createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  return `${headerB64}.${payloadB64}.${signature}`;
}

function verifyJWT(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signature] = parts;
    const expectedSig = crypto.createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    if (signature !== expectedSig) return null;

    const payload = JSON.parse(base64urlDecode(payloadB64));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

// ── Password Hashing (PBKDF2 — zero-dependency bcrypt alternative) ───────────
// PBKDF2 with SHA-512, 100k iterations — OWASP recommended.

const HASH_ITERATIONS = 100000;
const HASH_KEYLEN = 64;
const HASH_DIGEST = 'sha512';

async function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(32).toString('hex');
    crypto.pbkdf2(password, salt, HASH_ITERATIONS, HASH_KEYLEN, HASH_DIGEST, (err, key) => {
      if (err) reject(err);
      resolve(`${salt}:${HASH_ITERATIONS}:${key.toString('hex')}`);
    });
  });
}

async function verifyPassword(password, hash) {
  return new Promise((resolve, reject) => {
    const [salt, iterations, key] = hash.split(':');
    crypto.pbkdf2(password, salt, parseInt(iterations), HASH_KEYLEN, HASH_DIGEST, (err, derivedKey) => {