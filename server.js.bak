// ══════════════════════════════════════════════════════════════════════════════
// AVERON v4 — Enterprise Server Entry Point
// ══════════════════════════════════════════════════════════════════════════════

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');

const cluster = require('cluster');
const numCPUs = process.env.CLUSTER_WORKERS ? parseInt(process.env.CLUSTER_WORKERS) : (require('os').availableParallelism?.() || require('os').cpus().length);
const isClusterMode = process.env.NODE_ENV === 'production' && process.env.CLUSTER !== 'false' && cluster.isPrimary;

if (isClusterMode) {
  console.log(`[Averon] Primary ${process.pid} spawning ${numCPUs} workers`);
  for (let i = 0; i < numCPUs; i++) cluster.fork();
  cluster.on('exit', (worker, code) => {
    console.log(`[Averon] Worker ${worker.process.pid} died (code ${code}). Restarting...`);
    cluster.fork();
  });
  process.on('SIGTERM', () => { for (const id in cluster.workers) cluster.workers[id].kill(); process.exit(0); });
  process.on('SIGINT', () => { for (const id in cluster.workers) cluster.workers[id].kill(); process.exit(0); });
  return;
}

// ── Global Error Boundaries ───────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error(`[Averon] UNCAUGHT EXCEPTION: ${err.message}`, err.stack);
  try { fs.appendFileSync(path.join(__dirname, 'data', 'crash.log'), `\n[${new Date().toISOString()}] ${err.stack || err.message}\n`); } catch {}
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(`[Averon] UNHANDLED REJECTION: ${reason?.message || reason}`);
  try { fs.appendFileSync(path.join(__dirname, 'data', 'crash.log'), `\n[${new Date().toISOString()}] UNHANDLED: ${reason?.stack || reason}\n`); } catch {}
});

// ── Config & Constants ───────────────────────────────────────────────────────
const C = require('./backend/config/constants');
const DB = require('./backend/config/database');

// ── Middleware ────────────────────────────────────────────────────────────────
const { hashPassword, verifyPassword, generateTokens, verifyAccessToken, verifyRefreshToken, authenticate, optionalAuth, requireRole } = require('./backend/middleware/auth');
const { requireAdmin } = require('./backend/middleware/adminAuth');
const { generalLimiter, authLimiter, financialLimiter, uploadLimiter } = require('./backend/middleware/rateLimiter');
const { validate, sanitizeBody } = require('./backend/middleware/validator');
const { initAudit, logAudit, auditMiddleware, verifyAuditChain } = require('./backend/middleware/audit');

// ── Security ──────────────────────────────────────────────────────────────────
const { setupSecurity } = require('./backend/config/security');

// ── Blockchain ───────────────────────────────────────────────────────────────
const { Blockchain, Transaction } = require('./backend/blockchain/chain');
const { WalletManager } = require('./backend/blockchain/wallet');

// ── Services ─────────────────────────────────────────────────────────────────
const { analyzeAsset } = require('./backend/services/aiPipeline');
const { EscrowService } = require('./backend/services/escrowService');
const { AssetService } = require('./backend/services/assetService');
const { VestingService } = require('./backend/services/vestingService');
const { TradingEngine } = require('./backend/services/tradingEngine');
const { P2PNode } = require('./backend/blockchain/p2p');
const { connectMongo, closeMongo, isMongoEnabled, getDb } = require('./backend/config/mongo');
const userStore = require('./backend/services/userStore');
const { FeeService } = require('./backend/services/feeService');
const { PriceService } = require('./backend/services/priceService');
const { ComplianceService } = require('./backend/services/complianceService');
const { PaymentService } = require('./backend/services/paymentService');
const { KYCService } = require('./backend/services/kycService');
const { SettlementService } = require('./backend/services/settlementService');
const { WebSocketServer } = require('./backend/services/wsServer');
const { eventBus, EVENTS } = require('./backend/services/eventBus');

// ══════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ══════════════════════════════════════════════════════════════════════════════

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(sanitizeBody);

