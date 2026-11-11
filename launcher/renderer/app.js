// Quasar launcher UI. Talks to the Electron main process through window.quasar (preload.js).
// When opened in a plain browser, a mock API is used so the UI can be previewed.

const api = window.quasar || createMockApi();
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  modules: [], settings: null, info: null, busy: false, logLines: [], installed: [],
  browse: {
    source: 'modrinth', query: '', loader: 'fabric', side: 'any', sort: 'relevance', category: '',
    results: [], total: 0, offset: 0, loading: false, request: 0, installing: new Set(),
  },
};

document.body.classList.add(`platform-${api.platform}`);

const LOADER_NAMES = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
const SOURCE_NAMES = { modrinth: 'Modrinth', curseforge: 'CurseForge' };
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const ICON_DOWNLOADS = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" /></svg>';
const ICON_UPDATED = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>';

function ago(iso) {
  const days = Math.round((new Date(iso) - Date.now()) / 86400000);
  if (Math.abs(days) < 1) return 'today';
  if (Math.abs(days) < 30) return rtf.format(days, 'day');
  if (Math.abs(days) < 365) return rtf.format(Math.round(days / 30), 'month');
  return rtf.format(Math.round(days / 365), 'year');
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function modIcon(src, title, small = false) {
  const cls = `mod-icon${small ? ' small' : ''}`;
  const letter = () => {
    const box = el('span', cls, (title || '?').trim().charAt(0).toUpperCase());
    box.setAttribute('aria-hidden', 'true');
    return box;
  };
  if (!src) return letter();
  const img = el('img', cls);
  img.src = src;
  img.alt = '';
  img.loading = 'lazy';
  img.addEventListener('error', () => img.replaceWith(letter()));
  return img;
}

// ------------------------------------------------------------------ navigation

function go(page) {
  $$('.dock-item').forEach((b) => {
    if (b.dataset.page === page) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  $$('.page').forEach((p) => (p.hidden = p.id !== `page-${page}`));
  if (page === 'console') $('#console-alert').hidden = true;
  if (page === 'browse' && !state.browse.results.length && !state.browse.loading) runSearch();
}
$$('.dock-item').forEach((b) => b.addEventListener('click', () => go(b.dataset.page)));
document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-goto]');
  if (target) go(target.dataset.goto);
});

if (api.platform === 'darwin') $('#win-controls').hidden = true;
$$('[data-win]').forEach((b) => b.addEventListener('click', () => api.window(b.dataset.win)));

// ------------------------------------------------------------------ toast

let toastTimer;
function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
}

// ------------------------------------------------------------------ console

function addLog(line) {
  const con = $('#console');
  if (state.logLines.length === 0) con.textContent = '';
  state.logLines.push(line);
  const kind = /ERROR/.test(line) ? 'err' : /Done\.|Build finished|Installed /.test(line) ? 'ok' : '';
  con.appendChild(el('span', kind, line + '\n'));
  const page = $('#page-console');
  page.scrollTop = page.scrollHeight;
  if (page.hidden && /ERROR/.test(line)) $('#console-alert').hidden = false;
}
api.onLog(addLog);

$('#copy-log').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.logLines.join('\n'));
    toast('Console copied.');
  } catch {
    toast('Could not copy the console. Select the text and copy it instead.');
  }
});
$('#clear-log').addEventListener('click', () => {
  state.logLines = [];
  $('#console').innerHTML = '<span class="placeholder">Console cleared.</span>';
});

// ------------------------------------------------------------------ play

function setProgress(value, status) {
  $('#play-status').classList.remove('error');
  $('#progress').hidden = false;
  $('#progress').setAttribute('aria-valuenow', String(Math.round(value * 100)));
  $('#progress-fill').style.transform = `scaleX(${value})`;
  $('#progress-status').textContent = status;
}
api.onProgress(setProgress);

api.onGameState((s) => {
  state.gameRunning = s === 'running';
  setBusy(state.gameRunning, state.gameRunning ? 'Running' : 'Play');
  if (!state.gameRunning) $('#progress-status').textContent = idleStatus();
});

function directLaunch() {
  return Boolean(state.settings?.signedIn);
}

