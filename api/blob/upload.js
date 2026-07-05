const { handleUpload } = require('@vercel/blob/client');
const { verifySessionToken, getCookieValue } = require('../../lib/verify-session-node.js');

module.exports = async function handler(req, res) {
  const body = req.body;

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        const token = getCookieValue(req.headers.cookie, 'site_auth');
        const valid = verifySessionToken(token, process.env.SESSION_SECRET);

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

    res.status(200).json(jsonResponse);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