// Apply security headers BEFORE other middleware and static files
setupSecurity(app);

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
let blockchain, walletManager, systemWallet, escrowService, vestingService, assetService, tradingEngine, p2pNode;
let feeService, priceService, complianceService, kycService, paymentService, settlementService;

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
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || null,
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

  // Check if user already exists (MongoDB primary, SQLite fallback)
  const existing = await userStore.findUserByEmail(email, DB);
  if (existing) return res.status(409).json({ error: 'Email already registered', code: 'EMAIL_EXISTS' });

  const userId = 'usr_' + crypto.randomBytes(8).toString('hex');
  const passwordHash = await hashPassword(password);

  // Create wallet (kept in SQLite wallets.json — tightly coupled to blockchain)
  const wallet = walletManager.createWallet(userId);

  // Determine role (first user = admin)
  let userCount = 0;
  if (isMongoEnabled()) {
    userCount = await getDb?.()?.collection('users')?.countDocuments?.() || 0;
  }
  if (userCount === 0) {
    // Fallback to SQLite count
    userCount = DB.queryOne('SELECT COUNT(*) as c FROM users')?.c || 0;
  }
  const role = userCount === 0 ? C.ROLES.ADMIN : C.ROLES.USER;

  const now = Date.now();
  // Create user in MongoDB (primary source of truth) + mirror to SQLite
  await userStore.createUser({
    id: userId, email, passwordHash, name, organization: organization || '',
    role, walletAddress: wallet.address, createdAt: now,
  }, DB);

  // Wallet stays in SQLite (tightly coupled to blockchain wallets.json)
  DB.run('INSERT INTO wallets (user_id, public_key, private_key, address, created_at) VALUES (?,?,?,?,?)',
    [userId, wallet.publicKey, wallet.privateKey, wallet.address, now]);

  // Update holder count
  const count = (isMongoEnabled() ? await getDb()?.collection('users')?.countDocuments?.() : 0) ||
                DB.queryOne('SELECT COUNT(*) as c FROM users')?.c || 0;
  DB.updateEconomy('holder_count', count);

  const user = await userStore.findUserById(userId, DB);
  const tokens = generateTokens(user);

  // Create session in MongoDB + mirror
  await userStore.createSession(userId, tokens.refreshToken,
    Date.now() + 7 * 24 * 60 * 60 * 1000, DB);

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

  // Primary: MongoDB; Fallback: SQLite
  const user = await userStore.findUserByEmail(email, DB);
  if (!user) return res.status(401).json({ error: 'Invalid credentials', code: 'AUTH_FAILED' });

  // Check lockout
  if (user.locked_until && user.locked_until > Date.now()) {
    const remaining = Math.ceil((user.locked_until - Date.now()) / 60000);
    return res.status(423).json({ error: `Account locked. Try again in ${remaining} minutes.`, code: 'ACCOUNT_LOCKED' });
  }

  if (user.is_frozen) return res.status(403).json({ error: 'Account is frozen', code: 'ACCOUNT_FROZEN' });

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    const result = await userStore.incrementLoginAttempts(
      user.id, C.AUTH.MAX_LOGIN_ATTEMPTS, C.AUTH.LOCKOUT_DURATION_MS, DB
    );
    if (result.locked) {
      return res.status(423).json({
        error: `Account locked. Try again in ${Math.ceil(C.AUTH.LOCKOUT_DURATION_MS / 60000)} minutes.`,
        code: 'ACCOUNT_LOCKED'
      });
    }
    return res.status(401).json({ error: 'Invalid credentials', code: 'AUTH_FAILED' });
  }

  // Reset attempts on success
  await userStore.resetLoginAttempts(user.id, DB);

  const tokens = generateTokens(user);
  const wallet = DB.queryOne('SELECT address FROM wallets WHERE user_id = ?', [user.id]);
  const balance = wallet ? blockchain.getBalance(wallet.address) : 0;

  // Create new session in MongoDB + SQLite
  await userStore.createSession(user.id, tokens.refreshToken,
    Date.now() + 7 * 24 * 60 * 60 * 1000, DB);

  logAudit('LOGIN', { email }, { userId: user.id, ip: req.ip });

  res.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role, walletAddress: wallet?.address, balance },
    ...tokens,
  });
});

