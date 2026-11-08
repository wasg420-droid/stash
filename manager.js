// Stash manager page
const $ = (s, el = document) => el.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const SELF = location.href.split('#')[0];
const THEMES = {
  dark:     { name: 'Dark',     bg: '#232323', card: '#2c2c2c', text: '#e8e8e8', accent: '#8ab4ff' },
  midnight: { name: 'Midnight', bg: '#0f1420', card: '#1a2131', text: '#e3e8f2', accent: '#7aa2ff' },
  graphite: { name: 'Graphite', bg: '#161618', card: '#222226', text: '#ececec', accent: '#a78bfa' },
  forest:   { name: 'Forest',   bg: '#152019', card: '#1f2c24', text: '#e4ece6', accent: '#6fcf97' },
  mocha:    { name: 'Mocha',    bg: '#221c19', card: '#2e2622', text: '#efe5dc', accent: '#e0a96d' },
  light:    { name: 'Light',    bg: '#f4f4f2', card: '#ffffff', text: '#1f1f1f', accent: '#2f6fde' },
};
const DEFAULT_WP_KEY = { code: 'KeyH', ctrl: false, alt: false, shift: false, meta: false };
const DEFAULT = { name: 'Personal', sort: 'custom', view: 'compact', sidebar: true, openNewTab: true, wallpaperOnly: false, wallpaperKey: DEFAULT_WP_KEY, collections: [], theme: { preset: 'dark', bg: '#232323', card: '#2c2c2c', text: '#e8e8e8', accent: '#8ab4ff', dim: 55 } };

let state = structuredClone(DEFAULT);
let filter = '';
let drag = null; // { kind: 'tab'|'open'|'col', ... }

// ---------- storage ----------
async function load() {
  const { stash } = await chrome.storage.local.get('stash');
  state = { ...DEFAULT, ...(stash || {}) };
}
const ownRevs = new Set(); // writes made by this page, so their change events can be ignored
function save() {
  state.updated = Date.now();
  state.rev = uid();
  ownRevs.add(state.rev);
  return chrome.storage.local.set({ stash: state });
}
function commit(fn, undoMsg) {
  const before = structuredClone(state);
  fn();
  save();
  render();
  if (undoMsg) toast(undoMsg, () => { state = before; save(); render(); });
}
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local' || !ch.stash) return;
  const nv = ch.stash.newValue;
  if (!nv || ownRevs.has(nv.rev)) return;
  state = { ...DEFAULT, ...nv };
  render();
});

const findCol = (id) => state.collections.find((c) => c.id === id);
const touch = (col) => (col.updated = Date.now());

// ---------- helpers ----------
function favEl(url) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
  const img = document.createElement('img');
  img.className = 'fav';
  img.alt = '';
  img.loading = 'lazy';
  img.src = chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent(url) + '&size=32');
  img.onerror = () => {
    const l = document.createElement('span');
    l.className = 'letter';
    l.textContent = (host[0] || '?').toUpperCase();
    img.replaceWith(l);
  };
  return img;
}
const hostOf = (url) => { try { const u = new URL(url); return u.hostname.replace(/^www\./, '') + (u.pathname !== '/' ? u.pathname : ''); } catch { return url; } };
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function hl(text) {
  if (!filter) return esc(text);
  const i = text.toLowerCase().indexOf(filter);
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + filter.length)) + '</mark>' + esc(text.slice(i + filter.length));
}
const tabName = (t) => t.name || t.title || t.url;
const matches = (t) => !filter || [t.name, t.title, t.url, t.notes].some((v) => (v || '').toLowerCase().includes(filter));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const saveable = (url) => !!url && !url.startsWith(SELF) && !/^[a-z-]+:\/\/newtab\/?$/i.test(url);

function sortedCollections() {
  const cols = [...state.collections];
  if (state.sort === 'name') cols.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  if (state.sort === 'count') cols.sort((a, b) => b.tabs.length - a.tabs.length);
  if (state.sort === 'recent') cols.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  return cols;
}

