const C = require('../config/constants');

class ComplianceService {
  constructor(db) {
    this.db = db;
  }

  checkPreListing(asset) {
    const checks = { passed: true, warnings: [], failures: [], score: 0 };

    // Raise amount limits
    if (asset.raise_amount < C.LIMITS.MIN_RAISE_AMOUNT) {
      checks.failures.push(`Raise amount below minimum ₹${C.LIMITS.MIN_RAISE_AMOUNT}`);
    }
    if (asset.raise_amount > C.LIMITS.MAX_RAISE_AMOUNT) {
      checks.failures.push(`Raise amount exceeds maximum ₹${C.LIMITS.MAX_RAISE_AMOUNT.toLocaleString()}`);
    }

    // Description length
    if (!asset.description || asset.description.length < 50) {
      checks.warnings.push('Description is too short (min 50 characters)');
    }

    // Document requirements
    const docCount = this.db.queryOne('SELECT COUNT(*) as c FROM asset_documents WHERE asset_id = ?', [asset.id])?.c || 0;
    const minDocs = parseInt(this.db.getConfig('min_documents_required') || C.LIMITS.MIN_DOCUMENTS);
    if (docCount < minDocs) {
      checks.failures.push(`Need at least ${minDocs} document(s), have ${docCount}`);
    }

    // Cooling-off period
    if (asset.cooling_off_until && asset.cooling_off_until > Date.now()) {
      const remaining = Math.ceil((asset.cooling_off_until - Date.now()) / 3600000);
      checks.warnings.push(`Cooling-off period active (${remaining}h remaining)`);
    }

    checks.passed = checks.failures.length === 0;
    checks.score = Math.round(100 - (checks.failures.length * 20 + checks.warnings.length * 5));
    return checks;
  }

  checkInvestorExposure(userId, assetId, amount) {
    const user = this.db.queryOne('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) throw new Error('User not found');

    const wallet = this.db.queryOne('SELECT address FROM wallets WHERE user_id = ?', [userId]);
    const totalBalance = wallet ? this.db.queryOne('SELECT averon_balance FROM users WHERE id = ?', [userId])?.averon_balance || 0 : 0;

    // Check max concentration
    const maxExposure = totalBalance * C.LIMITS.MAX_PORTFOLIO_CONCENTRATION;
    const existingInAsset = this.db.queryOne(
      'SELECT SUM(price) as total FROM asset_tokens WHERE asset_id = ? AND owner_id = ?', [assetId, userId]
    )?.total || 0;

    if (existingInAsset + amount > maxExposure) {
      return { approved: false, reason: `Would exceed ${C.LIMITS.MAX_PORTFOLIO_CONCENTRATION * 100}% portfolio concentration limit` };
    }

    // Check if user is frozen
    if (user.is_frozen) {
      return { approved: false, reason: 'Account is frozen' };
    }

    return { approved: true };
  }

  monitorTransaction(userId, type, amount, details = {}) {
    const flags = [];

    // Large transaction
    if (amount > 1000) flags.push('high_value');

    // Rapid transactions
    const recentCount = this.db.queryOne(
      'SELECT COUNT(*) as c FROM activity_log WHERE user_id = ? AND created_at > ?',
      [userId, Date.now() - 60000]
    )?.c || 0;
    if (recentCount > 20) flags.push('high_frequency');

    // Duplicate amount pattern
    const sameAmount = this.db.queryOne(
      'SELECT COUNT(*) as c FROM activity_log WHERE user_id = ? AND amount = ? AND created_at > ?',
      [userId, amount, Date.now() - 3600000]
    )?.c || 0;
    if (sameAmount > 5) flags.push('duplicate_amount_pattern');

    if (flags.length > 0) {
      this.db.run('UPDATE assets SET compliance_status = "flagged", compliance_notes = ?, compliance_checked_at = ? WHERE id = ?',
        [flags.join(', '), Date.now(), details.assetId || 0]);
    }

    return { flags, suspicious: flags.length >= 2 };
  }

  generateReport(assetId) {
    const asset = this.db.queryOne('SELECT * FROM assets WHERE id = ?', [assetId]);
    if (!asset) return null;

    const checks = this.checkPreListing(asset);
    const tokens = this.db.query('SELECT * FROM asset_tokens WHERE asset_id = ?', [assetId]);
    const investors = this.db.query(
      'SELECT DISTINCT owner_id FROM asset_tokens WHERE asset_id = ? AND owner_id IS NOT NULL', [assetId]
    );

    return {
      assetId, assetTitle: asset.title,
      complianceStatus: asset.compliance_status,
      preListing: checks,
      tokenCount: tokens.length,
      investorCount: investors.length,
      concentrationRisk: investors.map(i => {
        const total = tokens.filter(t => t.owner_id === i.owner_id).reduce((s, t) => s + t.price, 0);
        return { userId: i.owner_id, exposure: total };
      }),
      reportedAt: Date.now(),
    };
  }
}

module.exports = { ComplianceService };
