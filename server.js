require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const multer = require('multer');

// ── MODULES ──────────────────────────────────────────────────────────────────
const { db, stmts, getPrice, setPrice, calcNewPrice, getDashboardStats } = require('./database');
const { Transaction, Blockchain, WalletManager } = require('./blockchain');
const { analyzeAsset } = require('./ai-engine');
const { tokenizeAsset } = require('./tokenizer');
const { checkAndProcessFunding, checkDeadlines } = require('./capital');
const { placeSellOrder, placeBuyOrder, cancelOrder, getOrderBook } = require('./marketplace');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// ── BLOCKCHAIN ───────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const blockchain = new Blockchain(DATA_DIR);
const walletManager = new WalletManager(DATA_DIR);
const systemWallet = walletManager.getSystemWallet();
console.log('  ⛓  Blockchain: ' + blockchain.chain.length + ' blocks | Difficulty ' + blockchain.difficulty);
console.log('  🔑 System wallet: ' + systemWallet.address);

function mineBlock() {
  const block = blockchain.minePendingTransactions(systemWallet.address);
  if (block) console.log(`  ⛏  Mined block #${block.index} — ${block.transactions.length} txs`);
  return block;
}

// ── FILE UPLOAD ──────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS_DIR, req.params.assetId || 'temp');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    cb(null, allowed.includes(file.mimetype));
  }
});

// Serve uploads
app.use('/uploads', express.static(UPLOADS_DIR));

// ══════════════════════════════════════════════════════════════════════════════
// API ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// ── CONFIG / DASHBOARD ───────────────────────────────────────────────────────

app.get('/api/config', (req, res) => {
  const stats = getDashboardStats();
  const chainInfo = blockchain.getInfo();
  res.json({ price: stats.price, economy: stats, blockchain: chainInfo, hasGemini: !!(process.env.GEMINI_API_KEY) });
});

app.get('/api/dashboard', (req, res) => {
  const stats = getDashboardStats();
  const recentActivity = stmts.getRecentActivity.all();
  const recentTrades = stmts.getRecentTrades.all();
  res.json({ ...stats, recentActivity, recentTrades });
});

// ── ACCOUNT ──────────────────────────────────────────────────────────────────

app.post('/api/account', (req, res) => {
  const { userId, name, family } = req.body;
  if (!userId || !name) return res.status(400).json({ error: 'Missing fields' });

  const wallet = walletManager.createWallet(userId);
  stmts.createUser.run(userId, name, family || '', wallet.address);
  stmts.saveWallet.run(userId, wallet.publicKey, wallet.privateKey, wallet.address);

  // Update holder count
  const count = stmts.getUserCount.get().count;
  stmts.updateHolders.run(count);

  const user = stmts.getUser.get(userId);
  // Sync balance from blockchain
  user.averon_balance = blockchain.getBalance(wallet.address);

  stmts.logActivity.run(userId, 'ACCOUNT_CREATED', `Wallet ${wallet.address} created`, null, null, null);

  res.json({ ...user, walletAddress: wallet.address });
});

app.get('/api/account/:userId', (req, res) => {
  const user = stmts.getUser.get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const wallet = stmts.getWallet.get(req.params.userId);
  if (wallet) {
    user.averon_balance = blockchain.getBalance(wallet.address);
    stmts.updateBalance.run(user.averon_balance, user.id);
  }
  res.json({ ...user, walletAddress: wallet?.address });
});

// ── BUY AVERON COIN (Direct Mint) ────────────────────────────────────────────

app.post('/api/buy-direct', (req, res) => {
  const { userId, amountInr } = req.body;
  if (!userId || !amountInr || amountInr < 10) return res.status(400).json({ error: 'Minimum ₹10 required' });

  const user = stmts.getUser.get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const walletData = stmts.getWallet.get(userId);
  if (!walletData) return res.status(404).json({ error: 'Wallet not found' });
  const wallet = walletManager.getWallet(userId);

  const price = getPrice();
  const kbc = parseFloat((amountInr / price).toFixed(4));

  // Blockchain MINT transaction
  const mintTx = new Transaction('SYSTEM', walletData.address, kbc, 'MINT', { inr: amountInr, price });
  blockchain.addTransaction(mintTx);
  const block = mineBlock();

  // Update database
  const newBalance = blockchain.getBalance(walletData.address);
  stmts.updateBalance.run(newBalance, userId);
  stmts.updateInrSpent.run(amountInr, userId);
  stmts.addMinted.run(kbc);

  // Update price
  const newPrice = calcNewPrice();
  setPrice(newPrice);

  stmts.logActivity.run(userId, 'MINT', `Minted ${kbc} AC for ₹${amountInr}`, mintTx.hash, block?.index, kbc);

  res.json({
    success: true, kbc, newBalance, newPrice,
    txHash: mintTx.hash, blockIndex: block?.index
  });
});