// ---------- render ----------
function render() {
  document.body.className = `view-${state.view}` + (state.sidebar ? '' : ' no-sidebar') + (state.sideCollapsed ? ' side-collapsed' : '') + (drag ? ' dragging-item' : '') + (bgImage ? ' has-bg' : '') + (state.wallpaperOnly ? ' wallpaper-only' : '');
  if (document.activeElement !== $('#wsName')) $('#wsName').textContent = state.name;
  $('#colCount').textContent = plural(state.collections.length, 'Collection');
  $('#tabCount').textContent = plural(state.collections.reduce((n, c) => n + c.tabs.length, 0), 'tab');
  document.querySelectorAll('#sortSeg button').forEach((b) => b.classList.toggle('on', b.dataset.sort === state.sort));
  document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
  $('#sidebarToggle').checked = !!state.sidebar;
  $('#newTabToggle').checked = state.openNewTab !== false;
  $('#wpToggle').checked = !!state.wallpaperOnly;
  renderWpKey();
  $('#sideToggle').title = state.sideCollapsed ? 'Expand panel  ( \\ )' : 'Collapse panel  ( \\ )';
  applyTheme();
  $('#filterChip').hidden = !filter;
  $('#filterChipText').textContent = filter;

  const allCollapsed = state.collections.length && state.collections.every((c) => c.collapsed);
  $('#toggleAll').title = allCollapsed ? 'Expand all' : 'Collapse all';
  $('#toggleAll').innerHTML = allCollapsed
    ? '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 9l5-5 5 5M7 15l5 5 5-5"/></svg>'
    : '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M5 12h14"/></svg>';

  const root = $('#collections');
  root.textContent = '';
  for (const col of sortedCollections()) {
    const nameHit = filter && col.name.toLowerCase().includes(filter);
    const tabs = nameHit ? col.tabs : col.tabs.filter(matches);
    if (filter && !nameHit && !tabs.length) continue;
    root.append(renderCol(col, tabs, !!filter));
  }
  $('#empty').hidden = state.collections.length > 0;
}

function renderCol(col, tabs, filtering) {
  const el = document.createElement('div');
  el.className = 'col' + (col.collapsed && !filtering ? ' collapsed' : '');
  el.dataset.id = col.id;
  el.innerHTML = `
    <div class="col-head" draggable="${state.sort === 'custom' && !filtering}">
      <div class="col-head-text">
        <div class="col-title">
          <span class="col-name" spellcheck="false">${hl(col.name)}</span>
          <span class="chev"><svg viewBox="0 0 24 24" width="14" height="14"><path d="m9 6 6 6-6 6"/></svg></span>
        </div>
        <div class="col-meta">${plural(col.tabs.length, 'tab')}${filtering && tabs.length !== col.tabs.length ? ` · ${tabs.length} shown` : ''}</div>
      </div>
      <div class="col-actions">
        <button class="icon" data-a="open" title="Open all tabs"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></button>
        <button class="icon" data-a="window" title="Open in new window"><svg viewBox="0 0 24 24" width="15" height="15"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/></svg></button>
        <button class="icon" data-a="grab" title="Add all tabs from this window"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg></button>
        <button class="icon" data-a="rename" title="Rename"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg></button>
        <button class="icon danger" data-a="delete" title="Delete collection"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg></button>
      </div>
    </div>
    <div class="cards"></div>`;
  const cards = $('.cards', el);
  for (const t of tabs) cards.append(renderCard(col, t));
  wireCol(el, col);
  return el;
}

