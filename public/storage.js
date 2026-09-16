const MULTIPART_THRESHOLD = 100 * 1024 * 1024;

const noticeEl = document.getElementById('storage-notice');
const usageFillEl = document.getElementById('storage-usage-fill');
const usageTextEl = document.getElementById('storage-usage-text');
const usageCountEl = document.getElementById('storage-usage-count');
const searchEl = document.getElementById('storage-search');
const sortEl = document.getElementById('storage-sort');
const folderChipsEl = document.getElementById('storage-folder-chips');
const uploadsEl = document.getElementById('storage-uploads');
const emptyEl = document.getElementById('storage-empty');
const listEl = document.getElementById('storage-list');
const uploadBtn = document.getElementById('storage-upload-btn');
const fileInput = document.getElementById('storage-file-input');
const uploadFolderBtn = document.getElementById('storage-upload-folder-btn');
const folderInput = document.getElementById('storage-folder-input');
const newFolderBtn = document.getElementById('storage-new-folder-btn');
const dropOverlay = document.getElementById('storage-drop-overlay');
const replaceInput = document.getElementById('storage-replace-input');

const fileModal = document.getElementById('storage-file-modal');
const fileModalTitle = document.getElementById('storage-file-modal-title');
const fileForm = document.getElementById('storage-file-form');
const fileNameInput = document.getElementById('storage-file-name');
const fileDescInput = document.getElementById('storage-file-description');
const fileFolderSelect = document.getElementById('storage-file-folder');
const fileFormError = document.getElementById('storage-file-form-error');

const folderModal = document.getElementById('storage-folder-modal');
const folderModalTitle = document.getElementById('storage-folder-modal-title');
const folderForm = document.getElementById('storage-folder-form');
const folderNameInput = document.getElementById('storage-folder-name');
const folderFormError = document.getElementById('storage-folder-form-error');

const previewModal = document.getElementById('storage-preview-modal');
const previewTitle = document.getElementById('storage-preview-title');
const previewBody = document.getElementById('storage-preview-body');

let state = { folders: [], files: [], limitBytes: 0, usedBytes: 0, availableBytes: 0, percentUsed: 0, fileCount: 0, r2Configured: true };
let currentFolderFilter = '';
let searchQuery = '';
let sortKey = 'date';
let editingFileId = null;
let editingFolderId = null;
let replacingFileId = null;
const uploads = new Map();

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

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function getExtension(filename) {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(idx + 1).toLowerCase() : '';
}

function stripExtension(filename) {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(0, idx) : filename;
}

async function api(path, body) {
  try {
    const options = body === undefined
      ? undefined
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    const res = await fetch(path, options);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'Network error' } };
  }
}

function showNotice(message, isError = false) {
  noticeEl.textContent = message;
  noticeEl.className = `storage-notice show${isError ? ' error' : ''}`;
}

function clearNotice() {
  noticeEl.className = 'storage-notice';
}

// ---------- Icons ----------

const ICONS = {
  image: '<path d="M4 5h16v14H4z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="10" r="1.6" fill="currentColor"/><path d="M5 17l5-5 3 3 3-4 3 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  pdf: '<path d="M6 2h9l5 5v15H6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M15 2v5h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><text x="8" y="17" font-size="6" fill="currentColor" font-family="sans-serif">PDF</text>',
  video: '<path d="M4 6h13v12H4z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M17 10l4-2.5v9L17 14z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  audio: '<path d="M9 18V6l10-2v12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="7" cy="18" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="17" cy="16" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  archive: '<path d="M4 8h16v12H4z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 8V4h16v4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M11 8v2h2V8m-2 4v2h2v-2m-2 4v2h2v-2" stroke="currentColor" stroke-width="1.2"/>',
  document: '<path d="M6 2h9l5 5v15H6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M15 2v5h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 13h6M9 16h6" stroke="currentColor" stroke-width="1.2"/>',
  generic: '<path d="M6 2h9l5 5v15H6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M15 2v5h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  folder: '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>'
};

const EXT_CATEGORY = {
  pdf: 'pdf',
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', avi: 'video',
  mp3: 'audio', wav: 'audio', flac: 'audio', m4a: 'audio', ogg: 'audio',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
  doc: 'document', docx: 'document', txt: 'document', md: 'document', rtf: 'document',
  xls: 'document', xlsx: 'document', csv: 'document', ppt: 'document', pptx: 'document'
};

