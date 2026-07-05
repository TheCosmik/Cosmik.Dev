const { Readable } = require('stream');
const { get } = require('@vercel/blob');
const { verifySessionToken, getCookieValue } = require('../../lib/verify-session-node.js');

module.exports = async function handler(req, res) {
  try {
    const token = getCookieValue(req.headers.cookie, 'site_auth');
    const valid = verifySessionToken(token, process.env.SESSION_SECRET);

    if (!valid) {
      res.status(401).send('Not authenticated');
      return;
    }

    const pathname = req.query.path;

    if (!pathname) {
      res.status(400).json({ error: 'Missing path' });
      return;
    }

    const result = await get(pathname, { access: 'private' });

    if (!result || result.statusCode !== 200) {
      res.status(404).send('Not found');
      return;
    }

    const filename = pathname.split('/').pop();

    res.setHeader('Content-Type', result.blob.contentType || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');

    Readable.fromWeb(result.stream).pipe(res);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