function idleStatus() {
  return directLaunch()
    ? `Starts Minecraft as ${state.settings.accountName}.`
    : 'Opens the Minecraft Launcher with the Quasar Client profile. Sign in under Settings to start Minecraft directly.';
}

function setBusy(busy, label) {
  state.busy = busy;
  // aria-disabled instead of disabled, so keyboard focus stays on the button while it works.
  $('#play-btn').setAttribute('aria-disabled', String(busy));
  $('#home-build').setAttribute('aria-disabled', String(busy));
  $('#play-label').textContent = label || 'Play';
}

$('#play-btn').addEventListener('click', async () => {
  if (state.busy) return;
  setBusy(true, 'Setting up…');
  setProgress(0.01, 'Starting…');
  const result = await api.play();
  // If the game is now running, keep the button showing that instead of resetting to Play.
  setBusy(Boolean(state.gameRunning), state.gameRunning ? 'Running' : 'Play');
  if (result.ok) {
    $('#progress').hidden = true;
    if (result.mode === 'direct') {
      toast(`Minecraft is starting as ${result.name}.`);
    } else if (result.fallbackReason) {
      $('#progress-status').textContent = `${result.fallbackReason} The Minecraft Launcher opened instead.`;
    } else {
      toast(result.opened
        ? 'Minecraft Launcher opened. Choose Quasar Client there and press Play.'
        : 'Quasar is installed. Open the Minecraft Launcher and choose Quasar Client.');
    }
    state.settings = await api.getSettings();
    renderSettings();
    refreshInfo();
    refreshInstalled();
  } else {
    $('#play-status').classList.add('error');
    $('#progress').hidden = true;
    $('#progress-status').textContent = `${result.error} See Console for details.`;
  }
});

$('#home-build').addEventListener('click', async () => {
  if (state.busy) return;
  setBusy(true, 'Building…');
  go('console');
  $('#console').focus();
  const result = await api.buildMod();
  setBusy(false);
  toast(result.ok ? 'Mod built.' : `Build failed: ${result.error}`);
  refreshInfo();
});
$('#home-folder').addEventListener('click', () => api.openGameFolder());

async function refreshInfo() {
  state.info = await api.getInfo();
  const { info } = state;
  $$('.mc-version').forEach((e) => (e.textContent = info.mcVersion));
  $$('.loader-version').forEach((e) => (e.textContent = info.loaderVersion));
  $('#app-version').textContent = info.appVersion;
  $('#game-dir').textContent = info.gameDir;
  $('#home-game-dir').textContent = info.gameDir;

  const jarState = $('#jar-state');
  if (info.modJar) {
    jarState.textContent = 'Ready';
    jarState.className = 'state ok';
    $('#jar-detail').textContent = info.modJar.split(/[\\/]/).pop();
  } else {
    jarState.textContent = 'Not built';
    jarState.className = 'state warn';
    $('#jar-detail').textContent = info.canBuild
      ? 'Not built yet. Play builds it for you (needs Java 21).'
      : 'Not found. Choose the mod file in Settings.';
  }
  $('#home-build').hidden = !info.canBuild;
  $('#home-build').textContent = info.modJar ? 'Rebuild' : 'Build mod';
  $('#mod-jar').textContent = state.settings?.modJar
    || (info.modJar ? `Found automatically: ${info.modJar}` : 'Not found');
}

function renderHomeMods() {
  const added = state.installed.filter((m) => m.removable);
  $('#fact-mods').textContent = String(added.length);
  const root = $('#home-mods');
  root.textContent = '';
  if (!added.length) {
    const card = el('div', 'empty-card');
    card.appendChild(el('span', '', 'No extra mods yet. Add some from Modrinth or CurseForge.'));
    const btn = el('button', 'btn', 'Browse mods');
    btn.dataset.goto = 'browse';
    card.appendChild(btn);
    root.appendChild(card);
    return;
  }
  const strip = el('div', 'mod-strip');
  const shown = added.slice(0, 8);
  for (const m of shown) {
    const item = el('div', 'mod-strip-item');
    item.append(modIcon(m.icon, m.title, true), el('span', '', m.title));
    strip.appendChild(item);
  }
  if (added.length > shown.length) strip.appendChild(el('span', 'mod-strip-more', `and ${added.length - shown.length} more`));
  root.appendChild(strip);
}