app.post('/api/auth/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

  const payload = verifyRefreshToken(refreshToken);
  if (!payload) return res.status(401).json({ error: 'Invalid refresh token' });

  // Check if session exists + is not revoked
  const session = await userStore.findSession(refreshToken, DB);
  if (session && session.is_revoked) {
    return res.status(401).json({ error: 'Session revoked' });
  }

  const user = await userStore.findUserById(payload.userId, DB);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const tokens = generateTokens(user);
  // Rotate: revoke old refresh token, create new session
  if (session) {
    await userStore.revokeSession(refreshToken, DB);
  }
  await userStore.createSession(user.id, tokens.refreshToken,
    Date.now() + 7 * 24 * 60 * 60 * 1000, DB);

  res.json(tokens);
});

// ── Account ──────────────────────────────────────────────────────────────────

app.get('/api/account', authenticate, async (req, res) => {
  const user = await userStore.findUserById(req.user.userId, DB);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const wallet = DB.queryOne('SELECT address FROM wallets WHERE user_id = ?', [user.id]);
  const balance = wallet ? blockchain.getBalance(wallet.address) : 0;
  // Mirror balance back to Mongo + SQLite
  await userStore.updateUser(user.id, { averon_balance: balance }, DB);

  res.json({
    id: user.id, name: user.name, email: user.email, role: user.role,
    walletAddress: wallet?.address, balance, inrSpent: user.inr_spent,
    createdAt: user.created_at,
  });
});

