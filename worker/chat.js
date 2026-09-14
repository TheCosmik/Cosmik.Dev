import { getCookieValue, verifySessionToken } from '../lib/verify-session.js';

const REDIRECT_BASE = 'https://cosmik.dev';
const MAX_MESSAGES = 200;

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

async function requireSession(request, env) {
  const cookieHeader = request.headers.get('cookie') || '';
  const token = getCookieValue(cookieHeader, 'site_auth');
  return Boolean(env.SESSION_SECRET && (await verifySessionToken(token, env.SESSION_SECRET)));
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

// ---------- KV storage ----------

async function getToken(env, platform) {
  const raw = await env.COSMIK_KV.get(`oauth:${platform}`);
  return raw ? JSON.parse(raw) : null;
}

async function saveToken(env, platform, data) {
  await env.COSMIK_KV.put(`oauth:${platform}`, JSON.stringify(data));
}

async function appendMessage(env, message) {
  const raw = await env.COSMIK_KV.get('chat:messages');
  const list = raw ? JSON.parse(raw) : [];
  list.push(message);
  while (list.length > MAX_MESSAGES) list.shift();
  await env.COSMIK_KV.put('chat:messages', JSON.stringify(list));
}

async function getRecentMessages(env) {
  const raw = await env.COSMIK_KV.get('chat:messages');
  return raw ? JSON.parse(raw) : [];
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

async function twitchSubscribeChat(env, accessToken, userId) {
  const res = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': env.TWITCH_CLIENT_ID,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'channel.chat.message',
      version: '1',
      condition: { broadcaster_user_id: userId, user_id: userId },
      transport: {
        method: 'webhook',
        callback: `${REDIRECT_BASE}/api/webhooks/twitch`,
        secret: env.TWITCH_EVENTSUB_SECRET
      }
    })
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
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
      await twitchSubscribeChat(env, tokenData.access_token, self.id);
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
      await kickSubscribeChat(tokenData.access_token);
    }
  } catch (err) {
    return Response.redirect(`${REDIRECT_BASE}/chat.html?error=${encodeURIComponent(String(err.message || err))}`, 302);
  }

  return Response.redirect(`${REDIRECT_BASE}/chat.html?connected=${platform}`, 302);
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
        content: e.message.text,
        timestamp: new Date().toISOString()
      })
    );
  }

  return new Response('', { status: 204 });
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

  return new Response('', { status: 204 });
}

export async function handleChatRecent(request, env) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  const messages = await getRecentMessages(env);
  return json({ messages });
}

export async function handleChatStatus(request, env) {
  if (!(await requireSession(request, env))) return json({ error: 'unauthorized' }, 401);
  const [twitch, kick] = await Promise.all([getToken(env, 'twitch'), getToken(env, 'kick')]);
  return json({
    twitch: twitch ? { connected: true, login: twitch.login } : { connected: false },
    kick: kick ? { connected: true, name: kick.name } : { connected: false }
  });
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
