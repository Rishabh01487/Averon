// ══════════════════════════════════════════════════════════════════════════════
// AVERON v4 — Enterprise Frontend Application
// ══════════════════════════════════════════════════════════════════════════════

const API = '';
let state = { user: null, accessToken: null, refreshToken: null, currentPage: 'home', config: null, currentAssetId: null, selectedFiles: [], orderSide: 'buy', categories: [] };

// ── HELPERS ──────────────────────────────────────────────────────────────────

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (state.accessToken) headers['Authorization'] = `Bearer ${state.accessToken}`;
  delete opts.headers;

  try {
    const res = await fetch(API + path, { headers, ...opts });

    // Token refresh
    if (res.status === 401 && state.refreshToken) {
      const refreshed = await fetch(API + '/api/auth/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: state.refreshToken }),
      });
      if (refreshed.ok) {
        const tokens = await refreshed.json();
        state.accessToken = tokens.accessToken;
        state.refreshToken = tokens.refreshToken;
        saveSession();
        headers['Authorization'] = `Bearer ${state.accessToken}`;
        const retry = await fetch(API + path, { headers, ...opts });
        return retry.json();
      } else {
        logout();
        return null;
      }
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.details?.map(d => d.message).join(', ') || `HTTP ${res.status}`);
    return data;
  } catch (e) {
    if (e.message !== 'Failed to fetch') toast(e.message, 'error');
    throw e;
  }
}

function $(id) { return document.getElementById(id); }
function $$(sel) { return document.querySelectorAll(sel); }
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function formatNum(n) { return parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }

// ── SESSION ──────────────────────────────────────────────────────────────────

function saveSession() {
  localStorage.setItem('averon_session', JSON.stringify({
    user: state.user, accessToken: state.accessToken, refreshToken: state.refreshToken,
  }));
}

function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem('averon_session'));
    if (s?.accessToken) {
      state.user = s.user;
      state.accessToken = s.accessToken;
      state.refreshToken = s.refreshToken;
      return true;
    }
  } catch {}
  return false;
}

function logout() {
  state.user = null;
  state.accessToken = null;
  state.refreshToken = null;
  localStorage.removeItem('averon_session');
  $('authOverlay').classList.remove('hidden');
  $('mainApp').classList.add('hidden');
}

// ── AUTH ──────────────────────────────────────────────────────────────────────

function initAuth() {
  // Tab switching
  $$('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const isLogin = tab.dataset.tab === 'login';
      $('loginForm').classList.toggle('hidden', !isLogin);
      $('registerForm').classList.toggle('hidden', isLogin);
      $('authError').classList.add('hidden');
    });
  });

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('authError').classList.add('hidden');
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: $('loginEmail').value, password: $('loginPassword').value }),
      });
      state.user = data.user;
      state.accessToken = data.accessToken;
      state.refreshToken = data.refreshToken;
      saveSession();
      enterApp();
    } catch (e) {
      $('authError').textContent = e.message;
      $('authError').classList.remove('hidden');
    }
  });

  $('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('authError').classList.add('hidden');
    try {
      const data = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: $('regName').value, organization: $('regOrg').value,
          email: $('regEmail').value, password: $('regPassword').value,
        }),
      });
      state.user = data.user;
      state.accessToken = data.accessToken;
      state.refreshToken = data.refreshToken;
      saveSession();
      toast(`Welcome, ${data.user.name}! Wallet: ${data.user.walletAddress}`, 'success');
      enterApp();
    } catch (e) {
      $('authError').textContent = e.message;
      $('authError').classList.remove('hidden');
    }
  });
}

// ── ENTER APP ────────────────────────────────────────────────────────────────

async function enterApp() {
  $('authOverlay').classList.add('hidden');
  $('mainApp').classList.remove('hidden');
  $('userName').textContent = state.user?.name || '';

  // Load config
  try {
    state.config = await api('/api/config');
    state.categories = state.config.categories || [];
    $('livePrice').textContent = parseFloat(state.config.price).toFixed(2);
    populateCategories();
  } catch {}

  // Load initial page
  navigateTo('home');

  // Refresh account
  try {
    const acc = await api('/api/account');
    state.user = { ...state.user, ...acc };
    saveSession();
  } catch {}

  // Check notifications
  loadNotifications();

  // Start price polling
  setInterval(pollPrice, 10000);
}

