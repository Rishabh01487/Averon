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