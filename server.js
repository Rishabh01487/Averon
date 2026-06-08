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