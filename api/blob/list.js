import { list } from '@vercel/blob';
import { verifySessionToken, getCookieValue } from '../../lib/verify-session-node.js';

export default async function handler(request) {
  console.log('[blob/list] handler start');
  try {
    const cookie = request.headers.get('cookie') || '';
    const token = getCookieValue(cookie, 'site_auth');
    const valid = verifySessionToken(token, process.env.SESSION_SECRET);
    console.log('[blob/list] auth valid:', valid);

    if (!valid) {
      return Response.json({ error: 'Not authenticated' }, { status: 401 });
    }

    console.log('[blob/list] env check', {
      hasReadWriteToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      hasOidcToken: Boolean(process.env.VERCEL_OIDC_TOKEN),
      hasStoreId: Boolean(process.env.BLOB_STORE_ID)
    });

    console.log('[blob/list] calling list()');
    const { blobs } = await list({ abortSignal: AbortSignal.timeout(8000) });
    console.log('[blob/list] list() returned', blobs.length, 'blobs');

    const files = blobs
      .map((b) => ({
        pathname: b.pathname,
        size: b.size,
        uploadedAt: b.uploadedAt
      }))
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    return Response.json({ files });
  } catch (error) {
    console.log('[blob/list] caught error:', error.name, error.message);
    return Response.json({ error: error.message, name: error.name }, { status: 500 });
  }
}
