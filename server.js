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