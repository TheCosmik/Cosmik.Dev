const grid = document.getElementById('project-grid');
const modal = document.getElementById('project-modal');
const modalIcon = document.getElementById('modal-icon');
const modalTitle = document.getElementById('modal-title');
const modalTagline = document.getElementById('modal-tagline');
const modalLive = document.getElementById('modal-live');
const modalRepo = document.getElementById('modal-repo');
const modalClose = document.getElementById('modal-close');

PROJECTS.forEach((project) => {
  const card = document.createElement('button');
  card.className = 'project-card';
  card.style.setProperty('--accent', `${project.accent[0]}, ${project.accent[1]}, ${project.accent[2]}`);
  card.innerHTML = `
    <span class="project-icon">${project.icon}</span>
    <span class="project-name">${project.name}</span>
    <span class="project-tagline">${project.tagline}</span>
  `;
  card.addEventListener('click', () => openModal(project));
  grid.appendChild(card);
});

function openModal(project) {
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
