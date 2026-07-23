const state = {
  allRecords: [],
  meta: {},
  version: null,
  versionTimer: null,
  heroScene: 0,
  hiddenFunds: new Set(),
  serverMode: 'quantity',
  agencyScope: 'annual',
  agencyLimit: '10',
  agencySearch: '',
  tablePage: 1,
  tablePageSize: 25,
  tableSort: { key: 'monthKey', direction: 'desc' },
  lastScopes: null
};

const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const FUND_ORDER = ['Fundo Previdenciário','Fundo Financeiro','Fundo Militar'];
const FUND_COLORS = {
  'Fundo Previdenciário': '#27864b',
  'Fundo Financeiro': '#e8ad2f',
  'Fundo Militar': '#218dcc'
};
const SERVER_TYPES = ['Ativo','Aposentado','Pensionista'];
const MONEY = new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const INTEGER = new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0});
const PERCENT = new Intl.NumberFormat('pt-BR',{style:'percent',minimumFractionDigits:1,maximumFractionDigits:1});
const DATE_TIME = new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'medium'});

const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const sum = (rows,key) => rows.reduce((total,row)=>total+(Number(row[key])||0),0);
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[char]));

function monthKey(label=''){
  const [month,year] = String(label).split('/');
  return Number(year||0)*12 + MONTHS.indexOf(month);
}
function fundClass(name=''){
  const value = String(name).toLocaleLowerCase('pt-BR');
  if(value.includes('previd')) return 'previdentiary';
  if(value.includes('finance')) return 'financial';
  if(value.includes('militar')) return 'military';
  return '';
}
function inferServerType(row){
  const explicit = String(row.serverType || row.type || '').trim();
  if(explicit){
    const normalized = explicit.toLocaleLowerCase('pt-BR');
    if(normalized.includes('aposent')) return 'Aposentado';
    if(normalized.includes('pension')) return 'Pensionista';
    if(normalized.includes('ativ')) return 'Ativo';
  }
  const payroll = String(row.payroll || '').toLocaleLowerCase('pt-BR');
  if(payroll.includes('aposent')) return 'Aposentado';
  if(payroll.includes('pension')) return 'Pensionista';
  return 'Ativo';
}
function uniqueValues(rows,key){
  return [...new Set(rows.map(row=>row[key]).filter(Boolean))]
    .sort((a,b)=>String(a).localeCompare(String(b),'pt-BR'));
}
function compact(value){
  const number = Number(value)||0;
  const abs = Math.abs(number);
  if(abs >= 1_000_000_000) return `${(number/1_000_000_000).toLocaleString('pt-BR',{maximumFractionDigits:1})} bi`;
  if(abs >= 1_000_000) return `${(number/1_000_000).toLocaleString('pt-BR',{maximumFractionDigits:1})} mi`;
  if(abs >= 1_000) return `${(number/1_000).toLocaleString('pt-BR',{maximumFractionDigits:1})} mil`;
  return number.toLocaleString('pt-BR',{maximumFractionDigits:0});
}
function parseDate(value){
  if(!value) return null;
  const date = new Date(String(value).length===10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function aggregate(rows,key,valueKey='revenue'){
  const map = new Map();
  rows.forEach(row=>{
    const label = row[key] || 'Não informado';
    map.set(label,(map.get(label)||0)+(Number(row[valueKey])||0));
  });
  return [...map].map(([label,value])=>({label,value}));
}
function safeNumber(value){ return Number(value)||0; }

async function loadData({preserveFilters=false,announce=false}={}){
  const saved = preserveFilters ? captureFilters() : null;
  let payload;
  let live = false;
  try{
    const response = await fetch(`/api/dashboard?_=${Date.now()}`,{
      cache:'no-store',
      headers:{Accept:'application/json','Cache-Control':'no-cache'}
    });
    if(!response.ok){
      const diagnostic = await response.json().catch(()=>({}));
      throw new Error(diagnostic.details || diagnostic.error || `HTTP ${response.status}`);
    }
    payload = await response.json();
    live = payload?.meta?.connection === 'live' || payload?.meta?.updateMode === 'webhook-r2';
  }catch(error){
    console.warn('API indisponível; usando base local.',error);
    let response = await fetch('data/dashboard.json',{cache:'no-store'});
    if(!response.ok) response = await fetch('data/demo.json',{cache:'no-store'});
    payload = await response.json();
    payload.meta = {...(payload.meta||{}),connection:'fallback'};
  }

  state.meta = payload.meta || {};
  state.version = state.meta.version || state.meta.updatedAt || null;
  state.allRecords = (Array.isArray(payload.records) ? payload.records : []).map((row,index)=>{
    const serverType = inferServerType(row);
    const revenue = Number.isFinite(Number(row.revenue))
      ? Number(row.revenue)
      : safeNumber(row.patronal)+safeNumber(row.insured)+safeNumber(row.compensation);
    return {
      ...row,
      _id:index,
      year:String(row.year||''),
      month:String(row.month||''),
      monthKey:monthKey(row.month),
      serverType,
      revenue,
      patronal:safeNumber(row.patronal),
      insured:safeNumber(row.insured),
      compensation:safeNumber(row.compensation),
      servers:safeNumber(row.servers)
    };
  });

  populateFilters();
  setDefaultPeriod();
  if(saved) restoreFilters(saved);
  syncMonthOptions(true);
  renderAll();
  updateConnectionStatus(live);
  updateStoryMetrics();
  startVersionPolling();
  if(announce) showToast('Dados do dashboard atualizados.');
}

function populateSelect(select,key,defaultLabel){
  const current = select.value;
  select.innerHTML = `<option value="">${escapeHtml(defaultLabel)}</option>`;
  uniqueValues(state.allRecords,key).forEach(value=>select.add(new Option(value,value)));
  if([...select.options].some(option=>option.value===current)) select.value=current;
}
function populateFilters(){
  const year = $('#yearFilter');
  const currentYear = year.value;
  year.innerHTML = '';
  uniqueValues(state.allRecords,'year').sort((a,b)=>Number(b)-Number(a)).forEach(value=>year.add(new Option(value,value)));
  if(currentYear && [...year.options].some(option=>option.value===currentYear)) year.value=currentYear;

  const fund = $('#fundFilter');
  const currentFund = fund.value;
  fund.innerHTML='<option value="">Consolidado</option>';
  FUND_ORDER.filter(name=>state.allRecords.some(row=>row.fund===name)).forEach(value=>fund.add(new Option(value,value)));
  uniqueValues(state.allRecords,'fund').filter(value=>!FUND_ORDER.includes(value)).forEach(value=>fund.add(new Option(value,value)));
  if([...fund.options].some(option=>option.value===currentFund)) fund.value=currentFund;

  populateSelect($('#entityFilter'),'entity','Todos');
  populateSelect($('#agencyFilter'),'agency','Todos');
  populateSelect($('#categoryFilter'),'category','Todas');
  populateSelect($('#payrollFilter'),'payroll','Todas');

  const serverType = $('#serverTypeFilter');
  const currentType = serverType.value;
  serverType.innerHTML='<option value="">Todos</option>';
  SERVER_TYPES.forEach(value=>serverType.add(new Option(value,value)));
  if([...serverType.options].some(option=>option.value===currentType)) serverType.value=currentType;
}
function setDefaultPeriod(){
  if(!$('#yearFilter').value){
    const latestYear = uniqueValues(state.allRecords,'year').sort((a,b)=>Number(b)-Number(a))[0] || '';
    $('#yearFilter').value = latestYear;
  }
}
function syncMonthOptions(preserve=false){
  const select = $('#monthFilter');
  const current = preserve ? select.value : '';
  const year = $('#yearFilter').value;
  const months = uniqueValues(state.allRecords.filter(row=>!year || row.year===year),'month')
    .sort((a,b)=>monthKey(a)-monthKey(b));
  select.innerHTML='';
  months.forEach(value=>select.add(new Option(value.split('/')[0],value)));
  if(current && months.includes(current)) select.value=current;
  else select.value=months.at(-1) || '';
}
function captureFilters(){
  const ids=['yearFilter','monthFilter','fundFilter','entityFilter','agencyFilter','categoryFilter','payrollFilter','serverTypeFilter','searchInput','startDate','endDate'];
  return Object.fromEntries(ids.map(id=>[id,$(`#${id}`)?.value||'']));
}
function restoreFilters(values){
  Object.entries(values||{}).forEach(([id,value])=>{
    const element=$(`#${id}`);
    if(!element) return;
    if(element.tagName==='SELECT' && ![...element.options].some(option=>option.value===value)) return;
    element.value=value;
  });
}

function getScopes(){
  const filters = captureFilters();
  const selectedYear = filters.yearFilter;
  const selectedMonth = filters.monthFilter;
  const selectedMonthKey = monthKey(selectedMonth);
  const startDate = parseDate(filters.startDate);
  const endDate = filters.endDate ? new Date(`${filters.endDate}T23:59:59`) : null;
  const term = filters.searchInput.trim().toLocaleLowerCase('pt-BR');

  const filtered = state.allRecords.filter(row=>{
    if(selectedYear && row.year!==selectedYear) return false;
    if(filters.fundFilter && row.fund!==filters.fundFilter) return false;
    if(filters.entityFilter && row.entity!==filters.entityFilter) return false;
    if(filters.agencyFilter && row.agency!==filters.agencyFilter) return false;
    if(filters.categoryFilter && row.category!==filters.categoryFilter) return false;
    if(filters.payrollFilter && row.payroll!==filters.payrollFilter) return false;
    if(filters.serverTypeFilter && row.serverType!==filters.serverTypeFilter) return false;
    const date = parseDate(row.date);
    if(startDate && (!date || date<startDate)) return false;
    if(endDate && (!date || date>endDate)) return false;
    if(term){
      const haystack=[row.agency,row.entity,row.fund,row.payroll,row.category,row.serverType,row.month].join(' ').toLocaleLowerCase('pt-BR');
      if(!haystack.includes(term)) return false;
    }
    return true;
  });

  const annualRows = filtered.filter(row=>!selectedMonth || row.monthKey<=selectedMonthKey);
  const competenceRows = filtered.filter(row=>!selectedMonth || row.month===selectedMonth);
  const result={filters,filtered,annualRows,competenceRows,selectedYear,selectedMonth,selectedMonthKey};
  state.lastScopes=result;
  return result;
}

function renderAll(){
  const scopes = getScopes();
  renderActiveChips(scopes.filters);
  renderKpis(scopes);
  renderFundCompetence(scopes);
  renderFundAccumulated(scopes);
  renderServers(scopes);
  renderAgencyRanking(scopes);
  renderTable(scopes);
}

function renderKpis(scopes){
  const annualRevenue=sum(scopes.annualRows,'revenue');
  const competenceRevenue=sum(scopes.competenceRows,'revenue');
  const servers=sum(scopes.competenceRows,'servers');
  const previousMonthKey=scopes.selectedMonthKey-1;
  const previousRows=scopes.filtered.filter(row=>row.monthKey===previousMonthKey);
  const previousRevenue=sum(previousRows,'revenue');
  const delta=previousRevenue ? (competenceRevenue-previousRevenue)/previousRevenue : null;

  $('#annualRevenueKpi').textContent=MONEY.format(annualRevenue);
  $('#competenceRevenueKpi').textContent=MONEY.format(competenceRevenue);
  $('#serversKpi').textContent=INTEGER.format(servers);
  $('#annualRevenueNote').textContent=`${INTEGER.format(scopes.annualRows.length)} registros consolidados`;
  $('#competenceRevenueNote').textContent=delta===null ? 'Sem competência anterior para comparação' : `${delta>=0?'▲':'▼'} ${PERCENT.format(Math.abs(delta))} frente à competência anterior`;
  $('#serversNote').textContent=`${new Set(scopes.competenceRows.map(row=>row.agency).filter(Boolean)).size} órgãos na seleção`;
  const monthName=scopes.selectedMonth ? scopes.selectedMonth.replace('/',' de ') : '—';
  $('#annualPeriodLabel').textContent=scopes.selectedMonth ? `Jan a ${scopes.selectedMonth}` : scopes.selectedYear;
  $('#competenceLabel').textContent=monthName;
  $('#serversPeriodLabel').textContent=monthName;
  $('#fundCompetenceBadge').textContent=scopes.selectedMonth || '—';
}

function renderFundCompetence(scopes){
  const element=$('#fundCompetenceChart');
  const funds=(scopes.filters.fundFilter ? [scopes.filters.fundFilter] : FUND_ORDER)
    .filter(fund=>state.allRecords.some(row=>row.fund===fund));
  const data=funds.map(fund=>({fund,value:sum(scopes.competenceRows.filter(row=>row.fund===fund),'revenue')}));
  if(!data.length || data.every(item=>item.value===0)) return renderEmpty(element,'Não há arrecadação para a competência selecionada.');

  const w=760,h=250,p={l:64,r:22,t:28,b:58};
  const max=Math.max(...data.map(item=>item.value),1);
  const slot=(w-p.l-p.r)/data.length;
  const barWidth=Math.min(100,slot*.46);
  const y=value=>h-p.b-(value/max)*(h-p.t-p.b);
  const grid=[0,.25,.5,.75,1].map(t=>{
    const yy=y(max*t);
    return `<line class="grid-line" x1="${p.l}" x2="${w-p.r}" y1="${yy}" y2="${yy}"/><text class="axis-label" x="${p.l-10}" y="${yy+4}" text-anchor="end">${escapeHtml(compact(max*t))}</text>`;
  }).join('');
  const bars=data.map((item,index)=>{
    const x=p.l+slot*index+(slot-barWidth)/2;
    const yy=y(item.value);
    const height=Math.max(2,h-p.b-yy);
    const klass=fundClass(item.fund);
    return `<g><rect class="fund-column-track" x="${x}" y="${p.t}" width="${barWidth}" height="${h-p.b-p.t}" rx="10"/><rect tabindex="0" role="button" aria-label="Filtrar ${escapeHtml(item.fund)}" class="fund-column ${klass}" data-fund="${escapeHtml(item.fund)}" data-tip="${escapeHtml(item.fund)} · ${escapeHtml(MONEY.format(item.value))}" x="${x}" y="${yy}" width="${barWidth}" height="${height}" rx="10"/><text class="value-label" x="${x+barWidth/2}" y="${Math.max(17,yy-9)}" text-anchor="middle">${escapeHtml(compact(item.value))}</text><text class="axis-label" x="${x+barWidth/2}" y="${h-27}" text-anchor="middle"><tspan x="${x+barWidth/2}" dy="0">${escapeHtml(item.fund.replace('Fundo ',''))}</tspan></text></g>`;
  }).join('');
  element.innerHTML=`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${grid}${bars}</svg>`;
  bindTooltips(element);
  $$('[data-fund]',element).forEach(node=>{
    node.addEventListener('click',()=>{$('#fundFilter').value=node.dataset.fund;state.tablePage=1;renderAll();});
    node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();node.click();}});
  });
}