function populateCategories() {
  const sel = $('assetCategory');
  const filter = $('assetFilterCategory');
  for (const cat of state.categories) {
    sel.innerHTML += `<option value="${cat}">${cat}</option>`;
    filter.innerHTML += `<option value="${cat}">${cat}</option>`;
  }
}

async function pollPrice() {
  try {
    const data = await api('/api/economy');
    $('livePrice').textContent = parseFloat(data.price).toFixed(2);
  } catch {}
}

async function loadNotifications() {
  try {
    const data = await api('/api/notifications');
    const badge = $('notifCount');
    if (data.unread > 0) { badge.textContent = data.unread; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  } catch {}
}

// ── NAVIGATION ───────────────────────────────────────────────────────────────

function initNav() {
  $$('.nav-link').forEach(link => {
    link.addEventListener('click', () => navigateTo(link.dataset.page));
  });
  $('logoutBtn').addEventListener('click', logout);
  $('notifBell').addEventListener('click', () => { navigateTo('portfolio'); api('/api/notifications/read', { method: 'POST' }); $('notifCount').classList.add('hidden'); });
}

function navigateTo(page) {
  state.currentPage = page;
  $$('.page').forEach(p => p.classList.remove('active'));
  $$('.nav-link').forEach(l => l.classList.remove('active'));
  const pageEl = $(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');
  const navEl = document.querySelector(`.nav-link[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');

  // Load page data
  const loaders = { home: loadDashboard, assets: loadAssets, buy: loadBuyPage, market: loadMarket, explorer: loadExplorer, portfolio: loadPortfolio };
  if (loaders[page]) loaders[page]();
}

// ── DASHBOARD ────────────────────────────────────────────────────────────────

async function loadDashboard() {
  try {
    const data = await api('/api/dashboard');
    $('statPrice').textContent = `₹${parseFloat(data.price).toFixed(2)}`;
    $('statSupply').textContent = formatNum(data.totalSupply || data.circulatingSupply);
    $('statAssets').textContent = data.assets?.total || 0;
    $('statFunded').textContent = data.assets?.funded || 0;
    $('statUsers').textContent = data.userCount || 0;
    $('statTrades').textContent = data.totalTrades || 0;
    $('statBlocks').textContent = data.blockchain?.blocks || 0;
    $('statTVL').textContent = `₹${formatNum(data.tvl)}`;

    // Price chart
    if (data.priceHistory?.length > 1) drawPriceChart(data.priceHistory);

    // Activity
    const feed = $('activityFeed');
    feed.innerHTML = (data.recentActivity || []).slice(0, 15).map(a => `
      <div class="activity-item">
        <span class="activity-action">${a.action}</span>
        <span class="activity-details">${a.details || ''}</span>
        <span class="activity-time">${timeAgo(a.created_at)}</span>
      </div>`).join('') || '<div class="empty-state">No activity yet</div>';
  } catch {}
}

function drawPriceChart(prices) {
  const canvas = $('priceChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const min = Math.min(...prices) * 0.98;
  const max = Math.max(...prices) * 1.02;
  const range = max - min || 1;

  ctx.beginPath();
  ctx.strokeStyle = '#6366f1';
  ctx.lineWidth = 2;
  for (let i = 0; i < prices.length; i++) {
    const x = (i / (prices.length - 1)) * w;
    const y = h - ((prices[i] - min) / range) * h;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Gradient fill
  const lastY = h - ((prices[prices.length - 1] - min) / range) * h;
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(99, 102, 241, 0.3)');
  grad.addColorStop(1, 'rgba(99, 102, 241, 0)');
  ctx.fillStyle = grad;
  ctx.fill();
}

// ── ASSETS ───────────────────────────────────────────────────────────────────

async function loadAssets() {
  try {
    const params = new URLSearchParams();
    const cat = $('assetFilterCategory')?.value;
    const status = $('assetFilterStatus')?.value;
    if (cat && cat !== 'all') params.set('category', cat);
    if (status && status !== 'all') params.set('status', status);

    const assets = await api(`/api/assets?${params}`);
    const grid = $('assetGrid');
    grid.innerHTML = assets.map(a => `
      <div class="asset-card" onclick="viewAsset(${a.id})">
        <div class="asset-card-header">
          <div class="asset-title">${a.title}</div>
          <span class="asset-status status-${a.status}">${a.status.replace(/_/g, ' ')}</span>
        </div>
        <div class="asset-category">${a.category}</div>
        <div class="asset-meta">
          <div><span class="label">Raise:</span> <span class="val">₹${formatNum(a.raise_amount)}</span></div>
          <div><span class="label">Tokens:</span> <span class="val">${a.tokens_sold || 0}/${a.token_count || 0}</span></div>
        </div>
        ${a.token_count ? `<div class="progress-bar"><div class="progress-fill" style="width:${a.progress}%"></div></div>` : ''}
      </div>`).join('') || '<div class="empty-state">No assets listed yet. <span class="link" onclick="navigateTo(\'tokenize\')">Tokenize your first asset →</span></div>';
  } catch {}
}

async function viewAsset(id) {
  try {
    const a = await api(`/api/assets/${id}`);
    // Show in a modal-like explorer result on the assets page
    const grid = $('assetGrid');
    grid.innerHTML = `
      <div style="grid-column: 1/-1">
        <button class="btn-ghost" onclick="loadAssets()">← Back to Assets</button>
        <div class="asset-card" style="margin-top:12px;cursor:default">
          <div class="asset-card-header">
            <div class="asset-title" style="font-size:20px">${a.title}</div>
            <span class="asset-status status-${a.status}">${a.status.replace(/_/g,' ')}</span>
          </div>
          <div class="asset-category">${a.category} · Listed by ${a.owner_name}</div>
          <p style="margin:12px 0;color:var(--text-secondary);font-size:14px">${a.description || 'No description'}</p>
          <div class="ai-stat-grid">
            <div class="ai-stat"><div class="val">₹${formatNum(a.raise_amount)}</div><div class="label">Raise Amount</div></div>
            <div class="ai-stat"><div class="val">${a.token_count || 0}</div><div class="label">Total Tokens</div></div>
            <div class="ai-stat"><div class="val">${a.progress || 0}%</div><div class="label">Funded</div></div>
          </div>
          ${a.ai_analysis_summary ? `
          <div style="margin-top:16px;padding:16px;background:var(--bg-input);border-radius:var(--radius-sm)">
            <strong>AI Analysis:</strong> ${a.ai_analysis_summary}<br>
            <strong>Risk:</strong> ${a.ai_risk_level} (${a.ai_risk_score}%) · <strong>Confidence:</strong> ${a.ai_confidence}%
          </div>` : ''}
          ${a.status === 'active' || a.status === 'funding' ? `
          <div style="margin-top:16px;display:flex;gap:12px;align-items:center">
            <input type="number" id="buyTokenCount" value="1" min="1" max="${a.tokens_available}" style="width:80px;padding:8px;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;color:white">
            <button class="btn-primary" onclick="buyAssetTokens(${a.id})">Buy Tokens (${a.token_price?.toFixed(4) || 0} AC each)</button>
            <span style="color:var(--text-muted);font-size:13px">${a.tokens_available} available</span>
          </div>` : ''}
          ${a.escrow ? `<div style="margin-top:12px;font-size:12px;color:var(--text-muted)">Escrow: ${a.escrow.address} · Balance: ${a.escrow.balance} AC</div>` : ''}
          ${a.tx_hash ? `<div style="margin-top:8px;font-size:12px;color:var(--text-muted);font-family:var(--mono)">TX: ${a.tx_hash.substring(0,24)}... · Block #${a.block_index}</div>` : ''}
        </div>
      </div>`;
  } catch {}
}

async function buyAssetTokens(assetId) {
  const count = parseInt($('buyTokenCount')?.value) || 1;
  try {
    const result = await api(`/api/assets/${assetId}/tokens/buy`, { method: 'POST', body: JSON.stringify({ count }) });
    toast(`✅ Bought ${result.tokensBought} tokens for ${result.totalCost.toFixed(4)} AC`, 'success');
    viewAsset(assetId);
    loadNotifications();
  } catch {}
}

// ── BUY COIN ─────────────────────────────────────────────────────────────────

async function loadBuyPage() {
  try {
    const acc = await api('/api/account');
    const price = parseFloat(acc.balance !== undefined ? state.config?.price : 1);
    $('buyPrice').textContent = `₹${price.toFixed(2)}`;
    $('buyBalance').textContent = `${parseFloat(acc.balance).toFixed(4)} AC`;
  } catch {}
}

function initBuyPage() {
  $('buyAmountInr')?.addEventListener('input', () => {
    const inr = parseFloat($('buyAmountInr').value) || 0;
    const price = parseFloat(state.config?.price) || 1;
    $('buyEstimate').textContent = `${(inr / price).toFixed(4)} AC`;
  });

  $('buyCoinsBtn')?.addEventListener('click', async () => {
    const amountInr = parseFloat($('buyAmountInr').value);
    if (!amountInr || amountInr < 10) return toast('Minimum ₹10', 'error');

    $('buyCoinsBtn').disabled = true;
    try {
      const result = await api('/api/buy-coins', { method: 'POST', body: JSON.stringify({ amountInr }) });
      $('buyResult').innerHTML = `✅ Minted <strong>${result.coins.toFixed(4)} AC</strong> for ₹${amountInr}<br>Balance: ${result.newBalance.toFixed(4)} AC · New Price: ₹${result.newPrice.toFixed(4)}<br><span style="font-family:var(--mono);font-size:11px">TX: ${result.txHash.substring(0,24)}... · Block #${result.blockIndex}</span>`;
      $('buyResult').className = 'result-box success';
      $('buyResult').classList.remove('hidden');
      $('buyBalance').textContent = `${result.newBalance.toFixed(4)} AC`;
      $('livePrice').textContent = result.newPrice.toFixed(2);
      toast(`Minted ${result.coins.toFixed(4)} AC`, 'success');
    } catch {} finally { $('buyCoinsBtn').disabled = false; }
  });
}

