export const config = {
  matcher: ['/home.html']
};

async function isValidToken(token, secret) {
  if (!token) return false;
  const [expiryStr, signature] = token.split('.');
  const expiry = Number(expiryStr);
  if (!expiry || !signature || Date.now() / 1000 > expiry) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(expiryStr));
  const expectedHex = [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');

  return expectedHex === signature;
}

export default async function middleware(request) {
  const secret = process.env.SESSION_SECRET;
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(/(?:^|;\s*)site_auth=([^;]+)/);
  const token = match ? match[1] : null;

  if (secret && (await isValidToken(token, secret))) {
    return;
  }

  return Response.redirect(new URL('/', request.url), 302);
}
