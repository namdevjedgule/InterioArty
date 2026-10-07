// Admin sign-in. POST {password} signs in, DELETE signs out, GET reports state.
// Same-origin only: no CORS headers are set.
const auth = require('../lib/admin-auth');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    res.status(200).json({ configured: auth.configured(), authed: auth.isAuthed(req) });
    return;
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', auth.clearedCookie(req));
    res.status(200).json({ ok: true });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!auth.configured()) {
    res.status(503).json({ error: 'Admin password is not configured on the server.' });
    return;
  }
  if (auth.tooManyAttempts(req)) {
    res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    return;
  }

  const password = req.body && req.body.password;
  if (!auth.checkPassword(password)) {
    auth.recordFailure(req);
    await sleep(400);
    res.status(401).json({ error: 'Wrong password.' });
    return;
  }

  auth.clearFailures(req);
  res.setHeader('Set-Cookie', auth.sessionCookie(req));
  res.status(200).json({ ok: true });
};
