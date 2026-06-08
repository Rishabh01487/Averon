// ══════════════════════════════════════════════════════════════════════════════
// AVERON AUTH MIDDLEWARE — JWT + bcrypt + Session Management
// ══════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const C = require('../config/constants');

// ── JWT Implementation (zero-dependency) ─────────────────────────────────────