// ------------------------------------------------------------------ browse: views

function showBrowseView(view) {
  const discover = view === 'discover';
  $('#tab-discover').setAttribute('aria-selected', String(discover));
  $('#tab-installed').setAttribute('aria-selected', String(!discover));
  $('#tab-discover').tabIndex = discover ? 0 : -1;
  $('#tab-installed').tabIndex = discover ? -1 : 0;
  $('#view-discover').hidden = !discover;
  $('#view-installed').hidden = discover;
}
$('#tab-discover').addEventListener('click', () => showBrowseView('discover'));
$('#tab-installed').addEventListener('click', () => showBrowseView('installed'));
$('[role="tablist"]').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const next = $('#tab-discover').getAttribute('aria-selected') === 'true' ? 'installed' : 'discover';
  showBrowseView(next);
  $(`#tab-${next}`).focus();
});

// ------------------------------------------------------------------ browse: filters

async function loadCategories() {
  const root = $('#filter-categories');
  let list = [];
  try {
    list = await api.getCategories(state.browse.source);
  } catch { /* no key or offline: show only "All categories" */ }
  root.textContent = '';
  for (const c of [{ id: '', name: 'All categories' }, ...list]) {
    const b = el('button', 'btn toggle', c.name);
    b.setAttribute('aria-pressed', String(c.id === state.browse.category));
    b.addEventListener('click', () => {
      state.browse.category = c.id;
      $$('#filter-categories .toggle').forEach((t) => t.setAttribute('aria-pressed', String(t === b)));
      runSearch();
    });
    root.appendChild(b);
  }
}

$$('[data-source]').forEach((b) => b.addEventListener('click', () => {
  if (state.browse.source === b.dataset.source) return;
  state.browse.source = b.dataset.source;
  state.browse.category = '';
  $$('[data-source]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  const cf = state.browse.source === 'curseforge';
  $('#filter-side').disabled = cf;
  $('#filter-side').title = cf ? 'CurseForge does not say whether a mod runs on the client or the server.' : '';
  loadCategories();
  runSearch();
}));

let queryTimer;
$('#mod-query').addEventListener('input', (e) => {
  state.browse.query = e.target.value.trim();
  clearTimeout(queryTimer);
  queryTimer = setTimeout(runSearch, 300);
});
$('#filter-loader').addEventListener('change', (e) => { state.browse.loader = e.target.value; runSearch(); });
$('#filter-side').addEventListener('change', (e) => { state.browse.side = e.target.value; runSearch(); });
$('#filter-sort').addEventListener('change', (e) => { state.browse.sort = e.target.value; runSearch(); });
$('#load-more').addEventListener('click', () => {
  if ($('#load-more').getAttribute('aria-disabled') !== 'true') runSearch(true);
});

// ------------------------------------------------------------------ browse: results

function skeleton(count) {
  const box = el('div', 'rows');
  box.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < count; i++) {
    const s = el('div', 'skeleton');
    const lines = el('div', 'skeleton-lines');
    ['40%', '85%', '30%'].forEach((w) => {
      const b = el('div', 'skeleton-block');
      b.style.width = w;
      lines.appendChild(b);
    });
    s.append(el('div', 'skeleton-block icon'), lines);
    box.appendChild(s);
  }
  return box;
}

function notice(title, body, actionLabel, action) {
  const n = el('div', 'notice');
  n.append(el('h2', 'section-title', title), el('p', '', body));
  if (actionLabel) {
    const b = el('button', 'btn', actionLabel);
    b.addEventListener('click', action);
    n.appendChild(b);
  }
  return n;
}

