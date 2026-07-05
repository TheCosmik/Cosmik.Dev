const crypto = require('crypto');

const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7; // 7 days

function timingSafeStringEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function signToken(secret, expiry) {
  return crypto.createHmac('sha256', secret).update(String(expiry)).digest('hex');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const expectedPassword = process.env.SITE_PASSWORD;
  const sessionSecret = process.env.SESSION_SECRET;

  if (!expectedPassword || !sessionSecret) {
    res.status(500).json({ error: 'Server not configured' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const password = body && body.password;

  if (!password || !timingSafeStringEqual(password, expectedPassword)) {
    res.status(401).json({ ok: false });
    return;
  }

  const expiry = Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS;
  const signature = signToken(sessionSecret, expiry);
  const token = `${expiry}.${signature}`;

  res.setHeader(
    'Set-Cookie',
    `site_auth=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DURATION_SECONDS}`
  );
  res.status(200).json({ ok: true });
};
