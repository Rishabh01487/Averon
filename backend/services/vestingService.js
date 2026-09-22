// ══════════════════════════════════════════════════════════════════════════════
// AVERON VESTING SERVICE — Algorithm #9
// Token Lockup & Linear Vesting Schedule
// ══════════════════════════════════════════════════════════════════════════════
//
// PROBLEM:
//   When investors buy asset tokens, they currently receive them as immediately
//   transferable. This lets "flippers" dump tokens seconds after purchase —
//   which destroys price discovery for genuinely asset-backed tokens.
//
// SOLUTION:
//   Each asset gets a VestingSchedule (cliff + linear release). When an
//   investor buys tokens, a TokenVesting record is created. Tokens are
//   "locked" until the cliff passes, then linearly unlock over the vesting
//   period. Locked tokens cannot be transferred, sold, or withdrawn.
//
// VESTING MODELS:
//   - LINEAR:        e.g. 25% at purchase, 25% each quarter thereafter
//   - CLIFF:         0% until cliff date, then 100% at cliff
//   - HYBRID:        0% during cliff, then linear unlock after cliff
//                    (industry standard for asset-backed tokens)
//   - MILESTONE:     Unlock on predefined asset events (funded, payout, completed)
//
// DEFAULT (HYBRID):
//   - Cliff:      30 days   (no tokens unlockable)
//   - Vesting:    365 days  (linear unlock post-cliff)
//   - Total:      395 days from purchase to fully vested
//
// ══════════════════════════════════════════════════════════════════════════════

const C = require('../config/constants');

// ── Vesting Models ─────────────────────────────────────────────────────────
const VESTING_MODELS = {
  LINEAR:    'linear',      // Linear unlock from day 0
  CLIFF:     'cliff',       // 0% until cliff, then 100%
  HYBRID:    'hybrid',      // 0% during cliff, then linear (default)
  MILESTONE: 'milestone',   // Unlock on asset events
};

const DEFAULT_VESTING = {
  model: VESTING_MODELS.HYBRID,
  cliffDays: 30,        // 30-day cliff
  vestingDays: 365,     // 365-day linear vesting post-cliff
};

// Platform-enforced bounds (admin can tighten, never loosen)
const VESTING_BOUNDS = {
  MIN_CLIFF_DAYS: 0,
  MAX_CLIFF_DAYS: 180,
  MIN_VESTING_DAYS: 7,
  MAX_VESTING_DAYS: 730,    // 2 years max
};

class VestingService {
  constructor(db, blockchain, walletManager) {
    this.db = db;
    this.blockchain = blockchain;
    this.walletManager = walletManager;
  }

  // ── Schedule Management ──────────────────────────────────────────────────

  /**
   * Validate a vesting config against platform bounds.
   * Returns normalized config or throws.
   */
  validateSchedule(config) {
    const model = config?.model || DEFAULT_VESTING.model;
    if (!Object.values(VESTING_MODELS).includes(model)) {
      throw new Error(`Invalid vesting model: ${model}`);
    }

    let cliffDays = parseInt(config?.cliffDays ?? DEFAULT_VESTING.cliffDays, 10);
    let vestingDays = parseInt(config?.vestingDays ?? DEFAULT_VESTING.vestingDays, 10);

    if (isNaN(cliffDays) || cliffDays < VESTING_BOUNDS.MIN_CLIFF_DAYS) {
      cliffDays = VESTING_BOUNDS.MIN_CLIFF_DAYS;
    }
    if (cliffDays > VESTING_BOUNDS.MAX_CLIFF_DAYS) {
      throw new Error(`Cliff exceeds max ${VESTING_BOUNDS.MAX_CLIFF_DAYS} days`);
    }

    if (isNaN(vestingDays) || vestingDays < VESTING_BOUNDS.MIN_VESTING_DAYS) {
      vestingDays = VESTING_BOUNDS.MIN_VESTING_DAYS;
    }
    if (vestingDays > VESTING_BOUNDS.MAX_VESTING_DAYS) {
      throw new Error(`Vesting period exceeds max ${VESTING_BOUNDS.MAX_VESTING_DAYS} days`);
    }

    // For CLIFF model, vestingDays is 0 (everything unlocks at cliff)
    if (model === VESTING_MODELS.CLIFF) vestingDays = 0;

    // For MILESTONE model, no time-based unlock (handled by events)
    if (model === VESTING_MODELS.MILESTONE) { cliffDays = 0; vestingDays = 0; }

    return { model, cliffDays, vestingDays };
  }