// Logout: revoke the user's session
app.post('/api/auth/logout', authenticate, async (req, res) => {
  const refreshToken = req.body?.refreshToken;
  if (refreshToken) {
    await userStore.revokeSession(refreshToken, DB);
  }
  logAudit('LOGOUT', {}, { userId: req.user.userId, ip: req.ip });
  res.json({ success: true });
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

// ── Payment Gateway ──────────────────────────────────────────────────────────

app.get('/api/payment/gateways', authenticate, (req, res) => {
  const gateways = paymentService.getAvailableGateways(req.query.currency || 'INR');
  res.json({ gateways });
});

app.post('/api/payment/create-order', authenticate, financialLimiter, async (req, res) => {
  const { gateway, amount, currency } = req.body;
  if (!gateway || !amount) return res.status(400).json({ error: 'Gateway and amount required' });
  try {
    const order = await paymentService.createOrder(req.user.userId, gateway, parseFloat(amount), currency || 'INR');
    res.status(201).json(order);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/payment/verify', authenticate, async (req, res) => {
  const { orderId, ...gatewayParams } = req.body;
  if (!orderId) return res.status(400).json({ error: 'Order ID required' });
  try {
    const result = await paymentService.verifyPayment(orderId, gatewayParams);
    eventBus.emit(EVENTS.COINS_MINTED, { userId: req.user.userId, amount: result.coinAmount, orderId });
    eventBus.emit(EVENTS.PRICE_UPDATED, { price: DB.getPrice() });
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/payment/refund', authenticate, requireRole(C.ROLES.ADMIN), async (req, res) => {
  const { orderId, reason } = req.body;
  try {
    const result = paymentService.initiateRefund(orderId, reason || '');
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/payment/orders', authenticate, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  res.json({ orders: paymentService.getUserOrders(req.user.userId, limit) });
});

app.get('/api/payment/orders/:id', authenticate, (req, res) => {
  const order = paymentService.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.user_id !== req.user.userId && req.user.role !== C.ROLES.ADMIN) {
    return res.status(403).json({ error: 'Access denied' });
  }
  res.json(order);
});

// ── Webhook (no auth — gateway signature is the auth) ────────────────────────

app.post('/api/webhook/:gateway', (req, res) => {
  const rawBody = JSON.stringify(req.body);
  const signature = req.headers['x-razorpay-signature'] || req.headers['stripe-signature'] || '';
  paymentService.processWebhook(req.params.gateway, rawBody, signature)
    .then(() => res.json({ received: true }))
    .catch((e) => res.status(400).json({ error: e.message }));
});

// ── KYC ──────────────────────────────────────────────────────────────────────

app.post('/api/kyc/submit', authenticate, uploadLimiter, upload.single('document'), (req, res) => {
  const { docType, docNumber } = req.body;
  if (!docType || !docNumber) return res.status(400).json({ error: 'Document type and number required' });
  if (!req.file) return res.status(400).json({ error: 'Document file required' });
  try {
    const result = kycService.submitKYC(req.user.userId, docType, docNumber, req.file.path);
    res.status(201).json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/kyc/status', authenticate, (req, res) => {
  res.json(kycService.getKYCStatus(req.user.userId));
});

app.get('/api/kyc/pending', authenticate, requireRole(C.ROLES.ADMIN), (req, res) => {
  res.json({ pending: kycService.getPendingVerifications() });
});

app.post('/api/kyc/verify/:recordId', authenticate, requireRole(C.ROLES.ADMIN), (req, res) => {
  const { approved, reason } = req.body;
  try {
    const result = kycService.verifyKYC(parseInt(req.params.recordId), req.user.userId, approved, reason || '');
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Withdrawals ──────────────────────────────────────────────────────────────

app.post('/api/withdraw/request', authenticate, financialLimiter, (req, res) => {
  try {
    const result = settlementService.requestWithdrawal(req.user.userId, parseFloat(req.body.amount), req.body.bankDetails || {});
    res.status(201).json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/withdraw/history', authenticate, (req, res) => {
  res.json({ withdrawals: settlementService.getUserWithdrawals(req.user.userId) });
});

app.get('/api/withdraw/pending', authenticate, requireRole(C.ROLES.ADMIN), (req, res) => {
  res.json({ pending: settlementService.getPendingWithdrawals() });
});

app.post('/api/withdraw/process/:id', authenticate, requireRole(C.ROLES.ADMIN), (req, res) => {
  try {
    const result = settlementService.processWithdrawal(req.params.id, req.user.userId);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/withdraw/complete/:id', authenticate, requireRole(C.ROLES.ADMIN), (req, res) => {
  res.json(settlementService.completeWithdrawal(req.params.id));
});

app.post('/api/withdraw/fail/:id', authenticate, requireRole(C.ROLES.ADMIN), (req, res) => {
  res.json(settlementService.failWithdrawal(req.params.id, req.body.reason || 'Manual rejection'));
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
  const asset = DB.queryOne('SELECT * FROM assets WHERE id = ? AND owner_id = ?', [assetId, req.user.userId]);
  if (!asset) return res.status(404).json({ error: 'Asset not found or not owned' });

  // Transition to analyzing
  try { assetService.transition(assetId, C.ASSET_STATUS.AI_ANALYZING, req.user.userId, 'AI analysis triggered'); } catch {}

  const docs = DB.query('SELECT * FROM asset_documents WHERE asset_id = ?', [assetId]);

  (async () => {
    try {
      const result = await analyzeAsset(
        { title: asset.title, description: asset.description, category: asset.category, raise_amount: asset.raise_amount },
        docs.map(d => ({ ...d, path: d.filepath })),
        DB
      );

      const newStatus = result.verified ? C.ASSET_STATUS.VERIFIED : C.ASSET_STATUS.REJECTED;
      DB.run(`UPDATE assets SET ai_verified=?, ai_valuation=?, ai_risk_score=?, ai_risk_level=?, ai_confidence=?, ai_analysis_summary=?, ai_concerns=?, ai_raw_response=?, ai_analyzed_at=?, total_value=?, status=?, updated_at=? WHERE id=?`,
        [result.verified ? 1 : 0, result.estimatedValue, result.riskScore, result.riskLevel, result.confidence,
         result.analysis, result.concerns, result.raw || '', Date.now(), result.estimatedValue, newStatus, Date.now(), assetId]);

      // Store valuation record
      DB.run('INSERT INTO asset_valuations (asset_id, valuation, risk_score, confidence, source, details, created_at) VALUES (?,?,?,?,?,?,?)',
        [assetId, result.estimatedValue, result.riskScore, result.confidence, result.source, JSON.stringify(result.stages || []), Date.now()]);

      DB.run('INSERT INTO activity_log (user_id, action, details, created_at) VALUES (?,?,?,?)',
        [asset.owner_id, 'AI_ANALYSIS', `AI ${result.verified ? 'verified' : 'rejected'} — Risk: ${result.riskLevel} (${result.riskScore}%)`, Date.now()]);

      res.json({ ...result, assetId, status: newStatus });
    } catch (e) {
      DB.run('UPDATE assets SET status = ?, updated_at = ? WHERE id = ?', [C.ASSET_STATUS.DOCUMENTS_UPLOADED, Date.now(), assetId]);
      res.status(500).json({ error: 'AI analysis failed: ' + e.message });
    }
  })();
});

app.post('/api/assets/:id/confirm', authenticate, (req, res) => {
  try {
    const assetId = parseInt(req.params.id);
    // Pass optional vesting config from request body (Algorithm #9)
    const vestingConfig = req.body.vesting || null;
    const result = assetService.tokenizeAsset(assetId, req.user.userId, req.body.aiResult || {}, vestingConfig);
    res.json({ success: true, ...result, asset: assetService.getAsset(assetId) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ═══ Algorithm #9: Vesting API Routes ════════════════════════════════════════

// Get vesting schedule for an asset
app.get('/api/assets/:id/vesting', (req, res) => {
  try {
    const schedule = vestingService.getSchedule(parseInt(req.params.id));
    if (!schedule) return res.json({ hasVesting: false });
    res.json({ hasVesting: true, schedule });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Get current user's vesting summary for an asset (used by Portfolio page)
app.get('/api/portfolio/:assetId/vesting', authenticate, (req, res) => {
  try {
    const summary = vestingService.getUserVestingSummary(parseInt(req.params.assetId), req.user.userId);
    res.json(summary || { hasVesting: false });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Get all vesting summaries for the logged-in user (across all assets)
app.get('/api/portfolio/vesting', authenticate, (req, res) => {
  try {
    const holdings = DB.query(
      `SELECT DISTINCT asset_id FROM token_vesting_records WHERE user_id = ?`,
      [req.user.userId]
    );
    const summaries = holdings.map(h => ({
      assetId: h.asset_id,
      ...vestingService.getUserVestingSummary(h.asset_id, req.user.userId)
    }));
    res.json({ holdings: summaries });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Check if a specific token is locked (used by Marketplace before allowing sell)
app.get('/api/assets/:assetId/tokens/:tokenId/locked', authenticate, (req, res) => {
  try {
    const locked = vestingService.isTokenLocked(
      parseInt(req.params.assetId),
      parseInt(req.params.tokenId),
      req.user.userId
    );
    res.json({ locked, assetId: parseInt(req.params.assetId), tokenId: parseInt(req.params.tokenId) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Admin: force-unlock all tokens for a user on an asset (compliance override)
app.post('/api/admin/vesting/force-unlock', authenticate, requireAdmin, (req, res) => {
  try {
    const { assetId, userId, reason } = req.body;
    if (!assetId || !userId || !reason) throw new Error('assetId, userId, reason required');
    const result = vestingService.adminForceUnlock(assetId, userId, reason, req.user.userId);
    res.json({ success: true, ...result });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/assets/:id/tokens/buy', authenticate, financialLimiter, validate('buyTokens'), (req, res) => {
  try {
    const result = assetService.buyTokens(parseInt(req.params.id), req.user.userId, parseInt(req.body.count) || 1);
    eventBus.emit(EVENTS.TOKEN_PURCHASED, result);
    if (result.funded) eventBus.emit(EVENTS.ASSET_FUNDED, { assetId: parseInt(req.params.id) });
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Marketplace ──────────────────────────────────────────────────────────────

app.get('/api/market/orderbook', (req, res) => {
  const book = tradingEngine.getOrderBook();
  const trades = tradingEngine.getRecentTrades(30);
  res.json({ ...book, recentTrades: trades });
});

app.post('/api/market/order', authenticate, financialLimiter, validate('placeOrder'), (req, res) => {
  const { side, type, amount, price } = req.body;
  try {
    const result = tradingEngine.placeOrder(req.user.userId, side, type || 'limit', parseFloat(amount), parseFloat(price));
    eventBus.emit(EVENTS.ORDER_PLACED, result);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/market/order/:id', authenticate, (req, res) => {
  try {
    const result = tradingEngine.cancelOrder(parseInt(req.params.id), req.user.userId);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Portfolio ────────────────────────────────────────────────────────────────

app.get('/api/portfolio', authenticate, (req, res) => {
  const userId = req.user.userId;
  const wallet = DB.queryOne('SELECT address FROM wallets WHERE user_id = ?', [userId]);
  const balance = wallet ? blockchain.getBalance(wallet.address) : 0;
  const price = DB.getPrice();

  const tokens = DB.query(`SELECT t.*, a.title as asset_title, a.category, a.status as asset_status 
    FROM asset_tokens t JOIN assets a ON t.asset_id = a.id WHERE t.owner_id = ?`, [userId]);
  const myAssets = DB.query('SELECT * FROM assets WHERE owner_id = ? ORDER BY created_at DESC', [userId]);
  const myOrders = DB.query('SELECT * FROM coin_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [userId]);
  const activity = DB.query('SELECT * FROM activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [userId]);
  const notifications = DB.query('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', [userId]);

  res.json({
    balance, walletAddress: wallet?.address, coinValue: parseFloat((balance * price).toFixed(2)),
    tokens, myAssets, myOrders, activity, notifications, price,
  });
});

// ── Blockchain Explorer ──────────────────────────────────────────────────────

app.get('/api/blockchain/info', (req, res) => res.json(blockchain.getInfo()));

app.get('/api/blockchain/blocks', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const blocks = blockchain.getRecentBlocks(limit).map(b => b.toJSON());
  res.json({ blocks, total: blockchain.chain.length });
});

app.get('/api/blockchain/block/:index', (req, res) => {
  const block = blockchain.getBlock(parseInt(req.params.index));
  if (!block) return res.status(404).json({ error: 'Block not found' });
  res.json(block.toJSON());
});

app.get('/api/blockchain/tx/:hash', (req, res) => {
  const tx = blockchain.findTransaction(req.params.hash);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  res.json(tx);
});

app.get('/api/blockchain/validate', (req, res) => res.json(blockchain.isChainValid()));

app.get('/api/blockchain/address/:address', (req, res) => {
  const balance = blockchain.getBalance(req.params.address);
  const history = blockchain.getTransactionHistory(req.params.address);
  res.json({ address: req.params.address, balance, transactions: history });
});

// ── Admin ────────────────────────────────────────────────────────────────────

app.get('/api/admin/stats', authenticate, requireRole(C.ROLES.ADMIN), (req, res) => {
  const stats = DB.getDashboardStats();
  const chainInfo = blockchain.getInfo();
  const auditIntegrity = verifyAuditChain();
  const recentAudit = DB.query('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 50');
  const pendingAssets = DB.query(`SELECT * FROM assets WHERE status IN ('${C.ASSET_STATUS.VERIFIED}','${C.ASSET_STATUS.FLAGGED}','${C.ASSET_STATUS.COMPLIANCE_REVIEW}')`);
  const systemConfig = DB.query('SELECT * FROM system_config');
  const frozenUsers = DB.query('SELECT id, name, email FROM users WHERE is_frozen = 1');

  res.json({ stats, chainInfo, auditIntegrity, recentAudit, pendingAssets, systemConfig, frozenUsers });
});

// ═══ Algorithm #10: P2P Network API Routes ═══════════════════════════════════

// Get network status (any user can view)
app.get('/api/network/status', (req, res) => {
  if (!p2pNode) return res.json({ enabled: false });
  res.json({ enabled: true, ...p2pNode.getStatus() });
});

// Get connected peers (any user can view)
app.get('/api/network/peers', (req, res) => {
  if (!p2pNode) return res.json({ enabled: false, peers: [] });
  res.json({ enabled: true, peers: p2pNode.getPeerList() });
});

// Admin: manually add a peer to connect to
app.post('/api/network/peers/add', authenticate, requireRole(C.ROLES.ADMIN), (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Peer URL required (e.g. ws://host:4201)' });
  if (!p2pNode) return res.status(503).json({ error: 'P2P node not initialized' });
  const result = p2pNode.connectToPeer(url);
  logAudit('PEER_ADDED', { url }, { userId: req.user.userId });
  res.json({ success: true, ...result });
});

// Admin: get full network status (including trusted nodes config)
app.get('/api/admin/network', authenticate, requireRole(C.ROLES.ADMIN), (req, res) => {
  if (!p2pNode) return res.json({ enabled: false });
  res.json({
    enabled: true,
    status: p2pNode.getStatus(),
    peers: p2pNode.getPeerList(),
    trustedNodesConfigured: (process.env.TRUSTED_NODES || '').split(',').filter(Boolean).length,
    seedsConfigured: (process.env.PEERS || '').split(',').filter(Boolean).length,
  });
});

app.post('/api/admin/freeze/:userId', authenticate, requireRole(C.ROLES.ADMIN), (req, res) => {
  DB.run('UPDATE users SET is_frozen = 1 WHERE id = ?', [req.params.userId]);
  logAudit('ACCOUNT_FROZEN', { targetUser: req.params.userId }, { userId: req.user.userId });
  res.json({ success: true });
});

app.post('/api/admin/unfreeze/:userId', authenticate, requireRole(C.ROLES.ADMIN), (req, res) => {
  DB.run('UPDATE users SET is_frozen = 0 WHERE id = ?', [req.params.userId]);
  logAudit('ACCOUNT_UNFROZEN', { targetUser: req.params.userId }, { userId: req.user.userId });
  res.json({ success: true });
});

app.post('/api/admin/config', authenticate, requireRole(C.ROLES.ADMIN), (req, res) => {
  const { key, value } = req.body;
  DB.setConfig(key, value, req.user.userId);
  logAudit('SYSTEM_CONFIG_CHANGE', { key, value }, { userId: req.user.userId });
  res.json({ success: true });
});

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  let dbOk = false, chainOk = false;
  try { dbOk = !!DB.queryOne('SELECT 1 as ok'); } catch {}
  try { chainOk = blockchain?.isChainValid() === true; } catch {}
  const healthy = dbOk && chainOk;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    uptime: process.uptime(),
    timestamp: Date.now(),
    version: C.PLATFORM_VERSION,
    memory: process.memoryUsage(),
    database: dbOk ? 'connected' : 'error',
    blockchain: chainOk ? 'valid' : 'invalid',
    worker: cluster.isWorker ? `worker-${process.pid}` : `primary-${process.pid}`,
  });
});

// ── Economy ──────────────────────────────────────────────────────────────────

app.get('/api/economy', (req, res) => res.json(DB.getDashboardStats()));
app.get('/api/economy/price-history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const history = DB.query('SELECT price, volume, recorded_at FROM price_history ORDER BY recorded_at DESC LIMIT ?', [limit]);
  res.json(history.reverse());
});

// ── Timers ───────────────────────────────────────────────────────────────────

function startTimers() {
  timerRefs.push(setInterval(() => {
    const p = DB.getPrice();
    const swing = (Math.random() - 0.5) * C.PRICE.PRICE_FLUCTUATION_RANGE;
    const newP = parseFloat(Math.max(C.PRICE.MIN_PRICE, p * (1 + swing)).toFixed(4));
    DB.setPrice(newP);
    eventBus.emit(EVENTS.PRICE_UPDATED, { price: newP });
  }, C.PRICE.PRICE_FLUCTUATION_INTERVAL_MS));

  timerRefs.push(setInterval(() => assetService.checkDeadlines(), 60000));

  // Algorithm #9: Refresh all vesting records every 5 minutes (keeps unlocked_tokens current)
  timerRefs.push(setInterval(() => {
    try {
      const result = vestingService.refreshAll();
      if (result.refreshed > 0) {
        console.log(`[Averon] Vesting sweep: refreshed ${result.refreshed}/${result.recordsChecked} records`);
      }
    } catch (err) {
      console.error('[Averon] Vesting sweep failed:', err.message);
    }
  }, C.VESTING.SWEEP_INTERVAL_MS));

  timerRefs.push(setInterval(async () => {
    try { await userStore.cleanupExpiredSessions(DB); }
    catch (e) { /* fall back to SQLite-only cleanup below */ }
    DB.run('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]);
  }, C.AUTH.SESSION_CLEANUP_INTERVAL_MS));
}

// ══════════════════════════════════════════════════════════════════════════════
// START
// ══════════════════════════════════════════════════════════════════════════════

const timerRefs = [];

(async () => {
  await DB.initDatabase();
  initAudit(DB);

  // ── Connect to MongoDB (for persistent auth) ─────────────────────────────
  // If MONGODB_URI is not set, falls back to SQLite-only mode (with warning).
  await connectMongo();

  // Sync users from MongoDB → SQLite (rebuilds SQLite after Render restart)
  // This ensures existing services that query SQLite `users` table continue
  // to work even after the ephemeral filesystem was wiped.
  try {
    const syncResult = await userStore.syncUsersFromMongoToSQLite(DB);
    if (syncResult.synced > 0) {
      console.log(`  🔄 Synced ${syncResult.synced} user(s) from MongoDB → SQLite`);
    }
  } catch (e) {
    console.error('  ⚠ User sync failed:', e.message);
  }

  blockchain = new Blockchain(DATA_DIR);
  walletManager = new WalletManager(DATA_DIR);
  systemWallet = walletManager.getSystemWallet();

  escrowService = new EscrowService(DB, blockchain, walletManager);
  vestingService = new VestingService(DB, blockchain, walletManager);
  assetService = new AssetService(DB, blockchain, walletManager, escrowService, vestingService);
  tradingEngine = new TradingEngine(DB, blockchain, walletManager);

  feeService = new FeeService(DB, blockchain, walletManager);
  priceService = new PriceService(DB);
  complianceService = new ComplianceService(DB);
  kycService = new KYCService(DB);
  paymentService = new PaymentService(DB, blockchain, walletManager, kycService);
  settlementService = new SettlementService(DB, blockchain, walletManager);

  // ── Algorithm #10: Initialize P2P node (decentralization) ───────────────
  // The blockchain is inbuilt (custom code), but it's now synchronized across
  // multiple Averon server instances via WebSocket gossip + longest-chain-wins.
  p2pNode = new P2PNode(blockchain);
  p2pNode.start();

  // Wire blockchain events to P2P gossip
  blockchain.on('transaction-added', (tx) => {
    p2pNode.broadcastTransaction(tx);
  });
  blockchain.on('block-mined', (block) => {
    p2pNode.broadcastBlock(block);
  });
  p2pNode.on('tx-received', (tx) => {
    eventBus.emit(EVENTS.TX_RECEIVED, tx);
  });
  p2pNode.on('block-received', (block) => {
    eventBus.emit(EVENTS.BLOCK_RECEIVED, block);
  });
  p2pNode.on('chain-replaced', ({ oldHeight, newHeight }) => {
    eventBus.emit(EVENTS.CHAIN_SYNCED, { oldHeight, newHeight });
  });

  startTimers();

  const http = require('http');
  const httpServer = http.createServer(app);
  const wsServer = new WebSocketServer(httpServer);

  const PORT = process.env.PORT || 4200;
  httpServer.listen(PORT, () => {
    const stats = DB.getDashboardStats();
    console.log(`\n  ╔══════════════════════════════════════════════════╗`);
    console.log(`  ║  AVERON v${C.PLATFORM_VERSION} — Enterprise Asset Tokenization   ║`);
    console.log(`  ╚══════════════════════════════════════════════════╝`);
    console.log(`  🌐 http://localhost:${PORT}`);
    console.log(`  ⛓  ${blockchain.chain.length} blocks | Difficulty ${blockchain.difficulty}`);
    console.log(`  💾 SQLite (WASM) | 🔑 ${systemWallet.address.substring(0, 16)}...`);
    console.log(`  📊 ${stats.userCount} users | ${stats.assets.total} assets | ${(stats.totalSupply || 0).toFixed(0)} AC supply`);
    console.log(`  🔒 JWT Auth | Rate Limiting | Tamper-proof Audit`);
    console.log(`  🔌 WebSocket | Admin: http://localhost:${PORT}/admin.html\n`);
  });

  // ── Graceful Shutdown ────────────────────────────────────────────────────────

  async function shutdown(signal) {
    console.log(`\n  ⚡ ${signal} received — shutting down gracefully...`);
    wsServer.broadcast('system', { type: 'SHUTDOWN', message: 'Server is shutting down' });
    timerRefs.forEach(t => clearInterval(t));

    // Stop P2P node (closes all peer connections)
    if (p2pNode) p2pNode.stop();

    // Close MongoDB connection
    await closeMongo();

    httpServer.close(() => {
      DB.persist();
      console.log('  ✅ Connections closed. Goodbye.\n');
      process.exit(0);
    });

    setTimeout(() => {
      console.error('  ⚠ Force shutdown after 10s timeout');
      process.exit(1);
    }, 10000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
})();
