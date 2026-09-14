const grid = document.getElementById('project-grid');
const modal = document.getElementById('project-modal');
const modalIcon = document.getElementById('modal-icon');
const modalTitle = document.getElementById('modal-title');
const modalTagline = document.getElementById('modal-tagline');
const modalLive = document.getElementById('modal-live');
const modalRepo = document.getElementById('modal-repo');
const modalClose = document.getElementById('modal-close');
const modalPanel = document.querySelector('.modal-panel');

function repoPathFromUrl(url) {
  try {
    return new URL(url).pathname.replace(/^\/|\/$/g, '');
  } catch {
    return null;
  }
}

function relativeTime(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

PROJECTS.forEach((project) => {
  const card = document.createElement('button');
  card.className = 'project-card';
  card.style.setProperty('--accent', `${project.accent[0]}, ${project.accent[1]}, ${project.accent[2]}`);
  card.innerHTML = `
    <span class="project-icon">${project.icon}</span>
    <span class="project-name">${project.name}</span>
    <span class="project-tagline">${project.tagline}</span>
    <span class="project-stats" data-stats></span>
  `;
  card.addEventListener('click', () => openModal(project));
  grid.appendChild(card);

  const repo = repoPathFromUrl(project.repoUrl);
  if (repo) {
    fetch(`/api/repo-stats?repo=${encodeURIComponent(repo)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || data.error) return;
        card.querySelector('[data-stats]').innerHTML = `
          <span>★ ${data.stars}</span>
          <span>updated ${relativeTime(data.updatedAt)}</span>
        `;
      })
      .catch(() => {});
  }
});

const clickStatsList = document.getElementById('click-stats-list');
const LINK_LABELS = { kick: 'Kick', twitch: 'Twitch', x: 'X', discord: 'Discord' };

fetch('/api/click-stats')
  .then((res) => (res.ok ? res.json() : null))
  .then((stats) => {
    if (!stats) return;
    clickStatsList.innerHTML = Object.entries(LINK_LABELS)
      .map(([key, label]) => `<span>${label} <strong>${stats[key] || 0}</strong></span>`)
      .join('');
  })
  .catch(() => {});

function openModal(project) {
  modalPanel.style.setProperty('--accent', `${project.accent[0]}, ${project.accent[1]}, ${project.accent[2]}`);
  modalIcon.textContent = project.icon;
  modalTitle.textContent = project.name;
  modalTagline.textContent = project.tagline;
  modalLive.href = project.liveUrl;
  modalRepo.href = project.repoUrl;
  modal.classList.add('open');
}

function closeModal() {
  modal.classList.remove('open');
}

modalClose.addEventListener('click', closeModal);
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeModal();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});