function renderFundAccumulated(scopes){
  const chart=$('#fundAccumulatedChart');
  const legend=$('#fundLineLegend');
  const months=uniqueValues(scopes.filtered,'month').filter(month=>monthKey(month)<=scopes.selectedMonthKey).sort((a,b)=>monthKey(a)-monthKey(b));
  const funds=(scopes.filters.fundFilter ? [scopes.filters.fundFilter] : FUND_ORDER).filter(fund=>state.allRecords.some(row=>row.fund===fund));
  if(!months.length || !funds.length) return renderEmpty(chart,'Não há dados acumulados para o período selecionado.');

  legend.innerHTML=funds.map(fund=>`<button class="legend-button ${state.hiddenFunds.has(fund)?'is-hidden':''}" type="button" data-toggle-fund="${escapeHtml(fund)}"><i style="background:${FUND_COLORS[fund]||'#58778c'}"></i>${escapeHtml(fund.replace('Fundo ',''))}</button>`).join('');
  $$('[data-toggle-fund]',legend).forEach(button=>button.addEventListener('click',()=>{
    const fund=button.dataset.toggleFund;
    if(state.hiddenFunds.has(fund)) state.hiddenFunds.delete(fund); else state.hiddenFunds.add(fund);
    renderFundAccumulated(getScopes());
  }));

  const series=funds.map(fund=>{
    let running=0;
    return {fund,values:months.map(month=>{
      running+=sum(scopes.filtered.filter(row=>row.fund===fund && row.month===month),'revenue');
      return {month,value:running};
    })};
  }).filter(item=>!state.hiddenFunds.has(item.fund));
  if(!series.length) return renderEmpty(chart,'Todos os fundos estão ocultos. Use “Exibir todos”.');

  const w=760,h=300,p={l:70,r:24,t:24,b:56};
  const max=Math.max(...series.flatMap(item=>item.values.map(point=>point.value)),1);
  const x=index=>p.l+index*((w-p.l-p.r)/Math.max(months.length-1,1));
  const y=value=>h-p.b-(value/max)*(h-p.t-p.b);
  const grid=[0,.25,.5,.75,1].map(t=>{
    const yy=y(max*t);
    return `<line class="grid-line" x1="${p.l}" x2="${w-p.r}" y1="${yy}" y2="${yy}"/><text class="axis-label" x="${p.l-10}" y="${yy+4}" text-anchor="end">${escapeHtml(compact(max*t))}</text>`;
  }).join('');
  const xLabels=months.map((month,index)=>`<text class="axis-label" x="${x(index)}" y="${h-22}" text-anchor="middle">${escapeHtml(month.split('/')[0])}</text>`).join('');
  const lines=series.map(item=>{
    const points=item.values.map((point,index)=>[x(index),y(point.value)]);
    const path=points.map((point,index)=>`${index?'L':'M'}${point[0]},${point[1]}`).join(' ');
    const color=FUND_COLORS[item.fund]||'#58778c';
    const circles=item.values.map((point,index)=>`<circle tabindex="0" role="button" aria-label="${escapeHtml(item.fund)} em ${escapeHtml(point.month)}" class="fund-point" data-month="${escapeHtml(point.month)}" data-tip="${escapeHtml(item.fund)} · ${escapeHtml(point.month)} · ${escapeHtml(MONEY.format(point.value))}" cx="${x(index)}" cy="${y(point.value)}" r="5" fill="${color}"/>`).join('');
    return `<path class="fund-line" d="${path}" stroke="${color}"/>${circles}`;
  }).join('');
  chart.innerHTML=`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${grid}${lines}${xLabels}</svg>`;
  bindTooltips(chart);
  $$('[data-month]',chart).forEach(node=>{
    node.addEventListener('click',()=>{$('#monthFilter').value=node.dataset.month;state.tablePage=1;renderAll();});
    node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();node.click();}});
  });
}