function renderCard(col, t) {
  const a = document.createElement('a');
  a.className = 'card';
  a.href = t.url;
  a.draggable = true;
  a.dataset.id = t.id;
  a.title = tabName(t) + (tabName(t) !== t.url ? `\n${t.url}` : '') + (t.notes ? `\n\n${t.notes}` : '');
  a.append(favEl(t.url));
  const txt = document.createElement('span');
  txt.className = 'txt';
  txt.innerHTML = `<span class="t">${hl(tabName(t))}</span><span class="u">${hl(hostOf(t.url))}</span>`
    + (t.notes ? `<span class="n">${hl(t.notes.replace(/\s+/g, ' '))}</span>` : '');
  a.append(txt);
  if (t.notes) {
    const ni = document.createElement('span');
    ni.className = 'note-ind';
    ni.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13"><path d="M6 4h9l4 4v12H6z"/><path d="M9 12h7M9 16h5"/></svg>';
    txt.after(ni);
  }
  const x = document.createElement('button');
  x.className = 'x';
  x.title = 'Remove';
  x.textContent = '×';
  a.append(x);
  const ed = document.createElement('button');
  ed.className = 'ed';
  ed.title = 'Edit name, link and notes';
  ed.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>';
  a.append(ed);

  a.addEventListener('click', (e) => {
    e.preventDefault();
    if (e.target.closest('.ed')) return openEditor(col, t);
    if (e.target === x) {
      commit(() => { col.tabs = col.tabs.filter((i) => i.id !== t.id); touch(col); }, 'Tab removed');
      return;
    }
    if (e.metaKey || e.ctrlKey || e.shiftKey) return chrome.tabs.create({ url: t.url, active: false });
    openHere(t.url);
  });
  a.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    chrome.tabs.create({ url: t.url, active: false });
  });
  a.addEventListener('dragstart', (e) => {
    drag = { kind: 'tab', colId: col.id, tabId: t.id };
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/uri-list', t.url);
    e.dataTransfer.setData('text/plain', t.url);
    requestAnimationFrame(() => { a.classList.add('dragging'); document.body.classList.add('dragging-item'); });
  });
  a.addEventListener('dragend', endDrag);
  return a;
}

function wireCol(el, col) {
  const head = $('.col-head', el);
  const name = $('.col-name', el);
  head.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-a]');
    if (btn) return colAction(btn.dataset.a, col, name);
    if (name.isContentEditable) return;
    commit(() => (col.collapsed = !col.collapsed));
  });
  name.addEventListener('dblclick', (e) => { e.stopPropagation(); startRename(name, col); });

  // Reorder collections (custom order only)
  head.addEventListener('dragstart', (e) => {
    if (e.target !== head) return;
    drag = { kind: 'col', colId: col.id };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', col.name);
  });
  head.addEventListener('dragend', endDrag);

  el.addEventListener('dragover', (e) => {
    if (drag?.kind === 'col') {
      if (drag.colId === col.id) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      clearMarks();
      el.classList.add(after ? 'drop-after' : 'drop-before');
      return;
    }
    if (!drag && !hasUrl(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = drag?.kind === 'tab' && !e.altKey ? 'move' : 'copy';
    clearMarks();
    el.classList.add('drag-over-body');
    const card = e.target.closest('.card');
    if (card && card.dataset.id !== drag?.tabId) card.classList.add('drop-before');
  });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('drag-over-body', 'drop-before', 'drop-after'); });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    if (drag?.kind === 'col') {
      const after = el.classList.contains('drop-after');
      return commit(() => moveCollection(drag.colId, col.id, after));
    }
    const beforeId = e.target.closest('.card')?.dataset.id || null;
    if (drag?.kind === 'tab') {
      const copy = e.altKey;
      return commit(() => moveTab(drag.colId, drag.tabId, col.id, beforeId, copy));
    }
    const items = drag?.kind === 'open' ? [drag.item] : itemsFromDrop(e);
    if (items.length) commit(() => { insertItems(col, items, beforeId); col.collapsed = false; });
  });
}

function colAction(a, col, nameEl) {
  const urls = col.tabs.map((t) => t.url);
  if (a === 'open') urls.forEach((url, i) => chrome.tabs.create({ url, active: i === 0 }));
  if (a === 'window' && urls.length) chrome.windows.create({ url: urls, focused: true });
  if (a === 'grab') windowTabs().then((items) => { if (items.length) commit(() => { insertItems(col, items, null); col.collapsed = false; }); });
  if (a === 'rename') startRename(nameEl, col);
  if (a === 'delete') commit(() => (state.collections = state.collections.filter((c) => c !== col)), `Deleted “${col.name}”`);
}

