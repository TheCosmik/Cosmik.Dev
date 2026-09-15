const MAX_MESSAGES = 200;

export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.messages = null;
  }

  async loadMessages() {
    if (this.messages === null) {
      this.messages = (await this.state.storage.get('messages')) || [];
    }
    return this.messages;
  }

  async fetch(request) {
    // Browsers connect in as WebSocket clients here. Cloudflare hibernates
    // this Durable Object between messages to save cost while these
    // connections stay open at the edge — the correct use of the
    // Hibernation API, since we're acting as the server this time.
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server);

      const messages = await this.loadMessages();
      server.send(JSON.stringify({ type: 'history', messages }));

      return new Response(null, { status: 101, webSocket: client });
    }

    const url = new URL(request.url);

    if (url.pathname === '/append' && request.method === 'POST') {
      const message = await request.json();
      const messages = await this.loadMessages();
      messages.push(message);
      while (messages.length > MAX_MESSAGES) messages.shift();
      await this.state.storage.put('messages', messages);
      this.broadcast(message);
      return new Response('ok');
    }

    if (url.pathname === '/recent') {
      const messages = await this.loadMessages();
      return new Response(JSON.stringify({ messages }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('not found', { status: 404 });
  }

  broadcast(message) {
    const payload = JSON.stringify({ type: 'message', message });
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // socket is closing; it'll be cleaned up on its own
      }
    }
  }

  async webSocketMessage() {
    // Browsers only receive from this room, nothing to handle from them.
  }

  async webSocketClose() {}

  async webSocketError() {}
}