function renderServers(scopes){
  const container=$('#serverChart');
  const summary=$('#serverSummary');
  const funds=(scopes.filters.fundFilter ? [scopes.filters.fundFilter] : FUND_ORDER).filter(fund=>state.allRecords.some(row=>row.fund===fund));
  const matrix=funds.map(fund=>{
    const rows=scopes.competenceRows.filter(row=>row.fund===fund);
    const values=SERVER_TYPES.map(type=>({type,value:sum(rows.filter(row=>row.serverType===type),'servers')}));
    return {fund,values,total:values.reduce((total,item)=>total+item.value,0)};
  });
  const max=Math.max(...matrix.flatMap(group=>group.values.map(item=>item.value)),1);
  if(!matrix.length || matrix.every(group=>group.total===0)){
    container.innerHTML='<div class="chart-empty">Não há quantitativo de servidores para a seleção.</div>';
    summary.innerHTML='';
    return;
  }
  container.innerHTML=matrix.map(group=>`<section class="server-fund-group"><div class="server-fund-title"><strong>${escapeHtml(group.fund)}</strong><span>${INTEGER.format(group.total)}</span></div>${group.values.map(item=>{
    const ratio=state.serverMode==='percent' ? (group.total ? item.value/group.total : 0) : item.value/max;
    const display=state.serverMode==='percent' ? PERCENT.format(group.total ? item.value/group.total : 0) : INTEGER.format(item.value);
    const klass=item.type==='Ativo'?'active':item.type==='Aposentado'?'retired':'pension';
    return `<button class="server-type-row" type="button" data-server-fund="${escapeHtml(group.fund)}" data-server-type="${escapeHtml(item.type)}"><span>${escapeHtml(item.type)}</span><i class="server-track"><i class="server-fill ${klass}" style="width:${Math.max(0,Math.min(100,ratio*100))}%"></i></i><b>${escapeHtml(display)}</b></button>`;
  }).join('')}</section>`).join('');
  $$('[data-server-type]',container).forEach(button=>button.addEventListener('click',()=>{
    $('#fundFilter').value=button.dataset.serverFund;
    $('#serverTypeFilter').value=button.dataset.serverType;
    state.tablePage=1;
    renderAll();
  }));

  const typeTotals=SERVER_TYPES.map(type=>({type,value:sum(scopes.competenceRows.filter(row=>row.serverType===type),'servers')}));
  summary.innerHTML=typeTotals.map(item=>`<div><span>${escapeHtml(item.type)}</span><strong>${INTEGER.format(item.value)}</strong></div>`).join('');
}

