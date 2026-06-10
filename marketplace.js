// ══════════════════════════════════════════════════════════════════════════════
// AVERON MARKETPLACE — P2P Coin Trading
// ══════════════════════════════════════════════════════════════════════════════

const { stmts, getPrice, setPrice } = require('./database');

/**
 * Place a sell order
 * @returns {object} The created order + any immediate matches
 */
function placeSellOrder(userId, amount, pricePerCoin) {
  const user = stmts.getUser.get(userId);
  if (!user) throw new Error('User not found');
  if (user.averon_balance < amount) throw new Error('Insufficient Averon Coin balance');

  // Deduct coins from seller (held in escrow)
  stmts.updateBalance.run(parseFloat((user.averon_balance - amount).toFixed(4)), userId);

  // Create order
  const result = stmts.createOrder.run(userId, 'sell', amount, pricePerCoin);
  const orderId = result.lastInsertRowid;

  // Try to match with existing buy orders
  const matches = matchOrders();

  stmts.logActivity.run(userId, 'SELL_ORDER', `Listed ${amount} AC for sale at ₹${pricePerCoin}/coin`, null, null, amount);

  return { orderId, matches };
}

/**
 * Place a buy order
 */
function placeBuyOrder(userId, amount, pricePerCoin) {
  const user = stmts.getUser.get(userId);
  if (!user) throw new Error('User not found');

  // Create order
  const result = stmts.createOrder.run(userId, 'buy', amount, pricePerCoin);
  const orderId = result.lastInsertRowid;

  // Try to match
  const matches = matchOrders();

  stmts.logActivity.run(userId, 'BUY_ORDER', `Buy order: ${amount} AC at ₹${pricePerCoin}/coin`, null, null, amount);

  return { orderId, matches };
}

/**
 * Match buy and sell orders
 */
function matchOrders() {
  const trades = [];
  const buyOrders = stmts.getOpenBuyOrders.all();
  const sellOrders = stmts.getOpenSellOrders.all();

  for (const buy of buyOrders) {
    for (const sell of sellOrders) {
      if (buy.user_id === sell.user_id) continue; // Can't trade with yourself
      if (buy.price_per_coin < sell.price_per_coin) continue; // Price doesn't match

      // Match found — execute trade
      const buyRemaining = buy.amount - buy.filled;
      const sellRemaining = sell.amount - sell.filled;
      const tradeAmount = Math.min(buyRemaining, sellRemaining);
      const tradePrice = sell.price_per_coin; // Sell price wins
      const totalInr = parseFloat((tradeAmount * tradePrice).toFixed(2));

      if (tradeAmount <= 0) continue;

      // Transfer coins to buyer
      const buyer = stmts.getUser.get(buy.user_id);
      stmts.updateBalance.run(parseFloat((buyer.averon_balance + tradeAmount).toFixed(4)), buy.user_id);

      // Record trade
      stmts.recordTrade.run(buy.user_id, sell.user_id, tradeAmount, tradePrice, totalInr, null);

      // Update orders
      stmts.updateOrderFilled.run(buy.filled + tradeAmount, buy.filled + tradeAmount, buy.id);
      stmts.updateOrderFilled.run(sell.filled + tradeAmount, sell.filled + tradeAmount, sell.id);

      trades.push({ buyer: buy.user_id, seller: sell.user_id, amount: tradeAmount, price: tradePrice, totalInr });

      // Update fill tracking
      buy.filled += tradeAmount;
      sell.filled += tradeAmount;

      if (buy.filled >= buy.amount) break; // This buy order is fully filled
    }
  }

  return trades;
}

/**
 * Cancel an order — return coins if sell order
 */
function cancelOrder(orderId, userId) {
  const { db } = require('./database');
  const order = db.prepare(`SELECT * FROM coin_orders WHERE id = ? AND user_id = ? AND status = 'open'`).get(orderId, userId);
  if (!order) throw new Error('Order not found or already filled');

  if (order.type === 'sell') {
    // Return unsold coins
    const remaining = order.amount - order.filled;
    const user = stmts.getUser.get(userId);
    stmts.updateBalance.run(parseFloat((user.averon_balance + remaining).toFixed(4)), userId);
  }

  stmts.cancelOrder.run(orderId, userId);
  return { cancelled: true, orderId };
}

function getOrderBook() {
  const buys = stmts.getOpenBuyOrders.all().map(o => ({
    id: o.id, type: 'buy', amount: o.amount, filled: o.filled,
    remaining: parseFloat((o.amount - o.filled).toFixed(4)),
    price: o.price_per_coin, userId: o.user_id, createdAt: o.created_at
  }));
  const sells = stmts.getOpenSellOrders.all().map(o => ({
    id: o.id, type: 'sell', amount: o.amount, filled: o.filled,
    remaining: parseFloat((o.amount - o.filled).toFixed(4)),
    price: o.price_per_coin, userId: o.user_id, createdAt: o.created_at
  }));
  return { buys, sells, spread: sells.length && buys.length ? parseFloat((sells[0].price - buys[0].price).toFixed(4)) : null };
}

module.exports = { placeSellOrder, placeBuyOrder, cancelOrder, getOrderBook, matchOrders };
