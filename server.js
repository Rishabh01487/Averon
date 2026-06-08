// ══════════════════════════════════════════════════════════════════════════════
// AVERON v4 — Enterprise Server Entry Point
// ══════════════════════════════════════════════════════════════════════════════

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');

// ── Config & Constants ───────────────────────────────────────────────────────
const C = require('./backend/config/constants');
const DB = require('./backend/config/database');

// ── Middleware ────────────────────────────────────────────────────────────────
const { hashPassword, verifyPassword, generateTokens, verifyAccessToken, verifyRefreshToken, authenticate, optionalAuth, requireRole } = require('./backend/middleware/auth');
const { generalLimiter, authLimiter, financialLimiter, uploadLimiter } = require('./backend/middleware/rateLimiter');
const { validate, sanitizeBody } = require('./backend/middleware/validator');
const { initAudit, logAudit, auditMiddleware, verifyAuditChain } = require('./backend/middleware/audit');

// ── Blockchain ───────────────────────────────────────────────────────────────
const { Blockchain, Transaction } = require('./backend/blockchain/chain');
const { WalletManager } = require('./backend/blockchain/wallet');

// ── Services ─────────────────────────────────────────────────────────────────
const { analyzeAsset } = require('./backend/services/aiPipeline');
const { EscrowService } = require('./backend/services/escrowService');
const { AssetService } = require('./backend/services/assetService');
const { TradingEngine } = require('./backend/services/tradingEngine');
const { eventBus, EVENTS } = require('./backend/services/eventBus');

// ══════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ══════════════════════════════════════════════════════════════════════════════

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(sanitizeBody);
app.use(generalLimiter);
app.use(auditMiddleware);
app.use(express.static(path.join(__dirname, 'frontend')));

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));

// File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS_DIR, req.params.assetId || 'temp');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + path.extname(file.originalname)),
});
const upload = multer({ storage, limits: { fileSize: C.LIMITS.MAX_FILE_SIZE_BYTES, files: C.LIMITS.MAX_DOCUMENTS } });

// ── Service instances (initialized after DB) ─────────────────────────────────
let blockchain, walletManager, systemWallet, escrowService, assetService, tradingEngine;

// ══════════════════════════════════════════════════════════════════════════════
// API ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// ── Health & Config ──────────────────────────────────────────────────────────

app.get('/api/config', (req, res) => {
  const stats = DB.getDashboardStats();
  const chainInfo = blockchain.getInfo();
  res.json({
    platform: C.PLATFORM_NAME, version: C.PLATFORM_VERSION,
    price: stats.price, economy: stats, blockchain: chainInfo,
    hasGemini: !!process.env.GEMINI_API_KEY,
    categories: C.ASSET_CATEGORIES,
  });
});

app.get('/api/dashboard', (req, res) => {
  const stats = DB.getDashboardStats();
  const activity = DB.query('SELECT a.*, u.name as user_name FROM activity_log a LEFT JOIN users u ON a.user_id = u.id ORDER BY a.created_at DESC LIMIT 30');
  res.json({ ...stats, recentActivity: activity });
});

// ── Auth ─────────────────────────────────────────────────────────────────────

