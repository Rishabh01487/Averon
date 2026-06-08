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
function adjustDifficulty(chain) {
  const interval = C.BLOCKCHAIN.DIFFICULTY_ADJUSTMENT_INTERVAL;
  const lastBlock = chain[chain.length - 1];
  const currentDifficulty = lastBlock.difficulty || C.BLOCKCHAIN.DIFFICULTY;

  // Only adjust at interval boundaries
  if (chain.length < interval || chain.length % interval !== 0) {
    return currentDifficulty;
  }

  const startBlock = chain[chain.length - interval];
  const endBlock = lastBlock;