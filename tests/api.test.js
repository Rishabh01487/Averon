const path = require('path');
const os = require('os');
const fs = require('fs');
const C = require('../backend/config/constants');

const TEST_DIR = path.join(os.tmpdir(), 'averon-api-test-' + Date.now());

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

// ── Constant Tests ─────────────────────────────────────────────────────────

function testConstants() {
  assertEqual(C.PLATFORM_NAME, 'Averon', 'Platform name correct');
  assert(!!C.TX_TYPES.MINT, 'MINT transaction type exists');
  assert(!!C.TX_TYPES.TRADE, 'TRADE transaction type exists');
  assert(!!C.ASSET_STATUS.DRAFT, 'DRAFT asset status exists');
  assert(!!C.ASSET_STATUS.ACTIVE, 'ACTIVE asset status exists');
  assert(!!C.ASSET_STATUS.FUNDED, 'FUNDED asset status exists');
  assert(!!C.ROLES.ADMIN, 'ADMIN role exists');
  assert(!!C.ROLES.USER, 'USER role exists');
  assert(Object.keys(C.TX_TYPES).length >= 12, 'All 12 transaction types defined');
  assert(Object.keys(C.ASSET_STATUS).length >= 14, 'All 14 asset statuses defined');
  assert(C.ASSET_CATEGORIES.length >= 10, 'Asset categories defined');
  assert(C.FEES.TRADING_FEE_PERCENT === 0.1, 'Trading fee is 0.1%');
  assert(C.LIMITS.MIN_INVESTMENT_INR >= 0, 'Min investment defined');
}

function testStateTransitions() {
  assertEqual(C.ASSET_TRANSITIONS['draft'][0], 'documents_uploaded', 'Draft → documents_uploaded');
  assertEqual(C.ASSET_TRANSITIONS['active'][0], 'funding', 'Active → funding');
  assertEqual(C.ASSET_TRANSITIONS['verified'][0], 'compliance_review', 'Verified → compliance_review');
  assertEqual(C.ASSET_TRANSITIONS['funded'][0], 'payout_pending', 'Funded → payout_pending');
}

// ── Auth Tests ─────────────────────────────────────────────────────────────

function testAuthFunctions() {
  const auth = require('../backend/middleware/auth');
  assert(typeof auth.hashPassword === 'function', 'hashPassword function exists');
  assert(typeof auth.verifyPassword === 'function', 'verifyPassword function exists');
  assert(typeof auth.generateTokens === 'function', 'generateTokens function exists');
  assert(typeof auth.authenticate === 'function', 'authenticate middleware exists');
  assert(typeof auth.requireRole === 'function', 'requireRole middleware exists');
  assert(typeof auth.signJWT === 'function', 'signJWT function exists');
}

function testJWTCreation() {
  const { signJWT, verifyJWT } = require('../backend/middleware/auth');
  const token = signJWT({ userId: 'test', role: 'admin' }, 'secret', '1h');
  assert(token.split('.').length === 3, 'JWT has 3 parts');
  const decoded = verifyJWT(token, 'secret');
  assert(!!decoded, 'JWT verifies with correct secret');
  assertEqual(decoded.userId, 'test', 'JWT payload has userId');
  assertEqual(decoded.role, 'admin', 'JWT payload has role');
  const bad = verifyJWT(token, 'wrongsecret');
  assert(!bad, 'JWT fails with wrong secret');
}

function testJWTExpiry() {
  const { signJWT, verifyJWT } = require('../backend/middleware/auth');
  const token = signJWT({ userId: 'test', exp: Math.floor(Date.now() / 1000) - 10 }, 'secret', -10);
  const decoded = verifyJWT(token, 'secret');
  assert(!decoded, 'Expired JWT rejected');
}

function testPasswordHashing() {
  const { hashPassword, verifyPassword } = require('../backend/middleware/auth');
  return hashPassword('testpassword123').then(async (hash) => {
    assert(hash.includes(':'), 'Password hash contains salt separator');
    const valid = await verifyPassword('testpassword123', hash);
    assert(valid, 'Correct password verifies');
    const invalid = await verifyPassword('wrongpassword', hash);
    assert(!invalid, 'Wrong password rejected');
  });
}

// ── Validator Tests ────────────────────────────────────────────────────────

function testValidator() {
  const { validate } = require('../backend/middleware/validator');
  assert(typeof validate === 'function', 'validate function exists');
}

// ── Audit Tests ────────────────────────────────────────────────────────────

function testAudit() {
  const audit = require('../backend/middleware/audit');
  assert(typeof audit.initAudit === 'function', 'initAudit function exists');
  assert(typeof audit.logAudit === 'function', 'logAudit function exists');
  assert(typeof audit.auditMiddleware === 'function', 'auditMiddleware exists');
  assert(typeof audit.verifyAuditChain === 'function', 'verifyAuditChain exists');
}

// ── Event Bus Tests ────────────────────────────────────────────────────────

function testEventBus() {
  const { eventBus, EVENTS } = require('../backend/services/eventBus');
  assert(!!EVENTS.BLOCK_MINED, 'BLOCK_MINED event exists');
  assert(!!EVENTS.TRADE_EXECUTED, 'TRADE_EXECUTED event exists');
  assert(!!EVENTS.PRICE_UPDATED, 'PRICE_UPDATED event exists');

  let received = null;
  const unsub = eventBus.on(EVENTS.TRADE_EXECUTED, (data) => { received = data; });
  eventBus.emit(EVENTS.TRADE_EXECUTED, { test: true });
  assert(!!received, 'Event emitted and received');
  unsub();
  received = null;
  eventBus.emit(EVENTS.TRADE_EXECUTED, { test: false });
  assert(!received, 'Unsubscribed handler not called');
}

// ── Run All ────────────────────────────────────────────────────────────────

async function runAll() {
  console.log('\n  ═══════════════════════════════════════════════');
  console.log('  AVERON API & INTEGRATION TESTS');
  console.log('  ═══════════════════════════════════════════════\n');

  process.env.JWT_SECRET = 'test-secret-api';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-api';
  if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });

  console.log('  ── Constants Tests ──');
  testConstants();
  testStateTransitions();

  console.log('\n  ── Auth Tests ──');
  testAuthFunctions();
  testJWTCreation();
  testJWTExpiry();
  await testPasswordHashing();

  console.log('\n  ── Validation Tests ──');
  testValidator();

  console.log('\n  ── Audit Tests ──');
  testAudit();

  console.log('\n  ── Event Bus Tests ──');
  testEventBus();

  try { if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true }); } catch {}

  console.log(`\n  ═══════════════════════════════════════════════`);
  console.log(`  Results: ${testsPassed} passed, ${testsFailed} failed`);
  console.log(`  ═══════════════════════════════════════════════\n`);

  process.exit(testsFailed > 0 ? 1 : 0);
}

runAll();
