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
