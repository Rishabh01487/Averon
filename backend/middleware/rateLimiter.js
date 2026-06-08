// ══════════════════════════════════════════════════════════════════════════════
// AVERON RATE LIMITER — Sliding window rate limiting
// ══════════════════════════════════════════════════════════════════════════════

const C = require('../config/constants');

// In-memory sliding window store
const windows = new Map();