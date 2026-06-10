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