function fileCategory(file) {
  if (file.mimeType && file.mimeType.startsWith('image/')) return 'image';
  const ext = getExtension(file.originalFilename);
  return EXT_CATEGORY[ext] || 'generic';
}

function iconSvg(category) {
  return `<svg viewBox="0 0 24 24" width="22" height="22">${ICONS[category] || ICONS.generic}</svg>`;
}

// ---------- Loading state ----------

async function loadState() {
  const res = await api('/api/storage/state');
  if (res.status === 401) {
    window.location.href = '/';
    return;
  }
  if (!res.ok) {
    showNotice(res.data.error === 'not configured'
      ? 'Storage is not configured yet on the server. See setup instructions.'
      : 'Could not load storage.', true);
    return;
  }
  clearNotice();
  state = res.data;
  if (!state.r2Configured) {
    showNotice('Running in local fallback mode: uploads/downloads are proxied through the server since R2 API credentials are not configured yet.');
  }
  renderUsage();
  renderFolderChips();
  renderFolderOptions();
  renderList();
}

function renderUsage() {
  usageFillEl.style.width = `${Math.min(100, state.percentUsed)}%`;
  usageTextEl.textContent = `${formatBytes(state.usedBytes)} used of ${formatBytes(state.limitBytes)} (${state.percentUsed.toFixed(1)}%) — ${formatBytes(state.availableBytes)} available`;
  usageCountEl.textContent = `${state.fileCount} file${state.fileCount === 1 ? '' : 's'}`;
  usageFillEl.classList.toggle('storage-usage-fill-warn', state.percentUsed >= 90);
}

function renderFolderChips() {
  const chips = [{ id: '', label: 'All files' }, ...state.folders.map((f) => ({ id: f.id, label: f.name }))];
  if (state.folders.length) chips.push({ id: 'unfiled', label: 'Unfiled' });

  folderChipsEl.innerHTML = '';
  for (const chip of chips) {
    const btn = document.createElement('button');
    btn.className = `page-tab storage-chip${currentFolderFilter === chip.id ? ' is-active' : ''}`;
    btn.textContent = chip.label;
    btn.addEventListener('click', () => {
      currentFolderFilter = chip.id;
      renderFolderChips();
      renderList();
    });
    if (chip.id && chip.id !== 'unfiled') {
      const folder = state.folders.find((f) => f.id === chip.id);
      const renameBtn = document.createElement('span');
      renameBtn.className = 'storage-chip-edit';
      renameBtn.textContent = '✎';
      renameBtn.title = 'Rename folder';
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openFolderModal(folder);
      });
      btn.appendChild(renameBtn);

      const deleteBtn = document.createElement('span');
      deleteBtn.className = 'storage-chip-edit';
      deleteBtn.textContent = '✕';
      deleteBtn.title = 'Delete folder';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteFolder(folder);
      });
      btn.appendChild(deleteBtn);
    }
    folderChipsEl.appendChild(btn);
  }
}

function renderFolderOptions() {
  fileFolderSelect.innerHTML = '<option value="">No folder</option>' +
    state.folders.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('');
}

function getVisibleFiles() {
  let files = state.files;
  if (currentFolderFilter === 'unfiled') files = files.filter((f) => !f.folderId);
  else if (currentFolderFilter) files = files.filter((f) => f.folderId === currentFolderFilter);

  const q = searchQuery.trim().toLowerCase();
  if (q) {
    files = files.filter((f) =>
      f.displayName.toLowerCase().includes(q) || f.originalFilename.toLowerCase().includes(q));
  }

  return [...files].sort((a, b) => {
    if (sortKey === 'name') return a.displayName.localeCompare(b.displayName);
    if (sortKey === 'size') return b.size - a.size;
    return b.createdAt - a.createdAt;
  });
}

const thumbObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const el = entry.target;
    thumbObserver.unobserve(el);
    loadThumbnail(el, el.dataset.fileId);
  }
}, { rootMargin: '200px' });

