// ══════════════════════════════════════════════════════════════════════════════
// AVERON BLOCKCHAIN ENGINE
// A real blockchain with SHA-256 hashing, proof-of-work, ECDSA wallets,
// and digitally signed transactions. Zero external dependencies.
// ══════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ── TRANSACTION ──────────────────────────────────────────────────────────────

class Transaction {
  /**
   * @param {string} from     - Sender wallet address (or 'SYSTEM' for minting)
   * @param {string} to       - Receiver wallet address
   * @param {number} amount   - Averon Coin amount
   * @param {string} type     - MINT | TRANSFER | INVEST | WITHDRAW | REFUND | ASSET_CREATE
   * @param {object} data     - Optional metadata (asset ID, description, etc.)
   */
  constructor(from, to, amount, type = 'TRANSFER', data = {}) {
    this.from = from;
    this.to = to;
    this.amount = parseFloat(amount) || 0;
    this.type = type;
    this.data = data;
    this.timestamp = Date.now();
    this.signature = null;
    this.signerPublicKey = null; // PEM public key for verification
    this.hash = this.calculateHash();
  }

  calculateHash() {
    return crypto.createHash('sha256').update(
      this.from + this.to + this.amount + this.type +
      JSON.stringify(this.data) + this.timestamp
    ).digest('hex');
  }

  sign(privateKeyPem, publicKeyPem) {
    if (this.from === 'SYSTEM') return; // System minting doesn't need signing
    const sign = crypto.createSign('SHA256');
    sign.update(this.hash);
    sign.end();
    this.signature = sign.sign(privateKeyPem, 'hex');
    if (publicKeyPem) this.signerPublicKey = publicKeyPem;
  }

  isValid() {
    // System transactions (minting, escrow operations) are always valid
    if (this.from === 'SYSTEM' || this.from.startsWith('ESCROW_')) return true;
    if (!this.signature || this.signature.length === 0) return false;

    try {
      if (!this.signerPublicKey) return false;
      const verify = crypto.createVerify('SHA256');
      verify.update(this.hash);
      verify.end();
      return verify.verify(this.signerPublicKey, this.signature, 'hex');
    } catch {
      return false;
    }
  }

  toJSON() {
    return {
      hash: this.hash,
      from: this.from,
      to: this.to,
      amount: this.amount,
      type: this.type,
      data: this.data,
      timestamp: this.timestamp,
      signature: this.signature,
      signerPublicKey: this.signerPublicKey
    };
  }

  static fromJSON(json) {
    const tx = new Transaction(json.from, json.to, json.amount, json.type, json.data);
    tx.timestamp = json.timestamp;
    tx.signature = json.signature;
    tx.signerPublicKey = json.signerPublicKey || null;
    tx.hash = json.hash || tx.calculateHash();
    return tx;
  }
}

// ── BLOCK ────────────────────────────────────────────────────────────────────

class Block {
  /**
   * @param {number}        index        - Block number in the chain
   * @param {Transaction[]} transactions - Array of transactions in this block
   * @param {string}        previousHash - Hash of the previous block
   */
  constructor(index, transactions, previousHash = '') {
    this.index = index;
    this.timestamp = Date.now();
    this.transactions = transactions;
    this.previousHash = previousHash;
    this.nonce = 0;
    this.hash = this.calculateHash();
  }

  calculateHash() {
    return crypto.createHash('sha256').update(
      this.index + this.previousHash + this.timestamp +
      JSON.stringify(this.transactions.map(t => t.hash || '')) + this.nonce
    ).digest('hex');
  }

  /**
   * Proof-of-Work: find a nonce that produces a hash with `difficulty` leading zeros
   */
  mine(difficulty) {
    const target = '0'.repeat(difficulty);
    while (this.hash.substring(0, difficulty) !== target) {
      this.nonce++;
      this.hash = this.calculateHash();
    }
    return this;
  }

  hasValidTransactions() {
    return this.transactions.every(tx => tx.isValid());
  }

  toJSON() {
    return {
      index: this.index,
      timestamp: this.timestamp,
      transactions: this.transactions.map(t => t.toJSON()),
      previousHash: this.previousHash,
      nonce: this.nonce,
      hash: this.hash
    };
  }

  static fromJSON(json) {
    const txs = (json.transactions || []).map(t => Transaction.fromJSON(t));
    const block = new Block(json.index, txs, json.previousHash);
    block.timestamp = json.timestamp;
    block.nonce = json.nonce;
    block.hash = json.hash;
    return block;
  }
}

