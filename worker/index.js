import {
  signSessionToken,
  verifySessionToken,
  timingSafeStringEqual,
  getCookieValue
} from '../lib/verify-session.js';
import {
  handleAuthStart,
  handleAuthCallback,
  handleDisconnect,
  handleTwitchWebhook,
  handleKickWebhook,
  handleChatRecent,
  handleChatStatus,
  handleChatModerate,
  handleTwitchSocketStatus,
  handleChatSocket,
  handleOverlayUrl,
  hasOverlayKey
} from './chat.js';
import {
  handleFinanceList,
  handleFinanceAdd,
  handleFinanceUpdate,
  handleFinanceDelete
} from './finance.js';
import {
  handleStorageState,
  handleFolderCreate,
  handleFolderRename,
  handleFolderDelete,
  handleFileEdit,
  handleFileDelete,
  handleUploadInit,
  handleUploadPartUrl,
  handleUploadComplete,
  handleUploadAbort,
  handleUploadProxy,
  handleDownloadUrl,
  handlePreviewUrl,
  handleDownloadProxy,
  handlePreviewProxy,
  cleanupStalePendingUploads
} from './storage.js';
import { handleStreamCurrent, handleStreamHistory, handleStreamSession } from './stream.js';
export { StreamStats } from './stream-stats.js';
export { TwitchChatSocket } from './twitch-socket.js';
export { ChatRoom } from './chat-room.js';
export { FinanceStore } from './finance-store.js';
export { StorageIndex } from './storage-index.js';

const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7; // 7 days
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_SECONDS = 300; // 5 minutes
const TRACKED_LINKS = ['kick', 'twitch', 'x', 'discord'];
const GATED_PAGES = new Set(['home', 'projects', 'chat', 'chat-popout', 'finance', 'storage']);

