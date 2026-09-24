// Tracks stream sessions: one is opened when either platform goes live and
// closed once both have been confirmed offline for several checks in a row
// (so a flaky API response can't split one stream into two).
const END_AFTER_OFFLINE_TICKS = 5;
const MAX_HISTORY = 200;
const MAX_SAMPLES = 1500;
const STALE_LIVE_MS = 3 * 60 * 1000;

function round1(n) {
  return Math.round(n * 10) / 10;
}

export class StreamStats {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return;
    const get = (key) => this.state.storage.get(key);
    this.current = (await get('current')) || null;
    this.counts = (await get('counts')) || { kick: 0, twitch: 0 };
    this.chatters = (await get('chatters')) || {};
    this.index = (await get('index')) || [];
    this.loaded = true;
  }

  json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  }

  buildSession(cur, endedAt) {
    const end = endedAt || Date.now();
    const last = cur.samples[cur.samples.length - 1];
    const fresh = !endedAt && last && Date.now() - cur.lastLiveAt < STALE_LIVE_MS;
    const platform = (p, idx) => ({ avg: p.n ? round1(p.sum / p.n) : 0, peak: p.peak, now: fresh ? last[idx] || 0 : 0 });
    return {
      id: cur.id,
      startedAt: cur.startedAt,
      endedAt: endedAt || null,
      durationMs: Math.max(0, end - cur.startedAt),
      title: cur.title,
      viewers: {
        avg: cur.combined.n ? round1(cur.combined.sum / cur.combined.n) : 0,
        peak: cur.combined.peak,
        now: fresh ? last[1] : 0
      },
      platforms: { kick: platform(cur.platforms.kick, 2), twitch: platform(cur.platforms.twitch, 3) },
      messages: {
        kick: this.counts.kick,
        twitch: this.counts.twitch,
        total: this.counts.kick + this.counts.twitch
      },
      chatters: Object.keys(this.chatters).length,
      samples: cur.samples
    };
  }

  summarize(session) {
    return {
      id: session.id,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationMs: session.durationMs,
      title: session.title,
      avgViewers: session.viewers.avg,
      peakViewers: session.viewers.peak,
      messages: session.messages.total,
      chatters: session.chatters
    };
  }

  async tick(now, kick, twitch) {
    const kickLive = Boolean(kick.ok && kick.live);
    const twitchLive = Boolean(twitch.ok && twitch.live);
    const anyLive = kickLive || twitchLive;
    const allKnown = kick.ok && twitch.ok;

    if (!this.current) {
      if (!anyLive) return;
      this.current = {
        id: crypto.randomUUID(),
        startedAt: now,
        lastLiveAt: now,
        offlineTicks: 0,
        title: null,
        platforms: { kick: { sum: 0, n: 0, peak: 0 }, twitch: { sum: 0, n: 0, peak: 0 } },
        combined: { sum: 0, n: 0, peak: 0 },
        samples: []
      };
      this.counts = { kick: 0, twitch: 0 };
      this.chatters = {};
      await this.state.storage.put({ counts: this.counts, chatters: this.chatters });
    }

    const cur = this.current;

    if (anyLive) {
      let combined = 0;
      const perPlatform = { kick: 0, twitch: 0 };
      for (const [name, info, live] of [['kick', kick, kickLive], ['twitch', twitch, twitchLive]]) {
        if (!live) continue;
        const v = Number(info.viewers) || 0;
        const p = cur.platforms[name];
        p.sum += v;
        p.n += 1;
        p.peak = Math.max(p.peak, v);
        combined += v;
        perPlatform[name] = v;
      }
      cur.combined.sum += combined;
      cur.combined.n += 1;
      cur.combined.peak = Math.max(cur.combined.peak, combined);
      if (cur.samples.length < MAX_SAMPLES) cur.samples.push([Math.round((now - cur.startedAt) / 60000), combined, perPlatform.kick, perPlatform.twitch]);
      if (!cur.title) cur.title = (kickLive && kick.title) || (twitchLive && twitch.title) || null;
      cur.lastLiveAt = now;
      cur.offlineTicks = 0;
    } else if (allKnown) {
      cur.offlineTicks += 1;
      if (cur.offlineTicks >= END_AFTER_OFFLINE_TICKS) {
        await this.endSession();
        return;
      }
    }

    await this.state.storage.put('current', cur);
  }

  async endSession() {
    const session = this.buildSession(this.current, this.current.lastLiveAt);
    this.index.unshift(this.summarize(session));
    const dropped = this.index.splice(MAX_HISTORY);

    await this.state.storage.put(`session:${session.id}`, session);
    await this.state.storage.put('index', this.index);
    if (dropped.length) await this.state.storage.delete(dropped.map((s) => `session:${s.id}`));
    await this.state.storage.delete(['current', 'counts', 'chatters']);

    this.current = null;
    this.counts = { kick: 0, twitch: 0 };
    this.chatters = {};
  }

  async recordMessage(platform, userId) {
    if (!this.current || (platform !== 'kick' && platform !== 'twitch')) return;
    this.counts[platform] += 1;
    await this.state.storage.put('counts', this.counts);

    const key = `${platform}:${userId}`;
    if (!this.chatters[key]) {
      this.chatters[key] = 1;
      await this.state.storage.put('chatters', this.chatters);
    }
  }

  async fetch(request) {
    await this.load();
    const url = new URL(request.url);

    if (url.pathname === '/tick' && request.method === 'POST') {
      const { now, kick, twitch } = await request.json();
      await this.tick(now, kick, twitch);
      return this.json({ ok: true });
    }

    if (url.pathname === '/message' && request.method === 'POST') {
      const { platform, userId } = await request.json();
      await this.recordMessage(platform, userId);
      return this.json({ ok: true });
    }

    if (url.pathname === '/current') {
      if (!this.current) return this.json({ live: false, session: null });
      return this.json({
        live: true,
        endingSoon: this.current.offlineTicks > 0,
        session: this.buildSession(this.current, null)
      });
    }

    if (url.pathname === '/history') {
      return this.json({ sessions: this.index });
    }

    if (url.pathname === '/session') {
      const id = url.searchParams.get('id');
      if (this.current && this.current.id === id) return this.json(this.buildSession(this.current, null));
      const session = id ? await this.state.storage.get(`session:${id}`) : null;
      return session ? this.json(session) : this.json({ error: 'not found' }, 404);
    }

    return new Response('not found', { status: 404 });
  }
}
