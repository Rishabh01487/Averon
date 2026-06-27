const C = require('../config/constants');

class KYCService {
  constructor(db) {
    this.db = db;
    this._ensureLimitsTracker();
  }

  _ensureLimitsTracker() {
    const today = this._today();
    this.db.run(
      `INSERT OR IGNORE INTO daily_limits (user_id, date, created_at, updated_at)
       SELECT id, ?, ?, ? FROM users`, [today, Date.now(), Date.now()]
    );
  }

  _today() {
    return new Date().toISOString().split('T')[0];
  }

  getUserTier(userId) {
    const record = this.db.queryOne('SELECT current_tier FROM kyc_records WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);
    return record?.current_tier || 0;
  }

  getTierConfig(tier) {
    const tiers = C.KYC.TIERS;
    for (const [, config] of Object.entries(tiers)) {
      if (config.level === tier) return config;
    }
    return tiers.UNVERIFIED;
  }

  submitKYC(userId, docType, docNumber, filepath) {
    if (!Object.values(C.KYC.DOCUMENTS).includes(docType)) {
      throw new Error(`Invalid document type: ${docType}`);
    }

    const existing = this.db.queryOne(
      'SELECT id FROM kyc_records WHERE user_id = ? AND doc_type = ? AND doc_status = "verified"',
      [userId, docType]
    );
    if (existing) throw new Error('Document already verified');

    const now = Date.now();
    this.db.run(
      'INSERT INTO kyc_records (user_id, doc_type, doc_number, doc_filepath, doc_status, submitted_at) VALUES (?,?,?,?,?,?)',
      [userId, docType, docNumber, filepath, 'pending', now]
    );

    this.db.run('INSERT INTO activity_log (user_id, action, details, created_at) VALUES (?,?,?,?)',
      [userId, 'KYC_SUBMITTED', `${docType} submitted for verification`, now]);

    return { submitted: true, docType, status: 'pending' };
  }

  verifyKYC(recordId, verifierUserId, approved, reason = '') {
    const record = this.db.queryOne('SELECT * FROM kyc_records WHERE id = ?', [recordId]);
    if (!record) throw new Error('KYC record not found');

    if (approved) {
      this.db.run('UPDATE kyc_records SET doc_status = ?, verified_by = ?, verified_at = ? WHERE id = ?',
        ['verified', verifierUserId, Date.now(), recordId]);
      const newTier = this._calculateNewTier(record.user_id);
      this._upgradeTier(record.user_id, newTier, verifierUserId, 'KYC approved');
      return { approved: true, newTier };
    }

    this.db.run('UPDATE kyc_records SET doc_status = ?, rejection_reason = ? WHERE id = ?',
      ['rejected', reason, recordId]);
    this.db.run('INSERT INTO activity_log (user_id, action, details, created_at) VALUES (?,?,?,?)',
      [record.user_id, 'KYC_REJECTED', `${record.doc_type}: ${reason}`, Date.now()]);

    return { approved: false, newTier: 0 };
  }

  _upgradeTier(userId, newTier, changedBy, reason) {
    const currentTier = this.getUserTier(userId);
    if (newTier <= currentTier) return;

    this.db.run('INSERT INTO kyc_tier_history (user_id, old_tier, new_tier, changed_by, reason, created_at) VALUES (?,?,?,?,?,?)',
      [userId, currentTier, newTier, changedBy, reason, Date.now()]);

    this.db.run('UPDATE kyc_records SET current_tier = ? WHERE user_id = ? AND id = (SELECT MAX(id) FROM kyc_records WHERE user_id = ?)', [newTier, userId, userId]);
    this.db.run('UPDATE users SET kyc_status = ? WHERE id = ?', [this.getTierConfig(newTier).label, userId]);

    this.db.run('INSERT INTO activity_log (user_id, action, details, created_at) VALUES (?,?,?,?)',
      [userId, 'KYC_TIER_UPGRADED',
       `Tier ${currentTier} → Tier ${newTier}: ${this.getTierConfig(newTier).label}`, Date.now()]);
  }

  _calculateNewTier(userId) {
    const verifiedDocs = this.db.queryOne(
      "SELECT COUNT(*) as c FROM kyc_records WHERE user_id = ? AND doc_status = 'verified'", [userId]
    )?.c || 0;

    const account = this.db.queryOne('SELECT created_at FROM users WHERE id = ?', [userId]);
    const ageDays = account ? Math.floor((Date.now() - account.created_at) / 86400000) : 0;

    const totalSpent = this.db.queryOne(
      'SELECT COALESCE(SUM(fiat_amount), 0) as total FROM payment_orders WHERE user_id = ? AND status = ?',
      [userId, C.PAYMENT.ORDER_STATUS.COMPLETED]
    )?.total || 0;

    const txCount = this.db.queryOne(
      'SELECT COUNT(*) as c FROM payment_orders WHERE user_id = ? AND status = ?',
      [userId, C.PAYMENT.ORDER_STATUS.COMPLETED]
    )?.c || 0;

    const thresholds = C.KYC.TIER_UPGRADE_THRESHOLDS;
    const tiers = [3, 2, 1, 0];

    for (const tier of tiers) {
      const t = thresholds[tier];
      if (!t) continue;
      if (txCount >= t.minTrades && totalSpent >= t.minVolume && ageDays >= t.minAgeDays) {
        return tier;
      }
    }
    return verifiedDocs >= 1 ? 1 : 0;
  }

  checkPurchaseLimit(userId, amount) {
    let tier = this.getUserTier(userId);
    let config = this.getTierConfig(tier);
    const today = this._today();

    // Only auto-grant in development mode — production requires real KYC
    if (config.dailyLimit <= 0 && tier === 0) {
      if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
        this._autoGrantBasicTier(userId);
        tier = 1;
        config = this.getTierConfig(tier);
      } else {
        return { approved: false, reason: 'KYC verification required before making purchases. Please submit your identity documents.' };
      }
    }

    if (config.dailyLimit <= 0) {
      return { approved: false, reason: `Tier ${tier} (${config.label}) cannot make purchases. Complete KYC to upgrade.` };
    }

    let usage = this.db.queryOne(
      'SELECT total_bought, tx_count FROM daily_limits WHERE user_id = ? AND date = ?', [userId, today]
    );

    if (!usage) {
      this.db.run('INSERT OR IGNORE INTO daily_limits (user_id, date, total_bought, tx_count, created_at, updated_at) VALUES (?,?,0,0,?,?)',
        [userId, today, Date.now(), Date.now()]);
      usage = { total_bought: 0, tx_count: 0 };
    }

    const newDailyTotal = (usage.total_bought || 0) + amount;
    if (newDailyTotal > config.dailyLimit) {
      return {
        approved: false,
        reason: `Daily purchase limit of ₹${config.dailyLimit.toLocaleString()} exceeded. Tier: ${config.label}. Remaining: ₹${Math.max(0, config.dailyLimit - (usage.total_bought || 0)).toLocaleString()}`,
      };
    }

    const monthlyTotal = this.db.queryOne(
      `SELECT COALESCE(SUM(fiat_amount), 0) as total FROM payment_orders
       WHERE user_id = ? AND status = ? AND created_at > ?`,
      [userId, C.PAYMENT.ORDER_STATUS.COMPLETED, Date.now() - 30 * 86400000]
    )?.total || 0;

    if (monthlyTotal + amount > config.monthlyLimit) {
      return { approved: false, reason: 'Monthly purchase limit exceeded' };
    }

    return { approved: true, tier, dailyRemaining: config.dailyLimit - newDailyTotal };
  }