async function runSearch(more = false) {
  const b = state.browse;
  const request = ++b.request;
  b.loading = true;
  if (!more) {
    b.offset = 0;
    b.results = [];
    $('#results').replaceChildren(skeleton(4));
    $('#results-count').textContent = 'Searching…';
    $('#load-more').hidden = true;
  } else {
    $('#load-more').setAttribute('aria-disabled', 'true');
  }

  const res = await api.searchMods({
    source: b.source, query: b.query, loader: b.loader, side: b.side,
    sort: b.sort, category: b.category, offset: b.offset,
  });
  if (request !== b.request) return; // a newer search started
  b.loading = false;
  $('#load-more').removeAttribute('aria-disabled');

  if (!res.ok) {
    $('#results-count').textContent = '';
    $('#load-more').hidden = true;
    $('#results').replaceChildren(res.code === 'NO_KEY'
      ? notice('CurseForge needs an API key', 'Add your free key in Settings to search CurseForge. Modrinth works without one.', 'Open Settings', () => { go('settings'); $('#cf-key').focus(); })
      : notice('Search did not work', res.error, 'Try again', () => runSearch()));
    return;
  }

  b.results = more ? [...b.results, ...res.results] : res.results;
  b.offset = res.offset;
  b.total = res.total;
  $('#results-count').textContent = `${b.total.toLocaleString('en')} ${b.total === 1 ? 'mod' : 'mods'} on ${SOURCE_NAMES[b.source]}`;
  $('#load-more').hidden = b.results.length >= b.total;
  renderResults();
}

function isInstalled(r) {
  return state.installed.some((m) => m.source === r.source && m.id === r.id);
}

function renderResults() {
  const { results } = state.browse;
  if (!results.length) {
    $('#results').replaceChildren(notice('No mods found', 'Try another search word, a different category, or a different loader.', 'Clear filters', clearFilters));
    return;
  }
  const list = el('div', 'rows');
  for (const r of results) list.appendChild(resultRow(r));
  $('#results').replaceChildren(list);
}

function resultRow(r) {
  const row = el('div', 'row mod-row');
  row.dataset.key = `${r.source}:${r.id}`;
  const text = el('div', 'row-text');
  const title = el('span', 'row-title', r.title);
  title.appendChild(el('span', 'mod-by', ` by ${r.author}`));
  text.append(title, el('p', 'row-sub', r.description));

  const meta = el('div', 'mod-meta');
  const dl = el('span');
  dl.innerHTML = ICON_DOWNLOADS;
  dl.append(`${compact.format(r.downloads)} downloads`);
  const up = el('span');
  up.innerHTML = ICON_UPDATED;
  up.append(`Updated ${ago(r.updated)}`);
  meta.append(dl, up);
  if (r.loaders.length) meta.appendChild(el('span', '', r.loaders.map((l) => LOADER_NAMES[l] || l).join(', ')));
  r.categories.slice(0, 3).forEach((c) => meta.appendChild(el('span', 'tag', c)));
  text.appendChild(meta);

  const actions = el('div', 'row-actions');
  const key = `${r.source}:${r.id}`;
  if (isInstalled(r)) {
    actions.appendChild(el('span', 'state ok', 'Installed'));
  } else if (!r.loaders.includes('fabric')) {
    const needs = r.loaders.length ? LOADER_NAMES[r.loaders[0]] || r.loaders[0] : 'another loader';
    const btn = el('button', 'btn', `Needs ${needs}`);
    btn.setAttribute('aria-disabled', 'true');
    btn.title = 'Quasar runs on Fabric, so this mod cannot be installed.';
    actions.appendChild(btn);
  } else {
    const busy = state.browse.installing.has(key);
    const btn = el('button', 'btn accent', busy ? 'Installing…' : 'Install');
    btn.setAttribute('aria-label', busy ? `Installing ${r.title}` : `Install ${r.title}`);
    if (busy) btn.setAttribute('aria-disabled', 'true');
    btn.addEventListener('click', () => installMod(r, btn));
    actions.appendChild(btn);
  }
  const page = el('button', 'btn', 'View page');
  page.setAttribute('aria-label', `View ${r.title} on ${SOURCE_NAMES[r.source]}`);
  page.addEventListener('click', () => api.openLink(r.url));
  actions.appendChild(page);

  row.append(modIcon(r.icon, r.title), text, actions);
  return row;
}

