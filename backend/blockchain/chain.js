// ══════════════════════════════════════════════════════════════════════════════
// AVERON BLOCKCHAIN — Core engine with Merkle trees, consensus, and UTXO
// ══════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { Block } = require('./block');
const { Transaction } = require('./transaction');
const { MerkleTree } = require('./merkle');
const { adjustDifficulty, validateChain, getChainStats } = require('./consensus');
const C = require('../config/constants');

class Blockchain {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.chainPath = path.join(dataDir, 'chain.json');