  /**
   * Create a vesting schedule for an asset (at tokenization time).
   */
  createSchedule(assetId, config) {
    const validated = this.validateSchedule(config);

    // Check if schedule already exists
    const existing = this.db.queryOne('SELECT id FROM vesting_schedules WHERE asset_id = ?', [assetId]);
    if (existing) {
      throw new Error(`Vesting schedule already exists for asset ${assetId}`);
    }

    const now = Date.now();
    const { lastId } = this.db.run(
      `INSERT INTO vesting_schedules
        (asset_id, model, cliff_days, vesting_days, created_at)
       VALUES (?,?,?,?,?)`,
      [assetId, validated.model, validated.cliffDays, validated.vestingDays, now]
    );

    this.db.run(
      'INSERT INTO activity_log (user_id, action, details, created_at) VALUES (?,?,?,?)',
      [0, 'VESTING_SCHEDULE_CREATED',
       `Asset ${assetId}: ${validated.model} (cliff=${validated.cliffDays}d, vesting=${validated.vestingDays}d)`, now]
    );

    return { scheduleId: lastId, ...validated };
  }

  getSchedule(assetId) {
    return this.db.queryOne('SELECT * FROM vesting_schedules WHERE asset_id = ?', [assetId]);
  }

  // ── Per-Token Vesting Records ───────────────────────────────────────────

