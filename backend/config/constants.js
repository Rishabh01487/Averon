// ══════════════════════════════════════════════════════════════════════════════
// AVERON SYSTEM CONSTANTS
// Central configuration for the entire platform.
// ══════════════════════════════════════════════════════════════════════════════

module.exports = {
  // ── Platform ───────────────────────────────────────────────────────────────
  PLATFORM_NAME: 'Averon',
  PLATFORM_VERSION: '4.0.0',
  PLATFORM_CURRENCY: 'AC', // Averon Coin
  PLATFORM_FIAT: 'INR',

  // ── Authentication ─────────────────────────────────────────────────────────
  AUTH: {
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    BCRYPT_SALT_ROUNDS: 12,
    MAX_LOGIN_ATTEMPTS: 5,
    LOCKOUT_DURATION_MS: 15 * 60 * 1000, // 15 minutes
    PASSWORD_MIN_LENGTH: 8,
    SESSION_CLEANUP_INTERVAL_MS: 60 * 60 * 1000, // 1 hour
  },

  // ── Rate Limiting ──────────────────────────────────────────────────────────
  RATE_LIMITS: {
    GENERAL: { windowMs: 60 * 1000, max: 100 },      // 100 req/min
    AUTH: { windowMs: 60 * 1000, max: 10 },            // 10 req/min
    FINANCIAL: { windowMs: 1000, max: 5 },             // 5 req/sec
    UPLOAD: { windowMs: 60 * 1000, max: 10 },          // 10 uploads/min
    ADMIN: { windowMs: 60 * 1000, max: 200 },          // 200 req/min
  },

  // ── Blockchain ─────────────────────────────────────────────────────────────
  BLOCKCHAIN: {
    DIFFICULTY: 2,
    DIFFICULTY_ADJUSTMENT_INTERVAL: 10,  // blocks
    TARGET_BLOCK_TIME_MS: 30 * 1000,     // 30 seconds
    MIN_DIFFICULTY: 1,
    MAX_DIFFICULTY: 6,
    MINING_REWARD: 0.1,