const formEl = document.getElementById('watch-form');
const inputEl = document.getElementById('watch-input');
const resultsEl = document.getElementById('watch-results');
const errorEl = document.getElementById('watch-error');
const gridEl = document.getElementById('watch-grid');
const tabTodo = document.getElementById('watch-tab-todo');
const tabDone = document.getElementById('watch-tab-done');
const countTodo = document.getElementById('watch-count-todo');
const countDone = document.getElementById('watch-count-done');

const KIND_LABEL = { movie: 'Movie', show: 'Show' };

let items = [];
let activeTab = 'todo';
let results = [];
let highlight = -1;
let searchSeq = 0;
let searchTimer = null;
let searching = false;
let searchedQuery = null;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function post(path, payload) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || String(res.status)), { data });
  return data;
}

function metaLine(item) {
  return [item.year, KIND_LABEL[item.kind]].filter(Boolean).join(' · ');
}

function posterMarkup(item, className) {
  const initial = escapeHtml((item.title || '?').trim()[0] || '?').toUpperCase();
  if (!item.poster) return `<div class="${className} is-empty">${initial}</div>`;
  return `<div class="${className}"><img src="${escapeHtml(item.poster)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-initial="${initial}"></div>`;
}

function fixBrokenPosters(root) {
  root.querySelectorAll('img[data-initial]').forEach((img) => {
    img.addEventListener('error', () => {
      img.parentElement.classList.add('is-empty');
      img.parentElement.textContent = img.dataset.initial;
    });
  });
}

/* ---------- list ---------- */

function renderGrid() {
  const todo = items.filter((i) => !i.watched).sort((a, b) => a.addedAt - b.addedAt);
  const done = items.filter((i) => i.watched).sort((a, b) => b.watchedAt - a.watchedAt);
  countTodo.textContent = todo.length;
  countDone.textContent = done.length;

  const showing = activeTab === 'todo' ? todo : done;
  gridEl.innerHTML = '';
  if (!showing.length) {
    gridEl.innerHTML = `<div class="finance-empty watch-empty">${activeTab === 'todo'
      ? 'Nothing on your watchlist yet. Search above to add a movie or show.'
      : 'Nothing watched yet. Mark things as watched from your watchlist.'}</div>`;
    return;
  }

  for (const item of showing) {
    const card = document.createElement('div');
    card.className = 'watch-card';
    card.innerHTML = `
      ${posterMarkup(item, 'watch-poster')}
      <div class="watch-info">
        <span class="watch-name">${escapeHtml(item.title)}</span>
        <span class="watch-meta">${escapeHtml(metaLine(item))}</span>
      </div>
      <div class="watch-actions">
        <button class="watch-act primary" data-act="toggle">${item.watched ? '↩ Back to list' : '✓ Watched'}</button>
        <button class="watch-act danger" data-act="delete" aria-label="Remove ${escapeHtml(item.title)}">✕</button>
      </div>`;
    card.querySelector('[data-act="toggle"]').addEventListener('click', () => change('/api/watchlist/toggle', { id: item.id, watched: !item.watched }));
    card.querySelector('[data-act="delete"]').addEventListener('click', () => {
      if (confirm(`Remove “${item.title}”?`)) change('/api/watchlist/delete', { id: item.id });
    });
    gridEl.appendChild(card);
  }
  fixBrokenPosters(gridEl);
}

function setTab(tab) {
  activeTab = tab;
  tabTodo.classList.toggle('is-active', tab === 'todo');
  tabDone.classList.toggle('is-active', tab === 'done');
  tabTodo.setAttribute('aria-selected', String(tab === 'todo'));
  tabDone.setAttribute('aria-selected', String(tab === 'done'));
  renderGrid();
}

tabTodo.addEventListener('click', () => setTab('todo'));
tabDone.addEventListener('click', () => setTab('done'));

async function load() {
  try {
    const res = await fetch('/api/watchlist/list');
    if (!res.ok) return;
    items = (await res.json()).items || [];
    renderGrid();
  } catch {
    // ignore
  }
}