app.post('/api/auth/register', authLimiter, validate('register'), async (req, res) => {
  const { email, password, name, organization } = req.body;

  const existing = DB.queryOne('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) return res.status(409).json({ error: 'Email already registered', code: 'EMAIL_EXISTS' });

  const userId = 'usr_' + crypto.randomBytes(8).toString('hex');
  const passwordHash = await hashPassword(password);

  // Create wallet
  const wallet = walletManager.createWallet(userId);

  // Determine role (first user = admin)
  const userCount = DB.queryOne('SELECT COUNT(*) as c FROM users')?.c || 0;
  const role = userCount === 0 ? C.ROLES.ADMIN : C.ROLES.USER;

  const now = Date.now();
  DB.run(
    'INSERT INTO users (id, email, password_hash, name, organization, role, wallet_address, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [userId, email, passwordHash, name, organization || '', role, wallet.address, now, now]
  );
  DB.run('INSERT INTO wallets (user_id, public_key, private_key, address, created_at) VALUES (?,?,?,?,?)',
    [userId, wallet.publicKey, wallet.privateKey, wallet.address, now]);

  // Update holder count
  const count = DB.queryOne('SELECT COUNT(*) as c FROM users')?.c || 0;
  DB.updateEconomy('holder_count', count);

  const user = DB.queryOne('SELECT * FROM users WHERE id = ?', [userId]);
  const tokens = generateTokens(user);

  logAudit('REGISTER', { email, role }, { userId, ip: req.ip });
  eventBus.emit(EVENTS.USER_REGISTERED, { userId, name, wallet: wallet.address });

  DB.run('INSERT INTO activity_log (user_id, action, details, created_at) VALUES (?,?,?,?)',
    [userId, 'ACCOUNT_CREATED', `${name} — ${wallet.address}`, now]);

  res.status(201).json({
    user: { id: userId, name, email, role, walletAddress: wallet.address, balance: 0 },
    ...tokens,
  });
});

app.post('/api/auth/login', authLimiter, validate('login'), async (req, res) => {
  const { email, password } = req.body;

  const user = DB.queryOne('SELECT * FROM users WHERE email = ?', [email]);
  if (!user) return res.status(401).json({ error: 'Invalid credentials', code: 'AUTH_FAILED' });

  // Check lockout
  if (user.locked_until && user.locked_until > Date.now()) {
    const remaining = Math.ceil((user.locked_until - Date.now()) / 60000);
    return res.status(423).json({ error: `Account locked. Try again in ${remaining} minutes.`, code: 'ACCOUNT_LOCKED' });
  }

  if (user.is_frozen) return res.status(403).json({ error: 'Account is frozen', code: 'ACCOUNT_FROZEN' });

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    const attempts = user.login_attempts + 1;
    if (attempts >= C.AUTH.MAX_LOGIN_ATTEMPTS) {
      DB.run('UPDATE users SET login_attempts = ?, locked_until = ? WHERE id = ?',
        [attempts, Date.now() + C.AUTH.LOCKOUT_DURATION_MS, user.id]);
    } else {
      DB.run('UPDATE users SET login_attempts = ? WHERE id = ?', [attempts, user.id]);
    }
    return res.status(401).json({ error: 'Invalid credentials', code: 'AUTH_FAILED' });
  }

  // Reset attempts on success
  DB.run('UPDATE users SET login_attempts = 0, locked_until = 0, last_login = ? WHERE id = ?', [Date.now(), user.id]);

  const tokens = generateTokens(user);
  const wallet = DB.queryOne('SELECT address FROM wallets WHERE user_id = ?', [user.id]);
  const balance = wallet ? blockchain.getBalance(wallet.address) : 0;

  logAudit('LOGIN', { email }, { userId: user.id, ip: req.ip });

  res.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role, walletAddress: wallet?.address, balance },
    ...tokens,
  });
});

app.post('/api/auth/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

  const payload = verifyRefreshToken(refreshToken);
  if (!payload) return res.status(401).json({ error: 'Invalid refresh token' });

  const user = DB.queryOne('SELECT * FROM users WHERE id = ?', [payload.userId]);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const tokens = generateTokens(user);
  res.json(tokens);
});

// ── Account ──────────────────────────────────────────────────────────────────

