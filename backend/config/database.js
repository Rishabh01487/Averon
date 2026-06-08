// ══════════════════════════════════════════════════════════════════════════════
// AVERON DATABASE — Enterprise SQLite with 25+ Tables
// Uses sql.js (WASM) for zero native dependency.
// ══════════════════════════════════════════════════════════════════════════════

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const C = require('./constants');

const DB_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DB_DIR, 'averon.db');