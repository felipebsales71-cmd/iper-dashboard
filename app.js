const state = { allRecords: [], filtered: [], meta: null, scene: 0, monthlyMode: 'line', version: null, versionTimer: null };
const MONEY = new Intl.NumberFormat('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:2});
const NUM = new Intl.NumberFormat('pt-BR');
const PCT = new Intl.NumberFormat('pt-BR',{style:'percent',minimumFractionDigits:1,maximumFractionDigits:1});
const monthOrder = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const sum = (rows, key) => rows.reduce((a,r)=>a+(Number(r[key])||0),0);
const uniq = (rows,key) => [...new Set(rows.map(r=>r[key]).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'pt-BR'));
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));

async function loadData(options={}){
  const { silent=false, preserveFilters=true } = options;
  const refreshButton = $('#refreshData');
  const savedFilters = preserveFilters ? captureFilterState() : null;

  if(refreshButton && !silent){
    refreshButton.disabled = true;
    refreshButton.textContent = 'Verificando…';
  }

  let payload;
  let live = false;
  try {
    const response = await fetch('/api/dashboard',{
      headers:{ Accept:'application/json' },
      cache:'no-cache'
    });
    if(!response.ok){
      const diagnostic = await response.json().catch(()=>({}));
      throw new Error(diagnostic.details || diagnostic.error || `HTTP ${response.status}`);
    }
    payload = await response.json();
    live = payload?.meta?.connection === 'live' || payload?.meta?.isDemo === false;
  } catch (error) {
    console.warn('Armazenamento ao vivo indisponível; usando contingência local.', error);
    let response = await fetch('data/dashboard.json');
    if(!response.ok) response = await fetch('data/demo.json');
    payload = await response.json();
    payload.meta = {...(payload.meta || {}), connection:'fallback'};
  }

  state.meta = payload.meta || {};
  state.version = state.meta.version || state.meta.updatedAt || null;
  state.allRecords = Array.isArray(payload.records) ? payload.records : [];

  populateFilters();
  if(savedFilters) restoreFilterState(savedFilters);
  applyFilters();
  updateStoryKpis();

  const parsedDate = state.meta.updatedAt ? new Date(state.meta.updatedAt) : null;
  const when = parsedDate && !Number.isNaN(parsedDate.getTime())
    ? parsedDate.toLocaleString('pt-BR')
    : 'não informada';
  const status = $('#dataStatus');
  status.classList.toggle('is-live', live);
  status.classList.toggle('is-fallback', !live);
  status.textContent = live
    ? `● Dados sincronizados com a planilha · última alteração: ${when}`
    : `● Modo de contingência local · referência: ${when}`;

  if(refreshButton && !silent){
    refreshButton.disabled = false;
    refreshButton.textContent = 'Verificar atualização';
  }
}

function captureFilterState(){
  const ids=['searchInput','yearFilter','monthFilter','entityFilter','agencyFilter','fundFilter','categoryFilter','statusFilter','startDate','endDate'];
  return Object.fromEntries(ids.map(id=>[id,$('#'+id)?.value ?? '']));
}

function restoreFilterState(values){
  Object.entries(values || {}).forEach(([id,value])=>{
    const element=$('#'+id);
    if(!element) return;
    if(element.tagName==='SELECT' && value && ![...element.options].some(option=>option.value===value)) return;
    element.value=value;
  });
}

async function checkForDashboardUpdate(){
  if(document.hidden) return;
  try {
    const response=await fetch('/api/dashboard-version',{cache:'no-store',headers:{Accept:'application/json'}});
    if(!response.ok) return;
    const versionInfo=await response.json();
    if(versionInfo?.ready && versionInfo.version && state.version && versionInfo.version!==state.version){
      await loadData({silent:true,preserveFilters:true});
    }
  } catch (error) {
    console.debug('Verificação de versão indisponível.', error);
  }
}

function startVersionWatcher(){
  if(state.versionTimer) clearInterval(state.versionTimer);
  state.versionTimer=setInterval(checkForDashboardUpdate,15000);
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden) checkForDashboardUpdate();
  });
}

