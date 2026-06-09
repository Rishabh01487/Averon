const C = require('../config/constants');

class FeeService {
  constructor(db, blockchain, walletManager) {
    this.db = db;
    this.blockchain = blockchain;
    this.walletManager = walletManager;
  }

  getTradingFee(userId = null) {
    const base = parseFloat(this.db.getConfig('trading_fee_percent') || C.FEES.TRADING_FEE_PERCENT);
    return base / 100;
  }

  getListingFee() {
    return parseFloat(this.db.getConfig('listing_fee_ac') || C.FEES.LISTING_FEE_AC);
  }

  getCapitalRaiseFee() {
    return parseFloat(this.db.getConfig('capital_raise_fee_percent') || C.FEES.CAPITAL_RAISE_FEE_PERCENT) / 100;
  }

  getWithdrawalFee() {
    return C.FEES.WITHDRAWAL_FEE_AC;
  }

  calculateTradeFees(tradeAmount, tradePrice) {
    const feeRate = this.getTradingFee();
    const totalValue = tradeAmount * tradePrice;
    const makerFee = parseFloat((tradeAmount * feeRate).toFixed(8));
    const takerFee = parseFloat((totalValue * feeRate).toFixed(8));
    return { makerFee, takerFee, totalFee: makerFee + takerFee, feeRate };
  }

  calculateRaiseFee(amount) {
    const feeRate = this.getCapitalRaiseFee();
    return { fee: parseFloat((amount * feeRate).toFixed(8)), feeRate };
  }

  collectFee(userId, feeType, amount, referenceId, referenceType) {
    const { Transaction } = require('../blockchain/transaction');
    if (amount <= 0) return null;

    const feeWallet = this.walletManager.getPlatformFeeWallet();
    const userWallet = this.db.queryOne('SELECT address FROM wallets WHERE user_id = ?', [userId]);

    let txHash = '';
    if (userWallet) {
      const feeTx = new Transaction(
        userWallet.address, feeWallet.address, amount, C.TX_TYPES.FEE,
        { feeType, referenceId, referenceType }
      );
      this.blockchain.addTransaction(feeTx);
      txHash = feeTx.hash;
    }

    this.db.run('INSERT INTO fee_ledger (user_id, fee_type, amount, reference_id, reference_type, tx_hash, created_at) VALUES (?,?,?,?,?,?,?)',
      [userId, feeType, amount, String(referenceId), referenceType, txHash, Date.now()]);

    this.db.incrementEconomy('total_fees_collected', amount);
    return { feeType, amount, txHash };
  }

  getFeeReport(filters = {}) {
    let sql = `SELECT fl.*, u.name as user_name FROM fee_ledger fl LEFT JOIN users u ON fl.user_id = u.id WHERE 1=1`;
    const params = [];

    if (filters.feeType) { sql += ' AND fl.fee_type = ?'; params.push(filters.feeType); }
    if (filters.userId) { sql += ' AND fl.user_id = ?'; params.push(filters.userId); }

    sql += ' ORDER BY fl.created_at DESC';
    if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }

    const entries = this.db.query(sql, params);
    const totals = this.db.queryOne(
      'SELECT SUM(amount) as total, fee_type FROM fee_ledger GROUP BY fee_type ORDER BY total DESC'
    );

    return { entries, totalsByType: totals, totalFees: entries.reduce((s, e) => s + e.amount, 0) };
  }
}

module.exports = { FeeService };
