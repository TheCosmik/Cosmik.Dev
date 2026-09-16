const EVENTSUB_WS_URL = 'wss://eventsub.wss.twitch.tv/ws';
const HEALTH_CHECK_MS = 5 * 60 * 1000;
const RETRY_MS = 5 * 1000;

async function getTwitchToken(env) {
  const raw = await env.COSMIK_KV.get('oauth:twitch');
  return raw ? JSON.parse(raw) : null;
}

async function hasTwitchToken(env) {
  return Boolean(await env.COSMIK_KV.get('oauth:twitch'));
}

async function appendMessage(env, message) {
  const id = env.CHAT_ROOM.idFromName('main');
  await env.CHAT_ROOM.get(id).fetch('https://chat-room.internal/append', {
    method: 'POST',
    body: JSON.stringify(message)
  });
}

function buildTwitchContent(message) {
  if (!message.fragments || message.fragments.length === 0) return message.text;
  return message.fragments
    .map((f) => (f.type === 'emote' && f.emote ? `[emote:${f.emote.id}:${f.text}]` : f.text))
    .join('');
}

export class TwitchChatSocket {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.ws = null;
    this.sessionId = null;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/status') {
      const lastError = await this.state.storage.get('lastError');
      return new Response(
        JSON.stringify({
          connected: Boolean(this.ws && this.ws.readyState === 1),
          sessionId: this.sessionId,
          lastError: lastError || null
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.pathname === '/disconnect') {
      if (this.ws) {
        try {
          this.ws.close();
        } catch {
          // already closed
        }
        this.ws = null;
      }
      this.sessionId = null;
      await this.state.storage.deleteAlarm();
      await this.state.storage.put('lastError', null);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if ((!this.ws || this.ws.readyState !== 1) && (await hasTwitchToken(this.env))) {
      await this.connect();
    }

    // Outbound WebSockets don't hibernate (Cloudflare only hibernates when a
    // Durable Object acts as a WebSocket *server*), but an active outbound
    // connection keeps this object alive for up to ~15 minutes on its own.
    // This alarm is the safety net beyond that, and the fast retry on
    // close/error below is what actually matters for quick recovery.
    await this.state.storage.setAlarm(Date.now() + HEALTH_CHECK_MS);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async alarm() {
    if ((!this.ws || this.ws.readyState !== 1) && (await hasTwitchToken(this.env))) {
      await this.connect();
    }
    await this.state.storage.setAlarm(Date.now() + HEALTH_CHECK_MS);
  }

  async connect(url = EVENTSUB_WS_URL) {
    try {
      console.log(`twitch-socket connecting to ${url}`);
      const fetchUrl = url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
      const resp = await fetch(fetchUrl, { headers: { Upgrade: 'websocket' } });
      if (resp.status !== 101 || !resp.webSocket) {
        throw new Error(`unexpected upgrade response: ${resp.status}`);
      }

      const ws = resp.webSocket;
      ws.accept();
      const previous = this.ws;
      this.ws = ws;

      ws.addEventListener('message', (event) => {
        this.handleMessage(event.data).catch((err) => {
          this.state.storage.put('lastError', `handleMessage: ${String(err && err.stack || err)}`);
        });
      });

      ws.addEventListener('close', (event) => {
        console.log(`twitch-socket close: code=${event.code} reason=${event.reason} wasClean=${event.wasClean}`);
        if (this.ws === ws) {
          this.ws = null;
          this.state.storage.setAlarm(Date.now() + RETRY_MS);
        }
      });

      ws.addEventListener('error', (event) => {
        console.log(`twitch-socket error: ${event.message || event}`);
        if (this.ws === ws) {
          this.ws = null;
          this.state.storage.setAlarm(Date.now() + RETRY_MS);
        }
      });

      if (previous && previous !== ws) {
        try {
          previous.close();
        } catch {
          // already closed
        }
      }

      await this.state.storage.put('lastError', null);
    } catch (err) {
      await this.state.storage.put('lastError', `connect: ${String(err && err.stack || err)}`);
      await this.state.storage.setAlarm(Date.now() + RETRY_MS);
    }
  }

  async handleMessage(raw) {
    const msg = JSON.parse(raw);
    const type = msg.metadata && msg.metadata.message_type;
    console.log(`twitch-socket message: ${type}`);

    if (type === 'session_welcome') {
      this.sessionId = msg.payload.session.id;
      console.log(`twitch-socket welcome, keepalive=${msg.payload.session.keepalive_timeout_seconds}s`);
      await this.subscribe();
      return;
    }

    if (type === 'session_reconnect') {
      await this.connect(msg.payload.session.reconnect_url);
      return;
    }

    if (type === 'notification' && msg.metadata.subscription_type === 'channel.chat.message') {
      const e = msg.payload.event;
      await appendMessage(this.env, {
        id: e.message_id,
        platform: 'twitch',
        username: e.chatter_user_login,
        displayName: e.chatter_user_name,
        userId: e.chatter_user_id,
        color: e.color || null,
        content: buildTwitchContent(e.message),
        timestamp: new Date().toISOString()
      });
      return;
    }

    // session_keepalive, revocation, and unknown types need no action
  }

  async subscribe() {
    const token = await getTwitchToken(this.env);
    if (!token) {
      await this.state.storage.put('lastError', 'subscribe: no stored twitch token');
      return;
    }

    const res = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Client-Id': this.env.TWITCH_CLIENT_ID,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'channel.chat.message',
        version: '1',
        condition: { broadcaster_user_id: token.user_id, user_id: token.user_id },
        transport: { method: 'websocket', session_id: this.sessionId }
      })
    });

    if (!res.ok) {
      const text = await res.text();
      console.log(`twitch-socket subscribe failed: ${res.status} ${text}`);
      await this.state.storage.put('lastError', `subscribe: ${res.status} ${text}`);
    } else {
      console.log('twitch-socket subscribe ok');
    }
  }
}
