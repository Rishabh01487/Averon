// ══════════════════════════════════════════════════════════════════════════════
// AVERON ASSET SERVICE — Full lifecycle state machine
// ══════════════════════════════════════════════════════════════════════════════

const C = require('../config/constants');
const { Transaction } = require('../blockchain/transaction');

class AssetService {
  constructor(db, blockchain, walletManager, escrowService) {
    this.db = db;
    this.blockchain = blockchain;
    this.walletManager = walletManager;
    this.escrow = escrowService;
  }

  // ── State Machine ──────────────────────────────────────────────────────────

  canTransition(currentStatus, newStatus) {
    const allowed = C.ASSET_TRANSITIONS[currentStatus];
    return allowed ? allowed.includes(newStatus) : false;
  }

  transition(assetId, newStatus, changedBy = '', reason = '') {
    const asset = this.db.queryOne('SELECT * FROM assets WHERE id = ?', [assetId]);
    if (!asset) throw new Error('Asset not found');

    if (!this.canTransition(asset.status, newStatus)) {
      throw new Error(`Cannot transition from ${asset.status} to ${newStatus}`);
    }

    this.db.run('INSERT INTO asset_status_history (asset_id, old_status, new_status, changed_by, reason, created_at) VALUES (?,?,?,?,?,?)',
      [assetId, asset.status, newStatus, changedBy, reason, Date.now()]);

    this.db.run('UPDATE assets SET status = ?, updated_at = ? WHERE id = ?', [newStatus, Date.now(), assetId]);

    return { oldStatus: asset.status, newStatus };
  }

  // ── Create Asset ─────────────────────────────────────────────────────────

  createAsset(userId, data) {
    const { title, description, category, raiseAmount, days } = data;

    // Validate category
    if (!C.ASSET_CATEGORIES.includes(category)) throw new Error('Invalid category');

    // Validate raise amount
    if (raiseAmount < C.LIMITS.MIN_RAISE_AMOUNT) throw new Error(`Minimum raise: ₹${C.LIMITS.MIN_RAISE_AMOUNT}`);
    if (raiseAmount > C.LIMITS.MAX_RAISE_AMOUNT) throw new Error(`Maximum raise: ₹${C.LIMITS.MAX_RAISE_AMOUNT.toLocaleString()}`);

    const deadline = Date.now() + (days || C.LIMITS.DEFAULT_LISTING_DAYS) * 864e5;
    const now = Date.now();

    const { lastId } = this.db.run(
      'INSERT INTO assets (owner_id, title, description, category, raise_amount, deadline, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [userId, title, description || '', category, parseFloat(raiseAmount), deadline, C.ASSET_STATUS.DRAFT, now, now]
    );

    // Log status change
    this.db.run('INSERT INTO asset_status_history (asset_id, old_status, new_status, changed_by, reason, created_at) VALUES (?,?,?,?,?,?)',
      [lastId, null, C.ASSET_STATUS.DRAFT, userId, 'Asset created', now]);

    this.db.run('INSERT INTO activity_log (user_id, action, details, amount, created_at) VALUES (?,?,?,?,?)',
      [userId, 'ASSET_CREATED', `"${title}" — ₹${raiseAmount} raise`, parseFloat(raiseAmount), now]);

    return { assetId: lastId, status: C.ASSET_STATUS.DRAFT };
  }

  // ── Tokenize (after AI verification) ─────────────────────────────────────

  tokenizeAsset(assetId, userId, aiResult) {
    const asset = this.db.queryOne('SELECT * FROM assets WHERE id = ?', [assetId]);
    if (!asset) throw new Error('Asset not found');
    if (asset.owner_id !== userId) throw new Error('Not the owner');
    if (asset.status !== C.ASSET_STATUS.VERIFIED) throw new Error('Asset must be verified first');

    const currentPrice = this.db.getPrice();

    // Calculate token structure
    let tokenCount = Math.max(C.LIMITS.MIN_TOKEN_COUNT, Math.min(C.LIMITS.MAX_TOKEN_COUNT,
      aiResult.suggestedTokens || Math.round(asset.raise_amount / Math.max(100, asset.raise_amount / 20))
    ));
    const tokenPriceInr = parseFloat((asset.raise_amount / tokenCount).toFixed(2));
    const tokenPriceAC = parseFloat((tokenPriceInr / currentPrice).toFixed(8));

    // Create tokens
    for (let i = 1; i <= tokenCount; i++) {
      this.db.run('INSERT INTO asset_tokens (asset_id, token_index, price) VALUES (?,?,?)', [assetId, i, tokenPriceAC]);