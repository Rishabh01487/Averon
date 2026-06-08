// ══════════════════════════════════════════════════════════════════════════════
// AVERON BLOCKCHAIN — Core engine with Merkle trees, consensus, and UTXO
// ══════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { Block } = require('./block');
const { Transaction } = require('./transaction');