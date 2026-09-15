async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signSessionToken(secret, expiry) {
  return hmacSha256Hex(secret, String(expiry));
}

export async function verifySessionToken(token, secret) {
  if (!token || !secret) return false;
  const [expiryStr, signature] = token.split('.');
  const expiry = Number(expiryStr);
  if (!expiry || !signature || Date.now() / 1000 > expiry) return false;

  const expectedHex = await hmacSha256Hex(secret, expiryStr);
  return expectedHex === signature;
}

export async function timingSafeStringEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(String(a))),
    crypto.subtle.digest('SHA-256', enc.encode(String(b)))
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

export function getCookieValue(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

export async function requireSession(request, env) {
  const cookieHeader = request.headers.get('cookie') || '';
  const token = getCookieValue(cookieHeader, 'site_auth');
  return Boolean(env.SESSION_SECRET && (await verifySessionToken(token, env.SESSION_SECRET)));
}
