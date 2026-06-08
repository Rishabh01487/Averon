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

    let layer = [...this.leaves];
    this.layers = [layer];

    while (layer.length > 1) {
      const nextLayer = [];
      for (let i = 0; i < layer.length; i += 2) {
        if (i + 1 < layer.length) {
          nextLayer.push(this.hashPair(layer[i], layer[i + 1]));
        } else {
          // Odd number: duplicate last hash
          nextLayer.push(this.hashPair(layer[i], layer[i]));
        }
      }
      this.layers.push(nextLayer);
      layer = nextLayer;
    }

    this.root = layer[0];
  }

  getRoot() {
    return this.root;
  }

  /**
   * Generate a Merkle proof for a leaf at given index.
   * Returns an array of { hash, position } pairs needed to reconstruct the root.
   */
  getProof(leafIndex) {
    if (leafIndex < 0 || leafIndex >= this.leaves.length) return null;

    const proof = [];
    let idx = leafIndex;

    for (let i = 0; i < this.layers.length - 1; i++) {
      const layer = this.layers[i];
      const isRight = idx % 2 === 1;
      const siblingIdx = isRight ? idx - 1 : idx + 1;

      if (siblingIdx < layer.length) {
        proof.push({
          hash: layer[siblingIdx],
          position: isRight ? 'left' : 'right',
        });
      } else {
        // No sibling — odd leaf gets paired with itself
        proof.push({
          hash: layer[idx],
          position: isRight ? 'left' : 'right',
        });
      }

      idx = Math.floor(idx / 2);
    }

    return proof;
  }

  /**