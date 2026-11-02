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

export function deriveKey(secret, label) {
  return hmacSha256Hex(secret, label);
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

// ---- Guest (watchlist-only) sessions -------------------------------------
// A second, lower-privilege login for the shared watchlist. Guest tokens are
// signed with a key derived from SESSION_SECRET *and* GUEST_PASSWORD, so:
//  - an owner token can never pass as a guest token (and vice versa),
//  - changing or removing GUEST_PASSWORD instantly invalidates every guest
//    session, with no effect on the owner's own session.
// requireSession() above is deliberately untouched: guests never satisfy it.

export const GUEST_COOKIE = 'guest_auth';

async function guestSecret(env) {
  if (!env.SESSION_SECRET || !env.GUEST_PASSWORD) return null;
  return deriveKey(env.SESSION_SECRET, `guest-session-v1|${env.GUEST_PASSWORD}`);
}

export async function signGuestToken(env, expiry) {
  const secret = await guestSecret(env);
  return secret ? `${expiry}.${await signSessionToken(secret, expiry)}` : null;
}

export async function hasGuestSession(request, env) {
  const secret = await guestSecret(env);
  if (!secret) return false;
  const token = getCookieValue(request.headers.get('cookie') || '', GUEST_COOKIE);
  return verifySessionToken(token, secret);
}

// For the few routes the shared watchlist needs: the owner or the guest.
export async function requireWatchlistAccess(request, env) {
  return (await requireSession(request, env)) || (await hasGuestSession(request, env));
}
