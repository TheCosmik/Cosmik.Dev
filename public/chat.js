const PLATFORM_ICONS = {
  kick: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M1.333 0h8v5.333H12V2.667h2.667V0h8v8H20v2.667h-2.667v2.666H20V16h2.667v8h-8v-2.667H12v-2.666H9.333V24h-8Z"/></svg>',
  twitch: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/></svg>'
};

const CHANNEL_URLS = {
  kick: 'https://kick.com/cosmik',
  twitch: 'https://twitch.tv/C0smiik'
};

const connectionsEl = document.getElementById('chat-connections');
const bannerEl = document.getElementById('chat-banner');
const feedEl = document.getElementById('chat-feed');
const menuEl = document.getElementById('mod-menu');
const sizeSlider = document.getElementById('chat-size');

let knownIds = new Set();
let selected = null;

try {
  const savedSize = localStorage.getItem('chat-font-size');
  if (savedSize) {
    sizeSlider.value = savedSize;
    document.documentElement.style.setProperty('--chat-font-size', `${savedSize}px`);
  }
} catch {
  // localStorage unavailable — slider still works, just won't persist
}

sizeSlider.addEventListener('input', () => {
  document.documentElement.style.setProperty('--chat-font-size', `${sizeSlider.value}px`);
  try {
    localStorage.setItem('chat-font-size', sizeSlider.value);
  } catch {
    // ignore
  }
});

const params = new URLSearchParams(location.search);
if (params.get('connected')) {
  bannerEl.textContent = `Connected to ${params.get('connected')}.`;
  bannerEl.classList.add('show');
  history.replaceState({}, '', '/chat.html');
} else if (params.get('error')) {
  bannerEl.textContent = `Connection failed: ${params.get('error')}`;
  bannerEl.classList.add('show', 'error');
  history.replaceState({}, '', '/chat.html');
}

document.getElementById('chat-popout-btn')?.addEventListener('click', () => {
  const w = 380;
  const h = 640;
  const left = window.screenX + (window.outerWidth - w) / 2;
  const top = window.screenY + (window.outerHeight - h) / 2;
  window.open(
    '/chat-popout.html',
    'cosmik-chat-popout',
    `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no`
  );
});

function renderConnections(status) {
  connectionsEl.innerHTML = '';
  for (const platform of ['twitch', 'kick']) {
    const info = status[platform];
    const pill = document.createElement('div');
    pill.className = 'chat-connection';
    if (info.connected) {
      const viewers = info.viewers != null
        ? `<span class="chat-connection-viewers">${info.viewers.toLocaleString()} viewers</span>`
        : '';
      pill.innerHTML = `
        <a class="chat-connection-link" href="${CHANNEL_URLS[platform]}" target="_blank" rel="noopener">
          <span class="chat-connection-icon">${PLATFORM_ICONS[platform]}</span>
          <span>${platform === 'twitch' ? info.login : info.name}</span>
          ${viewers}
          <span class="chat-connection-dot"></span>
        </a>
        <button class="chat-connection-disconnect" title="Disconnect ${platform}" aria-label="Disconnect ${platform}">✕</button>
      `;
      pill.querySelector('.chat-connection-disconnect').addEventListener('click', () => disconnectPlatform(platform));
    } else {
      pill.innerHTML = `
        <span class="chat-connection-icon">${PLATFORM_ICONS[platform]}</span>
        <a href="/api/auth/${platform}/start">Connect ${platform}</a>
      `;
    }
    connectionsEl.appendChild(pill);
  }
}

const EMOTE_CDN = {
  twitch: (id) => `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`,
  kick: (id) => `https://files.kick.com/emotes/${id}/original`
};

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function renderContent(msg) {
  const cdn = EMOTE_CDN[msg.platform];
  const parts = String(msg.content).split(/(\[emote:\d+:[^\]]*\])/g);
  return parts
    .map((part) => {
      const match = part.match(/^\[emote:(\d+):([^\]]*)\]$/);
      if (match && cdn) {
        const [, id, name] = match;
        const safeName = escapeHtml(name);
        return `<img class="chat-emote" src="${cdn(id)}" alt="${safeName}" title="${safeName}" loading="lazy">`;
      }
      return escapeHtml(part);
    })
    .join('');
}