async function loadThumbnail(imgWrapper, fileId) {
  const res = await api(`/api/storage/preview/url?id=${encodeURIComponent(fileId)}`);
  if (!res.ok) return;
  const img = document.createElement('img');
  img.src = res.data.url;
  img.alt = '';
  img.loading = 'lazy';
  imgWrapper.innerHTML = '';
  imgWrapper.appendChild(img);
}

function renderFolderRow(folder) {
  const row = document.createElement('div');
  row.className = 'storage-row storage-row-folder';

  const count = state.files.filter((f) => f.folderId === folder.id).length;
  const thumb = document.createElement('div');
  thumb.className = 'storage-thumb';
  thumb.innerHTML = iconSvg('folder');
  row.appendChild(thumb);

  const main = document.createElement('div');
  main.className = 'storage-row-main';
  main.innerHTML = `
    <span class="storage-row-name">${escapeHtml(folder.name)}</span>
    <span class="storage-row-meta">${count} file${count === 1 ? '' : 's'}</span>
  `;
  row.appendChild(main);

  const actions = document.createElement('div');
  actions.className = 'storage-row-actions';
  actions.appendChild(makeActionBtn('✎', 'Rename folder', (e) => {
    e.stopPropagation();
    openFolderModal(folder);
  }));
  actions.appendChild(makeActionBtn('✕', 'Delete folder', (e) => {
    e.stopPropagation();
    deleteFolder(folder);
  }, 'finance-delete'));
  row.appendChild(actions);

  row.addEventListener('click', () => {
    currentFolderFilter = folder.id;
    renderFolderChips();
    renderList();
  });

  return row;
}

async function deleteFolder(folder) {
  const count = state.files.filter((f) => f.folderId === folder.id).length;
  const message = count > 0
    ? `Delete "${folder.name}"? ${count} file${count === 1 ? '' : 's'} inside will become unfiled, not deleted.`
    : `Delete "${folder.name}"?`;
  if (!confirm(message)) return;

  const res = await api('/api/storage/folders/delete', { id: folder.id });
  if (!res.ok) {
    showNotice(res.data.error || 'Delete failed.', true);
    return;
  }
  if (currentFolderFilter === folder.id) currentFolderFilter = '';
  await loadState();
}

function renderList() {
  const files = getVisibleFiles();
  const showFolders = currentFolderFilter === '' && state.folders.length > 0;
  listEl.innerHTML = '';

  const totallyEmpty = state.files.length === 0 && state.folders.length === 0;
  emptyEl.hidden = !totallyEmpty;
  if (totallyEmpty) return;

  if (showFolders) {
    for (const folder of state.folders) {
      listEl.appendChild(renderFolderRow(folder));
    }
  }

  if (files.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'finance-empty';
    msg.textContent = state.files.length === 0 ? 'No files here yet.' : 'No files match.';
    listEl.appendChild(msg);
    return;
  }

  for (const file of files) {
    const row = document.createElement('div');
    row.className = 'storage-row';

    const thumb = document.createElement('div');
    thumb.className = 'storage-thumb';
    const category = fileCategory(file);
    if (category === 'image') {
      thumb.dataset.fileId = file.id;
      thumb.innerHTML = iconSvg('image');
      thumbObserver.observe(thumb);
    } else {
      thumb.innerHTML = iconSvg(category);
    }
    row.appendChild(thumb);

    const main = document.createElement('div');
    main.className = 'storage-row-main';
    const folder = state.folders.find((f) => f.id === file.folderId);
    main.innerHTML = `
      <span class="storage-row-name">${escapeHtml(file.displayName)}</span>
      <span class="storage-row-meta">${formatBytes(file.size)} · ${formatDate(file.createdAt)}${folder ? ` · ${escapeHtml(folder.name)}` : ''}</span>
      ${file.description ? `<span class="storage-row-desc">${escapeHtml(file.description)}</span>` : ''}
    `;
    row.appendChild(main);

    const actions = document.createElement('div');
    actions.className = 'storage-row-actions';

    const previewable = category === 'image' || file.mimeType === 'application/pdf';
    if (previewable) {
      actions.appendChild(makeActionBtn('👁', 'Preview', () => openPreview(file)));
    }
    actions.appendChild(makeActionBtn('⬇', 'Download', () => downloadFile(file)));
    actions.appendChild(makeActionBtn('✎', 'Edit', () => openFileModal(file)));
    actions.appendChild(makeActionBtn('⟳', 'Replace contents', () => startReplace(file)));
    actions.appendChild(makeActionBtn('✕', 'Delete', () => deleteFile(file), 'finance-delete'));
    row.appendChild(actions);

    listEl.appendChild(row);
  }
}

