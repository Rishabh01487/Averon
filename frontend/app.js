// ─── PARTICLE BACKGROUND ─────────────────────────────────────────────────────
(function(){const c=document.getElementById('particleCanvas'),x=c.getContext('2d');let W,H,p=[];function r(){W=c.width=innerWidth;H=c.height=innerHeight}r();addEventListener('resize',r);function P(){this.x=Math.random()*W;this.y=Math.random()*H;this.vx=(Math.random()-.5)*.3;this.vy=(Math.random()-.5)*.3;this.r=Math.random()*1.5+.5}for(let i=0;i<70;i++)p.push(new P);(function d(){x.clearRect(0,0,W,H);p.forEach(q=>{q.x+=q.vx;q.y+=q.vy;if(q.x<0||q.x>W)q.vx*=-1;if(q.y<0||q.y>H)q.vy*=-1;x.beginPath();x.arc(q.x,q.y,q.r,0,Math.PI*2);x.fillStyle='rgba(255,255,255,0.3)';x.fill()});for(let i=0;i<p.length;i++)for(let j=i+1;j<p.length;j++){const dx=p[i].x-p[j].x,dy=p[i].y-p[j].y,d=Math.sqrt(dx*dx+dy*dy);if(d<120){x.beginPath();x.moveTo(p[i].x,p[i].y);x.lineTo(p[j].x,p[j].y);x.strokeStyle=`rgba(255,255,255,${.08*(1-d/120)})`;x.lineWidth=.5;x.stroke()}}requestAnimationFrame(d)})()})();

// ─── STATE ───────────────────────────────────────────────────────────────────
const LS='averon_user';
let USER=null, ECO={price:1,prevPrice:1,priceHistory:[1],totalMinted:0,holders:0,assets:{}}, ASSETS=[], CHAIN={};
let _wizAssetId=null, _wizFiles=[], _wizAI=null, _orderType='buy', _expandedBlock=null;

function save(){if(USER)localStorage.setItem(LS,JSON.stringify(USER))}
function load(){try{return JSON.parse(localStorage.getItem(LS))}catch{return null}}

window.addEventListener('DOMContentLoaded',async()=>{
  setupNav();USER=load();await fetchConfig();
  if(!USER){document.getElementById('authOverlay').classList.add('open');return}
  await syncUser();init();
});

// ─── API HELPERS ─────────────────────────────────────────────────────────────
async function fetchConfig(){
  try{
    const r=await fetch('/api/config');const d=await r.json();
    ECO.prevPrice=ECO.price;ECO.price=d.price||1;CHAIN=d.blockchain||{};
    if(d.economy){ECO.priceHistory=d.economy.priceHistory||[1];ECO.totalMinted=d.economy.totalMinted||0;ECO.holders=d.economy.holders||0;ECO.assets=d.economy.assets||{}}
  }catch{}
}
async function syncUser(){
  if(!USER)return;
  try{const r=await fetch('/api/account/'+USER.id);if(r.ok){const d=await r.json();USER.kbc=d.averon_balance;USER.walletAddress=d.walletAddress;save()}}catch{}
}
async function init(){
  updateNav();updateTicker();await loadAssetList();renderFeatured();updateStats();
  setInterval(async()=>{await fetchConfig();updateTicker()},15000);
}

