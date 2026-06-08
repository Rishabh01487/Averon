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
    wallet.address = wallet.deriveAddress();
    return wallet;
  }

  toJSON() {
    return {
      userId: this.userId,
      address: this.address,
      publicKey: this.publicKey,
      privateKey: this.privateKey, // Only for storage — never send to client
    };
  }
}

// ── Wallet Manager ───────────────────────────────────────────────────────────

class WalletManager {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.walletsPath = path.join(dataDir, 'wallets.json');
    this.wallets = {};
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.walletsPath)) {
        const data = JSON.parse(fs.readFileSync(this.walletsPath, 'utf8'));
        for (const [userId, w] of Object.entries(data)) {
          this.wallets[userId] = Wallet.fromKeys(userId, w.publicKey, w.privateKey);
        }
      }
    } catch (e) {
      console.error('Wallet load error:', e.message);
      this.wallets = {};
    }
  }

  save() {
    const data = {};
    for (const [userId, wallet] of Object.entries(this.wallets)) {
      data[userId] = wallet.toJSON();
    }
    fs.writeFileSync(this.walletsPath, JSON.stringify(data, null, 2));
  }

  createWallet(userId) {
    if (this.wallets[userId]) return this.wallets[userId];
    const wallet = new Wallet(userId);
    this.wallets[userId] = wallet;
    this.save();
    return wallet;
  }

  getWallet(userId) {
    return this.wallets[userId] || null;
  }

  getWalletByAddress(address) {
    return Object.values(this.wallets).find(w => w.address === address) || null;
  }

  getSystemWallet() {
    if (!this.wallets['__SYSTEM__']) {
      this.wallets['__SYSTEM__'] = new Wallet('__SYSTEM__');
      this.save();
    }
    return this.wallets['__SYSTEM__'];
  }

  getPlatformFeeWallet() {
    if (!this.wallets['__PLATFORM_FEE__']) {
      this.wallets['__PLATFORM_FEE__'] = new Wallet('__PLATFORM_FEE__');
      this.save();
    }
    return this.wallets['__PLATFORM_FEE__'];