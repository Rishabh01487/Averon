// ══════════════════════════════════════════════════════════════════════════════
// AVERON USER STORE — MongoDB-backed user & session persistence
// ══════════════════════════════════════════════════════════════════════════════
//
// Provides CRUD operations for users and sessions against MongoDB.
// If MongoDB is not connected, falls back to SQLite (via the DB module)
// so the platform stays functional even without Mongo configured.
//
// All user records are ALSO mirrored to the SQLite `users` table on write,
// so existing services (assetService, tradingEngine, etc.) that query
// SQLite continue to work without modification.
//
// ══════════════════════════════════════════════════════════════════════════════

const { getDb, isMongoEnabled } = require('../config/mongo');
const crypto = require('crypto');

// ── USERS ─────────────────────────────────────────────────────────────────────

/**
 * Create a new user in MongoDB + mirror to SQLite.
 */
async function createUser(userData, sqliteDB) {
  const {
    id, email, passwordHash, name, organization = '',
    role = 'user', walletAddress, createdAt,
  } = userData;

  const userDoc = {
    id,
    email,
    password_hash: passwordHash,
    name,
    organization,
    role,
    wallet_address: walletAddress,
    created_at: createdAt,
    updated_at: createdAt,
    last_login: 0,
    login_attempts: 0,
    locked_until: 0,
    is_frozen: 0,
    kyc_tier: 0,
    kyc_status: 'unverified',
    averon_balance: 0,
    inr_withdrawn: 0,
  };

  // Write to MongoDB (source of truth)
  if (isMongoEnabled()) {
    const db = getDb();
    try {
      await db.collection('users').insertOne(userDoc);
    } catch (err) {
      if (err.code === 11000) {
        throw new Error('Email already registered');
      }
      throw err;
    }
  }

  // Mirror to SQLite (for backwards-compat with existing services)
  if (sqliteDB) {
    try {
      sqliteDB.run(
        `INSERT OR IGNORE INTO users
          (id, email, password_hash, name, organization, role, wallet_address,
           created_at, updated_at, last_login, login_attempts, locked_until,
           is_frozen, kyc_tier, kyc_status, averon_balance, inr_withdrawn)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, email, passwordHash, name, organization, role, walletAddress,
         createdAt, createdAt, 0, 0, 0, 0, 0, 'unverified', 0, 0]
      );
    } catch (e) {
      console.error('  ⚠ SQLite user mirror failed:', e.message);
    }
  }

  return userDoc;
}

/**
 * Find a user by email.
 * Prefers MongoDB; falls back to SQLite if Mongo is not configured.
 */
async function findUserByEmail(email, sqliteDB) {
  if (isMongoEnabled()) {
    const db = getDb();
    const user = await db.collection('users').findOne({ email });
    if (user) {
      // Mirror to SQLite if missing (handles first login after restart)
      _mirrorToSQLite(user, sqliteDB);
      return user;
    }
    return null;
  }
  // Fallback: SQLite only
  if (sqliteDB) {
    return sqliteDB.queryOne('SELECT * FROM users WHERE email = ?', [email]);
  }
  return null;
}

/**
 * Find a user by ID.
 */
async function findUserById(userId, sqliteDB) {
  if (isMongoEnabled()) {
    const db = getDb();
    const user = await db.collection('users').findOne({ id: userId });
    if (user) {
      _mirrorToSQLite(user, sqliteDB);
      return user;
    }
    return null;
  }
  if (sqliteDB) {
    return sqliteDB.queryOne('SELECT * FROM users WHERE id = ?', [userId]);
  }
  return null;
}

/**
 * Update user fields.
 * @param {string} userId - user ID
 * @param {object} updates - fields to update (e.g. { login_attempts: 1, locked_until: ... })
 * @param {object} sqliteDB - SQLite DB instance (for mirror)
 */
async function updateUser(userId, updates, sqliteDB) {
  const updateDoc = { $set: { ...updates, updated_at: Date.now() } };

  if (isMongoEnabled()) {
    const db = getDb();
    await db.collection('users').updateOne({ id: userId }, updateDoc);
  }

  // Mirror to SQLite
  if (sqliteDB) {
    const setClauses = [];
    const values = [];
    for (const [k, v] of Object.entries(updates)) {
      setClauses.push(`${k} = ?`);
      values.push(v);
    }
    setClauses.push('updated_at = ?');
    values.push(Date.now());
    values.push(userId);
    try {
      sqliteDB.run(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`, values);
    } catch (e) {
      console.error('  ⚠ SQLite user update mirror failed:', e.message);
    }
  }
}