function populateFilters(){
  const mapping = [
    ['yearFilter','year'],['monthFilter','month'],['entityFilter','entity'],['agencyFilter','agency'],['fundFilter','fund'],
    ['categoryFilter','category'],['statusFilter','status']
  ];
  for(const [id,key] of mapping){
    const select = $('#'+id); const first = select.options[0]; select.innerHTML=''; select.append(first);
    let values = uniq(state.allRecords,key);
    if(key==='month') values.sort((a,b)=>monthKey(a)-monthKey(b));
    values.forEach(value=>select.add(new Option(value,value)));
  }
}

function monthKey(label=''){
  const [m,y] = label.split('/'); return Number(y||0)*12 + monthOrder.indexOf(m);
}

function applyFilters(){
  const term = $('#searchInput').value.trim().toLocaleLowerCase('pt-BR');
  const fields = {
    year:$('#yearFilter').value, month:$('#monthFilter').value, entity:$('#entityFilter').value,
    agency:$('#agencyFilter').value, fund:$('#fundFilter').value, category:$('#categoryFilter').value, status:$('#statusFilter').value
  };
  const start = $('#startDate').value ? new Date($('#startDate').value+'T00:00:00') : null;
  const end = $('#endDate').value ? new Date($('#endDate').value+'T23:59:59') : null;
  state.filtered = state.allRecords.filter(row=>{
    for(const [key,value] of Object.entries(fields)) if(value && String(row[key])!==value) return false;
    const date = row.date ? new Date(row.date+'T12:00:00') : null;
    if(start && (!date || date<start)) return false;
    if(end && (!date || date>end)) return false;
    if(term){
      const haystack = Object.values(row).join(' ').toLocaleLowerCase('pt-BR');
      if(!haystack.includes(term)) return false;
    }
    return true;
  });
  renderKpis(); renderCharts(); renderTable();
}

function renderKpis(){
  const revenue = sum(state.filtered,'revenue');
  const entities = new Set(state.filtered.map(r=>r.agency).filter(Boolean)).size;
  const monthly = aggregate(state.filtered,'month','revenue').sort((a,b)=>monthKey(a.label)-monthKey(b.label));
  const previous = monthly.at(-2)?.value || 0; const latest = monthly.at(-1)?.value || 0;
  const growth = previous ? (latest-previous)/previous : 0;
  $('#revenueKpi').textContent=MONEY.format(revenue);
  $('#entitiesKpi').textContent=NUM.format(entities);
  $('#competencesKpi').textContent=NUM.format(monthly.length);
  $('#revenueDelta').textContent = monthly.length>1 ? `${growth>=0?'▲':'▼'} ${PCT.format(Math.abs(growth))} na última competência` : 'Sem comparação disponível';
}


function updateStoryKpis(){
  const revenue=sum(state.allRecords,'revenue'); const entities=new Set(state.allRecords.map(r=>r.agency).filter(Boolean)).size;
  const monthly=aggregate(state.allRecords,'month','revenue').sort((a,b)=>monthKey(a.label)-monthKey(b.label));
  const prev=monthly.at(-2)?.value||0, last=monthly.at(-1)?.value||0;
  $$('[data-kpi="records"]').forEach(el=>el.textContent=NUM.format(state.allRecords.length));
  $$('[data-kpi="revenue"]').forEach(el=>el.textContent=MONEY.format(revenue));
  $$('[data-kpi="entities"]').forEach(el=>el.textContent=NUM.format(entities));
  $$('[data-kpi="competences"]').forEach(el=>el.textContent=NUM.format(monthly.length));
}

function aggregate(rows,key,valueKey){
  const map=new Map(); rows.forEach(r=>map.set(r[key]||'Não informado',(map.get(r[key]||'Não informado')||0)+(Number(r[valueKey])||0)));
  return [...map].map(([label,value])=>({label,value}));
}
function countBy(rows,key){
  const map=new Map(); rows.forEach(r=>map.set(r[key]||'Não informado',(map.get(r[key]||'Não informado')||0)+1));
  return [...map].map(([label,value])=>({label,value}));
}