async function createAccount(){
  const name=document.getElementById('authName').value.trim();
  const org=document.getElementById('authFamily').value.trim();
  if(!name||!org){showToast('Fill both fields','error');return}
  const id='usr_'+Math.random().toString(36).slice(2,10);
  try{
    const r=await fetch('/api/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:id,name,family:org})});
    const d=await r.json();
    USER={id,name,org,kbc:d.averon_balance||0,walletAddress:d.walletAddress};save();
    document.getElementById('authOverlay').classList.remove('open');
    await init();showToast('Wallet: '+shortAddr(USER.walletAddress),'success');
  }catch(e){USER={id,name,org,kbc:0};save();document.getElementById('authOverlay').classList.remove('open');init()}
}

// ─── NAV ─────────────────────────────────────────────────────────────────────
function setupNav(){document.querySelectorAll('.nav-link').forEach(l=>l.addEventListener('click',()=>navigateTo(l.dataset.view)))}
function navigateTo(v){
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(x=>x.classList.remove('active'));
  const el=document.getElementById('view'+v.charAt(0).toUpperCase()+v.slice(1));
  if(el)el.classList.add('active');
  document.querySelectorAll('.nav-link').forEach(x=>{if(x.dataset.view===v)x.classList.add('active')});
  scrollTo({top:0,behavior:'smooth'});
  if(v==='assets')loadAssetList();
  if(v==='portfolio')renderPortfolio();
  if(v==='buytoken')updateBuyPage();
  if(v==='explorer')renderExplorer();
  if(v==='market')renderMarket();
  if(v==='home'){loadAssetList().then(renderFeatured);updateStats()}
}
function updateTicker(){
  const p=ECO.price;document.getElementById('tickerPrice').textContent='₹'+p.toFixed(2);
  const pct=((p-(ECO.prevPrice||p))/(ECO.prevPrice||p)*100).toFixed(2);
  const ch=document.getElementById('tickerChange');ch.textContent=(p>=ECO.prevPrice?'+':'')+pct+'%';ch.className=p>=ECO.prevPrice?'ticker-up':'ticker-dn';
}
function updateNav(){if(!USER)return;document.getElementById('acctName').textContent=USER.name;document.getElementById('acctBal').textContent=(USER.kbc||0).toFixed(2)+' AC'}
function updateStats(){
  document.getElementById('statBlocks').textContent=CHAIN.blocks||1;
  document.getElementById('statTotal').textContent=ECO.assets?.total||0;
  document.getElementById('statFunded').textContent=ECO.assets?.funded||0;
  document.getElementById('statMinted').textContent=Math.round(ECO.totalMinted||0);
}

// ─── BUY COIN ────────────────────────────────────────────────────────────────
function calcBuy(){const inr=parseFloat(document.getElementById('buyInr').value)||0;document.getElementById('kbcReceive').value=inr>0?(inr/ECO.price).toFixed(4):''}
function updateBuyPage(){
  if(!USER)return;
  document.getElementById('buyPriceNow').textContent='₹'+ECO.price.toFixed(4);
  document.getElementById('wAddr').textContent=shortAddr(USER.walletAddress||'—');
  document.getElementById('wKbc').textContent=(USER.kbc||0).toFixed(4)+' AC';
  document.getElementById('wKbcVal').textContent='₹'+((USER.kbc||0)*ECO.price).toFixed(2);
  drawChart();
}
async function startBuy(){
  if(!USER){showToast('Create account first','error');return}
  const inr=parseFloat(document.getElementById('buyInr').value);
  if(!inr||inr<10){showToast('Minimum ₹10','error');return}
  const btn=document.getElementById('buyBtn');btn.disabled=true;btn.textContent='Mining...';
  try{
    const r=await fetch('/api/buy-direct',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:USER.id,amountInr:inr})});
    const d=await r.json();if(!r.ok)throw new Error(d.error);
    USER.kbc=d.newBalance;ECO.prevPrice=ECO.price;ECO.price=d.newPrice;save();updateNav();updateTicker();updateBuyPage();
    showToast(`⛏ Minted ${d.kbc.toFixed(4)} AC — Block #${d.blockIndex}`,'success');
  }catch(e){showToast(e.message,'error')}
  finally{btn.disabled=false;btn.textContent='Mint Averon Coin →'}
}
function drawChart(){
  const c=document.getElementById('priceCanvas');if(!c)return;
  const ctx=c.getContext('2d'),w=c.width,h=c.height;ctx.clearRect(0,0,w,h);
  const hist=ECO.priceHistory||[];if(hist.length<2)return;
  const mn=Math.min(...hist),mx=Math.max(...hist),rng=mx-mn||.01;
  ctx.beginPath();ctx.strokeStyle='rgba(255,255,255,0.5)';ctx.lineWidth=1.5;
  hist.forEach((v,i)=>{const x=(i/(hist.length-1))*w,y=h-((v-mn)/rng)*(h-8)-4;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)});
  ctx.stroke();const g=ctx.createLinearGradient(0,0,0,h);g.addColorStop(0,'rgba(255,255,255,0.06)');g.addColorStop(1,'rgba(255,255,255,0)');
  ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.closePath();ctx.fillStyle=g;ctx.fill();
}

