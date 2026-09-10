// server/auth.js
const crypto = require('crypto');

function checkPasscode(input, expected) {
  if (typeof input !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function requireSession(req, res, next) {
  if (req.signedCookies && req.signedCookies.session === 'ok') return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

module.exports = { checkPasscode, requireSession };