// Cloudflare's asset serving resolves clean URLs (e.g. /chat) straight to
// their .html file, so the gate has to recognize every spelling a request
// could arrive as, not just the literal "/chat.html" path.
function gatedPageName(pathname) {
  let name = pathname.replace(/^\/+|\/+$/g, '');
  if (name.endsWith('.html')) name = name.slice(0, -5);
  return name;
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

async function getLoginFailCount(env, ip) {
  if (!env.COSMIK_KV) return 0;
  const raw = await env.COSMIK_KV.get(`login-fail:${ip}`);
  return raw ? parseInt(raw, 10) : 0;
}

async function recordLoginFailure(env, ip, count) {
  if (!env.COSMIK_KV) return;
  await env.COSMIK_KV.put(`login-fail:${ip}`, String(count + 1), {
    expirationTtl: LOGIN_WINDOW_SECONDS
  });
}

async function clearLoginFailures(env, ip) {
  if (!env.COSMIK_KV) return;
  await env.COSMIK_KV.delete(`login-fail:${ip}`);
}

async function handleLogin(request, env) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const failCount = await getLoginFailCount(env, ip);
  if (failCount >= LOGIN_MAX_ATTEMPTS) {
    return json({ ok: false, error: 'rate_limited' }, 429);
  }

  const expectedPassword = env.SITE_PASSWORD;
  const sessionSecret = env.SESSION_SECRET;
  if (!expectedPassword || !sessionSecret) {
    return json({ error: 'Server not configured' }, 500);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const password = body && body.password;
  if (!password || !(await timingSafeStringEqual(password, expectedPassword))) {
    await recordLoginFailure(env, ip, failCount);
    return json({ ok: false }, 401);
  }

  await clearLoginFailures(env, ip);

  const expiry = Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS;
  const signature = await signSessionToken(sessionSecret, expiry);
  const token = `${expiry}.${signature}`;

  return json(
    { ok: true },
    200,
    {
      // No Max-Age/Expires: this is a session cookie so closing the browser
      // ends access. The signed token still carries its own expiry as a
      // backstop for browsers that restore sessions across a restart.
      'Set-Cookie': `site_auth=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`
    }
  );
}

function handleLogout(request) {
  const origin = new URL(request.url).origin;
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${origin}/`,
      'Cache-Control': 'no-store',
      'Set-Cookie': 'site_auth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
    }
  });
}

async function handleClick(request, env) {
  if (request.method !== 'POST' || !env.COSMIK_KV) {
    return json({ ok: false }, 405);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const link = body && body.link;
  if (!TRACKED_LINKS.includes(link)) {
    return json({ ok: false }, 400);
  }

  const key = `clicks:${link}`;
  const current = parseInt((await env.COSMIK_KV.get(key)) || '0', 10);
  await env.COSMIK_KV.put(key, String(current + 1));
  return json({ ok: true });
}

async function handleClickStats(request, env) {
  const cookieHeader = request.headers.get('cookie') || '';
  const token = getCookieValue(cookieHeader, 'site_auth');
  const valid = env.SESSION_SECRET && (await verifySessionToken(token, env.SESSION_SECRET));
  if (!valid) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!env.COSMIK_KV) {
    return json({ error: 'not configured' }, 500);
  }

  const stats = {};
  for (const link of TRACKED_LINKS) {
    stats[link] = parseInt((await env.COSMIK_KV.get(`clicks:${link}`)) || '0', 10);
  }
  return json(stats);
}

async function getKickLive() {
  try {
    const res = await fetch('https://kick.com/api/v2/channels/cosmik', {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data && data.livestream);
  } catch {
    return false;
  }
}

async function getTwitchToken(env) {
  try {
    const res = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.TWITCH_CLIENT_ID,
        client_secret: env.TWITCH_CLIENT_SECRET,
        grant_type: 'client_credentials'
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.access_token || null;
  } catch {
    return null;
  }
}

// Returns { ok, live, viewers, title }. ok:false means "couldn't tell" (API
// error), which callers must not confuse with "offline" -- treating a blip as
// offline would end a stream early or re-announce it as newly live.
async function getTwitchInfo(env) {
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) return { ok: false, live: false };
  const token = await getTwitchToken(env);
  if (!token) return { ok: false, live: false };

  try {
    const res = await fetch('https://api.twitch.tv/helix/streams?user_login=C0smiik', {
      headers: { 'Client-Id': env.TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return { ok: false, live: false };
    const data = await res.json();
    const stream = Array.isArray(data.data) ? data.data[0] : null;
    return stream
      ? { ok: true, live: true, viewers: stream.viewer_count || 0, title: stream.title || null }
      : { ok: true, live: false };
  } catch {
    return { ok: false, live: false };
  }
}

async function getTwitchLive(env) {
  return (await getTwitchInfo(env)).live;
}

async function getKickInfo() {
  try {
    const res = await fetch('https://kick.com/api/v2/channels/cosmik', {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }
    });
    if (!res.ok) return { ok: false, live: false };
    const data = await res.json();
    const stream = data && data.livestream;
    return stream
      ? {
          ok: true,
          live: true,
          viewers: stream.viewer_count || 0,
          title: stream.session_title || null,
          thumbnailUrl: stream.thumbnail?.url || null
        }
      : { ok: true, live: false };
  } catch {
    return { ok: false, live: false };
  }
}

async function runLiveChecks(env, ctx) {
  const [kick, twitch] = await Promise.all([getKickInfo(), getTwitchInfo(env)]);

  if (env.STREAM_STATS) {
    const id = env.STREAM_STATS.idFromName('main');
    ctx.waitUntil(
      env.STREAM_STATS.get(id).fetch('https://stream-stats.internal/tick', {
        method: 'POST',
        body: JSON.stringify({ now: Date.now(), kick, twitch })
      })
    );
  }

  await notifyLive(env, ctx, kick, twitch);
}

async function notifyLive(env, ctx, kick, twitch) {
  if (!env.DISCORD_WEBHOOK_URL || !env.COSMIK_KV) return;

  const platforms = [
    { key: 'kick', ok: kick.ok, live: kick.live, thumbnailUrl: kick.thumbnailUrl || null },
    {
      key: 'twitch',
      ok: twitch.ok,
      live: twitch.live,
      thumbnailUrl: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_c0smiik-440x248.jpg'
    }
  ];

  for (const platform of platforms) {
    if (!platform.ok) continue;
    const kvKey = `live_state:${platform.key}`;
    const wasLive = (await env.COSMIK_KV.get(kvKey)) === '1';
    if (platform.live && !wasLive) {
      const embed = {
        title: 'Cosmik just went live!',
        url: 'https://cosmik.dev',
        color: 0xed4245,
        thumbnail: platform.thumbnailUrl ? { url: platform.thumbnailUrl } : undefined
      };
      ctx.waitUntil(
        fetch(env.DISCORD_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: '@everyone', embeds: [embed] })
        })
      );
    }
    if (platform.live !== wasLive) {
      ctx.waitUntil(env.COSMIK_KV.put(kvKey, platform.live ? '1' : '0'));
    }
  }
}

async function handleStatus(request, env, ctx) {
  const cache = caches.default;
  const cacheKey = new Request('https://cache.internal/status');
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const [kick, twitch] = await Promise.all([getKickLive(), getTwitchLive(env)]);
  const result = json({ kick, twitch });
  result.headers.set('Cache-Control', 'public, max-age=60');
  ctx.waitUntil(cache.put(cacheKey, result.clone()));
  return result;
}

async function handleRepoStats(request, env, ctx) {
  const url = new URL(request.url);
  const repo = url.searchParams.get('repo');
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return json({ error: 'invalid repo' }, 400);
  }

  const cache = caches.default;
  const cacheKey = new Request(`https://cache.internal/repo-stats/${repo}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const ghRes = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: { 'User-Agent': 'cosmikdev-worker', Accept: 'application/vnd.github+json' }
    });
    if (!ghRes.ok) return json({ error: 'not found' }, ghRes.status);

    const data = await ghRes.json();
    const result = json({
      stars: data.stargazers_count,
      updatedAt: data.pushed_at
    });
    result.headers.set('Cache-Control', 'public, max-age=600');
    ctx.waitUntil(cache.put(cacheKey, result.clone()));
    return result;
  } catch {
    return json({ error: 'upstream error' }, 502);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/login') {
      return handleLogin(request, env);
    }

    if (url.pathname === '/api/logout') {
      return handleLogout(request);
    }

    if (url.pathname === '/api/status') {
      return handleStatus(request, env, ctx);
    }

    if (url.pathname === '/api/repo-stats') {
      return handleRepoStats(request, env, ctx);
    }

    if (url.pathname === '/api/click') {
      return handleClick(request, env);
    }

    if (url.pathname === '/api/click-stats') {
      return handleClickStats(request, env);
    }

    if (url.pathname === '/api/auth/twitch/start') {
      return handleAuthStart(request, env, 'twitch');
    }

    if (url.pathname === '/api/auth/twitch/callback') {
      return handleAuthCallback(request, env, 'twitch');
    }

    if (url.pathname === '/api/auth/twitch/disconnect') {
      return handleDisconnect(request, env, 'twitch');
    }

    if (url.pathname === '/api/auth/kick/start') {
      return handleAuthStart(request, env, 'kick');
    }

    if (url.pathname === '/api/auth/kick/callback') {
      return handleAuthCallback(request, env, 'kick');
    }

    if (url.pathname === '/api/auth/kick/disconnect') {
      return handleDisconnect(request, env, 'kick');
    }

    if (url.pathname === '/api/webhooks/twitch') {
      return handleTwitchWebhook(request, env, ctx);
    }

    if (url.pathname === '/api/webhooks/kick') {
      return handleKickWebhook(request, env, ctx);
    }

    if (url.pathname === '/api/chat/recent') {
      return handleChatRecent(request, env);
    }

    if (url.pathname === '/api/chat/status') {
      return handleChatStatus(request, env);
    }

    if (url.pathname === '/api/chat/moderate') {
      return handleChatModerate(request, env);
    }

    if (url.pathname === '/api/chat/twitch-socket-status') {
      return handleTwitchSocketStatus(request, env);
    }

    if (url.pathname === '/api/stream/current') {
      return handleStreamCurrent(request, env);
    }

    if (url.pathname === '/api/stream/history') {
      return handleStreamHistory(request, env);
    }

    if (url.pathname === '/api/stream/session') {
      return handleStreamSession(request, env);
    }

    if (url.pathname === '/api/chat/overlay-url') {
      return handleOverlayUrl(request, env);
    }

    if (url.pathname === '/api/chat/socket') {
      return handleChatSocket(request, env);
    }

    if (url.pathname === '/api/finance/list') {
      return handleFinanceList(request, env);
    }

    if (url.pathname === '/api/finance/add') {
      return handleFinanceAdd(request, env);
    }

    if (url.pathname === '/api/finance/update') {
      return handleFinanceUpdate(request, env);
    }

    if (url.pathname === '/api/finance/delete') {
      return handleFinanceDelete(request, env);
    }

    if (url.pathname === '/api/storage/state') {
      return handleStorageState(request, env);
    }

    if (url.pathname === '/api/storage/folders/create') {
      return handleFolderCreate(request, env);
    }

    if (url.pathname === '/api/storage/folders/rename') {
      return handleFolderRename(request, env);
    }

    if (url.pathname === '/api/storage/folders/delete') {
      return handleFolderDelete(request, env);
    }

    if (url.pathname === '/api/storage/files/edit') {
      return handleFileEdit(request, env);
    }

    if (url.pathname === '/api/storage/files/delete') {
      return handleFileDelete(request, env);
    }

    if (url.pathname === '/api/storage/upload/init') {
      return handleUploadInit(request, env);
    }

    if (url.pathname === '/api/storage/upload/part-url') {
      return handleUploadPartUrl(request, env);
    }

    if (url.pathname === '/api/storage/upload/complete') {
      return handleUploadComplete(request, env);
    }

    if (url.pathname === '/api/storage/upload/abort') {
      return handleUploadAbort(request, env);
    }

    if (url.pathname === '/api/storage/upload/proxy') {
      return handleUploadProxy(request, env);
    }

    if (url.pathname === '/api/storage/download/url') {
      return handleDownloadUrl(request, env);
    }

    if (url.pathname === '/api/storage/preview/url') {
      return handlePreviewUrl(request, env);
    }

    if (url.pathname === '/api/storage/download/proxy') {
      return handleDownloadProxy(request, env);
    }

    if (url.pathname === '/api/storage/preview/proxy') {
      return handlePreviewProxy(request, env);
    }

    const pageName = gatedPageName(url.pathname);
    if (GATED_PAGES.has(pageName)) {
      const cookieHeader = request.headers.get('cookie') || '';
      const token = getCookieValue(cookieHeader, 'site_auth');
      const valid = env.SESSION_SECRET && (await verifySessionToken(token, env.SESSION_SECRET));
      const overlayOk = !valid && pageName === 'chat-popout' && (await hasOverlayKey(url, env));
      if (!valid && !overlayOk) {
        return Response.redirect(`${url.origin}/`, 302);
      }
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    if (event.cron === '*/5 * * * *') {
      if (env.TWITCH_SOCKET) {
        const id = env.TWITCH_SOCKET.idFromName('main');
        ctx.waitUntil(env.TWITCH_SOCKET.get(id).fetch('https://twitch-socket.internal/'));
      }
      ctx.waitUntil(cleanupStalePendingUploads(env));
    }
    // Each cron trigger fires this handler separately, so live checks are
    // pinned to the every-minute one; otherwise they'd run twice (racing on
    // the Discord dedupe state) whenever the two schedules coincide.
    if (event.cron === '* * * * *') {
      ctx.waitUntil(runLiveChecks(env, ctx));
    }
  }
};