// ─── ASSETS ──────────────────────────────────────────────────────────────────
let _fStatus='all';
async function loadAssetList(){
  try{const r=await fetch('/api/assets');if(r.ok)ASSETS=await r.json()}catch{}
}
function filterAssets(s,btn){
  _fStatus=s;document.querySelectorAll('.f-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');
  renderAssetGrid();
}
function renderFeatured(){
  const g=document.getElementById('featuredGrid');
  const active=ASSETS.filter(a=>a.status==='active').slice(0,6);
  g.innerHTML=active.length?active.map(assetCard).join(''):empty('No active listings yet','Be the first to tokenize an asset','📋');
}
function renderAssetGrid(){
  const g=document.getElementById('assetsGrid');
  const cat=document.getElementById('catFilter')?.value;
  let list=_fStatus==='all'?ASSETS:ASSETS.filter(a=>a.status===_fStatus);
  if(cat&&cat!=='all')list=list.filter(a=>a.category===cat);
  g.innerHTML=list.length?list.map(assetCard).join(''):empty('No assets found','Try a different filter','◎');
}
function assetCard(a){
  const pct=a.progress||0;
  const statusLabels={active:'Active',funded:'Funded',expired:'Expired',pending_review:'Pending',ai_analyzing:'AI Analyzing',verified:'Verified',rejected:'Rejected'};
  const riskColors={LOW:'ai-risk-low',MEDIUM:'ai-risk-medium',HIGH:'ai-risk-high'};
  return `<div class="p-card" onclick="openAsset(${a.id})">
    <div class="card-top"><span class="cat-badge">${esc(a.category)}</span><span class="s-badge s-${a.status}">${statusLabels[a.status]||a.status}</span></div>
    <div class="card-title">${esc(a.title)}</div>
    <div class="card-desc">${esc(a.description)}</div>
    ${a.ai_verified?`<div class="card-ai"><span class="ai-badge ai-verified">✓ AI Verified</span>${a.ai_risk_level?`<span class="ai-badge ${riskColors[a.ai_risk_level]||''}">${a.ai_risk_level} Risk</span>`:''}</div>`:''}
    ${a.token_count>0?`<div class="token-grid-small">${Array.from({length:Math.min(a.token_count,30)},(_,i)=>`<div class="token-dot${i<(a.tokens_sold||0)?' sold':''}"></div>`).join('')}${a.token_count>30?`<span style="font-size:10px;color:var(--txt3);margin-left:4px">+${a.token_count-30}</span>`:''}</div>`:''}
    <div class="prog-bg"><div class="prog-fill" style="width:${pct}%"></div></div>
    <div class="prog-lbl"><span class="prog-raised">${(a.tokens_sold||0)}/${a.token_count||0} tokens</span><span>${pct}%</span></div>
    <div class="card-foot"><span>₹${(a.raise_amount||0).toLocaleString()} raise</span><span>${a.token_price?(a.token_price.toFixed(2)+' AC/token'):''}</span></div>
  </div>`;
}