function startRename(el, col, isNew) {
  el.textContent = col.name;
  el.contentEditable = 'true';
  el.focus();
  document.getSelection().selectAllChildren(el);
  let done = false;
  const finish = (ok) => {
    if (done) return;
    done = true;
    el.contentEditable = 'false';
    const v = el.textContent.trim();
    if (ok && v) commit(() => { col.name = v; touch(col); });
    else if (isNew && !col.tabs.length && !ok) commit(() => (state.collections = state.collections.filter((c) => c !== col)));
    else render();
  };
  el.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') finish(false);
  };
  el.onblur = () => finish(true);
}

// ---------- card editor ----------
const dlg = $('#editDlg');
let editing = null;
function openEditor(col, t) {
  editing = { colId: col.id, tabId: t.id };
  $('#edTitle').value = tabName(t);
  $('#edUrl').value = t.url;
  $('#edNotes').value = t.notes || '';
  $('#edCol').textContent = col.name;
  $('#edFav').replaceChildren(favEl(t.url));
  dlg.showModal();
  $('#edTitle').focus();
  $('#edTitle').select();
}
$('#edForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const col = editing && findCol(editing.colId);
  const t = col?.tabs.find((i) => i.id === editing.tabId);
  let url = $('#edUrl').value.trim();
  if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
  try { new URL(url); } catch { $('#edUrl').focus(); $('#edUrl').setCustomValidity('Enter a valid link'); $('#edUrl').reportValidity(); return; }
  if (t) commit(() => {
    t.url = url;
    // Keep the custom name in its own field so it survives export/import as-is
    const name = $('#edTitle').value.trim();
    if (name && name !== t.title && name !== url) t.name = name; else delete t.name;
    const n = $('#edNotes').value.trim();
    if (n) t.notes = n; else delete t.notes;
    touch(col);
  });
  dlg.close();
});
$('#edUrl').addEventListener('input', () => $('#edUrl').setCustomValidity(''));
$('#edCancel').addEventListener('click', () => dlg.close());
$('#edNotes').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#edForm').requestSubmit(); });
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
dlg.addEventListener('close', () => (editing = null));

// ---------- mutations ----------
function insertItems(col, items, beforeId) {
  const idx = beforeId ? col.tabs.findIndex((t) => t.id === beforeId) : -1;
  const fresh = items.map((i) => ({ id: uid(), url: i.url, title: i.title || i.url, ...(i.name ? { name: i.name } : {}), ...(i.notes ? { notes: i.notes } : {}) }));
  if (idx < 0) col.tabs.push(...fresh);
  else col.tabs.splice(idx, 0, ...fresh);
  touch(col);
}
function moveTab(fromId, tabId, toId, beforeId, copy) {
  const from = findCol(fromId), to = findCol(toId);
  if (!from || !to || tabId === beforeId) return;
  const i = from.tabs.findIndex((t) => t.id === tabId);
  if (i < 0) return;
  const tab = copy ? { ...from.tabs[i], id: uid() } : from.tabs.splice(i, 1)[0];
  const j = beforeId ? to.tabs.findIndex((t) => t.id === beforeId) : -1;
  if (j < 0) to.tabs.push(tab); else to.tabs.splice(j, 0, tab);
  touch(from); touch(to);
  to.collapsed = false;
}
function moveCollection(fromId, targetId, after) {
  const cols = state.collections;
  const moving = cols.splice(cols.findIndex((c) => c.id === fromId), 1)[0];
  let j = cols.findIndex((c) => c.id === targetId);
  cols.splice(after ? j + 1 : j, 0, moving);
}
function newCollection(items = [], name = 'New collection', edit = true) {
  const col = { id: uid(), name, collapsed: false, updated: Date.now(), tabs: [] };
  insertItems(col, items, null);
  state.collections.unshift(col);
  if (state.sort !== 'custom' && state.sort !== 'recent') state.sort = 'custom';
  save();
  filter = ''; filterInput.value = '';
  render();
  if (edit) startRename($(`.col[data-id="${col.id}"] .col-name`), col, true);
  return col;
}

