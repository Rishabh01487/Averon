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
    }

    // Create escrow
    this.escrow.createEscrow(assetId);

    // Update asset
    this.db.run('UPDATE assets SET token_count = ?, token_price = ?, updated_at = ? WHERE id = ?',
      [tokenCount, tokenPriceAC, Date.now(), assetId]);

    // Transition: verified → compliance_review → active (auto-pass for now)
    this.transition(assetId, C.ASSET_STATUS.COMPLIANCE_REVIEW, 'system', 'Auto compliance check');
    this.db.run('UPDATE assets SET compliance_status = "passed", compliance_checked_at = ? WHERE id = ?', [Date.now(), assetId]);
    this.transition(assetId, C.ASSET_STATUS.ACTIVE, 'system', 'Compliance passed');

    // Record on blockchain
    const wallet = this.walletManager.getWallet(userId);
    const walletData = this.db.queryOne('SELECT address FROM wallets WHERE user_id = ?', [userId]);
    let txHash = '', blockIdx = 0;

    if (wallet && walletData) {
      const assetTx = new Transaction(walletData.address, 'SYSTEM', 0, C.TX_TYPES.ASSET_CREATE, {
        assetId, title: asset.title, tokens: tokenCount, raiseAmount: asset.raise_amount,
      });
      wallet.sign(assetTx);
      this.blockchain.addTransaction(assetTx);
      const block = this.blockchain.minePendingTransactions(this.walletManager.getSystemWallet().address);
      txHash = assetTx.hash;
      blockIdx = block?.index || 0;
      this.db.run('UPDATE assets SET tx_hash = ?, block_index = ? WHERE id = ?', [txHash, blockIdx, assetId]);
    }

    this.db.run('INSERT INTO activity_log (user_id, action, details, tx_hash, block_index, created_at) VALUES (?,?,?,?,?,?)',
      [userId, 'ASSET_LISTED', `"${asset.title}" — ${tokenCount} tokens at ${tokenPriceAC.toFixed(4)} AC`, txHash, blockIdx, Date.now()]);

    return { tokenCount, tokenPriceInr, tokenPriceAC, txHash, blockIndex: blockIdx };
  }

  // ── Buy Tokens ───────────────────────────────────────────────────────────

  buyTokens(assetId, userId, count) {
    const asset = this.db.queryOne('SELECT * FROM assets WHERE id = ?', [assetId]);
    if (!asset) throw new Error('Asset not found');
    if (asset.status !== C.ASSET_STATUS.ACTIVE && asset.status !== C.ASSET_STATUS.FUNDING) throw new Error('Asset not active');
    if (asset.owner_id === userId) throw new Error('Cannot buy own tokens');

    const walletData = this.db.queryOne('SELECT * FROM wallets WHERE user_id = ?', [userId]);
    if (!walletData) throw new Error('Wallet not found');

    const available = this.db.query('SELECT * FROM asset_tokens WHERE asset_id = ? AND owner_id IS NULL ORDER BY token_index LIMIT ?', [assetId, count]);
    if (available.length < count) throw new Error(`Only ${available.length} tokens available`);

    const totalCost = parseFloat((asset.token_price * count).toFixed(8));
    const balance = this.blockchain.getBalance(walletData.address);
    if (balance < totalCost) throw new Error(`Need ${totalCost.toFixed(4)} AC, have ${balance.toFixed(4)} AC`);

    // Blockchain: User → Escrow
    const wallet = this.walletManager.getWallet(userId);
    const investTx = new Transaction(walletData.address, asset.escrow_address || `ESCROW_${assetId}`, totalCost, C.TX_TYPES.INVEST, {
      assetId, tokenCount: count, pricePerToken: asset.token_price,
    });
    wallet.sign(investTx);
    this.blockchain.addTransaction(investTx);

    const block = this.blockchain.minePendingTransactions(this.walletManager.getSystemWallet().address);

    // Update tokens
    for (const token of available) {
      this.db.run('UPDATE asset_tokens SET owner_id = ?, purchased_at = ?, tx_hash = ? WHERE id = ? AND owner_id IS NULL',