async function openAsset(id){
  try{
    const r=await fetch('/api/assets/'+id);const a=await r.json();
    const isOwner=USER&&a.owner_id===USER.id;
    const canBuy=USER&&a.status==='active'&&!isOwner&&a.tokens_available>0;
    document.getElementById('modalContent').innerHTML=`
      <span class="m-cat">${esc(a.category)}</span>
      <div class="m-title">${esc(a.title)}</div>
      <div class="m-by">Listed by ${esc(a.owner_name)} · ${esc(a.owner_org)}</div>
      <div class="m-desc">${esc(a.description)}</div>
      ${a.ai_verified?`
        <div class="ai-verdict pass"><div class="ai-verdict-ico">✓</div><div class="ai-verdict-txt"><h4>AI Verified</h4><p>Valuation: ₹${(a.ai_valuation||0).toLocaleString()} · Risk: ${a.ai_risk_level} (${a.ai_risk_score}%)</p></div></div>
        ${a.ai_analysis_summary?`<div class="ai-summary">${esc(a.ai_analysis_summary)}</div>`:''}
        ${a.ai_concerns?`<div class="ai-concerns">${esc(a.ai_concerns)}</div>`:''}
      `:''}
      <div class="m-stats">
        <div class="m-stat"><div class="m-sv">₹${(a.raise_amount||0).toLocaleString()}</div><div class="m-sl">Raise Amount</div></div>
        <div class="m-stat"><div class="m-sv">${a.tokens_sold||0}/${a.token_count||0}</div><div class="m-sl">Tokens Sold</div></div>
        <div class="m-stat"><div class="m-sv">${a.progress||0}%</div><div class="m-sl">Funded</div></div>
      </div>
      ${a.token_count>0?`
        <div style="font-size:12px;font-weight:700;margin-bottom:8px">Token Grid (${a.token_price?.toFixed(2)} AC each)</div>
        <div class="token-grid">${a.tokens.map(t=>`<div class="token-cell ${t.owned?(t.ownerId===USER?.id?'mine':'sold'):'available'}">${t.index}</div>`).join('')}</div>
      `:''}
      ${a.documents?.length?`
        <div style="font-size:12px;font-weight:700;margin:16px 0 8px">Documents (${a.documents.length})</div>
        ${a.documents.map(d=>`<div class="file-item"><span class="fi-name">📄 ${esc(d.name)}</span><span class="fi-size">${(d.size/1024).toFixed(0)}KB</span></div>`).join('')}
      `:''}
      ${canBuy?`
        <div style="margin-top:20px">
          <div style="font-size:13px;font-weight:700;margin-bottom:8px">Buy Tokens</div>
          <div class="fund-row">
            <input class="f-inp2" type="number" id="buyTokenCount" placeholder="How many tokens?" min="1" max="${a.tokens_available}" value="1"/>
            <button class="btn btn-white btn-sm" onclick="buyTokens(${a.id})">Buy →</button>
          </div>
          <div class="avail">Available: ${a.tokens_available} tokens · Cost per token: ${a.token_price?.toFixed(4)} AC · Your balance: ${(USER?.kbc||0).toFixed(4)} AC</div>
        </div>
      `:''}
      ${a.tx_hash?`<div style="margin-top:16px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--txt3)">TX: ${a.tx_hash}</div>`:''}
    `;
    document.getElementById('assetModal').classList.add('open');
  }catch(e){showToast('Failed to load asset','error')}
}
function closeAssetModal(){document.getElementById('assetModal').classList.remove('open')}

async function buyTokens(assetId){
  const count=parseInt(document.getElementById('buyTokenCount')?.value)||1;
  try{
    const r=await fetch(`/api/assets/${assetId}/tokens/buy`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:USER.id,count})});
    const d=await r.json();if(!r.ok)throw new Error(d.error);
    USER.kbc=d.newBalance;save();updateNav();
    showToast(`⛏ Bought ${d.tokensBought} tokens — Block #${d.blockIndex}${d.funded?' — ASSET FULLY FUNDED! 🎉':''}`,'success');
    closeAssetModal();loadAssetList().then(()=>{renderAssetGrid();renderFeatured()});
  }catch(e){showToast(e.message,'error')}
}

// ─── TOKENIZE WIZARD ─────────────────────────────────────────────────────────
function wizNext(step){
  document.querySelectorAll('.wiz-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.wiz-step').forEach(s=>{
    const n=parseInt(s.dataset.step);
    s.classList.toggle('active',n===step);
    s.classList.toggle('done',n<step);
  });
  document.getElementById('wizStep'+step).classList.add('active');
}

// Drag & Drop
const dz=document.getElementById('dropzone');
if(dz){
  ['dragenter','dragover'].forEach(e=>dz.addEventListener(e,ev=>{ev.preventDefault();dz.classList.add('dragover')}));
  ['dragleave','drop'].forEach(e=>dz.addEventListener(e,ev=>{ev.preventDefault();dz.classList.remove('dragover')}));
  dz.addEventListener('drop',ev=>handleFiles(ev.dataTransfer.files));
}

function handleFiles(files){
  for(const f of files){
    if(_wizFiles.length>=5)break;
    if(f.size>10*1024*1024){showToast('File too large (max 10MB)','error');continue}
    _wizFiles.push(f);
  }
  renderFileList();
}
function renderFileList(){
  const el=document.getElementById('fileList');
  el.innerHTML=_wizFiles.map((f,i)=>`<div class="file-item"><span class="fi-name">${esc(f.name)}</span><span class="fi-size">${(f.size/1024).toFixed(0)}KB</span><button class="fi-remove" onclick="removeFile(${i})">✕</button></div>`).join('');
}
function removeFile(i){_wizFiles.splice(i,1);renderFileList()}

