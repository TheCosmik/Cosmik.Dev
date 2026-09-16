import { getCookieValue, requireSession } from '../lib/verify-session.js';

const REDIRECT_BASE = 'https://cosmik.dev';

const TWITCH_SCOPES = 'user:read:chat moderator:manage:banned_users moderator:manage:chat_messages';
const KICK_SCOPES = 'user:read events:subscribe moderation:ban moderation:chat_message:manage';

const KICK_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq/+l1WnlRrGSolDMA+A8
6rAhMbQGmQ2SapVcGM3zq8ANXjnhDWocMqfWcTd95btDydITa10kDvHzw9WQOqp2
MZI7ZyrfzJuz5nhTPCiJwTwnEtWft7nV14BYRDHvlfqPUaZ+1KR4OCaO/wWIk/rQ
L/TjY0M70gse8rlBkbo2a8rKhu69RQTRsoaf4DVhDPEeSeI5jVrRDGAMGL3cGuyY
6CLKGdjVEM78g3JfYOvDU/RvfqD7L89TZ3iN94jrmWdGz34JNlEI5hqK8dd7C5EF
BEbZ5jgB8s8ReQV8H+MkuffjdAj3ajDDX3DOJMIut1lBrUVD1AaSrGCKHooWoL2e
twIDAQAB
-----END PUBLIC KEY-----`;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

function randomString(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, length);
}

function base64UrlFromBytes(bytes) {
  let str = btoa(String.fromCharCode(...bytes));
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pkceChallengeFromVerifier(verifier) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(verifier));
  return base64UrlFromBytes(new Uint8Array(digest));
}

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function timingSafeStringEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(String(a))),
    crypto.subtle.digest('SHA-256', enc.encode(String(b)))
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

let kickPublicKeyPromise = null;
function getKickPublicKey() {
  if (!kickPublicKeyPromise) {
    const b64 = KICK_PUBLIC_KEY_PEM.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    kickPublicKeyPromise = crypto.subtle.importKey(
      'spki',
      raw,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
  }
  return kickPublicKeyPromise;
}

// ---------- storage (oauth tokens in KV, chat log in the ChatRoom Durable Object) ----------

async function getToken(env, platform) {
  const raw = await env.COSMIK_KV.get(`oauth:${platform}`);
  return raw ? JSON.parse(raw) : null;
}

async function saveToken(env, platform, data) {
  await env.COSMIK_KV.put(`oauth:${platform}`, JSON.stringify(data));
}

function getChatRoom(env) {
  const id = env.CHAT_ROOM.idFromName('main');
  return env.CHAT_ROOM.get(id);
}

async function appendMessage(env, message) {
  await getChatRoom(env).fetch('https://chat-room.internal/append', {
    method: 'POST',
    body: JSON.stringify(message)
  });
}

async function getRecentMessages(env) {
  const res = await getChatRoom(env).fetch('https://chat-room.internal/recent');
  const data = await res.json();
  return data.messages;
}

// ---------- Twitch ----------

function twitchAuthorizeUrl(env, state) {
  const params = new URLSearchParams({
    client_id: env.TWITCH_CLIENT_ID,
    redirect_uri: `${REDIRECT_BASE}/api/auth/twitch/callback`,
    response_type: 'code',
    scope: TWITCH_SCOPES,
    state
  });
  return `https://id.twitch.tv/oauth2/authorize?${params}`;
}

