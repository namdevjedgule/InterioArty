// Single shared admin password (ADMIN_PASSWORD) with a signed, expiring,
// HttpOnly session cookie. No user database. Changing the password signs
// every existing session out, because the signing key is derived from it.
const crypto = require('crypto');

const COOKIE = 'ia_admin';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;

const attempts = new Map();

function configured() {
  return Boolean(process.env.ADMIN_PASSWORD);
}

function signingKey() {
  return (
    process.env.ADMIN_SESSION_SECRET ||
    crypto.createHash('sha256').update('interioarty-session:' + process.env.ADMIN_PASSWORD).digest('hex')
  );
}

function sign(payload) {
  return crypto.createHmac('sha256', signingKey()).update(payload).digest('hex');
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function checkPassword(input) {
  return configured() && typeof input === 'string' && safeEqual(input, process.env.ADMIN_PASSWORD);
}

function clientIp(req) {
  const fwd = String((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim();
  return fwd || (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Best-effort brute-force guard. State is per warm serverless instance, so
// this slows guessing rather than hard-stopping it; use a long password.
function tooManyAttempts(req) {
  const entry = attempts.get(clientIp(req));
  return Boolean(entry && entry.resetAt > Date.now() && entry.count >= MAX_ATTEMPTS);
}

function recordFailure(req) {
  const ip = clientIp(req);
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt <= Date.now()) attempts.set(ip, { count: 1, resetAt: Date.now() + WINDOW_MS });
  else entry.count += 1;
}

function clearFailures(req) {
  attempts.delete(clientIp(req));
}

function isHttps(req) {
  return String((req.headers && req.headers['x-forwarded-proto']) || '').includes('https');
}

function sessionCookie(req) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = String(expires);
  const value = payload + '.' + sign(payload);
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${isHttps(req) ? '; Secure' : ''}`;
}

function clearedCookie(req) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isHttps(req) ? '; Secure' : ''}`;
}

function isAuthed(req) {
  if (!configured()) return false;
  const header = (req.headers && req.headers.cookie) || '';
  const match = header.split(';').map((p) => p.trim()).find((p) => p.startsWith(COOKIE + '='));
  if (!match) return false;
  const value = match.slice(COOKIE.length + 1);
  const dot = value.indexOf('.');
  if (dot < 1) return false;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!/^\d+$/.test(payload) || Number(payload) < Date.now() / 1000) return false;
  return safeEqual(sig, sign(payload));
}

module.exports = {
  configured, checkPassword, tooManyAttempts, recordFailure, clearFailures,
  sessionCookie, clearedCookie, isAuthed, clientIp,
};
