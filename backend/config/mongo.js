// ══════════════════════════════════════════════════════════════════════════════
// AVERON MONGODB CONNECTION — Hosted database for user authentication
// ══════════════════════════════════════════════════════════════════════════════
//
// WHY MONGODB?
//   The in-built SQLite (sql.js WASM) writes to a local file (data/averon.db).
//   On ephemeral hosting (Render free tier), this file is wiped on every restart,
//   causing all user accounts to disappear. MongoDB Atlas (free 512MB tier)
//   provides a hosted, persistent database that survives restarts.
//
// SCOPE:
//   Only user authentication (users + sessions) is stored in MongoDB.
//   All other data (assets, tokens, blockchain, orders) stays in SQLite
//   for backwards compatibility and performance.
//
// SETUP:
//   1. Create a free cluster at https://www.mongodb.com/atlas
//   2. Add a database user (username + password)
//   3. Whitelist 0.0.0.0/0 (or your host's IP)
//   4. Copy the connection string (mongodb+srv://...)
//   5. Set MONGODB_URI env var on your hosting provider
//
// FALLBACK:
//   If MONGODB_URI is not set, the platform falls back to SQLite-only mode
//   (with a warning). This preserves backwards compatibility.
//
// ══════════════════════════════════════════════════════════════════════════════

const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URL || '';
const DB_NAME = process.env.MONGODB_DB || 'averon';

let client = null;
let db = null;
let isConnected = false;

/**
 * Initialize the MongoDB connection.
 * Returns true if connected, false if running in fallback (SQLite-only) mode.
 */
async function connectMongo() {
  if (!MONGODB_URI) {
    console.warn('  ⚠ MONGODB_URI not set — auth will use SQLite-only mode (users will not persist across restarts)');
    console.warn('  ℹ To enable persistent auth, set MONGODB_URI env var (MongoDB Atlas free tier: https://www.mongodb.com/atlas)');
    return false;
  }

  try {
    client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      maxPoolSize: 10,
    });
    await client.connect();
    db = client.db(DB_NAME);
    isConnected = true;

    // Create indexes for fast lookups
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('users').createIndex({ id: 1 }, { unique: true });
    await db.collection('users').createIndex({ wallet_address: 1 });
    await db.collection('sessions').createIndex({ refresh_token: 1 }, { unique: true });
    await db.collection('sessions').createIndex({ user_id: 1 });
    await db.collection('sessions').createIndex({ expires_at: 1 });

    console.log('  🍃 MongoDB connected — auth data will persist across restarts');
    return true;
  } catch (err) {
    console.error(`  ⚠ MongoDB connection failed: ${err.message}`);
    console.warn('  ℹ Falling back to SQLite-only mode for auth');
    isConnected = false;
    return false;
  }
}

/**
 * Get the MongoDB database instance.
 * Returns null if not connected.
 */
function getDb() {
  return isConnected ? db : null;
}

/**
 * Check if MongoDB is available.
 */
function isMongoEnabled() {
  return isConnected;
}

/**
 * Gracefully close the MongoDB connection.
 */
async function closeMongo() {
  if (client) {
    await client.close();
    isConnected = false;
    console.log('  🍃 MongoDB connection closed');
  }
}

module.exports = { connectMongo, getDb, isMongoEnabled, closeMongo };
