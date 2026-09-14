const PLATFORM_ICONS = {
  kick: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M1.333 0h8v5.333H12V2.667h2.667V0h8v8H20v2.667h-2.667v2.666H20V16h2.667v8h-8v-2.667H12v-2.666H9.333V24h-8Z"/></svg>',
  twitch: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/></svg>'
};

const connectionsEl = document.getElementById('chat-connections');
const bannerEl = document.getElementById('chat-banner');
const feedEl = document.getElementById('chat-feed');
const menuEl = document.getElementById('mod-menu');

let knownIds = new Set();
let selected = null;

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

function renderConnections(status) {
  connectionsEl.innerHTML = '';
  for (const platform of ['twitch', 'kick']) {
    const info = status[platform];
    const pill = document.createElement('div');
    pill.className = 'chat-connection';
    if (info.connected) {
      pill.innerHTML = `
        <span class="chat-connection-icon">${PLATFORM_ICONS[platform]}</span>
        <span>${platform === 'twitch' ? info.login : info.name}</span>
        <span class="chat-connection-dot"></span>
      `;
    } else {
      pill.innerHTML = `
        <span class="chat-connection-icon">${PLATFORM_ICONS[platform]}</span>
        <a href="/api/auth/${platform}/start">Connect ${platform}</a>
      `;
    }
    connectionsEl.appendChild(pill);
  }
}

function renderMessage(msg) {
  const row = document.createElement('div');
  row.className = 'chat-row';
  row.dataset.platform = msg.platform;
  row.dataset.userId = msg.userId;
  row.dataset.messageId = msg.id;

  const nameStyle = msg.color ? `style="color:${msg.color}"` : '';
  row.innerHTML = `
    <span class="chat-platform-icon chat-platform-${msg.platform}">${PLATFORM_ICONS[msg.platform]}</span>
    <span class="chat-username" ${nameStyle}>${msg.displayName || msg.username}</span>
    <span class="chat-content">${msg.content}</span>
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

async function pollMessages() {
  try {
    const res = await fetch('/api/chat/recent');
    if (!res.ok) return;
    const { messages } = await res.json();
    const nearBottom = feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 80;

    for (const msg of messages) {
      if (knownIds.has(msg.id)) continue;
      knownIds.add(msg.id);
      feedEl.appendChild(renderMessage(msg));
    }

    if (nearBottom) feedEl.scrollTop = feedEl.scrollHeight;
  } catch {
    // ignore transient network errors
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
pollMessages();
setInterval(pollMessages, 2000);
setInterval(pollStatus, 15000);
