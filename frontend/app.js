// ─── PARTICLE BACKGROUND ─────────────────────────────────────────────────────
(function(){
  const canvas=document.getElementById('particleCanvas');
  const ctx=canvas.getContext('2d');
  let W,H,particles=[];
  function resize(){W=canvas.width=window.innerWidth;H=canvas.height=window.innerHeight;}
  resize();window.addEventListener('resize',resize);
  function Particle(){this.x=Math.random()*W;this.y=Math.random()*H;this.vx=(Math.random()-.5)*.3;this.vy=(Math.random()-.5)*.3;this.r=Math.random()*1.5+.5;}
  for(let i=0;i<80;i++)particles.push(new Particle());
  function draw(){
    ctx.clearRect(0,0,W,H);
    particles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;if(p.x<0||p.x>W)p.vx*=-1;if(p.y<0||p.y>H)p.vy*=-1;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fillStyle='rgba(255,255,255,0.35)';ctx.fill();});
    for(let i=0;i<particles.length;i++){for(let j=i+1;j<particles.length;j++){const dx=particles[i].x-particles[j].x,dy=particles[i].y-particles[j].y;const d=Math.sqrt(dx*dx+dy*dy);if(d<130){ctx.beginPath();ctx.moveTo(particles[i].x,particles[i].y);ctx.lineTo(particles[j].x,particles[j].y);ctx.strokeStyle=`rgba(255,255,255,${.1*(1-d/130)})`;ctx.lineWidth=.5;ctx.stroke();}}}
    requestAnimationFrame(draw);
  }
  draw();
})();

const LS='averon_user';
let USER=null,ECONOMY={price:1,prevPrice:1,history:[1]},PROPOSALS=[],RZP_LIVE=false,RZP_KEY='';
function saveUser(){if(USER)localStorage.setItem(LS,JSON.stringify(USER));}
function loadUser(){try{return JSON.parse(localStorage.getItem(LS));}catch{return null;}}

window.addEventListener('DOMContentLoaded',async()=>{
  setupNav();USER=loadUser();await loadConfig();
  if(!USER){document.getElementById('authOverlay').classList.add('open');return;}
  await syncAccount();init();
});

async function loadConfig(){
  try{
    const r=await fetch('/api/config');const d=await r.json();
    ECONOMY.prevPrice=ECONOMY.price;ECONOMY.price=d.price||1;ECONOMY.history=d.economy?.history||[1];
    ECONOMY.totalSold=d.economy?.totalSold||0;ECONOMY.holders=d.economy?.holders||0;
    RZP_LIVE=d.isLive;RZP_KEY=d.keyId||'';
    const el=document.getElementById('rzpStatus');if(!el)return;
    if(RZP_LIVE){el.className='rzp-status rzp-live';el.textContent='✓ Razorpay connected — live payments active';}
    else if(RZP_KEY&&RZP_KEY.startsWith('rzp_')){el.className='rzp-status rzp-test';el.textContent='◎ Razorpay in test mode — add live keys to go fully live';}
    else{el.className='rzp-status rzp-off';el.textContent='⚠ Add RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET to .env and restart server';}
  }catch(e){
    const el=document.getElementById('rzpStatus');if(el){el.className='rzp-status rzp-off';el.textContent='⚠ Restart the server (node server.js) to enable Razorpay payments';}
  }
}

async function syncAccount(){
  if(!USER)return;
  try{const r=await fetch('/api/account/'+USER.id);if(r.ok){const d=await r.json();USER.kbc=d.kbc;USER.inr=d.inr;saveUser();}}catch{}
}

async function init(){
  updateNav();updateTicker();await loadProposals();
  renderFeatured();updateStats();updateTokenSpot();
  setInterval(async()=>{await loadConfig();updateTicker();updateTokenSpot();},15000);
}