// ── ASSETS ───────────────────────────────────────────────────────────────────

app.get('/api/assets', (req, res) => {
  const status = req.query.status;
  const category = req.query.category;
  let assets = status ? stmts.getAssetsByStatus.all(status) : stmts.getAssets.all();
  if (category && category !== 'all') assets = assets.filter(a => a.category === category);

  // Enrich with token info
  assets = assets.map(a => {
    const sold = stmts.countSoldTokens.get(a.id)?.count || 0;
    return { ...a, tokens_sold: sold, tokens_available: a.token_count - sold, progress: a.token_count ? Math.round((sold / a.token_count) * 100) : 0 };
  });

  res.json(assets);
});

app.get('/api/assets/:id', (req, res) => {
  const asset = stmts.getAsset.get(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });

  const docs = stmts.getDocuments.all(asset.id);
  const tokens = stmts.getTokensByAsset.all(asset.id);
  const sold = stmts.countSoldTokens.get(asset.id)?.count || 0;
  const owner = stmts.getUser.get(asset.owner_id);

  res.json({
    ...asset,
    documents: docs.map(d => ({ id: d.id, name: d.original_name, type: d.mimetype, size: d.size, url: '/uploads/' + asset.id + '/' + d.filename })),
    tokens: tokens.map(t => ({ id: t.id, index: t.token_index, price: t.price, owned: !!t.owner_id, ownerId: t.owner_id })),
    tokens_sold: sold,
    tokens_available: asset.token_count - sold,
    progress: asset.token_count ? Math.round((sold / asset.token_count) * 100) : 0,
    owner_name: owner?.name || 'Unknown',
    owner_org: owner?.organization || ''
  });
});

// Create asset + upload documents
app.post('/api/assets/create', (req, res) => {
  const { userId, title, description, category, raiseAmount, days } = req.body;
  if (!userId || !title || !category || !raiseAmount) return res.status(400).json({ error: 'Missing fields' });

  const user = stmts.getUser.get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const deadline = Date.now() + (days || 30) * 864e5;
  const result = stmts.createAsset.run(userId, title, description || '', category, parseFloat(raiseAmount), deadline, 'pending_review');
  const assetId = result.lastInsertRowid;

  stmts.logActivity.run(userId, 'ASSET_CREATED', `Asset "${title}" created — ₹${raiseAmount} raise`, null, null, parseFloat(raiseAmount));

  res.json({ assetId, status: 'pending_review' });
});

// Upload documents for an asset
app.post('/api/assets/:assetId/documents', upload.array('documents', 5), (req, res) => {
  const assetId = req.params.assetId;
  const asset = stmts.getAsset.get(assetId);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });

  // Move files from temp to asset folder
  const assetDir = path.join(UPLOADS_DIR, String(assetId));
  if (!fs.existsSync(assetDir)) fs.mkdirSync(assetDir, { recursive: true });

  const docs = [];
  for (const file of (req.files || [])) {
    // Move file if in temp
    const newPath = path.join(assetDir, file.filename);
    if (file.path !== newPath) {
      try { fs.renameSync(file.path, newPath); } catch { /* already in right place */ }
    }

    stmts.addDocument.run(assetId, file.filename, file.originalname, file.mimetype, file.size, newPath);
    docs.push({ filename: file.filename, original_name: file.originalname, mimetype: file.mimetype, size: file.size, path: newPath });
  }

  res.json({ uploaded: docs.length, documents: docs });
});