function renderAgencyRanking(scopes){
  const container=$('#agencyRanking');
  const rows=state.agencyScope==='competence' ? scopes.competenceRows : scopes.annualRows;
  const search=state.agencySearch.trim().toLocaleLowerCase('pt-BR');
  let data=aggregate(rows,'agency','revenue').sort((a,b)=>b.value-a.value);
  if(search) data=data.filter(item=>String(item.label).toLocaleLowerCase('pt-BR').includes(search));
  const total=data.reduce((value,item)=>value+item.value,0);
  const max=data[0]?.value||1;
  if(state.agencyLimit!=='all') data=data.slice(0,Number(state.agencyLimit)||10);
  if(!data.length) return renderEmpty(container,'Nenhum órgão encontrado.');
  container.innerHTML=data.map((item,index)=>`<button class="agency-row" type="button" data-agency="${escapeHtml(item.label)}"><span class="agency-name"><i class="agency-rank">${index+1}</i><strong title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</strong></span><span class="agency-bar-track"><i class="agency-bar-fill" style="width:${Math.max(1,item.value/max*100)}%"></i></span><span class="agency-value">${escapeHtml(MONEY.format(item.value))}</span><span class="agency-share">${escapeHtml(PERCENT.format(total?item.value/total:0))}</span></button>`).join('');
  $$('[data-agency]',container).forEach(button=>button.addEventListener('click',()=>{
    $('#agencyFilter').value=button.dataset.agency;
    state.tablePage=1;
    renderAll();
  }));
}

