/**
 * Price Tracker — Telegram Mini App
 */

const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// Apply Telegram theme
document.documentElement.style.setProperty('--tg-theme-bg-color', tg.themeParams.bg_color || '#1a1a2e');

const API_BASE = window.location.origin;
const content = document.getElementById('content');
const headerStats = document.getElementById('headerStats');

let allTrackers = [];
let allHistory = {};
let currentTab = 'best';
let searchQuery = '';

// ─── API ──────────────────────────────────────────────────────────

async function api(path) {
  try {
    const res = await fetch(API_BASE + path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('API error:', path, err);
    return null;
  }
}

async function loadData() {
  allTrackers = await api('/trackers') || [];
  updateHeaderStats();
}

function updateHeaderStats() {
  const active = allTrackers.filter(t => t.status !== 'paused').length;
  const groups = new Set(allTrackers.filter(t => t.productGroup).map(t => t.productGroup)).size;
  headerStats.textContent = `${active} трекеров · ${groups} групп`;
}

// ─── Helpers ──────────────────────────────────────────────────────

function escHtml(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cleanName(name) {
  if (!name) return '';
  return name
    .replace(/\s*[-–—:]\s*(купить|купити).*$/i, '')
    .replace(/\s*[-–—]\s*(купить|купити)\s+на\s+.*$/i, '')
    .replace(/\s*Большой ассортимент.*$/i, '')
    .replace(/\s*Великий асортимент.*$/i, '')
    .replace(/\s*\|\s*[\w.]+\s*$/, '')
    .trim();
}

function getShop(url) {
  if (!url) return '';
  if (url.includes('makeup')) return 'Makeup';
  if (url.includes('eva.ua')) return 'EVA';
  if (url.includes('notino')) return 'Notino';
  try { return new URL(url).hostname; } catch (_) { return ''; }
}

function fmtPrice(p) {
  const n = Number(p);
  if (!n || n <= 0) return '—';
  return n.toLocaleString('uk-UA', { maximumFractionDigits: 0 });
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function pctChange(oldP, newP) {
  if (!oldP || oldP === 0) return null;
  return ((newP - oldP) / oldP * 100);
}

// ─── Tab Navigation ───────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    renderTab();
  });
});

function renderTab() {
  tg.BackButton.hide();
  switch (currentTab) {
    case 'best': renderBest(); break;
    case 'groups': renderGroups(); break;
    case 'all': renderAll(); break;
    case 'settings': renderSettings(); break;
  }
}

// ─── Best Prices Tab ──────────────────────────────────────────────

function renderBest() {
  const groups = getGroupedTrackers();
  if (groups.length === 0) {
    content.innerHTML = `<div class="empty-state"><div class="emoji">🏆</div><p>Нет данных о ценах по группам</p></div>`;
    return;
  }

  let html = '';
  for (const g of groups) {
    const best = g.trackers.reduce((a, b) => {
      const pa = Number(a.currentPrice) || Infinity;
      const pb = Number(b.currentPrice) || Infinity;
      return pa <= pb ? a : b;
    });

    const price = Number(best.currentPrice);
    const initial = Number(best.initialPrice);
    const pct = pctChange(initial, price);
    const shop = getShop(best.pageUrl);
    const name = cleanName(g.name).slice(0, 50);

    let badgeHtml = '';
    if (pct !== null && pct < -5) {
      badgeHtml = `<span class="card-badge badge-drop">📉 ${pct.toFixed(1)}%</span>`;
    } else if (pct !== null && pct > 5) {
      badgeHtml = `<span class="card-badge badge-rise">📈 +${pct.toFixed(1)}%</span>`;
    }

    html += `
      <div class="card" onclick="showGroupDetail('${escHtml(g.name)}')">
        <div class="card-header">
          <div class="card-name">${escHtml(name)}</div>
          ${badgeHtml}
        </div>
        <div class="card-price">${fmtPrice(price)} <span class="currency">грн</span></div>
        <div class="card-meta">
          <span>🏪 ${escHtml(shop)}</span>
          <span>📦 ${g.trackers.length} магазинов</span>
          ${Number(best.minPrice) > 0 ? `<span>📉 мин: ${fmtPrice(best.minPrice)}</span>` : ''}
        </div>
      </div>`;
  }

  content.innerHTML = html;
}

// ─── Groups Tab ───────────────────────────────────────────────────

