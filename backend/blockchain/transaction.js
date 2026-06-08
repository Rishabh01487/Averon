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