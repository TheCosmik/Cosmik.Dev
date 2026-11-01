const MAX_CLIPS = 1000;

export class ClipsStore {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clips = null;
  }

  async load() {
    if (this.clips === null) {
      this.clips = (await this.state.storage.get('clips')) || [];
    }
  }

  json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  }

  async fetch(request) {
    await this.load();
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.json() : null;

    if (url.pathname === '/list') {
      return this.json({ clips: this.clips });
    }

    if (url.pathname === '/add') {
      if (this.clips.length >= MAX_CLIPS) return this.json({ error: 'full' }, 409);
      if (this.clips.some((c) => c.platform === body.platform && c.clipId === body.clipId)) {
        return this.json({ error: 'duplicate' }, 409);
      }
      const clip = { id: crypto.randomUUID(), ...body, addedAt: Date.now() };
      this.clips.push(clip);
      await this.state.storage.put('clips', this.clips);
      return this.json(clip);
    }

    if (url.pathname === '/delete') {
      this.clips = this.clips.filter((c) => c.id !== body.id);
      await this.state.storage.put('clips', this.clips);
      return this.json({ ok: true });
    }

    return new Response('not found', { status: 404 });
  }
}
