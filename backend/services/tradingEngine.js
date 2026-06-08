// ══════════════════════════════════════════════════════════════════════════════
// AVERON TRADING ENGINE — Professional order book + matching
// ══════════════════════════════════════════════════════════════════════════════

const C = require('../config/constants');
const { Transaction } = require('../blockchain/transaction');

class TradingEngine {
  constructor(db, blockchain, walletManager) {
    this.db = db;
    this.blockchain = blockchain;
    this.walletManager = walletManager;
    this.circuitBreakerTripped = false;
    this.lastPriceCheck = Date.now();
    this.priceAtCheckpoint = db.getPrice();
  }

  // ── Place Orders ─────────────────────────────────────────────────────────

  placeOrder(userId, side, type, amount, price = null) {
    const user = this.db.queryOne('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) throw new Error('User not found');
    if (user.is_frozen) throw new Error('Account is frozen');

    // Check circuit breaker
    if (this.circuitBreakerTripped) throw new Error('Trading halted — circuit breaker active');

    // Check open order limit
    const openCount = this.db.queryOne('SELECT COUNT(*) as c FROM coin_orders WHERE user_id = ? AND status = "open"', [userId])?.c || 0;
    if (openCount >= C.TRADING.MAX_OPEN_ORDERS_PER_USER) throw new Error('Maximum open orders reached');

    // Validate