function renderGroups() {
  const groups = getGroupedTrackers();
  const ungrouped = allTrackers.filter(t => !t.productGroup && t.status !== 'paused');

  if (groups.length === 0 && ungrouped.length === 0) {
    content.innerHTML = `<div class="empty-state"><div class="emoji">📦</div><p>Групп пока нет</p></div>`;
    return;
  }

  let html = '';
  for (const g of groups) {
    const prices = g.trackers.map(t => Number(t.currentPrice)).filter(p => p > 0);
    const best = prices.length > 0 ? Math.min(...prices) : 0;

    html += `
      <div class="card group-card" onclick="showGroupDetail('${escHtml(g.name)}')">
        <div class="group-header">
          <div class="group-name">${escHtml(g.name.slice(0, 45))}</div>
          <span class="group-count">${g.trackers.length}</span>
        </div>
        <div class="group-best">${best > 0 ? '💰 ' + fmtPrice(best) + ' грн' : ''}</div>
      </div>`;
  }

  if (ungrouped.length > 0) {
    html += `<div class="card group-card" onclick="showUngrouped()">
      <div class="group-header">
        <div class="group-name">📎 Без группы</div>
        <span class="group-count">${ungrouped.length}</span>
      </div>
    </div>`;
  }

  content.innerHTML = html;
}

// ─── All Trackers Tab ─────────────────────────────────────────────

function renderAll() {
  const active = allTrackers.filter(t => t.status !== 'paused');

  let html = `<div class="search-bar"><input type="text" placeholder="🔍 Поиск..." value="${escHtml(searchQuery)}" oninput="onSearch(this.value)"></div>`;

  const filtered = searchQuery
    ? active.filter(t => (t.productName || '').toLowerCase().includes(searchQuery.toLowerCase()))
    : active;

  if (filtered.length === 0) {
    html += `<div class="empty-state"><div class="emoji">📋</div><p>Ничего не найдено</p></div>`;
    content.innerHTML = html;
    return;
  }

  for (const t of filtered) {
    html += renderTrackerCard(t);
  }

  content.innerHTML = html;
}

function onSearch(val) {
  searchQuery = val;
  renderAll();
  // Restore focus
  const input = content.querySelector('input');
  if (input) { input.focus(); input.selectionStart = input.selectionEnd = val.length; }
}

function renderTrackerCard(t) {
  const name = cleanName(t.productName).slice(0, 45);
  const shop = getShop(t.pageUrl);
  const price = Number(t.currentPrice);
  const prev = Number(t.previousPrice);
  const pct = prev > 0 && price !== prev ? pctChange(prev, price) : null;

  let badgeHtml = '';
  if (t.status === 'error') {
    badgeHtml = `<span class="card-badge badge-rise">❌</span>`;
  } else if (pct !== null && pct < 0) {
    badgeHtml = `<span class="card-badge badge-drop">${pct.toFixed(1)}%</span>`;
  } else if (pct !== null && pct > 0) {
    badgeHtml = `<span class="card-badge badge-rise">+${pct.toFixed(1)}%</span>`;
  }

  const min = Number(t.minPrice);
  const max = Number(t.maxPrice);
  let rangeHtml = '';
  if (min > 0 && max > 0 && max > min && price > 0) {
    const pctPos = Math.min(100, Math.max(0, ((price - min) / (max - min)) * 100));
    rangeHtml = `
      <div class="card-range">
        <div class="card-range-fill" style="width:${pctPos}%"></div>
        <div class="card-range-marker" style="left:${pctPos}%"></div>
      </div>`;
  }

  return `
    <div class="card" onclick="showTrackerDetail(${t.id})">
      <div class="card-header">
        <div class="card-name">${escHtml(name)}</div>
        ${badgeHtml}
      </div>
      <div class="card-price">${fmtPrice(price)} <span class="currency">грн</span></div>
      <div class="card-meta">
        <span>🏪 ${escHtml(shop)}</span>
        ${min > 0 ? `<span>📉 ${fmtPrice(min)}</span>` : ''}
        ${max > 0 ? `<span>📈 ${fmtPrice(max)}</span>` : ''}
      </div>
      ${rangeHtml}
    </div>`;
}

// ─── Group Detail View ────────────────────────────────────────────

