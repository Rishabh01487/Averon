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
    if (amount < C.TRADING.MIN_ORDER_AMOUNT) throw new Error(`Minimum: ${C.TRADING.MIN_ORDER_AMOUNT} AC`);

    // For sell orders, verify balance
    if (side === 'sell') {
      const wallet = this.db.queryOne('SELECT address FROM wallets WHERE user_id = ?', [userId]);
      const balance = wallet ? this.blockchain.getBalance(wallet.address) : 0;
      if (balance < amount) throw new Error(`Insufficient balance: ${balance.toFixed(4)} AC`);

      // Lock the coins (deduct from available balance)
      this.db.run('UPDATE users SET averon_balance = averon_balance - ? WHERE id = ?', [amount, userId]);
    }

    // For market orders, use best available price
    if (type === 'market') {
      if (side === 'buy') {
        const bestSell = this.db.queryOne('SELECT price FROM coin_orders WHERE status = "open" AND side = "sell" ORDER BY price ASC LIMIT 1');
        price = bestSell ? bestSell.price : this.db.getPrice();
      } else {
        const bestBuy = this.db.queryOne('SELECT price FROM coin_orders WHERE status = "open" AND side = "buy" ORDER BY price DESC LIMIT 1');
        price = bestBuy ? bestBuy.price : this.db.getPrice();
      }
    }

    const now = Date.now();
    const { lastId } = this.db.run(
      'INSERT INTO coin_orders (user_id, type, side, amount, price, filled, remaining, status, duration, created_at, updated_at) VALUES (?,?,?,?,?,0,?,?,?,?,?)',
      [userId, type, side, amount, price, amount, 'open', 'GTC', now, now]
    );

    // Log
    this.db.run('INSERT INTO activity_log (user_id, action, details, amount, created_at) VALUES (?,?,?,?,?)',
      [userId, 'ORDER_PLACED', `${side.toUpperCase()} ${amount} AC @ ₹${price?.toFixed(4)}`, amount, now]);

    // Try matching
    const matches = this.matchOrders();

    return { orderId: lastId, matches, side, amount, price };
  }

  // ── Order Matching (Price-Time Priority) ─────────────────────────────────

  matchOrders() {
    const trades = [];
    const buyOrders = this.db.query('SELECT * FROM coin_orders WHERE status = "open" AND side = "buy" ORDER BY price DESC, created_at ASC');
    const sellOrders = this.db.query('SELECT * FROM coin_orders WHERE status = "open" AND side = "sell" ORDER BY price ASC, created_at ASC');

    for (const buy of buyOrders) {
      if (buy.remaining <= 0) continue;

      for (const sell of sellOrders) {
        if (sell.remaining <= 0) continue;
        if (buy.user_id === sell.user_id) continue; // No self-trade
        if (buy.price < sell.price) break; // No match possible at this price level

        const tradeAmount = Math.min(buy.remaining, sell.remaining);
        const tradePrice = sell.price; // Seller's price (maker gets their price)
        const totalValue = parseFloat((tradeAmount * tradePrice).toFixed(4));

        if (tradeAmount <= 0) continue;

        // Calculate fees
        const feeRate = parseFloat(this.db.getConfig('trading_fee_percent') || C.FEES.TRADING_FEE_PERCENT) / 100;
        const buyerFee = parseFloat((tradeAmount * feeRate).toFixed(8));
        const sellerFee = parseFloat((totalValue * feeRate).toFixed(8));