// ---------- drag helpers ----------
function hasUrl(e) {
  const t = e.dataTransfer.types;
  return t.includes('text/uri-list') || t.includes('text/plain');
}
function itemsFromDrop(e) {
  const raw = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '';
  return raw.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#') && /^[a-z][a-z0-9+.-]*:/i.test(s)).map((url) => ({ url, title: url }));
}
function clearMarks() {
  document.querySelectorAll('.drop-before,.drop-after,.drag-over-body').forEach((n) => n.classList.remove('drop-before', 'drop-after', 'drag-over-body'));
}
function endDrag() {
  drag = null;
  clearMarks();
  document.querySelectorAll('.dragging').forEach((n) => n.classList.remove('dragging'));
  document.body.classList.remove('dragging-item');
  $('#dropNew').classList.remove('over');
}

// Drop zone to create a new collection
const dropNew = $('#dropNew');
dropNew.addEventListener('dragover', (e) => { if (drag?.kind === 'col') return; e.preventDefault(); dropNew.classList.add('over'); });
dropNew.addEventListener('dragleave', () => dropNew.classList.remove('over'));
dropNew.addEventListener('drop', (e) => {
  e.preventDefault();
  let items = [];
  if (drag?.kind === 'open') items = [drag.item];
  else if (drag?.kind === 'tab') {
    const from = findCol(drag.colId);
    const t = from?.tabs.find((i) => i.id === drag.tabId);
    if (t) { items = [t]; if (!e.altKey) { from.tabs = from.tabs.filter((i) => i !== t); touch(from); } }
  } else items = itemsFromDrop(e);
  endDrag();
  if (items.length) newCollection(items);
});
// Show the drop zone when something external is dragged in
document.addEventListener('dragenter', (e) => { if (!drag && hasUrl(e)) document.body.classList.add('dragging-item'); });
document.addEventListener('drop', () => setTimeout(endDrag, 0));
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget && !drag) document.body.classList.remove('dragging-item'); });

// Cards open in a new tab by default; the "Open links in a new tab" setting switches to this tab
let selfTab = null;
chrome.tabs.getCurrent((t) => (selfTab = t || null));
function openHere(url) {
  if (state.openNewTab === false && selfTab) chrome.tabs.update(selfTab.id, { url });
  else chrome.tabs.create({ url, active: true });
}

// ---------- open tabs sidebar ----------
async function windowTabs() {
  const win = await chrome.windows.getCurrent();
  const tabs = await chrome.tabs.query({ windowId: win.id });
  return tabs.filter((t) => saveable(t.url)).map((t) => ({ url: t.url, title: t.title || t.url }));
}

let sidebarTimer;
function scheduleSidebar() { clearTimeout(sidebarTimer); sidebarTimer = setTimeout(renderSidebar, 120); }
async function renderSidebar() {
  if (!state.sidebar) return;
  const wins = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  const cur = await chrome.windows.getCurrent();
  wins.sort((a, b) => (b.id === cur.id) - (a.id === cur.id));
  const box = $('#openTabs');
  box.textContent = '';
  let count = 0;
  wins.forEach((w, wi) => {
    const tabs = w.tabs.filter((t) => saveable(t.url));
    if (!tabs.length) return;
    if (wins.length > 1) {
      const lbl = document.createElement('div');
      lbl.className = 'win-label';
      lbl.textContent = w.id === cur.id ? 'This window' : `Window ${wi + 1}`;
      box.append(lbl);
    }
    for (const t of tabs) {
      count++;
      const row = document.createElement('div');
      row.className = 'otab' + (t.active ? ' active' : '');
      row.draggable = true;
      row.title = `${t.title}\n${t.url}\n\nClick to switch · drag into a collection`;
      row.append(favEl(t.url));
      const s = document.createElement('span');
      s.className = 't';
      s.textContent = t.title || t.url;
      row.append(s);
      row.addEventListener('click', () => { chrome.tabs.update(t.id, { active: true }); chrome.windows.update(t.windowId, { focused: true }); });
      row.addEventListener('dragstart', (e) => {
        drag = { kind: 'open', item: { url: t.url, title: t.title } };
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/uri-list', t.url);
        document.body.classList.add('dragging-item');
      });
      row.addEventListener('dragend', endDrag);
      box.append(row);
    }
  });
  $('#openCount').textContent = count;
}
['onCreated', 'onRemoved', 'onUpdated', 'onMoved', 'onAttached', 'onDetached', 'onActivated'].forEach((ev) => chrome.tabs[ev].addListener(scheduleSidebar));