async function uploadAndAnalyze(){
  if(!USER){showToast('Create account first','error');return}
  const title=document.getElementById('assetTitle').value.trim();
  const cat=document.getElementById('assetCat').value;
  const raise=parseFloat(document.getElementById('assetRaise').value);
  const desc=document.getElementById('assetDesc').value.trim();
  const days=parseInt(document.getElementById('assetDays').value)||30;
  if(!title||!raise||!desc){showToast('Fill all required fields','error');wizNext(1);return}
  if(_wizFiles.length===0){showToast('Upload at least one document','error');return}

  wizNext(3);
  document.getElementById('aiResult').style.display='none';
  document.getElementById('aiStatus').style.display='block';

  try{
    // Step 1: Create asset
    const cr=await fetch('/api/assets/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:USER.id,title,description:desc,category:cat,raiseAmount:raise,days})});
    const cd=await cr.json();if(!cr.ok)throw new Error(cd.error);
    _wizAssetId=cd.assetId;

    // Step 2: Upload documents
    const formData=new FormData();
    _wizFiles.forEach(f=>formData.append('documents',f));
    await fetch(`/api/assets/${_wizAssetId}/documents`,{method:'POST',body:formData});

    // Step 3: Trigger AI analysis
    const ar=await fetch(`/api/assets/${_wizAssetId}/analyze`,{method:'POST',headers:{'Content-Type':'application/json'}});
    const ai=await ar.json();if(!ar.ok)throw new Error(ai.error);
    _wizAI=ai;

    // Show result
    document.getElementById('aiStatus').style.display='none';
    document.getElementById('aiResult').style.display='block';
    document.getElementById('aiResult').innerHTML=renderAIResult(ai, raise);

    if(ai.verified){
      setTimeout(()=>wizNext(4),100);
      renderConfirmSummary(title, cat, raise, ai);
    }
  }catch(e){
    document.getElementById('aiStatus').innerHTML=`<div style="color:var(--red);font-size:14px">❌ ${e.message}</div><button class="btn btn-ghost" style="margin-top:16px" onclick="wizNext(2)">← Try Again</button>`;
  }
}

function renderAIResult(ai, raise){
  const riskColors={LOW:'var(--green-profit)',MEDIUM:'#fbbf24',HIGH:'var(--red)'};
  return `<div class="ai-result-card">
    <div class="ai-verdict ${ai.verified?'pass':'fail'}">
      <div class="ai-verdict-ico">${ai.verified?'✓':'✗'}</div>
      <div class="ai-verdict-txt"><h4>${ai.verified?'Asset Verified':'Verification Failed'}</h4><p>${ai.verified?'AI has verified this asset for tokenization':'Documents could not be verified'} (${ai.source==='gemini'?'Gemini AI':'Simulated AI'})</p></div>
    </div>
    <div class="ai-metrics">
      <div class="ai-metric"><div class="am-val" style="color:${riskColors[ai.riskLevel]||'var(--txt)'}">${ai.riskScore}%</div><div class="am-lbl">Risk Score</div></div>
      <div class="ai-metric"><div class="am-val">₹${(ai.estimatedValue||0).toLocaleString()}</div><div class="am-lbl">Valuation</div></div>
      <div class="ai-metric"><div class="am-val">${ai.confidence||0}%</div><div class="am-lbl">Confidence</div></div>
    </div>
    <div class="ai-summary">${esc(ai.analysis)}</div>
    ${ai.concerns?`<div class="ai-concerns">${esc(ai.concerns)}</div>`:''}
    <div style="margin-top:16px;font-size:12px;color:var(--txt3)">
      Suggested: ${ai.suggestedTokens} tokens × ₹${ai.tokenPriceInr?.toFixed(2)}/token = ₹${raise?.toLocaleString()} raise
    </div>
  </div>
  ${!ai.verified?`<button class="btn btn-ghost btn-full" style="margin-top:12px" onclick="wizNext(1)">← Edit & Retry</button>`:''}`;
}

function renderConfirmSummary(title, cat, raise, ai){
  const tokenPriceAC=(ai.tokenPriceInr/ECO.price).toFixed(4);
  document.getElementById('confirmSummary').innerHTML=`
    <div style="margin-bottom:20px">
      <div style="font-size:12px;color:var(--txt3);margin-bottom:4px">Asset</div>
      <div style="font-size:16px;font-weight:700">${esc(title)}</div>
      <div style="font-size:12px;color:var(--txt2);margin-top:4px">${cat} · AI Verified ✓ · Risk: ${ai.riskLevel} (${ai.riskScore}%)</div>
    </div>
    <div class="bm-grid">
      <div class="bm-item"><div class="bm-label">Raise Amount</div><div class="bm-value">₹${raise.toLocaleString()}</div></div>
      <div class="bm-item"><div class="bm-label">AI Valuation</div><div class="bm-value">₹${(ai.estimatedValue||0).toLocaleString()}</div></div>
      <div class="bm-item"><div class="bm-label">Tokens</div><div class="bm-value">${ai.suggestedTokens} × ${tokenPriceAC} AC</div></div>
      <div class="bm-item"><div class="bm-label">Duration</div><div class="bm-value">${document.getElementById('assetDays').value} days</div></div>
    </div>
    <div style="font-size:12px;color:var(--txt2);margin-bottom:20px;line-height:1.6">
      An <strong>ASSET_CREATE</strong> transaction will be recorded on the Averon blockchain. Investors can then buy tokens. When fully funded, you receive the raise amount converted to INR.
    </div>`;
}

async function confirmListing(){
  if(!_wizAssetId){showToast('No asset to confirm','error');return}
  const btn=document.getElementById('confirmBtn');btn.disabled=true;btn.textContent='Mining block...';
  try{
    const r=await fetch(`/api/assets/${_wizAssetId}/confirm`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:USER.id})});
    const d=await r.json();if(!r.ok)throw new Error(d.error);
    showToast(`⛓ Listed! ${d.tokenCount} tokens created — on blockchain`,'success');
    _wizAssetId=null;_wizFiles=[];_wizAI=null;
    wizNext(1);
    ['assetTitle','assetDesc','assetRaise'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=''});
    document.getElementById('fileList').innerHTML='';
    navigateTo('assets');
  }catch(e){showToast(e.message,'error')}
  finally{btn.disabled=false;btn.textContent='⛓ Confirm & List on Blockchain →'}
}

