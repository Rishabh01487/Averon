// ══════════════════════════════════════════════════════════════════════════════
// AVERON CONSENSUS — Difficulty adjustment & chain validation rules
// ══════════════════════════════════════════════════════════════════════════════

const C = require('../config/constants');

/**
 * Calculate the new difficulty based on block mining times.