function groupedTableRows(rows){
  const map=new Map();
  rows.forEach(row=>{
    const key=[row.month,row.agency,row.fund].join('|');
    if(!map.has(key)) map.set(key,{month:row.month,monthKey:row.monthKey,agency:row.agency,fund:row.fund,patronal:0,insured:0,compensation:0,revenue:0,servers:0});
    const item=map.get(key);
    item.patronal+=row.patronal;
    item.insured+=row.insured;
    item.compensation+=row.compensation;
    item.revenue+=row.revenue;
    item.servers+=row.servers;
  });
  return [...map.values()];
}
function sortTableRows(rows){
  const {key,direction}=state.tableSort;
  const factor=direction==='asc'?1:-1;
  return [...rows].sort((a,b)=>{
    const av=a[key],bv=b[key];
    if(typeof av==='number' && typeof bv==='number') return (av-bv)*factor;
    return String(av??'').localeCompare(String(bv??''),'pt-BR')*factor;
  });
}
function renderTable(scopes){
  const rows=sortTableRows(groupedTableRows(scopes.annualRows));
  const totalPages=Math.max(1,Math.ceil(rows.length/state.tablePageSize));
  state.tablePage=Math.min(state.tablePage,totalPages);
  const start=(state.tablePage-1)*state.tablePageSize;
  const pageRows=rows.slice(start,start+state.tablePageSize);
  $('#tableResultCount').textContent=`${INTEGER.format(rows.length)} linha(s) consolidadas até ${scopes.selectedMonth || scopes.selectedYear}.`;
  $('#dataTable').innerHTML=pageRows.map(row=>`<tr><td>${escapeHtml(row.month)}</td><td>${escapeHtml(row.agency)}</td><td><span class="fund-pill ${fundClass(row.fund)}">${escapeHtml(row.fund.replace('Fundo ',''))}</span></td><td class="numeric">${MONEY.format(row.patronal)}</td><td class="numeric">${MONEY.format(row.insured)}</td><td class="numeric">${MONEY.format(row.compensation)}</td><td class="numeric"><strong>${MONEY.format(row.revenue)}</strong></td><td class="numeric">${INTEGER.format(row.servers)}</td></tr>`).join('') || '<tr><td colspan="8">Nenhum registro encontrado.</td></tr>';
  const totals={patronal:sum(rows,'patronal'),insured:sum(rows,'insured'),compensation:sum(rows,'compensation'),revenue:sum(rows,'revenue'),servers:sum(rows,'servers')};
  $('#tableTotals').innerHTML=`<tr><td colspan="3">Total do período</td><td class="numeric">${MONEY.format(totals.patronal)}</td><td class="numeric">${MONEY.format(totals.insured)}</td><td class="numeric">${MONEY.format(totals.compensation)}</td><td class="numeric">${MONEY.format(totals.revenue)}</td><td class="numeric">${INTEGER.format(totals.servers)}</td></tr>`;
  renderPagination(totalPages,rows.length);
}
function renderPagination(totalPages,totalRows){
  const element=$('#pagination');
  const page=state.tablePage;
  const pages=[];
  const from=Math.max(1,page-2),to=Math.min(totalPages,page+2);
  for(let current=from;current<=to;current++) pages.push(current);
  element.innerHTML=`<span>Página ${page} de ${totalPages} · ${INTEGER.format(totalRows)} linha(s)</span><div class="pagination-buttons"><button type="button" data-page="${page-1}" ${page<=1?'disabled':''}>Anterior</button>${pages.map(number=>`<button class="${number===page?'is-active':''}" type="button" data-page="${number}">${number}</button>`).join('')}<button type="button" data-page="${page+1}" ${page>=totalPages?'disabled':''}>Próxima</button></div>`;
  $$('[data-page]',element).forEach(button=>button.addEventListener('click',()=>{
    state.tablePage=Number(button.dataset.page)||1;
    renderTable(getScopes());
    $('.table-panel').scrollIntoView({behavior:'smooth',block:'start'});
  }));
}