$('#sideToggle').addEventListener('click', () => commit(() => (state.sideCollapsed = !state.sideCollapsed)));

// ---------- toast ----------
let toastTimer;
function toast(msg, undo) {
  const t = $('#toast');
  $('#toastMsg').textContent = msg;
  $('#toastUndo').hidden = !undo;
  $('#toastUndo').onclick = () => { undo?.(); t.hidden = true; };
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 6000);
}

// ---------- appearance ----------
let bgImage = ''; // stored under its own key so exports stay small
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function applyTheme() {
  const t = { ...DEFAULT.theme, ...(state.theme || {}) };
  const root = document.documentElement.style;
  for (const k of ['bg', 'card', 'text', 'accent']) root.setProperty('--' + k, t[k]);
  root.setProperty('--dim', t.dim + '%');
  root.colorScheme = lum(t.bg) > 0.4 ? 'light' : 'dark';
  document.querySelectorAll('.colors input').forEach((i) => { if (document.activeElement !== i) i.value = t[i.dataset.key]; });
  document.querySelectorAll('.theme').forEach((b) => b.classList.toggle('on', b.dataset.preset === t.preset));
  $('#bgDim').value = t.dim;
  $('#bgDimVal').textContent = t.dim + '%';
}
function renderThemeButtons() {
  const box = $('#themes');
  for (const [key, th] of Object.entries(THEMES)) {
    const b = document.createElement('button');
    b.className = 'theme';
    b.dataset.preset = key;
    b.innerHTML = `<span class="sw" style="background:linear-gradient(135deg, ${th.bg} 55%, ${th.card} 55%);--sw-accent:${th.accent}"></span>${th.name}`;
    const { name, ...colors } = th;
    void name;
    b.addEventListener('click', () => commit(() => (state.theme = { ...DEFAULT.theme, ...state.theme, ...colors, preset: key })));
    box.append(b);
  }
}
document.querySelectorAll('.colors input').forEach((inp) => {
  inp.addEventListener('input', () => {
    state.theme = { ...DEFAULT.theme, ...state.theme, preset: 'custom', [inp.dataset.key]: inp.value };
    applyTheme();
  });
  inp.addEventListener('change', () => commit(() => {}));
});
$('#bgDim').addEventListener('input', (e) => { state.theme = { ...DEFAULT.theme, ...state.theme, dim: +e.target.value }; applyTheme(); });
$('#bgDim').addEventListener('change', () => commit(() => {}));

function showBg() {
  document.body.classList.toggle('has-bg', !!bgImage);
  document.documentElement.style.setProperty('--bg-img', bgImage ? `url("${bgImage}")` : 'none');
  $('#bgThumb').style.backgroundImage = bgImage ? `url("${bgImage}")` : '';
  $('#bgStatus').textContent = bgImage ? 'Image set' : 'None';
  $('#bgRemove').hidden = !bgImage;
  $('#dimRow').hidden = !bgImage;
}
async function loadBg() {
  const { stashBg } = await chrome.storage.local.get('stashBg');
  bgImage = stashBg || '';
  showBg();
}
$('#bgPick').addEventListener('click', () => $('#bgFile').click());
$('#bgFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    // Downscale big photos so storage stays light
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 2560 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    bgImage = c.toDataURL('image/jpeg', 0.86);
    await chrome.storage.local.set({ stashBg: bgImage });
    showBg();
  } catch {
    toast('Could not read that image');
  }
});
$('#bgRemove').addEventListener('click', async () => {
  bgImage = '';
  await chrome.storage.local.remove('stashBg');
  showBg();
});
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch.stashBg) { bgImage = ch.stashBg.newValue || ''; showBg(); }
});