  screenTransaction(userId, amount, type) {
    const flags = [];
    const user = this.db.queryOne('SELECT * FROM users WHERE id = ?', [userId]);

    if (amount >= 1000000) flags.push(C.KYC.AML_FLAGS.HIGH_VALUE);
    if (amount % 10000 === 0 && amount >= 100000) flags.push(C.KYC.AML_FLAGS.ROUND_AMOUNT);

    const recentTx = this.db.queryOne(
      `SELECT COUNT(*) as c FROM payment_orders WHERE user_id = ? AND created_at > ?`,
      [userId, Date.now() - 60000]
    );
    if ((recentTx?.c || 0) >= 3) flags.push(C.KYC.AML_FLAGS.RAPID_SEQUENTIAL);

    const accountAge = user ? Date.now() - user.created_at : Infinity;
    if (amount >= 500000 && accountAge < 7 * 86400000) {
      flags.push(C.KYC.AML_FLAGS.NEW_ACCOUNT_HIGH_VALUE);
    }

    if (flags.length >= 2) {
      this.db.run('INSERT INTO activity_log (user_id, action, details, amount, created_at) VALUES (?,?,?,?,?)',
        [userId, 'AML_FLAGGED', `Flags: ${flags.join(', ')}`, amount, Date.now()]);
    }

    return { flags, blocked: flags.length >= 3, reason: flags.length >= 3 ? `AML flags: ${flags.join(', ')}` : '' };
  }

