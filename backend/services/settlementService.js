const crypto = require('crypto');
const C = require('../config/constants');
const { Transaction } = require('../blockchain/transaction');

class SettlementService {
  constructor(db, blockchain, walletManager) {
    this.db = db;
    this.blockchain = blockchain;
    this.walletManager = walletManager;
  }

  requestWithdrawal(userId, coinAmount, bankDetails = {}) {
    const user = this.db.queryOne('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) throw new Error('User not found');
    if (user.is_frozen) throw new Error('Account is frozen');

    const wallet = this.db.queryOne('SELECT address FROM wallets WHERE user_id = ?', [userId]);
    const balance = wallet ? this.blockchain.getBalance(wallet.address) : 0;
    if (balance < coinAmount) throw new Error(`Insufficient balance: have ${balance.toFixed(4)} AC, need ${coinAmount.toFixed(4)} AC`);

    const kycTier = this.db.queryOne(
      'SELECT current_tier FROM kyc_records WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]
    )?.current_tier || 0;
    if (kycTier < 1) throw new Error('KYC Tier 1+ required for withdrawals');

    const price = this.db.getPrice();
    const fee = C.FEES.WITHDRAWAL_FEE_AC;
    const netCoin = parseFloat((coinAmount - fee).toFixed(8));
    const fiatAmount = parseFloat((netCoin * price).toFixed(2));

    const id = 'wd_' + crypto.randomBytes(12).toString('hex');
    const now = Date.now();

    this.db.run(
      `INSERT INTO withdrawal_requests (id, user_id, coin_amount, fiat_amount, exchange_rate, fee, net_amount,
        bank_account, ifsc_code, account_holder, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, userId, coinAmount, fiatAmount, price, fee, fiatAmount,
        bankDetails.accountNumber || '', bankDetails.ifsc || '', bankDetails.accountHolder || '',
        C.PAYMENT.SETTLEMENT_STATUS.PENDING, now, now]
    );

    this.db.run('INSERT INTO activity_log (user_id, action, details, amount, created_at) VALUES (?,?,?,?,?)',
      [userId, 'WITHDRAWAL_REQUESTED',
       `${coinAmount.toFixed(4)} AC → ₹${fiatAmount} (fee: ${fee} AC)`, coinAmount, now]);

    return { id, coinAmount, fiatAmount, fee, netCoin, exchangeRate: price, status: 'pending' };
  }

  processWithdrawal(requestId, processorUserId) {
    const req = this.db.queryOne('SELECT * FROM withdrawal_requests WHERE id = ?', [requestId]);
    if (!req) throw new Error('Withdrawal request not found');
    if (req.status !== C.PAYMENT.SETTLEMENT_STATUS.PENDING) throw new Error('Already processed');

    const wallet = this.db.queryOne('SELECT * FROM wallets WHERE user_id = ?', [req.user_id]);
    if (!wallet) throw new Error('User wallet not found');

    const userWallet = this.walletManager.getWallet(req.user_id);
    if (!userWallet) throw new Error('User wallet keys not found');

    const withdrawTx = new Transaction(
      wallet.address,
      this.walletManager.getSystemWallet().address,
      req.coin_amount,
      C.TX_TYPES.TRANSFER,
      { withdrawalId: req.id, type: 'WITHDRAWAL' }
    );
    userWallet.sign(withdrawTx);
    this.blockchain.addTransaction(withdrawTx);

    if (req.fee > 0) {
      const feeTx = new Transaction(
        wallet.address,
        this.walletManager.getPlatformFeeWallet().address,
        req.fee,
        C.TX_TYPES.FEE,
        { withdrawalId: req.id, feeType: 'withdrawal' }
      );
      userWallet.sign(feeTx);
      this.blockchain.addTransaction(feeTx);
    }

    this.blockchain.minePendingTransactions(this.walletManager.getSystemWallet().address);
    const newBalance = this.blockchain.getBalance(wallet.address);

    this.db.run('UPDATE users SET averon_balance = ?, inr_withdrawn = inr_withdrawn + ? WHERE id = ?',
      [newBalance, req.fiat_amount, req.user_id]);

    this.db.run(
      `UPDATE withdrawal_requests SET status = ?, processed_by = ?, processed_at = ?, tx_hash = ?, updated_at = ?
       WHERE id = ?`,
      [C.PAYMENT.SETTLEMENT_STATUS.PROCESSING, processorUserId, Date.now(), withdrawTx.hash, Date.now(), req.id]
    );

    this.db.run('INSERT INTO activity_log (user_id, action, details, tx_hash, amount, created_at) VALUES (?,?,?,?,?,?)',
      [req.user_id, 'WITHDRAWAL_PROCESSED',
       `${req.coin_amount.toFixed(4)} AC withdrawn — ₹${req.fiat_amount}`, withdrawTx.hash, req.coin_amount, Date.now()]);

    this.db.incrementEconomy('circulating_supply', -req.coin_amount);
    this.db.incrementEconomy('total_supply', -req.coin_amount);

    return { processed: true, requestId: req.id, txHash: withdrawTx.hash, newBalance };
  }

  completeWithdrawal(requestId) {
    this.db.run(
      "UPDATE withdrawal_requests SET status = ?, processed_at = ?, updated_at = ? WHERE id = ?",
      [C.PAYMENT.SETTLEMENT_STATUS.COMPLETED, Date.now(), Date.now(), requestId]
    );
    return { completed: true };
  }

  failWithdrawal(requestId, reason) {
    const req = this.db.queryOne('SELECT * FROM withdrawal_requests WHERE id = ?', [requestId]);
    if (!req) throw new Error('Not found');
    if (req.status !== C.PAYMENT.SETTLEMENT_STATUS.PENDING) throw new Error('Cannot fail — already processed');

    this.db.run(
      "UPDATE withdrawal_requests SET status = ?, failure_reason = ?, updated_at = ? WHERE id = ?",
      [C.PAYMENT.SETTLEMENT_STATUS.FAILED, reason, Date.now(), requestId]
    );
    return { failed: true, reason };
  }

  getPendingWithdrawals() {
    return this.db.query(
      `SELECT wr.*, u.name as user_name, u.email as user_email
       FROM withdrawal_requests wr JOIN users u ON wr.user_id = u.id
       WHERE wr.status = 'pending' ORDER BY wr.created_at ASC`
    );
  }

  getUserWithdrawals(userId, limit = 50) {
    return this.db.query(
      'SELECT * FROM withdrawal_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
      [userId, limit]
    );
  }

  runReconciliation() {
    const pending = this.db.query(
      `SELECT * FROM payment_orders WHERE status IN ('${C.PAYMENT.ORDER_STATUS.CONFIRMED}','${C.PAYMENT.ORDER_STATUS.PENDING}') AND created_at > ?`,
      [Date.now() - 7 * 86400000]
    );

    const results = { matched: 0, unmatched: 0, discrepancies: [] };

    for (const order of pending) {
      const txCount = this.db.queryOne(
        'SELECT COUNT(*) as c FROM payment_transactions WHERE order_id = ? AND status = "completed"',
        [order.id]
      )?.c || 0;

      if (order.status === C.PAYMENT.ORDER_STATUS.CONFIRMED && txCount === 0) {
        results.discrepancies.push({
          orderId: order.id,
          issue: 'CONFIRMED but no completed payment transaction',
          amount: order.fiat_amount,
        });
        results.unmatched++;
      } else {
        results.matched++;
      }

      const entry = results.discrepancies[results.discrepancies.length - 1];
      this.db.run(
        'INSERT INTO reconciliation_log (order_id, gateway, internal_amount, status, notes, created_at) VALUES (?,?,?,?,?,?)',
        [order.id, order.gateway, order.fiat_amount,
         entry ? 'discrepancy' : 'matched',
         entry ? entry.issue : 'OK', Date.now()]
      );
    }

    return results;
  }
}

module.exports = { SettlementService };
