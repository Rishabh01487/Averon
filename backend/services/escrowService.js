// ══════════════════════════════════════════════════════════════════════════════
// AVERON ESCROW SERVICE — Holds funds during asset funding
// Double-entry bookkeeping for every coin movement.
// ══════════════════════════════════════════════════════════════════════════════

const C = require('../config/constants');

class EscrowService {
  constructor(db, blockchain, walletManager) {
    this.db = db;
    this.blockchain = blockchain;
    this.walletManager = walletManager;
  }

  /**
   * Create an escrow account for an asset.
   */
  createEscrow(assetId) {
    const address = `ESCROW_${assetId}_${Date.now().toString(36)}`;
    this.db.run(
      'INSERT INTO escrow_accounts (asset_id, address, status, created_at) VALUES (?,?,?,?)',
      [assetId, address, 'active', Date.now()]
    );
    this.db.run('UPDATE assets SET escrow_address = ? WHERE id = ?', [address, assetId]);
    return { assetId, address };
  }

  /**
   * Lock funds into escrow (when investor buys tokens).
   */
  lockFunds(assetId, userId, amount, txHash = '') {
    const escrow = this.db.queryOne('SELECT * FROM escrow_accounts WHERE asset_id = ?', [assetId]);
    if (!escrow) throw new Error('Escrow not found');
    if (escrow.status !== 'active') throw new Error('Escrow is not active');

    const newBalance = parseFloat((escrow.balance + amount).toFixed(8));
    const newReceived = parseFloat((escrow.total_received + amount).toFixed(8));

    this.db.run('UPDATE escrow_accounts SET balance = ?, total_received = ? WHERE id = ?',
      [newBalance, newReceived, escrow.id]);

    this.db.run('INSERT INTO escrow_transactions (escrow_id, type, user_id, amount, tx_hash, created_at) VALUES (?,?,?,?,?,?)',
      [escrow.id, 'LOCK', userId, amount, txHash, Date.now()]);

    this.db.run('UPDATE assets SET escrow_balance = ? WHERE id = ?', [newBalance, assetId]);

    return { escrowId: escrow.id, newBalance, txHash };
  }

  /**
   * Release escrow to asset owner (when fully funded).
   */
  releaseFunds(assetId) {
    const { Transaction } = require('../blockchain/transaction');
    const escrow = this.db.queryOne('SELECT * FROM escrow_accounts WHERE asset_id = ?', [assetId]);
    if (!escrow || escrow.balance <= 0) throw new Error('Nothing to release');

    const asset = this.db.queryOne('SELECT * FROM assets WHERE id = ?', [assetId]);
    if (!asset) throw new Error('Asset not found');

    const ownerWallet = this.db.queryOne('SELECT address FROM wallets WHERE user_id = ?', [asset.owner_id]);
    if (!ownerWallet) throw new Error('Owner wallet not found');

    const amount = escrow.balance;

    // Deduct platform fee
    const feePercent = parseFloat(this.db.getConfig('capital_raise_fee_percent') || C.FEES.CAPITAL_RAISE_FEE_PERCENT);
    const fee = parseFloat((amount * feePercent / 100).toFixed(8));
    const payout = parseFloat((amount - fee).toFixed(8));

    // Blockchain: Escrow → Owner
    const payoutTx = new Transaction(escrow.address, ownerWallet.address, payout, C.TX_TYPES.PAYOUT, {
      assetId, fee, feePercent,
    });
    this.blockchain.addTransaction(payoutTx);

    // Blockchain: Escrow → Platform Fee Wallet
    if (fee > 0) {
      const feeWallet = this.walletManager.getPlatformFeeWallet();
      const feeTx = new Transaction(escrow.address, feeWallet.address, fee, C.TX_TYPES.FEE, {
        assetId, feeType: 'capital_raise',
      });
      this.blockchain.addTransaction(feeTx);

      this.db.run('INSERT INTO fee_ledger (user_id, fee_type, amount, reference_id, reference_type, created_at) VALUES (?,?,?,?,?,?)',
        [asset.owner_id, 'capital_raise', fee, String(assetId), 'asset', Date.now()]);

      this.db.incrementEconomy('total_fees_collected', fee);
    }

    // Update escrow
    this.db.run('UPDATE escrow_accounts SET balance = 0, total_released = total_released + ?, status = "released" WHERE id = ?',
      [amount, escrow.id]);

    this.db.run('INSERT INTO escrow_transactions (escrow_id, type, user_id, amount, tx_hash, created_at) VALUES (?,?,?,?,?,?)',
      [escrow.id, 'RELEASE', asset.owner_id, payout, payoutTx.hash, Date.now()]);

    // Update asset
    this.db.run('UPDATE assets SET payout_status = "processing", payout_amount_inr = ?, payout_tx_hash = ?, escrow_balance = 0 WHERE id = ?',
      [payout * this.db.getPrice(), payoutTx.hash, assetId]);

    return { payout, fee, txHash: payoutTx.hash };
  }

  /**
   * Refund all investors (when asset expires unfunded).
   */
  refundAll(assetId) {
    const { Transaction } = require('../blockchain/transaction');
    const escrow = this.db.queryOne('SELECT * FROM escrow_accounts WHERE asset_id = ?', [assetId]);
    if (!escrow || escrow.balance <= 0) return { refunded: 0 };

    // Find all token holders
    const tokens = this.db.query('SELECT DISTINCT owner_id, COUNT(*) as count, SUM(price) as total FROM asset_tokens WHERE asset_id = ? AND owner_id IS NOT NULL GROUP BY owner_id', [assetId]);

    let totalRefunded = 0;
    const refunds = [];

    for (const token of tokens) {
      const wallet = this.db.queryOne('SELECT address FROM wallets WHERE user_id = ?', [token.owner_id]);
      if (!wallet) continue;

      const refundAmount = parseFloat(token.total.toFixed(8));

      const refundTx = new Transaction(escrow.address, wallet.address, refundAmount, C.TX_TYPES.REFUND, {
        assetId, tokenCount: token.count,
      });
      this.blockchain.addTransaction(refundTx);

      totalRefunded += refundAmount;
      refunds.push({ userId: token.owner_id, amount: refundAmount, txHash: refundTx.hash });

      // Clear token ownership
      this.db.run('UPDATE asset_tokens SET owner_id = NULL, purchased_at = NULL, tx_hash = "" WHERE asset_id = ? AND owner_id = ?',
        [assetId, token.owner_id]);

      this.db.run('INSERT INTO escrow_transactions (escrow_id, type, user_id, amount, tx_hash, created_at) VALUES (?,?,?,?,?,?)',
        [escrow.id, 'REFUND', token.owner_id, refundAmount, refundTx.hash, Date.now()]);

      // Notify
      this.db.run('INSERT INTO notifications (user_id, type, title, message, created_at) VALUES (?,?,?,?,?)',
        [token.owner_id, 'REFUND', 'Investment Refunded',
         `Your investment of ${refundAmount.toFixed(4)} AC in "${this.db.queryOne('SELECT title FROM assets WHERE id = ?', [assetId])?.title}" has been refunded.`,
         Date.now()]);
    }

    this.db.run('UPDATE escrow_accounts SET balance = 0, total_refunded = total_refunded + ?, status = "refunded" WHERE id = ?',
      [totalRefunded, escrow.id]);

    this.db.run('UPDATE assets SET escrow_balance = 0, funded_amount = 0 WHERE id = ?', [assetId]);

    return { refunded: totalRefunded, refundCount: refunds.length, refunds };