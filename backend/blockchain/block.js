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
