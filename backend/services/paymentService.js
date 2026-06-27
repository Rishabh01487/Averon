const crypto = require('crypto');
const C = require('../config/constants');
const { Transaction } = require('../blockchain/transaction');

class PaymentService {
  constructor(db, blockchain, walletManager, kycService) {
    this.db = db;
    this.blockchain = blockchain;
    this.walletManager = walletManager;
    this.kyc = kycService;
    this.razorpay = null;
    this.stripe = null;
    this._initGateways();
  }

  _initGateways() {
    const key = process.env.RAZORPAY_KEY_ID;
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (key && secret) {
      try {
        const Razorpay = require('razorpay');
        this.razorpay = new Razorpay({ key_id: key, key_secret: secret });
      } catch {}
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (stripeKey) {
      try {
        const Stripe = require('stripe');
        this.stripe = new Stripe(stripeKey);
      } catch {}
    }

    this._seedGateways();
  }

  _seedGateways() {
    const existing = this.db.queryOne('SELECT id FROM payment_gateways LIMIT 1');
    if (existing) return;
    const now = Date.now();
    const gateways = [
      {
        name: 'razorpay', display_name: 'Razorpay', provider: 'razorpay', priority: 1,
        supported_currencies: 'INR', min_amount: 1, max_amount: 50000000,
        fee_percent: 0, fee_fixed: 0, is_active: 1,
      },
      {
        name: 'stripe', display_name: 'Stripe', provider: 'stripe', priority: 2,
        supported_currencies: 'INR,USD,EUR,GBP', min_amount: 1, max_amount: 100000000,
        fee_percent: 0, fee_fixed: 0, is_active: 1,
      },
      {
        name: 'upi', display_name: 'UPI', provider: 'upi', priority: 3,
        supported_currencies: 'INR', min_amount: 1, max_amount: 200000,
        fee_percent: 0, fee_fixed: 0, is_active: 1,
      },
      {
        name: 'wire', display_name: 'Wire Transfer', provider: 'wire', priority: 4,
        supported_currencies: 'INR,USD,EUR,GBP,SGD,AED', min_amount: 100000, max_amount: 10000000000,
        fee_percent: 0.1, fee_fixed: 500, is_active: 1,
      },
    ];
    for (const g of gateways) {
      this.db.run(
        'INSERT INTO payment_gateways (name, display_name, provider, priority, supported_currencies, min_amount, max_amount, fee_percent, fee_fixed, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [g.name, g.display_name, g.provider, g.priority, g.supported_currencies, g.min_amount, g.max_amount, g.fee_percent, g.fee_fixed, g.is_active, now, now]
      );
    }
  }

  getAvailableGateways(currency = 'INR') {
    return this.db.query(
      `SELECT name, display_name, provider, priority, min_amount, max_amount, fee_percent, fee_fixed, supported_currencies
       FROM payment_gateways WHERE is_active = 1 AND supported_currencies LIKE ?
       ORDER BY priority ASC`, [`%${currency}%`]
    );
  }

  async createOrder(userId, gateway, fiatAmount, currency = 'INR', options = {}) {
    if (fiatAmount < C.PAYMENT.COIN_PURCHASE_MIN_INR) {
      throw new Error(`Minimum purchase: ₹${C.PAYMENT.COIN_PURCHASE_MIN_INR}`);
    }
    if (fiatAmount > C.PAYMENT.COIN_PURCHASE_MAX_INR) {
      throw new Error(`Maximum purchase: ₹${C.PAYMENT.COIN_PURCHASE_MAX_INR.toLocaleString()}`);
    }

    const user = this.db.queryOne('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) throw new Error('User not found');
    if (user.is_frozen) throw new Error('Account is frozen');

    const tier = this.kyc.getUserTier(userId);
    const limitCheck = this.kyc.checkPurchaseLimit(userId, fiatAmount);
    if (!limitCheck.approved) throw new Error(limitCheck.reason);

    const amlCheck = this.kyc.screenTransaction(userId, fiatAmount, 'PURCHASE');
    if (amlCheck.blocked) throw new Error('Transaction blocked by AML filters: ' + amlCheck.reason);

    const price = this.db.getPrice();
    const coinAmount = parseFloat((fiatAmount / price).toFixed(8));
    const gatewayConfig = this.db.queryOne(
      'SELECT * FROM payment_gateways WHERE name = ? AND is_active = 1', [gateway]
    );
    if (!gatewayConfig) throw new Error(`Gateway '${gateway}' not available`);

    if (fiatAmount < gatewayConfig.min_amount || fiatAmount > gatewayConfig.max_amount) {
      throw new Error(`Gateway '${gateway}' supports ₹${gatewayConfig.min_amount}–₹${gatewayConfig.max_amount.toLocaleString()}`);
    }

    const feePercent = gatewayConfig.fee_percent || 0;
    const feeFixed = gatewayConfig.fee_fixed || 0;
    const feeFiat = parseFloat((fiatAmount * feePercent / 100 + feeFixed).toFixed(2));
    const netFiat = parseFloat((fiatAmount - feeFiat).toFixed(2));

    const orderId = 'pay_' + crypto.randomBytes(12).toString('hex');
    const expiresAt = Date.now() + C.PAYMENT.ORDER_EXPIRY_MS;
    const now = Date.now();

    this.db.run(
      `INSERT INTO payment_orders (id, user_id, gateway, type, status, fiat_currency, fiat_amount, coin_amount, exchange_rate,
        fee_fiat, net_fiat, kyc_tier, expires_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [orderId, userId, gateway, 'BUY_COIN', C.PAYMENT.ORDER_STATUS.CREATED, currency, fiatAmount, coinAmount, price,
        feeFiat, netFiat, tier, expiresAt, now, now]
    );

    this.db.run('INSERT INTO activity_log (user_id, action, details, amount, created_at) VALUES (?,?,?,?,?)',
      [userId, 'PAYMENT_ORDER_CREATED', `₹${fiatAmount} via ${gateway} — Order ${orderId.substring(0, 16)}...`, fiatAmount, now]);

    let gatewayResponse = {};
    let gatewayOrderId = '';

    if (gateway === 'razorpay' && this.razorpay) {
      try {
        const rzpOrder = await this.razorpay.orders.create({
          amount: Math.round(fiatAmount * 100),
          currency: currency,
          receipt: orderId,
          notes: { userId, orderId },
        });
        gatewayOrderId = rzpOrder.id;
        gatewayResponse = { id: rzpOrder.id, amount: rzpOrder.amount, currency: rzpOrder.currency, status: rzpOrder.status };
      } catch (e) {
        gatewayResponse = { error: e.message };
      }
    } else if (gateway === 'stripe' && this.stripe) {
      try {
        const paymentIntent = await this.stripe.paymentIntents.create({
          amount: Math.round(fiatAmount * 100),
          currency: currency.toLowerCase(),
          metadata: { userId, orderId },
        });
        gatewayOrderId = paymentIntent.id;
        gatewayResponse = { id: paymentIntent.id, client_secret: paymentIntent.client_secret, status: paymentIntent.status };
      } catch (e) {
        gatewayResponse = { error: e.message };
      }
    } else if (gateway === 'wire') {
      gatewayResponse = {
        instructions: 'Bank Transfer',
        bank_name: process.env.WIRE_BANK_NAME || 'Averon Settlement Account',
        account_number: process.env.WIRE_ACCOUNT_NUMBER || '****1234',
        ifsc_code: process.env.WIRE_IFSC || 'AVRN0001234',
        reference: orderId.substring(0, 12).toUpperCase(),
        note: `Use reference ${orderId.substring(0, 12).toUpperCase()} for faster verification`,
      };
    } else if (gateway === 'upi') {
      gatewayResponse = {
        upi_id: process.env.UPI_ID || 'averon@upi',
        reference: orderId.substring(0, 12).toUpperCase(),
        note: `Pay to UPI ID with reference ${orderId.substring(0, 12).toUpperCase()}`,
      };
    }

    this.db.run('UPDATE payment_orders SET gateway_order_id = ?, gateway_response = ?, status = ? WHERE id = ?',
      [gatewayOrderId, JSON.stringify(gatewayResponse), gatewayOrderId ? C.PAYMENT.ORDER_STATUS.PENDING : C.PAYMENT.ORDER_STATUS.CREATED, orderId]);

    this.db.run('INSERT INTO payment_transactions (order_id, type, gateway, amount, currency, status, created_at) VALUES (?,?,?,?,?,?,?)',
      [orderId, 'CREATE', gateway, fiatAmount, currency, 'pending', now]);

    return {
      orderId, gateway, gatewayOrderId,
      fiatAmount, coinAmount, exchangeRate: price,
      feeFiat, netFiat,
      kycTier: tier,
      gatewayInstructions: gatewayResponse,
      expiresAt,
      status: gatewayOrderId ? 'pending' : 'created',
    };
  }

  async verifyPayment(orderId, gatewayParams = {}) {
    const order = this.db.queryOne('SELECT * FROM payment_orders WHERE id = ?', [orderId]);
    if (!order) throw new Error('Order not found');
    if (order.status === C.PAYMENT.ORDER_STATUS.COMPLETED) throw new Error('Order already completed');
    if (order.status === C.PAYMENT.ORDER_STATUS.REFUNDED) throw new Error('Order was refunded');
    if (order.expires_at < Date.now()) {
      this._failOrder(orderId, 'Payment expired');
      throw new Error('Payment window expired');
    }

    // Atomic status check to prevent double-minting race condition
    const lockResult = this.db.run(
      `UPDATE payment_orders SET status = 'verifying', updated_at = ? WHERE id = ? AND status IN (?, ?)`,
      [Date.now(), orderId, C.PAYMENT.ORDER_STATUS.CREATED, C.PAYMENT.ORDER_STATUS.PENDING]
    );
    if (lockResult.changes === 0) throw new Error('Order is already being processed');

    let verified = false;
    let gatewayTxId = '';
    let gatewayData = {};

    switch (order.gateway) {
      case 'razorpay':
        if (this.razorpay && gatewayParams.razorpay_payment_id && gatewayParams.razorpay_order_id && gatewayParams.razorpay_signature) {
          const body = gatewayParams.razorpay_order_id + '|' + gatewayParams.razorpay_payment_id;
          const expectedSig = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
            .update(body).digest('hex');
          if (expectedSig === gatewayParams.razorpay_signature) {
            verified = true;
            gatewayTxId = gatewayParams.razorpay_payment_id;
          }
        }
        break;

      case 'stripe':
        if (this.stripe && gatewayParams.payment_intent) {
          try {
            const pi = await this.stripe.paymentIntents.retrieve(gatewayParams.payment_intent);
            if (pi.status === 'succeeded') {
              verified = true;
              gatewayTxId = pi.id;
              gatewayData = { status: pi.status, amount: pi.amount, currency: pi.currency };
            }
          } catch {}
        }
        break;

      case 'wire':
        // Wire payments require admin-confirmed flag from webhook or admin action
        if (gatewayParams._adminConfirmed === true) {
          verified = true;
          gatewayTxId = gatewayParams.tx_id || 'WIRE_' + orderId.substring(0, 12);
        }
        break;

      case 'upi':
        // UPI payments require admin-confirmed flag from webhook or admin action
        if (gatewayParams._adminConfirmed === true) {
          verified = true;
          gatewayTxId = gatewayParams.tx_ref || 'UPI_' + orderId.substring(0, 12);
        }
        break;
    }

    if (!verified) {
      // Revert the lock if verification failed
      this.db.run('UPDATE payment_orders SET status = ?, updated_at = ? WHERE id = ?',
        [C.PAYMENT.ORDER_STATUS.PENDING, Date.now(), orderId]);
      throw new Error('Payment verification failed');
    }

    this.db.run(
      `UPDATE payment_orders SET status = ?, gateway_tx_id = ?, gateway_response = ?, verified_at = ?, completed_at = ?, updated_at = ?
       WHERE id = ?`,
      [C.PAYMENT.ORDER_STATUS.CONFIRMED, gatewayTxId, JSON.stringify(gatewayData), Date.now(), Date.now(), Date.now(), orderId]
    );

    this._mintCoins(order);
    return { verified: true, orderId, gatewayTxId };
  }

  _mintCoins(order) {
    const wallet = this.db.queryOne('SELECT address FROM wallets WHERE user_id = ?', [order.user_id]);
    if (!wallet) throw new Error('Wallet not found');

    const mintTx = new Transaction('SYSTEM', wallet.address, order.coin_amount, C.TX_TYPES.MINT, {
      inr: order.fiat_amount, price: order.exchange_rate, orderId: order.id,
    });
    this.blockchain.addTransaction(mintTx);
    const block = this.blockchain.minePendingTransactions(this.walletManager.getSystemWallet().address);

    const newBalance = this.blockchain.getBalance(wallet.address);
    this.db.run('UPDATE users SET averon_balance = ?, inr_spent = inr_spent + ? WHERE id = ?',
      [newBalance, order.fiat_amount, order.user_id]);
    this.db.incrementEconomy('total_supply', order.coin_amount);
    this.db.incrementEconomy('circulating_supply', order.coin_amount);

    const newPrice = this._recalculatePrice();
    this.db.setPrice(newPrice);

    this.db.run('UPDATE payment_orders SET tx_hash = ?, status = ? WHERE id = ?',
      [mintTx.hash, C.PAYMENT.ORDER_STATUS.COMPLETED, order.id]);

    this.db.run('INSERT INTO payment_transactions (order_id, type, gateway, gateway_tx_id, amount, status, created_at) VALUES (?,?,?,?,?,?,?)',
      [order.id, 'COMPLETE', order.gateway, order.gateway_tx_id || '', order.fiat_amount, 'completed', Date.now()]);

    this.db.run('INSERT INTO activity_log (user_id, action, details, tx_hash, block_index, amount, created_at) VALUES (?,?,?,?,?,?,?)',
      [order.user_id, 'COINS_MINTED',
       `Minted ${order.coin_amount.toFixed(4)} AC for ₹${order.fiat_amount} via ${order.gateway} (Order: ${order.id.substring(0, 12)}...)`,
       mintTx.hash, block?.index || 0, order.coin_amount, Date.now()]);

    this.kyc.incrementUsage(order.user_id, order.fiat_amount);
  }

  _recalculatePrice() {
    const eco = this.db.getEconomy();
    return parseFloat(
      (C.PRICE.INITIAL_PRICE * (1 + (eco.total_supply || 0) / 10000) * (1 + (eco.total_assets_funded || 0) * 0.04))
        .toFixed(4)
    );
  }

  _failOrder(orderId, reason) {
    this.db.run('UPDATE payment_orders SET status = ?, failure_reason = ?, updated_at = ? WHERE id = ?',
      [C.PAYMENT.ORDER_STATUS.FAILED, reason, Date.now(), orderId]);
  }

  async expireStaleOrders() {
    const expired = this.db.query(
      `SELECT * FROM payment_orders WHERE status IN ('${C.PAYMENT.ORDER_STATUS.CREATED}','${C.PAYMENT.ORDER_STATUS.PENDING}') AND expires_at < ?`,
      [Date.now()]
    );
    for (const order of expired) {
      this._failOrder(order.id, 'Order expired');
    }
    return expired.length;
  }

  async processWebhook(gateway, rawBody, signature) {
    const webhookSecret = process.env[`${gateway.toUpperCase()}_WEBHOOK_SECRET`];
    if (gateway === 'razorpay' && webhookSecret) {
      const expectedSig = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
      if (signature !== expectedSig) throw new Error('Invalid webhook signature');
      const event = JSON.parse(rawBody);
      await this._handleRazorpayWebhook(event);
    } else if (gateway === 'stripe' && this.stripe && webhookSecret) {
      const sig = signature;
      try {
        const event = this.stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
        await this._handleStripeWebhook(event);
      } catch (e) { throw new Error('Stripe webhook verification failed: ' + e.message); }
    }
    return { received: true };
  }

  async _handleRazorpayWebhook(event) {
    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      const payload = event.payload?.payment?.entity || event.payload?.order?.entity || {};
      const orderId = payload.notes?.orderId || payload.receipt;
      if (orderId) {
        try {
          // For webhook-verified payments, skip client-side signature check
          // The webhook signature itself (verified in processWebhook) is the auth
          const order = this.db.queryOne('SELECT * FROM payment_orders WHERE id = ?', [orderId]);
          if (order && order.status !== C.PAYMENT.ORDER_STATUS.COMPLETED) {
            // Atomic lock
            const lockResult = this.db.run(
              `UPDATE payment_orders SET status = 'verifying', updated_at = ? WHERE id = ? AND status IN (?, ?)`,
              [Date.now(), orderId, C.PAYMENT.ORDER_STATUS.CREATED, C.PAYMENT.ORDER_STATUS.PENDING]
            );
            if (lockResult.changes > 0) {
              // Update with gateway info
              this.db.run('UPDATE payment_orders SET gateway_tx_id = ?, verified_at = ?, updated_at = ? WHERE id = ?',
                [payload.id, Date.now(), Date.now(), orderId]);
              // Re-fetch after lock
              const lockedOrder = this.db.queryOne('SELECT * FROM payment_orders WHERE id = ?', [orderId]);
              if (lockedOrder) {
                this._mintCoins(lockedOrder);
              }
            }
          }
        } catch (e) {
          console.error('Razorpay webhook processing error:', e.message);
        }
      }
    }
  }

  async _handleStripeWebhook(event) {
    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object;
      const orderId = pi.metadata?.orderId;
      if (orderId) {
        try {
          await this.verifyPayment(orderId, { payment_intent: pi.id });
        } catch {}
      }
    }
  }

  getOrder(orderId) {
    return this.db.queryOne('SELECT * FROM payment_orders WHERE id = ?', [orderId]);
  }

  getUserOrders(userId, limit = 50) {
    return this.db.query(
      'SELECT * FROM payment_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [userId, limit]
    );
  }

  getUserTransactions(userId, limit = 50) {
    return this.db.query(
      `SELECT pt.*, po.fiat_amount, po.coin_amount, po.status as order_status
       FROM payment_transactions pt JOIN payment_orders po ON pt.order_id = po.id
       WHERE po.user_id = ? ORDER BY pt.created_at DESC LIMIT ?`, [userId, limit]
    );
  }

  initiateRefund(orderId, reason = '') {
    const order = this.db.queryOne('SELECT * FROM payment_orders WHERE id = ?', [orderId]);
    if (!order) throw new Error('Order not found');
    if (order.status !== C.PAYMENT.ORDER_STATUS.COMPLETED) throw new Error('Only completed orders can be refunded');

    const wallet = this.db.queryOne('SELECT * FROM wallets WHERE user_id = ?', [order.user_id]);
    if (!wallet) throw new Error('Wallet not found');

    const balance = this.blockchain.getBalance(wallet.address);
    if (balance < order.coin_amount) throw new Error('Insufficient balance for refund');

    const refundTx = new Transaction(wallet.address, this.walletManager.getSystemWallet().address, order.coin_amount, C.TX_TYPES.REFUND, {
      orderId: order.id, reason,
    });
    this.blockchain.addTransaction(refundTx);
    this.blockchain.minePendingTransactions(this.walletManager.getSystemWallet().address);

    this.db.run('UPDATE payment_orders SET status = ?, refund_amount = ?, refunded_at = ?, updated_at = ? WHERE id = ?',
      [C.PAYMENT.ORDER_STATUS.REFUNDED, order.fiat_amount, Date.now(), Date.now(), order.id]);

    const newBalance = this.blockchain.getBalance(wallet.address);
    this.db.run('UPDATE users SET averon_balance = ? WHERE id = ?', [newBalance, order.user_id]);
    this.db.incrementEconomy('total_supply', -order.coin_amount);
    this.db.incrementEconomy('circulating_supply', -order.coin_amount);

    this.db.run('INSERT INTO payment_transactions (order_id, type, gateway, amount, status, created_at) VALUES (?,?,?,?,?,?)',
      [order.id, 'REFUND', order.gateway, order.fiat_amount, 'completed', Date.now()]);

    this.db.run('INSERT INTO activity_log (user_id, action, details, tx_hash, amount, created_at) VALUES (?,?,?,?,?,?)',
      [order.user_id, 'REFUND_INITIATED', `₹${order.fiat_amount} refund for Order ${order.id.substring(0, 12)}...`, refundTx.hash, order.coin_amount, Date.now()]);

    return { refunded: true, amount: order.fiat_amount, txHash: refundTx.hash };
  }
}

module.exports = { PaymentService };
