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
  const actualTime = endBlock.timestamp - startBlock.timestamp;
  const expectedTime = interval * C.BLOCKCHAIN.TARGET_BLOCK_TIME_MS;

  let newDifficulty = currentDifficulty;

  if (actualTime < expectedTime / 2) {
    // Blocks are mining too fast — increase difficulty
    newDifficulty = currentDifficulty + 1;
  } else if (actualTime > expectedTime * 2) {
    // Blocks are mining too slow — decrease difficulty
    newDifficulty = currentDifficulty - 1;
  }

  // Clamp within bounds
  newDifficulty = Math.max(C.BLOCKCHAIN.MIN_DIFFICULTY, Math.min(C.BLOCKCHAIN.MAX_DIFFICULTY, newDifficulty));
