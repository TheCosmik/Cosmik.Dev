import {
  signSessionToken,
  verifySessionToken,
  timingSafeStringEqual,
  getCookieValue
} from '../lib/verify-session.js';

const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7; // 7 days

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

async function handleLogin(request, env) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
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
    return json({ ok: false }, 401);
  }

  const expiry = Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS;
  const signature = await signSessionToken(sessionSecret, expiry);
  const token = `${expiry}.${signature}`;

  return json(
    { ok: true },
    200,
    {
      'Set-Cookie': `site_auth=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DURATION_SECONDS}`
    }
  );
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

async function getTwitchLive(env) {
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) return false;
  const token = await getTwitchToken(env);
  if (!token) return false;

  try {
    const res = await fetch('https://api.twitch.tv/helix/streams?user_login=C0smiik', {
      headers: { 'Client-Id': env.TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Array.isArray(data.data) && data.data.length > 0;
  } catch {
    return false;
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

    if (url.pathname === '/api/status') {
      return handleStatus(request, env, ctx);
    }

    if (url.pathname === '/api/repo-stats') {
      return handleRepoStats(request, env, ctx);
    }

    if (url.pathname === '/home.html') {
      const cookieHeader = request.headers.get('cookie') || '';
      const token = getCookieValue(cookieHeader, 'site_auth');
      const valid = env.SESSION_SECRET && (await verifySessionToken(token, env.SESSION_SECRET));
      if (!valid) {
        return Response.redirect(`${url.origin}/`, 302);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