async function createAccount(){
  const name=document.getElementById('authName').value.trim();
  const family=document.getElementById('authFamily').value.trim();
  if(!name||!family){showToast('Fill in both fields','error');return;}
  const id='usr_'+Math.random().toString(36).slice(2,10);
  USER={id,name,family,kbc:0,inr:0};saveUser();
  fetch('/api/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:id,name,family})}).catch(()=>{});
  document.getElementById('authOverlay').classList.remove('open');
  await init();showToast('Welcome, '+name+'! Restart server to enable payments.','info');
}

function setupNav(){document.querySelectorAll('.nav-link').forEach(l=>l.addEventListener('click',()=>navigateTo(l.dataset.view)));}
function navigateTo(v){
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(x=>x.classList.remove('active'));
  const el=document.getElementById('view'+v.charAt(0).toUpperCase()+v.slice(1));
  if(el)el.classList.add('active');
  document.querySelectorAll('.nav-link').forEach(x=>{if(x.dataset.view===v)x.classList.add('active');});
  window.scrollTo({top:0,behavior:'smooth'});
  if(v==='proposals')renderProposals();
  if(v==='portfolio'){syncAccount().then(renderPortfolio);}
  if(v==='buytoken'){updateBuyPage();renderTxList();}
  if(v==='home'){renderFeatured();updateTokenSpot();}
}

function updateTicker(){
  const p=ECONOMY.price,prev=ECONOMY.prevPrice||p;
  const pct=((p-prev)/prev*100).toFixed(2);const up=p>=prev;
  document.getElementById('tickerPrice').textContent='₹'+p.toFixed(4);
  const ch=document.getElementById('tickerChange');
  ch.textContent=(up?'+':'')+pct+'%';ch.className=up?'ticker-up':'ticker-dn';
}
function updateNav(){if(!USER)return;document.getElementById('acctName').textContent=USER.name;document.getElementById('acctBal').textContent=(USER.kbc||0).toFixed(2)+' Averon Coin';}

function calcBuy(){
  const inr=parseFloat(document.getElementById('buyInr').value)||0;
  const kbc=inr>0?parseFloat((inr/ECONOMY.price).toFixed(4)):0;
  document.getElementById('kbcReceive').value=kbc||'';
  document.getElementById('priceImpact').textContent='~'+(inr>0?((kbc/10000)*100).toFixed(2):'0.00')+'%';
  document.getElementById('afterPrice').textContent='₹'+(inr>0?(ECONOMY.price*(1+kbc/10000)).toFixed(4):ECONOMY.price.toFixed(4));
}

async function startBuy(){
  if(!USER){showToast('Create account first','error');return;}
  const inr=parseFloat(document.getElementById('buyInr').value);
  if(!inr||inr<10){showToast('Minimum ₹10 required','error');return;}
  if(!RZP_LIVE&&!RZP_KEY.includes('rzp_')){showToast('Razorpay not configured. Add keys to .env','error');return;}
  const btn=document.getElementById('buyBtn');btn.disabled=true;btn.textContent='Opening payment...';
  try{
    const or=await fetch('/api/order/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:USER.id,amountInr:inr})});
    const od=await or.json();
    if(!or.ok)throw new Error(od.error||'Order failed');
    new Razorpay({
      key:RZP_KEY,amount:od.amount,currency:'INR',name:'Averon',description:'Buy Averon Coin',
      order_id:od.orderId,
      handler:async(response)=>{
        const vr=await fetch('/api/order/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...response,userId:USER.id,amountInr:inr})});
        const vd=await vr.json();
        if(vd.success){USER.kbc=vd.newBalance;ECONOMY.prevPrice=ECONOMY.price;ECONOMY.price=vd.newPrice;saveUser();updateNav();updateTicker();updateBuyPage();renderTxList();showToast('Bought '+vd.kbc.toFixed(4)+' Averon Coin!','success');}
        else showToast('Payment verification failed','error');
      },
      prefill:{name:USER.name},theme:{color:'#ffffff',backdrop_color:'#000000'}
    }).open();
  }catch(e){showToast(e.message||'Payment failed','error');}
  finally{btn.disabled=false;btn.textContent='Buy Averon Coin via Razorpay →';}
}

function updateBuyPage(){
  if(!USER)return;
  document.getElementById('buyPriceNow').textContent='₹'+ECONOMY.price.toFixed(4);
  document.getElementById('inrHint').textContent='₹'+(USER.inr||0).toFixed(2);
  document.getElementById('wInr').textContent='₹'+(USER.inr||0).toFixed(2);
  document.getElementById('wKbc').textContent=(USER.kbc||0).toFixed(4)+' Averon Coin';
  const kv=((USER.kbc||0)*ECONOMY.price).toFixed(2);
  document.getElementById('wKbcVal').textContent='₹'+kv;
  document.getElementById('wTotal').textContent='₹'+((USER.inr||0)+parseFloat(kv)).toFixed(2);
}

function renderTxList(){
  const el=document.getElementById('txList');
  fetch('/api/economy').then(r=>r.json()).then(e=>{
    const txs=(e.transactions||[]).filter(t=>t.userId===USER?.id).slice(0,20);
    if(!txs.length){el.innerHTML='<div class="empty-state"><div class="empty-ico">◎</div><div class="empty-title">No transactions yet</div></div>';return;}
    el.innerHTML=txs.map(t=>`<div class="tx-item"><div style="display:flex;align-items:center"><span class="tx-ico">${t.type==='buy'?'↓':'→'}</span><div><div class="tx-type">${t.type==='buy'?'Bought Averon Coin':'Invested Averon Coin'}</div><div class="tx-time">${timeAgo(t.time)} · @₹${t.price?.toFixed(4)||'—'}</div></div></div><div style="text-align:right"><div class="tx-kbc">${t.type==='buy'?'+':'−'}${(t.kbc||0).toFixed(4)} Averon Coin</div><div class="tx-inr">₹${(t.inr||0).toFixed(2)}</div></div></div>`).join('');
  }).catch(()=>{});
}

function updateTokenSpot(){
  const p=ECONOMY.price,prev=ECONOMY.prevPrice||p;
  const pct=((p-prev)/prev*100).toFixed(2);const up=p>=prev;
  document.getElementById('tokenPriceBig').textContent='₹'+p.toFixed(4);
  const ch=document.getElementById('tokenChangeBig');ch.textContent=(up?'+':'')+pct+'%';ch.className=up?'ticker-up':'ticker-dn';
  const ts=ECONOMY.totalSold||0;
  document.getElementById('tsSold').textContent=ts.toFixed(0);
  document.getElementById('tsMcap').textContent='₹'+(ts*p).toFixed(0);
  document.getElementById('tsHolders').textContent=ECONOMY.holders||0;
  drawChart();
}

function drawChart(){
  const c=document.getElementById('priceCanvas');if(!c)return;
  const ctx=c.getContext('2d'),w=c.width,h=c.height;ctx.clearRect(0,0,w,h);
  const hist=ECONOMY.history||[];if(hist.length<2)return;
  const mn=Math.min(...hist),mx=Math.max(...hist),rng=mx-mn||.01;
  ctx.beginPath();ctx.strokeStyle='rgba(255,255,255,0.6)';ctx.lineWidth=1.5;
  hist.forEach((v,i)=>{const x=(i/(hist.length-1))*w,y=h-((v-mn)/rng)*(h-8)-4;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});
  ctx.stroke();
  const g=ctx.createLinearGradient(0,0,0,h);g.addColorStop(0,'rgba(255,255,255,0.08)');g.addColorStop(1,'rgba(255,255,255,0)');
  ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.closePath();ctx.fillStyle=g;ctx.fill();
}

let fStatus='all',fCat='all';
async function loadProposals(){try{const r=await fetch('/api/proposals');if(r.ok)PROPOSALS=await r.json();}catch{}}
function checkDL(){PROPOSALS.forEach(p=>{if(p.status==='active'&&Date.now()>p.deadline)p.status=p.raised>=p.goal?'funded':'expired';});}

function updateStats(){
  checkDL();
  document.getElementById('statTotal').textContent=PROPOSALS.length;
  document.getElementById('statFunded').textContent=PROPOSALS.filter(p=>p.status==='funded').length;
  document.getElementById('statActive').textContent=PROPOSALS.filter(p=>p.status==='active').length;
  document.getElementById('statKbc').textContent=PROPOSALS.reduce((a,p)=>a+p.raised,0).toFixed(0)+' Averon Coin';
}

function renderFeatured(){checkDL();const g=document.getElementById('featuredGrid');const a=PROPOSALS.filter(p=>p.status==='active').slice(0,3);g.innerHTML=a.length?a.map(pCard).join(''):empty('No active proposals yet','Submit the first idea','◎');}
function renderProposals(){checkDL();const g=document.getElementById('proposalsGrid');const list=PROPOSALS.filter(p=>(fStatus==='all'||p.status===fStatus)&&(fCat==='all'||p.category===fCat));g.innerHTML=list.length?list.map(pCard).join(''):empty('No proposals found','Try a different filter','◎');}
function filterP(f,btn){fStatus=f;document.querySelectorAll('.f-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderProposals();}
function filterCat(){fCat=document.getElementById('catFilter').value;renderProposals();}

function pCard(p){
  const pct=Math.min(100,Math.round((p.raised/p.goal)*100));
  const d=Math.max(0,Math.ceil((p.deadline-Date.now())/864e5));
  const lbl={active:'Active',funded:'Funded',expired:'Expired'}[p.status]||p.status;
  return `<div class="p-card" onclick="openProp(${p.id})">
    <div class="card-top"><span class="cat-badge">${p.category}</span><span class="s-badge s-${p.status}">${lbl}</span></div>
    <div class="card-title">${esc(p.title)}</div>
    <div class="card-desc">${esc(p.desc)}</div>
    <div class="card-by">By <span>${esc(p.proposer)}</span></div>
    <div class="prog-bg"><div class="prog-fill" style="width:${pct}%"></div></div>
    <div class="prog-lbl"><span class="prog-raised">${p.raised.toFixed(0)} Averon Coin</span><span class="prog-goal">Goal: ${p.goal} Averon Coin</span></div>
    <div class="card-foot"><span>${p.status==='active'?`⏱ ${d}d left`:p.status==='funded'?'✓ Funded':'✗ Expired'}</span><span>${pct}%</span></div>
  </div>`;
}

function openProp(id){
  const p=PROPOSALS.find(x=>x.id===id);if(!p)return;
  const pct=Math.min(100,Math.round((p.raised/p.goal)*100));
  const d=Math.max(0,Math.ceil((p.deadline-Date.now())/864e5));
  const isOwner=USER&&p.proposerId===USER.id;
  const canFund=USER&&p.status==='active'&&!isOwner;
  const canW=USER&&isOwner&&p.raised>=p.goal&&!p.withdrawn;
  const myInv=USER?(p.investments?.find(i=>i.id===USER.id)||{kbc:0}).kbc:0;
  const canRef=USER&&p.status==='expired'&&p.raised<p.goal&&myInv>0;
  document.getElementById('modalContent').innerHTML=`
    <span class="m-cat">${p.category}</span>
    <div class="m-title">${esc(p.title)}</div>
    <div class="m-by">Proposed by <code>${esc(p.proposer)}</code></div>
    <div class="m-desc">${esc(p.desc)}</div>
    <div class="m-stats">
      <div class="m-stat"><div class="m-sv">${p.raised.toFixed(0)}</div><div class="m-sl">Averon Coin Raised</div></div>
      <div class="m-stat"><div class="m-sv">${p.goal}</div><div class="m-sl">Averon Coin Goal</div></div>
      <div class="m-stat"><div class="m-sv">${d}d</div><div class="m-sl">Days Left</div></div>
    </div>
    <div style="margin-bottom:20px">
      <div style="font-size:12px;color:var(--txt2);margin-bottom:8px">${pct}% funded · ₹${(p.raised*ECONOMY.price).toFixed(2)} INR value</div>
      <div class="prog-bg"><div class="prog-fill" style="width:${pct}%"></div></div>
    </div>
    <div class="m-actions">
      ${canFund?`<div><div style="font-size:13px;font-weight:700;margin-bottom:8px">💰 Invest Averon Coin</div>
        <div class="fund-row"><input class="f-inp2" type="number" id="fundAmt" placeholder="Amount in Averon Coin" min="1" step="1"/>
        <button class="btn btn-white btn-sm" onclick="fundProp(${id})">Invest</button></div>
        <div class="avail">Your Averon Coin: <strong>${USER?USER.kbc.toFixed(4):0}</strong></div></div>`:''}
      ${myInv>0?`<div style="font-size:13px;color:var(--txt2)">Your investment: <strong>${myInv.toFixed(4)} Averon Coin</strong></div>`:''}
      ${canW?`<button class="btn-danger" onclick="withdrawProp(${id})">Withdraw ${p.raised.toFixed(0)} Averon Coin</button>`:''}
      ${canRef?`<button class="btn-danger" onclick="refundProp(${id})">Claim Refund — ${myInv.toFixed(4)} Averon Coin</button>`:''}
    </div>`;
  document.getElementById('propModal').classList.add('open');
}
function closePropModal(){document.getElementById('propModal').classList.remove('open');}
function closeModal(e){if(e.target.id==='propModal')closePropModal();}

async function fundProp(id){
  if(!USER){showToast('Create account first','error');return;}
  const kbc=parseFloat(document.getElementById('fundAmt')?.value);
  if(!kbc||kbc<=0){showToast('Enter Averon Coin amount','error');return;}
  if(kbc>USER.kbc){showToast('Not enough Averon Coin. Buy more first.','error');return;}
  try{
    const r=await fetch(`/api/proposals/${id}/fund`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:USER.id,kbc})});
    const d=await r.json();if(!r.ok)throw new Error(d.error);
    USER.kbc=d.userKbc;saveUser();
    const idx=PROPOSALS.findIndex(x=>x.id===id);if(idx>=0)PROPOSALS[idx]=d.proposal;
    showToast(`Invested ${kbc} Averon Coin!`,'success');
    closePropModal();updateNav();renderFeatured();updateStats();
  }catch(e){showToast(e.message||'Failed','error');}
}

async function withdrawProp(id){
  try{
    const r=await fetch(`/api/proposals/${id}/withdraw`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:USER.id})});
    const d=await r.json();if(!r.ok)throw new Error(d.error);
    USER.kbc+=d.kbc;saveUser();
    const idx=PROPOSALS.findIndex(x=>x.id===id);if(idx>=0)PROPOSALS[idx].withdrawn=true;
    showToast(`Withdrew ${d.kbc.toFixed(0)} Averon Coin!`,'success');closePropModal();updateNav();
  }catch(e){showToast(e.message,'error');}
}

