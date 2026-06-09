const API = window.location.origin;
let ws = null;

function api(path, options = {}) {
  const token = localStorage.getItem('admin_token') || sessionStorage.getItem('token');
  return fetch(API + path, {
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...options.headers },
    ...options,
  }).then(r => r.json()).catch(e => ({ error: e.message }));
}

function showModal(html) {
  const overlay = document.getElementById('modalOverlay');
  overlay.innerHTML = `<div class="modal">${html}</div>`;
  overlay.classList.remove('hidden');
  overlay.onclick = (e) => { if (e.target === overlay) overlay.classList.add('hidden'); };
}

function hideModal() { document.getElementById('modalOverlay').classList.add('hidden'); }

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.style.cssText = `position:fixed;bottom:20px;right:20px;padding:12px 20px;border-radius:8px;font-size:0.85rem;z-index:2000;background:#1a1a1a;border:1px solid #2a2a2a;color:#f0f0f0;max-width:400px;box-shadow:0 4px 20px rgba(0,0,0,0.5);`;
  toast.innerHTML = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function getToken() { return localStorage.getItem('admin_token') || sessionStorage.getItem('token'); }

async function checkAuth() {
  const token = getToken();
  if (!token) {
    const overlay = document.getElementById('modalOverlay');
    overlay.innerHTML = `<div class="modal" style="max-width:350px">
      <h3>Admin Login</h3>
      <div id="loginError" class="alert alert-danger hidden"></div>
      <div class="form-group"><label>Email</label><input type="email" id="loginEmail" placeholder="admin@averon.io"></div>
      <div class="form-group"><label>Password</label><input type="password" id="loginPassword" placeholder="••••••••"></div>
      <div class="modal-actions"><button class="btn btn-green" onclick="doLogin()">Login</button></div>
    </div>`;
    overlay.classList.remove('hidden');
    overlay.onclick = (e) => { if (e.target === overlay) overlay.classList.add('hidden'); };
    return false;
  }
  const me = await api('/api/account');
  if (me.role !== 'admin') {
    document.getElementById('sectionContent').innerHTML = `<div class="alert alert-danger">Access denied — admin role required</div>`;
    return false;
  }
  return true;
}

async function doLogin() {
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (result.error) {
    const err = document.getElementById('loginError');
    err.textContent = result.error; err.classList.remove('hidden');
    return;
  }
  if (result.user.role !== 'admin') {
    const err = document.getElementById('loginError');
    err.textContent = 'Access denied — not an admin account'; err.classList.remove('hidden');
    return;
  }
  localStorage.setItem('admin_token', result.accessToken);
  sessionStorage.setItem('token', result.accessToken);
  hideModal();
  document.querySelector('[data-section="overview"]').click();
}

function initWS() {
  if (ws) return;
  try { ws = new AveronWS(); } catch { return; }
  ws.on('connected', () => {
    ws.subscribe('price'); ws.subscribe('blocks'); ws.subscribe('assets'); ws.subscribe('trades');
  });
  ws.on('block_mined', () => { if (activeSection === 'overview') renderOverview(); });
  ws.on('price_updated', () => { if (['overview', 'finance'].includes(activeSection)) renderActive(); });
}

let activeSection = 'overview';

function switchSection(section) {
  activeSection = section;
  document.querySelectorAll('.admin-sidebar nav a').forEach(a => a.classList.toggle('active', a.dataset.section === section));
  const titles = {
    overview: ['System Overview', 'Real-time platform monitoring'],
    users: ['User Management', 'View all users, balances, and KYC status'],
    assets: ['Asset Review', 'Pending assets, AI analysis review, approve/reject'],
    transactions: ['Transaction Monitor', 'Live transaction feed, flag suspicious'],
    chain: ['Chain Health', 'Block explorer, validation status, pending tx pool'],
    finance: ['Financial Reports', 'Revenue, volume, TVL, AUM'],
    config: ['System Configuration', 'Fee rates, listing limits, difficulty, rate limits'],
    audit: ['Audit Log', 'Tamper-proof action log'],
  };
  document.getElementById('pageTitle').textContent = titles[section][0];
  document.getElementById('pageSubtitle').textContent = titles[section][1];
  renderActive();
}

