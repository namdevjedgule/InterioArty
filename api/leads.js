// Public endpoint the chat widget posts qualified leads to, so they reach the
// studio's admin panel from any visitor on any device. Write-only: it never
// returns stored data.
const { parseLeadInput, mergeLead } = require('./lib/lead-record');
const store = require('./lib/store');
const { clientIp } = require('./lib/admin-auth');

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 120;
const hits = new Map();

// Per-IP cap, per warm instance (best effort).
function limited(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.resetAt <= now) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (limited(req)) {
    res.status(429).json({ error: 'Too many requests' });
    return;
  }

  const parsed = parseLeadInput(req.body);
  if (parsed.error) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  try {
    const existing = await store.getLead(parsed.record.cid);
    const merged = mergeLead(existing, parsed.record, new Date().toISOString());
    await store.putLead(merged.cid, merged);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('lead save failed:', err.message);
    res.status(err.message === 'storage_not_configured' ? 503 : 500).json({ error: 'Could not save lead' });
  }
};