function showGroupDetail(groupName) {
  const trackers = allTrackers
    .filter(t => t.productGroup === groupName && t.status !== 'paused')
    .sort((a, b) => (Number(a.currentPrice) || Infinity) - (Number(b.currentPrice) || Infinity));

  if (trackers.length === 0) {
    content.innerHTML = `<div class="empty-state"><p>Группа пуста</p></div>`;
    return;
  }

  tg.BackButton.show();
  tg.BackButton.onClick(() => { tg.BackButton.hide(); renderTab(); });

  const bestPrice = Math.min(...trackers.filter(t => Number(t.currentPrice) > 0).map(t => Number(t.currentPrice)));

  let html = `<div class="detail-title">📦 ${escHtml(groupName.slice(0, 50))}</div>`;

  for (const t of trackers) {
    const price = Number(t.currentPrice);
    const isBest = price > 0 && price === bestPrice;
    const name = cleanName(t.productName).slice(0, 45);
    const shop = getShop(t.pageUrl);

    let badge = `<span class="card-badge badge-shop">${escHtml(shop)}</span>`;
    if (isBest) badge = `<span class="card-badge badge-best">🏆 Лучшая</span>`;

    const min = Number(t.minPrice);
    const max = Number(t.maxPrice);
    let rangeHtml = '';
    if (min > 0 && max > 0 && max > min && price > 0) {
      const pctPos = Math.min(100, Math.max(0, ((price - min) / (max - min)) * 100));
      rangeHtml = `<div class="card-range"><div class="card-range-fill" style="width:${pctPos}%"></div><div class="card-range-marker" style="left:${pctPos}%"></div></div>`;
    }

    html += `
      <div class="card" onclick="showTrackerDetail(${t.id})">
        <div class="card-header">
          <div class="card-name">${escHtml(name)}</div>
          ${badge}
        </div>
        <div class="card-price">${fmtPrice(price)} <span class="currency">грн</span></div>
        <div class="card-meta">
          <span>🏪 ${escHtml(shop)}</span>
          ${min > 0 ? `<span>мин: ${fmtPrice(min)}</span>` : ''}
          ${max > 0 ? `<span>макс: ${fmtPrice(max)}</span>` : ''}
        </div>
        ${rangeHtml}
      </div>`;
  }

  content.innerHTML = html;
}

function showUngrouped() {
  const trackers = allTrackers
    .filter(t => !t.productGroup && t.status !== 'paused')
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  tg.BackButton.show();
  tg.BackButton.onClick(() => { tg.BackButton.hide(); renderTab(); });

  let html = `<div class="detail-title">📎 Без группы</div>`;
  for (const t of trackers) {
    html += renderTrackerCard(t);
  }
  content.innerHTML = html;
}

// ─── Tracker Detail View ──────────────────────────────────────────

async function showTrackerDetail(id) {
  const t = allTrackers.find(tr => tr.id === id);
  if (!t) return;

  tg.BackButton.show();
  tg.BackButton.onClick(() => {
    tg.BackButton.hide();
    if (t.productGroup) showGroupDetail(t.productGroup);
    else renderTab();
  });

  const name = cleanName(t.productName);
  const shop = getShop(t.pageUrl);
  const price = Number(t.currentPrice);
  const initial = Number(t.initialPrice);
  const min = Number(t.minPrice);
  const max = Number(t.maxPrice);
  const prev = Number(t.previousPrice);

  let changeHtml = '';
  if (prev > 0 && prev !== price) {
    const diff = price - prev;
    const pct = pctChange(prev, price);
    const cls = diff > 0 ? 'positive' : 'negative';
    const sign = diff > 0 ? '+' : '';
    changeHtml = `<div class="detail-change ${cls}">${sign}${fmtPrice(Math.abs(diff))} грн (${sign}${pct.toFixed(1)}%)</div>`;
  }

  let html = `
    <div class="detail-title">${escHtml(name)}</div>
    <div class="detail-price-block">
      <div class="detail-current-price">${fmtPrice(price)} <span class="currency">грн</span></div>
      ${changeHtml}
      <div style="font-size:12px;color:var(--hint);margin-top:6px">🏪 ${escHtml(shop)}</div>
    </div>

    <div class="detail-stats">
      <div class="stat-box">
        <div class="stat-label">Начальная</div>
        <div class="stat-value">${fmtPrice(initial)}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Минимум</div>
        <div class="stat-value" style="color:var(--accent)">${fmtPrice(min)}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Максимум</div>
        <div class="stat-value" style="color:var(--danger)">${fmtPrice(max)}</div>
      </div>
    </div>

    <a class="detail-link" href="${t.pageUrl}" target="_blank">🔗 Открыть в магазине</a>
  `;

  // Load price history
  html += `<div class="history-section"><div class="history-title">📈 История цен</div><div id="historyList"><div class="loading"><div class="spinner"></div></div></div></div>`;

  content.innerHTML = html;

  // Fetch history
  const history = await api(`/priceHistory?trackerId=${id}`);
  const histEl = document.getElementById('historyList');
  if (!history || history.length === 0) {
    histEl.innerHTML = '<p style="color:var(--hint);font-size:13px">Нет данных</p>';
    return;
  }

  const sorted = history.filter(h => Number(h.price) > 0).sort((a, b) => new Date(b.checkedAt) - new Date(a.checkedAt)).slice(0, 30);

  let listHtml = '<div class="history-list">';
  let prevP = null;
  for (const h of sorted) {
    const p = Number(h.price);
    let icon = '➡️';
    if (prevP !== null) {
      if (p < prevP) icon = '📈'; // older was higher
      else if (p > prevP) icon = '📉'; // older was lower
    }
    listHtml += `<div class="history-item"><span class="history-price">${icon} ${fmtPrice(p)} грн</span><span class="history-date">${fmtDate(h.checkedAt)}</span></div>`;
    prevP = p;
  }
  listHtml += '</div>';
  histEl.innerHTML = listHtml;
}

