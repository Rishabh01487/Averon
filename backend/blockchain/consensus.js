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

  return newDifficulty;
}

/**
 * Determine if a chain is valid by checking every block.
 */
function validateChain(chain) {
  if (chain.length === 0) return { valid: false, error: 'Empty chain' };

  // Validate genesis block
  const genesis = chain[0];
  if (genesis.index !== 0) return { valid: false, error: 'Genesis block must have index 0', block: 0 };
  if (genesis.previousHash !== '0') return { valid: false, error: 'Genesis previous hash must be "0"', block: 0 };

  // Validate each subsequent block
  for (let i = 1; i < chain.length; i++) {
    const currentBlock = chain[i];
    const previousBlock = chain[i - 1];

    // Index continuity
    if (currentBlock.index !== previousBlock.index + 1) {
      return { valid: false, error: 'Index discontinuity', block: i, expected: previousBlock.index + 1, got: currentBlock.index };
    }

    // Hash chain linkage
    if (currentBlock.previousHash !== previousBlock.hash) {
      return { valid: false, error: 'Previous hash mismatch', block: i };
    }

    // Hash integrity
    const recalculated = currentBlock.calculateHash();
    if (currentBlock.hash !== recalculated) {
      return { valid: false, error: 'Hash tampering detected', block: i };
    }

    // Difficulty
    const target = '0'.repeat(currentBlock.difficulty);
    if (!currentBlock.hash.startsWith(target)) {
      return { valid: false, error: 'Hash does not meet difficulty requirement', block: i };
    }

    // Merkle root
    if (typeof currentBlock.verifyMerkleRoot === 'function' && !currentBlock.verifyMerkleRoot()) {
      return { valid: false, error: 'Merkle root mismatch', block: i };
    }

    // Timestamp ordering
    if (currentBlock.timestamp <= previousBlock.timestamp) {
      return { valid: false, error: 'Timestamp must be after previous block', block: i };
    }
  }

  return { valid: true, blocks: chain.length };
}

/**
 * Chain selection rule — longest valid chain wins.
 * Used when resolving forks.
 */
function selectChain(currentChain, candidateChain) {
  const currentValid = validateChain(currentChain);
  const candidateValid = validateChain(candidateChain);

  if (!candidateValid.valid) return { winner: 'current', reason: 'Candidate chain is invalid' };
  if (!currentValid.valid) return { winner: 'candidate', reason: 'Current chain is invalid' };

  // Longest chain wins
  if (candidateChain.length > currentChain.length) {