function renderCharts(){
  const monthlyData = aggregate(state.filtered,'month','revenue').sort((a,b)=>monthKey(a.label)-monthKey(b.label));
  renderMonthlyChart($('#monthlyChart'), monthlyData, $('#monthFilter').value || '');
  renderAgencyChart($('#agencyChart'),aggregate(state.filtered,'agency','revenue').sort((a,b)=>b.value-a.value));
  renderFundChart($('#statusChart'),aggregate(state.filtered,'fund','revenue').sort((a,b)=>b.value-a.value));
}



function emptyChart(el){ el.innerHTML='<div class="chart-empty">Nenhum dado encontrado para os filtros selecionados.</div>'; }
function renderMonthlyChart(el,data,activeMonth=''){
  if(!data.length){emptyChart(el);return}
  const w=900,h=460,p={l:76,r:22,t:28,b:78};
  const max=Math.max(...data.map(d=>d.value),1);
  const slot=(w-p.l-p.r)/Math.max(data.length,1);
  const bw=Math.max(40,slot*.55);
  const y=v=>h-p.b-(v/max)*(h-p.t-p.b);
  const grid=[0,.25,.5,.75,1].map(t=>{const yy=y(max*t);return `<line class="grid-line" x1="${p.l}" x2="${w-p.r}" y1="${yy}" y2="${yy}"/><text class="axis-label" x="${p.l-12}" y="${yy+4}" text-anchor="end">${compact(max*t)}</text>`}).join('');
  const bars=data.map((d,i)=>{
    const bh=(d.value/max)*(h-p.t-p.b); const xx=p.l+i*slot+(slot-bw)/2, yy=h-p.b-bh;
    const active = activeMonth && activeMonth===d.label;
    return `<g class="month-group ${active?'is-active':''}"><rect class="bar monthly-bar ${active?'is-active':''}" x="${xx}" y="${yy}" width="${bw}" height="${bh}" rx="16" ry="16" data-month="${escapeHtml(d.label)}" data-tip="${escapeHtml(d.label)} · ${escapeHtml(MONEY.format(d.value))}"/><text class="value-label" x="${xx+bw/2}" y="${yy-10}" text-anchor="middle">${escapeHtml(compact(d.value))}</text><text class="axis-label month-label" x="${xx+bw/2}" y="${h-22}" text-anchor="middle">${escapeHtml(d.label)}</text></g>`;
  }).join('');
  el.innerHTML=`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${grid}${bars}</svg>`;
  bindTips(el); bindMonthFilter(el);
}

function renderAgencyChart(el,data){
  if(!data.length){emptyChart(el);return}
  const visible = data; // mostra todos os órgãos
  const rowH = 38;
  const w = 760;
  const h = Math.max(280, 36 + visible.length * rowH);
  const p = {l: 150, r: 26, t: 12, b: 12};
  const max = Math.max(...visible.map(d=>d.value),1);
  const barArea = w - p.l - p.r;
  const rows = visible.map((d,i)=>{
    const y = p.t + i*rowH;
    const bw = Math.max(4, (d.value/max)*barArea);
    const label = escapeHtml(d.label);
    const shortValue = escapeHtml(compact(d.value));
    const fullValue = escapeHtml(MONEY.format(d.value));
    return `<g><text class="agency-label" x="${p.l-12}" y="${y+20}" text-anchor="end">${label}</text><rect class="agency-track" x="${p.l}" y="${y+6}" width="${barArea}" height="20" rx="10"></rect><rect class="agency-bar" x="${p.l}" y="${y+6}" width="${bw}" height="20" rx="10" data-tip="${label} · ${fullValue}"></rect><text class="agency-value" x="${Math.min(p.l+bw+10,w-p.r)}" y="${y+20}">${shortValue}</text></g>`;
  }).join('');
  el.innerHTML = `<div class="agency-scroll"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${rows}</svg></div>`;
  bindTips(el);
}