// ── TOKENIZE WIZARD ──────────────────────────────────────────────────────────

function initWizard() {
  // Drop zone
  const dropZone = $('dropZone');
  const fileInput = $('fileInput');
  if (!dropZone || !fileInput) return;

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });
  fileInput.addEventListener('change', e => handleFiles(e.target.files));

  $('createAssetBtn')?.addEventListener('click', createAsset);
  $('uploadDocsBtn')?.addEventListener('click', uploadDocuments);
  $('startAnalysisBtn')?.addEventListener('click', startAIAnalysis);
  $('confirmLaunchBtn')?.addEventListener('click', confirmLaunch);
}

function handleFiles(files) {
  for (const f of files) {
    if (state.selectedFiles.length >= 10) break;
    state.selectedFiles.push(f);
  }
  renderFileList();
}

function renderFileList() {
  $('fileList').innerHTML = state.selectedFiles.map((f, i) => `
    <div class="file-item">
      <span>${f.name} (${(f.size / 1024).toFixed(0)} KB)</span>
      <span class="file-remove" onclick="removeFile(${i})">✕</span>
    </div>`).join('');
  $('uploadDocsBtn').disabled = state.selectedFiles.length === 0;
}
window.removeFile = (i) => { state.selectedFiles.splice(i, 1); renderFileList(); };

