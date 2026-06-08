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