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
      version: C.PLATFORM_VERSION,
    });
    genesisTx.status = 'confirmed';

    const genesis = new Block(0, '0', [genesisTx], C.BLOCKCHAIN.GENESIS_TIMESTAMP);
    genesis.miner = 'GENESIS';
    genesis.difficulty = this.difficulty;
    genesis.mine(this.difficulty);
    genesis.transactions[0].blockIndex = 0;

    this.chain.push(genesis);
    this.save();
    console.log('  ⛓  Genesis block created: ' + genesis.hash.substring(0, 16) + '...');
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  load() {
    try {
      if (fs.existsSync(this.chainPath)) {
        const data = JSON.parse(fs.readFileSync(this.chainPath, 'utf8'));
        this.chain = data.chain.map(b => Block.fromJSON(b));
        this.pendingTransactions = (data.pending || []).map(tx => Transaction.fromJSON(tx));
        this.difficulty = data.difficulty || C.BLOCKCHAIN.DIFFICULTY;
      }
    } catch (e) {
      console.error('Chain load error:', e.message);
      this.chain = [];
    }
  }

  save() {
    try {
      const data = {
        version: C.PLATFORM_VERSION,
        difficulty: this.difficulty,
        chain: this.chain.map(b => b.toJSON()),
        pending: this.pendingTransactions.map(tx => tx.toJSON()),
        savedAt: Date.now(),
      };
      fs.writeFileSync(this.chainPath, JSON.stringify(data));
    } catch (e) {
      console.error('Chain save error:', e.message);
    }
  }

  // ── Transaction Pool ───────────────────────────────────────────────────────

  addTransaction(transaction) {
    // Validate transaction
    if (transaction.from !== 'SYSTEM') {
      if (!transaction.isValid()) {
        throw new Error('Invalid transaction signature');
      }
    }

    const ruleCheck = transaction.validateRules();
    if (!ruleCheck.valid) {
      throw new Error('Transaction rule violation: ' + ruleCheck.errors.join(', '));
    }

    // Check for duplicate
    const exists = this.pendingTransactions.find(tx => tx.hash === transaction.hash);
    if (exists) {
      throw new Error('Duplicate transaction');
    }

    // Check if already in a block
    for (const block of this.chain) {
      if (block.transactions.find(tx => tx.hash === transaction.hash)) {
        throw new Error('Transaction already confirmed');
      }
    }

    this.pendingTransactions.push(transaction);
    return transaction;
  }

  // ── Mining ─────────────────────────────────────────────────────────────────
