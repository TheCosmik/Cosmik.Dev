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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/login') {
      return handleLogin(request, env);
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
