// ══════════════════════════════════════════════════════════════════════════════
// AVERON ESCROW SERVICE — Holds funds during asset funding
// Double-entry bookkeeping for every coin movement.
// ══════════════════════════════════════════════════════════════════════════════

const C = require('../config/constants');

class EscrowService {
  constructor(db, blockchain, walletManager) {
    this.db = db;
    this.blockchain = blockchain;
    this.walletManager = walletManager;
  }

  /**
   * Create an escrow account for an asset.
   */
  createEscrow(assetId) {
    const address = `ESCROW_${assetId}_${Date.now().toString(36)}`;
    this.db.run(