export class StorageIndex {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.folders = null;
    this.files = null;
    this.pending = null;
  }

  async load() {
    if (this.folders !== null) return;
    [this.folders, this.files, this.pending] = await Promise.all([
      this.state.storage.get('folders').then((v) => v || []),
      this.state.storage.get('files').then((v) => v || []),
      this.state.storage.get('pending').then((v) => v || [])
    ]);
  }

  saveFolders() {
    return this.state.storage.put('folders', this.folders);
  }

  saveFiles() {
    return this.state.storage.put('files', this.files);
  }

  savePending() {
    return this.state.storage.put('pending', this.pending);
  }

  completedBytes() {
    return this.files.reduce((sum, f) => sum + f.size, 0);
  }

  reservedBytes() {
    return this.pending.reduce((sum, p) => sum + p.declaredSize, 0);
  }

  json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  }

  async fetch(request) {
    await this.load();
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.json() : null;

    if (url.pathname === '/state') {
      return this.json({
        folders: this.folders,
        files: this.files,
        pending: this.pending,
        completedBytes: this.completedBytes(),
        reservedBytes: this.reservedBytes(),
        fileCount: this.files.length
      });
    }

    if (url.pathname === '/folders/create') {
      const folder = { id: crypto.randomUUID(), name: body.name, createdAt: Date.now() };
      this.folders.push(folder);
      await this.saveFolders();
      return this.json(folder);
    }

    if (url.pathname === '/folders/rename') {
      const folder = this.folders.find((f) => f.id === body.id);
      if (!folder) return this.json({ error: 'not found' }, 404);
      folder.name = body.name;
      await this.saveFolders();
      return this.json(folder);
    }

    if (url.pathname === '/files/edit') {
      const file = this.files.find((f) => f.id === body.id);
      if (!file) return this.json({ error: 'not found' }, 404);
      if (body.folderId && !this.folders.some((f) => f.id === body.folderId)) {
        return this.json({ error: 'invalid folder' }, 400);
      }
      if (typeof body.displayName === 'string') file.displayName = body.displayName;
      if (typeof body.description === 'string') file.description = body.description;
      if ('folderId' in body) file.folderId = body.folderId || null;
      file.updatedAt = Date.now();
      await this.saveFiles();
      return this.json(file);
    }

    if (url.pathname === '/files/delete') {
      const idx = this.files.findIndex((f) => f.id === body.id);
      if (idx === -1) return this.json({ error: 'not found' }, 404);
      const [removed] = this.files.splice(idx, 1);
      await this.saveFiles();
      return this.json({ ok: true, key: removed.key });
    }

    if (url.pathname === '/pending/reserve') {
      if (body.replaceFileId && !this.files.some((f) => f.id === body.replaceFileId)) {
        return this.json({ error: 'not found' }, 404);
      }
      if (body.folderId && !this.folders.some((f) => f.id === body.folderId)) {
        return this.json({ error: 'invalid folder' }, 400);
      }
      const used = this.completedBytes() + this.reservedBytes();
      if (used + body.declaredSize > body.limitBytes) {
        return this.json({ error: 'quota_exceeded', availableBytes: Math.max(0, body.limitBytes - used) }, 413);
      }
      const pending = {
        id: crypto.randomUUID(),
        key: body.key,
        declaredSize: body.declaredSize,
        originalFilename: body.originalFilename,
        mimeType: body.mimeType,
        displayName: body.displayName,
        description: body.description || '',
        folderId: body.folderId || null,
        replaceFileId: body.replaceFileId || null,
        mode: body.mode,
        multipartUploadId: null,
        partSize: body.partSize || null,
        totalParts: body.totalParts || null,
        createdAt: Date.now()
      };
      this.pending.push(pending);
      await this.savePending();
      return this.json(pending);
    }

    if (url.pathname === '/pending/attach') {
      const pending = this.pending.find((p) => p.id === body.id);
      if (!pending) return this.json({ error: 'not found' }, 404);
      pending.multipartUploadId = body.multipartUploadId;
      await this.savePending();
      return this.json(pending);
    }

    if (url.pathname === '/pending/get') {
      const pending = this.pending.find((p) => p.id === url.searchParams.get('id'));
      if (!pending) return this.json({ error: 'not found' }, 404);
      return this.json(pending);
    }

    if (url.pathname === '/pending/list') {
      return this.json({ pending: this.pending });
    }

    if (url.pathname === '/pending/release') {
      const idx = this.pending.findIndex((p) => p.id === body.id);
      if (idx === -1) return this.json({ error: 'not found' }, 404);
      const [removed] = this.pending.splice(idx, 1);
      await this.savePending();
      return this.json(removed);
    }

    if (url.pathname === '/pending/finalize') {
      const idx = this.pending.findIndex((p) => p.id === body.id);
      if (idx === -1) return this.json({ error: 'not found' }, 404);
      const [pending] = this.pending.splice(idx, 1);
      await this.savePending();

      let file;
      let oldKey = null;
      if (pending.replaceFileId) {
        file = this.files.find((f) => f.id === pending.replaceFileId);
        if (!file) return this.json({ error: 'not found' }, 404);
        oldKey = file.key;
        file.key = pending.key;
        file.originalFilename = pending.originalFilename;
        file.mimeType = pending.mimeType;
        file.size = body.actualSize;
        file.updatedAt = Date.now();
      } else {
        file = {
          id: crypto.randomUUID(),
          key: pending.key,
          displayName: pending.displayName,
          originalFilename: pending.originalFilename,
          mimeType: pending.mimeType,
          size: body.actualSize,
          description: pending.description,
          folderId: pending.folderId,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        this.files.push(file);
      }
      await this.saveFiles();
      return this.json({ file, oldKey });
    }

    return new Response('not found', { status: 404 });
  }
}
