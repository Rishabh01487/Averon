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
  db.run(`CREATE TABLE IF NOT EXISTS asset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL,
    token_index INTEGER NOT NULL,
    price REAL NOT NULL,
    owner_id TEXT DEFAULT NULL,
    purchased_at INTEGER DEFAULT NULL,
    tx_hash TEXT DEFAULT '',
    FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_id) REFERENCES users(id)
  )`);

  // ── Escrow ───────────────────────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS escrow_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER UNIQUE NOT NULL,
    address TEXT UNIQUE NOT NULL,
    balance REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    total_received REAL DEFAULT 0,
    total_released REAL DEFAULT 0,
    total_refunded REAL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (asset_id) REFERENCES assets(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS escrow_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    escrow_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    user_id TEXT,
    amount REAL NOT NULL,
    tx_hash TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (escrow_id) REFERENCES escrow_accounts(id)
  )`);

  // ── Trading ──────────────────────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS coin_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    side TEXT NOT NULL,
    amount REAL NOT NULL,
    price REAL,
    filled REAL DEFAULT 0,
    remaining REAL NOT NULL,
    status TEXT DEFAULT 'open',
    duration TEXT DEFAULT 'GTC',
    expires_at INTEGER DEFAULT 0,
    fee_paid REAL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS coin_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    buy_order_id INTEGER,
    sell_order_id INTEGER,
    buyer_id TEXT NOT NULL,
    seller_id TEXT NOT NULL,
    amount REAL NOT NULL,
    price REAL NOT NULL,
    total_value REAL NOT NULL,
    buyer_fee REAL DEFAULT 0,
    seller_fee REAL DEFAULT 0,
    tx_hash TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (buyer_id) REFERENCES users(id),
    FOREIGN KEY (seller_id) REFERENCES users(id)
  )`);

  // ── Economy ──────────────────────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS economy (
    id INTEGER PRIMARY KEY DEFAULT 1,
    price REAL DEFAULT ${C.PRICE.INITIAL_PRICE},
    total_supply REAL DEFAULT 0,
    circulating_supply REAL DEFAULT 0,
    total_raised_inr REAL DEFAULT 0,
    total_assets_funded INTEGER DEFAULT 0,
    total_fees_collected REAL DEFAULT 0,
    total_trades INTEGER DEFAULT 0,
    total_volume REAL DEFAULT 0,
    holder_count INTEGER DEFAULT 0,
    market_cap REAL DEFAULT 0,
    tvl REAL DEFAULT 0,
    updated_at INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    price REAL NOT NULL,
    volume REAL DEFAULT 0,
    high REAL DEFAULT 0,
    low REAL DEFAULT 0,
    open REAL DEFAULT 0,
    close REAL DEFAULT 0,
    interval TEXT DEFAULT '1m',
    recorded_at INTEGER NOT NULL
  )`);

  // ── Fees ─────────────────────────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS fee_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    fee_type TEXT NOT NULL,
    amount REAL NOT NULL,
    reference_id TEXT DEFAULT '',
    reference_type TEXT DEFAULT '',
    tx_hash TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  )`);

  // ── Notifications ────────────────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT DEFAULT '',
    data TEXT DEFAULT '{}',
    is_read INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // ── Audit Log ────────────────────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT DEFAULT '',
    action TEXT NOT NULL,
    resource_type TEXT DEFAULT '',
    resource_id TEXT DEFAULT '',
    details TEXT DEFAULT '{}',
    ip_address TEXT DEFAULT '',
    user_agent TEXT DEFAULT '',
    request_method TEXT DEFAULT '',
    request_path TEXT DEFAULT '',
    response_code INTEGER DEFAULT 0,
    prev_hash TEXT DEFAULT '',
    entry_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);

  // ── System Config ────────────────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT DEFAULT '',
    updated_by TEXT DEFAULT '',
    updated_at INTEGER NOT NULL
  )`);

  // ── Activity Log ─────────────────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT DEFAULT '',
    action TEXT NOT NULL,
    details TEXT DEFAULT '',
    tx_hash TEXT DEFAULT '',
    block_index INTEGER DEFAULT 0,
    amount REAL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`);

  // ── Indexes ──────────────────────────────────────────────────────────────
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet_address)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(refresh_token)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_assets_owner ON assets(owner_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_docs_asset ON asset_documents(asset_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tokens_asset ON asset_tokens(asset_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tokens_owner ON asset_tokens(owner_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_escrow_asset ON escrow_accounts(asset_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_orders_user ON coin_orders(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_orders_status ON coin_orders(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_trades_buyer ON coin_trades(buyer_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_trades_seller ON coin_trades(seller_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_price_time ON price_history(recorded_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_fee_user ON fee_ledger(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_status_history_asset ON asset_status_history(asset_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_escrow_tx ON escrow_transactions(escrow_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_doc_hash ON asset_documents(doc_hash)`);
}

function seedDefaults() {
  const eco = queryOne('SELECT id FROM economy WHERE id = 1');
  if (!eco) {
    run('INSERT INTO economy (id, price, updated_at) VALUES (1, ?, ?)', [C.PRICE.INITIAL_PRICE, Date.now()]);
    run('INSERT INTO price_history (price, high, low, open, close, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
      [C.PRICE.INITIAL_PRICE, C.PRICE.INITIAL_PRICE, C.PRICE.INITIAL_PRICE, C.PRICE.INITIAL_PRICE, C.PRICE.INITIAL_PRICE, Date.now()]);
  }

  // Default system configs
  const defaults = [
    ['trading_fee_percent', String(C.FEES.TRADING_FEE_PERCENT), 'Trading fee percentage'],
    ['listing_fee_ac', String(C.FEES.LISTING_FEE_AC), 'Asset listing fee in AC'],
    ['capital_raise_fee_percent', String(C.FEES.CAPITAL_RAISE_FEE_PERCENT), 'Capital raise fee percentage'],
    ['circuit_breaker_enabled', 'true', 'Enable trading circuit breaker'],
    ['circuit_breaker_percent', String(C.TRADING.CIRCUIT_BREAKER_PERCENT), 'Circuit breaker threshold %'],
    ['min_documents_required', String(C.LIMITS.MIN_DOCUMENTS), 'Min documents for listing'],
    ['cooling_off_period_ms', String(C.LIMITS.COOLING_OFF_PERIOD_MS), 'Cooling off period after listing'],
    ['auto_approve_min_confidence', String(C.AI.MIN_CONFIDENCE_FOR_AUTO_APPROVE), 'Min AI confidence for auto-approve'],
  ];
  for (const [key, value, desc] of defaults) {
    const exists = queryOne('SELECT key FROM system_config WHERE key = ?', [key]);
    if (!exists) run('INSERT INTO system_config (key, value, description, updated_at) VALUES (?, ?, ?, ?)', [key, value, desc, Date.now()]);
  }
}

// ── PERSISTENCE ──────────────────────────────────────────────────────────────

function persist() {
  if (!db) return;
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (e) {
    console.error('DB persist error:', e.message);
  }
}

// ── QUERY HELPERS ────────────────────────────────────────────────────────────

function query(sql, params = []) {
  if (!db) return [];
  try {
    const stmt = db.prepare(sql);
    if (params.length) stmt.bind(params);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());