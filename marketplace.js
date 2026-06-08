// ══════════════════════════════════════════════════════════════════════════════
// AVERON MARKETPLACE — P2P Coin Trading
// ══════════════════════════════════════════════════════════════════════════════

const { queryOne, query, run } = require('./database');

function placeSellOrder(userId, amount, pricePerCoin) {
  const user = queryOne('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) throw new Error('User not found');
  if (user.averon_balance < amount) throw new Error('Insufficient Averon Coin balance');

  run('UPDATE users SET averon_balance = ? WHERE id = ?', [parseFloat((user.averon_balance - amount).toFixed(4)), userId]);
  const { lastId } = run('INSERT INTO coin_orders (user_id, type, amount, price_per_coin, created_at) VALUES (?, "sell", ?, ?, ?)', [userId, amount, pricePerCoin, Date.now()]);
  const matches = matchOrders();
  run('INSERT INTO activity_log (user_id, action, details, amount, created_at) VALUES (?, ?, ?, ?, ?)',
    [userId, 'SELL_ORDER', `Listed ${amount} AC at ₹${pricePerCoin}/coin`, amount, Date.now()]);
  return { orderId: lastId, matches };
}

function placeBuyOrder(userId, amount, pricePerCoin) {
  const user = queryOne('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) throw new Error('User not found');
  const { lastId } = run('INSERT INTO coin_orders (user_id, type, amount, price_per_coin, created_at) VALUES (?, "buy", ?, ?, ?)', [userId, amount, pricePerCoin, Date.now()]);
  const matches = matchOrders();
  run('INSERT INTO activity_log (user_id, action, details, amount, created_at) VALUES (?, ?, ?, ?, ?)',
    [userId, 'BUY_ORDER', `Buy order: ${amount} AC at ₹${pricePerCoin}/coin`, amount, Date.now()]);
  return { orderId: lastId, matches };
}

function matchOrders() {
  const trades = [];
  const buyOrders = query('SELECT * FROM coin_orders WHERE status = "open" AND type = "buy" ORDER BY price_per_coin DESC');
  const sellOrders = query('SELECT * FROM coin_orders WHERE status = "open" AND type = "sell" ORDER BY price_per_coin ASC');

  for (const buy of buyOrders) {
    for (const sell of sellOrders) {
      if (buy.user_id === sell.user_id) continue;
      if (buy.price_per_coin < sell.price_per_coin) continue;

      const buyRem = buy.amount - buy.filled;
      const sellRem = sell.amount - sell.filled;
      const tradeAmt = Math.min(buyRem, sellRem);
      if (tradeAmt <= 0) continue;

      const tradePrice = sell.price_per_coin;
      const totalInr = parseFloat((tradeAmt * tradePrice).toFixed(2));

      const buyer = queryOne('SELECT * FROM users WHERE id = ?', [buy.user_id]);
      const seller = queryOne('SELECT * FROM users WHERE id = ?', [sell.user_id]);
      run('UPDATE users SET averon_balance = ? WHERE id = ?', [parseFloat((buyer.averon_balance + tradeAmt).toFixed(4)), buy.user_id]);

      run('INSERT INTO coin_trades (buyer_id, seller_id, amount, price_per_coin, total_inr, buyer_name, seller_name, traded_at) VALUES (?,?,?,?,?,?,?,?)',
        [buy.user_id, sell.user_id, tradeAmt, tradePrice, totalInr, buyer?.name || '', seller?.name || '', Date.now()]);

      const newBuyFilled = buy.filled + tradeAmt;
      const newSellFilled = sell.filled + tradeAmt;
      run('UPDATE coin_orders SET filled = ?, status = ? WHERE id = ?', [newBuyFilled, newBuyFilled >= buy.amount ? 'filled' : 'open', buy.id]);
      run('UPDATE coin_orders SET filled = ?, status = ? WHERE id = ?', [newSellFilled, newSellFilled >= sell.amount ? 'filled' : 'open', sell.id]);

      trades.push({ buyer: buy.user_id, seller: sell.user_id, amount: tradeAmt, price: tradePrice, totalInr });
      buy.filled = newBuyFilled;
      sell.filled = newSellFilled;
      if (buy.filled >= buy.amount) break;
    }
  }
  return trades;
}

function cancelOrder(orderId, userId) {
  const order = queryOne('SELECT * FROM coin_orders WHERE id = ? AND user_id = ? AND status = "open"', [orderId, userId]);
  if (!order) throw new Error('Order not found');
  if (order.type === 'sell') {
    const remaining = order.amount - order.filled;
    const user = queryOne('SELECT * FROM users WHERE id = ?', [userId]);
    run('UPDATE users SET averon_balance = ? WHERE id = ?', [parseFloat((user.averon_balance + remaining).toFixed(4)), userId]);
  }
  run('UPDATE coin_orders SET status = "cancelled" WHERE id = ?', [orderId]);
  return { cancelled: true };
}

function getOrderBook() {
  const buys = query('SELECT * FROM coin_orders WHERE status = "open" AND type = "buy" ORDER BY price_per_coin DESC').map(o => ({
    id: o.id, type: 'buy', amount: o.amount, filled: o.filled, remaining: parseFloat((o.amount - o.filled).toFixed(4)), price: o.price_per_coin
  }));
  const sells = query('SELECT * FROM coin_orders WHERE status = "open" AND type = "sell" ORDER BY price_per_coin ASC').map(o => ({
    id: o.id, type: 'sell', amount: o.amount, filled: o.filled, remaining: parseFloat((o.amount - o.filled).toFixed(4)), price: o.price_per_coin
  }));
  return { buys, sells, spread: sells.length && buys.length ? parseFloat((sells[0].price - buys[0].price).toFixed(4)) : null };
}

module.exports = { placeSellOrder, placeBuyOrder, cancelOrder, getOrderBook };