// ── WALLET ───────────────────────────────────────────────────────────────────

class Wallet {
  constructor(existingKey = null) {
    if (existingKey) {
      this.privateKey = existingKey.privateKey;
      this.publicKey = existingKey.publicKey;
    } else {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'secp256k1',
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      });
      this.publicKey = publicKey;
      this.privateKey = privateKey;
    }
    this.address = this.getAddress();
  }

  /**
   * Derive a short hex address from the public key (like Ethereum-style 0x...)
   */
  getAddress() {
    const hash = crypto.createHash('sha256').update(this.publicKey).digest('hex');
    return '0x' + hash.substring(0, 40);
  }

  sign(transaction) {
    transaction.sign(this.privateKey, this.publicKey);
    return transaction;
  }

  toJSON() {
    return {
      publicKey: this.publicKey,
      privateKey: this.privateKey,
      address: this.address
    };
  }

  static fromJSON(json) {
    const w = new Wallet({ publicKey: json.publicKey, privateKey: json.privateKey });
    return w;
  }
}

// ── BLOCKCHAIN ───────────────────────────────────────────────────────────────

class Blockchain {
  /**
   * @param {string} dataDir - Directory to persist chain data
   */
  constructor(dataDir) {
    this.dataDir = dataDir || path.join(__dirname, 'data');
    this.chainFile = path.join(this.dataDir, 'chain.json');
    this.difficulty = 2;           // Leading zeros required in block hash
    this.miningReward = 0.1;       // Reward for mining a block
    this.pendingTransactions = [];
    this.chain = [];

    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });

    // Load existing chain or create genesis
    this.load();
  }

  createGenesisBlock() {
    const genesisTx = new Transaction('SYSTEM', 'SYSTEM', 0, 'MINT', { note: 'Genesis Block — Averon Chain Initialized' });
    const genesis = new Block(0, [genesisTx], '0');
    genesis.timestamp = Date.now();
    genesis.hash = genesis.calculateHash();
    return genesis;
  }

  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  /**
   * Add a transaction to the pending pool
   */
  addTransaction(transaction) {
    if (!transaction.from || !transaction.to) {
      throw new Error('Transaction must have from and to addresses');
    }

    // Validate signature (skip for system/escrow transactions)
    if (transaction.from !== 'SYSTEM' && !transaction.from.startsWith('ESCROW_')) {
      if (!transaction.isValid()) {
        throw new Error('Invalid transaction signature');
      }
    }

    this.pendingTransactions.push(transaction);
    return transaction;
  }

  /**
   * Mine all pending transactions into a new block
   * @param {string} minerAddress - Address to receive mining reward
   */
  minePendingTransactions(minerAddress) {
    if (this.pendingTransactions.length === 0) return null;

    // Add mining reward transaction
    const rewardTx = new Transaction('SYSTEM', minerAddress, this.miningReward, 'MINT', { note: 'Mining reward' });
    this.pendingTransactions.push(rewardTx);

    const block = new Block(
      this.chain.length,
      this.pendingTransactions,
      this.getLatestBlock().hash
    );

    block.mine(this.difficulty);
    this.chain.push(block);
    this.pendingTransactions = [];
    this.save();

    return block;
  }

  /**
   * Compute balance for a wallet address by scanning the entire chain
   */
  getBalance(address) {
    let balance = 0;
    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.from === address) balance -= tx.amount;
        if (tx.to === address) balance += tx.amount;
      }
    }
    // Also add pending transactions
    for (const tx of this.pendingTransactions) {
      if (tx.from === address) balance -= tx.amount;
      if (tx.to === address) balance += tx.amount;
    }
    return parseFloat(balance.toFixed(4));
  }

  /**
   * Get all transactions for an address
   */
  getTransactionsForAddress(address) {
    const txs = [];
    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.from === address || tx.to === address) {
          txs.push({ ...tx.toJSON(), blockIndex: block.index, blockHash: block.hash });
        }
      }
    }
    return txs.reverse(); // Newest first
  }

  /**
   * Find a transaction by hash
   */
  getTransactionByHash(hash) {
    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.hash === hash) {
          return { ...tx.toJSON(), blockIndex: block.index, blockHash: block.hash };
        }
      }
    }
    return null;
  }

  /**
   * Get total transaction count across all blocks
   */
  getTotalTransactionCount() {
    return this.chain.reduce((sum, block) => sum + block.transactions.length, 0);
  }

  /**
   * Validate the entire chain — check hashes and links
   */
  isChainValid() {
    for (let i = 1; i < this.chain.length; i++) {
      const current = this.chain[i];
      const previous = this.chain[i - 1];

      // Verify the block's own hash
      const recalculated = new Block(current.index, current.transactions, current.previousHash);
      recalculated.timestamp = current.timestamp;
      recalculated.nonce = current.nonce;
      if (current.hash !== recalculated.calculateHash()) {
        return { valid: false, error: `Block ${i} hash mismatch`, blockIndex: i };
      }

      // Verify chain link
      if (current.previousHash !== previous.hash) {
        return { valid: false, error: `Block ${i} broken chain link`, blockIndex: i };
      }
    }
    return { valid: true, blocks: this.chain.length, transactions: this.getTotalTransactionCount() };
  }

  /**
   * Get chain info summary
   */
  getInfo() {
    const latest = this.getLatestBlock();
    return {
      blocks: this.chain.length,
      transactions: this.getTotalTransactionCount(),
      difficulty: this.difficulty,
      lastBlockHash: latest ? latest.hash : null,
      lastBlockTime: latest ? latest.timestamp : null,
      pendingTransactions: this.pendingTransactions.length,
      miningReward: this.miningReward,
      chainValid: this.isChainValid().valid
    };
  }

  // ── PERSISTENCE ──────────────────────────────────────────────────────────

  save() {
    const data = {
      chain: this.chain.map(b => b.toJSON()),
      pendingTransactions: this.pendingTransactions.map(t => t.toJSON())
    };
    fs.writeFileSync(this.chainFile, JSON.stringify(data, null, 2));
  }

  load() {
    try {
      if (fs.existsSync(this.chainFile)) {
        const data = JSON.parse(fs.readFileSync(this.chainFile, 'utf8'));
        this.chain = (data.chain || []).map(b => Block.fromJSON(b));
        this.pendingTransactions = (data.pendingTransactions || []).map(t => Transaction.fromJSON(t));
        if (this.chain.length === 0) {
          this.chain = [this.createGenesisBlock()];
          this.save();
        }
      } else {
        this.chain = [this.createGenesisBlock()];
        this.save();
      }
    } catch (e) {
      console.warn('Failed to load chain, creating new genesis:', e.message);
      this.chain = [this.createGenesisBlock()];
      this.save();
    }
  }
}