// ---------- settings ----------
const setDlg = $('#settingsDlg');
const filterInput = $('#filter');
function openSettings(focusFilter) {
  if (!setDlg.open) setDlg.showModal();
  if (focusFilter) { filterInput.focus(); filterInput.select(); }
  else $('#setClose').focus();
}
function setFilter(v) {
  filterInput.value = v;
  filter = v.trim().toLowerCase();
  render();
}
$('#settingsBtn').addEventListener('click', () => openSettings(false));
$('#setClose').addEventListener('click', () => setDlg.close());
setDlg.addEventListener('click', (e) => { if (e.target === setDlg) setDlg.close(); });
filterInput.addEventListener('input', () => setFilter(filterInput.value));
filterInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); setDlg.close(); } });
$('#filterClear').addEventListener('click', () => setFilter(''));
$('#filterChipText').addEventListener('click', () => openSettings(true));

$('#sortSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) commit(() => (state.sort = b.dataset.sort)); });
$('#viewSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) commit(() => (state.view = b.dataset.view)); });
$('#newTabToggle').addEventListener('change', (e) => commit(() => (state.openNewTab = e.target.checked)));
$('#wpToggle').addEventListener('change', (e) => { if (e.target.checked) setDlg.close(); setWallpaperOnly(e.target.checked); });
$('#sidebarToggle').addEventListener('change', (e) => { commit(() => (state.sidebar = e.target.checked)); renderSidebar(); });

$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `stash-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast('Exported ' + plural(state.collections.length, 'collection'));
});
$('#importBtn').addEventListener('click', () => $('#importFile').click());

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const cols = Array.isArray(data) ? data : data.collections;
    if (!Array.isArray(cols)) throw new Error('No collections found');
    const clean = cols.map((c) => ({
      id: uid(), name: String(c.name || c.title || 'Imported'), collapsed: true, updated: Date.now(),
      tabs: (c.tabs || c.cards || []).filter((t) => t && t.url).map((t) => ({ id: uid(), url: String(t.url), title: String(t.title || t.url), ...(t.name ? { name: String(t.name) } : {}), ...(t.notes ? { notes: String(t.notes) } : {}) })),
    }));
    commit(() => state.collections.push(...clean), `Imported ${plural(clean.length, 'collection')}`);
  } catch (err) {
    toast('Import failed: ' + err.message);
  }
});

$('#addCol').addEventListener('click', () => newCollection());
$('#toggleAll').addEventListener('click', () => {
  const allCollapsed = state.collections.every((c) => c.collapsed);
  commit(() => state.collections.forEach((c) => (c.collapsed = !allCollapsed)));
});
$('#saveWindow').addEventListener('click', async () => {
  const items = await windowTabs();
  if (!items.length) return toast('No tabs to save in this window');
  newCollection(items, 'Window — ' + new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
});

// Workspace rename
const ws = $('#wsName');
ws.addEventListener('dblclick', () => {
  ws.contentEditable = 'true';
  ws.focus();
  document.getSelection().selectAllChildren(ws);
});
ws.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); ws.blur(); }
  if (e.key === 'Escape') { ws.textContent = state.name; ws.blur(); }
});
ws.addEventListener('blur', () => {
  ws.contentEditable = 'false';
  const v = ws.textContent.trim();
  if (v && v !== state.name) commit(() => (state.name = v)); else ws.textContent = state.name;
});

// ---------- wallpaper-only mode ----------
const MOD_KEYS = ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Fn'];
const RESERVED = ['Slash', 'KeyN', 'Backslash', 'Escape', 'Enter', 'Tab'];
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const wpKey = () => ({ ...DEFAULT_WP_KEY, ...(state.wallpaperKey || {}) });
function keyName(code, key) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return 'Num ' + code.slice(6);
  const named = { Space: 'Space', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  return named[code] || key || code;
}
function comboLabel(k) {
  const parts = [];
  if (k.ctrl) parts.push(IS_MAC ? '⌃' : 'Ctrl');
  if (k.alt) parts.push(IS_MAC ? '⌥' : 'Alt');
  if (k.shift) parts.push(IS_MAC ? '⇧' : 'Shift');
  if (k.meta) parts.push(IS_MAC ? '⌘' : 'Win');
  parts.push(keyName(k.code, k.key));
  return parts.join(IS_MAC ? '' : '+');
}
const keyMatches = (e, k) => e.code === k.code && e.ctrlKey === !!k.ctrl && e.altKey === !!k.alt && e.shiftKey === !!k.shift && e.metaKey === !!k.meta;

let recordingKey = false;
function renderWpKey() {
  const lbl = $('#wpKeyLabel');
  lbl.textContent = recordingKey ? 'Press keys…' : comboLabel(wpKey());
  lbl.classList.toggle('recording', recordingKey);
  $('#wpKeyRecord').textContent = recordingKey ? 'Cancel' : 'Change…';
  const k = wpKey();
  $('#wpKeyReset').hidden = recordingKey || (k.code === DEFAULT_WP_KEY.code && !k.ctrl && !k.alt && !k.shift && !k.meta);
}
function stopRecording() { recordingKey = false; renderWpKey(); }
$('#wpKeyRecord').addEventListener('click', () => { recordingKey = !recordingKey; renderWpKey(); });
$('#wpKeyReset').addEventListener('click', () => commit(() => (state.wallpaperKey = { ...DEFAULT_WP_KEY })));
setDlg.addEventListener('close', stopRecording);
setDlg.addEventListener('cancel', (e) => { if (recordingKey) { e.preventDefault(); stopRecording(); } });
window.addEventListener('keydown', (e) => {
  if (!recordingKey) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.key === 'Escape') return stopRecording();
  if (MOD_KEYS.includes(e.key)) return;
  const k = { code: e.code, key: e.key.length === 1 ? e.key.toUpperCase() : e.key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
  const plain = !k.ctrl && !k.alt && !k.meta;
  if (RESERVED.includes(k.code) && (plain || k.code === 'Escape')) { toast(`${comboLabel(k)} is already used by Stash. Try another key`); return; }
  recordingKey = false;
  commit(() => (state.wallpaperKey = k));
  toast('Wallpaper shortcut set to ' + comboLabel(k));
}, true);

let hintTimer;
function setWallpaperOnly(on) {
  if (!!state.wallpaperOnly === on) return render();
  commit(() => (state.wallpaperOnly = on));
  const hint = $('#wpHint');
  clearTimeout(hintTimer);
  if (!on) { hint.hidden = true; return; }
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  hint.textContent = `Press ${comboLabel(wpKey())} or Esc to show Stash`;
  hint.classList.remove('fade');
  hint.hidden = false;
  hintTimer = setTimeout(() => { hint.classList.add('fade'); hintTimer = setTimeout(() => (hint.hidden = true), 700); }, 2200);
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (state.wallpaperOnly) {
    if (e.key === 'Escape' || keyMatches(e, wpKey())) { e.preventDefault(); setWallpaperOnly(false); }
    return;
  }
  if (dlg.open || setDlg.open || e.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (keyMatches(e, wpKey())) { e.preventDefault(); setWallpaperOnly(true); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === '/') { e.preventDefault(); openSettings(true); }
  if (e.key === 'n') { e.preventDefault(); newCollection(); }
  if (e.key === '\\' && state.sidebar) { e.preventDefault(); commit(() => (state.sideCollapsed = !state.sideCollapsed)); }
});

// ---------- boot ----------
renderThemeButtons();
load().then(() => { render(); renderSidebar(); loadBg(); });