async function twitchExchangeCode(env, code) {
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID,
      client_secret: env.TWITCH_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${REDIRECT_BASE}/api/auth/twitch/callback`
    })
  });
  if (!res.ok) throw new Error(`twitch token exchange failed: ${res.status}`);
  return res.json();
}

async function twitchRefresh(env, refreshToken) {
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID,
      client_secret: env.TWITCH_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });
  if (!res.ok) throw new Error(`twitch refresh failed: ${res.status}`);
  return res.json();
}

async function twitchGetSelf(env, accessToken) {
  const res = await fetch('https://api.twitch.tv/helix/users', {
    headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': env.TWITCH_CLIENT_ID }
  });
  if (!res.ok) throw new Error(`twitch get self failed: ${res.status}`);
  const data = await res.json();
  return data.data[0];
}

async function pingTwitchSocket(env) {
  if (!env.TWITCH_SOCKET) return { ok: false, error: 'TWITCH_SOCKET binding missing' };
  const id = env.TWITCH_SOCKET.idFromName('main');
  const res = await env.TWITCH_SOCKET.get(id).fetch('https://twitch-socket.internal/');
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

async function twitchValidAccessToken(env) {
  const token = await getToken(env, 'twitch');
  if (!token) return null;
  if (token.expires_at && Date.now() / 1000 < token.expires_at - 60) {
    return token.access_token;
  }
  if (!token.refresh_token) return token.access_token;
  const refreshed = await twitchRefresh(env, token.refresh_token);
  const updated = {
    ...token,
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || token.refresh_token,
    expires_at: Date.now() / 1000 + refreshed.expires_in
  };
  await saveToken(env, 'twitch', updated);
  return updated.access_token;
}

async function verifyTwitchSignature(env, request, rawBody) {
  const messageId = request.headers.get('Twitch-Eventsub-Message-Id') || '';
  const timestamp = request.headers.get('Twitch-Eventsub-Message-Timestamp') || '';
  const signature = request.headers.get('Twitch-Eventsub-Message-Signature') || '';
  const expected = 'sha256=' + (await hmacSha256Hex(env.TWITCH_EVENTSUB_SECRET, messageId + timestamp + rawBody));
  return timingSafeStringEqual(expected, signature);
}

async function twitchBan(env, targetUserId, durationSeconds, reason) {
  const token = await twitchValidAccessToken(env);
  const self = await getToken(env, 'twitch');
  const params = new URLSearchParams({ broadcaster_id: self.user_id, moderator_id: self.user_id });
  const body = { data: { user_id: targetUserId, reason: reason || '' } };
  if (durationSeconds) body.data.duration = durationSeconds;
  const res = await fetch(`https://api.twitch.tv/helix/moderation/bans?${params}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Client-Id': env.TWITCH_CLIENT_ID,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

async function twitchDeleteMessage(env, messageId) {
  const token = await twitchValidAccessToken(env);
  const self = await getToken(env, 'twitch');
  const params = new URLSearchParams({ broadcaster_id: self.user_id, moderator_id: self.user_id, message_id: messageId });
  const res = await fetch(`https://api.twitch.tv/helix/moderation/chat?${params}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, 'Client-Id': env.TWITCH_CLIENT_ID }
  });
  return { ok: res.ok, status: res.status };
}

async function twitchRevoke(env, accessToken) {
  try {
    await fetch('https://id.twitch.tv/oauth2/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.TWITCH_CLIENT_ID, token: accessToken })
    });
  } catch {
    // best-effort cleanup only
  }
}

// ---------- Kick ----------

function kickAuthorizeUrl(env, state, codeChallenge) {
  const params = new URLSearchParams({
    client_id: env.KICK_CLIENT_ID,
    response_type: 'code',
    redirect_uri: `${REDIRECT_BASE}/api/auth/kick/callback`,
    scope: KICK_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });
  return `https://id.kick.com/oauth/authorize?${params}`;
}

async function kickExchangeCode(env, code, codeVerifier) {
  const res = await fetch('https://id.kick.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: env.KICK_CLIENT_ID,
      client_secret: env.KICK_CLIENT_SECRET,
      redirect_uri: `${REDIRECT_BASE}/api/auth/kick/callback`,
      code_verifier: codeVerifier,
      code
    })
  });
  if (!res.ok) throw new Error(`kick token exchange failed: ${res.status}`);
  return res.json();
}

async function kickRefresh(env, refreshToken) {
  const res = await fetch('https://id.kick.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: env.KICK_CLIENT_ID,
      client_secret: env.KICK_CLIENT_SECRET,
      refresh_token: refreshToken
    })
  });
  if (!res.ok) throw new Error(`kick refresh failed: ${res.status}`);
  return res.json();
}

