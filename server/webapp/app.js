/**
 * Price Tracker — Telegram Mini App v2
 * Full management: edit, pause, delete, regroup, bulk ops, settings
 */

const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

const API = window.location.origin;
const content = document.getElementById('content');
const headerStats = document.getElementById('headerStats');

let allTrackers = [];
let currentTab = 'best';
let searchQuery = '';
let sortBy = 'priceAsc';
let selectedIds = new Set();
let selectMode = false;
let backStack = [];

// ─── API helpers ──────────────────────────────────────────────────

async function api(path, opts) {
  const res = await fetch(API + path, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

async function apiPut(path, data) {
  return api(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
}

async function apiDelete(path) {
  return api(path, { method: 'DELETE' });
}

async function apiPost(path, data) {
  return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
}

async function loadData() {
  allTrackers = await api('/trackers') || [];
  updateHeader();
}

function updateHeader() {
  const active = allTrackers.filter(t => t.status !== 'paused').length;
  const groups = new Set(allTrackers.filter(t => t.productGroup).map(t => t.productGroup)).size;
  headerStats.textContent = `${active} трекеров · ${groups} групп`;
}

// ─── Helpers ──────────────────────────────────────────────────────

function esc(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }

function cleanName(n) {
  if (!n) return '';
  return n.replace(/\s*[-–—:]\s*(купить|купити).*$/i,'').replace(/\s*[-–—]\s*(купить|купити)\s+на\s+.*$/i,'')
    .replace(/\s*Большой ассортимент.*$/i,'').replace(/\s*Великий асортимент.*$/i,'').replace(/\s*\|\s*[\w.]+\s*$/,'').trim();
}

function getShop(url) {
  if (!url) return '';
  if (url.includes('makeup')) return 'Makeup';
  if (url.includes('eva.ua')) return 'EVA';
  if (url.includes('notino')) return 'Notino';
  try { return new URL(url).hostname; } catch(_) { return ''; }
}

function fmtP(p) { const n=Number(p); return (!n||n<=0)?'—':n.toLocaleString('uk-UA',{maximumFractionDigits:0}); }

function fmtDate(d) {
  if (!d) return '';
  const dt=new Date(d), pad=n=>String(n).padStart(2,'0');
  return `${pad(dt.getDate())}.${pad(dt.getMonth()+1)} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function pctCh(o,n) { return o&&o!==0?((n-o)/o*100):null; }

function haptic(type) { try { tg.HapticFeedback.impactOccurred(type||'light'); } catch(_){} }

function sortTrackers(list) {
  const arr = list.slice();
  switch(sortBy) {
    case 'priceAsc': return arr.sort((a,b)=>(Number(a.currentPrice)||Infinity)-(Number(b.currentPrice)||Infinity));
    case 'priceDesc': return arr.sort((a,b)=>(Number(b.currentPrice)||0)-(Number(a.currentPrice)||0));
    case 'discount': return arr.sort((a,b)=>{
      const da=Number(a.initialPrice)>0?(Number(a.currentPrice)-Number(a.initialPrice))/Number(a.initialPrice):0;
      const db=Number(b.initialPrice)>0?(Number(b.currentPrice)-Number(b.initialPrice))/Number(b.initialPrice):0;
      return da-db;
    });
    case 'updated': return arr.sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
    case 'name': return arr.sort((a,b)=>(a.productName||'').localeCompare(b.productName||''));
    default: return arr;
  }
}

// ─── Navigation ───────────────────────────────────────────────────

function pushBack(fn) { backStack.push(fn); tg.BackButton.show(); }

function popBack() {
  backStack.pop();
  if (backStack.length > 0) backStack[backStack.length-1]();
  else { tg.BackButton.hide(); renderTab(); }
}

tg.BackButton.onClick(popBack);

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    backStack = [];
    tg.BackButton.hide();
    selectMode = false;
    selectedIds.clear();
    renderTab();
    haptic('light');
  });
});

function renderTab() {
  switch(currentTab) {
    case 'best': renderBest(); break;
    case 'groups': renderGroups(); break;
    case 'all': renderAll(); break;
    case 'settings': renderSettings(); break;
  }
}

// ─── Best Prices Tab ──────────────────────────────────────────────

function renderBest() {
  const groups = getGroups();
  if (!groups.length) { content.innerHTML = emptyHtml('🏆','Нет данных о ценах'); return; }

  let html = sortBarHtml();
  const sorted = sortBy === 'name'
    ? groups.sort((a,b)=>a.name.localeCompare(b.name))
    : groups.sort((a,b)=>(a.bestPrice||Infinity)-(b.bestPrice||Infinity));

  for (const g of sorted) {
    const best = g.trackers.reduce((a,b)=>(Number(a.currentPrice)||Infinity)<=(Number(b.currentPrice)||Infinity)?a:b);
    const price = Number(best.currentPrice);
    const initial = Number(best.initialPrice);
    const pct = pctCh(initial, price);
    const shop = getShop(best.pageUrl);
    const name = cleanName(g.name).slice(0,50);

    let badge = '';
    if (pct !== null && pct < -5) badge = `<span class="card-badge badge-drop">📉 ${pct.toFixed(1)}%</span>`;
    else if (pct !== null && pct > 5) badge = `<span class="card-badge badge-rise">📈 +${pct.toFixed(1)}%</span>`;

    html += `<div class="card" data-action="group" data-group="${esc(g.name)}">
      <div class="card-header"><div class="card-name">${esc(name)}</div>${badge}</div>
      <div class="card-price">${fmtP(price)} <span class="currency">грн</span></div>
      <div class="card-meta"><span>🏪 ${esc(shop)}</span><span>📦 ${g.trackers.length} магаз.</span>
      ${Number(best.minPrice)>0?`<span>📉 мін: ${fmtP(best.minPrice)}</span>`:''}</div></div>`;
  }
  content.innerHTML = html;
  bindCards();
  bindSortBar();
}

// ─── Groups Tab ───────────────────────────────────────────────────

function renderGroups() {
  const groups = getGroups();
  const ungrouped = allTrackers.filter(t=>!t.productGroup && t.status!=='paused');
  if (!groups.length && !ungrouped.length) { content.innerHTML = emptyHtml('📦','Групп пока нет'); return; }

  let html = '';
  for (const g of groups.sort((a,b)=>a.name.localeCompare(b.name))) {
    html += `<div class="card group-card" data-action="group" data-group="${esc(g.name)}">
      <div class="group-header"><div class="group-name">${esc(g.name.slice(0,45))}</div><span class="group-count">${g.trackers.length}</span></div>
      <div class="group-best">${g.bestPrice>0?'💰 '+fmtP(g.bestPrice)+' грн':''}</div></div>`;
  }
  if (ungrouped.length) {
    html += `<div class="card group-card" data-action="ungrouped">
      <div class="group-header"><div class="group-name">📎 Без группы</div><span class="group-count">${ungrouped.length}</span></div></div>`;
  }

  // Auto-group button
  html += `<button class="action-btn" id="btnAutoGroup">🔗 Перегруппировать автоматически</button>`;

  content.innerHTML = html;
  bindCards();
  document.getElementById('btnAutoGroup')?.addEventListener('click', async () => {
    haptic('medium');
    try {
      const r = await apiPost('/trackers/auto-group');
      tg.showAlert(`Сгруппировано: ${r.grouped} трекеров, ${r.newGroups||0} новых групп`);
      await loadData();
      renderGroups();
    } catch(e) { tg.showAlert('Ошибка: '+e.message); }
  });
}

// ─── All Trackers Tab ─────────────────────────────────────────────

function renderAll() {
  const active = allTrackers.filter(t=>t.status!=='paused');
  let html = `<div class="search-bar"><input type="text" placeholder="🔍 Поиск..." value="${esc(searchQuery)}" id="searchInput"></div>`;
  html += sortBarHtml();

  // Filter chips by shop
  html += `<div class="filter-chips" id="filterChips">
    <button class="chip active" data-shop="all">Все</button>
    <button class="chip" data-shop="makeup">Makeup</button>
    <button class="chip" data-shop="eva">EVA</button>
    <button class="chip" data-shop="notino">Notino</button>
  </div>`;

  // Select mode toggle
  html += `<div class="select-bar">
    <button class="chip ${selectMode?'active':''}" id="btnSelectMode">☑️ Выбрать</button>
    ${selectMode?`<span class="select-count">${selectedIds.size} выбрано</span>
    <button class="chip" id="btnSelectAll">Все</button>
    <button class="chip danger" id="btnBulkPause">⏸</button>
    <button class="chip danger" id="btnBulkDelete">🗑</button>
    <button class="chip" id="btnBulkGroup">📦</button>`:''}
  </div>`;

  let filtered = active;
  if (searchQuery) filtered = filtered.filter(t=>(t.productName||'').toLowerCase().includes(searchQuery.toLowerCase()));

  const shopFilter = document.querySelector?.('.chip[data-shop].active')?.dataset?.shop;
  // Will be applied after render via bindFilterChips

  filtered = sortTrackers(filtered);

  if (!filtered.length) {
    html += emptyHtml('📋','Ничего не найдено');
  } else {
    html += '<div id="trackerList">';
    for (const t of filtered) html += trackerCardHtml(t);
    html += '</div>';
  }

  content.innerHTML = html;
  bindCards();
  bindSortBar();
  bindSearch();
  bindFilterChips();
  bindSelectMode();
}

function bindSearch() {
  const input = document.getElementById('searchInput');
  if (!input) return;
  input.addEventListener('input', e => {
    searchQuery = e.target.value;
    renderAll();
    const el = document.getElementById('searchInput');
    if (el) { el.focus(); el.selectionStart = el.selectionEnd = searchQuery.length; }
  });
}

function bindFilterChips() {
  document.querySelectorAll('#filterChips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#filterChips .chip').forEach(c=>c.classList.remove('active'));
      chip.classList.add('active');
      haptic('light');
      // Re-render with filter
      renderAllFiltered(chip.dataset.shop);
    });
  });
}

function renderAllFiltered(shop) {
  let filtered = allTrackers.filter(t=>t.status!=='paused');
  if (searchQuery) filtered = filtered.filter(t=>(t.productName||'').toLowerCase().includes(searchQuery.toLowerCase()));
  if (shop && shop !== 'all') {
    filtered = filtered.filter(t => {
      const s = getShop(t.pageUrl).toLowerCase();
      return s.includes(shop);
    });
  }
  filtered = sortTrackers(filtered);

  const container = document.getElementById('trackerList');
  if (!container) return;
  if (!filtered.length) { container.innerHTML = emptyHtml('📋','Ничего не найдено'); return; }
  let html = '';
  for (const t of filtered) html += trackerCardHtml(t);
  container.innerHTML = html;
  bindCards();
}

function bindSelectMode() {
  document.getElementById('btnSelectMode')?.addEventListener('click', () => {
    selectMode = !selectMode;
    if (!selectMode) selectedIds.clear();
    haptic('light');
    renderAll();
  });
  document.getElementById('btnSelectAll')?.addEventListener('click', () => {
    const active = allTrackers.filter(t=>t.status!=='paused');
    if (selectedIds.size === active.length) selectedIds.clear();
    else active.forEach(t=>selectedIds.add(t.id));
    renderAll();
  });
  document.getElementById('btnBulkPause')?.addEventListener('click', () => bulkAction('pause'));
  document.getElementById('btnBulkDelete')?.addEventListener('click', () => bulkAction('delete'));
  document.getElementById('btnBulkGroup')?.addEventListener('click', () => showBulkGroupPicker());
}

async function bulkAction(action) {
  if (!selectedIds.size) return;
  if (action === 'delete') {
    tg.showConfirm(`Удалить ${selectedIds.size} трекеров?`, async (ok) => {
      if (!ok) return;
      haptic('heavy');
      for (const id of selectedIds) { try { await apiDelete(`/trackers/${id}`); } catch(_){} }
      selectedIds.clear(); selectMode = false;
      await loadData(); renderAll();
    });
    return;
  }
  if (action === 'pause') {
    haptic('medium');
    for (const id of selectedIds) { try { await apiPut(`/trackers/${id}`, { status: 'paused' }); } catch(_){} }
    selectedIds.clear(); selectMode = false;
    await loadData(); renderAll();
    tg.showAlert('Трекеры приостановлены');
  }
}

function showBulkGroupPicker() {
  const groups = [...new Set(allTrackers.filter(t=>t.productGroup).map(t=>t.productGroup))].sort();
  let html = `<div class="detail-title">📦 Выберите группу</div>`;
  html += `<div class="card group-card" data-action="setgroup" data-group="">
    <div class="group-name">📎 Убрать из группы</div></div>`;
  for (const g of groups) {
    html += `<div class="card group-card" data-action="setgroup" data-group="${esc(g)}">
      <div class="group-name">${esc(g.slice(0,45))}</div></div>`;
  }
  content.innerHTML = html;
  pushBack(() => renderAll());

  content.querySelectorAll('[data-action="setgroup"]').forEach(el => {
    el.addEventListener('click', async () => {
      const group = el.dataset.group;
      haptic('medium');
      for (const id of selectedIds) { try { await apiPut(`/trackers/${id}`, { productGroup: group }); } catch(_){} }
      selectedIds.clear(); selectMode = false;
      await loadData();
      popBack();
      tg.showAlert('Группа обновлена');
    });
  });
}

// ─── Group Detail View ────────────────────────────────────────────

function showGroupDetail(groupName) {
  const trackers = allTrackers
    .filter(t=>t.productGroup===groupName && t.status!=='paused')
    .sort((a,b)=>(Number(a.currentPrice)||Infinity)-(Number(b.currentPrice)||Infinity));

  if (!trackers.length) { content.innerHTML = emptyHtml('📦','Группа пуста'); return; }

  pushBack(() => renderTab());
  const bestPrice = Math.min(...trackers.filter(t=>Number(t.currentPrice)>0).map(t=>Number(t.currentPrice)));

  let html = `<div class="detail-header">
    <div class="detail-title" id="groupTitle">${esc(groupName.slice(0,50))}</div>
    <button class="icon-btn" id="btnEditGroup" title="Переименовать">✏️</button>
  </div>`;

  for (const t of trackers) {
    const price = Number(t.currentPrice);
    const isBest = price>0 && price===bestPrice;
    const name = cleanName(t.productName).slice(0,45);
    const shop = getShop(t.pageUrl);
    let badge = `<span class="card-badge badge-shop">${esc(shop)}</span>`;
    if (isBest) badge = `<span class="card-badge badge-best">🏆 Лучшая</span>`;

    const min=Number(t.minPrice), max=Number(t.maxPrice);
    let range = '';
    if (min>0 && max>0 && max>min && price>0) {
      const pos = Math.min(100,Math.max(0,((price-min)/(max-min))*100));
      range = `<div class="card-range"><div class="card-range-fill" style="width:${pos}%"></div><div class="card-range-marker" style="left:${pos}%"></div></div>`;
    }

    html += `<div class="card" data-action="tracker" data-id="${t.id}">
      <div class="card-header"><div class="card-name">${esc(name)}</div>${badge}</div>
      <div class="card-price">${fmtP(price)} <span class="currency">грн</span></div>
      <div class="card-meta"><span>🏪 ${esc(shop)}</span>${min>0?`<span>мін: ${fmtP(min)}</span>`:''}${max>0?`<span>макс: ${fmtP(max)}</span>`:''}</div>
      ${range}</div>`;
  }

  content.innerHTML = html;
  bindCards();

  document.getElementById('btnEditGroup')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'text'; input.value = groupName; input.className = 'inline-edit';
    const title = document.getElementById('groupTitle');
    title.innerHTML = ''; title.appendChild(input); input.focus();
    input.addEventListener('blur', () => renameGroup(groupName, input.value));
    input.addEventListener('keydown', e => { if (e.key==='Enter') input.blur(); });
  });
}

async function renameGroup(oldName, newName) {
  newName = newName.trim();
  if (!newName || newName === oldName) { showGroupDetail(oldName); return; }
  haptic('medium');
  const trackers = allTrackers.filter(t=>t.productGroup===oldName);
  for (const t of trackers) { try { await apiPut(`/trackers/${t.id}`, { productGroup: newName }); } catch(_){} }
  await loadData();
  showGroupDetail(newName);
  tg.showAlert('Группа переименована');
}

function showUngrouped() {
  const trackers = allTrackers.filter(t=>!t.productGroup && t.status!=='paused');
  pushBack(() => renderTab());
  let html = `<div class="detail-title">📎 Без группы</div>`;
  for (const t of trackers) html += trackerCardHtml(t);
  content.innerHTML = html;
  bindCards();
}

// ─── Tracker Detail View ──────────────────────────────────────────

async function showTrackerDetail(id) {
  const t = allTrackers.find(tr=>tr.id===id);
  if (!t) return;

  pushBack(() => t.productGroup ? showGroupDetail(t.productGroup) : renderTab());

  const name = cleanName(t.productName);
  const shop = getShop(t.pageUrl);
  const price = Number(t.currentPrice), initial = Number(t.initialPrice);
  const min = Number(t.minPrice), max = Number(t.maxPrice), prev = Number(t.previousPrice);

  let changeHtml = '';
  if (prev>0 && prev!==price) {
    const diff = price-prev, pct = pctCh(prev,price);
    const cls = diff>0?'positive':'negative', sign = diff>0?'+':'';
    changeHtml = `<div class="detail-change ${cls}">${sign}${fmtP(Math.abs(diff))} грн (${sign}${pct.toFixed(1)}%)</div>`;
  }

  let html = `
    <div class="detail-header">
      <div class="detail-title" id="trackerTitle">${esc(name)}</div>
      <button class="icon-btn" id="btnEditName" title="Переименовать">✏️</button>
    </div>
    <div class="detail-price-block">
      <div class="detail-current-price">${fmtP(price)} <span class="currency">грн</span></div>
      ${changeHtml}
      <div style="font-size:12px;color:var(--hint);margin-top:6px">🏪 ${esc(shop)}</div>
    </div>

    <div class="detail-stats">
      <div class="stat-box"><div class="stat-label">Начальная</div><div class="stat-value">${fmtP(initial)}</div></div>
      <div class="stat-box"><div class="stat-label">Минимум</div><div class="stat-value" style="color:var(--accent)">${fmtP(min)}</div></div>
      <div class="stat-box"><div class="stat-label">Максимум</div><div class="stat-value" style="color:var(--danger)">${fmtP(max)}</div></div>
    </div>

    <a class="detail-link" href="${t.pageUrl}" target="_blank">🔗 Открыть в магазине</a>

    <!-- Actions -->
    <div class="action-grid">
      <button class="action-btn" id="btnInterval">⏱ Интервал: ${t.checkIntervalHours||3}ч</button>
      <button class="action-btn" id="btnNotif">${t.notificationsEnabled!==false?'🔔':'🔕'} Уведомления</button>
      <button class="action-btn" id="btnGroup">📦 ${t.productGroup?esc(t.productGroup.slice(0,20)):'Без группы'}</button>
      <button class="action-btn ${t.status==='paused'?'active':''}" id="btnPause">${t.status==='paused'?'▶️ Возобновить':'⏸ Пауза'}</button>
    </div>
    <button class="action-btn danger full-width" id="btnDelete">🗑 Удалить трекер</button>

    <div class="history-section"><div class="history-title">📈 История цен</div><div id="historyList"><div class="loading"><div class="spinner"></div></div></div></div>
  `;

  content.innerHTML = html;
  bindTrackerActions(t);
  loadHistory(id);
}

function bindTrackerActions(t) {
  // Edit name
  document.getElementById('btnEditName')?.addEventListener('click', () => {
    const title = document.getElementById('trackerTitle');
    const input = document.createElement('input');
    input.type = 'text'; input.value = cleanName(t.productName); input.className = 'inline-edit';
    title.innerHTML = ''; title.appendChild(input); input.focus();
    input.addEventListener('blur', async () => {
      const val = input.value.trim();
      if (val && val !== t.productName) {
        haptic('light');
        await apiPut(`/trackers/${t.id}`, { productName: val });
        t.productName = val;
        const idx = allTrackers.findIndex(x=>x.id===t.id);
        if (idx>=0) allTrackers[idx].productName = val;
      }
      showTrackerDetail(t.id);
    });
    input.addEventListener('keydown', e => { if (e.key==='Enter') input.blur(); });
  });

  // Interval
  document.getElementById('btnInterval')?.addEventListener('click', () => {
    showIntervalPicker(t);
  });

  // Notifications toggle
  document.getElementById('btnNotif')?.addEventListener('click', async () => {
    haptic('light');
    const enabled = t.notificationsEnabled === false ? true : false;
    await apiPut(`/trackers/${t.id}`, { notificationsEnabled: enabled });
    t.notificationsEnabled = enabled;
    const idx = allTrackers.findIndex(x=>x.id===t.id);
    if (idx>=0) allTrackers[idx].notificationsEnabled = enabled;
    showTrackerDetail(t.id);
  });

  // Group
  document.getElementById('btnGroup')?.addEventListener('click', () => {
    showGroupPicker(t);
  });

  // Pause/Resume
  document.getElementById('btnPause')?.addEventListener('click', async () => {
    haptic('medium');
    const newStatus = t.status === 'paused' ? 'active' : 'paused';
    await apiPut(`/trackers/${t.id}`, { status: newStatus });
    t.status = newStatus;
    const idx = allTrackers.findIndex(x=>x.id===t.id);
    if (idx>=0) allTrackers[idx].status = newStatus;
    showTrackerDetail(t.id);
  });

  // Delete
  document.getElementById('btnDelete')?.addEventListener('click', () => {
    tg.showConfirm('Удалить этот трекер?', async (ok) => {
      if (!ok) return;
      haptic('heavy');
      await apiDelete(`/trackers/${t.id}`);
      allTrackers = allTrackers.filter(x=>x.id!==t.id);
      popBack();
      tg.showAlert('Трекер удалён');
    });
  });
}

function showIntervalPicker(t) {
  const intervals = [
    { value: 0.5, label: '30 мин' },
    { value: 1, label: '1 час' },
    { value: 3, label: '3 часа' },
    { value: 6, label: '6 часов' },
    { value: 12, label: '12 часов' },
    { value: 24, label: '24 часа' },
  ];
  let html = `<div class="detail-title">⏱ Интервал проверки</div>`;
  for (const i of intervals) {
    const active = Number(t.checkIntervalHours) === i.value ? 'active' : '';
    html += `<button class="action-btn ${active}" data-interval="${i.value}">${i.label}</button>`;
  }
  content.innerHTML = html;
  pushBack(() => showTrackerDetail(t.id));

  content.querySelectorAll('[data-interval]').forEach(btn => {
    btn.addEventListener('click', async () => {
      haptic('light');
      const val = Number(btn.dataset.interval);
      await apiPut(`/trackers/${t.id}`, { checkIntervalHours: val });
      t.checkIntervalHours = val;
      const idx = allTrackers.findIndex(x=>x.id===t.id);
      if (idx>=0) allTrackers[idx].checkIntervalHours = val;
      popBack();
    });
  });
}

function showGroupPicker(t) {
  const groups = [...new Set(allTrackers.filter(x=>x.productGroup).map(x=>x.productGroup))].sort();
  let html = `<div class="detail-title">📦 Выберите группу</div>`;
  html += `<button class="action-btn ${!t.productGroup?'active':''}" data-group="">📎 Без группы</button>`;
  for (const g of groups) {
    const active = t.productGroup === g ? 'active' : '';
    html += `<button class="action-btn ${active}" data-group="${esc(g)}">${esc(g.slice(0,40))}</button>`;
  }
  content.innerHTML = html;
  pushBack(() => showTrackerDetail(t.id));

  content.querySelectorAll('[data-group]').forEach(btn => {
    btn.addEventListener('click', async () => {
      haptic('light');
      const group = btn.dataset.group;
      await apiPut(`/trackers/${t.id}`, { productGroup: group });
      t.productGroup = group;
      const idx = allTrackers.findIndex(x=>x.id===t.id);
      if (idx>=0) allTrackers[idx].productGroup = group;
      popBack();
    });
  });
}

async function loadHistory(id) {
  const el = document.getElementById('historyList');
  if (!el) return;
  const history = await api(`/priceHistory?trackerId=${id}`).catch(()=>[]);
  if (!history||!history.length) { el.innerHTML = '<p style="color:var(--hint);font-size:13px">Нет данных</p>'; return; }

  const sorted = history.filter(h=>Number(h.price)>0).sort((a,b)=>new Date(b.checkedAt)-new Date(a.checkedAt)).slice(0,30);
  let html = '<div class="history-list">';
  let prevP = null;
  for (const h of sorted) {
    const p = Number(h.price);
    let icon = '➡️';
    if (prevP!==null) { if (p<prevP) icon='📈'; else if (p>prevP) icon='📉'; }
    html += `<div class="history-item"><span class="history-price">${icon} ${fmtP(p)} грн</span><span class="history-date">${fmtDate(h.checkedAt)}</span></div>`;
    prevP = p;
  }
  html += '</div>';
  el.innerHTML = html;
}

// ─── Settings Tab ─────────────────────────────────────────────────

async function renderSettings() {
  const settings = await api('/settings/global').catch(()=>({})) || {};

  let html = `
    <div class="settings-section">
      <div class="settings-title">🔔 Уведомления</div>
      <div class="settings-row">
        <span class="settings-label">Уведомления</span>
        <label class="toggle"><input type="checkbox" id="setNotif" ${settings.notificationsEnabled!==false?'checked':''}><span class="toggle-slider"></span></label>
      </div>
      <div class="settings-row">
        <span class="settings-label">Дайджест в Telegram</span>
        <label class="toggle"><input type="checkbox" id="setDigest" ${settings.telegramDigestEnabled!==false?'checked':''}><span class="toggle-slider"></span></label>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-title">🔄 Действия</div>
      <button class="action-btn full-width" id="btnCheckNow">🔄 Запустить проверку цен</button>
      <button class="action-btn full-width" id="btnAutoGroupSettings">🔗 Перегруппировать трекеры</button>
      <button class="action-btn full-width" id="btnClearHistory">🗑 Очистить историю цен</button>
    </div>

    <div class="settings-section">
      <div class="settings-title">📊 Информация</div>
      <div class="settings-row"><span class="settings-label">Всего трекеров</span><span class="settings-value">${allTrackers.length}</span></div>
      <div class="settings-row"><span class="settings-label">Активных</span><span class="settings-value">${allTrackers.filter(t=>t.status==='active'||t.status==='updated').length}</span></div>
      <div class="settings-row"><span class="settings-label">На паузе</span><span class="settings-value">${allTrackers.filter(t=>t.status==='paused').length}</span></div>
      <div class="settings-row"><span class="settings-label">С ошибками</span><span class="settings-value">${allTrackers.filter(t=>t.status==='error').length}</span></div>
      <div class="settings-row"><span class="settings-label">Групп</span><span class="settings-value">${new Set(allTrackers.filter(t=>t.productGroup).map(t=>t.productGroup)).size}</span></div>
      <div class="settings-row"><span class="settings-label">Chat ID</span><span class="settings-value">${settings.telegramChatId||'—'}</span></div>
    </div>

    <div class="settings-section">
      <div class="settings-title">ℹ️ О приложении</div>
      <div class="settings-row"><span class="settings-label">Версия</span><span class="settings-value">2.0.0</span></div>
      <div class="settings-row"><span class="settings-label">Трекеры добавляются</span><span class="settings-value">Через расширение</span></div>
    </div>
  `;

  content.innerHTML = html;

  // Toggle handlers
  document.getElementById('setNotif')?.addEventListener('change', async (e) => {
    haptic('light');
    await apiPut('/settings/global', { notificationsEnabled: e.target.checked });
  });
  document.getElementById('setDigest')?.addEventListener('change', async (e) => {
    haptic('light');
    await apiPut('/settings/global', { telegramDigestEnabled: e.target.checked });
  });

  // Check now
  document.getElementById('btnCheckNow')?.addEventListener('click', async () => {
    haptic('medium');
    const btn = document.getElementById('btnCheckNow');
    btn.textContent = '⏳ Проверка...'; btn.disabled = true;
    try {
      const r = await apiPost('/server-check');
      if (r.skipped) { tg.showAlert('Проверка уже выполняется'); }
      else { tg.showAlert(`✅ Проверено: ${r.checked}, изменилось: ${r.changed}, ошибок: ${r.errors}`); await loadData(); }
    } catch(e) { tg.showAlert('Ошибка: '+e.message); }
    btn.textContent = '🔄 Запустить проверку цен'; btn.disabled = false;
  });

  // Auto-group
  document.getElementById('btnAutoGroupSettings')?.addEventListener('click', async () => {
    haptic('medium');
    try {
      const r = await apiPost('/trackers/auto-group');
      tg.showAlert(`Сгруппировано: ${r.grouped}, новых групп: ${r.newGroups||0}`);
      await loadData(); updateHeader();
    } catch(e) { tg.showAlert('Ошибка: '+e.message); }
  });

  // Clear history
  document.getElementById('btnClearHistory')?.addEventListener('click', () => {
    tg.showConfirm('Очистить ВСЮ историю цен? Это действие необратимо.', async (ok) => {
      if (!ok) return;
      haptic('heavy');
      try {
        await apiPost('/priceHistory/clear-all');
        tg.showAlert('История очищена');
        await loadData();
      } catch(e) { tg.showAlert('Ошибка: '+e.message); }
    });
  });
}

// ─── Shared Components ────────────────────────────────────────────

function trackerCardHtml(t) {
  const name = cleanName(t.productName).slice(0,45);
  const shop = getShop(t.pageUrl);
  const price = Number(t.currentPrice), prev = Number(t.previousPrice);
  const pct = prev>0 && price!==prev ? pctCh(prev,price) : null;
  const min = Number(t.minPrice), max = Number(t.maxPrice);

  let badge = '';
  if (t.status==='error') badge = `<span class="card-badge badge-rise">❌</span>`;
  else if (t.status==='paused') badge = `<span class="card-badge" style="background:rgba(255,255,255,0.1);color:var(--hint)">⏸</span>`;
  else if (pct!==null && pct<0) badge = `<span class="card-badge badge-drop">${pct.toFixed(1)}%</span>`;
  else if (pct!==null && pct>0) badge = `<span class="card-badge badge-rise">+${pct.toFixed(1)}%</span>`;

  let range = '';
  if (min>0 && max>0 && max>min && price>0) {
    const pos = Math.min(100,Math.max(0,((price-min)/(max-min))*100));
    range = `<div class="card-range"><div class="card-range-fill" style="width:${pos}%"></div><div class="card-range-marker" style="left:${pos}%"></div></div>`;
  }

  const checkbox = selectMode ? `<input type="checkbox" class="card-checkbox" data-id="${t.id}" ${selectedIds.has(t.id)?'checked':''}>` : '';

  return `<div class="card" data-action="tracker" data-id="${t.id}">
    <div class="card-header">${checkbox}<div class="card-name">${esc(name)}</div>${badge}</div>
    <div class="card-price">${fmtP(price)} <span class="currency">грн</span></div>
    <div class="card-meta"><span>🏪 ${esc(shop)}</span>${min>0?`<span>📉 ${fmtP(min)}</span>`:''}${max>0?`<span>📈 ${fmtP(max)}</span>`:''}</div>
    ${range}</div>`;
}

function sortBarHtml() {
  const opts = [
    { v:'priceAsc', l:'💰 Цена ↑' }, { v:'priceDesc', l:'💰 Цена ↓' },
    { v:'discount', l:'📉 Скидка' }, { v:'updated', l:'🕐 Обновлено' }, { v:'name', l:'🔤 Имя' },
  ];
  let html = '<div class="sort-bar" id="sortBar">';
  for (const o of opts) html += `<button class="chip ${sortBy===o.v?'active':''}" data-sort="${o.v}">${o.l}</button>`;
  html += '</div>';
  return html;
}

function bindSortBar() {
  document.querySelectorAll('#sortBar .chip').forEach(btn => {
    btn.addEventListener('click', () => {
      sortBy = btn.dataset.sort;
      haptic('light');
      renderTab();
    });
  });
}

function emptyHtml(emoji, text) {
  return `<div class="empty-state"><div class="emoji">${emoji}</div><p>${text}</p></div>`;
}

function bindCards() {
  content.querySelectorAll('[data-action="group"]').forEach(el => {
    el.addEventListener('click', () => { haptic('light'); showGroupDetail(el.dataset.group); });
  });
  content.querySelectorAll('[data-action="ungrouped"]').forEach(el => {
    el.addEventListener('click', () => { haptic('light'); showUngrouped(); });
  });
  content.querySelectorAll('[data-action="tracker"]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('card-checkbox')) return;
      haptic('light');
      showTrackerDetail(Number(el.dataset.id));
    });
  });
  // Checkboxes for select mode
  content.querySelectorAll('.card-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = Number(cb.dataset.id);
      if (cb.checked) selectedIds.add(id); else selectedIds.delete(id);
      const countEl = document.querySelector('.select-count');
      if (countEl) countEl.textContent = `${selectedIds.size} выбрано`;
    });
  });
}

function getGroups() {
  const map = {};
  for (const t of allTrackers) {
    if (!t.productGroup || t.status==='paused') continue;
    if (!map[t.productGroup]) map[t.productGroup] = [];
    map[t.productGroup].push(t);
  }
  return Object.entries(map).map(([name,trackers])=>{
    const prices = trackers.map(t=>Number(t.currentPrice)).filter(p=>p>0);
    return { name, trackers, bestPrice: prices.length?Math.min(...prices):0 };
  });
}

// ─── Pull to Refresh ──────────────────────────────────────────────

let pullStartY = 0, pulling = false;
document.addEventListener('touchstart', e => { if (window.scrollY===0) { pullStartY = e.touches[0].clientY; pulling = true; } });
document.addEventListener('touchmove', e => {
  if (!pulling) return;
  const diff = e.touches[0].clientY - pullStartY;
  if (diff > 80) { pulling = false; refreshData(); }
});
document.addEventListener('touchend', () => { pulling = false; });

async function refreshData() {
  haptic('medium');
  await loadData();
  renderTab();
}

// ─── Init ─────────────────────────────────────────────────────────

async function init() {
  await loadData();
  const params = new URLSearchParams(window.location.search);
  if (params.get('page')==='settings') {
    currentTab = 'settings';
    document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab==='settings'));
  }
  renderTab();
}

init();
