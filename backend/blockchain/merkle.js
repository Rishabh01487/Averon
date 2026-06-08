// ══════════════════════════════════════════════════════════════════════════════
// AVERON MERKLE TREE — Cryptographic proof of transaction inclusion
// Used inside each block to create a root hash of all transactions.
// Enables efficient verification of any single transaction.
// ══════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
