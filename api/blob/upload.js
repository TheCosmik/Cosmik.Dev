import { handleUpload } from '@vercel/blob/client';
import { verifySessionToken, getCookieValue } from '../../lib/verify-session.js';

export default async function handler(request) {
  const body = await request.json();

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const cookie = request.headers.get('cookie') || '';
        const token = getCookieValue(cookie, 'site_auth');
        const valid = await verifySessionToken(token, process.env.SESSION_SECRET);

        if (!valid) {
          throw new Error('Not authenticated');
        }

        return {
          access: 'private',
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ pathname })
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log('upload completed', blob.pathname);
      }
    });

    return Response.json(jsonResponse);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
}
