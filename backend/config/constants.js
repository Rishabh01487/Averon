// ══════════════════════════════════════════════════════════════════════════════
// AVERON SYSTEM CONSTANTS
// Central configuration for the entire platform.
// ══════════════════════════════════════════════════════════════════════════════

module.exports = {
  // ── Platform ───────────────────────────────────────────────────────────────
  PLATFORM_NAME: 'Averon',
  PLATFORM_VERSION: '4.0.0',
  PLATFORM_CURRENCY: 'AC', // Averon Coin
  PLATFORM_FIAT: 'INR',

  // ── Authentication ─────────────────────────────────────────────────────────
  AUTH: {
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    BCRYPT_SALT_ROUNDS: 12,
    MAX_LOGIN_ATTEMPTS: 5,
    LOCKOUT_DURATION_MS: 15 * 60 * 1000, // 15 minutes
    PASSWORD_MIN_LENGTH: 8,
    SESSION_CLEANUP_INTERVAL_MS: 60 * 60 * 1000, // 1 hour
  },

  // ── Rate Limiting ──────────────────────────────────────────────────────────
  RATE_LIMITS: {
    GENERAL: { windowMs: 60 * 1000, max: 100 },      // 100 req/min
    AUTH: { windowMs: 60 * 1000, max: 10 },            // 10 req/min
    FINANCIAL: { windowMs: 1000, max: 5 },             // 5 req/sec
    UPLOAD: { windowMs: 60 * 1000, max: 10 },          // 10 uploads/min
    ADMIN: { windowMs: 60 * 1000, max: 200 },          // 200 req/min
  },

  // ── Blockchain ─────────────────────────────────────────────────────────────
  BLOCKCHAIN: {
    DIFFICULTY: 2,
    DIFFICULTY_ADJUSTMENT_INTERVAL: 10,  // blocks
    TARGET_BLOCK_TIME_MS: 30 * 1000,     // 30 seconds
    MIN_DIFFICULTY: 1,
    MAX_DIFFICULTY: 6,
    MINING_REWARD: 0.1,
    MAX_TRANSACTIONS_PER_BLOCK: 100,
    GENESIS_TIMESTAMP: 1717200000000,    // Fixed genesis time
    MAX_BLOCK_SIZE_BYTES: 1024 * 1024,   // 1MB
    MAX_FUTURE_BLOCK_TIME_MS: 2 * 60 * 1000, // 2 min future tolerance
  },

  // ── Transaction Types ──────────────────────────────────────────────────────
  TX_TYPES: {
    MINT: 'MINT',
    TRANSFER: 'TRANSFER',
    INVEST: 'INVEST',
    DIVEST: 'DIVEST',
    PAYOUT: 'PAYOUT',
    REFUND: 'REFUND',
    FEE: 'FEE',
    ASSET_CREATE: 'ASSET_CREATE',
    ASSET_VERIFY: 'ASSET_VERIFY',
    ASSET_CLOSE: 'ASSET_CLOSE',
    TRADE: 'TRADE',
    REWARD: 'REWARD',
  },

  // ── Asset Status State Machine ─────────────────────────────────────────────
  ASSET_STATUS: {
    DRAFT: 'draft',
    DOCUMENTS_UPLOADED: 'documents_uploaded',
    AI_ANALYZING: 'ai_analyzing',
    VERIFIED: 'verified',
    REJECTED: 'rejected',
    COMPLIANCE_REVIEW: 'compliance_review',
    FLAGGED: 'flagged',
    ACTIVE: 'active',
    FUNDING: 'funding',
    FUNDED: 'funded',
    PAYOUT_PENDING: 'payout_pending',
    COMPLETED: 'completed',
    EXPIRED: 'expired',
    REFUNDING: 'refunding',
    CLOSED: 'closed',
  },

  // Valid state transitions
  ASSET_TRANSITIONS: {
    draft: ['documents_uploaded'],
    documents_uploaded: ['ai_analyzing'],
    ai_analyzing: ['verified', 'rejected'],
    verified: ['compliance_review'],
    rejected: ['draft'],
    compliance_review: ['active', 'flagged'],
    flagged: ['active', 'rejected'],
    active: ['funding', 'expired'],
    funding: ['funded', 'expired'],
    funded: ['payout_pending'],
    payout_pending: ['completed'],
    expired: ['refunding'],
    refunding: ['closed'],
    completed: ['closed'],
  },

  // ── Asset Categories ───────────────────────────────────────────────────────
  ASSET_CATEGORIES: [
    'Stocks & Shares',
    'Land & Real Estate',
    'Agricultural Goods',
    'Shop Inventory',
    'Equipment',
    'Invoices & Bills',
    'Vehicles',
    'Precious Metals',
    'Commodities',
    'Infrastructure',
    'Energy',
    'Other',
  ],

  // ── Fees ───────────────────────────────────────────────────────────────────
  FEES: {
    TRADING_FEE_PERCENT: 0.1,        // 0.1% per trade
    LISTING_FEE_AC: 1.0,             // 1 AC to list an asset
    CAPITAL_RAISE_FEE_PERCENT: 1.0,  // 1% of raised amount
    WITHDRAWAL_FEE_AC: 0.5,          // 0.5 AC withdrawal fee
    MIN_TRADE_AMOUNT: 0.01,          // Minimum trade: 0.01 AC
  },

  // ── Investment Limits ──────────────────────────────────────────────────────
  LIMITS: {
    MIN_INVESTMENT_INR: 10,
    MAX_SINGLE_RAISE_INR: 10000000,  // 1 crore
    MAX_PORTFOLIO_CONCENTRATION: 0.3, // Max 30% in one asset
    COOLING_OFF_PERIOD_MS: 0,         // 0 for dev, 24h for production
    MIN_DOCUMENTS: 1,
    MAX_DOCUMENTS: 10,
    MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024, // 10MB
    ALLOWED_MIMETYPES: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    MIN_RAISE_AMOUNT: 100,
    MAX_RAISE_AMOUNT: 10000000,
    DEFAULT_LISTING_DAYS: 30,
    MAX_LISTING_DAYS: 365,
    MIN_TOKEN_COUNT: 2,
    MAX_TOKEN_COUNT: 10000,
    MIN_TOKEN_PRICE_INR: 10,
    MAX_TOKEN_PRICE_INR: 100000,
  },
