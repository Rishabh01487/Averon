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