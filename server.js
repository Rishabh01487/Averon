require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// ── DATA PERSISTENCE ──────────────────────────────────────────────────────────
const DATA_FILE = path.join(__dirname, 'data', 'db.json');
if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'));
function readDB() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { users: {}, proposals: [], economy: { price: 1.00, totalSold: 0, history: [1.00], holders: 0, transactions: [] }, nextId: 1 }; }
}
function writeDB(db) { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }

// ── RAZORPAY SETUP ────────────────────────────────────────────────────────────
let Razorpay;
try {
  Razorpay = require('razorpay');
} catch(e) { console.warn('Razorpay not installed. Run: npm install'); }

function getRazorpay() {
  if (!Razorpay || !process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID.includes('XXXX')) return null;
  return new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
}

// ── PRICE ENGINE ─────────────────────────────────────────────────────────────
function calcPrice(db) {
  const funded = db.proposals.filter(p => p.status === 'funded').length;
  const expired = db.proposals.filter(p => p.status === 'expired' && p.raised < p.goal).length;
  return parseFloat((1.00 * (1 + db.economy.totalSold / 10000) * (1 + funded * 0.04) * Math.max(0.7, 1 - expired * 0.015)).toFixed(4));
}

// ── API ROUTES ────────────────────────────────────────────────────────────────

app.get('/api/config', (req, res) => {
  const db = readDB();
  res.json({ keyId: process.env.RAZORPAY_KEY_ID || 'NOT_SET', isLive: !!getRazorpay(), price: calcPrice(db), economy: db.economy });
});

app.post('/api/account', (req, res) => {
  const { userId, name, family } = req.body;
  if (!userId || !name) return res.status(400).json({ error: 'Missing fields' });
  const db = readDB();
  if (!db.users[userId]) { db.users[userId] = { id: userId, name, family, inr: 0, kbc: 0, createdAt: Date.now() }; db.economy.holders++; writeDB(db); }
  res.json(db.users[userId]);
});