app.get('/api/account', authenticate, (req, res) => {
  const user = DB.queryOne('SELECT * FROM users WHERE id = ?', [req.user.userId]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const wallet = DB.queryOne('SELECT address FROM wallets WHERE user_id = ?', [user.id]);
  const balance = wallet ? blockchain.getBalance(wallet.address) : 0;
  DB.run('UPDATE users SET averon_balance = ? WHERE id = ?', [balance, user.id]);

  res.json({
    id: user.id, name: user.name, email: user.email, role: user.role,
    walletAddress: wallet?.address, balance, inrSpent: user.inr_spent,
    createdAt: user.created_at,
  });
});

app.get('/api/notifications', authenticate, (req, res) => {
  const notifs = DB.query('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [req.user.userId]);
  const unread = DB.queryOne('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.userId])?.c || 0;
  res.json({ notifications: notifs, unread });
});

app.post('/api/notifications/read', authenticate, (req, res) => {
  DB.run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.userId]);
  res.json({ success: true });
});

// ── Buy Averon Coin ──────────────────────────────────────────────────────────

app.post('/api/buy-coins', authenticate, financialLimiter, validate('buyCoins'), (req, res) => {
  const { amountInr } = req.body;
  const userId = req.user.userId;

  const wallet = DB.queryOne('SELECT * FROM wallets WHERE user_id = ?', [userId]);
  if (!wallet) return res.status(404).json({ error: 'Wallet not found' });

  const price = DB.getPrice();
  const coinAmount = parseFloat((amountInr / price).toFixed(8));

  // Blockchain MINT
  const mintTx = new Transaction('SYSTEM', wallet.address, coinAmount, C.TX_TYPES.MINT, { inr: amountInr, price });
  blockchain.addTransaction(mintTx);
  const block = blockchain.minePendingTransactions(systemWallet.address);

  const newBalance = blockchain.getBalance(wallet.address);
  DB.run('UPDATE users SET averon_balance = ?, inr_spent = inr_spent + ? WHERE id = ?', [newBalance, amountInr, userId]);
  DB.incrementEconomy('total_supply', coinAmount);
  DB.incrementEconomy('circulating_supply', coinAmount);

  // Recalculate price
  const eco = DB.getEconomy();
  const newPrice = parseFloat((C.PRICE.INITIAL_PRICE * (1 + (eco.total_supply || 0) / 10000) * (1 + (eco.total_assets_funded || 0) * 0.04)).toFixed(4));
  DB.setPrice(newPrice);

  DB.run('INSERT INTO activity_log (user_id, action, details, tx_hash, block_index, amount, created_at) VALUES (?,?,?,?,?,?,?)',
    [userId, 'MINT', `Minted ${coinAmount.toFixed(4)} AC for ₹${amountInr}`, mintTx.hash, block?.index || 0, coinAmount, Date.now()]);

  eventBus.emit(EVENTS.COINS_MINTED, { userId, amount: coinAmount, inr: amountInr });
  eventBus.emit(EVENTS.BLOCK_MINED, { blockIndex: block?.index });
  eventBus.emit(EVENTS.PRICE_UPDATED, { price: newPrice });

  res.json({ success: true, coins: coinAmount, newBalance, newPrice, txHash: mintTx.hash, blockIndex: block?.index });
});

// ── Assets ───────────────────────────────────────────────────────────────────

app.get('/api/assets', optionalAuth, (req, res) => {
  const { status, category, limit } = req.query;
  const filters = { excludeStatus: 'rejected' };
  if (status && status !== 'all') filters.status = status;
  if (category && category !== 'all') filters.category = category;
  if (limit) filters.limit = parseInt(limit);
  res.json(assetService.listAssets(filters));
});

app.get('/api/assets/:id', optionalAuth, (req, res) => {
  const asset = assetService.getAsset(parseInt(req.params.id));
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  res.json(asset);
});

app.post('/api/assets/create', authenticate, validate('createAsset'), (req, res) => {
  try {
    const result = assetService.createAsset(req.user.userId, req.body);
    eventBus.emit(EVENTS.ASSET_CREATED, result);
    res.status(201).json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/assets/:assetId/documents', authenticate, uploadLimiter, upload.array('documents', C.LIMITS.MAX_DOCUMENTS), (req, res) => {
  const assetId = parseInt(req.params.assetId);
  const asset = DB.queryOne('SELECT * FROM assets WHERE id = ? AND owner_id = ?', [assetId, req.user.userId]);
  if (!asset) return res.status(404).json({ error: 'Asset not found or not owned' });

  const assetDir = path.join(UPLOADS_DIR, String(assetId));
  if (!fs.existsSync(assetDir)) fs.mkdirSync(assetDir, { recursive: true });

  const docs = [];
  for (const file of (req.files || [])) {
    const newPath = path.join(assetDir, file.filename);
    if (file.path !== newPath) try { fs.renameSync(file.path, newPath); } catch {}

    // Hash the document for duplicate detection
    let docHash = '';
    try { docHash = crypto.createHash('sha256').update(fs.readFileSync(newPath)).digest('hex'); } catch {}

    DB.run('INSERT INTO asset_documents (asset_id, filename, original_name, mimetype, size, filepath, doc_hash, uploaded_at) VALUES (?,?,?,?,?,?,?,?)',
      [assetId, file.filename, file.originalname, file.mimetype, file.size, newPath, docHash, Date.now()]);
    docs.push({ filename: file.filename, original_name: file.originalname, mimetype: file.mimetype, size: file.size });
  }

  // Transition to documents_uploaded if in draft
  if (asset.status === C.ASSET_STATUS.DRAFT) {
    assetService.transition(assetId, C.ASSET_STATUS.DOCUMENTS_UPLOADED, req.user.userId, 'Documents uploaded');
  }

  res.json({ uploaded: docs.length, documents: docs });
});

app.post('/api/assets/:id/analyze', authenticate, (req, res) => {
  const assetId = parseInt(req.params.id);