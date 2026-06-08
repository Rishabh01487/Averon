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