function renderMessage(msg) {
  const row = document.createElement('div');
  row.className = 'chat-row';
  row.dataset.platform = msg.platform;
  row.dataset.userId = msg.userId;
  row.dataset.messageId = msg.id;

  const nameStyle = msg.color ? `style="color:${escapeHtml(msg.color)}"` : '';
  row.innerHTML = `
    <span class="chat-platform-icon chat-platform-${msg.platform}">${PLATFORM_ICONS[msg.platform]}</span>
    <span class="chat-username" ${nameStyle}>${escapeHtml(msg.displayName || msg.username)}</span>
    <span class="chat-content">${renderContent(msg)}</span>
  `;

  row.querySelector('.chat-username').addEventListener('click', (e) => openMenu(e, msg));
  return row;
}

function openMenu(e, msg) {
  selected = msg;
  menuEl.style.left = `${e.clientX}px`;
  menuEl.style.top = `${e.clientY}px`;
  menuEl.classList.add('open');
}

document.addEventListener('click', (e) => {
  if (!menuEl.contains(e.target) && !e.target.classList.contains('chat-username')) {
    menuEl.classList.remove('open');
  }
});

menuEl.querySelectorAll('button').forEach((btn) => {
  btn.addEventListener('click', async () => {
    if (!selected) return;
    const action = btn.dataset.action;
    const body = {
      platform: selected.platform,
      action,
      userId: selected.userId,
      messageId: selected.id,
      durationMinutes: btn.dataset.minutes ? Number(btn.dataset.minutes) : undefined
    };
    menuEl.classList.remove('open');
    try {
      const res = await fetch('/api/chat/moderate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        bannerEl.textContent = `Action failed: ${data.error || res.status}`;
        bannerEl.classList.add('show', 'error');
      }
    } catch {
      bannerEl.textContent = 'Action failed: network error';
      bannerEl.classList.add('show', 'error');
    }
  });
});

function addMessages(messages) {
  const nearBottom = feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 80;

  for (const msg of messages) {
    if (knownIds.has(msg.id)) continue;
    knownIds.add(msg.id);
    feedEl.appendChild(renderMessage(msg));
  }

  if (nearBottom) feedEl.scrollTop = feedEl.scrollHeight;
}

let chatSocket = null;
let reconnectTimer = null;

function connectChatSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  chatSocket = new WebSocket(`${protocol}//${location.host}/api/chat/socket`);

  chatSocket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'history') addMessages(data.messages);
    else if (data.type === 'message') addMessages([data.message]);
  });

  chatSocket.addEventListener('close', () => {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectChatSocket, 2000);
  });

  chatSocket.addEventListener('error', () => {
    chatSocket.close();
  });
}

async function disconnectPlatform(platform) {
  if (!confirm(`Disconnect ${platform}? You'll need to reconnect to receive its chat again.`)) return;
  try {
    const res = await fetch(`/api/auth/${platform}/disconnect`, { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      bannerEl.textContent = `Failed to disconnect ${platform}: ${data.error || res.status}`;
      bannerEl.classList.remove('show');
      bannerEl.classList.add('show', 'error');
      return;
    }
    bannerEl.textContent = `Disconnected ${platform}.`;
    bannerEl.classList.remove('error');
    bannerEl.classList.add('show');
    await pollStatus();
  } catch {
    bannerEl.textContent = `Failed to disconnect ${platform}: network error`;
    bannerEl.classList.add('show', 'error');
  }
}

async function pollStatus() {
  try {
    const res = await fetch('/api/chat/status');
    if (!res.ok) return;
    renderConnections(await res.json());
  } catch {
    // ignore
  }
}

pollStatus();
connectChatSocket();
setInterval(pollStatus, 15000);
