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
      if (err) reject(err);
      resolve(derivedKey.toString('hex') === key);
    });
  });
}

// ── Token Generation ─────────────────────────────────────────────────────────

function generateTokens(user) {
  const accessPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    walletAddress: user.wallet_address,
  };

  const accessToken = signJWT(accessPayload, JWT_SECRET, C.AUTH.JWT_ACCESS_EXPIRY);
  const refreshToken = signJWT({ userId: user.id, type: 'refresh' }, JWT_REFRESH_SECRET, C.AUTH.JWT_REFRESH_EXPIRY);

  return { accessToken, refreshToken };
}

function verifyAccessToken(token) {
  return verifyJWT(token, JWT_SECRET);
}

function verifyRefreshToken(token) {
  return verifyJWT(token, JWT_REFRESH_SECRET);
}

// ── Auth Middleware ───────────────────────────────────────────────────────────

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
  }

  const token = authHeader.substring(7);
  const payload = verifyAccessToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token', code: 'TOKEN_INVALID' });
  }

  // Attach user info to request
  req.user = payload;
  next();
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const payload = verifyAccessToken(token);
    if (payload) req.user = payload;
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    }
    next();
  };
}

function requireAdmin(req, res, next) {
  return requireRole(C.ROLES.ADMIN)(req, res, next);
}

// ── Session Management ───────────────────────────────────────────────────────

function createSession(db, userId, refreshToken, req) {
  const { run } = db;
  const sessionId = crypto.randomUUID();
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
  const deviceInfo = req.headers['user-agent'] || '';
  const ip = req.ip || req.connection?.remoteAddress || '';

  run('INSERT INTO sessions (id, user_id, refresh_token, device_info, ip_address, expires_at, created_at) VALUES (?,?,?,?,?,?,?)',
    [sessionId, userId, refreshToken, deviceInfo, ip, expiresAt, Date.now()]);

  return sessionId;
}

function revokeSession(db, sessionId) {
  db.run('UPDATE sessions SET is_revoked = 1 WHERE id = ?', [sessionId]);
}

function revokeAllUserSessions(db, userId) {
  db.run('UPDATE sessions SET is_revoked = 1 WHERE user_id = ?', [userId]);
}

function cleanExpiredSessions(db) {
  db.run('DELETE FROM sessions WHERE expires_at < ? OR is_revoked = 1', [Date.now()]);
}

// ── EXPORTS ──────────────────────────────────────────────────────────────────