async function installMod(r, btn) {
  const key = `${r.source}:${r.id}`;
  if (state.browse.installing.has(key)) return;
  state.browse.installing.add(key);
  btn.textContent = 'Installing…';
  btn.setAttribute('aria-label', `Installing ${r.title}`);
  btn.setAttribute('aria-disabled', 'true');
  const res = await api.installMod(r.source, r.id);
  state.browse.installing.delete(key);
  if (res.ok) {
    const extra = res.installed.length - 1;
    toast(extra > 0
      ? `Installed ${r.title} and ${extra} required ${extra === 1 ? 'mod' : 'mods'}.`
      : `Installed ${r.title}.`);
  } else {
    toast(`Could not install ${r.title}: ${res.error}`);
  }
  await refreshInstalled();
  renderResults();
  // The list was rebuilt: put focus back on the same mod's row.
  $(`.mod-row[data-key="${CSS.escape(key)}"] .row-actions button`)?.focus();
}

function clearFilters() {
  const b = state.browse;
  b.query = ''; b.category = ''; b.loader = 'fabric'; b.side = 'any'; b.sort = 'relevance';
  $('#mod-query').value = '';
  $('#filter-loader').value = 'fabric';
  $('#filter-side').value = 'any';
  $('#filter-sort').value = 'relevance';
  $$('#filter-categories .toggle').forEach((t, i) => t.setAttribute('aria-pressed', String(i === 0)));
  runSearch();
  $('#mod-query').focus();
}

// ------------------------------------------------------------------ browse: installed

async function refreshInstalled() {
  state.installed = await api.getInstalled();
  $('#installed-count').textContent = String(state.installed.length);
  renderInstalled();
  renderHomeMods();
}

function renderInstalled() {
  const root = $('#installed-list');
  if (!state.installed.length) {
    root.replaceChildren(notice('Nothing installed yet', 'Press Play once to set up Quasar, then add mods from Discover.', 'Discover mods', () => { showBrowseView('discover'); $('#tab-discover').focus(); }));
    return;
  }
  const list = el('div', 'rows');
  for (const m of state.installed) {
    const row = el('div', 'row');
    const text = el('div', 'row-text');
    const where = m.requiredBy ? `Needed by ${m.requiredBy}` : m.source ? `From ${SOURCE_NAMES[m.source]}` : 'Added by hand';
    text.append(el('span', 'row-title', m.title), el('span', 'row-sub', `${where}. ${m.file}`));
    const actions = el('div', 'row-actions');
    if (m.url) {
      const page = el('button', 'btn', 'View page');
      page.setAttribute('aria-label', `View ${m.title} on ${SOURCE_NAMES[m.source] || 'its website'}`);
      page.addEventListener('click', () => api.openLink(m.url));
      actions.appendChild(page);
    }
    if (m.removable) {
      const rm = el('button', 'btn', 'Remove');
      rm.setAttribute('aria-label', `Remove ${m.title}`);
      rm.addEventListener('click', async () => {
        const res = await api.removeMod(m.file);
        toast(res.ok ? `Removed ${m.title}.` : res.error);
        await refreshInstalled();
        if (state.browse.results.length) renderResults();
        $('#tab-installed').focus();
      });
      actions.appendChild(rm);
    } else {
      actions.appendChild(el('span', 'state', 'Required'));
    }
    row.append(modIcon(m.icon, m.title, true), text, actions);
    list.appendChild(row);
  }
  root.replaceChildren(list);
}

// ------------------------------------------------------------------ features (Quasar's built-in modules)

function renderFeatures() {
  const query = $('#mod-search').value.trim().toLowerCase();
  const groups = {};
  for (const m of state.modules) {
    if (query && !`${m.name} ${m.description} ${m.category}`.toLowerCase().includes(query)) continue;
    (groups[m.category] ||= []).push(m);
  }
  const root = $('#mod-groups');
  root.textContent = '';
  const names = Object.keys(groups);
  if (!names.length) {
    root.appendChild(notice('No features match your search', 'Try a different word.', 'Clear search', () => {
      $('#mod-search').value = '';
      renderFeatures();
      $('#mod-search').focus();
    }));
  }

  for (const cat of names) {
    root.appendChild(el('h2', 'section-title', cat));
    const list = el('div', 'rows');
    for (const m of groups[cat]) {
      const row = el('label', 'row');
      row.innerHTML = `
        <span class="row-text"><span class="row-title"></span><span class="row-sub"></span></span>
        <span class="row-actions"><input type="checkbox" class="switch" role="switch" /></span>`;
      row.querySelector('.row-title').textContent = m.name;
      row.querySelector('.row-sub').textContent = m.description;
      const input = row.querySelector('input');
      input.checked = m.enabled;
      input.addEventListener('change', () => toggleFeature(m.name, input.checked));
      list.appendChild(row);
    }
    root.appendChild(list);
  }
  updateStats();
}