app.get('/api/account/:userId', (req, res) => {
  const db = readDB();
  const user = db.users[req.params.userId];
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

app.post('/api/order/create', async (req, res) => {
  const { userId, amountInr } = req.body;
  if (!userId || !amountInr || amountInr < 10) return res.status(400).json({ error: 'Minimum ₹10 required' });
  const rzp = getRazorpay();
  if (!rzp) return res.status(503).json({ error: 'Payment gateway not configured. Add Razorpay keys to .env' });
  try {
    const order = await rzp.orders.create({ amount: Math.round(amountInr * 100), currency: 'INR', receipt: `kc_${userId}_${Date.now()}`, notes: { userId, type: 'buy_kc' } });
    res.json({ orderId: order.id, amount: order.amount, currency: order.currency });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/order/verify', (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, userId, amountInr } = req.body;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  const body = razorpay_order_id + '|' + razorpay_payment_id;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  if (expected !== razorpay_signature) return res.status(400).json({ error: 'Payment verification failed' });
  const db = readDB();
  const price = calcPrice(db);
  const kbc = parseFloat((amountInr / price).toFixed(4));
  if (!db.users[userId]) return res.status(404).json({ error: 'User not found' });
  db.users[userId].kbc = parseFloat((db.users[userId].kbc + kbc).toFixed(4));
  db.economy.totalSold = parseFloat((db.economy.totalSold + kbc).toFixed(4));
  db.economy.transactions.unshift({ type: 'buy', userId, kbc, inr: amountInr, price, paymentId: razorpay_payment_id, time: Date.now() });
  db.economy.price = calcPrice(db);
  db.economy.history.push(db.economy.price);
  if (db.economy.history.length > 100) db.economy.history.shift();
  writeDB(db);
  res.json({ success: true, kbc, newBalance: db.users[userId].kbc, newPrice: db.economy.price });
});

app.post('/api/refund', async (req, res) => {
  const { userId, paymentId, amountInr } = req.body;
  if (!userId || !paymentId) return res.status(400).json({ error: 'Missing fields' });
  const rzp = getRazorpay();
  if (!rzp) return res.status(503).json({ error: 'Payment gateway not configured' });
  const db = readDB();
  const user = db.users[userId];
  if (!user) return res.status(404).json({ error: 'User not found' });
  try {
    const refund = await rzp.payments.refund(paymentId, { amount: Math.round(amountInr * 100), notes: { userId, reason: 'Kuber Coin proposal refund' } });
    db.economy.transactions.unshift({ type: 'refund', userId, inr: amountInr, refundId: refund.id, time: Date.now() });
    writeDB(db);
    res.json({ success: true, refundId: refund.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/proposals', (req, res) => { const db = readDB(); checkDeadlines(db); res.json(db.proposals); });

app.post('/api/proposals', (req, res) => {
  const { userId, title, desc, category, goal, days } = req.body;
  if (!userId || !title || !desc || !goal || !days) return res.status(400).json({ error: 'Missing fields' });
  const db = readDB();
  const user = db.users[userId];
  if (!user) return res.status(404).json({ error: 'User not found' });
  const proposal = { id: db.nextId++, proposer: user.name + ' (' + user.family + ')', proposerId: userId, title, desc, category, goal: parseFloat(goal), raised: 0, deadline: Date.now() + days * 864e5, withdrawn: false, investments: [], status: 'active', createdAt: Date.now() };
  db.proposals.unshift(proposal);
  writeDB(db);
  res.json(proposal);
});

app.post('/api/proposals/:id/fund', (req, res) => {
  const { userId, kbc } = req.body;
  const db = readDB();
  const p = db.proposals.find(x => x.id === parseInt(req.params.id));
  const user = db.users[userId];
  if (!p || !user) return res.status(404).json({ error: 'Not found' });
  if (p.status !== 'active') return res.status(400).json({ error: 'Proposal not active' });
  if (parseFloat(kbc) > user.kbc) return res.status(400).json({ error: 'Insufficient Kuber Coin balance' });
  user.kbc = parseFloat((user.kbc - parseFloat(kbc)).toFixed(4));
  p.raised = parseFloat((p.raised + parseFloat(kbc)).toFixed(4));
  const inv = p.investments.find(i => i.id === userId);
  if (inv) { inv.kbc += parseFloat(kbc); inv.avgPrice = ((inv.avgPrice||db.economy.price)*(inv.kbc-parseFloat(kbc))/inv.kbc) + (db.economy.price*parseFloat(kbc)/inv.kbc); }
  else p.investments.push({ id: userId, name: user.name, kbc: parseFloat(kbc), avgPrice: db.economy.price });
  if (p.raised >= p.goal) { p.status = 'funded'; db.economy.price = calcPrice(db); }
  db.economy.transactions.unshift({ type: 'invest', userId, kbc: parseFloat(kbc), proposalId: p.id, price: db.economy.price, time: Date.now() });
  writeDB(db);
  res.json({ success: true, proposal: p, userKbc: user.kbc });
});

app.post('/api/proposals/:id/withdraw', (req, res) => {
  const { userId } = req.body;
  const db = readDB();
  const p = db.proposals.find(x => x.id === parseInt(req.params.id));
  const user = db.users[userId];
  if (!p || !user) return res.status(404).json({ error: 'Not found' });
  if (p.proposerId !== userId) return res.status(403).json({ error: 'Not the proposer' });
  if (p.raised < p.goal || p.withdrawn) return res.status(400).json({ error: 'Cannot withdraw' });
  user.kbc = parseFloat((user.kbc + p.raised).toFixed(4));
  p.withdrawn = true;
  writeDB(db);
  res.json({ success: true, kbc: p.raised });
});

app.get('/api/economy', (req, res) => { const db = readDB(); res.json(db.economy); });

function checkDeadlines(db) {
  let changed = false;
  db.proposals.forEach(p => { if (p.status === 'active' && Date.now() > p.deadline) { p.status = p.raised >= p.goal ? 'funded' : 'expired'; changed = true; } });
  if (changed) writeDB(db);
}

setInterval(() => {
  const db = readDB();
  const swing = (Math.random() - 0.5) * 0.005;
  db.economy.price = parseFloat((db.economy.price * (1 + swing)).toFixed(4));
  db.economy.history.push(db.economy.price);
  if (db.economy.history.length > 100) db.economy.history.shift();
  writeDB(db);
}, 15000);

const PORT = process.env.PORT || 4200;
app.listen(PORT, () => console.log(`\n  KuberaKosh running → http://localhost:${PORT}\n`));
