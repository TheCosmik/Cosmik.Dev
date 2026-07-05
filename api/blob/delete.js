import { del } from '@vercel/blob';
import { verifySessionToken, getCookieValue } from '../../lib/verify-session.js';

export default async function handler(request) {
  const cookie = request.headers.get('cookie') || '';
  const token = getCookieValue(cookie, 'site_auth');
  const valid = await verifySessionToken(token, process.env.SESSION_SECRET);

  if (!valid) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await request.json();
  const pathname = body && body.pathname;

  if (!pathname) {
    return Response.json({ error: 'Missing pathname' }, { status: 400 });
  }

  await del(pathname);

  return Response.json({ ok: true });
}