function updateStats() {
  $('#stat-active').textContent = state.modules.filter((m) => m.enabled).length;
  $('#stat-total').textContent = state.modules.length;
}

async function saveFeatures() {
  const states = Object.fromEntries(state.modules.map((m) => [m.name, m.enabled]));
  try {
    await api.setModules(states);
  } catch (e) {
    toast(`Could not save features: ${e.message}`);
  }
}

async function toggleFeature(name, enabled) {
  state.modules.find((x) => x.name === name).enabled = enabled;
  updateStats();
  await saveFeatures();
}

$('#mod-search').addEventListener('input', renderFeatures);
$('#mods-reset').addEventListener('click', async () => {
  state.modules.forEach((m) => (m.enabled = m.default));
  renderFeatures();
  await saveFeatures();
  toast('Features reset to defaults.');
});

// ------------------------------------------------------------------ settings

async function saveSettings(patch) {
  state.settings = await api.setSettings(patch);
}

function renderSettings() {
  const s = state.settings;
  $('#ram').value = s.ramGb;
  $('#ram-value').textContent = `${s.ramGb} GB`;
  $('#fact-ram').textContent = `${s.ramGb} GB`;
  $('#ram').setAttribute('aria-valuetext', `${s.ramGb} GB`);
  $('#mc-dir').textContent = s.minecraftDir;
  $('#close-on-launch').checked = s.closeOnLaunch;
  $('#cf-state').textContent = s.hasCfKey ? 'A key is saved.' : 'No key saved.';
  $('#cf-state').className = s.hasCfKey ? 'state ok' : 'state';
  $('#cf-remove').hidden = !s.hasCfKey;
  if (s.secretsPersist === false) {
    $('#cf-help').textContent = 'CurseForge needs a free personal key before the launcher can search it. This computer has no keychain, so the key is kept only until the launcher closes.';
  }
  $('#account-state').textContent = s.signedIn
    ? `Signed in as ${s.accountName}.${s.secretsPersist === false ? ' This computer has no keychain, so you will sign in again next time.' : ''}`
    : 'Not signed in.';
  $('#account-state').className = s.signedIn ? 'state ok' : 'state';
  $('#sign-in').hidden = s.signedIn;
  $('#sign-out').hidden = !s.signedIn;
  $('#sign-in').removeAttribute('aria-disabled');
  $('#fact-launch').textContent = directLaunch() ? `Quasar, as ${s.accountName}` : 'Minecraft Launcher';
  if (!state.busy && !state.gameRunning) $('#progress-status').textContent = idleStatus();
}

$('#ram').addEventListener('input', (e) => {
  $('#ram-value').textContent = `${e.target.value} GB`;
  e.target.setAttribute('aria-valuetext', `${e.target.value} GB`);
});
$('#ram').addEventListener('change', async (e) => {
  await saveSettings({ ramGb: Number(e.target.value) });
  renderSettings();
});
$('#close-on-launch').addEventListener('change', (e) => saveSettings({ closeOnLaunch: e.target.checked }));

$('#cf-save').addEventListener('click', async () => {
  const key = $('#cf-key').value.trim();
  if (!key) {
    $('#cf-state').textContent = 'Paste a key into the field first.';
    $('#cf-state').className = 'state warn';
    $('#cf-key').focus();
    return;
  }
  await saveSettings({ cfKey: key });
  $('#cf-key').value = '';
  renderSettings();
  toast('CurseForge key saved.');
  if (state.browse.source === 'curseforge') { loadCategories(); runSearch(); }
});
$('#cf-remove').addEventListener('click', async () => {
  await saveSettings({ cfKey: '' });
  renderSettings();
  toast('CurseForge key removed.');
  $('#cf-key').focus();
});
$('#cf-get').addEventListener('click', () => api.openLink('https://console.curseforge.com/'));