  /**
   * Create a vesting record when an investor buys tokens.
   * Each token purchase gets its own vesting timeline (cliff starts at purchase).
   */
  createVestingRecord(assetId, userId, tokenIds, purchaseTxHash) {
    const schedule = this.getSchedule(assetId);
    if (!schedule) {
      // No schedule = no vesting (backwards compat for pre-existing assets)
      return { vested: true, lockedCount: 0, unlockedCount: tokenIds.length };
    }

    const now = Date.now();
    const cliffEndsAt = now + schedule.cliff_days * 86400000;
    const fullyVestedAt = cliffEndsAt + schedule.vesting_days * 86400000;

    let recordsCreated = 0;
    for (const tokenId of tokenIds) {
      const { lastId } = this.db.run(
        `INSERT INTO token_vesting_records
          (asset_id, token_id, user_id, schedule_id, model, cliff_ends_at, fully_vested_at,
           total_tokens, unlocked_tokens, last_unlock_at, purchase_tx_hash, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [assetId, tokenId, userId, schedule.id, schedule.model,
         cliffEndsAt, fullyVestedAt, 1, 0, null, purchaseTxHash, now]
      );
      recordsCreated++;
    }

    // For MILESTONE model, immediately unlock 0% — unlocks happen on events
    // For CLIFF/LINEAR/HYBRID, the unlock checker will compute on demand

    return {
      recordsCreated,
      cliffEndsAt: schedule.cliff_days > 0 ? cliffEndsAt : null,
      fullyVestedAt,
      model: schedule.model,
    };
  }

  // ── Vesting Calculation (the actual algorithm) ──────────────────────────

  /**
   * Calculate how many tokens are unlocked for a vesting record at a given time.
   * This is the CORE algorithm.
   *
   * @param {Object} record - token_vesting_records row
   * @param {number} now - current timestamp (ms)
   * @returns {{ unlocked: number, locked: number, percentVested: number, nextUnlockAt: number|null }}
   */
  calculateUnlocked(record, now = Date.now()) {
    const total = record.total_tokens || 1;
    const model = record.model;
    const cliffEndsAt = record.cliff_ends_at || 0;
    const fullyVestedAt = record.fully_vested_at || 0;

    // MILESTONE: unlock only happens via markMilestoneReached()
    if (model === VESTING_MODELS.MILESTONE) {
      return {
        unlocked: record.unlocked_tokens || 0,
        locked: total - (record.unlocked_tokens || 0),
        percentVested: ((record.unlocked_tokens || 0) / total) * 100,
        nextUnlockAt: null,  // event-driven, not time-driven
      };
    }

    // Before cliff: 0 unlocked
    if (model === VESTING_MODELS.HYBRID && now < cliffEndsAt) {
      return {
        unlocked: 0,
        locked: total,
        percentVested: 0,
        nextUnlockAt: cliffEndsAt,
      };
    }

    // CLIFF model: 0% until cliff, then 100%
    if (model === VESTING_MODELS.CLIFF) {
      if (now < cliffEndsAt) {
        return { unlocked: 0, locked: total, percentVested: 0, nextUnlockAt: cliffEndsAt };
      }
      return { unlocked: total, locked: 0, percentVested: 100, nextUnlockAt: null };
    }

    // LINEAR model: linear unlock from day 0 (no cliff)
    // HYBRID model: linear unlock from cliff end to fully vested
    const startTime = model === VESTING_MODELS.LINEAR ? record.created_at : cliffEndsAt;
    const endTime = model === VESTING_MODELS.LINEAR ? fullyVestedAt - (cliffEndsAt - record.created_at) : fullyVestedAt;

    if (now >= endTime) {
      return { unlocked: total, locked: 0, percentVested: 100, nextUnlockAt: null };
    }

    if (now <= startTime) {
      return { unlocked: 0, locked: total, percentVested: 0, nextUnlockAt: startTime };
    }

    const elapsed = now - startTime;
    const total_duration = endTime - startTime;
    const percentVested = Math.min(100, (elapsed / total_duration) * 100);
    const unlockedFloat = total * (percentVested / 100);
    const unlocked = Math.floor(unlockedFloat);  // floor to avoid over-unlocking
    const locked = total - unlocked;

    return {
      unlocked,
      locked,
      percentVested: parseFloat(percentVested.toFixed(2)),
      nextUnlockAt: endTime,
    };
  }

  /**
   * Update unlocked_tokens for a record (called lazily on access).
   * Returns the actual unlocked count.
   */
  refreshRecord(recordId) {
    const record = this.db.queryOne('SELECT * FROM token_vesting_records WHERE id = ?', [recordId]);
    if (!record) return null;

    const calc = this.calculateUnlocked(record);
    if (calc.unlocked !== record.unlocked_tokens) {
      this.db.run(
        'UPDATE token_vesting_records SET unlocked_tokens = ?, last_unlock_at = ? WHERE id = ?',
        [calc.unlocked, Date.now(), recordId]
      );
    }
    return { ...record, ...calc };
  }

  // ── Lock Enforcement (used by trading/transfer/withdraw) ────────────────

  /**
   * Check if a specific asset token is currently locked (cannot be transferred).
   * Called by marketplace sell, withdrawal, and transfer endpoints.
   */
  isTokenLocked(assetId, tokenId, userId) {
    const record = this.db.queryOne(
      'SELECT * FROM token_vesting_records WHERE asset_id = ? AND token_id = ? AND user_id = ?',
      [assetId, tokenId, userId]
    );
    if (!record) return false;  // no vesting record = not locked (backwards compat)

    const calc = this.calculateUnlocked(record);
    // Token is locked if it's part of the "locked" portion
    // Simple heuristic: if unlocked_tokens < total, the latest tokens are still locked
    // (FIFO unlock: earliest purchased tokens unlock first)
    const refreshed = this.refreshRecord(record.id);
    // Get this user's tokens for this asset, ordered by purchase time
    const userTokens = this.db.query(
      `SELECT t.id FROM asset_tokens t
       JOIN token_vesting_records vr ON vr.token_id = t.id
       WHERE t.asset_id = ? AND t.owner_id = ?
       ORDER BY vr.created_at ASC`,
      [assetId, userId]
    );
    const tokenIndex = userTokens.findIndex(t => t.id === tokenId);
    // If this token's index is < unlocked count, it's unlocked
    return tokenIndex >= refreshed.unlocked_tokens;
  }

  /**
   * Get vesting summary for a user's holding in an asset.
   * Used by Portfolio page UI.
   */
  getUserVestingSummary(assetId, userId) {
    const records = this.db.query(
      'SELECT * FROM token_vesting_records WHERE asset_id = ? AND user_id = ?',
      [assetId, userId]
    );
    if (records.length === 0) return null;

    const schedule = this.getSchedule(assetId);
    if (!schedule) return null;

    let totalLocked = 0, totalUnlocked = 0;
    let earliestCliffEnd = Infinity, latestFullyVested = 0;

    for (const r of records) {
      const calc = this.calculateUnlocked(r);
      totalLocked += calc.locked;
      totalUnlocked += calc.unlocked;
      if (r.cliff_ends_at && r.cliff_ends_at < earliestCliffEnd) {
        earliestCliffEnd = r.cliff_ends_at;
      }
      if (r.fully_vested_at > latestFullyVested) {
        latestFullyVested = r.fully_vested_at;
      }
    }

    const total = totalLocked + totalUnlocked;
    const percentVested = total > 0 ? (totalUnlocked / total) * 100 : 0;

    return {
      schedule,
      totalTokens: total,
      unlockedTokens: totalUnlocked,
      lockedTokens: totalLocked,
      percentVested: parseFloat(percentVested.toFixed(2)),
      cliffEndsAt: earliestCliffEnd === Infinity ? null : earliestCliffEnd,
      fullyVestedAt: latestFullyVested || null,
      model: schedule.model,
    };
  }

  // ── Milestone Unlock (for MILESTONE model) ──────────────────────────────

  /**
   * Mark a milestone as reached and unlock tokens proportionally.
   * Used when asset hits predefined events: funded, payout, completed.
   */
  markMilestoneReached(assetId, milestone, unlockPercent) {
    const records = this.db.query(
      'SELECT * FROM token_vesting_records WHERE asset_id = ? AND model = ?',
      [assetId, VESTING_MODELS.MILESTONE]
    );
    let unlockedCount = 0;
    for (const r of records) {
      const newUnlocked = Math.min(r.total_tokens, Math.floor(r.total_tokens * unlockPercent / 100));
      if (newUnlocked > r.unlocked_tokens) {
        this.db.run(
          'UPDATE token_vesting_records SET unlocked_tokens = ?, last_unlock_at = ? WHERE id = ?',
          [newUnlocked, Date.now(), r.id]
        );
        unlockedCount += (newUnlocked - r.unlocked_tokens);
      }
    }

    this.db.run(
      'INSERT INTO vesting_events (asset_id, event_type, unlock_percent, tokens_unlocked, created_at) VALUES (?,?,?,?,?)',
      [assetId, `MILESTONE_${milestone}`, unlockPercent, unlockedCount, Date.now()]
    );

    return { milestone, tokensUnlocked: unlockedCount };
  }

  // ── Admin Override ──────────────────────────────────────────────────────

  /**
   * Admin force-unlock all tokens for a user (compliance: court order, dispute).
   */
  adminForceUnlock(assetId, userId, reason, adminId) {
    const records = this.db.query(
      'SELECT * FROM token_vesting_records WHERE asset_id = ? AND user_id = ?',
      [assetId, userId]
    );
    let unlockedCount = 0;
    for (const r of records) {
      if (r.unlocked_tokens < r.total_tokens) {
        const diff = r.total_tokens - r.unlocked_tokens;
        this.db.run(
          'UPDATE token_vesting_records SET unlocked_tokens = ?, last_unlock_at = ? WHERE id = ?',
          [r.total_tokens, Date.now(), r.id]
        );
        unlockedCount += diff;
      }
    }

    this.db.run(
      'INSERT INTO vesting_events (asset_id, user_id, event_type, tokens_unlocked, reason, admin_id, created_at) VALUES (?,?,?,?,?,?,?)',
      [assetId, userId, 'ADMIN_FORCE_UNLOCK', unlockedCount, reason, adminId, Date.now()]
    );

    this.db.run(
      'INSERT INTO activity_log (user_id, action, details, created_at) VALUES (?,?,?,?)',
      [adminId, 'ADMIN_VESTING_OVERRIDE',
       `Force-unlocked ${unlockedCount} tokens for user ${userId} on asset ${assetId}. Reason: ${reason}`, Date.now()]
    );

    return { tokensUnlocked: unlockedCount, reason };
  }

  // ── Scheduled Sweep (called by background timer) ───────────────────────

  /**
   * Refresh all vesting records (called every 5 minutes by background timer).
   * Ensures unlocked_tokens stays current even without user activity.
   */
  refreshAll() {
    const records = this.db.query('SELECT id FROM token_vesting_records WHERE unlocked_tokens < total_tokens');
    let refreshed = 0;
    for (const r of records) {
      const result = this.refreshRecord(r.id);
      if (result) refreshed++;
    }
    return { recordsChecked: records.length, refreshed };
  }
}

module.exports = { VestingService, VESTING_MODELS, DEFAULT_VESTING, VESTING_BOUNDS };