function renderActiveChips(filters){
  const container=$('#activeFilterChips');
  const definitions=[
    ['fundFilter','Fundo',filters.fundFilter],['entityFilter','Poder',filters.entityFilter],['agencyFilter','Órgão',filters.agencyFilter],['categoryFilter','Categoria',filters.categoryFilter],['payrollFilter','Folha',filters.payrollFilter],['serverTypeFilter','Tipo',filters.serverTypeFilter],['searchInput','Pesquisa',filters.searchInput],['startDate','De',filters.startDate],['endDate','Até',filters.endDate]
  ];
  const active=definitions.filter(([, ,value])=>value);
  container.innerHTML=active.map(([id,label,value])=>`<span class="filter-chip">${escapeHtml(label)}: ${escapeHtml(value)}<button type="button" data-clear-filter="${id}" aria-label="Remover filtro ${escapeHtml(label)}">×</button></span>`).join('');
  $$('[data-clear-filter]',container).forEach(button=>button.addEventListener('click',()=>{
    $(`#${button.dataset.clearFilter}`).value='';
    state.tablePage=1;
    renderAll();
  }));
}

function renderEmpty(element,message){
  element.innerHTML=`<div class="chart-empty">${escapeHtml(message)}</div>`;
}
function bindTooltips(root){
  $$('[data-tip]',root).forEach(node=>{
    node.addEventListener('pointermove',event=>showTooltip(event,node.dataset.tip));
    node.addEventListener('pointerleave',hideTooltip);
    node.addEventListener('focus',event=>showTooltip(event,node.dataset.tip));
    node.addEventListener('blur',hideTooltip);
  });
}
function showTooltip(event,text){
  const tooltip=$('#tooltip');
  tooltip.textContent=text;
  tooltip.style.display='block';
  const x=event.clientX ?? innerWidth/2;
  const y=event.clientY ?? innerHeight/2;
  tooltip.style.left=`${Math.min(x+14,innerWidth-tooltip.offsetWidth-12)}px`;
  tooltip.style.top=`${Math.min(y+14,innerHeight-tooltip.offsetHeight-12)}px`;
}
function hideTooltip(){ $('#tooltip').style.display='none'; }
let toastTimeout;
function showToast(message){
  const toast=$('#toast');
  toast.textContent=message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimeout);
  toastTimeout=setTimeout(()=>toast.classList.remove('is-visible'),3200);
}

