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

  // ── Payment ────────────────────────────────────────────────────────────────
  PAYMENT: {
    GATEWAYS: {
      RAZORPAY: 'razorpay',
      STRIPE: 'stripe',
      WIRE: 'wire',
      UPI: 'upi',
    },
    ORDER_STATUS: {
      CREATED: 'created',
      PENDING: 'pending',
      CONFIRMED: 'confirmed',
      COMPLETED: 'completed',
      FAILED: 'failed',
      REFUNDED: 'refunded',
      EXPIRED: 'expired',
    },
    SETTLEMENT_STATUS: {
      PENDING: 'pending',
      PROCESSING: 'processing',
      COMPLETED: 'completed',
      FAILED: 'failed',
    },
    COIN_PURCHASE_MIN_INR: 1,
    COIN_PURCHASE_MAX_INR: 50000000,  // 5 crore per transaction
    ORDER_EXPIRY_MS: 30 * 60 * 1000,  // 30 minutes
    WEBHOOK_TIMEOUT_MS: 5000,
    RECONCILIATION_INTERVAL_MS: 3600000,  // 1 hour
  },

  // ── KYC & Compliance ──────────────────────────────────────────────────────
  KYC: {
    TIERS: {
      UNVERIFIED: { level: 0, label: 'Unverified', dailyLimit: 0, monthlyLimit: 0, annualLimit: 0 },
      BASIC: { level: 1, label: 'Basic KYC', dailyLimit: 100000, monthlyLimit: 1000000, annualLimit: 5000000 },
      FULL: { level: 2, label: 'Full KYC', dailyLimit: 1000000, monthlyLimit: 10000000, annualLimit: 50000000 },
      INSTITUTIONAL: { level: 3, label: 'Institutional', dailyLimit: 100000000, monthlyLimit: 1000000000, annualLimit: 10000000000 },
    },
    DOCUMENTS: {
      AADHAAR: 'aadhaar',
      PAN: 'pan',
      PASSPORT: 'passport',
      DRIVING_LICENSE: 'driving_license',
      VOTER_ID: 'voter_id',
      GST_CERT: 'gst_certificate',
      INCORPORATION: 'incorporation_certificate',
    },
    AML_FLAGS: {
      HIGH_VALUE: 'high_value',
      HIGH_FREQUENCY: 'high_frequency',
      DUPLICATE_PATTERN: 'duplicate_pattern',
      ROUND_AMOUNT: 'round_amount',
      RAPID_SEQUENTIAL: 'rapid_sequential',
      NEW_ACCOUNT_HIGH_VALUE: 'new_account_high_value',
      HIGH_RISK_JURISDICTION: 'high_risk_jurisdiction',
      STRUCTURING: 'structuring',
    },
    TIER_UPGRADE_THRESHOLDS: {
      1: { minTrades: 3, minVolume: 10000, minAgeDays: 7 },
      2: { minTrades: 10, minVolume: 100000, minAgeDays: 30 },
      3: { minTrades: 50, minVolume: 10000000, minAgeDays: 90 },
    },
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

  // ── Trading ────────────────────────────────────────────────────────────────
  TRADING: {
    ORDER_TYPES: ['market', 'limit'],
    ORDER_SIDES: ['buy', 'sell'],
    ORDER_DURATIONS: ['GTC', 'GTD', 'IOC', 'FOK'], // Good-til-cancel, Good-til-date, Immediate-or-cancel, Fill-or-kill
    CIRCUIT_BREAKER_PERCENT: 10,     // Halt if price moves 10% in 1 hour
    CIRCUIT_BREAKER_WINDOW_MS: 60 * 60 * 1000,
    MAX_OPEN_ORDERS_PER_USER: 50,
    MIN_ORDER_AMOUNT: 0.01,
  },

  // ── Price Engine ───────────────────────────────────────────────────────────
  PRICE: {
    INITIAL_PRICE: 1.0,
    MIN_PRICE: 0.001,
    MAX_PRICE: 1000000,
    CANDLE_INTERVALS: ['1m', '5m', '15m', '1h', '4h', '1d'],
    PRICE_FLUCTUATION_INTERVAL_MS: 15 * 1000,
    PRICE_FLUCTUATION_RANGE: 0.005,  // ±0.5% natural fluctuation
    FUNDED_ASSET_BOOST_MIN: 0.02,    // +2% min boost per funded asset
    FUNDED_ASSET_BOOST_MAX: 0.05,    // +5% max boost
  },

  // ── AI Analysis ────────────────────────────────────────────────────────────
  AI: {
    GEMINI_MODEL: 'gemini-2.0-flash',
    MAX_RETRIES: 3,
    TIMEOUT_MS: 30000,
    MIN_CONFIDENCE_FOR_AUTO_APPROVE: 70,
    MIN_CONFIDENCE_FOR_LISTING: 50,
    FRAUD_ALERT_THRESHOLD: 40,
    TEMPERATURE: 0.3,
  },

  // ── Roles ──────────────────────────────────────────────────────────────────
  ROLES: {
    USER: 'user',
    ADMIN: 'admin',
    AUDITOR: 'auditor',
  },

  // ── Audit Actions ──────────────────────────────────────────────────────────
  AUDIT_ACTIONS: [
    'LOGIN', 'LOGOUT', 'REGISTER', 'PASSWORD_CHANGE',
    'ACCOUNT_CREATED', 'ACCOUNT_FROZEN', 'ACCOUNT_UNFROZEN',
    'MINT', 'TRANSFER', 'TRADE',
    'ASSET_CREATED', 'ASSET_UPDATED', 'ASSET_DELETED',
    'AI_ANALYSIS_STARTED', 'AI_ANALYSIS_COMPLETED',
    'TOKEN_PURCHASED', 'TOKEN_SOLD',
    'ESCROW_LOCKED', 'ESCROW_RELEASED', 'ESCROW_REFUNDED',
    'ORDER_PLACED', 'ORDER_FILLED', 'ORDER_CANCELLED',
    'PAYOUT_INITIATED', 'PAYOUT_COMPLETED',
    'ADMIN_ACTION', 'COMPLIANCE_FLAG', 'SYSTEM_CONFIG_CHANGE',
  ],
};
