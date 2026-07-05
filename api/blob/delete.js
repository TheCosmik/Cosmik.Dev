const { del } = require('@vercel/blob');
const { verifySessionToken, getCookieValue } = require('../../lib/verify-session-node.js');

module.exports = async function handler(req, res) {
  try {
    const token = getCookieValue(req.headers.cookie, 'site_auth');
    const valid = verifySessionToken(token, process.env.SESSION_SECRET);

    if (!valid) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const pathname = req.body && req.body.pathname;

    if (!pathname) {
      res.status(400).json({ error: 'Missing pathname' });
      return;
    }

    await del(pathname);

    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
