import { upload } from 'https://esm.sh/@vercel/blob@2.5.0/client';

const form = document.getElementById('upload-form');
const fileInput = document.getElementById('file-input');
const status = document.getElementById('upload-status');
const fileList = document.getElementById('file-list');

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = -1;
  do {
    value /= 1024;
    i += 1;
  } while (value >= 1024 && i < units.length - 1);
  return `${value.toFixed(1)} ${units[i]}`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

async function loadFiles() {
  fileList.innerHTML = '<p class="files-empty">Loading...</p>';

  const res = await fetch('/api/blob/list');
  if (!res.ok) {
    fileList.innerHTML = '<p class="files-empty">Could not load files.</p>';
    return;
  }

  const { files } = await res.json();

  if (files.length === 0) {
    fileList.innerHTML = '<p class="files-empty">No files uploaded yet.</p>';
    return;
  }

  fileList.innerHTML = '';
  files.forEach((file) => {
    const row = document.createElement('div');
    row.className = 'file-row';
    row.innerHTML = `
      <div class="file-row-info">
        <span class="file-row-name">${file.pathname}</span>
        <span class="file-row-meta">${formatSize(file.size)} &middot; ${formatDate(file.uploadedAt)}</span>
      </div>
      <div class="file-row-actions">
        <a class="btn secondary" href="/api/blob/download?path=${encodeURIComponent(file.pathname)}">Download</a>
        <button type="button" class="btn danger" data-pathname="${file.pathname}">Delete</button>
      </div>
    `;
    row.querySelector('.btn.danger').addEventListener('click', () => deleteFile(file.pathname));
    fileList.appendChild(row);
  });
}

async function deleteFile(pathname) {
  if (!confirm(`Delete "${pathname}"? This cannot be undone.`)) return;

  const res = await fetch('/api/blob/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pathname })
  });

  if (res.ok) {
    loadFiles();
  } else {
    alert('Failed to delete file.');
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = fileInput.files[0];
  if (!file) return;

  status.textContent = `Uploading ${file.name}...`;

  try {
    await upload(file.name, file, {
      access: 'private',
      handleUploadUrl: '/api/blob/upload'
    });
    status.textContent = `Uploaded ${file.name}.`;
    form.reset();
    loadFiles();
  } catch (err) {
    status.textContent = `Upload failed: ${err.message}`;
  }
});

loadFiles();