function renderActive() {
  const renderers = { overview: renderOverview, users: renderUsers, assets: renderAssets, transactions: renderTransactions, chain: renderChain, finance: renderFinance, config: renderConfig, audit: renderAudit };
  if (renderers[activeSection]) renderers[activeSection]();
}

async function renderOverview() {
  const data = await api('/api/admin/stats');
  const config = await api('/api/config');
  if (data.error) { document.getElementById('sectionContent').innerHTML = `<div class="alert alert-danger">${data.error}</div>`; return; }

  const s = data.stats || {};
  const ci = data.chainInfo || {};

  document.getElementById('sectionContent').innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="label">Users</div><div class="value green">${s.userCount || 0}</div></div>
      <div class="stat-card"><div class="label">Total Assets</div><div class="value blue">${s.assets?.total || 0}</div></div>
      <div class="stat-card"><div class="label">Active Assets</div><div class="value purple">${s.assets?.active || 0}</div></div>
      <div class="stat-card"><div class="label">Funded Assets</div><div class="value green">${s.assets?.funded || 0}</div></div>
      <div class="stat-card"><div class="label">Price (AC)</div><div class="value yellow">₹${(s.price || 0).toFixed(4)}</div></div>
      <div class="stat-card"><div class="label">Market Cap</div><div class="value blue">₹${(s.marketCap || 0).toFixed(2)}</div></div>
      <div class="stat-card"><div class="label">Total Supply</div><div class="value green">${(s.totalSupply || 0).toFixed(0)} AC</div></div>
      <div class="stat-card"><div class="label">Total Volume</div><div class="value purple">${(s.totalVolume || 0).toFixed(2)} AC</div></div>
      <div class="stat-card"><div class="label">Total Trades</div><div class="value yellow">${s.totalTrades || 0}</div></div>
      <div class="stat-card"><div class="label">Total Raised</div><div class="value green">₹${(s.totalRaisedInr || 0).toFixed(2)}</div></div>
      <div class="stat-card"><div class="label">Fees Collected</div><div class="value green">₹${(s.totalFeesCollected || 0).toFixed(2)}</div></div>
      <div class="stat-card"><div class="label">Holders</div><div class="value blue">${s.holders || 0}</div></div>
    </div>
    <div class="section">
      <div class="section-header"><h3>Blockchain</h3><span class="badge">Chain Integrity: ${data.auditIntegrity?.valid ? '✓ Valid' : '✗ Compromised'}</span></div>
      <div class="section-body">
        <div class="stats-grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
          <div class="stat-card"><div class="label">Blocks</div><div class="value green">${ci.chainLength || 0}</div></div>
          <div class="stat-card"><div class="label">Difficulty</div><div class="value yellow">${ci.difficulty || 0}</div></div>
          <div class="stat-card"><div class="label">Pending TX</div><div class="value ${(ci.pendingTransactions || 0) > 0 ? 'red' : 'green'}">${ci.pendingTransactions || 0}</div></div>
        </div>
      </div>
    </div>
    <div class="section">
      <div class="section-header"><h3>Pending Review</h3><span class="badge">${data.pendingAssets?.length || 0} assets</span></div>
      <div class="section-body">
        ${data.pendingAssets?.length ? `<table><tr><th>ID</th><th>Title</th><th>Category</th><th>Raise</th><th>Status</th></tr>${data.pendingAssets.map(a => `<tr><td>#${a.id}</td><td>${a.title}</td><td>${a.category}</td><td>₹${(a.raise_amount || 0).toFixed(2)}</td><td><span class="status pending">${a.status}</span></td></tr>`).join('')}</table>` : '<div style="color:var(--text-secondary)">No assets pending review</div>'}
      </div>
    </div>
    <div class="section">
      <div class="section-header"><h3>Frozen Users</h3><span class="badge">${data.frozenUsers?.length || 0}</span></div>
      <div class="section-body">
        ${data.frozenUsers?.length ? `<table><tr><th>ID</th><th>Name</th><th>Email</th><th>Action</th></tr>${data.frozenUsers.map(u => `<tr><td>${u.id}</td><td>${u.name}</td><td>${u.email}</td><td><button class="btn btn-sm btn-green" onclick="unfreezeUser('${u.id}')">Unfreeze</button></td></tr>`).join('')}</table>` : '<div style="color:var(--text-secondary)">No frozen users</div>'}
      </div>
    </div>`;
}

async function renderUsers() {
  const data = await api('/api/admin/stats');
  const users = await api('/api/account');
  const allUsers = await api('/api/admin/stats');
  
  document.getElementById('sectionContent').innerHTML = `
    <div class="section">
      <div class="section-header"><h3>All Users</h3><span class="badge">${data.stats?.userCount || 0} total</span></div>
      <div class="section-body">
        <div id="usersList">Loading...</div>
      </div>
    </div>`;

  const logs = await api('/api/blockchain/info');
  const activityData = await fetch(API + '/api/dashboard').then(r => r.json()).catch(() => ({}));
  const usersHtml = `<table><tr><th>ID</th><th>Name</th><th>Email</th><th>Role</th><th>Wallet</th><th>Status</th><th>Actions</th></tr>
    ${(activityData.recentActivity || []).filter(a => a.user_name).slice(0, 20).map(a => `<tr><td>${a.user_id || '—'}</td><td>${a.user_name || '—'}</td><td>—</td><td>—</td><td>—</td><td><span class="status info">Active</span></td><td><button class="btn btn-sm btn-outline" onclick="showToast('User management details')">View</button></td></tr>`).join('')}
  </table>`;
  document.getElementById('usersList').innerHTML = usersHtml;
}

async function renderAssets() {
  const data = await api('/api/assets?limit=100');
  const assets = Array.isArray(data) ? data : [];

  document.getElementById('sectionContent').innerHTML = `
    <div class="section">
      <div class="section-header"><h3>All Assets</h3><span class="badge">${assets.length}</span></div>
      <div class="section-body">
        ${assets.length ? `<table><tr><th>ID</th><th>Title</th><th>Category</th><th>Raise</th><th>Status</th><th>Progress</th><th>Actions</th></tr>${assets.map(a => `<tr>
          <td>#${a.id}</td><td>${a.title}</td><td>${a.category}</td>
          <td>₹${(a.raise_amount || 0).toFixed(2)}</td>
          <td><span class="status ${['active','funding'].includes(a.status) ? 'active' : 'pending'}">${a.status}</span></td>
          <td>${a.progress || 0}%</td>
          <td><button class="btn btn-sm btn-outline" onclick="showToast('Asset #${a.id}: ${a.title}')">View</button></td>
        </tr>`).join('')}</table>` : '<div style="color:var(--text-secondary)">No assets found</div>'}
      </div>
    </div>`;
}

async function renderTransactions() {
  const data = await api('/api/blockchain/info');
  const blocks = await api('/api/blockchain/blocks?limit=10');

  document.getElementById('sectionContent').innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="label">Pending TX</div><div class="value ${data.pendingTransactions > 0 ? 'yellow' : 'green'}">${data.pendingTransactions}</div></div>
      <div class="stat-card"><div class="label">Total Blocks</div><div class="value blue">${data.chainLength}</div></div>
    </div>
    <div class="section">
      <div class="section-header"><h3>Recent Blocks</h3></div>
      <div class="section-body">
        ${blocks.blocks?.length ? `<table><tr><th>Index</th><th>Hash</th><th>Miner</th><th>TX Count</th><th>Size</th><th>Time</th></tr>${blocks.blocks.map(b => `<tr>
          <td>#${b.index}</td>
          <td style="font-family:monospace;font-size:0.75rem;color:var(--accent-blue)">${b.hash?.substring(0, 20)}...</td>
          <td style="font-family:monospace;font-size:0.75rem">${b.miner?.substring(0, 16) || '—'}...</td>
          <td>${b.transactionCount || b.transactions?.length || 0}</td>
          <td>${b.size || 0} B</td>
          <td>${new Date(b.timestamp).toLocaleTimeString()}</td>
        </tr>`).join('')}</table>` : '<div style="color:var(--text-secondary)">No blocks</div>'}
      </div>
    </div>`;
}

async function renderChain() {
  const info = await api('/api/blockchain/info');
  const validate = await api('/api/blockchain/validate');
  const blocks = await api('/api/blockchain/blocks?limit=20');

  document.getElementById('sectionContent').innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="label">Chain Valid</div><div class="value ${validate.valid !== false ? 'green' : 'red'}">${validate.valid !== false ? '✓ Yes' : '✗ No'}</div></div>
      <div class="stat-card"><div class="label">Blocks</div><div class="value blue">${info.chainLength || 0}</div></div>
      <div class="stat-card"><div class="label">Difficulty</div><div class="value yellow">${info.difficulty || 0}</div></div>
      <div class="stat-card"><div class="label">Mining Reward</div><div class="value green">${info.miningReward || 0} AC</div></div>
      <div class="stat-card"><div class="label">Pending TX</div><div class="value ${(info.pendingTransactions || 0) > 0 ? 'yellow' : 'green'}">${info.pendingTransactions || 0}</div></div>
    </div>
    <div class="section">
      <div class="section-header"><h3>Block Explorer</h3></div>
      <div class="section-body">
        ${blocks.blocks?.length ? `<table><tr><th>#</th><th>Hash</th><th>Previous Hash</th><th>Merkle Root</th><th>Nonce</th><th>TX</th></tr>${blocks.blocks.map(b => `<tr>
          <td>${b.index}</td>
          <td style="font-family:monospace;font-size:0.7rem;max-width:120px;overflow:hidden;text-overflow:ellipsis;color:var(--accent-blue)">${b.hash?.substring(0, 16)}...</td>
          <td style="font-family:monospace;font-size:0.7rem;max-width:120px;overflow:hidden;text-overflow:ellipsis">${b.previousHash?.substring(0, 16)}...</td>
          <td style="font-family:monospace;font-size:0.7rem;max-width:120px;overflow:hidden;text-overflow:ellipsis;color:var(--accent-green)">${b.merkleRoot?.substring(0, 16)}...</td>
          <td>${b.nonce}</td>
          <td>${b.transactionCount || b.transactions?.length || 0}</td>
        </tr>`).join('')}</table>` : '<div style="color:var(--text-secondary)">No blocks</div>'}
      </div>
    </div>`;
}

async function renderFinance() {
  const stats = await api('/api/admin/stats');
  const s = stats.stats || {};

  document.getElementById('sectionContent').innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="label">Total Fees</div><div class="value green">₹${(s.totalFeesCollected || 0).toFixed(2)}</div></div>
      <div class="stat-card"><div class="label">Total Volume</div><div class="value blue">${(s.totalVolume || 0).toFixed(2)} AC</div></div>
      <div class="stat-card"><div class="label">Total Raised</div><div class="value purple">₹${(s.totalRaisedInr || 0).toFixed(2)}</div></div>
      <div class="stat-card"><div class="label">TVL</div><div class="value yellow">₹${(s.tvl || 0).toFixed(2)}</div></div>
      <div class="stat-card"><div class="label">Market Cap</div><div class="value blue">₹${(s.marketCap || 0).toFixed(2)}</div></div>
      <div class="stat-card"><div class="label">Trades</div><div class="value green">${s.totalTrades || 0}</div></div>
    </div>
    <div class="section">
      <div class="section-header"><h3>Price History</h3></div>
      <div class="section-body">
        <div id="priceChart" style="height:200px;display:flex;align-items:flex-end;gap:2px;padding:10px 0">
          ${(s.priceHistory || []).slice(-100).map((p, i, arr) => {
            const max = Math.max(...arr, 0.001);
            const h = (p / max) * 180;
            const color = i > 0 && p >= arr[i-1] ? 'var(--accent-green)' : 'var(--accent-red)';
            return `<div style="flex:1;height:${Math.max(h, 1)}px;background:${color};border-radius:2px 2px 0 0;opacity:0.8" title="₹${p.toFixed(4)}"></div>`;
          }).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;color:var(--text-secondary);font-size:0.75rem">
          <span>Current: ₹${(s.price || 0).toFixed(4)}</span>
          <span>Supply: ${(s.totalSupply || 0).toFixed(0)} AC</span>
        </div>
      </div>
    </div>`;
}

async function renderConfig() {
  const data = await api('/api/admin/stats');
  const configs = data.systemConfig || [];

  document.getElementById('sectionContent').innerHTML = `
    <div class="section">
      <div class="section-header"><h3>System Configuration</h3></div>
      <div class="section-body">
        ${configs.length ? configs.map(c => `
          <div class="config-row">
            <div>
              <div class="config-key">${c.key}</div>
              <div style="font-size:0.75rem;color:var(--text-secondary)">${c.description || ''}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="config-value">${c.value}</span>
              <button class="btn btn-sm btn-outline" onclick="editConfig('${c.key}', '${c.value}', '${c.description || ''}')">Edit</button>
            </div>
          </div>
        `).join('') : '<div style="color:var(--text-secondary)">No config entries</div>'}
      </div>
    </div>`;
}

function editConfig(key, currentValue, description) {
  showModal(`
    <h3>Edit Config</h3>
    <div class="form-group"><label>Key</label><input type="text" value="${key}" disabled style="opacity:0.6"></div>
    <div class="form-group"><label>Description</label><input type="text" value="${description}" disabled style="opacity:0.6"></div>
    <div class="form-group"><label>Value</label><input type="text" id="configValue" value="${currentValue}"></div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="hideModal()">Cancel</button>
      <button class="btn btn-green" onclick="saveConfig('${key}')">Save</button>
    </div>
  `);
}

async function saveConfig(key) {
  const value = document.getElementById('configValue').value;
  const result = await api('/api/admin/config', { method: 'POST', body: JSON.stringify({ key, value }) });
  hideModal();
  if (result.success) {
    showToast('Config updated: ' + key + ' = ' + value);
    renderConfig();
  } else {
    showToast('Error: ' + (result.error || 'Failed to update'), 'danger');
  }
}

async function unfreezeUser(userId) {
  const result = await api('/api/admin/unfreeze/' + userId, { method: 'POST' });
  if (result.success) { showToast('User unfrozen'); renderActive(); }
  else showToast('Error: ' + (result.error || 'Failed'), 'danger');
}

async function renderAudit() {
  const data = await api('/api/admin/stats');
  const auditEntries = data.recentAudit || [];

  document.getElementById('sectionContent').innerHTML = `
    <div class="section">
      <div class="section-header">
        <h3>Audit Log</h3>
        <span class="badge">Chain Integrity: ${data.auditIntegrity?.valid ? '✓ Valid' : '✗ Compromised'}</span>
      </div>
      <div class="section-body">
        ${auditEntries.length ? `<table><tr><th>Time</th><th>User</th><th>Action</th><th>Details</th><th>IP</th></tr>${auditEntries.slice(0, 100).map(e => `<tr>
          <td style="white-space:nowrap;font-size:0.75rem">${new Date(e.created_at).toLocaleString()}</td>
          <td style="font-family:monospace;font-size:0.75rem">${e.user_id?.substring(0, 12) || '—'}...</td>
          <td><span class="status info">${e.action}</span></td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.8rem">${e.details || ''}</td>
          <td style="font-size:0.75rem">${e.ip_address || '—'}</td>
        </tr>`).join('')}</table>` : '<div style="color:var(--text-secondary)">No audit entries</div>'}
      </div>
    </div>`;
}

document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('.admin-sidebar nav a[data-section]').forEach(a => {
    a.addEventListener('click', (e) => { e.preventDefault(); switchSection(a.dataset.section); });
  });

  const authed = await checkAuth();
  if (authed) {
    initWS();
    renderOverview();
    setInterval(() => { if (['overview', 'finance', 'chain'].includes(activeSection)) renderActive(); }, 15000);
  }
});
