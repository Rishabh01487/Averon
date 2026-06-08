// ══════════════════════════════════════════════════════════════════════════════
// AVERON BLOCK — Blockchain block with Merkle root
// ══════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { MerkleTree } = require('./merkle');
const { Transaction } = require('./transaction');
const C = require('../config/constants');