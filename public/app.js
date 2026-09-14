const linkList = document.getElementById('link-list');
const linkElements = {};

LINKS.forEach((link) => {
  const a = document.createElement('a');
  a.className = 'link-btn';
  a.href = link.url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.style.setProperty('--brand', link.color);
  a.innerHTML = `
    <span class="link-icon">${link.icon}</span>
    <span class="link-name">${link.name}</span>
  `;
  linkList.appendChild(a);
  linkElements[link.name.toLowerCase()] = a;
});

fetch('/api/status')
  .then((res) => (res.ok ? res.json() : null))
  .then((status) => {
    if (!status) return;
    Object.entries(status).forEach(([platform, isLive]) => {
      const el = linkElements[platform];
      if (el && isLive) {
        const badge = document.createElement('span');
        badge.className = 'live-badge';
        badge.innerHTML = '<span class="live-dot"></span>LIVE';
        el.appendChild(badge);
      }
    });
  })
  .catch(() => {});

const trigger = document.getElementById('secret-trigger');
const modal = document.getElementById('unlock-modal');
const panel = document.querySelector('.unlock-panel');
const form = document.getElementById('unlock-form');
const input = document.getElementById('unlock-password');
const message = document.getElementById('unlock-message');
const closeBtn = document.getElementById('unlock-close');
const submitBtn = form.querySelector('button[type="submit"]');

function openModal() {
  modal.classList.add('open');
  message.classList.remove('show', 'granted');
  input.value = '';
  setTimeout(() => input.focus(), 60);
}

function closeModal() {
  modal.classList.remove('open');
}

trigger.addEventListener('click', openModal);
closeBtn.addEventListener('click', closeModal);
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeModal();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const value = input.value.trim();
  submitBtn.disabled = true;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: value })
    });

    if (!res.ok) throw new Error('denied');

    message.textContent = 'ACCESS GRANTED';
    message.classList.add('show', 'granted');
    setTimeout(() => {
      window.location.href = 'home.html';
    }, 600);
  } catch {
    message.textContent = 'ACCESS DENIED';
    message.classList.remove('granted');
    message.classList.add('show');
    panel.classList.remove('shake');
    void panel.offsetWidth;
    panel.classList.add('shake');
    input.value = '';
    input.focus();
    submitBtn.disabled = false;
  }
});