// ── WALLET MANAGER ───────────────────────────────────────────────────────────

class WalletManager {
  constructor(dataDir) {
    this.dataDir = dataDir || path.join(__dirname, 'data');
    this.walletsFile = path.join(this.dataDir, 'wallets.json');
    this.wallets = {};  // userId → Wallet
    this.systemWallet = null;

    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
    this.load();
  }

  /**
   * Get or create a system wallet for mining rewards
   */
  getSystemWallet() {
    if (!this.systemWallet) {
      if (this.wallets['__SYSTEM__']) {
        this.systemWallet = this.wallets['__SYSTEM__'];
      } else {
        this.systemWallet = new Wallet();
        this.wallets['__SYSTEM__'] = this.systemWallet;
        this.save();
      }
    }
    return this.systemWallet;
  }

  /**
   * Create a new wallet for a user
   */
  createWallet(userId) {
    if (this.wallets[userId]) return this.wallets[userId];
    const wallet = new Wallet();
    this.wallets[userId] = wallet;
    this.save();
    return wallet;
  }

  /**
   * Get wallet for a user
   */
  getWallet(userId) {
    return this.wallets[userId] || null;
  }

  /**
   * Get user ID by wallet address
   */
  getUserByAddress(address) {
    for (const [userId, wallet] of Object.entries(this.wallets)) {
      if (wallet.address === address) return userId;
    }
    return null;
  }

  save() {
    const data = {};
    for (const [id, wallet] of Object.entries(this.wallets)) {
      data[id] = wallet.toJSON();
    }
    fs.writeFileSync(this.walletsFile, JSON.stringify(data, null, 2));
  }

  load() {
    try {
      if (fs.existsSync(this.walletsFile)) {
        const data = JSON.parse(fs.readFileSync(this.walletsFile, 'utf8'));
        for (const [id, wData] of Object.entries(data)) {
          this.wallets[id] = Wallet.fromJSON(wData);
        }
        if (this.wallets['__SYSTEM__']) {
          this.systemWallet = this.wallets['__SYSTEM__'];
        }
      }
    } catch (e) {
      console.warn('Failed to load wallets:', e.message);
    }
  }
}

// ── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = { Transaction, Block, Blockchain, Wallet, WalletManager };