// ─── MARKETPLACE ─────────────────────────────────────────────────────────────
function setOrderType(type,btn){_orderType=type;document.querySelectorAll('.o-tab').forEach(b=>b.classList.remove('active'));btn.classList.add('active')}

document.getElementById('orderAmt')?.addEventListener('input',updateOrderTotal);
document.getElementById('orderPrice')?.addEventListener('input',updateOrderTotal);
function updateOrderTotal(){
  const a=parseFloat(document.getElementById('orderAmt')?.value)||0;
  const p=parseFloat(document.getElementById('orderPrice')?.value)||0;
  document.getElementById('orderTotal').textContent='₹'+(a*p).toFixed(2);
}

async function renderMarket(){
  try{
    const r=await fetch('/api/market/orderbook');const d=await r.json();
    const ob=document.getElementById('orderBook');
    ob.innerHTML=`<div class="ob-row hdr"><div>Type</div><div>Amount</div><div>Price</div></div>` +
      (d.sells||[]).map(o=>`<div class="ob-row"><div class="sell-side">SELL</div><div>${o.remaining.toFixed(2)} AC</div><div>₹${o.price.toFixed(4)}</div></div>`).join('') +
      (d.buys||[]).map(o=>`<div class="ob-row"><div class="buy-side">BUY</div><div>${o.remaining.toFixed(2)} AC</div><div>₹${o.price.toFixed(4)}</div></div>`).join('') +
      (!d.buys?.length&&!d.sells?.length?'<div style="padding:20px;text-align:center;color:var(--txt3);font-size:12px">No open orders</div>':'');

    const tl=document.getElementById('recentTrades');
    tl.innerHTML=(d.recentTrades||[]).length?d.recentTrades.map(t=>`<div class="trade-row"><span>${t.buyer_name} bought ${t.amount.toFixed(2)} AC</span><span>₹${t.price_per_coin.toFixed(4)}</span></div>`).join(''):'<div style="padding:16px;text-align:center;color:var(--txt3);font-size:12px">No trades yet</div>';
  }catch{}
}

