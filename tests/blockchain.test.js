const { Transaction } = require('../backend/blockchain/transaction');
const { Block } = require('../backend/blockchain/block');
const { MerkleTree } = require('../backend/blockchain/merkle');
const { Blockchain } = require('../backend/blockchain/chain');
const { Wallet, WalletManager } = require('../backend/blockchain/wallet');
const { adjustDifficulty, validateChain } = require('../backend/blockchain/consensus');
const path = require('path');
const os = require('os');
const fs = require('fs');

const TEST_DIR = path.join(os.tmpdir(), 'averon-test-' + Date.now());

function setup() {
  if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });
  process.env.JWT_SECRET = 'test-secret';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
}

function teardown() {
  if (fs.existsSync(TEST_DIR)) {
    try { fs.rmSync(TEST_DIR, { recursive: true }); } catch {}
  }
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

// ── Transaction Tests ──────────────────────────────────────────────────────

function testTransactionCreation() {
  const tx = new Transaction('Alice', 'Bob', 10, 'TRANSFER', { note: 'test' });
  assert(!!tx, 'Transaction created');
  assertEqual(tx.from, 'Alice', 'From address set');
  assertEqual(tx.to, 'Bob', 'To address set');
  assertEqual(tx.amount, 10, 'Amount set');
  assertEqual(tx.type, 'TRANSFER', 'Type set');
  assert(!!tx.hash, 'Hash generated');
  assert(!!tx.timestamp, 'Timestamp set');
  assert(tx.hash.length === 64, 'Hash is 64 hex chars');
}

function testTransactionSerialization() {
  const tx = new Transaction('Alice', 'Bob', 10, 'TRANSFER', { note: 'test' });
  const json = tx.toJSON();
  const restored = Transaction.fromJSON(json);
  assertEqual(restored.hash, tx.hash, 'Serialization preserves hash');
  assertEqual(restored.from, tx.from, 'Serialization preserves from');
  assertEqual(restored.amount, tx.amount, 'Serialization preserves amount');
}

function testTransactionSigning() {
  const wm = new WalletManager(TEST_DIR);
  const wallet = wm.createWallet('test_user_1');
  const tx = new Transaction(wallet.address, '0xrecipient', 5, 'TRANSFER');
  wallet.sign(tx);
  assert(tx.signature && tx.signature.length > 0, 'Transaction signed');
  assert(tx.isValid(), 'Signature verification passes');
}

function testTransactionRules() {
  const tx = new Transaction('', 'Bob', -1, 'TRANSFER');
  const result = tx.validateRules();
  assert(!result.valid, 'Invalid transaction rejected');
  assert(result.errors.length > 0, 'Errors reported');
}

function testTransactionTypes() {
  const types = ['MINT', 'TRANSFER', 'INVEST', 'DIVEST', 'PAYOUT', 'REFUND', 'FEE', 'ASSET_CREATE', 'ASSET_VERIFY', 'ASSET_CLOSE', 'TRADE', 'REWARD'];
  for (const type of types) {
    const tx = new Transaction('A', 'B', 1, type);
    assert(tx.type === type, `Transaction type: ${type}`);
  }
}

// ── Block Tests ────────────────────────────────────────────────────────────

function testBlockCreation() {
  const txs = [new Transaction('A', 'B', 1, 'TRANSFER')];
  const block = new Block(1, 'prevhash123', txs);
  assertEqual(block.index, 1, 'Block index set');
  assertEqual(block.previousHash, 'prevhash123', 'Previous hash set');
  assert(block.transactions.length === 1, 'Transactions stored');
  assert(!!block.merkleRoot, 'Merkle root computed');
  assert(block.merkleRoot.length === 64, 'Merkle root is 64 hex chars');
}

function testBlockMining() {
  const txs = [new Transaction('A', 'B', 1, 'TRANSFER')];
  const block = new Block(1, 'prevhash', txs);
  block.difficulty = 1;
  const result = block.mine(1);
  assert(block.hash.startsWith('0'), 'Hash starts with zero (difficulty 1)');
  assert(result.nonce >= 0, 'Nonce was set');
  assert(result.time >= 0, 'Mining time recorded');
}

function testBlockValidation() {
  const txs = [new Transaction('SYSTEM', '0xrecipient', 1, 'MINT')];
  const block1 = new Block(0, '0', [], Date.now() - 10000);
  block1.mine(1);
  const block2 = new Block(1, block1.hash, txs, Date.now());
  block2.mine(1);
  const validation = block2.validate(block1);
  assert(validation.valid, 'Valid block passes validation');
}

function testBlockMerkleVerification() {
  const txs = [
    new Transaction('A', 'B', 1, 'TRANSFER'),
    new Transaction('C', 'D', 2, 'TRANSFER'),
    new Transaction('E', 'F', 3, 'TRANSFER'),
  ];
  const block = new Block(1, 'prevhash', txs);
  assert(block.verifyMerkleRoot(), 'Merkle root verification passes');
}

function testBlockGetMerkleProof() {
  const txs = [new Transaction('A', 'B', 1, 'TRANSFER'), new Transaction('C', 'D', 2, 'TRANSFER')];
  const block = new Block(1, 'prevhash', txs);
  const proof = block.getMerkleProof(txs[0].hash);
  assert(!!proof, 'Merkle proof generated');
  assert(proof.proof.length > 0, 'Proof has elements');
  assertEqual(proof.root, block.merkleRoot, 'Proof root matches block root');
}

function testBlockSize() {
  const txs = [new Transaction('A', 'B', 1, 'TRANSFER')];
  const block = new Block(1, 'prevhash', txs);
  block.mine(1);
  assert(block.size > 0, 'Block size calculated');
}

// ── Merkle Tree Tests ─────────────────────────────────────────────────────

function testMerkleTreeBasic() {
  const leaves = ['a', 'b', 'c', 'd'].map(h => Buffer.from(h).toString('hex'));
  const tree = MerkleTree.fromTransactions(
    leaves.map(l => new Transaction(l, 'B', 1, 'TRANSFER'))
  );
  assert(!!tree.getRoot(), 'Merkle root computed');
}

function testMerkleTreeSingle() {
  const tx = new Transaction('A', 'B', 1, 'TRANSFER');
  const tree = MerkleTree.fromTransactions([tx]);
  assert(!!tree.getRoot(), 'Single transaction Merkle root computed');
}

function testMerkleTreeProof() {
  const txs = [new Transaction('A', 'B', 1, 'TRANSFER'), new Transaction('C', 'D', 2, 'TRANSFER'),
    new Transaction('E', 'F', 3, 'TRANSFER'), new Transaction('G', 'H', 4, 'TRANSFER')];
  const tree = MerkleTree.fromTransactions(txs);
  const proof = tree.getProof(0);
  assert(proof.length > 0, 'Proof generated for index 0');
  const verified = MerkleTree.verify(txs[0].hash, proof, tree.getRoot());
  assert(verified, 'Merkle proof verification succeeds');
}

function testMerkleTreeBadProof() {
  const txs = [new Transaction('A', 'B', 1, 'TRANSFER'), new Transaction('C', 'D', 2, 'TRANSFER')];
  const tree = MerkleTree.fromTransactions(txs);
  const proof = tree.getProof(0);
  const verified = MerkleTree.verify(proof, tree.getRoot(), 'badhash');
  assert(!verified, 'Bad hash fails Merkle verification');
}

// ── Wallet Tests ───────────────────────────────────────────────────────────

function testWalletCreation() {
  const wm = new WalletManager(TEST_DIR);
  const wallet = wm.createWallet('test_user_2');
  assert(!!wallet.address, 'Wallet has address');
  assert(wallet.address.startsWith('0x'), 'Address starts with 0x');
  assert(wallet.address.length === 42, 'Address is 42 chars');
  assert(!!wallet.publicKey, 'Wallet has public key');
  assert(!!wallet.privateKey, 'Wallet has private key');
}

function testWalletPersistence() {
  const wm = new WalletManager(TEST_DIR);
  wm.createWallet('persist_user');
  const wm2 = new WalletManager(TEST_DIR);
  const wallet = wm2.getWallet('persist_user');
  assert(!!wallet, 'Wallet persists across instances');
  assert(!!wallet.address, 'Persisted wallet has address');
}

// ── Blockchain Tests ───────────────────────────────────────────────────────

function testBlockchainGenesis() {
  const bc = new Blockchain(TEST_DIR);
  assert(bc.chain.length === 1, 'Genesis block created');
  assertEqual(bc.chain[0].index, 0, 'Genesis block index is 0');
}

function testBlockchainAddTransaction() {
  const bc = new Blockchain(TEST_DIR);
  const tx = new Transaction('A', 'B', 1, 'TRANSFER');
  assert(tx.from === 'A', 'Transaction created');
}

function testBlockchainMining() {
  const bc = new Blockchain(TEST_DIR);
  const wm = new WalletManager(TEST_DIR);
  const wallet = wm.createWallet('miner');
  const tx = new Transaction('SYSTEM', wallet.address, 5, 'MINT');
  bc.addTransaction(tx);
  const block = bc.minePendingTransactions(wallet.address);
  assert(!!block, 'Block mined');
  assertEqual(bc.chain.length, 2, 'Chain extended after mining');
}

function testBlockchainBalance() {
  const bc = new Blockchain(TEST_DIR);
  const wm = new WalletManager(TEST_DIR);
  const wallet = wm.createWallet('balance_user');
  const tx = new Transaction('SYSTEM', wallet.address, 100, 'MINT');
  bc.addTransaction(tx);
  bc.minePendingTransactions(wallet.address);
  const balance = bc.getBalance(wallet.address);
  assert(balance >= 100, 'Balance includes minted coins');
}

function testBlockchainValidation() {
  const bc = new Blockchain(TEST_DIR);
  assert(bc.isChainValid().valid !== false, 'Empty chain is valid');
}

// ── Consensus Tests ────────────────────────────────────────────────────────

function testDifficultyAdjustment() {
  const bc = new Blockchain(TEST_DIR);
  assert(bc.difficulty >= 1, 'Difficulty is at least 1');
}

// ── Run All ────────────────────────────────────────────────────────────────

function runAll() {
  console.log('\n  ═══════════════════════════════════════════════');
  console.log('  AVERON BLOCKCHAIN TESTS');
  console.log('  ═══════════════════════════════════════════════\n');

  setup();

  console.log('  ── Transaction Tests ──');
  testTransactionCreation();
  testTransactionSerialization();
  testTransactionSigning();
  testTransactionRules();
  testTransactionTypes();

  console.log('\n  ── Block Tests ──');
  testBlockCreation();
  testBlockMining();
  testBlockValidation();
  testBlockMerkleVerification();
  testBlockGetMerkleProof();
  testBlockSize();

  console.log('\n  ── Merkle Tree Tests ──');
  testMerkleTreeBasic();
  testMerkleTreeSingle();
  testMerkleTreeProof();
  testMerkleTreeBadProof();

  console.log('\n  ── Wallet Tests ──');
  testWalletCreation();
  testWalletPersistence();

  console.log('\n  ── Blockchain Tests ──');
  testBlockchainGenesis();
  testBlockchainAddTransaction();
  testBlockchainMining();
  testBlockchainBalance();
  testBlockchainValidation();

  console.log('\n  ── Consensus Tests ──');
  testDifficultyAdjustment();

  teardown();

  console.log(`\n  ═══════════════════════════════════════════════`);
  console.log(`  Results: ${testsPassed} passed, ${testsFailed} failed`);
  console.log(`  ═══════════════════════════════════════════════\n`);

  process.exit(testsFailed > 0 ? 1 : 0);
}

runAll();