// Trigger AI analysis
app.post('/api/assets/:id/analyze', async (req, res) => {
  const asset = stmts.getAsset.get(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });

  const docs = stmts.getDocuments.all(asset.id);

  // Update status to analyzing
  db.prepare(`UPDATE assets SET status = 'ai_analyzing' WHERE id = ?`).run(asset.id);

  try {
    const result = await analyzeAsset(
      { title: asset.title, description: asset.description, category: asset.category, raise_amount: asset.raise_amount },
      docs
    );

    // Save AI results
    stmts.updateAssetAI.run(
      result.verified ? 1 : 0,
      result.estimatedValue,
      result.riskScore,
      result.riskLevel,
      result.analysis,
      result.concerns,
      result.raw || '',
      result.estimatedValue,
      result.verified ? 'verified' : 'rejected',
      asset.id
    );

    stmts.logActivity.run(asset.owner_id, 'AI_ANALYSIS', `AI ${result.verified ? 'verified' : 'rejected'} "${asset.title}" — Risk: ${result.riskLevel} (${result.riskScore}%) — Value: ₹${result.estimatedValue}`, null, null, null);

    res.json({
      ...result,
      assetId: asset.id,
      status: result.verified ? 'verified' : 'rejected'
    });
  } catch (e) {
    db.prepare(`UPDATE assets SET status = 'pending_review' WHERE id = ?`).run(asset.id);
    res.status(500).json({ error: 'AI analysis failed: ' + e.message });
  }
});

