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