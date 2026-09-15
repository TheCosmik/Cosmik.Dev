export class FinanceStore {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.subs = null;
  }

  async load() {
    if (this.subs === null) {
      this.subs = (await this.state.storage.get('subscriptions')) || [];
    }
  }

  async fetch(request) {
    await this.load();
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.json() : null;

    if (url.pathname === '/list') {
      return this.json({ subscriptions: this.subs });
    }

    if (url.pathname === '/add') {
      const sub = { id: crypto.randomUUID(), name: body.name, amount: body.amount, chargeDay: body.chargeDay };
      this.subs.push(sub);
      await this.state.storage.put('subscriptions', this.subs);
      return this.json(sub);
    }

    if (url.pathname === '/update') {
      const idx = this.subs.findIndex((s) => s.id === body.id);
      if (idx === -1) return this.json({ error: 'not found' }, 404);
      this.subs[idx] = { ...this.subs[idx], name: body.name, amount: body.amount, chargeDay: body.chargeDay };
      await this.state.storage.put('subscriptions', this.subs);
      return this.json(this.subs[idx]);
    }

    if (url.pathname === '/delete') {
      this.subs = this.subs.filter((s) => s.id !== body.id);
      await this.state.storage.put('subscriptions', this.subs);
      return this.json({ ok: true });
    }

    return new Response('not found', { status: 404 });
  }

  json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  }
}
