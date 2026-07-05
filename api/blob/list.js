const { list } = require('@vercel/blob');
const { verifySessionToken, getCookieValue } = require('../../lib/verify-session-node.js');

module.exports = async function handler(req, res) {
  try {
    const token = getCookieValue(req.headers.cookie, 'site_auth');
    const valid = verifySessionToken(token, process.env.SESSION_SECRET);

    if (!valid) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { blobs } = await list();

    const files = blobs
      .map((b) => ({
        pathname: b.pathname,
        size: b.size,
        uploadedAt: b.uploadedAt
      }))
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    res.status(200).json({ files });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
