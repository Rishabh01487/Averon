// ══════════════════════════════════════════════════════════════════════════════
// AVERON TRANSACTION — Cryptographically signed blockchain transaction
// Every state change on the platform is a transaction.
// ══════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const C = require('../config/constants');

class Transaction {
  constructor(from, to, amount, type, data = {}) {
    this.from = from;               // Sender address (or 'SYSTEM' for mints)
    this.to = to;                   // Receiver address