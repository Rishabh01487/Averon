// ══════════════════════════════════════════════════════════════════════════════
// AVERON ASSET SERVICE — Full lifecycle state machine
// ══════════════════════════════════════════════════════════════════════════════

const C = require('../config/constants');
const { Transaction } = require('../blockchain/transaction');

class AssetService {
  constructor(db, blockchain, walletManager, escrowService) {
    this.db = db;
    this.blockchain = blockchain;
    this.walletManager = walletManager;
    this.escrow = escrowService;
  }

  // ── State Machine ──────────────────────────────────────────────────────────

  canTransition(currentStatus, newStatus) {
    const allowed = C.ASSET_TRANSITIONS[currentStatus];
    return allowed ? allowed.includes(newStatus) : false;