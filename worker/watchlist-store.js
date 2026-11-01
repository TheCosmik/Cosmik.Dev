const MAX_ITEMS = 500;

export class WatchlistStore {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.items = null;
  }

  async load() {
    if (this.items === null) {
      this.items = (await this.state.storage.get('items')) || [];
    }
  }

  async save() {
    await this.state.storage.put('items', this.items);
  }

  json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  }

  async fetch(request) {
    await this.load();
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.json() : null;

    if (url.pathname === '/list') {
      return this.json({ items: this.items });
    }

    if (url.pathname === '/add') {
      if (this.items.length >= MAX_ITEMS) return this.json({ error: 'list is full' }, 409);
      const item = { id: crypto.randomUUID(), title: body.title, watched: false, addedAt: Date.now(), watchedAt: null };
      this.items.push(item);
      await this.save();
      return this.json(item);
    }

    if (url.pathname === '/toggle') {
      const item = this.items.find((i) => i.id === body.id);
      if (!item) return this.json({ error: 'not found' }, 404);
      item.watched = Boolean(body.watched);
      item.watchedAt = item.watched ? Date.now() : null;
      await this.save();
      return this.json(item);
    }

    if (url.pathname === '/delete') {
      this.items = this.items.filter((i) => i.id !== body.id);
      await this.save();
      return this.json({ ok: true });
    }

    return new Response('not found', { status: 404 });
  }
}