// Confirm listing (after AI verification) — creates tokens + blockchain tx
app.post('/api/assets/:id/confirm', (req, res) => {
  const { userId } = req.body;
  const asset = stmts.getAsset.get(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  if (asset.owner_id !== userId) return res.status(403).json({ error: 'Not the owner' });
  if (asset.status !== 'verified') return res.status(400).json({ error: 'Asset must be verified by AI first' });

  // Tokenize the asset
  const tokenResult = tokenizeAsset(asset.id, {
    suggestedTokens: asset.ai_valuation ? Math.max(2, Math.round(asset.raise_amount / Math.max(100, asset.raise_amount / 20))) : 10,
    tokenPriceInr: asset.raise_amount / 10,
    riskScore: asset.ai_risk_score || 50
  });

  // Record on blockchain
  const wallet = walletManager.getWallet(userId);
  if (wallet) {
    const assetTx = new Transaction(wallet.address, 'SYSTEM', 0, 'ASSET_CREATE', {
      assetId: asset.id, title: asset.title, tokens: tokenResult.tokenCount, raiseAmount: asset.raise_amount
    });
    wallet.sign(assetTx);
    blockchain.addTransaction(assetTx);
    const block = mineBlock();
    stmts.updateAssetTx.run(assetTx.hash, block?.index, asset.id);
  }

  stmts.logActivity.run(userId, 'ASSET_LISTED', `"${asset.title}" listed — ${tokenResult.tokenCount} tokens at ${tokenResult.tokenPriceAC} AC each`, null, null, null);

  res.json({ success: true, ...tokenResult, asset: stmts.getAsset.get(asset.id) });
});

// Buy tokens for an asset
app.post('/api/assets/:id/tokens/buy', (req, res) => {
  const { userId, count } = req.body;
  const tokenCount = parseInt(count) || 1;

  const asset = stmts.getAsset.get(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  if (asset.status !== 'active') return res.status(400).json({ error: 'Asset not active' });
  if (asset.owner_id === userId) return res.status(400).json({ error: 'Cannot buy your own asset tokens' });

  const user = stmts.getUser.get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const available = stmts.getAvailableTokens.all(asset.id);
  if (available.length < tokenCount) return res.status(400).json({ error: `Only ${available.length} tokens available` });

  const totalCost = parseFloat((asset.token_price * tokenCount).toFixed(4));
  const balance = blockchain.getBalance(stmts.getWallet.get(userId)?.address || '');
  if (balance < totalCost) return res.status(400).json({ error: `Insufficient balance. Need ${totalCost} AC, have ${balance} AC` });

  // Blockchain INVEST transaction
  const wallet = walletManager.getWallet(userId);
  const walletData = stmts.getWallet.get(userId);
  const escrowAddr = 'ESCROW_ASSET_' + asset.id;

  const investTx = new Transaction(walletData.address, escrowAddr, totalCost, 'INVEST', {
    assetId: asset.id, tokenCount, pricePerToken: asset.token_price
  });
  wallet.sign(investTx);
  blockchain.addTransaction(investTx);
  const block = mineBlock();

  // Update tokens
  const tokensBought = [];
  for (let i = 0; i < tokenCount; i++) {
    const token = available[i];
    stmts.buyToken.run(userId, Date.now(), investTx.hash, token.id);
    tokensBought.push(token.id);
  }

  // Update funded amount
  const newFunded = parseFloat((asset.funded_amount + totalCost).toFixed(4));
  stmts.updateAssetFunding.run(newFunded, newFunded >= (asset.token_price * asset.token_count) ? asset.raise_amount : 0, asset.id);

  // Sync balance
  const newBalance = blockchain.getBalance(walletData.address);
  stmts.updateBalance.run(newBalance, userId);

  stmts.logActivity.run(userId, 'TOKEN_PURCHASE', `Bought ${tokenCount} token(s) of "${asset.title}" for ${totalCost} AC`, investTx.hash, block?.index, totalCost);

  // Check if fully funded
  const fundingResult = checkAndProcessFunding(asset.id);

  res.json({
    success: true, tokensBought: tokenCount, totalCost, newBalance,
    txHash: investTx.hash, blockIndex: block?.index,
    funded: !!fundingResult, fundingResult
  });
});

// ── MARKETPLACE ──────────────────────────────────────────────────────────────

app.get('/api/market/orderbook', (req, res) => {
  const book = getOrderBook();
  const trades = stmts.getRecentTrades.all();
  res.json({ ...book, recentTrades: trades });
});

app.post('/api/market/sell', (req, res) => {
  const { userId, amount, pricePerCoin } = req.body;
  if (!userId || !amount || !pricePerCoin) return res.status(400).json({ error: 'Missing fields' });
  try {
    const result = placeSellOrder(userId, parseFloat(amount), parseFloat(pricePerCoin));
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/market/buy', (req, res) => {
  const { userId, amount, pricePerCoin } = req.body;
  if (!userId || !amount || !pricePerCoin) return res.status(400).json({ error: 'Missing fields' });
  try {
    const result = placeBuyOrder(userId, parseFloat(amount), parseFloat(pricePerCoin));
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/market/order/:id', (req, res) => {
  const { userId } = req.body;
  try {
    const result = cancelOrder(parseInt(req.params.id), userId);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── PORTFOLIO ────────────────────────────────────────────────────────────────

app.get('/api/portfolio/:userId', (req, res) => {
  const user = stmts.getUser.get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const walletData = stmts.getWallet.get(req.params.userId);
  const balance = walletData ? blockchain.getBalance(walletData.address) : 0;
  const tokens = stmts.getTokensByOwner.all(req.params.userId);
  const myAssets = stmts.getAssetsByOwner.all(req.params.userId);
  const myOrders = stmts.getUserOrders.all(req.params.userId);
  const activity = stmts.getActivityByUser.all(req.params.userId);
  const price = getPrice();

  res.json({
    balance, walletAddress: walletData?.address,
    coinValue: parseFloat((balance * price).toFixed(2)),
    tokens, myAssets, myOrders, activity, price
  });
});

// ── BLOCKCHAIN EXPLORER ──────────────────────────────────────────────────────

app.get('/api/blockchain/info', (req, res) => res.json(blockchain.getInfo()));

app.get('/api/blockchain/blocks', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const blocks = [...blockchain.chain].reverse().slice(0, limit).map(b => ({
    index: b.index, hash: b.hash, previousHash: b.previousHash,
    timestamp: b.timestamp, nonce: b.nonce,
    transactionCount: b.transactions.length,
    transactions: b.transactions.map(t => t.toJSON())
  }));
  res.json({ blocks, total: blockchain.chain.length });
});

app.get('/api/blockchain/block/:index', (req, res) => {
  const idx = parseInt(req.params.index);
  if (idx < 0 || idx >= blockchain.chain.length) return res.status(404).json({ error: 'Block not found' });
  const block = blockchain.chain[idx];
  res.json({ ...block.toJSON(), transactionCount: block.transactions.length });
});

app.get('/api/blockchain/validate', (req, res) => res.json(blockchain.isChainValid()));

// ── ECONOMY ──────────────────────────────────────────────────────────────────

app.get('/api/economy', (req, res) => {
  const stats = getDashboardStats();
  res.json(stats);
});

// ── PRICE FLUCTUATION & DEADLINE CHECKER ─────────────────────────────────────

setInterval(() => {
  const price = getPrice();
  const swing = (Math.random() - 0.5) * 0.005;
  const newPrice = parseFloat((price * (1 + swing)).toFixed(4));
  setPrice(newPrice);
}, 15000);

setInterval(() => {
  checkDeadlines();
}, 60000);

// ── START ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 4200;
app.listen(PORT, () => {
  const stats = getDashboardStats();
  console.log(`\n  Averon v3 running → http://localhost:${PORT}`);
  console.log(`  📊 ${stats.userCount} users | ${stats.assets.total} assets | ${stats.totalMinted.toFixed(0)} AC minted | ₹${stats.price.toFixed(4)}/AC\n`);
});
