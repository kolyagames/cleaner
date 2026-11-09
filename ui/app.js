import * as S3 from './scenes.js';

// ------------------------------------------------------------------ утилиты
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => {
  const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']; let i = 0; n = +n || 0;
  while (Math.abs(n) >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i ? n.toFixed(Math.abs(n) < 10 ? 2 : 1) : n.toFixed(0)) + ' ' + u[i];
};
const num = n => (+n || 0).toLocaleString('ru-RU');
const plural = (n, a, b, c) => { n = Math.abs(n) % 100; const m = n % 10; return n > 10 && n < 20 ? c : m > 1 && m < 5 ? b : m === 1 ? a : c; };
const api = {
  get: p => fetch(p, { cache: 'no-store' }).then(r => r.json()),
  post: (p, b = {}) => fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cleaner': '1' },
    body: JSON.stringify(b) }).then(r => r.json()),
};
const store = {
  get(k, d) { try { const v = localStorage.getItem('dc.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('dc.' + k, JSON.stringify(v)); } catch { /* приватный режим */ } },
};

// ------------------------------------------------------------------ иконки (в духе SF Symbols)
const P = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  home: P('<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>'),
  sparkle: P('<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
  trash: P('<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10 11v5.5M14 11v5.5"/>'),
  clock: P('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  cube: P('<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M12 12 20 7.5M12 12v9M12 12 4 7.5"/>'),
  disk: P('<ellipse cx="12" cy="6.5" rx="8" ry="3"/><path d="M4 6.5v11c0 1.7 3.6 3 8 3s8-1.3 8-3v-11"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'),
  chart: P('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  list: P('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
  wand: P('<path d="m4 20 11-11"/><path d="m14 5 1-2 1 2 2 1-2 1-1 2-1-2-2-1z"/><path d="m19 11 .6-1.2L21 9.2l-1.4-.6L19 7.4l-.6 1.2-1.2.6 1.2.6z"/>'),
  shield: P('<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>'),
  power: P('<path d="M12 3v8"/><path d="M6.3 7.2a8 8 0 1 0 11.4 0"/>'),
  folder: P('<path d="M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V9a1.5 1.5 0 0 0-1.5-1.5H12L10 5H4.5A1.5 1.5 0 0 0 3 6.5z"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  globe: P('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.5 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.5-3.5-8.5S9.5 6.1 12 3.5z"/>'),
  chat: P('<path d="M20 11.5c0 4-3.6 7-8 7-1.2 0-2.3-.2-3.3-.6L4 19.5l1.3-3.6C4.5 14.6 4 13.1 4 11.5c0-4 3.6-7 8-7s8 3 8 7z"/>'),
  game: P('<path d="M7 8h10a4 4 0 0 1 4 4v1.5a3.5 3.5 0 0 1-6.3 2.1L14 14.5h-4l-.7 1.1A3.5 3.5 0 0 1 3 13.5V12a4 4 0 0 1 4-4z"/><path d="M8 10.5v3M6.5 12h3"/><circle cx="15.5" cy="11" r=".6"/><circle cx="17" cy="13" r=".6"/>'),
  chip: P('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5"/>'),
  play: P('<circle cx="12" cy="12" r="8.5"/><path d="m10 8.5 5.5 3.5-5.5 3.5z"/>'),
  doc: P('<path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5z"/><path d="M14 3v4.5h4.5M9 12.5h6M9 16h6"/>'),
  code: P('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>'),
  dots: P('<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>'),
  windows: P('<path d="M3.5 5.5 10.5 4.5v7h-7zM13 4.2l7.5-1v8.3H13zM3.5 13h7v7l-7-1zM13 13h7.5v8l-7.5-1z"/>'),
  copy: P('<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>'),
  chev: P('<path d="m6 9 6 6 6-6"/>'),
  refresh: P('<path d="M20 11a8 8 0 0 0-14.3-4.3L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.3L20 15"/><path d="M20 20v-5h-5"/>'),
  bolt: P('<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>'),
  reveal: P('<path d="M14 4h6v6M20 4l-8.5 8.5"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>'),
  download: P('<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>'),
  search: P('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  check: P('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  heart: P('<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>'),
  empty: P('<path d="M3 12h4l2 3h6l2-3h4"/><path d="M5.5 5h13L21 12v6a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18v-6z"/>'),
};

const GROUP_META = {
  'Windows': ['windows', '#0071e3'], 'Браузеры': ['globe', '#30b0c7'], 'Мессенджеры': ['chat', '#34c759'],
  'Игры и лаунчеры': ['game', '#af52de'], 'Драйверы и железо': ['chip', '#ff9f0a'], 'Медиа и стриминг': ['play', '#ff2d55'],
  'Офис, облака, утилиты': ['doc', '#5856d6'], 'Разработка': ['code', '#1d1d1f'], 'Прочее': ['dots', '#8e8e93'],
};
const PAGES = [
  { id: 'overview', title: 'Обзор', icon: 'home', color: '#0071e3' },
  { id: 'system', title: 'Очистка системы', icon: 'sparkle', color: '#34c759' },
  { id: 'junk', title: 'Мусор и копии', icon: 'trash', color: '#ff9f0a' },
  { id: 'dups', title: 'Дубликаты', icon: 'copy', color: '#007aff' },
  { id: 'unused', title: 'Бесполезные файлы', icon: 'clock', color: '#af52de' },
  { id: 'games', title: 'Старые игры', icon: 'game', color: '#ff6b35' },
  { id: 'analyze', title: 'Анализ места', icon: 'cube', color: '#30b0c7' },
  { id: 'disks', title: 'Диски', icon: 'disk', color: '#5856d6' },
  { id: 'results', title: 'Результаты', icon: 'chart', color: '#ff2d55' },
  { id: 'log', title: 'Журнал', icon: 'list', color: '#8e8e93' },
];
const JUNK_RULES = [
  ['temp', 'Временные и служебные файлы', '.tmp, Thumbs.db, ~$ lock-файлы, недокачанные загрузки'],
  ['copies', 'Копии файлов', '«файл (2)», «Копия», «Copy of», «копія», «Kopie», «副本»… — на 25+ языках'],
  ['dups', 'Дубликаты по содержимому', 'одинаковые файлы в разных папках (сверка хэшем)'],
  ['backup', 'Бэкапы и старые логи', '.bak, .old, логи старше недели'],
  ['zero', 'Пустые файлы', 'размер 0 байт'],
  ['empty', 'Пустые папки', 'отмечается только верхняя пустая папка'],
  ['lnk', 'Битые ярлыки', 'на рабочем столе, в меню Пуск и в выбранных папках'],
  ['installers', 'Старые установщики в Загрузках', '.exe, .msi, .iso, архивы'],
  ['big', 'Большие файлы', 'просто показать — решите сами'],
];

function newList() { return { items: [], byId: new Map(), filter: 'all', q: '', sort: 'conf', reason: null, view: [], dirty: true }; }

const st = {
  page: store.get('page', 'overview'), server: null, cats: {}, sel: store.get('sel', null), showAll: store.get('showAll', false),
  dry: store.get('dry', false), ageH: store.get('ageH', 24), closed: store.get('closed', {}),
  lists: { junk: newList(), unused: newList(), dups: newList() },
  dupRoots: store.get('dupRoots', null), dupOpts: store.get('dupOpts', { min_mb: 1, types: null, mode: 'content' }),
  dupStrategy: store.get('dupStrategy', 'oldest'), dupShow: 120,
  games: null, gamesInfo: {}, gamesDays: store.get('gamesDays', 90), gamesFilter: store.get('gamesFilter', 'old'),
  gamesSort: store.get('gamesSort', 'last'),
  junkRoots: store.get('junkRoots', null), junkOpts: store.get('junkOpts', { temp: true, copies: true, dups: true, backup: true,
    zero: true, empty: true, lnk: true, installers: true, big: false, dup_min_mb: 1, big_min_mb: 500, installer_days: 30 }),
  unusedRoots: store.get('unusedRoots', null), unusedOpts: store.get('unusedOpts', { days: 180, min_mb: 10, types: null, use_atime: true }),
  analyze: { path: null, rows: [], total: 0, parent: null }, disks: null, disksLoading: false,
  logs: [], seq: 0, running: null, status: '', queue: [], replay: true, offline: false,
};
const save = () => {
  ['sel', 'showAll', 'dry', 'ageH', 'closed', 'junkRoots', 'junkOpts', 'unusedRoots', 'unusedOpts', 'page',
    'dupRoots', 'dupOpts', 'dupStrategy', 'gamesDays', 'gamesFilter', 'gamesSort']
    .forEach(k => store.set(k, st[k]));
};

// ------------------------------------------------------------------ тосты и диалоги
function toast(title, text = '', ms = 4200) {
  const t = document.createElement('div'); t.className = 'toast';
  t.innerHTML = `<b>${esc(title)}</b>${text ? `<span>${esc(text)}</span>` : ''}`;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s, transform .3s'; t.style.opacity = 0; t.style.transform = 'translateX(30px)'; setTimeout(() => t.remove(), 320); }, ms);
}
function modal(html) { $('#modal').innerHTML = html; $('#modalBack').hidden = false; }
function closeModal() { $('#modalBack').hidden = true; $('#modal').innerHTML = ''; }
function confirmBox({ title, text, ok = 'Продолжить', danger = false, list = [] }) {
  return new Promise(res => {
    modal(`<h2>${esc(title)}</h2><p class="lead">${esc(text)}</p>
      ${list.length ? `<div class="card" style="background:var(--fill2);box-shadow:none;max-height:240px;overflow:auto">${list.map(x => `<div style="padding:3px 0">${esc(x)}</div>`).join('')}</div>` : ''}
      <div class="wz-foot"><div class="grow"></div><button class="btn" data-m="no">Отмена</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" data-m="yes">${esc(ok)}</button></div>`);
    $('#modal').onclick = e => { const b = e.target.closest('[data-m]'); if (!b) return; $('#modal').onclick = null; closeModal(); res(b.dataset.m === 'yes'); };
  });
}

// ------------------------------------------------------------------ навигация
function renderNav() {
  const badge = id => {
    if (id === 'junk' && st.lists.junk.items.length) return st.lists.junk.items.length;
    if (id === 'unused' && st.lists.unused.items.length) return st.lists.unused.items.length;
    if (id === 'dups' && st.lists.dups.items.length) return dupGroups().length;
    if (id === 'games' && st.games) return st.games.filter(isOld).length;
    return '';
  };
  $('#nav').innerHTML = PAGES.map(p => `<button class="nav-item ${st.page === p.id ? 'active' : ''}" data-act="go" data-id="${p.id}">
    <span class="nav-ico" style="background:${p.color}">${I[p.icon]}</span>${p.title}
    ${badge(p.id) ? `<span class="nav-badge">${num(badge(p.id))}</span>` : ''}</button>`).join('');
  const adm = st.server?.admin;
  $('#btnAdmin').innerHTML = `${I.shield}${adm ? 'Администратор' : 'Права администратора'}`;
  $('#btnAdmin').classList.toggle('ok', !!adm);
  $('#btnWizard').innerHTML = `${I.wand}Тест-мастер`;
  $('#btnQuit').innerHTML = `${I.power}Выход`;
  $('#brandSub').textContent = `диска · v${st.server?.version || ''}`;
}
function go(id) {
  if (!PAGES.find(p => p.id === id)) id = 'overview';
  st.page = id; save(); renderNav(); renderPage();
  $('#main').scrollTop = 0;
}

// ------------------------------------------------------------------ рендер страниц
function renderPage() {
  S3.disposeAll();
  const f = PAGE_RENDER[st.page] || PAGE_RENDER.overview;
  $('#main').innerHTML = `<div class="page" id="page">${f()}</div>`;
  (PAGE_MOUNT[st.page] || (() => {}))();
}
let upd = null;
const updParts = new Set();
function update(part) {
  if (part) updParts.add(part);
  if (upd) return;
  upd = requestAnimationFrame(() => {
    upd = null;
    const parts = [...updParts]; updParts.clear();
    const f = PAGE_UPDATE[st.page];
    if (f) for (const p of parts) f(p);
    renderNav();
  });
}
const head = (title, sub, right = '') => `<div class="page-head"><div><h1 class="page-title">${title}</h1>
  ${sub ? `<div class="page-sub">${sub}</div>` : ''}</div><div class="spacer"></div>${right}</div>`;

// ---------- данные категорий
const cats = () => st.server?.categories || [];
const catFound = c => (st.cats[c.id]?.found ?? c.found);
const visibleCats = () => cats().filter(c => st.showAll || catFound(c));
const catSize = c => st.cats[c.id]?.size;
function selectedTotal() {
  return visibleCats().filter(c => st.sel[c.id]).reduce((a, c) => a + (catSize(c) || 0), 0);
}
const scanned = () => Object.keys(st.cats).length > 0;

// ================================================================== ОБЗОР
function sysDrive() { return (st.server?.drives || []).find(d => d.root.toUpperCase().startsWith('C')) || st.server?.drives?.[0]; }
function diskKind(root) { return st.disks?.find(d => d.root === root)?.kind || 'SSD'; }

function pageOverview() {
  const d = sysDrive(); const s = st.server.stats;
  const found = cats().filter(catFound).length;
  const can = scanned() ? fmt(selectedTotal()) : '—';
  const frac = d ? d.used / d.total : 0;
  return `
  <div class="card hero">
    <div>
      <div class="wz-step">Диск ${d ? d.root.slice(0, 2) : ''} · ${d ? fmt(d.free) + ' свободно' : ''}</div>
      <h2>Больше места.<br><span class="grad">Меньше мусора.</span></h2>
      <p>Кэши ${found} ${plural(found, 'программы', 'программ', 'программ')}, временные файлы, копии «(2)» и «Копия», дубликаты и то, что вы не открывали годами — всё в одном месте.</p>
      <div class="row">
        <button class="btn primary big" data-act="quick">${I.bolt}Быстрая очистка</button>
        <button class="btn big" data-act="wizard">${I.wand}Пройти тест</button>
      </div>
    </div>
    <div class="hero-3d" id="hero3d"><div class="stage-hint">потяните мышью, чтобы покрутить</div></div>
  </div>
  <div class="grid g4 mt">
    <div class="card stat"><div class="label"><i class="dot" style="background:var(--blue)"></i>Можно освободить</div>
      <div class="bignum blue" id="ovCan">${can}</div><div class="foot">${scanned() ? 'по выбранным категориям' : 'нажмите «Быстрая очистка»'}</div></div>
    <div class="card stat"><div class="label"><i class="dot" style="background:var(--green)"></i>Освобождено всего</div>
      <div class="bignum green">${fmt(s.total)}</div><div class="foot">за всё время работы программы</div></div>
    <div class="card stat"><div class="label"><i class="dot" style="background:var(--purple)"></i>За эту сессию</div>
      <div class="bignum">${fmt(s.session)}</div><div class="foot">${s.session_binned ? fmt(s.session_binned) + ' ушло в Корзину' : 'с момента запуска'}</div></div>
    <div class="card stat"><div class="label"><i class="dot" style="background:var(--orange)"></i>Найдено программ</div>
      <div class="bignum">${found}</div><div class="foot">из ${cats().length} известных</div></div>
  </div>
  <div class="grid g2 mt">
    <div class="card"><h3 class="card-title">Диски</h3><div class="card-sub">Заполненность на сейчас</div>
      ${(st.server.drives || []).map(dr => {
        const p = dr.used / dr.total * 100;
        return `<div class="drive-mini mt"><span class="nav-ico" style="background:#5856d6;width:36px;height:36px">${I.disk}</span>
          <div class="meta"><div class="row"><b>Диск ${dr.root.slice(0, 2)}</b><span class="grow"></span>
          <span class="muted small">${fmt(dr.free)} свободно из ${fmt(dr.total)}</span></div>
          <div class="bar ${p > 90 ? 'warn' : ''}"><i style="width:${p.toFixed(1)}%"></i></div></div></div>`;
      }).join('')}
      <div class="mt"><button class="link" data-act="go" data-id="disks">Подробнее о дисках →</button></div>
    </div>
    <div class="card"><h3 class="card-title">Что сделать</h3><div class="card-sub">Ничего не удаляется без вашего подтверждения</div>
      <div class="quick mt">
        ${[['system', 'sparkle', '#34c759', 'Очистка системы', 'кэши браузеров, мессенджеров, игр, Windows'],
           ['junk', 'trash', '#ff9f0a', 'Мусор и копии', '«(2)», «Копия», «Copy», пустые папки, битые ярлыки'],
           ['dups', 'copy', '#007aff', 'Дубликаты', 'одинаковые файлы — оставить одну копию'],
           ['games', 'game', '#ff6b35', 'Старые игры', 'в которые давно не заходили'],
           ['unused', 'clock', '#af52de', 'Бесполезные файлы', 'не открывались дольше N дней'],
           ['analyze', 'cube', '#30b0c7', 'Что занимает место', '3D-карта папок']]
          .map(([id, ic, c, t, s2]) => `<button class="quick-item" data-act="go" data-id="${id}"><span class="qi" style="background:${c}">${I[ic]}</span>
            <div><b>${t}</b><span>${s2}</span></div></button>`).join('')}
      </div>
    </div>
  </div>`;
}
function mountOverview() {
  const d = sysDrive(); const el = $('#hero3d');
  if (!el) return;
  const s = S3.mountHero(el, { frac: d ? d.used / d.total : 0.5, free: d?.free, total: d?.total, root: d?.root });
  if (!s) el.innerHTML = `<div class="rl-empty">${I.disk}<div>3D недоступно в этом браузере</div></div>`;
}
function updateOverview() { const e = $('#ovCan'); if (e && scanned()) e.textContent = fmt(selectedTotal()); }

// ================================================================== ОЧИСТКА СИСТЕМЫ
function pageSystem() {
  const groups = st.server.groups;
  const vis = visibleCats();
  return head('Очистка системы', `${cats().length} категорий для ${cats().filter(catFound).length} найденных программ и Windows. Логины, история, сохранения игр и личные файлы не трогаются.`) + `
  <div class="toolbar">
    <button class="btn primary" data-act="sysScan">${I.search}Сканировать</button>
    <button class="btn green" data-act="sysClean">${I.sparkle}Очистить выбранное</button>
    <div class="seg"><button class="${!st.showAll ? 'on' : ''}" data-act="showAll" data-v="0">Установленные</button>
      <button class="${st.showAll ? 'on' : ''}" data-act="showAll" data-v="1">Все</button></div>
    <div class="seg"><button data-act="selMode" data-v="default">По умолчанию</button><button data-act="selMode" data-v="all">Всё</button>
      <button data-act="selMode" data-v="none">Ничего</button></div>
    <label class="inline small"><span class="switch"><input type="checkbox" data-bind="dry" ${st.dry ? 'checked' : ''}><span class="track"></span></span>Пробный прогон</label>
    <label class="inline small">Temp старше <input class="field num" type="number" min="0" max="720" data-bind="ageH" value="${st.ageH}"> ч</label>
    <div class="sum-pill" id="sumPill">${sumPill()}</div>
  </div>
  ${groups.map(g => {
    const list = vis.filter(c => c.group === g);
    if (!list.length) return '';
    return groupCard(g, list);
  }).join('')}`;
}
function sumPill() {
  const n = visibleCats().filter(c => st.sel[c.id]).length;
  return scanned() ? `Выбрано ${n} · <em>${fmt(selectedTotal())}</em>` : `Выбрано ${n} ${plural(n, 'категория', 'категории', 'категорий')}`;
}
function groupCard(g, list) {
  const [ic, col] = GROUP_META[g] || ['dots', '#8e8e93'];
  const on = list.filter(c => st.sel[c.id]).length;
  const size = list.reduce((a, c) => a + (catSize(c) || 0), 0);
  const all = cats().filter(c => c.group === g);
  return `<div class="card group-card ${st.closed[g] ? 'closed' : ''} mt" data-group="${esc(g)}">
    <div class="group-head" data-act="fold" data-g="${esc(g)}">
      <span class="gi" style="background:${col}">${I[ic]}</span>
      <div><h3>${esc(g)}</h3><div class="gmeta">найдено ${all.filter(catFound).length} из ${all.length} · выбрано ${on}</div></div>
      <span class="gsize">${scanned() ? fmt(size) : ''}</span>
      <label class="switch ${on && on < list.length ? 'mixed' : ''}" data-stop="1"><input type="checkbox" data-act="selGroup" data-g="${esc(g)}" ${on === list.length ? 'checked' : ''}><span class="track"></span></label>
      <span class="chev">${I.chev}</span>
    </div>
    <div class="cat-list">${list.map(catRow).join('')}</div></div>`;
}
function catRow(c) {
  const r = st.cats[c.id];
  const size = r ? (r.size ? fmt(r.size) : '<span class="size-zero">0 Б</span>') : '<span class="size-zero">—</span>';
  const note = r?.note || c.note;
  const adm = c.admin && !st.server.admin;
  return `<div class="cat ${catFound(c) ? '' : 'notfound'}" data-cat="${c.id}">
    <label class="switch"><input type="checkbox" data-act="selCat" data-id="${c.id}" ${st.sel[c.id] ? 'checked' : ''}><span class="track"></span></label>
    <div><div class="cname">${esc(c.name)}${adm ? '<span class="tag admin">нужен админ</span>' : ''}${c.to_bin ? '<span class="tag bin">в Корзину</span>' : ''}${c.age ? `<span class="tag age">старше ${st.ageH} ч</span>` : ''}${catFound(c) ? '' : '<span class="tag" style="background:var(--fill);color:var(--text3)">не найдено</span>'}</div>
      ${note ? `<div class="cnote">${esc(note)}</div>` : ''}</div>
    <div><div class="csize">${size}</div><div class="ccount">${r && r.count ? num(r.count) + ' ' + plural(r.count, 'файл', 'файла', 'файлов') : ''}</div></div></div>`;
}
function updateSystem(part) {
  if (part && part.startsWith('cat:')) {
    const id = part.slice(4); const c = cats().find(x => x.id === id); const row = document.querySelector(`[data-cat="${id}"]`);
    if (c && row) row.outerHTML = catRow(c);
  }
  for (const g of st.server.groups) {
    const card = document.querySelector(`[data-group="${CSS.escape(g)}"]`);
    if (!card) continue;
    const list = visibleCats().filter(c => c.group === g);
    const on = list.filter(c => st.sel[c.id]).length;
    card.querySelector('.gsize').textContent = scanned() ? fmt(list.reduce((a, c) => a + (catSize(c) || 0), 0)) : '';
    const sw = card.querySelector('.group-head .switch'); sw.classList.toggle('mixed', on > 0 && on < list.length);
    sw.querySelector('input').checked = on === list.length;
    const all = cats().filter(c => c.group === g);
    card.querySelector('.gmeta').textContent = `найдено ${all.filter(catFound).length} из ${all.length} · выбрано ${on}`;
  }
  const p = $('#sumPill'); if (p) p.innerHTML = sumPill();
}

async function sysScan(ids) {
  const r = await api.post('/api/scan_system', { age_h: st.ageH, ids });
  if (!r.ok) toast('Подождите', `Сейчас выполняется: ${r.busy}`);
}
async function sysClean() {
  const chosen = visibleCats().filter(c => st.sel[c.id] && catFound(c));
  if (!chosen.length) return toast('Ничего не выбрано', 'Включите переключатели у нужных категорий');
  if (!st.dry) {
    const ok = await confirmBox({ title: 'Очистить выбранное?', danger: true, ok: 'Очистить',
      text: 'Кэши, логи, Корзина и журналы удаляются безвозвратно. Помеченное «в Корзину» можно будет вернуть.',
      list: chosen.map(c => `• ${c.name}${catSize(c) != null ? ' — ' + fmt(catSize(c)) : ''}${c.to_bin ? ' (в Корзину)' : ''}`) });
    if (!ok) return;
  }
  const r = await api.post('/api/clean_system', { ids: chosen.map(c => c.id), dry: st.dry, age_h: st.ageH });
  if (!r.ok) toast('Подождите', `Сейчас выполняется: ${r.busy}`);
}

// ================================================================== СПИСОК РЕЗУЛЬТАТОВ (мусор / бесполезные)
const ROW_H = 56;
const reasonKey = r => r.split(/[:(«]/)[0].trim();
function listView(L) {
  if (!L.dirty) return L.view;
  const q = L.q.trim().toLowerCase();
  let v = L.items.filter(it => (L.filter === 'all' || it.conf === L.filter) && (!L.reason || reasonKey(it.reason) === L.reason)
    && (!q || it.path.toLowerCase().includes(q) || it.reason.toLowerCase().includes(q)));
  const rank = { 'высокая': 0, 'средняя': 1, 'низкая': 2 };
  const s = { conf: (a, b) => rank[a.conf] - rank[b.conf] || b.size - a.size, size: (a, b) => b.size - a.size,
    name: (a, b) => a.name.localeCompare(b.name, 'ru'), path: (a, b) => a.path.localeCompare(b.path, 'ru') }[L.sort];
  v.sort(s); L.view = v; L.dirty = false; return v;
}
function resultList(name, emptyText) {
  const L = st.lists[name];
  const counts = {};
  for (const it of L.items) { const k = reasonKey(it.reason); counts[k] = (counts[k] || 0) + 1; }
  const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  return `<div class="card" data-list="${name}">
    <div class="rl-head">
      <div class="seg">${[['all', 'Все'], ['высокая', 'Высокая'], ['средняя', 'Средняя'], ['низкая', 'Низкая']]
        .map(([v, t]) => `<button class="${L.filter === v ? 'on' : ''}" data-act="lFilter" data-l="${name}" data-v="${v}">${t}</button>`).join('')}</div>
      <input class="field search grow" placeholder="Поиск по пути или причине" data-act="lSearch" data-l="${name}" value="${esc(L.q)}" style="min-width:180px">
      <select class="field" data-act="lSort" data-l="${name}">${[['conf', 'По уверенности'], ['size', 'По размеру'], ['name', 'По имени'], ['path', 'По папке']]
        .map(([v, t]) => `<option value="${v}" ${L.sort === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
    </div>
    <div class="rl-chips" data-chips="${name}">${keys.length ? `<button class="chip ${!L.reason ? 'on' : ''}" data-act="lReason" data-l="${name}" data-v="">Все типы <span class="cnt">${num(L.items.length)}</span></button>` : ''}
      ${keys.map(k => `<button class="chip ${L.reason === k ? 'on' : ''}" data-act="lReason" data-l="${name}" data-v="${esc(k)}">${esc(k)} <span class="cnt">${num(counts[k])}</span></button>`).join('')}</div>
    <div class="rl-view" data-view="${name}"><div class="rl-spacer"></div></div>
    <div class="rl-foot">
      <button class="btn sm" data-act="lMark" data-l="${name}" data-v="view">Отметить показанные</button>
      <button class="btn sm" data-act="lMark" data-l="${name}" data-v="high">Только «высокая»</button>
      <button class="btn sm" data-act="lMark" data-l="${name}" data-v="none">Снять всё</button>
      <button class="btn sm" data-act="lExport" data-l="${name}">${I.download}CSV</button>
      <span class="grow"></span>
      <span class="muted small" data-sum="${name}"></span>
      <button class="btn danger" data-act="lDelete" data-l="${name}" data-v="perm">Удалить навсегда</button>
      <button class="btn primary" data-act="lDelete" data-l="${name}" data-v="bin">${I.trash}В Корзину</button>
    </div>
    <template data-empty="${name}">${emptyText}</template>
  </div>`;
}
function mountList(name) {
  const view = document.querySelector(`[data-view="${name}"]`);
  if (!view) return;
  view.onscroll = () => drawRows(name);
  drawRows(name, true);
}
function drawRows(name, full) {
  const L = st.lists[name];
  const view = document.querySelector(`[data-view="${name}"]`);
  if (!view) return;
  const v = listView(L);
  const sp = view.firstElementChild;
  if (!v.length) {
    const tpl = document.querySelector(`[data-empty="${name}"]`);
    sp.style.height = 'auto';
    sp.innerHTML = `<div class="rl-empty">${I.empty}<div>${L.items.length ? 'Ничего не подходит под фильтр' : (tpl?.innerHTML || 'Пусто')}</div></div>`;
  } else {
    sp.style.height = v.length * ROW_H + 'px';
    const top = view.scrollTop, h = view.clientHeight || 560;
    const a = Math.max(0, Math.floor(top / ROW_H) - 6), b = Math.min(v.length, Math.ceil((top + h) / ROW_H) + 6);
    let html = '';
    for (let i = a; i < b; i++) {
      const it = v[i];
      html += `<div class="rl-row" style="top:${i * ROW_H}px" data-act="lToggle" data-l="${name}" data-id="${it.id}">
        <button class="check ${it.checked ? 'on' : ''}" tabindex="-1"></button>
        <div style="min-width:0"><div class="fn">${it.is_dir ? '📁 ' : ''}${esc(it.name)}</div><div class="fp">${esc(it.dir)}</div></div>
        <div style="min-width:0"><span class="conf ${esc(it.conf)}">${esc(it.conf)}</span><div class="rs muted" title="${esc(it.reason)}">${esc(it.reason)}</div></div>
        <div class="row" style="justify-content:flex-end;gap:4px;flex-wrap:nowrap"><span class="sz">${it.is_dir ? 'папка' : fmt(it.size)}</span>
        <button class="icon-btn" data-act="reveal" data-path="${esc(it.path)}" title="Показать в Проводнике">${I.reveal}</button></div></div>`;
    }
    sp.innerHTML = html;
  }
  const chk = L.items.filter(i => i.checked);
  const sum = document.querySelector(`[data-sum="${name}"]`);
  if (sum) sum.textContent = L.items.length ? `Отмечено ${num(chk.length)} · ${fmt(chk.reduce((a, b) => a + b.size, 0))} из ${fmt(L.items.reduce((a, b) => a + b.size, 0))}` : '';
}
function refreshChips(name) {
  const box = document.querySelector(`[data-chips="${name}"]`);
  if (!box) return;
  const tmp = document.createElement('div'); tmp.innerHTML = resultList(name, '');
  box.innerHTML = tmp.querySelector(`[data-chips="${name}"]`).innerHTML;
}
async function listDelete(name, perm) {
  const L = st.lists[name];
  const chosen = L.items.filter(i => i.checked);
  if (!chosen.length) return toast('Ничего не отмечено', 'Нажмите на кружок слева от файла');
  const size = chosen.reduce((a, b) => a + b.size, 0);
  let extra = '';
  if (name === 'dups') {
    const full = dupGroups().filter(g => g.files.every(f => f.checked)).length;
    if (full) extra = ` В ${full} ${plural(full, 'группе', 'группах', 'группах')} отмечены все копии — по одной программа всё равно оставит.`;
  }
  if (!st.dry) {
    const ok = await confirmBox(perm
      ? { title: 'Удалить навсегда?', danger: true, ok: 'Удалить навсегда', text: `${num(chosen.length)} объектов, ${fmt(size)}. Вернуть их будет нельзя.${extra}` }
      : { title: 'Переместить в Корзину?', ok: 'В Корзину', text: `${num(chosen.length)} объектов, ${fmt(size)}. Их можно будет восстановить из Корзины.${extra}` });
    if (!ok) return;
  }
  const r = await api.post('/api/delete', { list: name, ids: chosen.map(i => i.id), permanent: perm, dry: st.dry });
  if (!r.ok) toast('Подождите', `Сейчас выполняется: ${r.busy}`);
}
function listExport(name) {
  const L = st.lists[name];
  const rows = [['Отмечен', 'Уверенность', 'Причина', 'Размер, байт', 'Путь']]
    .concat(L.items.map(i => [i.checked ? 'да' : '', i.conf, i.reason, i.size, i.path]));
  const csv = '\ufeff' + rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name === 'junk' ? 'мусор.csv' : 'бесполезные-файлы.csv';
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- корни (папки для поиска)
function rootsBox(key) {
  const roots = st[key];
  return `<div class="roots">${roots.map((r, i) => `<span class="chip on">${I.folder.replace('<svg', '<svg style="width:13px;height:13px"')}${esc(r)}<span class="x" data-act="rootDel" data-k="${key}" data-i="${i}">×</span></span>`).join('')}</div>
    <div class="row"><button class="btn sm" data-act="rootAdd" data-k="${key}">${I.plus}Папка</button>
    <button class="btn sm" data-act="rootDrives" data-k="${key}">${I.disk}Все диски</button>
    ${(st.server.known_roots || []).filter(r => !roots.includes(r)).slice(0, 4).map(r => `<button class="chip" data-act="rootQuick" data-k="${key}" data-v="${esc(r)}">+ ${esc(r.split('\\').pop())}</button>`).join('')}</div>`;
}

// ================================================================== МУСОР И КОПИИ
function pageJunk() {
  const o = st.junkOpts;
  return head('Мусор и копии', 'Ищет временные файлы, копии вида «(2)», «Копия», «Copy of», «копія», «Kopie», дубликаты, пустые папки и битые ярлыки. Windows, Program Files и AppData не трогаются.') + `
  <div class="side-layout">
    <div class="card">
      <h3 class="card-title">Где искать</h3>${rootsBox('junkRoots')}
      <div class="section-label">Что искать</div>
      ${JUNK_RULES.map(([k, t, s]) => `<div class="opt-row"><div class="ot">${t}<small>${s}</small></div>
        ${k === 'dups' ? `<input class="field num" type="number" min="0" data-bind="junkOpts.dup_min_mb" value="${o.dup_min_mb}" title="от, МБ">` : ''}
        ${k === 'big' ? `<input class="field num" type="number" min="1" data-bind="junkOpts.big_min_mb" value="${o.big_min_mb}" title="от, МБ">` : ''}
        ${k === 'installers' ? `<input class="field num" type="number" min="0" data-bind="junkOpts.installer_days" value="${o.installer_days}" title="старше, дн.">` : ''}
        <label class="switch"><input type="checkbox" data-bind="junkOpts.${k}" ${o[k] ? 'checked' : ''}><span class="track"></span></label></div>`).join('')}
      <button class="btn primary big mt" style="width:100%;justify-content:center" data-act="junkScan">${I.search}Найти мусор</button>
    </div>
    ${resultList('junk', 'Выберите папки и нажмите «Найти мусор»')}
  </div>`;
}
async function junkScan() {
  if (!st.junkRoots.length) return toast('Добавьте папку', 'Где искать мусор?');
  const r = await api.post('/api/junk_scan', { roots: st.junkRoots, opts: st.junkOpts });
  if (!r.ok) toast('Подождите', `Сейчас выполняется: ${r.busy}`);
}

// ================================================================== БЕСПОЛЕЗНЫЕ ФАЙЛЫ
function pageUnused() {
  const o = st.unusedOpts; const types = o.types || st.server.file_types.map(t => t.id);
  const la = st.server.last_access;
  const presets = [[30, 'Месяц'], [90, '3 месяца'], [180, 'Полгода'], [365, 'Год'], [730, '2 года'], [1095, '3 года']];
  return head('Бесполезные файлы', 'Файлы, которые вы давно не открывали. Ничего не отмечается само — смотрите список и решайте.') + `
  <div class="side-layout">
    <div class="card">
      <h3 class="card-title">Где искать</h3>${rootsBox('unusedRoots')}
      <div class="section-label">Не использовались дольше</div>
      <div class="row" style="align-items:baseline"><span class="bignum" id="daysLbl" style="font-size:28px">${o.days}</span><span class="muted">${plural(o.days, 'дня', 'дней', 'дней')}</span></div>
      <input type="range" min="7" max="1460" step="1" value="${o.days}" data-bind="unusedOpts.days" data-live="1">
      <div class="row" style="gap:6px">${presets.map(([d, t]) => `<button class="chip ${+o.days === d ? 'on' : ''}" data-act="daysPreset" data-v="${d}">${t}</button>`).join('')}</div>
      <div class="section-label">Размер файла от</div>
      <div class="row"><input class="field num" type="number" min="0" data-bind="unusedOpts.min_mb" value="${o.min_mb}"> МБ</div>
      <div class="section-label">Типы файлов</div>
      <div class="row" style="gap:6px">${st.server.file_types.map(t => `<button class="chip ${types.includes(t.id) ? 'on' : ''}" data-act="typeToggle" data-v="${t.id}">${esc(t.name)}</button>`).join('')}</div>
      <div class="section-label">Считать по дате</div>
      <div class="seg"><button class="${o.use_atime ? 'on' : ''}" data-act="atime" data-v="1">Последнего открытия</button>
        <button class="${!o.use_atime ? 'on' : ''}" data-act="atime" data-v="0">Изменения</button></div>
      <div class="small muted mt">${la === true ? '✓ Windows записывает дату последнего открытия файлов.' : la === false
        ? '⚠ В Windows отключена запись даты открытия — используется дата изменения, она надёжнее в этом случае.' : 'Не удалось узнать, ведёт ли Windows дату открытия.'}</div>
      <button class="btn primary big mt" style="width:100%;justify-content:center" data-act="unusedScan">${I.clock}Найти</button>
    </div>
    ${resultList('unused', 'Выберите папки, срок и нажмите «Найти»')}
  </div>`;
}
async function unusedScan() {
  if (!st.unusedRoots.length) return toast('Добавьте папку', 'Где искать?');
  const o = { ...st.unusedOpts };
  if (st.server.last_access === false) o.use_atime = false;
  const r = await api.post('/api/unused_scan', { roots: st.unusedRoots, opts: o });
  if (!r.ok) toast('Подождите', `Сейчас выполняется: ${r.busy}`);
}

// ================================================================== АНАЛИЗ МЕСТА
function pageAnalyze() {
  const A = st.analyze;
  const parts = A.path ? A.path.replace(/\\$/, '').split('\\') : [];
  const crumbs = parts.map((p, i) => {
    const path = parts.slice(0, i + 1).join('\\') + (i === 0 ? '\\' : '');
    return `<button data-act="analyze" data-path="${esc(path)}">${esc(p)}</button>`;
  }).join('<span class="sep">›</span>');
  return head('Анализ места', 'Какие папки занимают больше всего. Нажмите на блок или строку, чтобы зайти внутрь.',
    `<button class="btn" data-act="pickAnalyze">${I.folder}Выбрать папку</button>`) + `
  <div class="card">
    <div class="row">${(st.server.drives || []).map(d => `<button class="chip" data-act="analyze" data-path="${esc(d.root)}">${I.disk.replace('<svg', '<svg style="width:13px;height:13px"')}Диск ${d.root.slice(0, 2)}</button>`).join('')}
      ${(st.server.known_roots || []).map(r => `<button class="chip" data-act="analyze" data-path="${esc(r)}">${esc(r.split('\\').pop())}</button>`).join('')}</div>
    ${A.path ? `<div class="crumbs mt">${A.parent ? `<button data-act="analyze" data-path="${esc(A.parent)}">← Вверх</button><span class="sep">·</span>` : ''}${crumbs}
      <span class="grow"></span><b>${fmt(A.total)}</b></div>` : ''}
    <div class="city mt" id="city">${A.path ? '' : `<div class="rl-empty">${I.cube}<div>Выберите диск или папку — построю 3D-карту</div></div>`}</div>
    <div class="alist">${A.rows.map((r, i) => {
      const pct = A.total ? r.size / A.total * 100 : 0;
      const col = r.dir ? S3.PALETTE[i % S3.PALETTE.length] : '#c7c7cc';
      return `<div class="arow" data-act="${r.dir ? 'analyze' : 'reveal'}" data-path="${esc(r.path)}">
        <span class="sw" style="background:${col}"></span><span class="an">${r.dir ? '📁' : '📄'} ${esc(r.name)}</span>
        <div class="bar" style="margin:0"><i style="width:${pct.toFixed(1)}%;background:${col}"></i></div>
        <span class="as">${fmt(r.size)}</span><span class="ap">${pct.toFixed(1)}%</span></div>`;
    }).join('')}</div>
  </div>`;
}
function mountAnalyze() {
  const el = $('#city');
  if (el && st.analyze.path && st.analyze.rows.length) {
    const s = S3.mountCity(el, st.analyze.rows, row => row.dir ? analyze(row.path) : api.post('/api/reveal', { path: row.path }));
    if (!s) el.innerHTML = `<div class="rl-empty">${I.cube}<div>3D недоступно в этом браузере</div></div>`;
  }
}
async function analyze(path) {
  const r = await api.post('/api/analyze', { path });
  if (!r.ok) toast(r.busy ? 'Подождите' : 'Не получилось', r.busy ? `Сейчас выполняется: ${r.busy}` : 'Папка не найдена');
}

// ================================================================== ДИСКИ
function pageDisks() {
  if (!st.disks) {
    loadDisks();
    return head('Диски', 'Тип, состояние и заполненность каждого диска') + `<div class="card"><div class="rl-empty"><div class="spinner" style="border-color:#d2d2d7;border-top-color:var(--blue);margin:0 auto 12px"></div>Опрашиваю диски…</div></div>`;
  }
  return head('Диски', 'Тип, состояние и заполненность каждого диска. Модели можно крутить мышью.',
    `<button class="btn" data-act="disksReload">${I.refresh}Обновить</button>`) +
  st.disks.map((d, i) => {
    const pct = d.used / d.total * 100;
    const hb = d.health === 'Исправен' ? '' : d.health === 'Неисправен' ? 'bad' : d.health === '—' ? 'gray' : 'warn';
    return `<div class="card disk-card mt">
      <div class="disk-3d" id="disk3d${i}"><div class="stage-hint">${esc(d.kind)}</div></div>
      <div class="disk-info">
        <div class="row"><h3>Диск ${d.root.slice(0, 2)} ${d.label ? `<span class="muted" style="font-weight:500">· ${esc(d.label)}</span>` : ''}</h3>
          <span class="badge ${hb}">${esc(d.health)}</span>${d.system ? '<span class="badge gray">системный</span>' : ''}</div>
        <div class="muted">${esc(d.model || 'Модель неизвестна')}</div>
        <div class="bar ${pct > 90 ? 'warn' : ''}" style="height:10px;margin-top:14px"><i style="width:${pct.toFixed(1)}%"></i></div>
        <div class="row small muted" style="margin-top:6px"><span>Занято ${fmt(d.used)} (${pct.toFixed(0)}%)</span><span class="grow"></span><span>Свободно ${fmt(d.free)} из ${fmt(d.total)}</span></div>
        <div class="kv">
          <div><small>Тип</small><b>${esc(d.kind)}</b></div>
          <div><small>Шина</small><b>${esc(d.bus || '—')}</b></div>
          <div><small>Файловая система</small><b>${esc(d.fs || '—')}</b></div>
          <div><small>Температура</small><b>${d.temp ? d.temp + ' °C' : '—'}</b></div>
          <div><small>Износ</small><b>${d.wear != null ? d.wear + ' %' : '—'}</b></div>
          <div><small>Свободно с запуска</small><b>${(() => { const s = st.server.drives.find(x => x.root === d.root); const df = s ? d.free - s.start_free : 0; return df > 0 ? `<span class="plus">+${fmt(df)}</span>` : '—'; })()}</b></div>
        </div>
        <div class="row">
          <button class="btn sm primary" data-act="analyzeGo" data-path="${esc(d.root)}">${I.cube}Анализ места</button>
          <button class="btn sm" data-act="junkDrive" data-path="${esc(d.root)}">${I.trash}Найти мусор</button>
          <button class="btn sm" data-act="diskAct" data-l="${d.letter}" data-v="optimize">${I.bolt}${/SSD/.test(d.kind) ? 'TRIM / оптимизация' : 'Дефрагментация'}</button>
          <button class="btn sm" data-act="diskAct" data-l="${d.letter}" data-v="chkdsk">${I.check}Проверить</button>
          <button class="btn sm" data-act="diskAct" data-l="${d.letter}" data-v="cleanmgr">${I.windows}Очистка Windows</button>
        </div>
        ${!st.server.admin ? '<div class="small muted mt">Оптимизация и проверка требуют прав администратора.</div>' : ''}
      </div></div>`;
  }).join('');
}
function mountDisks() {
  (st.disks || []).forEach((d, i) => {
    const el = $('#disk3d' + i); if (!el) return;
    S3.mountDisk(el, { kind: d.kind, frac: d.used / d.total, model: d.model, sizeText: fmt(d.total) },
      { autoRotate: 0.9 + i * 0.15, cam: [6.6, 6.0, 9.3] });
  });
}
async function loadDisks(force) {
  if (st.disksLoading) return;
  st.disksLoading = true;
  try { st.disks = (await api.get('/api/disks')).disks; } catch { st.disks = []; }
  st.disksLoading = false;
  if (st.page === 'disks' || (st.page === 'overview' && force !== false)) renderPage();
}

// ================================================================== РЕЗУЛЬТАТЫ
function pageResults() {
  const s = st.server.stats;
  const drives = st.server.drives || [];
  const maxDay = Math.max(1, ...s.by_day.map(d => d.bytes));
  return head('Результаты', `Сколько места освободила программа${s.first_run ? ' с ' + new Date(s.first_run * 1000).toLocaleDateString('ru-RU') : ''}.`,
    `<button class="btn danger" data-act="statsReset">Сбросить статистику</button>`) + `
  <div class="grid g4">
    <div class="card stat"><div class="label"><i class="dot" style="background:var(--green)"></i>За эту сессию</div><div class="bignum green">${fmt(s.session)}</div><div class="foot">с момента запуска</div></div>
    <div class="card stat"><div class="label"><i class="dot" style="background:var(--blue)"></i>За всё время</div><div class="bignum blue">${fmt(s.total)}</div><div class="foot">${num(s.files)} ${plural(s.files, 'файл', 'файла', 'файлов')}</div></div>
    <div class="card stat"><div class="label"><i class="dot" style="background:var(--orange)"></i>Отправлено в Корзину</div><div class="bignum">${fmt(s.binned)}</div><div class="foot">освободится после очистки Корзины</div></div>
    <div class="card stat"><div class="label"><i class="dot" style="background:var(--purple)"></i>Очисток</div><div class="bignum">${num(s.history.length)}</div><div class="foot">операций в истории</div></div>
  </div>
  <div class="card mt"><h3 class="card-title">На чём сэкономлено больше всего</h3><div class="card-sub">3D-диаграмма, наведите на столбец</div>
    <div class="chart3d mt" id="bars3d">${s.by_what.length ? '' : `<div class="rl-empty">${I.chart}<div>Пока пусто — очистите что-нибудь, и здесь появится диаграмма</div></div>`}</div>
    ${s.by_what.length ? `<div class="row mt" style="gap:14px">${s.by_what.map((b, i) => `<span class="small"><i class="dot" style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${S3.PALETTE[i % S3.PALETTE.length]}"></i> ${esc(b.what)} — <b>${fmt(b.bytes)}</b></span>`).join('')}</div>` : ''}
  </div>
  <div class="grid g2 mt">
    <div class="card"><h3 class="card-title">Диски: было → стало</h3><div class="card-sub">Свободное место при запуске программы и сейчас</div>
      <table class="t mt"><tr><th>Диск</th><th class="r">При запуске</th><th class="r">Сейчас</th><th class="r">Разница</th></tr>
      ${drives.map(d => { const df = d.free - d.start_free; return `<tr><td><b>${d.root.slice(0, 2)}</b></td><td class="r">${fmt(d.start_free)}</td><td class="r">${fmt(d.free)}</td>
        <td class="r">${df > 0 ? `<span class="plus">+${fmt(df)}</span>` : df < 0 ? `<span class="muted">−${fmt(-df)}</span>` : '—'}</td></tr>`; }).join('')}</table></div>
    <div class="card"><h3 class="card-title">По дням</h3><div class="card-sub">Последние 30 дней с очистками</div>
      ${s.by_day.length ? `<div class="days">${s.by_day.map(d => `<div class="d" style="height:${Math.max(3, d.bytes / maxDay * 100)}%" data-t="${d.day.split('-').reverse().join('.')} — ${fmt(d.bytes)}"></div>`).join('')}</div>`
        : '<div class="rl-empty" style="padding:30px">Пока нет данных</div>'}</div>
  </div>
  <div class="card mt"><h3 class="card-title">История</h3>
    ${s.history.length ? `<table class="t mt"><tr><th>Когда</th><th>Что</th><th>Раздел</th><th class="r">Файлов</th><th class="r">Освобождено</th></tr>
      ${s.history.slice(0, 150).map(h => `<tr><td class="muted">${new Date(h.t * 1000).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</td>
        <td>${esc(h.what)}</td><td class="muted">${esc(h.source)}</td><td class="r">${h.files ? num(h.files) : ''}</td>
        <td class="r">${h.binned ? `<span class="muted">${fmt(h.bytes)} в Корзину</span>` : `<span class="plus">${fmt(h.bytes)}</span>`}</td></tr>`).join('')}</table>`
      : '<div class="rl-empty" style="padding:30px">Здесь будет список всех очисток</div>'}
  </div>`;
}
function mountResults() {
  const el = $('#bars3d'); const s = st.server.stats;
  if (el && s.by_what.length) S3.mountBars(el, s.by_what.map(b => ({ label: b.what, value: b.bytes })));
}

// ================================================================== ДУБЛИКАТЫ
const TYPE_COLORS = { video: '#ff2d55', audio: '#af52de', images: '#34c759', docs: '#0071e3', archives: '#ff9f0a',
  installers: '#5856d6', torrents: '#30b0c7', other: '#8e8e93' };
const TYPE_ICON = { video: 'play', audio: 'play', images: 'sparkle', docs: 'doc', archives: 'folder', installers: 'download',
  torrents: 'download', other: 'copy' };
let EXT_TYPE = null;
function extType(name) {
  if (!EXT_TYPE) { EXT_TYPE = {}; for (const t of st.server.file_types) for (const e of t.exts || []) EXT_TYPE[e] = t.id; }
  const m = /\.[^.\\]+$/.exec(name || '');
  return (m && EXT_TYPE[m[0].toLowerCase()]) || 'other';
}
function dupGroups() {
  const L = st.lists.dups;
  if (!L.dirty && L.groups) return L.groups;
  const map = new Map();
  for (const it of L.items) {
    let g = map.get(it.group);
    if (!g) { g = { id: it.group, files: [], size: it.size }; map.set(it.group, g); }
    g.files.push(it);
  }
  const groups = [...map.values()].filter(g => g.files.length > 1);
  for (const g of groups) { g.waste = g.size * (g.files.length - 1); g.type = extType(g.files[0].name); }
  groups.sort((a, b) => b.waste - a.waste);
  L.groups = groups; L.dirty = false;
  return groups;
}
function applyDupStrategy(s) {
  if (s !== 'none') { st.dupStrategy = s; save(); }
  for (const g of dupGroups()) {
    const f = g.files;
    let keep = f[0];
    if (s === 'oldest') keep = f.reduce((a, b) => ((b.mtime || 0) < (a.mtime || 0) ? b : a));
    else if (s === 'newest') keep = f.reduce((a, b) => ((b.mtime || 0) > (a.mtime || 0) ? b : a));
    else if (s === 'short') keep = f.reduce((a, b) => (b.path.length < a.path.length ? b : a));
    else if (s === 'alpha') keep = f.reduce((a, b) => (b.path.localeCompare(a.path, 'ru') < 0 ? b : a));
    for (const x of f) x.checked = s === 'none' ? false : x !== keep;
  }
}
function donut(parts, size = 150) {
  const total = parts.reduce((a, p) => a + p.v, 0) || 1;
  const r = 56, C = 2 * Math.PI * r;
  let off = 0;
  const segs = parts.map(p => {
    const len = (p.v / total) * C;
    const s = `<circle r="${r}" cx="75" cy="75" fill="none" stroke="${p.c}" stroke-width="20" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 75 75)"/>`;
    off += len; return s;
  }).join('');
  return `<svg class="donut" viewBox="0 0 150 150" width="${size}" height="${size}"><circle r="${r}" cx="75" cy="75" fill="none" stroke="#f0f0f3" stroke-width="20"/>${segs}</svg>`;
}
function dupSummary() {
  const groups = dupGroups();
  if (!groups.length) {
    return `<div class="rl-empty" style="padding:28px">${I.copy}<div>${st.lists.dups.items.length || st.running === 'Поиск дубликатов'
      ? 'Ищу…' : 'Выберите папки и нажмите «Найти дубликаты»'}</div></div>`;
  }
  const waste = groups.reduce((a, g) => a + g.waste, 0);
  const copies = groups.reduce((a, g) => a + g.files.length - 1, 0);
  const byType = {};
  for (const g of groups) byType[g.type] = (byType[g.type] || 0) + g.waste;
  const parts = Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, v]) => ({ t, v, c: TYPE_COLORS[t] || '#8e8e93' }));
  const tname = id => st.server.file_types.find(t => t.id === id)?.name || 'Прочее';
  return `<div class="dsum">${donut(parts)}
    <div><div class="row" style="gap:28px">
      <div class="stat"><div class="label">Лишние копии занимают</div><div class="bignum blue">${fmt(waste)}</div></div>
      <div class="stat"><div class="label">Групп</div><div class="bignum">${num(groups.length)}</div></div>
      <div class="stat"><div class="label">Лишних копий</div><div class="bignum">${num(copies)}</div></div></div>
      <div class="legend mt">${parts.map(p => `<span><i style="background:${p.c}"></i>${esc(tname(p.t))} — <b>${fmt(p.v)}</b></span>`).join('')}</div></div></div>`;
}
function dupGroupHtml(g) {
  const col = TYPE_COLORS[g.type] || '#8e8e93';
  return `<div class="dgroup"><div class="dg-head"><span class="dg-ico" style="background:${col}">${I[TYPE_ICON[g.type] || 'copy']}</span>
    <div style="min-width:0;flex:1"><div class="dg-name">${esc(g.files[0].name)}</div>
      <div class="dg-sub">${g.files.length} ${plural(g.files.length, 'копия', 'копии', 'копий')} по ${fmt(g.size)}</div></div>
    <span class="dg-waste">лишнее ${fmt(g.waste)}</span></div>
    ${g.files.map(f => `<div class="dfile ${f.checked ? 'del' : ''}" data-act="dupToggle" data-id="${f.id}">
      <button class="check ${f.checked ? 'on' : ''}" tabindex="-1"></button>
      <div class="dp" title="${esc(f.path)}">${f.checked ? '' : '<span class="keep" style="margin:0 6px 0 0">останется</span>'}${esc(f.path)}</div>
      <div class="dd">${f.mtime ? new Date(f.mtime * 1000).toLocaleDateString('ru-RU') : ''}</div>
      <button class="icon-btn" data-act="reveal" data-path="${esc(f.path)}" title="Показать в Проводнике">${I.reveal}</button></div>`).join('')}</div>`;
}
function dupListHtml() {
  const groups = dupGroups();
  if (!groups.length) return '';
  return groups.slice(0, st.dupShow).map(dupGroupHtml).join('') + (groups.length > st.dupShow
    ? `<div class="row mt" style="justify-content:center"><button class="btn" data-act="dupMore">Показать ещё ${num(Math.min(120, groups.length - st.dupShow))} из ${num(groups.length - st.dupShow)}</button></div>` : '');
}
function dupSelText() {
  const chk = st.lists.dups.items.filter(i => i.checked);
  return chk.length ? `К удалению ${num(chk.length)} · ${fmt(chk.reduce((a, b) => a + b.size, 0))}` : '';
}
function pageDups() {
  const o = st.dupOpts; const types = o.types;
  return head('Дубликаты', 'Одинаковые файлы в разных папках. В каждой группе одна копия остаётся — какую, выбираете вы. Удаление идёт в Корзину.') + `
  <div class="side-layout">
    <div class="card">
      <h3 class="card-title">Где искать</h3>${rootsBox('dupRoots')}
      <div class="section-label">Как сравнивать</div>
      <div class="seg"><button class="${o.mode === 'content' ? 'on' : ''}" data-act="dupMode" data-v="content">По содержимому</button>
        <button class="${o.mode === 'name' ? 'on' : ''}" data-act="dupMode" data-v="name">По имени и размеру</button></div>
      <div class="small muted" style="margin-top:6px">${o.mode === 'content' ? 'Точно: файлы сверяются хэшем, даже если называются по-разному.' : 'Быстрее, но приблизительно: совпадают имя и размер. Ничего не отмечается само.'}</div>
      <div class="section-label">Размер файла от</div>
      <div class="row"><input class="field num" type="number" min="0" step="0.1" data-bind="dupOpts.min_mb" value="${o.min_mb}"> МБ</div>
      <div class="section-label">Типы файлов</div>
      <div class="row" style="gap:6px"><button class="chip ${!types ? 'on' : ''}" data-act="dupType" data-v="">Все</button>
        ${st.server.file_types.map(t => `<button class="chip ${types && types.includes(t.id) ? 'on' : ''}" data-act="dupType" data-v="${t.id}">${esc(t.name)}</button>`).join('')}</div>
      <button class="btn primary big mt" style="width:100%;justify-content:center" data-act="dupScan">${I.copy}Найти дубликаты</button>
    </div>
    <div>
      <div class="card" id="dupSummary">${dupSummary()}</div>
      <div class="card mt">
        <div class="row"><b>Что оставить в каждой группе</b><span class="grow"></span>
          <div class="seg">${[['oldest', 'Самый старый'], ['newest', 'Самый новый'], ['short', 'Короткий путь'], ['alpha', 'По алфавиту']]
            .map(([v, t]) => `<button class="${st.dupStrategy === v ? 'on' : ''}" data-act="dupStrategy" data-v="${v}">${t}</button>`).join('')}</div>
          <button class="btn sm" data-act="dupStrategy" data-v="none">Снять всё</button></div>
        <div id="dupList">${dupListHtml()}</div>
        <div class="rl-foot"><span class="grow"></span><span class="muted small" id="dupSel">${dupSelText()}</span>
          <button class="btn danger" data-act="lDelete" data-l="dups" data-v="perm">Удалить навсегда</button>
          <button class="btn primary" data-act="lDelete" data-l="dups" data-v="bin">${I.trash}В Корзину</button></div>
      </div>
    </div>
  </div>`;
}
function updateDups(part) {
  if (part !== 'list:dups') return;
  const s = $('#dupSummary'); if (s) s.innerHTML = dupSummary();
  const l = $('#dupList'); if (l) l.innerHTML = dupListHtml();
  const t = $('#dupSel'); if (t) t.textContent = dupSelText();
}
async function dupScan() {
  if (!st.dupRoots.length) return toast('Добавьте папку', 'Где искать дубликаты?');
  const r = await api.post('/api/dup_scan', { roots: st.dupRoots, opts: st.dupOpts });
  if (!r.ok) toast('Подождите', `Сейчас выполняется: ${r.busy}`);
}

// ================================================================== СТАРЫЕ ИГРЫ
const isOld = g => g.never || (g.days != null && g.days >= st.gamesDays);
function gameLastText(g) {
  if (g.never) return 'ни разу не запускалась';
  if (g.days == null) return 'дата запуска неизвестна';
  const d = g.days;
  if (d === 0) return 'сегодня';
  if (d === 1) return 'вчера';
  if (d < 30) return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`;
  if (d < 365) { const m = Math.round(d / 30); return `${m} ${plural(m, 'месяц', 'месяца', 'месяцев')} назад`; }
  const y = Math.floor(d / 365); return `${y} ${plural(y, 'год', 'года', 'лет')} назад`;
}
function gamesList() {
  const all = (st.games || []).map(g => ({ ...g, _old: isOld(g), _last: gameLastText(g) }));
  let list = st.gamesFilter === 'old' ? all.filter(g => g._old) : all;
  const lastKey = g => (g.never ? -1 : g.last == null ? Infinity : g.last);
  const sorters = { last: (a, b) => lastKey(a) - lastKey(b), size: (a, b) => b.size - a.size, name: (a, b) => a.name.localeCompare(b.name, 'ru') };
  list = [...list].sort(sorters[st.gamesSort] || sorters.last);
  return { all, list };
}
const gid = id => 'g-' + String(id).replace(/[^a-z0-9]/gi, '_');
function gameCard(g) {
  const hue = [...g.name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const ini = g.name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase();
  const pt = g.playtime >= 60 ? `${num(Math.round(g.playtime / 60))} ч` : g.playtime ? `${g.playtime} мин` : '';
  return `<div class="game ${g._old ? 'old' : ''}" id="${gid(g.id)}">
    <div class="gcover" style="background:linear-gradient(135deg,hsl(${hue} 70% 56%),hsl(${(hue + 40) % 360} 62% 36%))">${esc(ini)}
      ${g.image ? `<img loading="lazy" alt="" src="/api/game_image?id=${encodeURIComponent(g.id)}&kind=header" onerror="this.remove()">` : ''}
      <span class="gsrc">${esc(g.source)}</span></div>
    <div class="gbody">
      <div class="gname" title="${esc(g.name)}">${esc(g.name)}</div>
      <div class="gmeta"><span>Размер <b>${fmt(g.size)}</b></span><span>Запуск: <b>${esc(g._last)}</b></span>${pt ? `<span>Наиграно <b>${pt}</b></span>` : ''}</div>
      <div class="gbtns">${g.never ? '<span class="badge bad">не запускалась</span>' : g._old ? '<span class="badge warn">давно не играли</span>' : '<span class="badge">играете</span>'}
        <span class="grow"></span>
        ${g.path ? `<button class="icon-btn" data-act="reveal" data-path="${esc(g.path)}" title="Открыть папку игры">${I.folder}</button>` : ''}
        <button class="btn sm danger" data-act="gameUninstall" data-id="${esc(g.id)}">${I.trash}Удалить</button></div>
      ${g.alt_folder ? `<div class="small muted" style="margin-top:8px">или <button class="link" data-act="gameFolder" data-id="${esc(g.id)}">удалить папку игры вручную</button></div>` : ''}
    </div></div>`;
}
function pageGames() {
  if (!st.games) {
    if (!st.running) setTimeout(gamesScan, 50);
    return head('Старые игры', 'Ищу установленные игры…') + `<div class="card"><div class="rl-empty"><div class="spinner" style="border-color:#d2d2d7;border-top-color:var(--blue);margin:0 auto 12px"></div>Смотрю Steam, Epic, GOG, Ubisoft, EA, Battle.net, Riot, Xbox…</div></div>`;
  }
  const { all, list } = gamesList();
  const old = all.filter(g => g._old);
  const unknown = all.filter(g => !g.never && g.days == null).length;
  const removed = (st.server.stats.history || []).filter(h => h.source === 'Удаление игр').reduce((a, h) => a + h.bytes, 0);
  return head('Старые игры', 'Игры, в которые вы давно не заходили. Удаление идёт через сам лаунчер — он покажет своё окно подтверждения.',
    `<button class="btn" data-act="gamesScan">${I.refresh}Обновить список</button>`) + `
  <div class="card">
    <div class="row"><b>Не запускались дольше</b>
      ${[[30, 'месяца'], [90, '3 месяцев'], [180, 'полугода'], [365, 'года'], [730, '2 лет']].map(([d, t]) =>
        `<button class="chip ${st.gamesDays === d ? 'on' : ''}" data-act="gamesDays" data-v="${d}">${t}</button>`).join('')}
      <span class="grow"></span>
      <div class="seg"><button class="${st.gamesFilter === 'old' ? 'on' : ''}" data-act="gamesFilter" data-v="old">Давно не играл · ${old.length}</button>
        <button class="${st.gamesFilter === 'all' ? 'on' : ''}" data-act="gamesFilter" data-v="all">Все · ${all.length}</button></div>
      <select class="field" data-act="gamesSort">${[['last', 'Сначала заброшенные'], ['size', 'Сначала большие'], ['name', 'По названию']]
        .map(([v, t]) => `<option value="${v}" ${st.gamesSort === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
    </div>
    <div class="grid g3 mt">
      <div class="stat"><div class="label"><i class="dot" style="background:var(--orange)"></i>Давно не запускались</div>
        <div class="bignum">${old.length} <span style="font-size:18px;color:var(--text2)">${plural(old.length, 'игра', 'игры', 'игр')}</span></div>
        <div class="foot">занимают ${fmt(old.reduce((a, g) => a + g.size, 0))}</div></div>
      <div class="stat"><div class="label"><i class="dot" style="background:var(--blue)"></i>Все игры</div>
        <div class="bignum">${all.length}</div><div class="foot">занимают ${fmt(all.reduce((a, g) => a + g.size, 0))}</div></div>
      <div class="stat"><div class="label"><i class="dot" style="background:var(--green)"></i>Освобождено удалением игр</div>
        <div class="bignum green">${fmt(removed)}</div><div class="foot">за всё время</div></div>
    </div>
    ${unknown && !st.gamesInfo.prefetch ? `<div class="notice warn mt">${I.clock}<div>Для ${unknown} ${plural(unknown, 'игры', 'игр', 'игр')} не из Steam дата последнего запуска неизвестна.
      ${st.server.admin ? '' : 'Запустите программу от администратора — тогда она прочитает журнал запусков Windows (Prefetch).'}</div></div>` : ''}
  </div>
  <div class="card mt"><h3 class="card-title">Полка</h3><div class="card-sub">Серые и покосившиеся — давно не запускались. Нажмите на коробку — перейду к игре.</div>
    <div class="shelf3d mt" id="shelf3d">${list.length ? '' : `<div class="rl-empty">${I.game}<div>${st.gamesFilter === 'old' ? 'Все игры запускались недавно — удалять нечего 🎉' : 'Игры не найдены'}</div></div>`}</div></div>
  <div class="games">${list.map(gameCard).join('')}</div>`;
}
function mountGames() {
  const el = $('#shelf3d'); if (!el || !st.games) return;
  const { list } = gamesList();
  if (!list.length) return;
  const s = S3.mountShelf(el, list, g => {
    const card = document.getElementById(gid(g.id)); if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
  });
  if (!s) el.innerHTML = `<div class="rl-empty">${I.game}<div>3D недоступно в этом браузере</div></div>`;
}
async function gamesScan() {
  const r = await api.post('/api/games_scan');
  if (!r.ok) toast('Подождите', `Сейчас выполняется: ${r.busy}`);
}
async function gameUninstall(id, folder) {
  const g = (st.games || []).find(x => x.id === id); if (!g) return;
  const how = { steam: 'Steam откроет своё окно — подтвердите удаление там.',
    command: 'Запустится деинсталлятор игры. Он может попросить права администратора.',
    epic: 'Откроется Epic Games Launcher: в Библиотеке нажмите «…» у игры и выберите «Удалить».',
    xbox: 'Откроются Параметры Windows → Приложения: найдите игру и нажмите «Удалить».' }[g.method] || '';
  const ok = await confirmBox(folder
    ? { title: `Удалить папку «${g.name}»?`, danger: true, ok: 'Удалить папку',
      text: `Папка ${g.path} уйдёт в Корзину (${fmt(g.size)}). Если она больше Корзины, Windows спросит про удаление навсегда. Лаунчер может и дальше считать игру установленной — тогда удалите её и там.` }
    : { title: `Удалить «${g.name}»?`, danger: true, ok: 'Удалить',
      text: `${how} Освободится около ${fmt(g.size)}. Облачные сохранения останутся в лаунчере. Когда игра исчезнет с диска, место попадёт в «Результаты».` });
  if (!ok) return;
  const r = await api.post('/api/game_uninstall', { id, mode: folder ? 'folder' : 'launcher' });
  toast(r.ok ? (folder ? 'Удаляю папку' : 'Запущено удаление') : 'Не получилось', r.message, 7000);
}

// ================================================================== ЖУРНАЛ
function pageLog() {
  return head('Журнал', 'Всё, что сделала программа в этой сессии') +
    `<div class="card"><div class="log" id="logBox">${st.logs.map(l => `<div>${esc(l)}</div>`).join('') || '<div class="muted">Пока пусто</div>'}</div></div>`;
}
function updateLog() { const b = $('#logBox'); if (b) { b.innerHTML = st.logs.map(l => `<div>${esc(l)}</div>`).join(''); b.scrollTop = b.scrollHeight; } }

const PAGE_RENDER = { overview: pageOverview, system: pageSystem, junk: pageJunk, dups: pageDups, unused: pageUnused,
  games: pageGames, analyze: pageAnalyze, disks: pageDisks, results: pageResults, log: pageLog };
const PAGE_MOUNT = { overview: mountOverview, junk: () => mountList('junk'), unused: () => mountList('unused'),
  games: mountGames, analyze: mountAnalyze, disks: mountDisks, results: mountResults, log: updateLog };
const PAGE_UPDATE = {
  overview: updateOverview, system: updateSystem, log: updateLog, dups: updateDups,
  junk: part => { if (part === 'list:junk') { refreshChips('junk'); drawRows('junk'); } },
  unused: part => { if (part === 'list:unused') { refreshChips('unused'); drawRows('unused'); } },
};

// ================================================================== ТЕСТ-МАСТЕР
const wz = { step: 0, goals: new Set(['quick', 'junk']), groups: null, tg: false, find: new Set(['copies', 'temp', 'dups', 'empty', 'installers', 'lnk']),
  days: 365, dry: false, show: true };
function wizard() {
  wz.step = 0; wz.groups = wz.groups || new Set(st.server.groups.filter(g => g !== 'Разработка' && g !== 'Прочее'));
  wz.show = st.server.settings.show_wizard !== false; wz.dry = st.dry;
  drawWizard();
}
function drawWizard() {
  const steps = 4;
  const dots = Array.from({ length: steps }, (_, i) => `<i class="${i === wz.step ? 'on' : ''}"></i>`).join('');
  const opt = (set, id, icon, color, t, s) => `<button class="opt ${set.has(id) ? 'on' : ''}" data-wz="${set === wz.goals ? 'goal' : set === wz.groups ? 'group' : 'find'}" data-v="${esc(id)}">
    <span class="oi" style="background:${color}">${I[icon]}</span><div><b>${t}</b><span>${s}</span></div></button>`;
  let body = '';
  if (wz.step === 0) {
    body = `<div class="wz-step">Шаг 1 из ${steps}</div><h2>Что вы хотите сделать?</h2><p class="lead">Можно выбрать несколько вариантов — программа подстроится.</p>
    <div class="opts">
      ${opt(wz.goals, 'quick', 'bolt', '#34c759', 'Быстро освободить место', 'Кэши браузеров, мессенджеров, игр, temp, Корзина')}
      ${opt(wz.goals, 'deep', 'sparkle', '#0071e3', 'Глубокая очистка', 'Плюс логи, шейдеры, остатки драйверов и обновлений')}
      ${opt(wz.goals, 'junk', 'copy', '#ff9f0a', 'Найти мусор и копии', '«(2)», «Копия», «Copy», дубликаты, пустые папки')}
      ${opt(wz.goals, 'dups', 'copy', '#007aff', 'Найти повторяющиеся файлы', 'Одинаковые фото, видео, документы в разных папках')}
      ${opt(wz.goals, 'games', 'game', '#ff6b35', 'Удалить старые игры', 'В которые вы давно не заходили')}
      ${opt(wz.goals, 'unused', 'clock', '#af52de', 'Найти забытые файлы', 'То, что вы давно не открывали')}
      ${opt(wz.goals, 'analyze', 'cube', '#30b0c7', 'Посмотреть, что занимает место', '3D-карта папок на диске')}
    </div>`;
  } else if (wz.step === 1) {
    const cnt = g => cats().filter(c => c.group === g && catFound(c)).length;
    body = `<div class="wz-step">Шаг 2 из ${steps}</div><h2>Какие программы чистить?</h2><p class="lead">Выключите то, что трогать не хотите. В скобках — сколько программ найдено на этом компьютере.</p>
    <div class="opts">${st.server.groups.map(g => { const [ic, col] = GROUP_META[g] || ['dots', '#8e8e93'];
      return opt(wz.groups, g, ic, col, g, `найдено: ${cnt(g)}`); }).join('')}</div>
    <div class="opt-row mt"><div class="ot">Скачанные файлы Telegram тоже убрать<small>Отправятся в Корзину — их можно будет вернуть</small></div>
      <label class="switch"><input type="checkbox" data-wz="tg" ${wz.tg ? 'checked' : ''}><span class="track"></span></label></div>`;
  } else if (wz.step === 2) {
    body = `<div class="wz-step">Шаг 3 из ${steps}</div><h2>Что искать среди ваших файлов?</h2><p class="lead">Это для поиска мусора и забытых файлов. Найденное только показывается — удаляете вы сами.</p>
    <div class="opts">
      ${opt(wz.find, 'copies', 'copy', '#ff9f0a', 'Копии файлов', '«(2)», «Копия», «Copy of», «копія», «Kopie»…')}
      ${opt(wz.find, 'dups', 'copy', '#5856d6', 'Дубликаты', 'одинаковое содержимое в разных папках')}
      ${opt(wz.find, 'temp', 'trash', '#ff3b30', 'Временные файлы', '.tmp, недокачанное, lock-файлы')}
      ${opt(wz.find, 'empty', 'folder', '#30b0c7', 'Пустые файлы и папки', '0 байт и пустые каталоги')}
      ${opt(wz.find, 'installers', 'download', '#34c759', 'Старые установщики', 'в папке «Загрузки»')}
      ${opt(wz.find, 'lnk', 'reveal', '#8e8e93', 'Битые ярлыки', 'ведут на удалённые программы')}
    </div>
    <div class="section-label">Забытыми считать файлы, которые не открывались</div>
    <div class="row" style="gap:6px">${[[90, '3 месяца'], [180, 'полгода'], [365, 'год'], [730, '2 года']].map(([d, t]) =>
      `<button class="chip ${wz.days === d ? 'on' : ''}" data-wz="days" data-v="${d}">дольше ${t}</button>`).join('')}</div>`;
  } else {
    const plan = [];
    if (wz.goals.has('quick') || wz.goals.has('deep')) plan.push(`Посчитать ${wz.goals.has('deep') ? 'глубокую' : 'быструю'} очистку для: ${[...wz.groups].join(', ') || 'только Windows'}`);
    if (wz.goals.has('junk')) plan.push('Найти мусор и копии в вашей папке пользователя');
    if (wz.goals.has('dups')) plan.push('Найти повторяющиеся файлы (дубликаты) — по одной копии останется');
    if (wz.goals.has('games')) plan.push(`Показать игры, которые не запускались дольше ${wz.days} дней`);
    if (wz.goals.has('unused')) plan.push(`Найти файлы, которые не открывались дольше ${wz.days} дней`);
    if (wz.goals.has('analyze')) plan.push('Построить 3D-карту системного диска');
    body = `<div class="wz-step">Шаг 4 из ${steps}</div><h2>Всё готово</h2><p class="lead">Сначала только поиск и подсчёт — удаление начнётся, когда вы сами нажмёте кнопку.</p>
    <div class="card" style="background:var(--fill2);box-shadow:none">${plan.length ? plan.map((p, i) => `<div class="row" style="padding:5px 0;flex-wrap:nowrap"><span class="nav-ico" style="background:var(--blue);width:24px;height:24px;font-size:12px;font-weight:700">${i + 1}</span>${esc(p)}</div>`).join('') : '<span class="muted">Ничего не выбрано — вернитесь на шаг 1</span>'}</div>
    <div class="opt-row mt"><div class="ot">Пробный прогон<small>При очистке только показать, сколько освободится</small></div>
      <label class="switch"><input type="checkbox" data-wz="dry" ${wz.dry ? 'checked' : ''}><span class="track"></span></label></div>
    <div class="opt-row"><div class="ot">Показывать этот тест при запуске</div>
      <label class="switch"><input type="checkbox" data-wz="show" ${wz.show ? 'checked' : ''}><span class="track"></span></label></div>`;
  }
  modal(`<div class="wz-top"><img src="icon.svg" style="width:34px;height:34px" alt=""><b>Тест-мастер</b><div class="wz-dots">${dots}</div></div>
    ${body}
    <div class="wz-foot">${wz.step ? '<button class="btn" data-wz="back">Назад</button>' : '<button class="btn" data-wz="skip">Пропустить</button>'}
      <div class="grow"></div>
      ${wz.step < steps - 1 ? '<button class="btn primary" data-wz="next">Дальше</button>' : `<button class="btn primary big" data-wz="finish">${I.bolt}Начать</button>`}</div>`);
}
function wizardClick(e) {
  const b = e.target.closest('[data-wz]'); if (!b) return;
  const k = b.dataset.wz, v = b.dataset.v;
  const tog = (set, x) => set.has(x) ? set.delete(x) : set.add(x);
  if (k === 'goal') tog(wz.goals, v);
  else if (k === 'group') tog(wz.groups, v);
  else if (k === 'find') tog(wz.find, v);
  else if (k === 'days') wz.days = +v;
  else if (k === 'tg') { wz.tg = b.checked; return; }
  else if (k === 'dry') { wz.dry = b.checked; return; }
  else if (k === 'show') { wz.show = b.checked; return; }
  else if (k === 'next') wz.step++;
  else if (k === 'back') wz.step--;
  else if (k === 'skip') { closeModal(); return; }
  else if (k === 'finish') return wizardApply();
  drawWizard();
}
async function wizardApply() {
  closeModal();
  api.post('/api/settings', { show_wizard: wz.show });
  st.server.settings.show_wizard = wz.show;
  st.dry = wz.dry;
  const heavy = new Set(['ml_models', 'maven', 'nuget_pkgs', 'gradle', 'unreal_ddc', 'browsers_test', 'go_mod', 'jetbrains',
    'spotify', 'onec', 'steam_temp', 'electron_other', 'defender', 'fontcache', 'prefetch', 'evtlog']);
  const deep = wz.goals.has('deep');
  if (wz.goals.has('quick') || deep) {
    for (const c of cats()) {
      const inGroup = c.group === 'Windows' || wz.groups.has(c.group);
      let on = inGroup && (deep ? !heavy.has(c.id) : c.on);
      if (c.to_bin) on = inGroup && wz.tg;
      st.sel[c.id] = on;
    }
  }
  const allRules = ['temp', 'copies', 'dups', 'empty', 'installers', 'lnk'];
  for (const r of allRules) st.junkOpts[r] = wz.find.has(r);
  st.junkOpts.zero = wz.find.has('empty');
  st.unusedOpts.days = wz.days;
  save();
  st.queue = [];
  if (wz.goals.has('quick') || deep) st.queue.push(() => { go('system'); sysScan(); });
  if (wz.goals.has('junk')) st.queue.push(() => { go('junk'); junkScan(); });
  if (wz.goals.has('dups')) st.queue.push(() => { go('dups'); dupScan(); });
  if (wz.goals.has('games')) { st.gamesDays = Math.min(wz.days, 730); st.queue.push(() => { st.games = null; go('games'); }); }
  if (wz.goals.has('unused')) st.queue.push(() => { go('unused'); unusedScan(); });
  if (wz.goals.has('analyze')) st.queue.push(() => { go('analyze'); analyze(sysDrive()?.root || st.server.home); });
  if (!st.queue.length) return toast('Ничего не выбрано', 'Тест можно пройти заново в меню слева');
  toast('Тест пройден', `Запускаю ${st.queue.length} ${plural(st.queue.length, 'задачу', 'задачи', 'задач')} по очереди — потом проверьте найденное.`);
  st.queue.shift()();
}

// ================================================================== события сервера
function handle(ev) {
  for (const e of ev) {
    switch (e.type) {
      case 'log': st.logs.push(e.text); if (st.logs.length > 3000) st.logs.splice(0, 1000); update('log'); break;
      case 'status': st.status = e.text; break;
      case 'task':
        st.running = e.state === 'start' ? e.label : null;
        if (e.state === 'end' && !st.replay) {
          refreshState();
          if (e.stopped) st.queue = [];
          if (st.queue.length) setTimeout(() => st.queue.length && st.queue.shift()(), 400);
        }
        break;
      case 'cat':
        st.cats[e.id] = { size: e.size, count: e.count, note: e.note, found: e.found };
        update('cat:' + e.id); break;
      case 'clear': st.lists[e.list] = Object.assign(newList(), { filter: st.lists[e.list].filter, sort: st.lists[e.list].sort });
        update('list:' + e.list); break;
      case 'items': {
        const L = st.lists[e.list];
        for (const it of e.items) { L.items.push(it); L.byId.set(it.id, it); }
        L.dirty = true; update('list:' + e.list); break;
      }
      case 'removed': {
        const L = st.lists[e.list]; const rm = new Set(e.ids);
        L.items = L.items.filter(i => !rm.has(i.id)); rm.forEach(i => L.byId.delete(i)); L.dirty = true;
        update('list:' + e.list); break;
      }
      case 'analyze':
        st.analyze = { path: e.path, rows: e.rows, total: e.total, parent: e.parent };
        if (!st.replay && st.page === 'analyze') renderPage();
        break;
      case 'games':
        st.games = e.games; st.gamesInfo = e.info || {};
        if (!st.replay && st.page === 'games') renderPage();
        renderNav(); break;
      case 'game_removed':
        if (st.games) st.games = st.games.filter(g => g.id !== e.id);
        if (st.replay) break;
        toast('Игра удалена', `${e.binned ? 'Папка в Корзине' : 'Освобождено'}: ${fmt(e.freed)}`, 6000);
        refreshState().then(() => { if (st.page === 'games') renderPage(); });
        break;
      case 'done':
        if (st.replay) break;
        if (e.kind === 'dup_scan' && st.dupOpts.mode === 'content') { applyDupStrategy(st.dupStrategy); update('list:dups'); }
        doneToast(e); break;
    }
  }
}
function doneToast(e) {
  if (e.kind === 'scan_system') {
    const t = selectedTotal();
    toast('Подсчёт готов', `По выбранным категориям можно освободить ${fmt(t)}. Нажмите «Очистить выбранное».`, 6000);
  } else if (e.kind === 'clean_system') {
    toast(e.dry ? 'Пробный прогон' : 'Готово!', e.dry ? `Освободилось бы ${fmt(e.freed)}` : `Освобождено ${fmt(e.freed)}`, 6000);
  } else if (e.kind === 'junk_scan') toast('Поиск мусора завершён', `Найдено ${num(e.count)} ${plural(e.count, 'объект', 'объекта', 'объектов')}`);
  else if (e.kind === 'unused_scan') toast('Поиск завершён', `Найдено ${num(e.count)} давно не открытых ${plural(e.count, 'файла', 'файлов', 'файлов')}`);
  else if (e.kind === 'dup_scan') toast('Дубликаты найдены', e.groups ? `${num(e.groups)} ${plural(e.groups, 'группа', 'группы', 'групп')}, лишние копии занимают ${fmt(e.extra)}` : 'Повторяющихся файлов нет 🎉', 6000);
  else if (e.kind === 'games_scan') toast('Игры найдены', `${num(e.count)} ${plural(e.count, 'игра', 'игры', 'игр')} на этом компьютере`);
  else if (e.kind === 'delete') toast(e.dry ? 'Пробный прогон' : 'Готово', e.dry ? `Удалилось бы ${fmt(e.freed)}`
    : `${e.permanent ? 'Удалено' : 'В Корзину'}: ${num(e.count)} · ${fmt(e.freed)}${e.failed ? ` · не удалось ${e.failed}` : ''}`);
}
function setTaskbar() {
  const tb = $('#taskbar');
  tb.hidden = !st.running;
  if (st.running) { $('#taskLabel').textContent = st.running; $('#taskStatus').textContent = st.status || '…'; }
}
async function refreshState() {
  try {
    const s = await api.get('/api/state');
    st.server = s;
    if (['overview', 'results'].includes(st.page)) renderPage();
    else renderNav();
  } catch { /* сервер мог закрыться */ }
}
async function poll() {
  try {
    const r = await api.get('/api/poll?since=' + st.seq);
    handle(r.events);
    st.seq = r.events.length ? r.events[r.events.length - 1].seq : r.seq;
    if (st.replay && r.events.length < 1500) {
      st.replay = false;
      if (st.page === 'analyze' || st.page === 'junk' || st.page === 'unused') renderPage();
    }
    st.running = r.running; setTaskbar();
    if (st.offline) { st.offline = false; $('#main').style.opacity = ''; }
  } catch {
    if (!st.offline) { st.offline = true; toast('Нет связи с программой', 'Окно консоли закрыто? Запустите Чистильщик снова.', 8000); $('#main').style.opacity = .55; }
  }
  setTimeout(poll, st.running || st.replay ? 250 : 1200);
}

// ================================================================== действия
const ACT = {
  go: a => go(a.dataset.id),
  quick: () => {
    for (const c of cats()) if (st.sel[c.id] === undefined) st.sel[c.id] = c.on;
    go('system'); sysScan();
  },
  wizard: () => wizard(),
  sysScan: () => sysScan(),
  sysClean: () => sysClean(),
  showAll: a => { st.showAll = a.dataset.v === '1'; save(); renderPage(); },
  selMode: a => { for (const c of cats()) st.sel[c.id] = a.dataset.v === 'all' ? true : a.dataset.v === 'none' ? false : c.on; save(); renderPage(); },
  fold: (a, e) => { if (e.target.closest('[data-stop]')) return; const g = a.dataset.g; st.closed[g] = !st.closed[g]; save(); a.parentElement.classList.toggle('closed'); },
  lFilter: a => { const L = st.lists[a.dataset.l]; L.filter = a.dataset.v; L.dirty = true; a.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === a)); drawRows(a.dataset.l); },
  lReason: a => { const L = st.lists[a.dataset.l]; L.reason = a.dataset.v || null; L.dirty = true; refreshChips(a.dataset.l); drawRows(a.dataset.l); },
  lToggle: (a, e) => {
    if (e.target.closest('[data-act="reveal"]')) return;
    const it = st.lists[a.dataset.l].byId.get(a.dataset.id); if (!it) return;
    it.checked = !it.checked; drawRows(a.dataset.l);
  },
  lMark: a => {
    const L = st.lists[a.dataset.l]; const v = a.dataset.v;
    if (v === 'view') listView(L).forEach(i => { i.checked = true; });
    else L.items.forEach(i => { i.checked = v === 'high' ? i.conf === 'высокая' : false; });
    drawRows(a.dataset.l);
  },
  lExport: a => listExport(a.dataset.l),
  lDelete: a => listDelete(a.dataset.l, a.dataset.v === 'perm'),
  reveal: a => api.post('/api/reveal', { path: a.dataset.path }),
  rootAdd: async a => {
    toast('Выберите папку', 'Окно выбора могло открыться позади браузера', 3000);
    const r = await api.post('/api/pick_folder');
    if (r.path && !st[a.dataset.k].includes(r.path)) { st[a.dataset.k].push(r.path); save(); renderPage(); }
  },
  rootDel: a => { st[a.dataset.k].splice(+a.dataset.i, 1); save(); renderPage(); },
  rootQuick: a => { st[a.dataset.k].push(a.dataset.v); save(); renderPage(); },
  rootDrives: a => { for (const d of st.server.drives) if (!st[a.dataset.k].includes(d.root)) st[a.dataset.k].push(d.root); save(); renderPage(); },
  junkScan: () => junkScan(),
  unusedScan: () => unusedScan(),
  dupScan: () => dupScan(),
  dupMode: a => { st.dupOpts.mode = a.dataset.v; save(); renderPage(); },
  dupType: a => {
    const v = a.dataset.v;
    if (!v) st.dupOpts.types = null;
    else {
      const cur = new Set(st.dupOpts.types || []);
      cur.has(v) ? cur.delete(v) : cur.add(v);
      st.dupOpts.types = cur.size ? [...cur] : null;
    }
    save(); renderPage();
  },
  dupStrategy: a => { applyDupStrategy(a.dataset.v); if (a.dataset.v !== 'none') a.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === a)); updateDups('list:dups'); },
  dupToggle: (a, e) => {
    if (e.target.closest('[data-act="reveal"]')) return;
    const it = st.lists.dups.byId.get(a.dataset.id); if (!it) return;
    it.checked = !it.checked; updateDups('list:dups');
  },
  dupMore: () => { st.dupShow += 120; updateDups('list:dups'); },
  gamesScan: () => { st.games = null; renderPage(); },
  gamesDays: a => { st.gamesDays = +a.dataset.v; save(); renderPage(); renderNav(); },
  gamesFilter: a => { st.gamesFilter = a.dataset.v; save(); renderPage(); },
  gameUninstall: a => gameUninstall(a.dataset.id, false),
  gameFolder: a => gameUninstall(a.dataset.id, true),
  daysPreset: a => { st.unusedOpts.days = +a.dataset.v; save(); renderPage(); },
  typeToggle: a => {
    const all = st.server.file_types.map(t => t.id);
    const cur = new Set(st.unusedOpts.types || all);
    cur.has(a.dataset.v) ? cur.delete(a.dataset.v) : cur.add(a.dataset.v);
    st.unusedOpts.types = [...cur]; save(); a.classList.toggle('on');
  },
  atime: a => { st.unusedOpts.use_atime = a.dataset.v === '1'; save(); renderPage(); },
  analyze: a => analyze(a.dataset.path),
  analyzeGo: a => { go('analyze'); analyze(a.dataset.path); },
  pickAnalyze: async () => { toast('Выберите папку', 'Окно выбора могло открыться позади браузера', 3000); const r = await api.post('/api/pick_folder'); if (r.path) analyze(r.path); },
  junkDrive: a => { st.junkRoots = [a.dataset.path]; save(); go('junk'); junkScan(); },
  diskAct: async a => {
    const v = a.dataset.v;
    if (v !== 'cleanmgr' && !st.server.admin) {
      const ok = await confirmBox({ title: 'Нужны права администратора', ok: 'Перезапустить от администратора',
        text: 'Оптимизация и проверка диска работают только с правами администратора.' });
      if (ok) elevate();
      return;
    }
    const r = await api.post('/api/disk_action', { letter: a.dataset.l, action: v });
    if (r.ok) toast(v === 'cleanmgr' ? 'Открыто окно Windows' : 'Запущено', v === 'cleanmgr' ? '«Очистка диска» Windows' : 'Ход выполнения — внизу и в «Журнале»');
    else toast('Подождите', `Сейчас выполняется: ${r.busy}`);
  },
  disksReload: () => { st.disks = null; renderPage(); },
  statsReset: async () => {
    if (await confirmBox({ title: 'Сбросить статистику?', text: 'История очисток и счётчики обнулятся. Файлы не затрагиваются.', ok: 'Сбросить', danger: true })) {
      await api.post('/api/stats_reset'); refreshState();
    }
  },
};
async function elevate() {
  const r = await api.post('/api/elevate');
  if (r.ok) {
    $('#main').innerHTML = `<div class="page"><div class="card" style="text-align:center;padding:60px"><h2 class="page-title">Перезапуск…</h2>
      <p class="page-sub" style="margin:10px auto">Программа откроется заново с правами администратора в новой вкладке. Эту вкладку можно закрыть.</p></div></div>`;
  } else toast('Не получилось', 'Запрос прав администратора отклонён');
}

document.addEventListener('click', e => {
  if (!$('#modalBack').hidden && e.target.closest('#modal')) return wizardClick(e);
  if (e.target === $('#modalBack') && $('#modal').querySelector('[data-wz]')) { closeModal(); return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  if (a.tagName === 'INPUT') return;
  ACT[a.dataset.act]?.(a, e);
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.closest('#modal') && t.dataset.wz) return wizardClick(e);
  if (t.dataset.act === 'selCat') { st.sel[t.dataset.id] = t.checked; save(); update('sel'); return; }
  if (t.dataset.act === 'selGroup') {
    const g = t.dataset.g;
    visibleCats().filter(c => c.group === g).forEach(c => { st.sel[c.id] = t.checked; });
    save();
    document.querySelectorAll(`[data-group="${CSS.escape(g)}"] [data-act="selCat"]`).forEach(i => { i.checked = t.checked; });
    update('sel'); return;
  }
  if (t.dataset.act === 'lSort') { const L = st.lists[t.dataset.l]; L.sort = t.value; L.dirty = true; drawRows(t.dataset.l); return; }
  if (t.dataset.act === 'gamesSort') { st.gamesSort = t.value; save(); renderPage(); return; }
  bind(t);
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.act === 'lSearch') { const L = st.lists[t.dataset.l]; L.q = t.value; L.dirty = true; drawRows(t.dataset.l); return; }
  if (t.dataset.live) { bind(t); const l = $('#daysLbl'); if (l) l.textContent = t.value; }
});
function bind(t) {
  const k = t.dataset.bind; if (!k) return;
  const val = t.type === 'checkbox' ? t.checked : t.type === 'number' || t.type === 'range' ? +t.value : t.value;
  const [a, b] = k.split('.');
  if (b) st[a][b] = val; else st[a] = val;
  save();
  if (k === 'ageH' && st.page === 'system') document.querySelectorAll('.tag.age').forEach(x => { x.textContent = `старше ${val} ч`; });
}
$('#btnStop').onclick = () => { st.queue = []; api.post('/api/stop'); };
$('#btnWizard').onclick = () => wizard();
$('#btnAdmin').onclick = () => { if (!st.server.admin) elevate(); };
$('#btnQuit').onclick = async () => {
  if (!await confirmBox({ title: 'Закрыть программу?', text: 'Окно консоли закроется. Открыть снова — запуском Чистильщика.', ok: 'Выйти', danger: true })) return;
  api.post('/api/quit').catch(() => {});
  document.body.innerHTML = `<div style="display:grid;place-items:center;height:100vh;font:600 22px var(--font);color:#86868b">Программа закрыта. Вкладку можно закрыть.</div>`;
};
window.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modalBack').hidden) closeModal(); });

// ================================================================== старт
(async function init() {
  try { st.server = await api.get('/api/state'); } catch {
    document.body.innerHTML = '<div style="padding:60px;font:18px var(--font)">Не удалось связаться с программой. Запустите Чистильщик и откройте адрес из окна консоли.</div>';
    return;
  }
  if (!st.sel) { st.sel = {}; for (const c of cats()) st.sel[c.id] = c.on; }
  for (const c of cats()) if (st.sel[c.id] === undefined) st.sel[c.id] = c.on;
  if (!st.junkRoots) st.junkRoots = [st.server.home];
  if (!st.unusedRoots) st.unusedRoots = (st.server.known_roots || []).filter(r => r !== st.server.home);
  if (!st.dupRoots) st.dupRoots = [st.server.home];
  save();
  renderNav(); renderPage();
  poll();
  loadDisks(false).then(() => { if (st.page === 'overview') renderPage(); });
  if (st.server.settings.show_wizard !== false) setTimeout(wizard, 500);
})();
