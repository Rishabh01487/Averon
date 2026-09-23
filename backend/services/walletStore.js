// ══════════════════════════════════════════════════════════════════════════════
// AVERON WALLET STORE — MongoDB persistence for ECDSA wallets
// ══════════════════════════════════════════════════════════════════════════════
//
// WHY:
//   ECDSA private keys (secp256k1) are the most critical data in the system.
//   If wallets.json is wiped, every user loses access to their AC coins
//   permanently — there is no recovery without the private key.
//
// ARCHITECTURE:
//   - All wallets (user + system + platform-fee) are stored in MongoDB
//   - Shared across all nodes (so users can log in on any node)
//   - On startup, all wallets are loaded from MongoDB into memory
//   - On every wallet creation, the wallet is saved to MongoDB + filesystem
//
// SECURITY NOTE:
//   Private keys are stored as PEM strings in MongoDB. In production, these
//   should be encrypted at rest using a KMS or application-level encryption.
//   For now, MongoDB Atlas provides encryption at rest on all tiers.
//
// ══════════════════════════════════════════════════════════════════════════════

const { getDb, isMongoEnabled } = require('../config/mongo');
const fs = require('fs');
const path = require('path');

const COLLECTION = 'wallets';
const FILESYSTEM_FALLBACK_PATH = process.env.WALLETS_FILE || path.join(process.env.DATA_DIR || './data', 'wallets.json');

/**
 * Load all wallets from MongoDB (primary) or filesystem (fallback).
 * @returns {Object} - map of userId → { publicKey, privateKey, address }
 */
async function loadWallets() {
  if (isMongoEnabled()) {
    try {
      const db = getDb();
      const docs = await db.collection(COLLECTION).find({}).toArray();
      if (docs.length > 0) {
        const wallets = {};
        for (const doc of docs) {
          wallets[doc.userId] = {
            publicKey: doc.publicKey,
            privateKey: doc.privateKey,
            address: doc.address,
          };
        }
        console.log(`  🔑 Loaded ${docs.length} wallet(s) from MongoDB`);
        return wallets;
      }
      console.log('  ℹ No wallets in MongoDB — starting fresh');
      return {};
    } catch (e) {
      console.error('  ⚠ MongoDB wallet load failed:', e.message);
    }
  }

  // Fallback: filesystem
  try {
    if (fs.existsSync(FILESYSTEM_FALLBACK_PATH)) {
      const data = JSON.parse(fs.readFileSync(FILESYSTEM_FALLBACK_PATH, 'utf8'));
      console.log(`  🔑 Loaded ${Object.keys(data).length} wallet(s) from filesystem (fallback)`);
      return data;
    }
  } catch (e) {
    console.error('  ⚠ Filesystem wallet load failed:', e.message);
  }

  return {};
}

/**
 * Save a single wallet to MongoDB + filesystem.
 * @param {string} userId - user ID (or 'SYSTEM', '__PLATFORM_FEE__')
 * @param {Object} wallet - { publicKey, privateKey, address }
 */
async function saveWallet(userId, wallet) {
  const doc = {
    userId,
    publicKey: wallet.publicKey,
    privateKey: wallet.privateKey,
    address: wallet.address,
    updatedAt: Date.now(),
  };

  if (isMongoEnabled()) {
    try {
      const db = getDb();
      await db.collection(COLLECTION).updateOne(
        { userId },
        { $set: doc },
        { upsert: true }
      );
    } catch (e) {
      console.error('  ⚠ MongoDB wallet save failed:', e.message);
    }
  }

  // Filesystem mirror is handled by wallet.js on save() — we don't duplicate here
  // to avoid race conditions with the in-memory wallets object.
}

/**
 * Save ALL wallets to MongoDB (called on wallet.js save()).
 * @param {Object} wallets - map of userId → { publicKey, privateKey, address }
 */
async function saveAllWallets(wallets) {
  if (!isMongoEnabled()) return;

  try {
    const db = getDb();
    const ops = Object.entries(wallets).map(([userId, w]) => ({
      updateOne: {
        filter: { userId },
        update: { $set: {
          userId,
          publicKey: w.publicKey,
          privateKey: w.privateKey,
          address: w.address,
          updatedAt: Date.now(),
        }},
        upsert: true,
      },
    }));

    if (ops.length > 0) {
      await db.collection(COLLECTION).bulkWrite(ops);
    }
  } catch (e) {
    console.error('  ⚠ MongoDB bulk wallet save failed:', e.message);
  }

  // Also save to filesystem as backup
  try {
    const dir = path.dirname(FILESYSTEM_FALLBACK_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILESYSTEM_FALLBACK_PATH, JSON.stringify(wallets, null, 2));
  } catch (e) {
    console.error('  ⚠ Filesystem wallet save failed:', e.message);
  }
}

/**
 * Get a wallet by address (used for balance lookups).
 */
async function findWalletByAddress(address) {
  if (isMongoEnabled()) {
    try {
      const db = getDb();
      return await db.collection(COLLECTION).findOne({ address });
    } catch (e) {
      console.error('  ⚠ MongoDB wallet lookup failed:', e.message);
    }
  }
  return null;
}

/**
 * Create indexes (called on startup).
 */
async function ensureIndexes() {
  if (!isMongoEnabled()) return;
  try {
    const db = getDb();
    await db.collection(COLLECTION).createIndex({ userId: 1 }, { unique: true });
    await db.collection(COLLECTION).createIndex({ address: 1 });
  } catch (e) {
    console.error('  ⚠ Wallet store index creation failed:', e.message);
  }
}

module.exports = { loadWallets, saveWallet, saveAllWallets, findWalletByAddress, ensureIndexes };