$('#pick-mc-dir').addEventListener('click', async () => {
  const dir = await api.pickFolder();
  if (!dir) return;
  await saveSettings({ minecraftDir: dir });
  renderSettings();
  state.modules = await api.getModules();
  renderFeatures();
  refreshInfo();
  refreshInstalled();
});
$('#open-game-dir').addEventListener('click', () => api.openGameFolder());
$('#pick-jar').addEventListener('click', async () => {
  const jar = await api.pickJar();
  if (!jar) return;
  await saveSettings({ modJar: jar });
  refreshInfo();
});
$('#auto-jar').addEventListener('click', async () => {
  await saveSettings({ modJar: '' });
  await refreshInfo();
  toast(state.info.modJar ? 'Found the mod file.' : 'No built mod file found yet.');
});

// ------------------------------------------------------------------ account


$('#sign-in').addEventListener('click', async () => {
  const btn = $('#sign-in');
  if (btn.getAttribute('aria-disabled') === 'true') return;
  btn.setAttribute('aria-disabled', 'true');
  $('#account-state').textContent = 'Log in to your Microsoft account in the window that opened.';
  $('#account-state').className = 'state';
  const res = await api.signIn();
  state.settings = await api.getSettings();
  renderSettings();
  if (res.ok) {
    toast(`Signed in as ${res.name}.`);
    $('#sign-out').focus();
  } else {
    $('#account-state').textContent = res.error;
    $('#account-state').className = res.code === 'CANCELLED' ? 'state' : 'state warn';
    $('#sign-in').focus();
  }
});
$('#sign-out').addEventListener('click', async () => {
  state.settings = await api.signOut();
  renderSettings();
  toast('Signed out.');
  $('#sign-in').focus();
});

// ------------------------------------------------------------------ boot

(async function init() {
  state.settings = await api.getSettings();
  renderSettings();
  state.modules = await api.getModules();
  renderFeatures();
  await Promise.all([refreshInfo(), refreshInstalled(), loadCategories()]);
})();

// ------------------------------------------------------------------ browser preview mock