// ─── Settings Tab ─────────────────────────────────────────────────

async function renderSettings() {
  const settings = await api('/settings/global') || {};

  let html = `
    <div class="settings-section">
      <div class="settings-title">🔔 Уведомления</div>
      <div class="settings-row">
        <span class="settings-label">Уведомления</span>
        <span class="settings-value">${settings.notificationsEnabled ? '✅ Вкл' : '❌ Выкл'}</span>
      </div>
      <div class="settings-row">
        <span class="settings-label">Дайджест в Telegram</span>
        <span class="settings-value">${settings.telegramDigestEnabled ? '✅ Вкл' : '❌ Выкл'}</span>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-title">📊 Информация</div>
      <div class="settings-row">
        <span class="settings-label">Всего трекеров</span>
        <span class="settings-value">${allTrackers.length}</span>
      </div>
      <div class="settings-row">
        <span class="settings-label">Активных</span>
        <span class="settings-value">${allTrackers.filter(t => t.status === 'active').length}</span>
      </div>
      <div class="settings-row">
        <span class="settings-label">Групп</span>
        <span class="settings-value">${new Set(allTrackers.filter(t => t.productGroup).map(t => t.productGroup)).size}</span>
      </div>
      <div class="settings-row">
        <span class="settings-label">Chat ID</span>
        <span class="settings-value">${settings.telegramChatId || '—'}</span>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-title">ℹ️ О приложении</div>
      <div class="settings-row">
        <span class="settings-label">Версия</span>
        <span class="settings-value">1.0.0</span>
      </div>
      <div class="settings-row">
        <span class="settings-label">Трекеры добавляются</span>
        <span class="settings-value">Через расширение</span>
      </div>
    </div>
  `;

  content.innerHTML = html;
}

// ─── Data Helpers ─────────────────────────────────────────────────

function getGroupedTrackers() {
  const map = {};
  for (const t of allTrackers) {
    if (!t.productGroup || t.status === 'paused') continue;
    if (!map[t.productGroup]) map[t.productGroup] = [];
    map[t.productGroup].push(t);
  }

  return Object.entries(map)
    .map(([name, trackers]) => ({ name, trackers }))
    .sort((a, b) => {
      // Sort by best price availability, then by name
      const aPrice = Math.min(...a.trackers.filter(t => Number(t.currentPrice) > 0).map(t => Number(t.currentPrice)));
      const bPrice = Math.min(...b.trackers.filter(t => Number(t.currentPrice) > 0).map(t => Number(t.currentPrice)));
      if (aPrice === Infinity && bPrice !== Infinity) return 1;
      if (bPrice === Infinity && aPrice !== Infinity) return -1;
      return a.name.localeCompare(b.name);
    });
}

// ─── Init ─────────────────────────────────────────────────────────

async function init() {
  await loadData();

  // Check URL params for deep linking
  const params = new URLSearchParams(window.location.search);
  if (params.get('page') === 'settings') {
    currentTab = 'settings';
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === 'settings');
    });
  }

  renderTab();
}

init();
