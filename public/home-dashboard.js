function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function daysUntilChargeDay(chargeDay) {
  const now = new Date();
  const today = now.getDate();
  let diff = chargeDay - today;
  if (diff < 0) {
    const daysInThisMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    diff += daysInThisMonth;
  }
  return diff;
}

async function fetchJson(path) {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function setGreeting() {
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Still up?' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  document.getElementById('dash-greeting').textContent = greeting;
}

async function renderStreaming() {
  const el = document.getElementById('dash-streaming');
  const [live, chatStatus, socketStatus] = await Promise.all([
    fetchJson('/api/status'),
    fetchJson('/api/chat/status'),
    fetchJson('/api/chat/twitch-socket-status')
  ]);

  const rows = [];
  for (const platform of ['kick', 'twitch']) {
    const isLive = live ? live[platform] : false;
    const chat = chatStatus ? chatStatus[platform] : null;
    const label = platform === 'kick' ? 'Kick' : 'Twitch';

    let chatText = 'Chat not connected';
    if (chat && chat.connected) {
      chatText = chat.viewers != null ? `Chat connected · ${chat.viewers.toLocaleString()} viewers` : 'Chat connected';
    }

    rows.push(`
      <div class="dash-row">
        <span class="dash-row-label"><span class="dash-dot ${isLive ? 'is-live' : ''}"></span>${label}</span>
        <span class="${isLive ? 'dash-value' : 'dash-muted'}">${isLive ? 'Live' : 'Offline'}</span>
      </div>
      <div class="dash-muted">${chatText}</div>
    `);
  }

  if (chatStatus && chatStatus.twitch && chatStatus.twitch.connected && socketStatus && !socketStatus.connected) {
    rows.push('<div class="dash-warn">⚠ Twitch chat socket is disconnected</div>');
  }

  el.innerHTML = rows.join('');
}

async function renderStorage() {
  const el = document.getElementById('dash-storage');
  const data = await fetchJson('/api/storage/state');
  if (!data || data.error) {
    el.innerHTML = '<div class="dash-muted">Not configured yet.</div>';
    return;
  }

  el.innerHTML = `
    <div class="dash-usage-bar"><div class="dash-usage-fill" style="width:${Math.min(100, data.percentUsed)}%"></div></div>
    <div class="dash-row">
      <span class="dash-muted">${formatBytes(data.usedBytes)} of ${formatBytes(data.limitBytes)}</span>
      <span class="dash-value">${data.percentUsed.toFixed(1)}%</span>
    </div>
    <div class="dash-muted">${data.fileCount} file${data.fileCount === 1 ? '' : 's'}${data.r2Configured ? '' : ' · local fallback mode'}</div>
  `;
}

async function renderFinance() {
  const el = document.getElementById('dash-finance');
  const data = await fetchJson('/api/finance/list');
  if (!data || data.error || !Array.isArray(data.subscriptions)) {
    el.innerHTML = '<div class="dash-muted">Not configured yet.</div>';
    return;
  }

  const subs = data.subscriptions;
  const total = subs.reduce((sum, s) => sum + s.amount, 0);

  if (subs.length === 0) {
    el.innerHTML = `
      <div class="dash-row"><span class="dash-row-label">Monthly total</span><span class="dash-value">$0.00</span></div>
      <div class="dash-muted">No subscriptions tracked yet.</div>
    `;
    return;
  }

  const upcoming = subs
    .map((s) => ({ ...s, daysUntil: daysUntilChargeDay(s.chargeDay) }))
    .filter((s) => s.daysUntil <= 7)
    .sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name));
  const dueTotal = upcoming.reduce((sum, s) => sum + s.amount, 0);

  const rows = upcoming.map((s) => {
    const date = new Date();
    date.setDate(date.getDate() + s.daysUntil);
    const when = s.daysUntil === 0 ? 'Today' : s.daysUntil === 1 ? 'Tomorrow'
      : date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    return `
      <div class="dash-row">
        <span class="dash-row-label"><span class="dash-when${s.daysUntil <= 1 ? ' is-soon' : ''}">${when}</span>${escapeHtml(s.name)}</span>
        <span class="dash-value">$${s.amount.toFixed(2)}</span>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="dash-row"><span class="dash-row-label">Monthly total</span><span class="dash-value">$${total.toFixed(2)}</span></div>
    <div class="dash-muted">${upcoming.length ? `Due in the next 7 days · $${dueTotal.toFixed(2)}` : 'Nothing due in the next 7 days.'}</div>
    ${rows}
  `;
}

async function renderClicks() {
  const el = document.getElementById('dash-clicks');
  const stats = await fetchJson('/api/click-stats');
  if (!stats || stats.error) {
    el.innerHTML = '<div class="dash-muted">Not configured yet.</div>';
    return;
  }

  const LINK_LABELS = { kick: 'Kick', twitch: 'Twitch', x: 'X', discord: 'Discord' };
  const total = Object.keys(LINK_LABELS).reduce((sum, key) => sum + (stats[key] || 0), 0);

  el.innerHTML = Object.entries(LINK_LABELS)
    .map(([key, label]) => `
      <div class="dash-row"><span class="dash-row-label">${label}</span><span class="dash-value">${stats[key] || 0}</span></div>
    `)
    .join('') + `<div class="dash-muted">${total} total clicks</div>`;
}

function renderProjects() {
  const el = document.getElementById('dash-projects');
  const count = typeof PROJECTS !== 'undefined' ? PROJECTS.length : 0;
  el.innerHTML = `<div class="dash-row"><span class="dash-row-label">Building</span><span class="dash-value">${count} project${count === 1 ? '' : 's'}</span></div>`;
}

setGreeting();
renderStreaming();
renderStorage();
renderFinance();
renderClicks();
renderProjects();
