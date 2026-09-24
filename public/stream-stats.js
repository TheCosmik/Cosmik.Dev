const statsBtn = document.getElementById('chat-stats-btn');
const statsModal = document.getElementById('stats-modal');
const statsTitle = document.getElementById('stats-title');
const statsBack = document.getElementById('stats-back');
const statsBody = document.getElementById('stats-body');
const statsHistory = document.getElementById('stats-history');
const statsSubtitle = document.getElementById('stats-subtitle');

let viewingId = null;
let statsTimer = null;

function statsEscape(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function formatDuration(ms) {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function formatWhen(ts) {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

async function statsFetch(path) {
  try {
    const res = await fetch(path);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function tile(label, value, note = '') {
  return `
    <div class="stats-tile">
      <span class="stats-tile-label">${label}</span>
      <span class="stats-tile-value">${value}</span>
      ${note ? `<span class="stats-tile-note">${note}</span>` : ''}
    </div>`;
}

function chartMarkup(samples) {
  if (!samples || samples.length < 2) {
    return '<div class="stats-chart-empty">The viewer graph appears after a couple of minutes of streaming.</div>';
  }
  const W = 600;
  const H = 120;
  const maxT = Math.max(1, samples[samples.length - 1][0]);
  const maxV = Math.max(1, ...samples.map((s) => s[1]));
  const points = samples.map(([t, v]) => `${((t / maxT) * W).toFixed(1)},${(H - (v / maxV) * (H - 8) - 4).toFixed(1)}`);
  return `
    <svg class="stats-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Viewers over time">
      <polygon points="0,${H} ${points.join(' ')} ${W},${H}" class="stats-chart-area"/>
      <polyline points="${points.join(' ')}" class="stats-chart-line" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="stats-chart-axis"><span>0</span><span>${formatDuration(maxT * 60000)}</span></div>`;
}

function sessionMarkup(session, { live }) {
  const minutes = Math.max(1, session.durationMs / 60000);
  const perMin = (session.messages.total / minutes).toFixed(1);
  const parts = [];
  if (session.title) parts.push(`<p class="stats-stream-title">${statsEscape(session.title)}</p>`);
  parts.push(`<p class="stats-when">${live ? 'Started ' : ''}${formatWhen(session.startedAt)}${session.endedAt ? ` – ${formatWhen(session.endedAt)}` : ''}</p>`);
  parts.push(`<div class="stats-grid">
    ${tile('Duration', formatDuration(session.durationMs))}
    ${live ? tile('Viewers now', session.viewers.now.toLocaleString()) : ''}
    ${tile('Avg viewers', session.viewers.avg.toLocaleString())}
    ${tile('Peak viewers', session.viewers.peak.toLocaleString())}
    ${tile('Chat messages', session.messages.total.toLocaleString(), `${perMin}/min`)}
    ${tile('Unique chatters', session.chatters.toLocaleString())}
  </div>`);
  parts.push(chartMarkup(session.samples));
  parts.push(`<div class="stats-platforms">
    <span><b>Kick</b> avg ${session.platforms.kick.avg} · peak ${session.platforms.kick.peak} · ${session.messages.kick} msgs</span>
    <span><b>Twitch</b> avg ${session.platforms.twitch.avg} · peak ${session.platforms.twitch.peak} · ${session.messages.twitch} msgs</span>
  </div>`);
  return parts.join('');
}

function historyMarkup(sessions) {
  if (!sessions.length) return '<div class="stats-empty">No past streams yet. Each stream is saved here automatically once it ends.</div>';
  return sessions.map((s) => `
    <button class="stats-history-row" data-id="${s.id}">
      <span class="stats-history-when">${formatWhen(s.startedAt)}${s.title ? `<em>${statsEscape(s.title)}</em>` : ''}</span>
      <span>${formatDuration(s.durationMs)}</span>
      <span>${s.avgViewers} avg</span>
      <span>${s.peakViewers} peak</span>
      <span>${s.messages} msgs</span>
    </button>`).join('');
}

async function renderStats() {
  const [current, history] = await Promise.all([statsFetch('/api/stream/current'), statsFetch('/api/stream/history')]);
  const sessions = history ? history.sessions : [];
  statsHistory.innerHTML = historyMarkup(sessions);
  statsHistory.querySelectorAll('.stats-history-row').forEach((row) => {
    row.addEventListener('click', () => viewSession(row.dataset.id));
  });

  if (viewingId) return;

  statsBack.hidden = true;
  statsSubtitle.hidden = false;
  statsHistory.hidden = false;
  statsTitle.textContent = current && current.live ? 'Live now' : 'Stream stats';
  if (!current) {
    statsBody.innerHTML = '<div class="stats-empty">Could not load stream stats.</div>';
  } else if (!current.live) {
    statsBody.innerHTML = '<div class="stats-empty">Not live right now. Stats are recorded automatically when you go live, and saved here when the stream ends.</div>';
  } else {
    statsBody.innerHTML = (current.endingSoon ? '<p class="stats-note">Looks like the stream just ended — finalizing…</p>' : '') +
      sessionMarkup(current.session, { live: true });
  }
}

async function viewSession(id) {
  viewingId = id;
  statsBack.hidden = false;
  statsSubtitle.hidden = true;
  statsHistory.hidden = true;
  statsTitle.textContent = 'Past stream';
  statsBody.innerHTML = '<div class="stats-empty">Loading…</div>';
  const session = await statsFetch(`/api/stream/session?id=${encodeURIComponent(id)}`);
  if (viewingId !== id) return;
  statsBody.innerHTML = session ? sessionMarkup(session, { live: false }) : '<div class="stats-empty">Could not load that stream.</div>';
  statsModal.querySelector('.stats-panel').scrollTop = 0;
}

statsBack.addEventListener('click', () => {
  viewingId = null;
  renderStats();
});

function openStats() {
  viewingId = null;
  statsModal.classList.add('open');
  renderStats();
  clearInterval(statsTimer);
  statsTimer = setInterval(renderStats, 15000);
}

function closeStats() {
  statsModal.classList.remove('open');
  clearInterval(statsTimer);
}

statsBtn.addEventListener('click', openStats);
document.getElementById('stats-close').addEventListener('click', closeStats);
statsModal.addEventListener('click', (e) => {
  if (e.target === statsModal) closeStats();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeStats();
});

async function refreshLiveBadge() {
  const current = await statsFetch('/api/stream/current');
  statsBtn.classList.toggle('is-live', Boolean(current && current.live));
}

refreshLiveBadge();
setInterval(refreshLiveBadge, 30000);
