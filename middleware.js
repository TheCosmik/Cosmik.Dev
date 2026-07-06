import { verifySessionToken, getCookieValue } from './lib/verify-session.js';

export const config = {
  matcher: ['/home.html']
};

export default async function middleware(request) {
  const secret = process.env.SESSION_SECRET;
  const cookieHeader = request.headers.get('cookie') || '';
  const token = getCookieValue(cookieHeader, 'site_auth');

  if (secret && (await verifySessionToken(token, secret))) {
    return;
  }

  return Response.redirect(new URL('/', request.url), 302);
}