async function placeOrder(){
  if(!USER){showToast('Create account first','error');return}
  const amount=parseFloat(document.getElementById('orderAmt').value);
  const price=parseFloat(document.getElementById('orderPrice').value);
  if(!amount||!price){showToast('Fill amount and price','error');return}
  try{
    const r=await fetch('/api/market/'+(_orderType==='buy'?'buy':'sell'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:USER.id,amount,pricePerCoin:price})});
    const d=await r.json();if(!r.ok)throw new Error(d.error);
    showToast(`${_orderType.toUpperCase()} order placed`,'success');
    renderMarket();syncUser().then(updateNav);
  }catch(e){showToast(e.message,'error')}
}

// ─── EXPLORER ────────────────────────────────────────────────────────────────
async function renderExplorer(){
  try{
    const [infoR,blocksR,validR]=await Promise.all([fetch('/api/blockchain/info'),fetch('/api/blockchain/blocks?limit=30'),fetch('/api/blockchain/validate')]);
    const info=await infoR.json(),bd=await blocksR.json(),valid=await validR.json();
    document.getElementById('exBlocks').textContent=info.blocks;
    document.getElementById('exTxs').textContent=info.transactions;
    document.getElementById('exDiff').textContent=info.difficulty;
    document.getElementById('exValid').innerHTML=valid.valid?'<span class="chain-valid">✓ Valid</span>':'<span style="color:var(--red)">✗ Invalid</span>';
    const bl=document.getElementById('blockList');
    bl.innerHTML=(bd.blocks||[]).map(b=>`
      <div class="block-card" onclick="toggleBlock(${b.index})" id="bc-${b.index}">
        <div class="blk-idx">#${b.index}</div>
        <div class="blk-hash">${shortHash(b.hash)}</div>
        <div class="blk-txcount">${b.transactionCount}<span>txs</span></div>
        <div class="blk-time">${timeAgo(b.timestamp)}</div>
      </div>
      <div id="bd-${b.index}" style="display:none"></div>
    `).join('');
  }catch{document.getElementById('blockList').innerHTML='<div class="empty-state"><div class="empty-ico">⚠</div><div class="empty-title">Server offline</div></div>'}
}

async function toggleBlock(idx){
  const el=document.getElementById('bd-'+idx);if(!el)return;
  if(_expandedBlock===idx){el.style.display='none';_expandedBlock=null;return}
  if(_expandedBlock!==null){const p=document.getElementById('bd-'+_expandedBlock);if(p)p.style.display='none'}
  try{
    const r=await fetch('/api/blockchain/block/'+idx);const b=await r.json();
    el.innerHTML=`<div class="block-detail">
      <div class="bm-grid">
        <div class="bm-item"><div class="bm-label">Hash</div><div class="bm-value">${b.hash}</div></div>
        <div class="bm-item"><div class="bm-label">Previous</div><div class="bm-value">${b.previousHash}</div></div>
        <div class="bm-item"><div class="bm-label">Time</div><div class="bm-value">${new Date(b.timestamp).toLocaleString()}</div></div>
        <div class="bm-item"><div class="bm-label">Nonce</div><div class="bm-value">${b.nonce}</div></div>
      </div>
      <div style="font-size:12px;font-weight:700;margin-bottom:8px">${b.transactions.length} Transaction(s)</div>
      ${b.transactions.map(tx=>`<div class="tx-detail-card">
        <div class="tx-detail-row"><span class="tx-label">Type</span><span class="tx-type-badge ${(tx.type||'').toLowerCase()}">${tx.type||'TX'}</span></div>
        <div class="tx-detail-row"><span class="tx-label">Hash</span><span class="tx-value mono" style="font-size:10px">${shortHash(tx.hash)}</span></div>
        <div class="tx-detail-row"><span class="tx-label">From</span><span class="tx-value mono" style="font-size:10px">${tx.from==='SYSTEM'?'⚙ SYSTEM':shortAddr(tx.from)}</span></div>
        <div class="tx-detail-row"><span class="tx-label">To</span><span class="tx-value mono" style="font-size:10px">${tx.to==='SYSTEM'?'⚙ SYSTEM':shortAddr(tx.to)}</span></div>
        <div class="tx-detail-row"><span class="tx-label">Amount</span><span class="tx-value" style="font-weight:800">${tx.amount.toFixed(4)} AC</span></div>
      </div>`).join('')}
    </div>`;
    el.style.display='block';_expandedBlock=idx;
  }catch{}
}

