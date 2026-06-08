// ══════════════════════════════════════════════════════════════════════════════
// AVERON MERKLE TREE — Cryptographic proof of transaction inclusion
// Used inside each block to create a root hash of all transactions.
// Enables efficient verification of any single transaction.
// ══════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');

class MerkleTree {
  constructor(leaves = []) {
    this.leaves = leaves.map(l => this.hashLeaf(l));
    this.layers = [];
    this.root = '';
    if (this.leaves.length > 0) this.build();
  }

  hashLeaf(data) {
    if (typeof data === 'string') return crypto.createHash('sha256').update(data).digest('hex');
    return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  }

  hashPair(a, b) {
    // Sort to ensure consistent ordering
    const sorted = [a, b].sort();
    return crypto.createHash('sha256').update(sorted[0] + sorted[1]).digest('hex');
  }

  build() {
    if (this.leaves.length === 0) {
      this.root = crypto.createHash('sha256').update('empty').digest('hex');
      return;
    }