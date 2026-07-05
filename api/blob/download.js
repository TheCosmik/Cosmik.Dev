import { get } from '@vercel/blob';
import { verifySessionToken, getCookieValue } from '../../lib/verify-session-node.js';

export default async function handler(request) {
  try {
    const cookie = request.headers.get('cookie') || '';
    const token = getCookieValue(cookie, 'site_auth');
    const valid = verifySessionToken(token, process.env.SESSION_SECRET);

    if (!valid) {
      return new Response('Not authenticated', { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const pathname = searchParams.get('path');

    if (!pathname) {
      return Response.json({ error: 'Missing path' }, { status: 400 });
    }

    const result = await get(pathname, { access: 'private' });

    if (!result || result.statusCode !== 200) {
      return new Response('Not found', { status: 404 });
    }

    const filename = pathname.split('/').pop();

    return new Response(result.stream, {
      headers: {
        'Content-Type': result.blob.contentType || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
