import { list } from '@vercel/blob';
import { verifySessionToken, getCookieValue } from '../../lib/verify-session.js';

export default async function handler(request) {
  const cookie = request.headers.get('cookie') || '';
  const token = getCookieValue(cookie, 'site_auth');
  const valid = await verifySessionToken(token, process.env.SESSION_SECRET);

  if (!valid) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { blobs } = await list();

  const files = blobs
    .map((b) => ({
      pathname: b.pathname,
      size: b.size,
      uploadedAt: b.uploadedAt
    }))
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

  return Response.json({ files });
}
