// ══════════════════════════════════════════════════════════════════════════════
// AVERON NODE IDENTITY — Per-node cryptographic identity
// ══════════════════════════════════════════════════════════════════════════════
//
// Each Averon node has its own ECDSA secp256k1 key pair for signing P2P messages.
// This proves message authenticity in the consortium network:
// only whitelisted node identities can participate.
//
// In consortium mode, the platform operator pre-approves a list of trusted node
// public keys. Any P2P message signed by a non-whitelisted key is rejected.
//
// ══════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const NODE_ID_FILE = process.env.NODE_IDENTITY_FILE || path.join(process.env.DATA_DIR || './data', 'node-identity.json');

class NodeIdentity {
  constructor() {
    this.nodeId = '';
    this.publicKey = '';
    this.privateKey = '';
    this.loadOrCreate();
  }

  loadOrCreate() {
    try {
      if (fs.existsSync(NODE_ID_FILE)) {
        const data = JSON.parse(fs.readFileSync(NODE_ID_FILE, 'utf8'));
        this.nodeId = data.nodeId;
        this.publicKey = data.publicKey;
        this.privateKey = data.privateKey;
        console.log(`  🔑 Node identity loaded: ${this.nodeId.substring(0, 16)}...`);
        return;
      }
    } catch (e) {
      console.error('  ⚠ Node identity load failed:', e.message);
    }

    // Generate new ECDSA secp256k1 key pair
    const keyPair = crypto.generateKeyPairSync('ec', {
      namedCurve: 'secp256k1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    this.publicKey = keyPair.publicKey;
    this.privateKey = keyPair.privateKey;

    // Node ID = SHA-256(publicKey) first 16 bytes hex (like a peer ID)
    const hash = crypto.createHash('sha256').update(this.publicKey).digest('hex');
    this.nodeId = 'node_' + hash.substring(0, 32);

    // Persist
    try {
      const dir = path.dirname(NODE_ID_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(NODE_ID_FILE, JSON.stringify({
        nodeId: this.nodeId,
        publicKey: this.publicKey,
        privateKey: this.privateKey,
        createdAt: Date.now(),
      }, null, 2));
      console.log(`  🔑 New node identity created: ${this.nodeId.substring(0, 16)}...`);
    } catch (e) {
      console.error('  ⚠ Failed to persist node identity:', e.message);
    }
  }

  /**
   * Sign a P2P message payload with the node's private key.
   * @param {string|object} payload - message to sign
   * @returns {string} hex signature
   */
  sign(payload) {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const sign = crypto.createSign('SHA256');
    sign.update(data);
    sign.end();
    return sign.sign(this.privateKey, 'hex');
  }

  /**
   * Verify a signed message using the signer's public key.
   * @param {string|object} payload - original message
   * @param {string} signature - hex signature
   * @param {string} publicKeyPem - signer's PEM public key
   * @returns {boolean}
   */
  static verify(payload, signature, publicKeyPem) {
    try {
      const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const verify = crypto.createVerify('SHA256');
      verify.update(data);
      verify.end();
      return verify.verify(publicKeyPem, signature, 'hex');
    } catch {
      return false;
    }
  }

  /**
   * Get a short display-friendly node ID (first 12 chars after prefix).
   */
  getShortId() {
    return this.nodeId.substring(0, 20) + '...';
  }

  /**
   * Get full identity info (for handshake with peers).
   * NOTE: never sends the private key.
   */
  getPublicIdentity() {
    return {
      nodeId: this.nodeId,
      publicKey: this.publicKey,
    };
  }
}

module.exports = { NodeIdentity };
