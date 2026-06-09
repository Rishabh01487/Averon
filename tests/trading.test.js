const C = require('../backend/config/constants');
const path = require('path');
const os = require('os');
const fs = require('fs');

const TEST_DIR = path.join(os.tmpdir(), 'averon-trade-test-' + Date.now());

// Mock database for testing
class MockDB {
  constructor() {
    this.data = { config: {
      trading_fee_percent: '0.1',
      capital_raise_fee_percent: '1.0',
    }, economy: { price: 1.0 }, users: {}, orders: [], trades: [] };
  }

  queryOne(sql, params) {
    if (sql.includes('COUNT')) return { c: 0 };
    if (sql.includes('SELECT price')) return { price: 1.0 };
    if (sql.includes('FROM users')) return { id: 'test', averon_balance: 1000, is_frozen: 0 };
    if (sql.includes('FROM wallets')) return { address: '0xtest' };
    return null;
  }

  query(sql, params) { return []; }
  run(sql, params) { return { changes: 1, lastId: 1 }; }
  getPrice() { return 1.0; }
  getConfig(key) { return this.data.config[key] || null; }
  setPrice(p) { this.data.economy.price = p; }
  incrementEconomy(field, amount) {}
}

class MockBlockchain {
  constructor() { this.balances = {}; }
  getBalance(address) { return this.balances[address] || 1000; }
  addTransaction(tx) { return tx; }
  minePendingTransactions() { return { index: 1 }; }
}

class MockWalletManager {
  getSystemWallet() { return { address: '0xsystem' }; }
  getPlatformFeeWallet() { return { address: '0xfee' }; }
  getWallet(userId) { return { address: '0x' + userId, sign: (tx) => { tx.signature = 'sig'; } }; }
}

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, name) {
  if (condition) { testsPassed++; console.log(`  ✓ ${name}`); }
  else { testsFailed++; console.error(`  ✗ ${name}`); }
}

function assertEqual(actual, expected, name) {
  if (actual === expected) { testsPassed++; console.log(`  ✓ ${name}`); }
  else { testsFailed++; console.error(`  ✗ ${name} — expected ${expected}, got ${actual}`); }
}

// ── Fee Service Tests ──────────────────────────────────────────────────────

function testFeeService() {
  const { FeeService } = require('../backend/services/feeService');
  const db = new MockDB();
  const bc = new MockBlockchain();
  const wm = new MockWalletManager();
  const feeSvc = new FeeService(db, bc, wm);

  const fees = feeSvc.calculateTradeFees(100, 1.0);
  assertEqual(fees.feeRate, 0.001, 'Trading fee rate is 0.1%');
  assert(fees.makerFee > 0, 'Maker fee calculated');
  assert(fees.takerFee > 0, 'Taker fee calculated');
  assertEqual(fees.totalFee, fees.makerFee + fees.takerFee, 'Total fee is sum');
}

function testRaiseFee() {
  const { FeeService } = require('../backend/services/feeService');
  const db = new MockDB();
  const feeSvc = new FeeService(db, new MockBlockchain(), new MockWalletManager());
  const raiseFee = feeSvc.calculateRaiseFee(10000);
  assertEqual(raiseFee.feeRate, 0.01, 'Capital raise fee rate is 1%');
  assert(raiseFee.fee > 0, 'Raise fee calculated');
}

// ── Price Service Tests ────────────────────────────────────────────────────

function testPriceServiceInitialization() {
  const { PriceService } = require('../backend/services/priceService');
  const db = new MockDB();
  const ps = new PriceService(db);
  assertEqual(ps.getSpotPrice(), 1.0, 'Initial spot price is 1.0');
}

function testSMA() {
  const { PriceService } = require('../backend/services/priceService');
  const db = new MockDB();
  db.query = (sql, params) => [{ price: 1.0 }, { price: 1.1 }, { price: 1.2 }, { price: 1.3 }, { price: 1.4 }];
  const ps = new PriceService(db);
  const sma = ps.calculateSMA(5);
  assert(sma > 0, 'SMA calculated');
  assertEqual(sma, 1.2, 'SMA correct for simple case');
}

function testPriceImpact() {
  const { PriceService } = require('../backend/services/priceService');
  const db = new MockDB();
  db.query = (sql, params) => [{ price: 1.0, total: 100 }, { price: 1.1, total: 100 }];
  const ps = new PriceService(db);
  const impact = ps.getPriceImpact(50, 'buy');
  assert(impact.fillable > 0, 'Fillable amount calculated');
  assert(typeof impact.impact === 'number', 'Price impact calculated');
}

// ── Compliance Service Tests ───────────────────────────────────────────────

function testCompliancePreListing() {
  const { ComplianceService } = require('../backend/services/complianceService');
  const db = new MockDB();
  db.queryOne = (sql, params) => {
    if (sql.includes('COUNT')) return { c: 2 };
    return null;
  };
  const cs = new ComplianceService(db);
  const asset = { id: 1, raise_amount: 1000, description: 'A good description that is long enough', cooling_off_until: 0 };
  const checks = cs.checkPreListing(asset);
  assert(checks.passed, 'Good asset passes pre-listing checks');
  assertEqual(checks.failures.length, 0, 'No failures');
}

function testComplianceExposure() {
  const { ComplianceService } = require('../backend/services/complianceService');
  const db = new MockDB();
  db.queryOne = (sql, params) => {
    if (sql.includes('averon_balance')) return { averon_balance: 100 };
    if (sql.includes('SUM(price)')) return { total: 10 };
    if (sql.includes('is_frozen')) return { is_frozen: 0 };
    return { id: 'test', is_frozen: 0 };
  };
  const cs = new ComplianceService(db);
  const result = cs.checkInvestorExposure('user1', 1, 5);
  assert(result.approved, 'Small investment approved');
}

// ── Run All ────────────────────────────────────────────────────────────────

function runAll() {
  console.log('\n  ═══════════════════════════════════════════════');
  console.log('  AVERON SERVICE TESTS (Trading, Fees, Prices, Compliance)');
  console.log('  ═══════════════════════════════════════════════\n');

  console.log('  ── Fee Service Tests ──');
  testFeeService();
  testRaiseFee();

  console.log('\n  ── Price Service Tests ──');
  testPriceServiceInitialization();
  testSMA();
  testPriceImpact();

  console.log('\n  ── Compliance Service Tests ──');
  testCompliancePreListing();
  testComplianceExposure();

  console.log(`\n  ═══════════════════════════════════════════════`);
  console.log(`  Results: ${testsPassed} passed, ${testsFailed} failed`);
  console.log(`  ═══════════════════════════════════════════════\n`);

  process.exit(testsFailed > 0 ? 1 : 0);
}

runAll();