async function change(path, payload) {
  try {
    await post(path, payload);
  } catch {
    errorEl.textContent = 'That did not save. Try again.';
    return;
  }
  errorEl.textContent = '';
  await load();
}

/* ---------- search + add ---------- */

function closeResults() {
  resultsEl.hidden = true;
  inputEl.setAttribute('aria-expanded', 'false');
  highlight = -1;
}

// The last row is always "add exactly what I typed", for titles with no match.
function renderResults() {
  const typed = inputEl.value.trim();
  if (!typed) return closeResults();

  const rows = results.map((r, i) => `
    <button type="button" class="watch-result${i === highlight ? ' is-active' : ''}" role="option" data-index="${i}">
      ${posterMarkup(r, 'watch-result-poster')}
      <span class="watch-result-text">
        <span class="watch-result-title">${escapeHtml(r.title)}</span>
        <span class="watch-result-meta">${escapeHtml(metaLine(r))}</span>
      </span>
    </button>`);

  const plainActive = highlight === results.length ? ' is-active' : '';
  rows.push(`
    <button type="button" class="watch-result watch-result-plain${plainActive}" role="option" data-index="${results.length}">
      <span class="watch-result-text">
        <span class="watch-result-title">${searching ? 'Searching…' : `Add “${escapeHtml(typed)}” without art`}</span>
      </span>
    </button>`);

  resultsEl.innerHTML = rows.join('');
  resultsEl.hidden = false;
  inputEl.setAttribute('aria-expanded', 'true');
  fixBrokenPosters(resultsEl);
  resultsEl.querySelectorAll('.watch-result').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => choose(Number(btn.dataset.index)));
  });
}

async function runSearch(query) {
  const seq = ++searchSeq;
  searching = true;
  renderResults();
  let found = [];
  try {
    const res = await fetch(`/api/media/search?q=${encodeURIComponent(query)}`);
    if (res.ok) found = (await res.json()).results || [];
  } catch {
    // fall through to "add without art"
  }
  if (seq !== searchSeq) return;
  searching = false;
  searchedQuery = query;
  results = found;
  highlight = 0;
  renderResults();
}

inputEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const query = inputEl.value.trim();
  if (query.length < 2) {
    searchSeq++;
    searching = false;
    searchedQuery = null;
    results = [];
    highlight = 0;
    return renderResults();
  }
  searchTimer = setTimeout(() => runSearch(query), 300);
});

inputEl.addEventListener('keydown', (e) => {
  if (resultsEl.hidden) return;
  const last = results.length;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    highlight = Math.min(last, highlight + 1);
    renderResults();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    highlight = Math.max(0, highlight - 1);
    renderResults();
  } else if (e.key === 'Escape') {
    closeResults();
  }
});

inputEl.addEventListener('blur', () => setTimeout(closeResults, 120));

async function addItem(payload) {
  try {
    await post('/api/watchlist/add', payload);
  } catch (err) {
    const d = err.data || {};
    errorEl.textContent = d.error === 'duplicate'
      ? `Already ${d.watched ? 'in your Watched list' : 'on your watchlist'}.`
      : d.error === 'full' ? 'Your watchlist is full.' : 'That did not save. Try again.';
    return;
  }
  errorEl.textContent = '';
  inputEl.value = '';
  results = [];
  searchedQuery = null;
  searchSeq++;
  searching = false;
  closeResults();
  setTab('todo');
  await load();
}

function choose(index) {
  const pick = results[index];
  if (pick) addItem({ title: pick.title, year: pick.year, kind: pick.kind, poster: pick.poster });
  else addItem({ title: inputEl.value.trim() });
}

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = inputEl.value.trim();
  if (!query) return;
  // Enter pressed before the typing-pause search ran: search now so art is found.
  if (query.length >= 2 && query !== searchedQuery) {
    clearTimeout(searchTimer);
    await runSearch(query);
  }
  if (searching || inputEl.value.trim() !== query) return;
  choose(highlight >= 0 ? highlight : results.length);
});

load();