async function kickGetSelf(accessToken) {
  const res = await fetch('https://api.kick.com/public/v1/users', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`kick get self failed: ${res.status}`);
  const data = await res.json();
  return data.data[0];
}

async function kickSubscribeChat(accessToken) {
  const res = await fetch('https://api.kick.com/public/v1/events/subscriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: [{ name: 'chat.message.sent', version: 1 }], method: 'webhook' })
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function kickListSubscriptions(accessToken, broadcasterUserId) {
  const params = new URLSearchParams({ broadcaster_user_id: String(broadcasterUserId) });
  const res = await fetch(`https://api.kick.com/public/v1/events/subscriptions?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data.data) ? data.data : [];
}

async function kickDeleteSubscriptions(accessToken, ids) {
  if (!ids.length) return;
  const params = new URLSearchParams();
  for (const id of ids) params.append('id', id);
  await fetch(`https://api.kick.com/public/v1/events/subscriptions?${params}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

async function kickRevoke(env, token, tokenTypeHint) {
  try {
    await fetch('https://id.kick.com/oauth/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.KICK_CLIENT_ID,
        client_secret: env.KICK_CLIENT_SECRET,
        token,
        token_hint_type: tokenTypeHint
      })
    });
  } catch {
    // best-effort cleanup only
  }
}

async function kickValidAccessToken(env) {
  const token = await getToken(env, 'kick');
  if (!token) return null;
  if (token.expires_at && Date.now() / 1000 < token.expires_at - 60) {
    return token.access_token;
  }
  if (!token.refresh_token) return token.access_token;
  const refreshed = await kickRefresh(env, token.refresh_token);
  const updated = {
    ...token,
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || token.refresh_token,
    expires_at: Date.now() / 1000 + refreshed.expires_in
  };
  await saveToken(env, 'kick', updated);
  return updated.access_token;
}

async function verifyKickSignature(request, rawBody) {
  const messageId = request.headers.get('Kick-Event-Message-Id') || '';
  const timestamp = request.headers.get('Kick-Event-Message-Timestamp') || '';
  const signatureB64 = request.headers.get('Kick-Event-Signature') || '';
  if (!signatureB64) return false;

  try {
    const key = await getKickPublicKey();
    const enc = new TextEncoder();
    const message = enc.encode(`${messageId}.${timestamp}.${rawBody}`);
    const signature = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0));
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, message);
  } catch {
    return false;
  }
}

