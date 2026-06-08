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