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
