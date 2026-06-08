// ══════════════════════════════════════════════════════════════════════════════
// AVERON BLOCK — Blockchain block with Merkle root
// ══════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { MerkleTree } = require('./merkle');
const { Transaction } = require('./transaction');
const C = require('../config/constants');

class Block {
  constructor(index, previousHash, transactions = [], timestamp = Date.now()) {
    this.version = 1;
    this.index = index;
    this.previousHash = previousHash;
    this.timestamp = timestamp;
    this.transactions = transactions;
    this.nonce = 0;
    this.difficulty = C.BLOCKCHAIN.DIFFICULTY;
    this.miner = '';

    // Build Merkle tree from transactions
    this.merkleRoot = this.computeMerkleRoot();
    this.hash = this.calculateHash();
    this.size = 0; // Calculated after mining
  }

  computeMerkleRoot() {
    if (this.transactions.length === 0) {
      return crypto.createHash('sha256').update('empty-block').digest('hex');
    }
    const tree = MerkleTree.fromTransactions(this.transactions);
    return tree.getRoot();
  }

  calculateHash() {
    const payload = JSON.stringify({
      version: this.version,
      index: this.index,
      previousHash: this.previousHash,
      timestamp: this.timestamp,
      merkleRoot: this.merkleRoot,
      nonce: this.nonce,
      difficulty: this.difficulty,
      miner: this.miner,
      txCount: this.transactions.length,
    });
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Mine this block — find a nonce that produces a hash starting with `difficulty` zeros.
   */
  mine(difficulty) {
    this.difficulty = difficulty || this.difficulty;
    const target = '0'.repeat(this.difficulty);
    const startTime = Date.now();

    while (!this.hash.startsWith(target)) {
      this.nonce++;
      this.hash = this.calculateHash();

      // Safety: prevent infinite loop (max 10 million attempts)
      if (this.nonce > 10000000) {
        throw new Error('Mining exceeded maximum attempts');
      }
    }

    this.size = this.calculateSize();
    const miningTime = Date.now() - startTime;
    return { hash: this.hash, nonce: this.nonce, time: miningTime };
  }

  calculateSize() {
    return Buffer.byteLength(JSON.stringify(this.toJSON()), 'utf8');
  }

  /**
   * Validate all transactions in this block.
   */
  validateTransactions() {
    const errors = [];
    for (let i = 0; i < this.transactions.length; i++) {
      const tx = this.transactions[i];
      if (!tx.isValid()) {
        errors.push({ txIndex: i, hash: tx.hash, error: 'Invalid signature' });
      }
      const ruleCheck = tx.validateRules();
      if (!ruleCheck.valid) {
        errors.push({ txIndex: i, hash: tx.hash, errors: ruleCheck.errors });
      }
    }
    return { valid: errors.length === 0, errors };
  }

  /**
   * Verify the Merkle root matches the transactions.
   */
  verifyMerkleRoot() {
    const computed = this.computeMerkleRoot();
    return computed === this.merkleRoot;
  }

  /**
   * Get a Merkle proof for a specific transaction.
   */
  getMerkleProof(txHash) {
    const tree = MerkleTree.fromTransactions(this.transactions);
    const index = this.transactions.findIndex(tx => {
      const h = typeof tx === 'string' ? tx : (tx.hash || '');
      return h === txHash;
    });
    if (index === -1) return null;
    return { proof: tree.getProof(index), root: this.merkleRoot };
  }

  /**
   * Validate the block's timestamp is reasonable.
   */
  validateTimestamp(previousBlockTimestamp) {
    // Must be after previous block
    if (this.timestamp <= previousBlockTimestamp) return false;
    // Must not be too far in the future
    if (this.timestamp > Date.now() + C.BLOCKCHAIN.MAX_FUTURE_BLOCK_TIME_MS) return false;
    return true;
  }

  /**
   * Validate the block's hash meets difficulty requirement.
   */
  validateHash() {
    const target = '0'.repeat(this.difficulty);
    const recalculated = this.calculateHash();
    return this.hash === recalculated && this.hash.startsWith(target);
  }

  /**
   * Full block validation.
   */
  validate(previousBlock) {
    const errors = [];

    // Hash validation
    if (!this.validateHash()) errors.push('Invalid hash or does not meet difficulty');

    // Previous hash link
    if (previousBlock && this.previousHash !== previousBlock.hash) errors.push('Previous hash mismatch');

    // Merkle root
    if (!this.verifyMerkleRoot()) errors.push('Merkle root mismatch');

    // Timestamp
    if (previousBlock && !this.validateTimestamp(previousBlock.timestamp)) errors.push('Invalid timestamp');