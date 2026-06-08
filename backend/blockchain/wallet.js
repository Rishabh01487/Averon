// ══════════════════════════════════════════════════════════════════════════════
// AVERON WALLET — ECDSA secp256k1 Key Management
// Same elliptic curve as Bitcoin and Ethereum.
// ══════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class Wallet {
  constructor(userId) {
    this.userId = userId;
    const keyPair = crypto.generateKeyPairSync('ec', {
      namedCurve: 'secp256k1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    this.publicKey = keyPair.publicKey;
    this.privateKey = keyPair.privateKey;
    this.address = this.deriveAddress();
  }

  deriveAddress() {
    const hash = crypto.createHash('sha256').update(this.publicKey).digest('hex');
    const ripemd = crypto.createHash('ripemd160').update(hash).digest('hex');
    return '0x' + ripemd;
  }

  sign(transaction) {
    if (typeof transaction.sign === 'function') {
      transaction.sign(this.privateKey);
      transaction.setSignerPublicKey(this.publicKey);
    }
  }

  static fromKeys(userId, publicKey, privateKey) {
    const wallet = Object.create(Wallet.prototype);
    wallet.userId = userId;
    wallet.publicKey = publicKey;
    wallet.privateKey = privateKey;