// ─── PORTFOLIO ───────────────────────────────────────────────────────────────
async function renderPortfolio(){
  if(!USER)return;
  await syncUser();
  try{
    const r=await fetch('/api/portfolio/'+USER.id);const p=await r.json();
    document.getElementById('portSum').innerHTML=`
      <div class="stat-card"><div class="stat-ico">🔑</div><div class="stat-val mono" style="font-size:12px">${shortAddr(p.walletAddress||'—')}</div><div class="stat-lbl">Wallet</div></div>
      <div class="stat-card"><div class="stat-ico">◎</div><div class="stat-val">${(p.balance||0).toFixed(4)}</div><div class="stat-lbl">Averon Coin</div></div>
      <div class="stat-card"><div class="stat-ico">₹</div><div class="stat-val">₹${(p.coinValue||0).toFixed(2)}</div><div class="stat-lbl">Coin Value</div></div>
      <div class="stat-card"><div class="stat-ico">🎫</div><div class="stat-val">${(p.tokens||[]).length}</div><div class="stat-lbl">Tokens Held</div></div>`;

    // Tokens
    const tg=document.getElementById('myTokensGrid');
    if(p.tokens?.length){
      const grouped={};p.tokens.forEach(t=>{if(!grouped[t.asset_title])grouped[t.asset_title]=[];grouped[t.asset_title].push(t)});
      tg.innerHTML=Object.entries(grouped).map(([title,tokens])=>`<div class="p-card"><div class="card-top"><span class="cat-badge">${esc(tokens[0].category)}</span><span class="s-badge s-${tokens[0].asset_status}">${tokens[0].asset_status}</span></div><div class="card-title">${esc(title)}</div><div style="font-size:13px;font-weight:700;margin-bottom:4px">${tokens.length} token(s) held</div><div style="font-size:12px;color:var(--txt2)">Total value: ${(tokens.reduce((s,t)=>s+t.price,0)).toFixed(4)} AC</div></div>`).join('');
    }else tg.innerHTML=empty('No tokens yet','Invest in assets','🎫');

    // Assets
    const ag=document.getElementById('myAssetsGrid');
    ag.innerHTML=(p.myAssets?.length)?p.myAssets.map(assetCard).join(''):empty('No assets listed','Tokenize your first asset','📋');

    // Orders
    const ol=document.getElementById('myOrdersList');
    ol.innerHTML=(p.myOrders?.length)?p.myOrders.map(o=>`<div class="tx-item"><div><div class="tx-type">${o.type.toUpperCase()} ${o.amount} AC @ ₹${o.price_per_coin}</div><div class="tx-time">${o.status} · ${timeAgo(o.created_at)}</div></div><div style="text-align:right"><div class="tx-kbc">${o.filled}/${o.amount}</div></div></div>`).join(''):empty('No orders','Place a trade on the marketplace','📊');

    // Activity
    const al=document.getElementById('activityList');
    al.innerHTML=(p.activity?.length)?p.activity.map(a=>`<div class="tx-item"><div><div class="tx-type">${a.action}</div><div class="tx-time">${timeAgo(a.created_at)}${a.tx_hash?' · TX: '+shortHash(a.tx_hash):''}</div></div>${a.amount?`<div class="tx-kbc">${a.amount}</div>`:''}</div>`).join(''):empty('No activity','Start by buying Averon Coin','◎');
  }catch{}
}
function switchTab(id,btn){document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));document.getElementById(id)?.classList.add('active');btn.classList.add('active')}

// ─── UTILS ───────────────────────────────────────────────────────────────────
function shortHash(h){return h?(h.slice(0,8)+'…'+h.slice(-6)):'—'}
function shortAddr(a){return a?(a.slice(0,8)+'…'+a.slice(-4)):'—'}
function empty(t,s,ic='◎'){return`<div class="empty-state"><div class="empty-ico">${ic}</div><div class="empty-title">${t}</div><div class="empty-txt">${s}</div></div>`}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function timeAgo(ts){const s=Math.floor((Date.now()-ts)/1000);if(s<60)return'just now';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago'}
let _tt;function showToast(msg,type='info'){const t=document.getElementById('toast');document.getElementById('toastIco').textContent={success:'✓',error:'✗',info:'◎'}[type]||'◎';document.getElementById('toastMsg').textContent=msg;t.className=`toast ${type} show`;clearTimeout(_tt);_tt=setTimeout(()=>t.classList.remove('show'),4000)}
