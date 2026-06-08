// ══════════════════════════════════════════════════════════════════════════════
// AVERON INPUT VALIDATOR — Schema validation & sanitization
// ══════════════════════════════════════════════════════════════════════════════

const C = require('../config/constants');

// ── Sanitization ─────────────────────────────────────────────────────────────

function sanitizeString(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[<>]/g, '')       // Strip angle brackets (XSS)