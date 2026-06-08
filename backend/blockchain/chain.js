// ══════════════════════════════════════════════════════════════════════════════
// AVERON BLOCKCHAIN — Core engine with Merkle trees, consensus, and UTXO
// ══════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { Block } = require('./block');
const { Transaction } = require('./transaction');
const { MerkleTree } = require('./merkle');
const { adjustDifficulty, validateChain, getChainStats } = require('./consensus');
const C = require('../config/constants');

class Blockchain {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.chainPath = path.join(dataDir, 'chain.json');
    this.chain = [];
    this.pendingTransactions = [];
    this.difficulty = C.BLOCKCHAIN.DIFFICULTY;
    this.miningReward = C.BLOCKCHAIN.MINING_REWARD;

    this.load();
    if (this.chain.length === 0) {
      this.createGenesisBlock();
    }
  }

  // ── Genesis Block ──────────────────────────────────────────────────────────

  createGenesisBlock() {
    const genesisTx = new Transaction('SYSTEM', 'SYSTEM', 0, C.TX_TYPES.MINT, {
      message: 'Averon Genesis Block — Real-World Asset Tokenization Platform',