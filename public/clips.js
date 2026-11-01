const formEl = document.getElementById('clip-form');
const urlEl = document.getElementById('clip-url');
const nameEl = document.getElementById('clip-name');
const submitEl = document.getElementById('clip-submit');
const statusEl = document.getElementById('clip-status');
const gridEl = document.getElementById('clip-grid');
const modalEl = document.getElementById('clip-modal');
const stageEl = document.getElementById('clip-stage');
const playerTitleEl = document.getElementById('clip-player-title');
const playerMetaEl = document.getElementById('clip-player-meta');
const playerLinkEl = document.getElementById('clip-player-link');

const PLATFORM_LABEL = { kick: 'Kick', twitch: 'Twitch' };
const PLAY_ICON = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';

let clips = [];
let hls = null;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function formatDuration(seconds) {
  if (!seconds) return '';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function metaLine(clip) {
  return [PLATFORM_LABEL[clip.platform], clip.channel, `Saved ${formatDate(clip.addedAt)}`].filter(Boolean).join(' · ');
}

/* ---------- grid ---------- */

function renderGrid() {
  gridEl.innerHTML = '';
  if (!clips.length) {
    gridEl.innerHTML = '<div class="finance-empty" style="grid-column: 1 / -1">No clips saved yet. Paste a Twitch or Kick clip link above.</div>';
    return;
  }

  for (const clip of [...clips].sort((a, b) => b.addedAt - a.addedAt)) {
    const card = document.createElement('div');
    card.className = 'clip-card';
    const thumb = clip.thumbnail
      ? `<img src="${escapeHtml(clip.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : 'No preview';
    card.innerHTML = `
      <button class="clip-open" aria-label="Play ${escapeHtml(clip.title)}">
        <div class="clip-thumb${clip.thumbnail ? '' : ' is-empty'}">
          ${thumb}
          <span class="clip-badge ${clip.platform}">${PLATFORM_LABEL[clip.platform] || ''}</span>
          ${clip.duration ? `<span class="clip-duration">${formatDuration(clip.duration)}</span>` : ''}
          <span class="clip-play">${PLAY_ICON}</span>
        </div>
        <div class="clip-info">
          <span class="clip-title">${escapeHtml(clip.title)}</span>
          <span class="clip-meta">${escapeHtml(metaLine(clip))}</span>
        </div>
      </button>
      <button class="clip-delete" aria-label="Remove ${escapeHtml(clip.title)}">✕</button>`;

    const img = card.querySelector('img');
    if (img) {
      img.addEventListener('error', () => {
        const box = img.parentElement;
        box.classList.add('is-empty');
        img.replaceWith(document.createTextNode('No preview'));
      });
    }
    card.querySelector('.clip-open').addEventListener('click', () => openClip(clip));
    card.querySelector('.clip-delete').addEventListener('click', () => removeClip(clip));
    gridEl.appendChild(card);
  }
}

async function load() {
  try {
    const res = await fetch('/api/clips/list');
    if (!res.ok) return;
    clips = (await res.json()).clips || [];
    renderGrid();
  } catch {
    // ignore
  }
}

async function removeClip(clip) {
  if (!confirm(`Remove “${clip.title}”?`)) return;
  try {
    await fetch('/api/clips/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: clip.id })
    });
  } catch {
    // reload below shows the truth either way
  }
  await load();
}

/* ---------- add ---------- */

const ADD_ERRORS = {
  unsupported: 'That doesn’t look like a Twitch or Kick clip link.',
  'not found': 'Couldn’t find that clip. It may have been deleted or made private.',
  'lookup failed': 'Couldn’t reach Twitch or Kick just now. Try again in a moment.',
  duplicate: 'That clip is already saved.',
  full: 'Your clip library is full.'
};

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  statusEl.textContent = '';
  submitEl.disabled = true;
  submitEl.textContent = 'Adding…';
  try {
    const res = await fetch('/api/clips/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: urlEl.value.trim(), name: nameEl.value.trim() })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      statusEl.textContent = ADD_ERRORS[data.error] || 'That did not save. Try again.';
      return;
    }
    urlEl.value = '';
    nameEl.value = '';
    await load();
  } catch {
    statusEl.textContent = 'That did not save. Try again.';
  } finally {
    submitEl.disabled = false;
    submitEl.textContent = 'Add clip';
  }
});

/* ---------- player ---------- */

function stopPlayer() {
  if (hls) {
    hls.destroy();
    hls = null;
  }
  stageEl.innerHTML = '';
}

function showPlayerMessage(text) {
  stageEl.innerHTML = `<div class="finance-empty">${escapeHtml(text)}</div>`;
}

function playKick(clip) {
  const video = document.createElement('video');
  video.className = 'clip-player';
  video.controls = true;
  video.autoplay = true;
  video.playsInline = true;
  stageEl.appendChild(video);

  if (window.Hls && window.Hls.isSupported()) {
    hls = new window.Hls();
    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) showPlayerMessage('This clip could not be played here. Use “Open original” instead.');
    });
    hls.loadSource(clip.playUrl);
    hls.attachMedia(video);
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = clip.playUrl;
  } else {
    showPlayerMessage('Your browser can’t play this clip here. Use “Open original” instead.');
  }
}

function playTwitch(clip) {
  const frame = document.createElement('iframe');
  frame.className = 'clip-player';
  frame.allowFullscreen = true;
  frame.allow = 'autoplay; fullscreen';
  frame.src = `https://clips.twitch.tv/embed?clip=${encodeURIComponent(clip.clipId)}&parent=${encodeURIComponent(location.hostname)}&autoplay=true`;
  stageEl.appendChild(frame);
}

function openClip(clip) {
  stopPlayer();
  playerTitleEl.textContent = clip.title;
  playerMetaEl.textContent = metaLine(clip);
  playerLinkEl.href = clip.url;
  playerLinkEl.textContent = `Open on ${PLATFORM_LABEL[clip.platform] || 'site'} ↗`;
  modalEl.classList.add('open');

  if (clip.platform === 'kick' && clip.playUrl) playKick(clip);
  else if (clip.platform === 'twitch') playTwitch(clip);
  else showPlayerMessage('This clip can’t be played here. Use “Open original” instead.');
}

function closeClip() {
  modalEl.classList.remove('open');
  stopPlayer();
}

document.getElementById('clip-modal-close').addEventListener('click', closeClip);
modalEl.addEventListener('click', (e) => {
  if (e.target === modalEl) closeClip();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalEl.classList.contains('open')) closeClip();
});

load();