function createMockApi() {
  const listeners = { log: [], progress: [] };
  const emit = (type, ...args) => listeners[type].forEach((cb) => cb(...args));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const modules = [
    ['Watermark', 'HUD', true, 'Shows the Quasar name in the top-left corner.'],
    ['Module List', 'HUD', true, 'Lists the features that are on, in the top-right corner.'],
    ['FPS', 'HUD', true, 'Shows your frames per second.'],
    ['Coordinates', 'HUD', true, 'Your XYZ position and the direction you face.'],
    ['Keystrokes', 'HUD', true, 'WASD, mouse buttons with clicks per second, and jump.'],
    ['Armor HUD', 'HUD', true, 'Your armor and its durability beside the hotbar.'],
    ['Zoom', 'Render', true, 'Hold C to zoom in 4x with a smooth camera.'],
    ['Fullbright', 'Render', false, 'Lights up dark areas like caves.'],
    ['Toggle Sprint', 'Movement', false, 'Sprint whenever you walk forward.'],
  ].map(([name, category, def, description]) => ({ name, category, default: def, enabled: def, description }));
  const sample = [
    ['sodium', 'Sodium', 'jellysquid3', 'A modern rendering engine that greatly improves frame rates.', 61e6, 3, ['fabric', 'neoforge'], ['Optimization']],
    ['lithium', 'Lithium', 'jellysquid3', 'Optimizes game physics, mob AI and block ticking without changing how the game plays.', 38e6, 12, ['fabric', 'neoforge'], ['Optimization']],
    ['iris', 'Iris Shaders', 'coderbot', 'Shader pack support that works alongside Sodium.', 44e6, 9, ['fabric', 'neoforge'], ['Decoration', 'Optimization']],
    ['modmenu', 'Mod Menu', 'Prospector', 'Adds a screen that lists your mods and opens their settings.', 52e6, 40, ['fabric', 'quilt'], ['Utility']],
    ['jei', 'Just Enough Items', 'mezz', 'Look up any item and how to craft it.', 290e6, 20, ['forge', 'neoforge'], ['Utility', 'Library']],
  ].map(([id, title, author, description, downloads, days, loaders, categories]) => ({
    source: 'modrinth', id, title, author, description, downloads, loaders, categories, icon: null,
    updated: new Date(Date.now() - days * 86400000).toISOString(), url: `https://modrinth.com/mod/${id}`,
  }));
  const installed = [
    { file: 'quasar-client-1.0.0.jar', title: 'Quasar Client', requiredBy: 'Quasar', removable: false },
    { file: 'fabric-api-0.116.14+1.21.1.jar', title: 'Fabric API', requiredBy: 'Quasar', removable: false },
    { file: 'sodium-fabric-0.6.jar', title: 'Sodium', source: 'modrinth', id: 'sodium', url: 'https://modrinth.com/mod/sodium', removable: true },
  ];
  let settings = { minecraftDir: '/Users/you/Library/Application Support/minecraft', modJar: '', ramGb: 4, closeOnLaunch: false, hasCfKey: false, signedIn: false, accountName: '' };
  return {
    platform: new URLSearchParams(location.search).get('platform') || 'darwin',
    getInfo: async () => ({ mcVersion: '1.21.1', loaderVersion: '0.16.14', appVersion: '1.0.0', modJar: '/Users/you/Quasar Client/build/libs/quasar-client-1.0.0.jar', canBuild: true, hasReadme: true, gameDir: settings.minecraftDir + '/quasar' }),
    getSettings: async () => settings,
    setSettings: async (p) => {
      const { cfKey, ...rest } = p;
      settings = { ...settings, ...rest };
      if (cfKey !== undefined) settings.hasCfKey = Boolean(cfKey);
      return settings;
    },
    getModules: async () => modules,
    setModules: async () => true,
    getCategories: async (source) => {
      if (source === 'curseforge' && !settings.hasCfKey) throw new Error('no key');
      return ['Adventure', 'Decoration', 'Game mechanics', 'Library', 'Magic', 'Optimization', 'Storage', 'Technology', 'Utility', 'Worldgen'].map((n) => ({ id: n.toLowerCase(), name: n }));
    },
    searchMods: async (o) => {
      await wait(250);
      if (o.source === 'curseforge' && !settings.hasCfKey) return { ok: false, code: 'NO_KEY', error: 'no key' };
      const list = sample.filter((m) => (o.loader === 'any' || m.loaders.includes(o.loader))
        && (!o.query || m.title.toLowerCase().includes(o.query.toLowerCase()))
        && (!o.category || m.categories.some((c) => c.toLowerCase() === o.category)));
      return { ok: true, results: list, total: list.length, offset: list.length };
    },
    getInstalled: async () => installed,
    installMod: async (source, id) => {
      await wait(500);
      const m = sample.find((x) => x.id === id);
      installed.push({ file: `${id}.jar`, title: m.title, source, id, url: m.url, removable: true });
      return { ok: true, installed: [m.title] };
    },
    removeMod: async (file) => {
      const i = installed.findIndex((m) => m.file === file);
      if (i >= 0) installed.splice(i, 1);
      return { ok: true };
    },
    openLink: async () => {},
    signIn: async () => {
      await wait(1500);
      settings = { ...settings, signedIn: true, accountName: 'Owen' };
      return { ok: true, name: 'Owen' };
    },
    signOut: async () => (settings = { ...settings, signedIn: false, accountName: '' }),
    openReadme: async () => {},
    onGameState: () => {},
    play: async () => {
      const steps = [[0.35, 'Installing Fabric Loader'], [0.6, 'Downloading Fabric API'], [0.85, 'Saving feature settings'], [1, 'Ready. Press Play in the Minecraft Launcher.']];
      for (const [v, s] of steps) { emit('progress', v, s); emit('log', `[preview] ${s}`); await wait(400); }
      return { ok: true, opened: true };
    },
    buildMod: async () => { emit('log', '[preview] Build finished.'); return { ok: true }; },
    openGameFolder: async () => {},
    pickFolder: async () => null,
    pickJar: async () => null,
    window: () => {},
    onLog: (cb) => listeners.log.push(cb),
    onProgress: (cb) => listeners.progress.push(cb),
  };
}
