// ══════════════════════════════════════════════════════════════════════════════
// AVERON TRANSACTION — Cryptographically signed blockchain transaction
// Every state change on the platform is a transaction.
// ══════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const C = require('../config/constants');

class Transaction {
  constructor(from, to, amount, type, data = {}) {
    this.from = from;               // Sender address (or 'SYSTEM' for mints)
    this.to = to;                   // Receiver address
    this.amount = parseFloat(amount) || 0;
    this.type = type;               // TX_TYPES constant
    this.data = data;               // Additional payload
    this.timestamp = Date.now();
    this.nonce = crypto.randomInt(0, 2 ** 32); // Unique per tx
    this.fee = 0;                   // Fee deducted (set by fee service)
    this.signature = '';            // ECDSA signature
    this.signerPublicKey = '';      // PEM public key of signer
    this.hash = this.calculateHash();
    this.status = 'pending';        // pending → confirmed → failed
    this.blockIndex = -1;           // Set when mined into a block
    this.confirmations = 0;         // Increases as more blocks are added
  }

  calculateHash() {
    const payload = JSON.stringify({
      from: this.from,
      to: this.to,
      amount: this.amount,
      type: this.type,
      data: this.data,
      timestamp: this.timestamp,
      nonce: this.nonce,
      fee: this.fee,
    });
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Sign this transaction with an ECDSA private key.
   */
  sign(privateKeyPem) {
    if (this.from === 'SYSTEM') return; // System transactions don't need signing

    const sign = crypto.createSign('SHA256');
    sign.update(this.hash);
    sign.end();
    this.signature = sign.sign(privateKeyPem, 'hex');
  }

  /**
   * Set the signer's public key (for verification).
   */
  setSignerPublicKey(publicKeyPem) {
    this.signerPublicKey = publicKeyPem;
  }

  /**
   * Verify the transaction's signature.
   */
  isValid() {
    // System transactions (mints, rewards) don't require signatures
    if (this.from === 'SYSTEM') return true;

    // Must have a signature
    if (!this.signature || !this.signerPublicKey) {
      return false;
    }

    try {
      const verify = crypto.createVerify('SHA256');
      verify.update(this.hash);
      verify.end();
      return verify.verify(this.signerPublicKey, this.signature, 'hex');
    } catch {
      return false;
    }
  }

  /**
   * Validate business rules for this transaction type.
   */
  validateRules() {
    const errors = [];

    // Amount checks
    if (this.amount < 0) errors.push('Amount cannot be negative');
    if (this.type === C.TX_TYPES.MINT && this.from !== 'SYSTEM') errors.push('Only SYSTEM can mint');
    if (this.type === C.TX_TYPES.REWARD && this.from !== 'SYSTEM') errors.push('Only SYSTEM can issue rewards');

    // Address checks
    if (!this.from) errors.push('From address required');
    if (!this.to) errors.push('To address required');
    if (this.from === this.to && this.type === C.TX_TYPES.TRANSFER) errors.push('Cannot transfer to self');

    // Type check
    if (!Object.values(C.TX_TYPES).includes(this.type)) errors.push('Invalid transaction type');

    return { valid: errors.length === 0, errors };
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
      nonce: this.nonce,
      fee: this.fee,
      signature: this.signature ? this.signature.substring(0, 32) + '...' : '',
      status: this.status,
      blockIndex: this.blockIndex,
      confirmations: this.confirmations,
    };
  }

  static fromJSON(json) {
    const tx = new Transaction(json.from, json.to, json.amount, json.type, json.data);
    tx.timestamp = json.timestamp;
    tx.nonce = json.nonce;
    tx.fee = json.fee || 0;
    tx.signature = json.signature || '';
    tx.signerPublicKey = json.signerPublicKey || '';
    tx.hash = json.hash || tx.calculateHash();
    tx.status = json.status || 'confirmed';
    tx.blockIndex = json.blockIndex ?? -1;
    tx.confirmations = json.confirmations || 0;