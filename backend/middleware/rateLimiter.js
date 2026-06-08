// ══════════════════════════════════════════════════════════════════════════════
// AVERON RATE LIMITER — Sliding window rate limiting
// ══════════════════════════════════════════════════════════════════════════════

const C = require('../config/constants');

// In-memory sliding window store
const windows = new Map();

// Clean old entries every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, entries] of windows) {
    const cleaned = entries.filter(t => now - t < 120000); // Keep 2 min window
    if (cleaned.length === 0) windows.delete(key);
    else windows.set(key, cleaned);
  }
}, 60000);

function createRateLimiter(config) {
  const { windowMs, max } = config;

  return (req, res, next) => {
    const key = `${req.ip}:${req.baseUrl || req.path}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    let entries = windows.get(key) || [];
    entries = entries.filter(t => t > windowStart);
    entries.push(now);
    windows.set(key, entries);

    // Set rate limit headers
    res.set('X-RateLimit-Limit', max);
    res.set('X-RateLimit-Remaining', Math.max(0, max - entries.length));
    res.set('X-RateLimit-Reset', Math.ceil((windowStart + windowMs) / 1000));

    if (entries.length > max) {
      const retryAfter = Math.ceil(windowMs / 1000);
      res.set('Retry-After', retryAfter);
      return res.status(429).json({
        error: 'Too many requests',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter,
        limit: max,
        windowMs,
      });
    }

    next();
  };
}

// Per-user rate limiter (uses userId from auth instead of IP)
function createUserRateLimiter(config) {
  const { windowMs, max } = config;

  return (req, res, next) => {
    if (!req.user) return next(); // Skip if no user (will be caught by auth middleware)

    const key = `user:${req.user.userId}:${req.baseUrl || req.path}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    let entries = windows.get(key) || [];
    entries = entries.filter(t => t > windowStart);
    entries.push(now);
    windows.set(key, entries);