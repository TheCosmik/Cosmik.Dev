import { requireSession } from '../lib/verify-session.js';
import {
  r2Configured,
  presignedUploadUrl,
  presignedPartUrl,
  presignedDownloadUrl,
  createMultipartUpload,
  completeMultipartUpload,
  abortMultipartUpload
} from './r2-signer.js';

const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100 MB
const PART_SIZE = 25 * 1024 * 1024; // 25 MB
const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;
const STALE_PENDING_MS = 6 * 60 * 60 * 1000; // 6 hours
const PREVIEWABLE_TYPES = /^image\//;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function getStore(env) {
  const id = env.STORAGE_INDEX.idFromName('main');
  return env.STORAGE_INDEX.get(id);
}

async function storeFetch(env, path, body) {
  const res = await getStore(env).fetch(`https://storage.internal${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { status: res.status, data: await res.json() };
}

function limitBytes(env) {
  const gb = Number(env.STORAGE_LIMIT_GB) || 100;
  return gb * 1024 * 1024 * 1024;
}

function getExtension(filename) {
  const idx = filename.lastIndexOf('.');
  if (idx <= 0) return '';
  return filename.slice(idx);
}

function stripExtension(filename) {
  const ext = getExtension(filename);
  return ext ? filename.slice(0, -ext.length) : filename;
}

function downloadFilename(file) {
  const ext = getExtension(file.originalFilename);
  if (!ext) return file.displayName;
  return file.displayName.toLowerCase().endsWith(ext.toLowerCase()) ? file.displayName : `${file.displayName}${ext}`;
}

function makeKey(originalFilename) {
  return `files/${crypto.randomUUID()}${getExtension(originalFilename)}`;
}

function isPreviewable(mimeType) {
  return PREVIEWABLE_TYPES.test(mimeType) || mimeType === 'application/pdf';
}

export async function handleStorageState(request, env) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  if (!env.STORAGE_INDEX) return json({ error: 'not configured' }, 500);

  const { data } = await storeFetch(env, '/state');
  const limit = limitBytes(env);
  const used = data.completedBytes + data.reservedBytes;

  return json({
    folders: data.folders,
    files: data.files,
    pendingUploads: data.pending.map((p) => ({
      id: p.id,
      originalFilename: p.originalFilename,
      declaredSize: p.declaredSize,
      mode: p.mode,
      createdAt: p.createdAt
    })),
    fileCount: data.fileCount,
    limitBytes: limit,
    usedBytes: used,
    availableBytes: Math.max(0, limit - used),
    percentUsed: limit > 0 ? Math.min(100, (used / limit) * 100) : 0,
    r2Configured: r2Configured(env)
  });
}

export async function handleFolderCreate(request, env) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  if (!env.STORAGE_INDEX) return json({ error: 'not configured' }, 500);

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME_LENGTH) : '';
  if (!name) return json({ error: 'invalid input' }, 400);

  const { status, data } = await storeFetch(env, '/folders/create', { name });
  return json(data, status);
}

export async function handleFolderRename(request, env) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  if (!env.STORAGE_INDEX) return json({ error: 'not configured' }, 500);

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME_LENGTH) : '';
  if (!body.id || !name) return json({ error: 'invalid input' }, 400);

  const { status, data } = await storeFetch(env, '/folders/rename', { id: body.id, name });
  return json(data, status);
}

export async function handleFolderDelete(request, env) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  if (!env.STORAGE_INDEX) return json({ error: 'not configured' }, 500);

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  if (!body.id) return json({ error: 'invalid input' }, 400);

  const { status, data } = await storeFetch(env, '/folders/delete', { id: body.id });
  return json(data, status);
}

export async function handleFileEdit(request, env) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  if (!env.STORAGE_INDEX) return json({ error: 'not configured' }, 500);

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  if (!body.id) return json({ error: 'invalid input' }, 400);

  const patch = { id: body.id };
  if (typeof body.displayName === 'string') {
    const name = body.displayName.trim().slice(0, MAX_NAME_LENGTH);
    if (!name) return json({ error: 'invalid input' }, 400);
    patch.displayName = name;
  }
  if (typeof body.description === 'string') {
    patch.description = body.description.slice(0, MAX_DESCRIPTION_LENGTH);
  }
  if ('folderId' in body) {
    patch.folderId = body.folderId || null;
  }

  const { status, data } = await storeFetch(env, '/files/edit', patch);
  return json(data, status);
}

export async function handleFileDelete(request, env) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  if (!env.STORAGE_INDEX || !env.STORAGE_BUCKET) return json({ error: 'not configured' }, 500);

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  if (!body.id) return json({ error: 'invalid input' }, 400);

  const { status, data } = await storeFetch(env, '/files/delete', { id: body.id });
  if (status !== 200) return json(data, status);

  try {
    await env.STORAGE_BUCKET.delete(data.key);
  } catch {
    // metadata is already gone; object cleanup is best-effort
  }

  return json({ ok: true });
}

export async function handleUploadInit(request, env) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  if (!env.STORAGE_INDEX || !env.STORAGE_BUCKET) return json({ error: 'not configured' }, 500);

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const originalFilename = typeof body.originalFilename === 'string' ? body.originalFilename.trim().slice(0, 255) : '';
  const size = Number(body.size);
  if (!originalFilename || !Number.isFinite(size) || size <= 0) {
    return json({ error: 'invalid input' }, 400);
  }

  const mimeType = typeof body.mimeType === 'string' && body.mimeType ? body.mimeType.slice(0, 200) : 'application/octet-stream';
  const displayName = typeof body.displayName === 'string' && body.displayName.trim()
    ? body.displayName.trim().slice(0, MAX_NAME_LENGTH)
    : stripExtension(originalFilename).slice(0, MAX_NAME_LENGTH);
  const description = typeof body.description === 'string' ? body.description.slice(0, MAX_DESCRIPTION_LENGTH) : '';
  const folderId = body.folderId || null;
  const replaceFileId = body.replaceFileId || null;

  const key = makeKey(originalFilename);
  const configured = r2Configured(env);
  const mode = !configured ? 'proxy' : size > MULTIPART_THRESHOLD ? 'multipart' : 'single';
  const totalParts = mode === 'multipart' ? Math.ceil(size / PART_SIZE) : null;

  const { status, data } = await storeFetch(env, '/pending/reserve', {
    key,
    declaredSize: size,
    limitBytes: limitBytes(env),
    originalFilename,
    mimeType,
    displayName,
    description,
    folderId,
    replaceFileId,
    mode,
    partSize: mode === 'multipart' ? PART_SIZE : null,
    totalParts
  });

  if (status !== 200) {
    return json(data, status === 413 ? 413 : status);
  }

  const pendingId = data.id;

  if (mode === 'multipart') {
    let uploadId;
    try {
      uploadId = await createMultipartUpload(env, key);
    } catch (err) {
      await storeFetch(env, '/pending/release', { id: pendingId });
      return json({ error: 'failed to start multipart upload', detail: String(err) }, 502);
    }
    await storeFetch(env, '/pending/attach', { id: pendingId, multipartUploadId: uploadId });
    return json({ pendingId, mode, partSize: PART_SIZE, totalParts });
  }

  if (mode === 'single') {
    const uploadUrl = await presignedUploadUrl(env, key);
    return json({ pendingId, mode, uploadUrl });
  }

  return json({ pendingId, mode });
}

export async function handleUploadPartUrl(request, env) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  if (!env.STORAGE_INDEX) return json({ error: 'not configured' }, 500);

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const partNumber = Number(body.partNumber);
  if (!body.pendingId || !Number.isInteger(partNumber) || partNumber < 1) {
    return json({ error: 'invalid input' }, 400);
  }

  const { status, data: pending } = await storeFetch(env, `/pending/get?id=${encodeURIComponent(body.pendingId)}`);
  if (status !== 200) return json(pending, status);
  if (pending.mode !== 'multipart' || !pending.multipartUploadId) return json({ error: 'invalid pending upload' }, 400);
  if (pending.totalParts && partNumber > pending.totalParts) return json({ error: 'invalid part number' }, 400);

  const url = await presignedPartUrl(env, pending.key, pending.multipartUploadId, partNumber);
  return json({ url });
}

async function finalizeUpload(env, pendingId, { parts } = {}) {
  const { status: getStatus, data: pending } = await storeFetch(env, `/pending/get?id=${encodeURIComponent(pendingId)}`);
  if (getStatus !== 200) return { status: getStatus, data: pending };

  if (pending.mode === 'multipart') {
    if (!Array.isArray(parts) || parts.length === 0) {
      return { status: 400, data: { error: 'missing parts' } };
    }
    try {
      await completeMultipartUpload(env, pending.key, pending.multipartUploadId, parts);
    } catch (err) {
      return { status: 502, data: { error: 'failed to complete multipart upload', detail: String(err) } };
    }
  }

  const head = await env.STORAGE_BUCKET.head(pending.key);
  if (!head) {
    return { status: 502, data: { error: 'upload verification failed' } };
  }

  const { data: result } = await storeFetch(env, '/pending/finalize', { id: pendingId, actualSize: head.size });

  if (result.oldKey) {
    try {
      await env.STORAGE_BUCKET.delete(result.oldKey);
    } catch {
      // best-effort cleanup of the replaced object
    }
  }

  return { status: 200, data: { file: result.file } };
}

export async function handleUploadComplete(request, env) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  if (!env.STORAGE_INDEX || !env.STORAGE_BUCKET) return json({ error: 'not configured' }, 500);

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  if (!body.pendingId) return json({ error: 'invalid input' }, 400);

  const { status, data } = await finalizeUpload(env, body.pendingId, { parts: body.parts });
  return json(data, status);
}

export async function handleUploadAbort(request, env) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  if (!env.STORAGE_INDEX || !env.STORAGE_BUCKET) return json({ error: 'not configured' }, 500);

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  if (!body.pendingId) return json({ error: 'invalid input' }, 400);

  const { status, data: pending } = await storeFetch(env, `/pending/get?id=${encodeURIComponent(body.pendingId)}`);
  if (status === 200) {
    if (pending.mode === 'multipart' && pending.multipartUploadId && r2Configured(env)) {
      try {
        await abortMultipartUpload(env, pending.key, pending.multipartUploadId);
      } catch {
        // best-effort
      }
    }
    try {
      await env.STORAGE_BUCKET.delete(pending.key);
    } catch {
      // best-effort
    }
  }

  await storeFetch(env, '/pending/release', { id: body.pendingId });
  return json({ ok: true });
}

export async function handleUploadProxy(request, env) {
  if (!(await requireSession(request, env))) return new Response('unauthorized', { status: 401 });
  if (!env.STORAGE_INDEX || !env.STORAGE_BUCKET) return new Response('not configured', { status: 500 });

  const url = new URL(request.url);
  const pendingId = url.searchParams.get('pendingId');
  if (!pendingId) return new Response('missing pendingId', { status: 400 });

  const { status, data: pending } = await storeFetch(env, `/pending/get?id=${encodeURIComponent(pendingId)}`);
  if (status !== 200) return json(pending, status);

  await env.STORAGE_BUCKET.put(pending.key, request.body, {
    httpMetadata: { contentType: pending.mimeType }
  });

  const { status: finalStatus, data } = await finalizeUpload(env, pendingId);
  return json(data, finalStatus);
}

async function findFile(env, id) {
  const { data } = await storeFetch(env, '/state');
  return data.files.find((f) => f.id === id) || null;
}

export async function handleDownloadUrl(request, env) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  if (!env.STORAGE_INDEX) return json({ error: 'not configured' }, 500);

  const url = new URL(request.url);
  const file = await findFile(env, url.searchParams.get('id'));
  if (!file) return json({ error: 'not found' }, 404);

  if (!r2Configured(env)) {
    return json({ url: `/api/storage/download/proxy?id=${encodeURIComponent(file.id)}` });
  }

  const downloadUrl = await presignedDownloadUrl(env, file.key, {
    filename: downloadFilename(file),
    mimeType: file.mimeType,
    inline: false
  });
  return json({ url: downloadUrl });
}

export async function handlePreviewUrl(request, env) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  if (!env.STORAGE_INDEX) return json({ error: 'not configured' }, 500);

  const url = new URL(request.url);
  const file = await findFile(env, url.searchParams.get('id'));
  if (!file) return json({ error: 'not found' }, 404);
  if (!isPreviewable(file.mimeType)) return json({ error: 'not previewable' }, 400);

  if (!r2Configured(env)) {
    return json({ url: `/api/storage/preview/proxy?id=${encodeURIComponent(file.id)}` });
  }

  const previewUrl = await presignedDownloadUrl(env, file.key, {
    filename: downloadFilename(file),
    mimeType: file.mimeType,
    inline: true
  });
  return json({ url: previewUrl });
}

async function proxyServe(request, env, { inline }) {
  if (!(await requireSession(request, env))) return new Response('unauthorized', { status: 401 });
  if (!env.STORAGE_INDEX || !env.STORAGE_BUCKET) return new Response('not configured', { status: 500 });

  const url = new URL(request.url);
  const file = await findFile(env, url.searchParams.get('id'));
  if (!file) return new Response('not found', { status: 404 });
  if (inline && !isPreviewable(file.mimeType)) return new Response('not previewable', { status: 400 });

  const obj = await env.STORAGE_BUCKET.get(file.key);
  if (!obj) return new Response('not found', { status: 404 });

  const safeFilename = downloadFilename(file).replace(/[\r\n"]/g, '');
  return new Response(obj.body, {
    headers: {
      'Content-Type': file.mimeType || 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${safeFilename}"`,
      'Content-Length': String(obj.size)
    }
  });
}

export function handleDownloadProxy(request, env) {
  return proxyServe(request, env, { inline: false });
}

export function handlePreviewProxy(request, env) {
  return proxyServe(request, env, { inline: true });
}

export async function cleanupStalePendingUploads(env) {
  if (!env.STORAGE_INDEX || !env.STORAGE_BUCKET) return;

  const { data } = await storeFetch(env, '/pending/list');
  const cutoff = Date.now() - STALE_PENDING_MS;

  for (const pending of data.pending) {
    if (pending.createdAt > cutoff) continue;

    if (pending.mode === 'multipart' && pending.multipartUploadId && r2Configured(env)) {
      try {
        await abortMultipartUpload(env, pending.key, pending.multipartUploadId);
      } catch {
        // best-effort
      }
    }
    try {
      await env.STORAGE_BUCKET.delete(pending.key);
    } catch {
      // best-effort
    }
    await storeFetch(env, '/pending/release', { id: pending.id });
  }
}
