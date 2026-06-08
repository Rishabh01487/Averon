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