async function kickBan(env, targetUserId, durationMinutes, reason) {
  const token = await kickValidAccessToken(env);
  const self = await getToken(env, 'kick');
  const body = { broadcaster_user_id: self.user_id, user_id: targetUserId, reason: reason || '' };
  if (durationMinutes) body.duration = durationMinutes;
  const res = await fetch('https://api.kick.com/public/v1/moderation/bans', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

async function kickDeleteMessage(env, messageId) {
  const token = await kickValidAccessToken(env);
  const res = await fetch(`https://api.kick.com/public/v1/chat/${messageId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  return { ok: res.ok, status: res.status };
}

// ---------- HTTP handlers ----------

export async function handleAuthStart(request, env, platform) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);

  const state = randomString(24);
  const headers = new Headers();

  if (platform === 'twitch') {
    headers.append('Set-Cookie', `oauth_state=${state}; Path=/api/auth/twitch; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    headers.set('Location', twitchAuthorizeUrl(env, state));
  } else {
    const verifier = randomString(64);
    const challenge = await pkceChallengeFromVerifier(verifier);
    headers.append('Set-Cookie', `oauth_state=${state}; Path=/api/auth/kick; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    headers.append('Set-Cookie', `oauth_verifier=${verifier}; Path=/api/auth/kick; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    headers.set('Location', kickAuthorizeUrl(env, state, challenge));
  }

  return new Response(null, { status: 302, headers });
}

export async function handleAuthCallback(request, env, platform) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieHeader = request.headers.get('cookie') || '';
  const savedState = getCookieValue(cookieHeader, 'oauth_state');

  if (!code || !state || state !== savedState) {
    return Response.redirect(`${REDIRECT_BASE}/chat.html?error=state_mismatch`, 302);
  }

  try {
    if (platform === 'twitch') {
      const tokenData = await twitchExchangeCode(env, code);
      const self = await twitchGetSelf(env, tokenData.access_token);
      await saveToken(env, 'twitch', {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: Date.now() / 1000 + tokenData.expires_in,
        user_id: self.id,
        login: self.login,
        display_name: self.display_name
      });
      const sub = await pingTwitchSocket(env);
      if (!sub.ok) {
        return Response.redirect(
          `${REDIRECT_BASE}/chat.html?error=${encodeURIComponent('twitch socket connect failed: ' + JSON.stringify(sub.data))}`,
          302
        );
      }
    } else {
      const verifier = getCookieValue(cookieHeader, 'oauth_verifier');
      const tokenData = await kickExchangeCode(env, code, verifier);
      const self = await kickGetSelf(tokenData.access_token);
      await saveToken(env, 'kick', {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: Date.now() / 1000 + tokenData.expires_in,
        user_id: self.user_id,
        name: self.name
      });
      const sub = await kickSubscribeChat(tokenData.access_token);
      if (!sub.ok) {
        return Response.redirect(
          `${REDIRECT_BASE}/chat.html?error=${encodeURIComponent('kick subscribe failed: ' + JSON.stringify(sub.data))}`,
          302
        );
      }
    }
  } catch (err) {
    return Response.redirect(`${REDIRECT_BASE}/chat.html?error=${encodeURIComponent(String(err.message || err))}`, 302);
  }

  return Response.redirect(`${REDIRECT_BASE}/chat.html?connected=${platform}`, 302);
}

export async function handleDisconnect(request, env, platform) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  if (platform !== 'twitch' && platform !== 'kick') return json({ error: 'unknown platform' }, 400);

  const token = await getToken(env, platform);
  if (!token) return json({ ok: true });

  if (platform === 'twitch') {
    if (env.TWITCH_SOCKET) {
      const id = env.TWITCH_SOCKET.idFromName('main');
      await env.TWITCH_SOCKET.get(id).fetch('https://twitch-socket.internal/disconnect');
    }
    await twitchRevoke(env, token.access_token);
  } else {
    try {
      const accessToken = await kickValidAccessToken(env);
      const subs = await kickListSubscriptions(accessToken, token.user_id);
      const ids = subs.map((s) => s.id || s.subscription_id).filter(Boolean);
      await kickDeleteSubscriptions(accessToken, ids);
    } catch {
      // best-effort; still proceed to revoke + remove the local token below
    }
    await kickRevoke(env, token.access_token, 'access_token');
    if (token.refresh_token) await kickRevoke(env, token.refresh_token, 'refresh_token');
  }

  await env.COSMIK_KV.delete(`oauth:${platform}`);
  return json({ ok: true });
}

function buildTwitchContent(message) {
  if (!message.fragments || message.fragments.length === 0) return message.text;
  return message.fragments
    .map((f) => (f.type === 'emote' && f.emote ? `[emote:${f.emote.id}:${f.text}]` : f.text))
    .join('');
}

export async function handleTwitchWebhook(request, env, ctx) {
  const rawBody = await request.text();
  const messageType = request.headers.get('Twitch-Eventsub-Message-Type');

  if (!(await verifyTwitchSignature(env, request, rawBody))) {
    return new Response('invalid signature', { status: 403 });
  }

  const body = JSON.parse(rawBody);

  if (messageType === 'webhook_callback_verification') {
    return new Response(body.challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  if (messageType === 'notification' && body.subscription?.type === 'channel.chat.message') {
    const e = body.event;
    ctx.waitUntil(
      appendMessage(env, {
        id: e.message_id,
        platform: 'twitch',
        username: e.chatter_user_login,
        displayName: e.chatter_user_name,
        userId: e.chatter_user_id,
        color: e.color || null,
        content: buildTwitchContent(e.message),
        timestamp: new Date().toISOString()
      })
    );
  }

  return new Response(null, { status: 204 });
}

export async function handleKickWebhook(request, env, ctx) {
  const rawBody = await request.text();
  const eventType = request.headers.get('Kick-Event-Type');

  if (!(await verifyKickSignature(request, rawBody))) {
    return new Response('invalid signature', { status: 403 });
  }

  if (eventType === 'chat.message.sent') {
    const e = JSON.parse(rawBody);
    ctx.waitUntil(
      appendMessage(env, {
        id: e.message_id,
        platform: 'kick',
        username: e.sender.username,
        displayName: e.sender.username,
        userId: e.sender.user_id,
        color: e.sender.identity?.username_color || null,
        content: e.content,
        timestamp: e.created_at || new Date().toISOString()
      })
    );
  }

  return new Response(null, { status: 204 });
}

export async function handleChatRecent(request, env) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  const messages = await getRecentMessages(env);
  return json({ messages });
}

export async function handleChatSocket(request, env) {
  if (!(await requireSession(request, env))) return new Response('unauthorized', { status: 401 });
  if (!env.CHAT_ROOM) return new Response('not configured', { status: 500 });
  return getChatRoom(env).fetch(request);
}

async function getTwitchViewers(env, accessToken) {
  try {
    const res = await fetch('https://api.twitch.tv/helix/streams?user_login=C0smiik', {
      headers: { 'Client-Id': env.TWITCH_CLIENT_ID, Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data && data.data[0] ? data.data[0].viewer_count : null;
  } catch {
    return null;
  }
}

async function getKickViewers() {
  try {
    const res = await fetch('https://kick.com/api/v2/channels/cosmik', {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.livestream ? data.livestream.viewer_count : null;
  } catch {
    return null;
  }
}

export async function handleChatStatus(request, env) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  const [twitch, kick] = await Promise.all([getToken(env, 'twitch'), getToken(env, 'kick')]);
  const [twitchViewers, kickViewers] = await Promise.all([
    twitch ? getTwitchViewers(env, twitch.access_token) : null,
    kick ? getKickViewers() : null
  ]);

  return json({
    twitch: twitch ? { connected: true, login: twitch.login, viewers: twitchViewers } : { connected: false },
    kick: kick ? { connected: true, name: kick.name, viewers: kickViewers } : { connected: false }
  });
}

export async function handleTwitchSocketStatus(request, env) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  if (!env.TWITCH_SOCKET) return json({ error: 'TWITCH_SOCKET binding missing' }, 500);

  const id = env.TWITCH_SOCKET.idFromName('main');
  await env.TWITCH_SOCKET.get(id).fetch('https://twitch-socket.internal/');
  const res = await env.TWITCH_SOCKET.get(id).fetch('https://twitch-socket.internal/status');
  return json(await res.json());
}

export async function handleChatModerate(request, env) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid body' }, 400);
  }

  const { platform, action, userId, messageId, durationMinutes, reason } = body || {};

  if (platform !== 'twitch' && platform !== 'kick') {
    return json({ error: 'unknown platform' }, 400);
  }

  const existingToken = await getToken(env, platform);
  if (!existingToken) {
    return json({ error: `${platform} is not connected yet` }, 400);
  }

  try {
    if (platform === 'twitch') {
      if (action === 'delete') return json(await twitchDeleteMessage(env, messageId));
      const durationSeconds = action === 'timeout' ? Math.round((durationMinutes || 10) * 60) : undefined;
      return json(await twitchBan(env, userId, durationSeconds, reason));
    }

    if (platform === 'kick') {
      if (action === 'delete') return json(await kickDeleteMessage(env, messageId));
      const duration = action === 'timeout' ? (durationMinutes || 10) : undefined;
      return json(await kickBan(env, userId, duration, reason));
    }

    return json({ error: 'unknown platform' }, 400);
  } catch (err) {
    return json({ error: String(err.message || err) }, 502);
  }
}
