// ══════════════════════════════════════════════════════════════════════════════
// AVERON AUDIT MIDDLEWARE — Tamper-proof audit logging
// Every audit entry is hash-chained to the previous, making it immutable.
// ══════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');

let _db = null;