function makeActionBtn(label, title, onClick, extraClass = '') {
  const btn = document.createElement('button');
  btn.className = extraClass;
  btn.textContent = label;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.addEventListener('click', onClick);
  return btn;
}

// ---------- File edit modal ----------

function openFileModal(file) {
  editingFileId = file.id;
  fileModalTitle.textContent = 'Edit File';
  fileNameInput.value = file.displayName;
  fileDescInput.value = file.description || '';
  fileFolderSelect.value = file.folderId || '';
  fileFormError.textContent = '';
  fileModal.classList.add('open');
  fileNameInput.focus();
}

function closeFileModal() {
  fileModal.classList.remove('open');
  editingFileId = null;
}

document.getElementById('storage-file-modal-close').addEventListener('click', closeFileModal);
fileModal.addEventListener('click', (e) => { if (e.target === fileModal) closeFileModal(); });

fileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  fileFormError.textContent = '';
  const displayName = fileNameInput.value.trim();
  if (!displayName) {
    fileFormError.textContent = 'Enter a display name.';
    return;
  }
  const res = await api('/api/storage/files/edit', {
    id: editingFileId,
    displayName,
    description: fileDescInput.value,
    folderId: fileFolderSelect.value || null
  });
  if (!res.ok) {
    fileFormError.textContent = res.data.error || 'Save failed.';
    return;
  }
  closeFileModal();
  await loadState();
});

// ---------- Folder modal ----------

function openFolderModal(folder) {
  editingFolderId = folder ? folder.id : null;
  folderModalTitle.textContent = folder ? 'Rename Folder' : 'New Folder';
  folderNameInput.value = folder ? folder.name : '';
  folderFormError.textContent = '';
  folderModal.classList.add('open');
  folderNameInput.focus();
}

function closeFolderModal() {
  folderModal.classList.remove('open');
  editingFolderId = null;
}

newFolderBtn.addEventListener('click', () => openFolderModal(null));
document.getElementById('storage-folder-modal-close').addEventListener('click', closeFolderModal);
folderModal.addEventListener('click', (e) => { if (e.target === folderModal) closeFolderModal(); });

folderForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  folderFormError.textContent = '';
  const name = folderNameInput.value.trim();
  if (!name) {
    folderFormError.textContent = 'Enter a folder name.';
    return;
  }
  const endpoint = editingFolderId ? '/api/storage/folders/rename' : '/api/storage/folders/create';
  const payload = editingFolderId ? { id: editingFolderId, name } : { name };
  const res = await api(endpoint, payload);
  if (!res.ok) {
    folderFormError.textContent = res.data.error || 'Save failed.';
    return;
  }
  closeFolderModal();
  await loadState();
});

// ---------- Delete ----------

async function deleteFile(file) {
  if (!confirm(`Delete "${file.displayName}"? This can't be undone.`)) return;
  const res = await api('/api/storage/files/delete', { id: file.id });
  if (!res.ok) {
    showNotice(res.data.error || 'Delete failed.', true);
    return;
  }
  await loadState();
}

// ---------- Download / preview ----------

