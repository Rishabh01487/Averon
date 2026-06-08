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