// ══════════════════════════════════════════════════════════════════════════════
// AVERON TRADING ENGINE — Professional order book + matching
// ══════════════════════════════════════════════════════════════════════════════

const C = require('../config/constants');
const { Transaction } = require('../blockchain/transaction');

class TradingEngine {
  constructor(db, blockchain, walletManager) {
    this.db = db;
    this.blockchain = blockchain;
    this.walletManager = walletManager;