  incrementUsage(userId, amount) {
    const today = this._today();
    const existing = this.db.queryOne('SELECT id FROM daily_limits WHERE user_id = ? AND date = ?', [userId, today]);

    if (existing) {
      this.db.run('UPDATE daily_limits SET total_bought = total_bought + ?, tx_count = tx_count + 1, updated_at = ? WHERE id = ?',
        [amount, Date.now(), existing.id]);
    } else {
      this.db.run('INSERT INTO daily_limits (user_id, date, total_bought, tx_count, created_at, updated_at) VALUES (?,?,?,1,?,?)',
        [userId, today, amount, Date.now(), Date.now()]);
    }
  }

  getKYCStatus(userId) {
    const tier = this.getUserTier(userId);
    const config = this.getTierConfig(tier);
    const records = this.db.query(
      "SELECT * FROM kyc_records WHERE user_id = ? ORDER BY submitted_at DESC", [userId]
    );
    const history = this.db.query(
      'SELECT * FROM kyc_tier_history WHERE user_id = ? ORDER BY created_at DESC', [userId]
    );

    return {
      currentTier: tier,
      tierLabel: config.label,
      dailyLimit: config.dailyLimit,
      monthlyLimit: config.monthlyLimit,
      annualLimit: config.annualLimit,
      records: records.map(r => ({
        id: r.id, docType: r.doc_type, status: r.doc_status,
        submittedAt: r.submitted_at, rejectionReason: r.rejection_reason,
      })),
      tierHistory: history.map(h => ({
        oldTier: h.old_tier, newTier: h.new_tier,
        reason: h.reason, date: h.created_at,
      })),
    };
  }

  getPendingVerifications() {
    return this.db.query(
      `SELECT kr.*, u.name as user_name, u.email as user_email
       FROM kyc_records kr JOIN users u ON kr.user_id = u.id
       WHERE kr.doc_status = 'pending' ORDER BY kr.submitted_at ASC`
    );
  }

  _autoGrantBasicTier(userId) {
    const now = Date.now();
    // Insert a system-verified KYC record
    this.db.run(
      'INSERT INTO kyc_records (user_id, doc_type, doc_number, doc_filepath, doc_status, current_tier, submitted_at, verified_at, verified_by) VALUES (?,?,?,?,?,?,?,?,?)',
      [userId, 'auto_basic', 'AUTO_BASIC_TIER', '', 'verified', 1, now, now, 'system']
    );
    this.db.run('UPDATE users SET kyc_status = ? WHERE id = ?', ['Basic KYC', userId]);
    this.db.run('INSERT INTO activity_log (user_id, action, details, created_at) VALUES (?,?,?,?)',
      [userId, 'KYC_AUTO_BASIC', 'Auto-granted Basic KYC tier for testing', now]);
  }

  autoUpgradeAll() {
    const users = this.db.query('SELECT id FROM users');
    for (const user of users) {
      const newTier = this._calculateNewTier(user.id);
      const currentTier = this.getUserTier(user.id);
      if (newTier > currentTier) {
        this._upgradeTier(user.id, newTier, 'system', 'Automatic tier upgrade based on activity');
      }
    }
  }
}

module.exports = { KYCService };