function updateConnectionStatus(live){
  const status=$('#dataStatus');
  const dot=$('#syncDot');
  const date=parseDate(state.meta.updatedAt);
  status.textContent=live
    ? `Dados sincronizados com a planilha · última atualização: ${date?DATE_TIME.format(date):'não informada'}`
    : `Modo de contingência local · referência: ${date?DATE_TIME.format(date):'não informada'}`;
  dot.classList.toggle('is-live',live);
  dot.classList.toggle('is-fallback',!live);
}
function updateStoryMetrics(){
  const years=uniqueValues(state.allRecords,'year').sort((a,b)=>Number(b)-Number(a));
  const latestYear=years[0]||'';
  const months=uniqueValues(state.allRecords.filter(row=>row.year===latestYear),'month').sort((a,b)=>monthKey(a)-monthKey(b));
  const latestMonth=months.at(-1)||'';
  const annualRows=state.allRecords.filter(row=>row.year===latestYear && row.monthKey<=monthKey(latestMonth));
  const competenceRows=state.allRecords.filter(row=>row.month===latestMonth);
  $$('[data-story-kpi="annual"]').forEach(node=>node.textContent=compact(sum(annualRows,'revenue')));
  $$('[data-story-kpi="servers"]').forEach(node=>node.textContent=INTEGER.format(sum(competenceRows,'servers')));
}

async function checkForDashboardUpdate(manual=false){
  const button=$('#refreshData');
  if(manual){button.disabled=true;button.textContent='Verificando…';}
  try{
    const response=await fetch(`/api/dashboard-version?_=${Date.now()}`,{cache:'no-store',headers:{Accept:'application/json','Cache-Control':'no-cache'}});
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    const info=await response.json();
    if(info?.ready && info.version && state.version && info.version!==state.version){
      await loadData({preserveFilters:true,announce:true});
      return;
    }
    if(manual) showToast('O dashboard já está com a versão mais recente.');
  }catch(error){
    console.warn('Não foi possível verificar a versão.',error);
    if(manual) showToast('Não foi possível verificar a atualização agora.');
  }finally{
    if(manual){button.disabled=false;button.textContent='Verificar atualização';}
  }
}
function startVersionPolling(){
  if(state.versionTimer) clearInterval(state.versionTimer);
  state.versionTimer=setInterval(()=>checkForDashboardUpdate(false),10000);
}

