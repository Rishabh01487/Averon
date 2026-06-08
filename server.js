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