/**
 * Increment login attempts; lock account if threshold reached.
 */
async function incrementLoginAttempts(userId, maxAttempts, lockoutMs, sqliteDB) {
  if (isMongoEnabled()) {
    const db = getDb();
    const result = await db.collection('users').findOneAndUpdate(
      { id: userId },
      { $inc: { login_attempts: 1 }, $set: { updated_at: Date.now() } },
      { returnDocument: 'after' }
    );
    const user = result.value || result;
    if (user && user.login_attempts >= maxAttempts) {
      await db.collection('users').updateOne(
        { id: userId },
        { $set: { locked_until: Date.now() + lockoutMs } }
      );
      // Mirror to SQLite
      if (sqliteDB) {
        sqliteDB.run('UPDATE users SET login_attempts = ?, locked_until = ? WHERE id = ?',
          [user.login_attempts, Date.now() + lockoutMs, userId]);
      }
      return { locked: true, attempts: user.login_attempts };
    }
    // Mirror to SQLite
    if (sqliteDB) {
      sqliteDB.run('UPDATE users SET login_attempts = ? WHERE id = ?', [user.login_attempts, userId]);
    }
    return { locked: false, attempts: user.login_attempts };
  }
  // Fallback: SQLite
  if (sqliteDB) {
    const user = sqliteDB.queryOne('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) return { locked: false, attempts: 0 };
    const attempts = (user.login_attempts || 0) + 1;
    if (attempts >= maxAttempts) {
      sqliteDB.run('UPDATE users SET login_attempts = ?, locked_until = ? WHERE id = ?',
        [attempts, Date.now() + lockoutMs, userId]);
      return { locked: true, attempts };
    }
    sqliteDB.run('UPDATE users SET login_attempts = ? WHERE id = ?', [attempts, userId]);
    return { locked: false, attempts };
  }
  return { locked: false, attempts: 0 };
}

/**
 * Reset login attempts on successful login.
 */
async function resetLoginAttempts(userId, sqliteDB) {
  await updateUser(userId, {
    login_attempts: 0,
    locked_until: 0,
    last_login: Date.now(),
  }, sqliteDB);
}

// ── SESSIONS ──────────────────────────────────────────────────────────────────

/**
 * Create a new session (refresh token record).
 */
async function createSession(userId, refreshToken, expiresAt, sqliteDB) {
  const sessionDoc = {
    user_id: userId,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    is_revoked: false,
    created_at: Date.now(),
  };

  if (isMongoEnabled()) {
    const db = getDb();
    await db.collection('sessions').insertOne(sessionDoc);
  }

  // Mirror to SQLite
  if (sqliteDB) {
    try {
      sqliteDB.run(
        'INSERT OR IGNORE INTO sessions (user_id, refresh_token, expires_at, is_revoked, created_at) VALUES (?,?,?,?,?)',
        [userId, refreshToken, expiresAt, 0, Date.now()]
      );
    } catch (e) {
      console.error('  ⚠ SQLite session mirror failed:', e.message);
    }
  }

  return sessionDoc;
}

/**
 * Find a session by refresh token.
 */
async function findSession(refreshToken, sqliteDB) {
  if (isMongoEnabled()) {
    const db = getDb();
    const session = await db.collection('sessions').findOne({ refresh_token: refreshToken });
    if (session) return session;
  }
  if (sqliteDB) {
    return sqliteDB.queryOne('SELECT * FROM sessions WHERE refresh_token = ?', [refreshToken]);
  }
  return null;
}

/**
 * Revoke a session (logout).
 */
async function revokeSession(refreshToken, sqliteDB) {
  if (isMongoEnabled()) {
    const db = getDb();
    await db.collection('sessions').updateOne(
      { refresh_token: refreshToken },
      { $set: { is_revoked: true } }
    );
  }
  if (sqliteDB) {
    sqliteDB.run('UPDATE sessions SET is_revoked = 1 WHERE refresh_token = ?', [refreshToken]);
  }
}

/**
 * Revoke all sessions for a user.
 */
async function revokeAllUserSessions(userId, sqliteDB) {
  if (isMongoEnabled()) {
    const db = getDb();
    await db.collection('sessions').updateMany(
      { user_id: userId, is_revoked: false },
      { $set: { is_revoked: true } }
    );
  }
  if (sqliteDB) {
    sqliteDB.run('UPDATE sessions SET is_revoked = 1 WHERE user_id = ?', [userId]);
  }
}

/**
 * Delete expired sessions (cleanup).
 */
async function cleanupExpiredSessions(sqliteDB) {
  const now = Date.now();
  if (isMongoEnabled()) {
    const db = getDb();
    await db.collection('sessions').deleteMany({ expires_at: { $lt: now } });
  }
  if (sqliteDB) {
    sqliteDB.run('DELETE FROM sessions WHERE expires_at < ?', [now]);
  }
}

// ── SYNC (used on startup to rebuild SQLite from Mongo) ───────────────────────

/**
 * Sync all users from MongoDB into the SQLite `users` table.
 * Called once on server startup. Ensures existing services that read from
 * SQLite continue to find user records after a Render restart wipes the file.
 */
async function syncUsersFromMongoToSQLite(sqliteDB) {
  if (!isMongoEnabled()) return { synced: 0 };
  if (!sqliteDB) return { synced: 0 };

  const db = getDb();
  const users = await db.collection('users').find({}).toArray();
  let synced = 0;
  for (const user of users) {
    try {
      sqliteDB.run(
        `INSERT OR IGNORE INTO users
          (id, email, password_hash, name, organization, role, wallet_address,
           created_at, updated_at, last_login, login_attempts, locked_until,
           is_frozen, kyc_tier, kyc_status, averon_balance, inr_withdrawn)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          user.id, user.email, user.password_hash, user.name, user.organization || '',
          user.role || 'user', user.wallet_address,
          user.created_at || Date.now(), user.updated_at || Date.now(),
          user.last_login || 0, user.login_attempts || 0, user.locked_until || 0,
          user.is_frozen ? 1 : 0, user.kyc_tier || 0, user.kyc_status || 'unverified',
          user.averon_balance || 0, user.inr_withdrawn || 0,
        ]
      );
      synced++;
    } catch (e) {
      console.error(`  ⚠ Failed to sync user ${user.id}:`, e.message);
    }
  }
  return { synced };
}

// ── PRIVATE: mirror helper ────────────────────────────────────────────────────

function _mirrorToSQLite(user, sqliteDB) {
  if (!sqliteDB) return;
  try {
    sqliteDB.run(
      `INSERT OR IGNORE INTO users
        (id, email, password_hash, name, organization, role, wallet_address,
         created_at, updated_at, last_login, login_attempts, locked_until,
         is_frozen, kyc_tier, kyc_status, averon_balance, inr_withdrawn)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        user.id, user.email, user.password_hash, user.name, user.organization || '',
        user.role || 'user', user.wallet_address,
        user.created_at || Date.now(), user.updated_at || Date.now(),
        user.last_login || 0, user.login_attempts || 0, user.locked_until || 0,
        user.is_frozen ? 1 : 0, user.kyc_tier || 0, user.kyc_status || 'unverified',
        user.averon_balance || 0, user.inr_withdrawn || 0,
      ]
    );
  } catch (e) {
    // Silently ignore — mirror is best-effort
  }
}

module.exports = {
  createUser,
  findUserByEmail,
  findUserById,
  updateUser,
  incrementLoginAttempts,
  resetLoginAttempts,
  createSession,
  findSession,
  revokeSession,
  revokeAllUserSessions,
  cleanupExpiredSessions,
  syncUsersFromMongoToSQLite,
};
