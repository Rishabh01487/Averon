// ══════════════════════════════════════════════════════════════════════════════
// AVERON CHAIN STORE — MongoDB persistence for the blockchain state
// ══════════════════════════════════════════════════════════════════════════════
//
// WHY:
//   The blockchain state (chain.json) was previously saved to the local
//   filesystem, which is ephemeral on Render's free tier — wiped on every
//   restart. This store persists the chain to MongoDB Atlas (free 512MB tier),
//   so the chain survives restarts.
//
// ARCHITECTURE:
//   - Each node has its own chain document in MongoDB (keyed by nodeId)
//   - This allows multiple nodes to share one MongoDB without chain conflicts
//   - On startup, the node loads its chain from MongoDB
//   - On every block mined or chain replaced, the node saves to MongoDB
//   - Falls back to filesystem if MongoDB is not configured
//
// ══════════════════════════════════════════════════════════════════════════════

const { getDb, isMongoEnabled } = require('../config/mongo');
const fs = require('fs');
const path = require('path');

const COLLECTION = 'chain_state';
const FILESYSTEM_FALLBACK_PATH = process.env.CHAIN_FILE || path.join(process.env.DATA_DIR || './data', 'chain.json');

/**
 * Load the chain state from MongoDB (primary) or filesystem (fallback).
 * @param {string} nodeId - this node's unique ID (for multi-node support)
 * @returns {{ chain: Array, pending: Array, difficulty: number } | null}
 */
async function loadChainState(nodeId) {
  // Try MongoDB first
  if (isMongoEnabled()) {
    try {
      const db = getDb();
      const doc = await db.collection(COLLECTION).findOne({ nodeId });
      if (doc) {
        console.log('  📦 Chain state loaded from MongoDB');
        return {
          chain: doc.chain || [],
          pending: doc.pending || [],
          difficulty: doc.difficulty || 2,
        };
      }
      console.log('  ℹ No chain state in MongoDB for this node — starting fresh');
      return null;
    } catch (e) {
      console.error('  ⚠ MongoDB chain load failed:', e.message);
    }
  }

  // Fallback: filesystem
  try {
    if (fs.existsSync(FILESYSTEM_FALLBACK_PATH)) {
      const data = JSON.parse(fs.readFileSync(FILESYSTEM_FALLBACK_PATH, 'utf8'));
      console.log('  📦 Chain state loaded from filesystem (fallback)');
      return {
        chain: data.chain || [],
        pending: data.pending || [],
        difficulty: data.difficulty || 2,
      };
    }
  } catch (e) {
    console.error('  ⚠ Filesystem chain load failed:', e.message);
  }

  return null;
}

/**
 * Save the chain state to MongoDB (primary) + filesystem (backup).
 * @param {string} nodeId - this node's unique ID
 * @param {Array} chain - the full blockchain array
 * @param {Array} pending - pending transactions
 * @param {number} difficulty - current difficulty
 */
async function saveChainState(nodeId, chain, pending, difficulty) {
  const state = {
    nodeId,
    chain,
    pending,
    difficulty,
    updatedAt: Date.now(),
    blockCount: chain.length,
  };

  // Save to MongoDB (primary)
  if (isMongoEnabled()) {
    try {
      const db = getDb();
      await db.collection(COLLECTION).updateOne(
        { nodeId },
        { $set: state },
        { upsert: true }
      );
    } catch (e) {
      console.error('  ⚠ MongoDB chain save failed:', e.message);
    }
  }

  // Mirror to filesystem (backup — works even without Mongo)
  try {
    const dir = path.dirname(FILESYSTEM_FALLBACK_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILESYSTEM_FALLBACK_PATH, JSON.stringify({
      chain: chain.map(b => b.toJSON ? b.toJSON() : b),
      pending: pending.map(t => t.toJSON ? t.toJSON() : t),
      difficulty,
    }));
  } catch (e) {
    console.error('  ⚠ Filesystem chain save failed:', e.message);
  }
}

/**
 * Create index on nodeId for fast lookups (called on startup).
 */
async function ensureIndexes() {
  if (!isMongoEnabled()) return;
  try {
    const db = getDb();
    await db.collection(COLLECTION).createIndex({ nodeId: 1 }, { unique: true });
  } catch (e) {
    console.error('  ⚠ Chain store index creation failed:', e.message);
  }
}

module.exports = { loadChainState, saveChainState, ensureIndexes };
