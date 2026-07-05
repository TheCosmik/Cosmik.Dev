const crypto = require('crypto');

function verifySessionToken(token, secret) {
  if (!token || !secret) return false;
  const [expiryStr, signature] = token.split('.');
  const expiry = Number(expiryStr);
  if (!expiry || !signature || Date.now() / 1000 > expiry) return false;

  const expectedHex = crypto.createHmac('sha256', secret).update(expiryStr).digest('hex');

  const a = Buffer.from(expectedHex);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

function getCookieValue(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

module.exports = { verifySessionToken, getCookieValue };