function renderColumnChart(el,data,filterable=false){
  if(!data.length){emptyChart(el);return} const w=900,h=520,p={l:84,r:28,t:30,b:58};
  const max=Math.max(...data.map(d=>d.value),1); const slot=(w-p.l-p.r)/Math.max(data.length,1); const bw=Math.max(34,slot*.58);
  const y=v=>h-p.b-(v/max)*(h-p.t-p.b);
  const grid=[0,.25,.5,.75,1].map(t=>{const yy=y(max*t);return `<line class="grid-line" x1="${p.l}" x2="${w-p.r}" y1="${yy}" y2="${yy}"/><text class="axis-label" x="${p.l-12}" y="${yy+4}" text-anchor="end">${compact(max*t)}</text>`}).join('');
  const bars=data.map((d,i)=>{const bh=(d.value/max)*(h-p.t-p.b); const xx=p.l+i*slot+(slot-bw)/2, yy=h-p.b-bh; return `<rect class="bar monthly-bar" x="${xx}" y="${yy}" width="${bw}" height="${bh}" data-month="${escapeHtml(d.label)}" data-tip="${escapeHtml(d.label)} · ${escapeHtml(MONEY.format(d.value))}"/><text class="axis-label" x="${xx+bw/2}" y="${h-20}" text-anchor="middle">${escapeHtml(d.label)}</text>`}).join('');
  el.innerHTML=`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${grid}${bars}</svg>`; bindTips(el); if(filterable) bindMonthFilter(el);
}
function renderFundChart(el,data){
  if(!data.length){emptyChart(el);return}
  const total=data.reduce((a,d)=>a+d.value,0);
  const colors=['#13843d','#f4c843','#129ed8','#1b4f82','#7b67b9'];
  let offset = 0;
  const segments = data.map((d,i)=>{
    const pct = total ? (d.value/total)*100 : 0;
    const seg = `<span style="width:${pct}%;background:${colors[i%colors.length]}"></span>`;
    offset += pct;
    return seg;
  }).join('');
  const items = data.map((d,i)=>{
    const pct = total ? (d.value/total) : 0;
    return `<div class="fund-row-card"><div class="fund-row-left"><i style="background:${colors[i%colors.length]}"></i><div><strong>${escapeHtml(d.label)}</strong><small>${PCT.format(pct)} do total</small></div></div><div class="fund-row-right">${escapeHtml(MONEY.format(d.value))}</div></div>`;
  }).join('');
  el.innerHTML = `<div class="fund-clean"><div class="fund-total-card"><span>Total arrecadado</span><strong>${escapeHtml(MONEY.format(total))}</strong></div><div class="fund-segment-bar">${segments}</div><div class="fund-rows">${items}</div></div>`;
}


function compact(v){return new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(v)}
function shorten(s,n){return String(s).length>n?String(s).slice(0,n-1)+'…':s}
function bindTips(root){
  $$('[data-tip]',root).forEach(node=>{node.addEventListener('pointermove',e=>showTip(e,node.dataset.tip));node.addEventListener('pointerleave',hideTip);node.addEventListener('focus',e=>showTip(e,node.dataset.tip));node.setAttribute('tabindex','0')});
}
function showTip(e,text){const tip=$('#tooltip');tip.textContent=text;tip.style.display='block';const x=e.clientX??innerWidth/2,y=e.clientY??innerHeight/2;tip.style.left=Math.min(x+14,innerWidth-tip.offsetWidth-12)+'px';tip.style.top=Math.min(y+14,innerHeight-tip.offsetHeight-12)+'px'}
function hideTip(){$('#tooltip').style.display='none'}
function bindMonthFilter(root){
  $$('[data-month]',root).forEach(node=>{
    node.style.cursor='pointer';
    node.setAttribute('tabindex','0');
    node.setAttribute('role','button');
    node.addEventListener('click',()=>{ $('#monthFilter').value=node.dataset.month || ''; applyFilters(); });
    node.addEventListener('keydown',e=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); node.click(); } });
  });
}

