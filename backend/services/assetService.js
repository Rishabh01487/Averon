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
  }

  transition(assetId, newStatus, changedBy = '', reason = '') {
    const asset = this.db.queryOne('SELECT * FROM assets WHERE id = ?', [assetId]);
    if (!asset) throw new Error('Asset not found');

    if (!this.canTransition(asset.status, newStatus)) {
      throw new Error(`Cannot transition from ${asset.status} to ${newStatus}`);
    }

    this.db.run('INSERT INTO asset_status_history (asset_id, old_status, new_status, changed_by, reason, created_at) VALUES (?,?,?,?,?,?)',
      [assetId, asset.status, newStatus, changedBy, reason, Date.now()]);