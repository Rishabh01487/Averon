// ══════════════════════════════════════════════════════════════════════════════
// AVERON DATABASE — SQLite via sql.js (Pure WASM, no native deps)
// ══════════════════════════════════════════════════════════════════════════════

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'averon.db');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

let db = null;

// ── INIT ─────────────────────────────────────────────────────────────────────

async function initDatabase() {
  const SQL = await initSqlJs();

  // Load existing database or create new
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      organization TEXT DEFAULT '',
      wallet_address TEXT,
      averon_balance REAL DEFAULT 0,
      inr_spent REAL DEFAULT 0,
      created_at INTEGER
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS wallets (
      user_id TEXT PRIMARY KEY,
      public_key TEXT NOT NULL,
      private_key TEXT NOT NULL,
      address TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      category TEXT NOT NULL,
      status TEXT DEFAULT 'pending_review',
      ai_verified INTEGER DEFAULT 0,
      ai_valuation REAL DEFAULT 0,
      ai_risk_score REAL DEFAULT 0,
      ai_risk_level TEXT DEFAULT '',
      ai_analysis_summary TEXT DEFAULT '',
      ai_concerns TEXT DEFAULT '',
      ai_raw_response TEXT DEFAULT '',
      total_value REAL DEFAULT 0,
      raise_amount REAL NOT NULL,
      token_count INTEGER DEFAULT 0,
      token_price REAL DEFAULT 0,
      funded_amount REAL DEFAULT 0,
      payout_status TEXT DEFAULT 'pending',
      tx_hash TEXT DEFAULT '',
      block_index INTEGER DEFAULT 0,
      deadline INTEGER DEFAULT 0,
      created_at INTEGER
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS asset_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mimetype TEXT DEFAULT '',
      size INTEGER DEFAULT 0,
      filepath TEXT NOT NULL,
      uploaded_at INTEGER
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS asset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL,
      token_index INTEGER NOT NULL,
      price REAL NOT NULL,
      owner_id TEXT DEFAULT NULL,
      purchased_at INTEGER DEFAULT NULL,
      tx_hash TEXT DEFAULT ''
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS coin_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      price_per_coin REAL NOT NULL,
      filled REAL DEFAULT 0,
      status TEXT DEFAULT 'open',
      created_at INTEGER
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS coin_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      buyer_id TEXT NOT NULL,
      seller_id TEXT NOT NULL,
      amount REAL NOT NULL,
      price_per_coin REAL NOT NULL,
      total_inr REAL NOT NULL,
      buyer_name TEXT DEFAULT '',
      seller_name TEXT DEFAULT '',
      tx_hash TEXT DEFAULT '',
      traded_at INTEGER
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS economy (
      id INTEGER PRIMARY KEY DEFAULT 1,
      price REAL DEFAULT 1.0,
      total_minted REAL DEFAULT 0,
      total_raised_inr REAL DEFAULT 0,
      total_assets_funded INTEGER DEFAULT 0,
      holder_count INTEGER DEFAULT 0
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      price REAL NOT NULL,
      recorded_at INTEGER
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT DEFAULT '',
      action TEXT NOT NULL,
      details TEXT DEFAULT '',
      tx_hash TEXT DEFAULT '',
      block_index INTEGER DEFAULT 0,
      amount REAL DEFAULT 0,
      created_at INTEGER
    )
  `);

  // Seed economy row if not exists
  const eco = query('SELECT * FROM economy WHERE id = 1');
  if (eco.length === 0) {
    db.run('INSERT INTO economy (id, price) VALUES (1, 1.0)');
    db.run('INSERT INTO price_history (price, recorded_at) VALUES (1.0, ?)', [Date.now()]);
  }

  persist();
  console.log('  💾 SQLite database loaded (sql.js WASM)');
  return db;
}

// ── PERSIST TO DISK ──────────────────────────────────────────────────────────

function persist() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Auto-persist every 5 seconds
setInterval(() => persist(), 5000);

// ── QUERY HELPERS ────────────────────────────────────────────────────────────

function query(sql, params = []) {
  if (!db) return [];
  try {
    const stmt = db.prepare(sql);
    if (params.length) stmt.bind(params);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
  } catch (e) {
    console.error('SQL Error:', e.message, sql);
    return [];
  }
}

function queryOne(sql, params = []) {
  const results = query(sql, params);
  return results.length > 0 ? results[0] : null;
}

function run(sql, params = []) {
  if (!db) return { changes: 0, lastId: 0 };
  try {
    db.run(sql, params);
    const info = db.getRowsModified();
    const lastId = queryOne('SELECT last_insert_rowid() as id');
    persist();
    return { changes: info, lastId: lastId?.id || 0 };
  } catch (e) {
    console.error('SQL Error:', e.message, sql);
    return { changes: 0, lastId: 0 };
  }
}

// ── DOMAIN FUNCTIONS ─────────────────────────────────────────────────────────

function getPrice() {
  const e = queryOne('SELECT price FROM economy WHERE id = 1');
  return e ? e.price : 1.0;
}

function setPrice(newPrice) {
  run('UPDATE economy SET price = ? WHERE id = 1', [newPrice]);
  run('INSERT INTO price_history (price, recorded_at) VALUES (?, ?)', [newPrice, Date.now()]);
}

function calcNewPrice() {
  const eco = queryOne('SELECT * FROM economy WHERE id = 1');
  const stats = queryOne('SELECT COUNT(CASE WHEN status = "funded" THEN 1 END) as funded FROM assets');
  const funded = stats?.funded || 0;
  const minted = eco?.total_minted || 0;
  return parseFloat((1.00 * (1 + minted / 10000) * (1 + funded * 0.04)).toFixed(4));
}

function getDashboardStats() {
  const eco = queryOne('SELECT * FROM economy WHERE id = 1') || { price: 1, total_minted: 0, total_raised_inr: 0, total_assets_funded: 0, holder_count: 0 };
  const assets = queryOne(`SELECT COUNT(*) as total, 
    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
    SUM(CASE WHEN status = 'funded' THEN 1 ELSE 0 END) as funded,
    SUM(CASE WHEN status IN ('pending_review','ai_analyzing','verified') THEN 1 ELSE 0 END) as pending
    FROM assets`) || { total: 0, active: 0, funded: 0, pending: 0 };
  const invested = queryOne('SELECT COALESCE(SUM(funded_amount), 0) as total FROM assets') || { total: 0 };
  const users = queryOne('SELECT COUNT(*) as count FROM users') || { count: 0 };
  const history = query('SELECT price FROM price_history ORDER BY recorded_at DESC LIMIT 100').reverse();

  return {
    price: eco.price,
    totalMinted: eco.total_minted,
    totalRaisedInr: eco.total_raised_inr,
    totalAssetsFunded: eco.total_assets_funded,
    holders: eco.holder_count,
    assets: { total: assets.total || 0, active: assets.active || 0, funded: assets.funded || 0, pending: assets.pending || 0 },
    totalInvested: invested.total,
    userCount: users.count,
    priceHistory: history.map(h => h.price)
  };
}

// ── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = { initDatabase, query, queryOne, run, getPrice, setPrice, calcNewPrice, getDashboardStats, persist };
