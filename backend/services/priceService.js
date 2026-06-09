const C = require('../config/constants');

class PriceService {
  constructor(db) {
    this.db = db;
  }

  getSpotPrice() {
    return this.db.getPrice();
  }

  calculateVWAP(periodMs = 86400000) {
    const trades = this.db.query(
      'SELECT amount, price, total_value FROM coin_trades WHERE created_at > ?',
      [Date.now() - periodMs]
    );
    if (trades.length === 0) return this.db.getPrice();
    const totalVolume = trades.reduce((s, t) => s + t.amount, 0);
    const totalValue = trades.reduce((s, t) => s + t.total_value, 0);
    return totalVolume > 0 ? parseFloat((totalValue / totalVolume).toFixed(4)) : this.db.getPrice();
  }

  generateCandles(interval = '1m') {
    const intervals = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
    const ms = intervals[interval] || 60000;
    const now = Date.now();
    const candleStart = Math.floor(now / ms) * ms;
    const since = candleStart - ms;

    const prices = this.db.query(
      'SELECT price, recorded_at FROM price_history WHERE recorded_at >= ? AND recorded_at < ? ORDER BY recorded_at ASC',
      [since, now]
    );

    if (prices.length === 0) return null;

    const items = prices.map(p => p.price);
    return {
      interval, timestamp: candleStart,
      open: items[0], close: items[items.length - 1],
      high: Math.max(...items), low: Math.min(...items),
      volume: prices.length,
    };
  }

  getOHLCV(interval = '1m', limit = 100) {
    const intervals = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
    const ms = intervals[interval] || 60000;
    const candles = [];

    for (let i = 0; i < limit; i++) {
      const end = Date.now() - (i * ms);
      const start = end - ms;
      const prices = this.db.query(
        'SELECT price FROM price_history WHERE recorded_at >= ? AND recorded_at < ? ORDER BY recorded_at ASC',
        [start, end]
      );
      if (prices.length > 0) {
        const items = prices.map(p => p.price);
        candles.unshift({
          timestamp: Math.floor(start / ms) * ms,
          open: items[0], close: items[items.length - 1],
          high: Math.max(...items), low: Math.min(...items),
          volume: prices.length,
        });
      }
    }
    return candles;
  }

  calculateSMA(period = 14) {
    const prices = this.db.query(
      'SELECT price FROM price_history ORDER BY recorded_at DESC LIMIT ?',
      [period]
    ).reverse();
    if (prices.length < period) return null;
    return parseFloat((prices.reduce((s, p) => s + p.price, 0) / period).toFixed(4));
  }

  calculateEMA(period = 14) {
    const prices = this.db.query(
      'SELECT price FROM price_history ORDER BY recorded_at DESC LIMIT ?',
      [period * 2]
    ).reverse();
    if (prices.length < period) return null;

    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((s, p) => s + p.price, 0) / period;

    for (let i = period; i < prices.length; i++) {
      ema = (prices[i].price - ema) * multiplier + ema;
    }
    return parseFloat(ema.toFixed(4));
  }

  getPriceImpact(orderAmount, side) {
    const book = this.db.query(
      `SELECT price, SUM(remaining) as total FROM coin_orders 
       WHERE status = 'open' AND side = ? AND remaining > 0 
       GROUP BY price ORDER BY price ${side === 'buy' ? 'ASC' : 'DESC'}`,
      [side === 'buy' ? 'sell' : 'buy']
    );

    let cumulative = 0;
    let vwapSum = 0;

    for (const level of book) {
      const take = Math.min(level.total, orderAmount - cumulative);
      cumulative += take;
      vwapSum += take * level.price;
      if (cumulative >= orderAmount) break;
    }

    if (cumulative < orderAmount) return { fillable: cumulative, impact: Infinity };
    const avgPrice = vwapSum / cumulative;
    const currentPrice = this.db.getPrice();
    const impact = Math.abs((avgPrice - currentPrice) / currentPrice) * 100;

    return { fillable: cumulative, avgPrice: parseFloat(avgPrice.toFixed(4)), impact: parseFloat(impact.toFixed(2)) };
  }

  getPriceAlerts() {
    const price = this.db.getPrice();
    const sma50 = this.calculateSMA(50);
    const sma200 = this.calculateSMA(200);
    const alerts = [];

    if (sma50 && sma200) {
      if (sma50 > sma200 && Math.abs(sma50 - sma200) / sma200 < 0.01) {
        alerts.push({ type: 'golden_cross', message: '50-period SMA crossing above 200-period SMA' });
      }
      if (sma50 < sma200 && Math.abs(sma200 - sma50) / sma200 < 0.01) {
        alerts.push({ type: 'death_cross', message: '50-period SMA crossing below 200-period SMA' });
      }
    }

    const lastCandle = this.getOHLCV('1h', 2);
    if (lastCandle.length >= 2) {
      const change = (lastCandle[1].close - lastCandle[0].close) / lastCandle[0].close * 100;
      if (Math.abs(change) > 5) {
        alerts.push({ type: 'volatility', message: `${change > 0 ? '+' : ''}${change.toFixed(1)}% in last hour` });
      }
    }

    return { price, sma50, sma200, alerts };
  }
}

module.exports = { PriceService };
