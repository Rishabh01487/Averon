// ══════════════════════════════════════════════════════════════════════════════
// AVERON CONSENSUS — Difficulty adjustment & chain validation rules
// ══════════════════════════════════════════════════════════════════════════════

const C = require('../config/constants');

/**
 * Calculate the new difficulty based on block mining times.
 * Adjusts every DIFFICULTY_ADJUSTMENT_INTERVAL blocks.
 * If blocks are mined too fast → increase difficulty.
 * If blocks are mined too slow → decrease difficulty.
 */