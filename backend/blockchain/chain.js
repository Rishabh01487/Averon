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

  minePendingTransactions(minerAddress) {
    if (this.pendingTransactions.length === 0) return null;

    // Select transactions for this block (up to max)
    const txsToMine = this.pendingTransactions.slice(0, C.BLOCKCHAIN.MAX_TRANSACTIONS_PER_BLOCK);

    // Add mining reward
    const rewardTx = new Transaction('SYSTEM', minerAddress, this.miningReward, C.TX_TYPES.REWARD, {
      blockIndex: this.chain.length,
    });
    rewardTx.status = 'confirmed';
    txsToMine.push(rewardTx);

    // Create new block
    const previousBlock = this.getLatestBlock();
    const newBlock = new Block(
      this.chain.length,
      previousBlock.hash,
      txsToMine
    );
    newBlock.miner = minerAddress;
    newBlock.difficulty = this.difficulty;

    // Mine it
    const mineResult = newBlock.mine(this.difficulty);

    // Mark transactions as confirmed
    for (const tx of txsToMine) {
      tx.status = 'confirmed';
      tx.blockIndex = newBlock.index;
    }

    // Update confirmation counts for previous blocks
    for (const block of this.chain) {
      for (const tx of block.transactions) {
        tx.confirmations = newBlock.index - tx.blockIndex;
      }
    }

    // Add to chain
    this.chain.push(newBlock);

    // Remove mined transactions from pending pool
    const minedHashes = new Set(txsToMine.map(tx => tx.hash));
    this.pendingTransactions = this.pendingTransactions.filter(tx => !minedHashes.has(tx.hash));

    // Adjust difficulty
    this.difficulty = adjustDifficulty(this.chain);

    // Persist
    this.save();

    return newBlock;
  }

  // ── Balance Calculation (UTXO-style) ───────────────────────────────────────

  getBalance(address) {
    let balance = 0;

    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.to === address) balance += tx.amount;
        if (tx.from === address) balance -= (tx.amount + (tx.fee || 0));
      }
    }

    // Also account for pending outgoing
    for (const tx of this.pendingTransactions) {
      if (tx.from === address) balance -= (tx.amount + (tx.fee || 0));
    }

    return parseFloat(Math.max(0, balance).toFixed(8));
  }

  /**
   * Get all transactions for an address (full history).
   */
  getTransactionHistory(address, limit = 50) {
    const txs = [];
    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.from === address || tx.to === address) {
          txs.push({
            ...tx.toJSON(),
            direction: tx.to === address ? 'in' : 'out',
            blockIndex: block.index,
            blockHash: block.hash,
            confirmations: this.chain.length - block.index,
          });
        }
      }