function exportCsv(){
  const scopes=getScopes();
  const rows=sortTableRows(groupedTableRows(scopes.annualRows));
  const lines=[
    ['Competência','Órgão','Fundo','Patronal','Segurado','Compensação','Total','Servidores'],
    ...rows.map(row=>[row.month,row.agency,row.fund,row.patronal.toFixed(2).replace('.',','),row.insured.toFixed(2).replace('.',','),row.compensation.toFixed(2).replace('.',','),row.revenue.toFixed(2).replace('.',','),Math.round(row.servers)])
  ];
  const csv='\ufeff'+lines.map(line=>line.map(value=>`"${String(value).replace(/"/g,'""')}"`).join(';')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download=`arrecadacao-iper-${scopes.selectedMonth||scopes.selectedYear||'dados'}.csv`;
  document.body.append(link);link.click();link.remove();URL.revokeObjectURL(url);
}

function resetFilters(){
  $('#fundFilter').value='';
  $('#entityFilter').value='';
  $('#agencyFilter').value='';
  $('#categoryFilter').value='';
  $('#payrollFilter').value='';
  $('#serverTypeFilter').value='';
  $('#searchInput').value='';
  $('#startDate').value='';
  $('#endDate').value='';
  const latestYear=uniqueValues(state.allRecords,'year').sort((a,b)=>Number(b)-Number(a))[0]||'';
  $('#yearFilter').value=latestYear;
  syncMonthOptions(false);
  state.hiddenFunds.clear();
  state.agencyScope='annual';
  state.agencyLimit='10';
  state.agencySearch='';
  state.tablePage=1;
  $('#agencyLimit').value='10';
  $('#agencyRankingSearch').value='';
  $$('[data-agency-scope]').forEach(button=>button.classList.toggle('is-active',button.dataset.agencyScope==='annual'));
  renderAll();
}

function initHeroStory(){
  const story=$('#visao-geral');
  const panels=$$('.story-panel');
  const progress=$('#storyProgress');
  const visual=$('.story-visual');
  let ticking=false;
  const update=()=>{
    ticking=false;
    const rect=story.getBoundingClientRect();
    const distance=story.offsetHeight-innerHeight;
    const progressValue=Math.min(1,Math.max(0,-rect.top/Math.max(1,distance)));
    progress.style.height=`${progressValue*100}%`;
    const exact=progressValue*(panels.length-1);
    const current=Math.min(panels.length-1,Math.floor(exact+.5));
    state.heroScene=current;
    panels.forEach((panel,index)=>{
      const distanceFromScene=Math.abs(exact-index);
      panel.style.opacity=Math.max(0,1-distanceFromScene*1.25);
      panel.style.transform=innerWidth<=760 ? `translateY(${(index-exact)*35}px)` : `translateY(calc(-50% + ${(index-exact)*48}px))`;
      panel.classList.toggle('is-active',index===current);
    });
    visual.style.transform=`translateY(-50%) translateX(${exact*5}px) scale(${1+exact*.018})`;
    $('.story-logo').style.transform=`translateX(-50%) rotate(${exact*.7}deg) scale(${1+exact*.025})`;
    $('.story-card-main').style.transform=`translateY(${Math.sin(exact)*-9}px)`;
    $('.story-card-fund').style.transform=`translateY(${Math.cos(exact)*8}px)`;
    $('#siteHeader').classList.toggle('is-solid',progressValue>.9 || scrollY>innerHeight*.35);
  };
  addEventListener('scroll',()=>{if(!ticking){requestAnimationFrame(update);ticking=true;}},{passive:true});
  addEventListener('resize',update);
  update();
}

function initEvents(){
  $('#yearFilter').addEventListener('change',()=>{syncMonthOptions(false);state.tablePage=1;renderAll();});
  ['monthFilter','fundFilter','entityFilter','agencyFilter','categoryFilter','payrollFilter','serverTypeFilter','startDate','endDate'].forEach(id=>{
    $(`#${id}`).addEventListener('change',()=>{state.tablePage=1;renderAll();});
  });
  let searchTimer;
  $('#searchInput').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.tablePage=1;renderAll();},180);});
  $('#toggleAdvancedFilters').addEventListener('click',event=>{
    const panel=$('#advancedFilters');
    panel.hidden=!panel.hidden;
    event.currentTarget.setAttribute('aria-expanded',String(!panel.hidden));
  });
  $('#resetFilters').addEventListener('click',resetFilters);
  $('#refreshData').addEventListener('click',()=>checkForDashboardUpdate(true));
  $('#resetFundVisibility').addEventListener('click',()=>{state.hiddenFunds.clear();renderFundAccumulated(getScopes());});
  $$('[data-server-mode]').forEach(button=>button.addEventListener('click',()=>{
    state.serverMode=button.dataset.serverMode;
    $$('[data-server-mode]').forEach(item=>item.classList.toggle('is-active',item===button));
    renderServers(getScopes());
  }));
  $$('[data-agency-scope]').forEach(button=>button.addEventListener('click',()=>{
    state.agencyScope=button.dataset.agencyScope;
    $$('[data-agency-scope]').forEach(item=>item.classList.toggle('is-active',item===button));
    renderAgencyRanking(getScopes());
  }));
  $('#agencyLimit').addEventListener('change',event=>{state.agencyLimit=event.target.value;renderAgencyRanking(getScopes());});
  $('#agencyRankingSearch').addEventListener('input',event=>{state.agencySearch=event.target.value;renderAgencyRanking(getScopes());});
  $('#pageSize').addEventListener('change',event=>{state.tablePageSize=Number(event.target.value)||25;state.tablePage=1;renderTable(getScopes());});
  $$('[data-sort]').forEach(button=>button.addEventListener('click',()=>{
    const key=button.dataset.sort;
    if(state.tableSort.key===key) state.tableSort.direction=state.tableSort.direction==='asc'?'desc':'asc';
    else state.tableSort={key,direction:key==='agency'||key==='fund'||key==='month'?'asc':'desc'};
    state.tablePage=1;
    renderTable(getScopes());
  }));
  $('#exportCsv').addEventListener('click',exportCsv);

  const dialog=$('#adminDialog');
  $$('[data-open-admin]').forEach(button=>button.addEventListener('click',()=>dialog.showModal()));
  dialog.addEventListener('click',event=>{if(event.target===dialog) dialog.close();});
}

initHeroStory();
initEvents();
loadData();
