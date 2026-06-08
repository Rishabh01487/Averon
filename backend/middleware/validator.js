// ══════════════════════════════════════════════════════════════════════════════
// AVERON INPUT VALIDATOR — Schema validation & sanitization
// ══════════════════════════════════════════════════════════════════════════════

const C = require('../config/constants');

// ── Sanitization ─────────────────────────────────────────────────────────────

function sanitizeString(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[<>]/g, '')       // Strip angle brackets (XSS)
    .replace(/javascript:/gi, '') // Strip js: protocol
    .replace(/on\w+=/gi, '')     // Strip event handlers
    .trim();
}

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value);
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// ── Validation Rules ─────────────────────────────────────────────────────────

const rules = {
  required: (val) => val !== undefined && val !== null && val !== '',
  string: (val) => typeof val === 'string',
  number: (val) => typeof val === 'number' && !isNaN(val),
  email: (val) => typeof val === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
  minLength: (min) => (val) => typeof val === 'string' && val.length >= min,
  maxLength: (max) => (val) => typeof val === 'string' && val.length <= max,
  min: (min) => (val) => typeof val === 'number' && val >= min,
  max: (max) => (val) => typeof val === 'number' && val <= max,
  oneOf: (values) => (val) => values.includes(val),
  pattern: (regex) => (val) => typeof val === 'string' && regex.test(val),
  alphanumeric: (val) => typeof val === 'string' && /^[a-zA-Z0-9_]+$/.test(val),
};

// ── Schema Definitions ──────────────────────────────────────────────────────

const schemas = {
  register: {
    email: [{ rule: rules.required, msg: 'Email is required' }, { rule: rules.email, msg: 'Invalid email format' }],
    password: [{ rule: rules.required, msg: 'Password is required' }, { rule: rules.minLength(C.AUTH.PASSWORD_MIN_LENGTH), msg: `Password must be at least ${C.AUTH.PASSWORD_MIN_LENGTH} characters` }],
    name: [{ rule: rules.required, msg: 'Name is required' }, { rule: rules.minLength(2), msg: 'Name too short' }, { rule: rules.maxLength(80), msg: 'Name too long' }],
    organization: [{ rule: rules.maxLength(100), msg: 'Organization name too long' }],
  },

  login: {
    email: [{ rule: rules.required, msg: 'Email is required' }, { rule: rules.email, msg: 'Invalid email format' }],
    password: [{ rule: rules.required, msg: 'Password is required' }],
  },

  createAsset: {
    title: [{ rule: rules.required, msg: 'Title is required' }, { rule: rules.minLength(5), msg: 'Title too short (min 5 chars)' }, { rule: rules.maxLength(200), msg: 'Title too long' }],
    description: [{ rule: rules.required, msg: 'Description is required' }, { rule: rules.minLength(20), msg: 'Description too short (min 20 chars)' }, { rule: rules.maxLength(5000), msg: 'Description too long' }],
    category: [{ rule: rules.required, msg: 'Category is required' }, { rule: rules.oneOf(C.ASSET_CATEGORIES), msg: 'Invalid category' }],
    raiseAmount: [{ rule: rules.required, msg: 'Raise amount is required' }, { rule: rules.number, msg: 'Raise amount must be a number' }, { rule: rules.min(C.LIMITS.MIN_RAISE_AMOUNT), msg: `Minimum raise: ₹${C.LIMITS.MIN_RAISE_AMOUNT}` }, { rule: rules.max(C.LIMITS.MAX_RAISE_AMOUNT), msg: `Maximum raise: ₹${C.LIMITS.MAX_RAISE_AMOUNT.toLocaleString()}` }],
    days: [{ rule: rules.number, msg: 'Days must be a number' }, { rule: rules.min(1), msg: 'Minimum 1 day' }, { rule: rules.max(C.LIMITS.MAX_LISTING_DAYS), msg: `Maximum ${C.LIMITS.MAX_LISTING_DAYS} days` }],
  },

  buyCoins: {
    amountInr: [{ rule: rules.required, msg: 'Amount is required' }, { rule: rules.number, msg: 'Amount must be a number' }, { rule: rules.min(C.LIMITS.MIN_INVESTMENT_INR), msg: `Minimum ₹${C.LIMITS.MIN_INVESTMENT_INR}` }],
  },

  buyTokens: {
    count: [{ rule: rules.required, msg: 'Token count is required' }, { rule: rules.number, msg: 'Count must be a number' }, { rule: rules.min(1), msg: 'Minimum 1 token' }, { rule: rules.max(C.LIMITS.MAX_TOKEN_COUNT), msg: `Maximum ${C.LIMITS.MAX_TOKEN_COUNT} tokens` }],
  },

  placeOrder: {
    side: [{ rule: rules.required, msg: 'Side is required' }, { rule: rules.oneOf(C.TRADING.ORDER_SIDES), msg: 'Side must be buy or sell' }],
    amount: [{ rule: rules.required, msg: 'Amount is required' }, { rule: rules.number, msg: 'Amount must be a number' }, { rule: rules.min(C.TRADING.MIN_ORDER_AMOUNT), msg: `Minimum order: ${C.TRADING.MIN_ORDER_AMOUNT} AC` }],
    price: [{ rule: rules.number, msg: 'Price must be a number' }, { rule: rules.min(0.001), msg: 'Price too low' }],
    type: [{ rule: rules.oneOf(C.TRADING.ORDER_TYPES), msg: 'Invalid order type' }],
  },
};

// ── Validate Function ────────────────────────────────────────────────────────

function validate(schemaName) {
  return (req, res, next) => {
    const schema = schemas[schemaName];
    if (!schema) return next();

    // Sanitize input first
    req.body = sanitizeObject(req.body);

    const errors = [];
    for (const [field, fieldRules] of Object.entries(schema)) {
      const value = req.body[field];
      for (const { rule, msg } of fieldRules) {
        // Skip non-required fields that are undefined
        if (value === undefined && rule !== rules.required) continue;
        if (rule === rules.required && !rule(value)) {
          errors.push({ field, message: msg });
          break; // Stop checking this field
        }
        if (value !== undefined && typeof rule === 'function' && !rule(value)) {
          errors.push({ field, message: msg });
          break;
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: errors,
      });
    }

    next();
  };
}

// Global sanitizer middleware
function sanitizeBody(req, res, next) {