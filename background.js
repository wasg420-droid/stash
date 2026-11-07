// Stash background: opens the manager and provides the "Save to Stash" context menu.

const MANAGER = chrome.runtime.getURL('manager.html');
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const CTX = ['page', 'link', 'action'];

chrome.action.onClicked.addListener(openManager);

async function openManager() {
  const [existing] = await chrome.tabs.query({ url: MANAGER });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: MANAGER });
  }
}

// ---- Context menu, rebuilt whenever collections change ----
let building = Promise.resolve();
function rebuildMenus() {
  building = building.then(buildMenus).catch(() => {});
  return building;
}

async function buildMenus() {
  await chrome.contextMenus.removeAll();
  const { stash } = await chrome.storage.local.get('stash');
  const cols = stash?.collections || [];
  const noop = () => void chrome.runtime.lastError;
  chrome.contextMenus.create({ id: 'root', title: 'Save to Stash', contexts: CTX }, noop);
  for (const c of cols) {
    chrome.contextMenus.create({ id: 'col:' + c.id, parentId: 'root', title: c.name || 'Untitled', contexts: CTX }, noop);
  }
  if (cols.length) chrome.contextMenus.create({ id: 'sep', parentId: 'root', type: 'separator', contexts: CTX }, noop);
  chrome.contextMenus.create({ id: 'new', parentId: 'root', title: 'New collection “Unsorted”', contexts: CTX }, noop);
  chrome.contextMenus.create({ id: 'window', parentId: 'root', title: 'Save all tabs in this window…', contexts: ['page', 'action'] }, noop);
  chrome.contextMenus.create({ id: 'open', parentId: 'root', title: 'Open Stash', contexts: CTX }, noop);
}

chrome.runtime.onInstalled.addListener(rebuildMenus);
chrome.runtime.onStartup.addListener(rebuildMenus);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.stash) return;
  const names = (v) => JSON.stringify((v?.collections || []).map((c) => [c.id, c.name]));
  if (names(changes.stash.oldValue) !== names(changes.stash.newValue)) rebuildMenus();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'open') return openManager();

  const { stash } = await chrome.storage.local.get('stash');
  const state = stash || { name: 'Personal', sort: 'custom', view: 'compact', collections: [] };
  state.collections ||= [];

  let items;
  if (info.menuItemId === 'window') {
    const tabs = await chrome.tabs.query({ windowId: tab.windowId });
    items = tabs.filter((t) => saveable(t.url)).map((t) => ({ id: uid(), url: t.url, title: t.title || t.url }));
    state.collections.push({ id: uid(), name: 'Window — ' + new Date().toLocaleString(), collapsed: false, updated: Date.now(), tabs: items });
  } else {
    const url = info.linkUrl || tab?.url;
    if (!saveable(url)) return;
    const title = info.linkUrl ? info.selectionText || info.linkUrl : tab.title || url;
    const item = { id: uid(), url, title };
    let col;
    if (info.menuItemId === 'new') {
      col = state.collections.find((c) => c.name === 'Unsorted');
      if (!col) state.collections.push((col = { id: uid(), name: 'Unsorted', collapsed: false, tabs: [] }));
    } else {
      col = state.collections.find((c) => 'col:' + c.id === info.menuItemId);
    }
    if (!col) return;
    col.tabs.push(item);
    col.updated = Date.now();
  }
  state.updated = Date.now();
  state.rev = uid();
  await chrome.storage.local.set({ stash: state });
  chrome.action.setBadgeText({ text: '✓', tabId: tab?.id });
  setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab?.id }), 1200);
});

function saveable(url) {
  return !!url && !url.startsWith(MANAGER) && !/^(chrome|helium|about|devtools|edge):\/\/newtab/i.test(url);
}
