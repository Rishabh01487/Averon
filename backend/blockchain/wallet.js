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