function setWizardStep(step) {
  $$('.wizard-step').forEach((s, i) => {
    s.classList.remove('active', 'done');
    if (i + 1 < step) s.classList.add('done');
    if (i + 1 === step) s.classList.add('active');
  });
  $$('.wiz-panel').forEach(p => p.classList.remove('active'));
  $(`wizStep${step}`)?.classList.add('active');
}

async function createAsset() {
  const title = $('assetTitle').value;
  const category = $('assetCategory').value;
  const description = $('assetDescription').value;
  const raiseAmount = parseFloat($('assetRaise').value);
  const days = parseInt($('assetDays').value) || 30;

  if (!title || !category || !description || !raiseAmount) return toast('Fill all fields', 'error');
  if (description.length < 20) return toast('Description too short (min 20 chars)', 'error');

  try {
    const result = await api('/api/assets/create', { method: 'POST', body: JSON.stringify({ title, category, description, raiseAmount, days }) });
    state.currentAssetId = result.assetId;
    toast(`Asset created (#${result.assetId})`, 'success');
    setWizardStep(2);
  } catch {}
}

async function uploadDocuments() {
  if (!state.currentAssetId || state.selectedFiles.length === 0) return;

  const formData = new FormData();
  for (const file of state.selectedFiles) formData.append('documents', file);

  $('uploadDocsBtn').disabled = true;
  try {
    const res = await fetch(`/api/assets/${state.currentAssetId}/documents`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${state.accessToken}` }, body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    toast(`${data.uploaded} document(s) uploaded`, 'success');
    state.selectedFiles = [];
    renderFileList();
    setWizardStep(3);
  } catch (e) { toast(e.message, 'error'); } finally { $('uploadDocsBtn').disabled = false; }
}

async function startAIAnalysis() {
  if (!state.currentAssetId) return;
  $('aiProgress').classList.remove('hidden');
  $('aiResult').classList.add('hidden');
  $('startAnalysisBtn').disabled = true;

  try {
    const result = await api(`/api/assets/${state.currentAssetId}/analyze`, { method: 'POST' });
    $('aiProgress').classList.add('hidden');
    $('aiResult').classList.remove('hidden');
    $('aiResult').className = `ai-result ${result.verified ? 'verified' : 'rejected'}`;
    $('aiResult').innerHTML = `
      <h3>${result.verified ? '✅ Asset Verified' : '❌ Asset Rejected'}</h3>
      <div class="ai-stat-grid">
        <div class="ai-stat"><div class="val">₹${formatNum(result.estimatedValue)}</div><div class="label">Estimated Value</div></div>
        <div class="ai-stat"><div class="val">${result.riskScore}%</div><div class="label">Risk Score (${result.riskLevel})</div></div>
        <div class="ai-stat"><div class="val">${result.confidence}%</div><div class="label">Confidence</div></div>
      </div>
      <p style="margin-top:12px;font-size:13px;color:var(--text-secondary)">${result.analysis}</p>
      ${result.concerns ? `<p style="margin-top:8px;font-size:12px;color:var(--yellow)">⚠️ ${result.concerns}</p>` : ''}
      <p style="margin-top:8px;font-size:11px;color:var(--text-muted)">Source: ${result.source} · ${result.duration}ms · ${(result.stages||[]).length} stages</p>
      ${result.verified ? `<button class="btn-primary" style="margin-top:16px" onclick="goToLaunch(${JSON.stringify(result).replace(/"/g, '&quot;')})">Proceed to Launch →</button>` : '<p style="margin-top:12px;color:var(--red)">Please improve documentation and re-submit.</p>'}`;
  } catch (e) { $('aiProgress').classList.add('hidden'); toast(e.message, 'error'); } finally { $('startAnalysisBtn').disabled = false; }
}

window.goToLaunch = (aiResult) => {
  state.aiResult = aiResult;
  $('launchSummary').innerHTML = `
    <div class="ai-stat-grid">
      <div class="ai-stat"><div class="val">${aiResult.suggestedTokens}</div><div class="label">Tokens</div></div>
      <div class="ai-stat"><div class="val">₹${formatNum(aiResult.tokenPriceInr)}</div><div class="label">Per Token (INR)</div></div>
      <div class="ai-stat"><div class="val">${aiResult.riskLevel}</div><div class="label">Risk Level</div></div>
    </div>
    <p style="margin-top:16px;color:var(--text-secondary);font-size:14px">Confirming will create tokens on the Averon blockchain and open the asset for investment.</p>`;
  setWizardStep(4);
};

async function confirmLaunch() {
  if (!state.currentAssetId) return;
  $('confirmLaunchBtn').disabled = true;
  try {
    const result = await api(`/api/assets/${state.currentAssetId}/confirm`, { method: 'POST', body: JSON.stringify({ aiResult: state.aiResult || {} }) });
    $('launchResult').classList.remove('hidden');
    $('launchResult').innerHTML = `
      <h3>🚀 Asset Live on Blockchain!</h3>
      <p>${result.tokenCount} tokens created at ${result.tokenPriceAC?.toFixed(4)} AC each</p>
      <p style="font-family:var(--mono);font-size:12px;margin-top:8px">TX: ${result.txHash?.substring(0,32)}... · Block #${result.blockIndex}</p>
      <button class="btn-primary" style="margin-top:16px" onclick="viewAsset(${state.currentAssetId}); navigateTo('assets')">View Asset →</button>`;
    toast('Asset launched successfully!', 'success');
  } catch {} finally { $('confirmLaunchBtn').disabled = false; }
}

// ── MARKETPLACE ──────────────────────────────────────────────────────────────

async function loadMarket() {
  try {
    const data = await api('/api/market/orderbook');
    $('sellOrders').innerHTML = (data.sells || []).map(o => `<div class="ob-row"><span>${o.price.toFixed(4)}</span><span>${o.amount.toFixed(4)}</span><span>${o.total.toFixed(2)}</span></div>`).join('') || '<div class="empty-state" style="padding:16px">No sell orders</div>';
    $('buyOrders').innerHTML = (data.buys || []).map(o => `<div class="ob-row"><span>${o.price.toFixed(4)}</span><span>${o.amount.toFixed(4)}</span><span>${o.total.toFixed(2)}</span></div>`).join('') || '<div class="empty-state" style="padding:16px">No buy orders</div>';
    $('obSpread').textContent = data.spread !== null ? `Spread: ₹${data.spread.toFixed(4)}` : 'Spread: —';
    $('recentTrades').innerHTML = (data.recentTrades || []).map(t => `<div class="trade-item"><span class="trade-amount">${t.amount.toFixed(4)} AC</span><span>₹${t.price.toFixed(4)}</span><span>${timeAgo(t.created_at)}</span></div>`).join('') || '<div class="empty-state" style="padding:16px">No trades yet</div>';

    // Set default price
    if (!$('orderPrice').value) $('orderPrice').value = parseFloat(state.config?.price || 1).toFixed(4);
  } catch {}
}

function initMarket() {
  $$('.order-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.order-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.orderSide = tab.dataset.side;
    });
  });

  const updateTotal = () => {
    const amt = parseFloat($('orderAmount')?.value) || 0;
    const price = parseFloat($('orderPrice')?.value) || 0;
    $('orderTotal').textContent = (amt * price).toFixed(2);
  };
  $('orderAmount')?.addEventListener('input', updateTotal);
  $('orderPrice')?.addEventListener('input', updateTotal);

  $('placeOrderBtn')?.addEventListener('click', async () => {
    const amount = parseFloat($('orderAmount').value);
    const price = parseFloat($('orderPrice').value);
    if (!amount || !price) return toast('Fill amount and price', 'error');

    try {
      await api('/api/market/order', { method: 'POST', body: JSON.stringify({ side: state.orderSide, type: 'limit', amount, price }) });
      toast(`${state.orderSide.toUpperCase()} order placed`, 'success');
      loadMarket();
    } catch {}
  });
}

// ── EXPLORER ─────────────────────────────────────────────────────────────────

async function loadExplorer() {
  try {
    const info = await api('/api/blockchain/info');
    $('chainStats').innerHTML = `
      <span class="chain-stat">Blocks: ${info.blocks}</span>
      <span class="chain-stat">TXs: ${info.transactions}</span>
      <span class="chain-stat">Difficulty: ${info.difficulty}</span>
      <span class="chain-stat">Pending: ${info.pendingTransactions}</span>`;

    const data = await api('/api/blockchain/blocks?limit=20');
    $('blockList').innerHTML = (data.blocks || []).map(b => `
      <div class="block-card" onclick="viewBlock(${b.index})">
        <span class="block-index">#${b.index}</span>
        <span class="block-hash">${b.hash.substring(0, 20)}...</span>
        <div class="block-meta">
          <span class="block-tx-count">${b.transactionCount} txs</span>
          <span>Nonce: ${b.nonce}</span>
          <span>${timeAgo(b.timestamp)}</span>
        </div>
      </div>`).join('');
  } catch {}
}

window.viewBlock = async (index) => {
  try {
    const block = await api(`/api/blockchain/block/${index}`);
    $('explorerResult').classList.remove('hidden');
    $('explorerResult').innerHTML = `
      <h3>Block #${block.index}</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0;font-size:13px">
        <div><strong>Hash:</strong> <span style="font-family:var(--mono);font-size:11px">${block.hash}</span></div>
        <div><strong>Previous:</strong> <span style="font-family:var(--mono);font-size:11px">${block.previousHash}</span></div>
        <div><strong>Merkle Root:</strong> <span style="font-family:var(--mono);font-size:11px">${block.merkleRoot}</span></div>
        <div><strong>Nonce:</strong> ${block.nonce} · <strong>Difficulty:</strong> ${block.difficulty}</div>
        <div><strong>Miner:</strong> <span style="font-family:var(--mono);font-size:11px">${block.miner}</span></div>
        <div><strong>Time:</strong> ${new Date(block.timestamp).toLocaleString()}</div>
      </div>
      <h4 style="margin-bottom:8px">${block.transactionCount} Transactions</h4>
      ${(block.transactions || []).map(tx => `
        <div style="padding:8px 12px;background:var(--bg-input);border-radius:6px;margin-bottom:6px;font-size:12px">
          <div style="display:flex;justify-content:space-between">
            <span style="font-weight:600;color:var(--accent)">${tx.type}</span>
            <span style="font-family:var(--mono)">${tx.amount.toFixed(4)} AC</span>
          </div>
          <div style="color:var(--text-muted);margin-top:4px;font-family:var(--mono);font-size:10px">
            ${tx.from?.substring(0,16)}... → ${tx.to?.substring(0,16)}... · ${tx.hash?.substring(0,16)}...
          </div>
        </div>`).join('')}`;
  } catch {}
};

function initExplorer() {
  $('explorerSearchBtn')?.addEventListener('click', async () => {
    const q = $('explorerSearch').value.trim();
    if (!q) return;

    // Try as block index
    if (/^\d+$/.test(q)) { viewBlock(parseInt(q)); return; }

    // Try as tx hash
    try {
      const tx = await api(`/api/blockchain/tx/${q}`);
      $('explorerResult').classList.remove('hidden');
      $('explorerResult').innerHTML = `
        <h3>Transaction</h3>
        <div style="font-size:13px;display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px">
          <div><strong>Type:</strong> ${tx.type}</div>
          <div><strong>Amount:</strong> ${tx.amount} AC</div>
          <div><strong>From:</strong> <span style="font-family:var(--mono);font-size:11px">${tx.from}</span></div>
          <div><strong>To:</strong> <span style="font-family:var(--mono);font-size:11px">${tx.to}</span></div>
          <div><strong>Status:</strong> ${tx.status}</div>
          <div><strong>Block:</strong> #${tx.blockIndex}</div>
          <div><strong>Confirmations:</strong> ${tx.confirmations}</div>
          <div><strong>Hash:</strong> <span style="font-family:var(--mono);font-size:11px">${tx.hash}</span></div>
        </div>`;
    } catch {
      // Try as address
      try {
        const addr = await api(`/api/blockchain/address/${q}`);
        $('explorerResult').classList.remove('hidden');
        $('explorerResult').innerHTML = `
          <h3>Address</h3>
          <p style="font-family:var(--mono);font-size:13px;margin:8px 0">${addr.address}</p>
          <p style="font-size:18px;font-weight:700">Balance: ${addr.balance.toFixed(4)} AC</p>
          <h4 style="margin-top:16px">${addr.transactions.length} Transactions</h4>
          ${addr.transactions.slice(0, 20).map(tx => `<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;display:flex;justify-content:space-between"><span style="color:${tx.direction === 'in' ? 'var(--green)' : 'var(--red)'}">${tx.direction === 'in' ? '+' : '-'}${tx.amount.toFixed(4)} AC</span><span style="color:var(--text-muted)">${tx.type}</span></div>`).join('')}`;
      } catch { toast('Not found', 'error'); }
    }
  });
}

// ── PORTFOLIO ────────────────────────────────────────────────────────────────

async function loadPortfolio() {
  try {
    const data = await api('/api/portfolio');
    $('portfolioValue').textContent = `₹${formatNum(data.coinValue)}`;
    $('portfolioWallet').textContent = data.walletAddress || '—';