async function downloadFile(file) {
  const res = await api(`/api/storage/download/url?id=${encodeURIComponent(file.id)}`);
  if (!res.ok) {
    showNotice('Could not generate download link.', true);
    return;
  }
  const a = document.createElement('a');
  a.href = res.data.url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function openPreview(file) {
  const res = await api(`/api/storage/preview/url?id=${encodeURIComponent(file.id)}`);
  if (!res.ok) {
    showNotice('Preview unavailable for this file.', true);
    return;
  }
  previewTitle.textContent = file.displayName;
  if (file.mimeType === 'application/pdf') {
    previewBody.innerHTML = `<iframe src="${res.data.url}" class="storage-preview-frame"></iframe>`;
  } else {
    previewBody.innerHTML = `<img src="${res.data.url}" class="storage-preview-image" alt="${escapeHtml(file.displayName)}">`;
  }
  previewModal.classList.add('open');
}

document.getElementById('storage-preview-modal-close').addEventListener('click', () => {
  previewModal.classList.remove('open');
  previewBody.innerHTML = '';
});
previewModal.addEventListener('click', (e) => {
  if (e.target === previewModal) {
    previewModal.classList.remove('open');
    previewBody.innerHTML = '';
  }
});

// ---------- Replace ----------

function startReplace(file) {
  replacingFileId = file.id;
  replaceInput.value = '';
  replaceInput.click();
}

replaceInput.addEventListener('change', () => {
  const file = replaceInput.files[0];
  if (!file || !replacingFileId) return;
  const existing = state.files.find((f) => f.id === replacingFileId);
  queueUpload(file, {
    displayName: existing ? existing.displayName : stripExtension(file.name),
    folderId: existing ? existing.folderId : null,
    replaceFileId: replacingFileId
  });
  replacingFileId = null;
});

// ---------- Upload orchestration ----------

function xhrRequest(method, url, body, { onProgress, controllerRef } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    if (controllerRef) controllerRef.xhr = xhr;
    xhr.open(method, url);
    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ etag: xhr.getResponseHeader('ETag') });
      } else {
        reject(new Error(`Upload failed (HTTP ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () => reject(Object.assign(new Error('Canceled'), { canceled: true }));
    xhr.send(body);
  });
}

const MAX_CONCURRENT_UPLOADS = 4;
const BATCH_COLLAPSE_THRESHOLD = 12;
const uploadQueue = [];
let activeUploadCount = 0;
const batches = new Map();

function renderUploads() {
  uploadsEl.innerHTML = '';

  const rendered = new Set();
  for (const [id, u] of uploads) {
    if (u.batchId && batches.get(u.batchId).total > BATCH_COLLAPSE_THRESHOLD) {
      if (rendered.has(u.batchId)) continue;
      rendered.add(u.batchId);
      uploadsEl.appendChild(renderBatchRow(u.batchId));
      continue;
    }
    uploadsEl.appendChild(renderUploadRow(id, u));
  }
}

function renderUploadRow(id, u) {
  const row = document.createElement('div');
  row.className = `storage-upload-row storage-upload-${u.status}`;
  row.innerHTML = `
    <span class="storage-upload-name">${escapeHtml(u.displayName)}</span>
    <div class="storage-upload-bar"><div class="storage-upload-fill" style="width:${u.progress}%"></div></div>
    <span class="storage-upload-status">${uploadStatusLabel(u)}</span>
  `;
  const actions = document.createElement('div');
  actions.className = 'storage-upload-actions';
  if (u.status === 'uploading' || u.status === 'queued') {
    actions.appendChild(makeActionBtn('✕', 'Cancel', () => cancelUpload(id)));
  } else if (u.status === 'error') {
    actions.appendChild(makeActionBtn('⟳', 'Retry', () => retryUpload(id)));
    actions.appendChild(makeActionBtn('✕', 'Dismiss', () => dismissUpload(id)));
  } else if (u.status === 'done' || u.status === 'canceled') {
    actions.appendChild(makeActionBtn('✕', 'Dismiss', () => dismissUpload(id)));
  }
  row.appendChild(actions);
  return row;
}

function renderBatchRow(batchId) {
  const batch = batches.get(batchId);
  const items = [...uploads.values()].filter((u) => u.batchId === batchId);
  const done = items.filter((u) => u.status === 'done').length;
  const failed = items.filter((u) => u.status === 'error').length;
  const canceled = items.filter((u) => u.status === 'canceled').length;
  const settled = done + failed + canceled;
  const progress = batch.total > 0 ? (settled / batch.total) * 100 : 0;

  const row = document.createElement('div');
  row.className = 'storage-upload-row';
  row.innerHTML = `
    <span class="storage-upload-name">${escapeHtml(batch.name)} (${batch.total} files)</span>
    <div class="storage-upload-bar"><div class="storage-upload-fill" style="width:${progress}%"></div></div>
    <span class="storage-upload-status">${done} done${failed ? `, ${failed} failed` : ''}${settled < batch.total ? ` · ${batch.total - settled} left` : ''}</span>
  `;
  const actions = document.createElement('div');
  actions.className = 'storage-upload-actions';
  if (settled < batch.total) {
    actions.appendChild(makeActionBtn('✕', 'Cancel remaining', () => cancelBatch(batchId)));
  } else {
    actions.appendChild(makeActionBtn('✕', 'Dismiss', () => dismissBatch(batchId)));
  }
  row.appendChild(actions);
  return row;
}

function uploadStatusLabel(u) {
  if (u.status === 'queued') return 'Waiting…';
  if (u.status === 'uploading') return `${Math.round(u.progress)}%`;
  if (u.status === 'done') return 'Done';
  if (u.status === 'canceled') return 'Canceled';
  if (u.status === 'error') return u.error || 'Failed';
  return '';
}

function updateUpload(id, patch) {
  const u = uploads.get(id);
  if (!u) return;
  Object.assign(u, patch);
  renderUploads();
}

function cancelUpload(id) {
  const u = uploads.get(id);
  if (!u) return;
  const queueIdx = uploadQueue.indexOf(id);
  if (queueIdx !== -1) uploadQueue.splice(queueIdx, 1);
  if (u.controllerRef && u.controllerRef.xhr) {
    try { u.controllerRef.xhr.abort(); } catch { /* ignore */ }
  }
  if (u.pendingId) api('/api/storage/upload/abort', { pendingId: u.pendingId });
  updateUpload(id, { status: 'canceled' });
}

function cancelBatch(batchId) {
  for (const u of uploads.values()) {
    if (u.batchId === batchId && (u.status === 'queued' || u.status === 'uploading')) {
      cancelUpload(u.id);
    }
  }
}

function dismissUpload(id) {
  uploads.delete(id);
  renderUploads();
}

function dismissBatch(batchId) {
  for (const [id, u] of uploads) {
    if (u.batchId === batchId) uploads.delete(id);
  }
  batches.delete(batchId);
  renderUploads();
}

function retryUpload(id) {
  const u = uploads.get(id);
  if (!u) return;
  updateUpload(id, { status: 'queued', progress: 0, error: null, pendingId: null });
  uploadQueue.push(id);
  processUploadQueue();
}

function processUploadQueue() {
  while (activeUploadCount < MAX_CONCURRENT_UPLOADS && uploadQueue.length > 0) {
    const id = uploadQueue.shift();
    const u = uploads.get(id);
    if (!u || u.status === 'canceled') continue;
    activeUploadCount++;
    updateUpload(id, { status: 'uploading' });
    runUpload(id).finally(() => {
      activeUploadCount--;
      processUploadQueue();
    });
  }
}

function queueUpload(file, { displayName, folderId, replaceFileId, batchId } = {}) {
  const id = crypto.randomUUID();
  uploads.set(id, {
    id,
    file,
    displayName: displayName || stripExtension(file.name),
    folderId: folderId || null,
    replaceFileId: replaceFileId || null,
    progress: 0,
    status: 'queued',
    pendingId: null,
    batchId: batchId || null,
    controllerRef: {}
  });
  if (batchId) batches.get(batchId).total++;
  renderUploads();
  uploadQueue.push(id);
  processUploadQueue();
}

async function runUpload(id) {
  const u = uploads.get(id);
  if (!u) return;
  u.controllerRef = {};

  try {
    const initRes = await api('/api/storage/upload/init', {
      originalFilename: u.file.name,
      size: u.file.size,
      mimeType: u.file.type || 'application/octet-stream',
      folderId: u.folderId,
      displayName: u.displayName,
      replaceFileId: u.replaceFileId || undefined
    });

    if (!initRes.ok) throw new Error(initRes.data.error || 'Could not start upload');
    const { pendingId, mode, uploadUrl, partSize, totalParts } = initRes.data;
    updateUpload(id, { pendingId });

    if (mode === 'single' || mode === 'proxy') {
      const url = mode === 'single' ? uploadUrl : `/api/storage/upload/proxy?pendingId=${encodeURIComponent(pendingId)}`;
      await xhrRequest('PUT', url, u.file, {
        onProgress: (loaded, total) => updateUpload(id, { progress: (loaded / total) * 100 }),
        controllerRef: u.controllerRef
      });
      if (mode === 'single') {
        const completeRes = await api('/api/storage/upload/complete', { pendingId });
        if (!completeRes.ok) throw new Error(completeRes.data.error || 'Upload verification failed');
      }
    } else if (mode === 'multipart') {
      const parts = [];
      let uploadedBytes = 0;
      for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
        const start = (partNumber - 1) * partSize;
        const end = Math.min(start + partSize, u.file.size);
        const chunk = u.file.slice(start, end);

        const urlRes = await api('/api/storage/upload/part-url', { pendingId, partNumber });
        if (!urlRes.ok) throw new Error('Could not get upload URL for part');

        const bytesBefore = uploadedBytes;
        const result = await xhrRequest('PUT', urlRes.data.url, chunk, {
          onProgress: (loaded) => updateUpload(id, { progress: ((bytesBefore + loaded) / u.file.size) * 100 }),
          controllerRef: u.controllerRef
        });
        uploadedBytes += chunk.size;
        parts.push({ partNumber, etag: result.etag });
      }
      const completeRes = await api('/api/storage/upload/complete', { pendingId, parts });
      if (!completeRes.ok) throw new Error(completeRes.data.error || 'Upload verification failed');
    }

    updateUpload(id, { status: 'done', progress: 100 });
    scheduleStateRefresh();
  } catch (err) {
    if (err && err.canceled) {
      updateUpload(id, { status: 'canceled' });
    } else {
      updateUpload(id, { status: 'error', error: err.message });
    }
  }
}

let stateRefreshTimer = null;
function scheduleStateRefresh() {
  clearTimeout(stateRefreshTimer);
  stateRefreshTimer = setTimeout(loadState, 400);
}

function handleFiles(fileList) {
  const files = [...fileList].filter((f) => f.size > 0);
  if (!files.length) return;
  const folderId = currentFolderFilter && currentFolderFilter !== 'unfiled' ? currentFolderFilter : null;
  const batchId = files.length > 1 ? crypto.randomUUID() : null;
  if (batchId) batches.set(batchId, { name: 'Upload', total: 0 });
  for (const file of files) {
    if (file.size > MULTIPART_THRESHOLD * 1024) {
      showNotice(`"${file.name}" is unusually large; upload may take a while.`);
    }
    queueUpload(file, { folderId, batchId });
  }
}

uploadBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  handleFiles(fileInput.files);
  fileInput.value = '';
});

async function getOrCreateFolder(name) {
  const existing = state.folders.find((f) => f.name === name);
  if (existing) return existing;
  const res = await api('/api/storage/folders/create', { name });
  if (!res.ok) return null;
  state.folders.push(res.data);
  renderFolderOptions();
  return res.data;
}

async function handleFolderSelection(fileList) {
  const files = [...fileList].filter((f) => f.size > 0);
  if (!files.length) return;

  const topLevelName = files[0].webkitRelativePath
    ? files[0].webkitRelativePath.split('/')[0]
    : 'Uploaded folder';
  const folder = await getOrCreateFolder(topLevelName);
  if (!folder) {
    showNotice('Could not create folder for upload.', true);
    return;
  }
  renderFolderChips();

  const batchId = crypto.randomUUID();
  batches.set(batchId, { name: topLevelName, total: 0 });
  for (const file of files) {
    queueUpload(file, { folderId: folder.id, batchId });
  }
}

uploadFolderBtn.addEventListener('click', () => folderInput.click());
folderInput.addEventListener('change', () => {
  handleFolderSelection(folderInput.files);
  folderInput.value = '';
});

// ---------- Drag and drop ----------

let dragCounter = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;
  dragCounter++;
  dropOverlay.classList.add('show');
});
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer && e.dataTransfer.types.includes('Files')) e.preventDefault();
});
window.addEventListener('dragleave', () => {
  dragCounter = Math.max(0, dragCounter - 1);
  if (dragCounter === 0) dropOverlay.classList.remove('show');
});
window.addEventListener('drop', (e) => {
  if (!e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;
  e.preventDefault();
  dragCounter = 0;
  dropOverlay.classList.remove('show');
  handleFiles(e.dataTransfer.files);
});

// ---------- Search / sort ----------

searchEl.addEventListener('input', () => {
  searchQuery = searchEl.value;
  renderList();
});

sortEl.addEventListener('change', () => {
  sortKey = sortEl.value;
  renderList();
});

loadState();