async function refundProp(id){
  const p=PROPOSALS.find(x=>x.id===id);
  const inv=p&&p.investments?.find(i=>i.id===USER.id);
  if(!inv||inv.kbc<=0){showToast('Nothing to refund','error');return;}
  const rf=inv.kbc;USER.kbc=parseFloat((USER.kbc+rf).toFixed(4));inv.kbc=0;saveUser();
  showToast(`Refunded ${rf.toFixed(4)} Averon Coin`,'success');closePropModal();updateNav();
}

function updateHint(){
  const v=parseFloat(document.getElementById('propGoal').value);
  if(v>0){const u=(v*ECONOMY.price).toFixed(2);document.getElementById('kbcHint').textContent='≈ ₹'+u;document.getElementById('kbcInr').textContent=v+' Averon Coin ≈ ₹'+u+' INR';}
  else{document.getElementById('kbcHint').textContent='';document.getElementById('kbcInr').textContent='set a goal above';}
}

async function submitProposal(){
  if(!USER){showToast('Create account first','error');return;}
  const title=document.getElementById('propTitle').value.trim();
  const desc=document.getElementById('propDesc').value.trim();
  const category=document.getElementById('propCat').value;
  const goal=parseFloat(document.getElementById('propGoal').value);
  const days=parseInt(document.getElementById('propDays').value);
  if(!title||!desc||!goal||!days){showToast('Fill all required fields','error');return;}
  try{
    const r=await fetch('/api/proposals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:USER.id,title,desc,category,goal,days})});
    const d=await r.json();if(!r.ok)throw new Error(d.error);
    PROPOSALS.unshift(d);
    ['propTitle','propDesc','propGoal'].forEach(i=>{document.getElementById(i).value='';});
    document.getElementById('propDays').value='30';
    showToast('Proposal submitted!','success');navigateTo('proposals');updateStats();
  }catch(e){showToast(e.message||'Failed','error');}
}

function renderPortfolio(){
  if(!USER)return;
  const kbcVal=(USER.kbc*ECONOMY.price).toFixed(2);
  let costBasis=0,curVal=0;
  PROPOSALS.forEach(p=>{const inv=p.investments?.find(i=>i.id===USER.id);if(inv&&inv.kbc>0){costBasis+=inv.kbc*(inv.avgPrice||1);curVal+=inv.kbc*ECONOMY.price;}});
  const pnl=curVal-costBasis,pnlPct=costBasis>0?((pnl/costBasis)*100).toFixed(2):'0.00';
  const pc=pnl>=0?'var(--green-profit)':'var(--red)',ps=pnl>=0?'+':'';
  document.getElementById('portSum').innerHTML=`
    <div class="stat-card"><div class="stat-ico">₹</div><div class="stat-val">₹${(USER.inr||0).toFixed(2)}</div><div class="stat-lbl">INR Balance</div></div>
    <div class="stat-card"><div class="stat-ico">◎</div><div class="stat-val">${USER.kbc.toFixed(4)}</div><div class="stat-lbl">Averon Coin Balance</div></div>
    <div class="stat-card"><div class="stat-ico">↑</div><div class="stat-val">₹${kbcVal}</div><div class="stat-lbl">Averon Coin Value</div></div>
    <div class="stat-card" style="border-color:${pc}22"><div class="stat-ico">${pnl>=0?'▲':'▼'}</div><div class="stat-val" style="color:${pc}">${ps}₹${Math.abs(pnl).toFixed(2)}</div><div class="stat-lbl">P&amp;L (${ps}${pnlPct}%)</div></div>`;
  const mp=PROPOSALS.filter(p=>p.proposerId===USER.id);
  document.getElementById('myPropsGrid').innerHTML=mp.length?mp.map(pCard).join(''):empty('No proposals yet','Submit your first idea','◎');
  const mi=PROPOSALS.filter(p=>p.investments?.find(i=>i.id===USER.id&&i.kbc>0));
  document.getElementById('myInvGrid').innerHTML=mi.length?mi.map(pCard).join(''):empty('No investments yet','Browse proposals','◎');
  const mr=PROPOSALS.filter(p=>p.status==='expired'&&p.raised<p.goal&&p.investments?.find(i=>i.id===USER.id&&i.kbc>0));
  document.getElementById('myRefGrid').innerHTML=mr.length?mr.map(pCard).join(''):empty('No refunds available',"You're all clear",'✓');
}

function switchTab(id,btn){
  document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById(id).classList.add('active');btn.classList.add('active');renderPortfolio();
}

function empty(t,s,ic){return`<div class="empty-state"><div class="empty-ico">${ic}</div><div class="empty-title">${t}</div><div class="empty-txt">${s}</div></div>`;}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function timeAgo(ts){const s=Math.floor((Date.now()-ts)/1000);if(s<60)return'just now';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago';}
let _tt;
function showToast(msg,type='info'){
  const t=document.getElementById('toast');
  document.getElementById('toastIco').textContent={success:'✓',error:'✗',info:'◎'}[type]||'◎';
  document.getElementById('toastMsg').textContent=msg;
  t.className=`toast ${type} show`;clearTimeout(_tt);_tt=setTimeout(()=>t.classList.remove('show'),4000);
}
