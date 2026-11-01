const formEl = document.getElementById('watch-form');
const inputEl = document.getElementById('watch-input');
const errorEl = document.getElementById('watch-error');
const listEl = document.getElementById('watch-list');
const doneEl = document.getElementById('watch-done');
const doneTitleEl = document.getElementById('watch-done-title');

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function post(path, payload) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

function rowFor(item) {
  const row = document.createElement('div');
  row.className = `watch-row${item.watched ? ' is-watched' : ''}`;
  row.innerHTML = `
    <button class="watch-check" aria-label="${item.watched ? 'Mark as not watched' : 'Mark as watched'}">${item.watched ? '✓' : ''}</button>
    <span class="watch-name">${escapeHtml(item.title)}</span>
    <button class="watch-delete" aria-label="Remove">✕</button>
  `;
  row.querySelector('.watch-check').addEventListener('click', () => change('/api/watchlist/toggle', { id: item.id, watched: !item.watched }));
  row.querySelector('.watch-delete').addEventListener('click', () => change('/api/watchlist/delete', { id: item.id }));
  return row;
}

function render(items) {
  const todo = items.filter((i) => !i.watched).sort((a, b) => a.addedAt - b.addedAt);
  const done = items.filter((i) => i.watched).sort((a, b) => b.watchedAt - a.watchedAt);

  listEl.innerHTML = '';
  doneEl.innerHTML = '';
  if (!todo.length) {
    listEl.innerHTML = '<div class="finance-empty">Nothing on your watchlist yet.</div>';
  }
  todo.forEach((i) => listEl.appendChild(rowFor(i)));
  done.forEach((i) => doneEl.appendChild(rowFor(i)));
  doneTitleEl.hidden = !done.length;
}

async function load() {
  try {
    const res = await fetch('/api/watchlist/list');
    if (!res.ok) return;
    render((await res.json()).items || []);
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

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = inputEl.value.trim();
  if (!title) return;
  try {
    await post('/api/watchlist/add', { title });
  } catch (err) {
    errorEl.textContent = err.message === '409' ? 'Your watchlist is full.' : 'That did not save. Try again.';
    return;
  }
  errorEl.textContent = '';
  inputEl.value = '';
  inputEl.focus();
  await load();
});

load();