function renderTable(){
  $('#resultCount').textContent=`${NUM.format(state.filtered.length)} registro(s) encontrado(s)`;
  $('#dataTable').innerHTML=state.filtered.slice(0,250).map(r=>`<tr>
    <td>${escapeHtml(r.month)}</td><td>${escapeHtml(r.entity)}</td><td>${escapeHtml(r.agency)}</td><td>${escapeHtml(r.category)}</td>
    <td><span class="status-pill ${statusClass(r.status)}">${escapeHtml(r.status)}</span></td>
    <td class="optional-column">${escapeHtml(r.process || '—')}</td>
    <td>${MONEY.format(Number(r.revenue)||0)}</td></tr>`).join('') || '<tr><td colspan="7">Nenhum registro encontrado.</td></tr>';
}

function statusClass(status=''){const s=status.toLowerCase();return s.includes('atras')?'overdue':s.includes('acomp')||s.includes('pend')?'pending':''}

function initStory(){
  const story=$('#narrativa'), panels=$$('.story-panel'), progress=$('#storyProgress'); let ticking=false;
  function update(){
    ticking=false; const rect=story.getBoundingClientRect(); const distance=story.offsetHeight-innerHeight; const p=Math.min(1,Math.max(0,-rect.top/Math.max(distance,1))); progress.style.height=(p*100)+'%';
    const exact=p*(panels.length-1), current=Math.min(panels.length-1,Math.floor(exact+.5)); state.scene=current;
    panels.forEach((panel,i)=>{const delta=Math.abs(exact-i);const opacity=Math.max(0,1-delta*1.35);panel.style.opacity=opacity;panel.style.transform=innerWidth<=720?`translateY(${(i-exact)*38}px)`:`translateY(calc(-50% + ${(i-exact)*52}px))`;panel.classList.toggle('is-active',i===current)});
    const seal=$('.state-seal'), chart=$('#chartPreview'), map=$('#entityMap'), ring=$('#debtRing'), orbits=$$('.data-orbit');
    seal.style.opacity=String(.46+Math.max(0,1-Math.abs(exact-0)*.55)*.38); seal.style.transform=`translate(-50%,-50%) scale(${.70+Math.min(exact,1)*.18}) rotate(${exact*2}deg)`;
    orbits.forEach((o,i)=>o.style.transform=`rotate(${(i?38:-12)+exact*(i?17:-11)}deg) scale(${.82+Math.min(exact,1)*.22})`);
    setVisual(chart,exact,3,.9,'translateY'); setVisual(map,exact,4,.9,'scale'); setVisual(ring,exact,5,.9,'scale');
    $('#topbar').classList.toggle('is-solid',p>.97 || scrollY>innerHeight*.25);
  }
  function setVisual(node,exact,target,spread,type){const o=Math.max(0,1-Math.abs(exact-target)/spread);node.style.opacity=o;node.style.transform=type==='scale'?`scale(${.72+o*.28})`:`translateY(${(1-o)*55}px)`}
  addEventListener('scroll',()=>{if(!ticking){requestAnimationFrame(update);ticking=true}},{passive:true}); addEventListener('resize',update); update();
}

function initEvents(){
  $('#filterForm').addEventListener('input',applyFilters); $('#filterForm').addEventListener('change',applyFilters);
  $('#resetFilters').addEventListener('click',()=>{$('#filterForm').reset();applyFilters()});
  $('#refreshData')?.addEventListener('click',()=>loadData({silent:false,preserveFilters:true}));
  $('#toggleColumns').addEventListener('click',e=>{const on=$('.table-wrap').classList.toggle('show-optional');e.currentTarget.textContent=on?'Ocultar processo':'Exibir processo'});
  $('#clearMonthFocus')?.addEventListener('click',()=>{ $('#monthFilter').value=''; applyFilters(); });
  const dialog=$('#adminDialog'); $$('[data-open-admin]').forEach(btn=>btn.addEventListener('click',()=>dialog.showModal()));
  dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});
}

initStory(); initEvents(); loadData({preserveFilters:false}).then(startVersionWatcher);
