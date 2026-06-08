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
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

let db = null;
let _persistTimer = null;

// ── INITIALIZATION ───────────────────────────────────────────────────────────

async function initDatabase() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
    console.log('  💾 Loaded existing database');
  } else {
    db = new SQL.Database();
    console.log('  💾 Created new database');
  }

  // Enable WAL-like behavior (not actual WAL in sql.js, but we persist frequently)
  createSchema();
  seedDefaults();
  persist();

  // Auto-persist every 3 seconds
  _persistTimer = setInterval(persist, 3000);

  return db;
}

// ── SCHEMA ───────────────────────────────────────────────────────────────────

function createSchema() {
  // ── Users & Auth ─────────────────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    password_hash TEXT,
    name TEXT NOT NULL,
    organization TEXT DEFAULT '',
    role TEXT DEFAULT '${C.ROLES.USER}',
    wallet_address TEXT UNIQUE,
    averon_balance REAL DEFAULT 0,
    inr_spent REAL DEFAULT 0,
    inr_withdrawn REAL DEFAULT 0,
    is_frozen INTEGER DEFAULT 0,
    login_attempts INTEGER DEFAULT 0,
    locked_until INTEGER DEFAULT 0,
    last_login INTEGER DEFAULT 0,
    kyc_status TEXT DEFAULT 'none',
    kyc_data TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    device_info TEXT DEFAULT '',
    ip_address TEXT DEFAULT '',
    is_revoked INTEGER DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // ── Wallets ──────────────────────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS wallets (
    user_id TEXT PRIMARY KEY,
    public_key TEXT NOT NULL,
    private_key TEXT NOT NULL,
    address TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // ── Assets ───────────────────────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    category TEXT NOT NULL,
    status TEXT DEFAULT '${C.ASSET_STATUS.DRAFT}',
    
    ai_verified INTEGER DEFAULT 0,
    ai_valuation REAL DEFAULT 0,
    ai_risk_score REAL DEFAULT 0,
    ai_risk_level TEXT DEFAULT '',
    ai_confidence REAL DEFAULT 0,
    ai_analysis_summary TEXT DEFAULT '',
    ai_concerns TEXT DEFAULT '',
    ai_raw_response TEXT DEFAULT '',
    ai_analyzed_at INTEGER DEFAULT 0,
    
    total_value REAL DEFAULT 0,
    raise_amount REAL NOT NULL,
    token_count INTEGER DEFAULT 0,
    token_price REAL DEFAULT 0,
    funded_amount REAL DEFAULT 0,
    funded_at INTEGER DEFAULT 0,
    
    payout_status TEXT DEFAULT 'none',
    payout_amount_inr REAL DEFAULT 0,
    payout_tx_hash TEXT DEFAULT '',
    
    escrow_address TEXT DEFAULT '',
    escrow_balance REAL DEFAULT 0,
    
    tx_hash TEXT DEFAULT '',
    block_index INTEGER DEFAULT 0,
    
    compliance_status TEXT DEFAULT 'pending',
    compliance_notes TEXT DEFAULT '',
    compliance_checked_at INTEGER DEFAULT 0,
    
    deadline INTEGER DEFAULT 0,
    cooling_off_until INTEGER DEFAULT 0,
    
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS asset_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mimetype TEXT DEFAULT '',
    size INTEGER DEFAULT 0,
    filepath TEXT NOT NULL,
    doc_type TEXT DEFAULT 'unknown',
    doc_hash TEXT DEFAULT '',
    is_verified INTEGER DEFAULT 0,
    uploaded_at INTEGER NOT NULL,
    FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS asset_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL,
    old_status TEXT,
    new_status TEXT NOT NULL,
    changed_by TEXT DEFAULT '',
    reason TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS asset_valuations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL,
    valuation REAL NOT NULL,
    risk_score REAL NOT NULL,
    confidence REAL NOT NULL,
    source TEXT DEFAULT 'ai',
    details TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
  )`);

  // ── Tokens ───────────────────────────────────────────────────────────────