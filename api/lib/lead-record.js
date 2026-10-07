// Validation for lead records posted by the public chat widget. Everything is
// untrusted: the endpoint is open to the internet, so every field is coerced,
// trimmed and length-capped, and server-owned fields (status, notes,
// timestamps) can never be set from the request.
const CID_RE = /^[A-Za-z0-9-]{16,64}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const MAX_TRANSCRIPT_MESSAGES = 300;
const MAX_MESSAGE_CHARS = 2000;
const STATUSES = ['new', 'contacted', 'closed'];

// Drops control characters (keeps tab and newline), then trims and caps.
function clean(value, max) {
  if (typeof value !== 'string') return '';
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 9 || code === 10 || (code >= 32 && code !== 127)) out += value[i];
  }
  return out.trim().slice(0, max);
}

function cleanPhone(value) {
  const digits = clean(value, 40).replace(/[^\d+]/g, '');
  const count = digits.replace(/\D/g, '').length;
  return count >= 7 && count <= 15 ? digits.slice(0, 16) : '';
}

function cleanEmail(value) {
  const email = clean(value, 254);
  return EMAIL_RE.test(email) ? email : '';
}

function cleanTranscript(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_TRANSCRIPT_MESSAGES)
    .map((m) => ({ role: m.role, content: clean(m.content, MAX_MESSAGE_CHARS) }))
    .filter((m) => m.content);
}

// Returns { record } or { error }.
function parseLeadInput(body) {
  if (!body || typeof body !== 'object') return { error: 'invalid body' };
  const cid = typeof body.cid === 'string' ? body.cid : '';
  if (!CID_RE.test(cid)) return { error: 'invalid cid' };

  const record = {
    cid,
    name: clean(body.name, 80),
    phone: cleanPhone(body.phone),
    email: cleanEmail(body.email),
    projectType: clean(body.projectType, 60),
    bhk: clean(body.bhk, 40),
    location: clean(body.location, 120),
    budget: clean(body.budget, 80),
    timeline: clean(body.timeline, 80),
    summary: clean(body.summary, 1500),
    summarizing: body.summarizing === true,
    transcript: cleanTranscript(body.transcript),
  };
  if (!record.phone && !record.email) return { error: 'a phone number or email is required' };
  return { record };
}

// Applies an incoming record onto the stored one. Content fields take the new
// value when it is non-empty (a later sync never blanks a known detail), and
// server-owned fields are preserved.
function mergeLead(existing, incoming, nowIso) {
  const prev = existing || {};
  const merged = { source: 'Website Chatbot' };
  for (const field of ['name', 'phone', 'email', 'projectType', 'bhk', 'location', 'budget', 'timeline', 'summary']) {
    merged[field] = incoming[field] || prev[field] || '';
  }
  merged.cid = incoming.cid;
  merged.summarizing = incoming.summarizing;
  merged.transcript = incoming.transcript.length >= (prev.transcript || []).length ? incoming.transcript : prev.transcript;
  merged.status = STATUSES.includes(prev.status) ? prev.status : 'new';
  merged.notes = prev.notes || '';
  merged.createdAt = prev.createdAt || nowIso;
  merged.updatedAt = nowIso;
  return merged;
}

module.exports = { parseLeadInput, mergeLead, clean, STATUSES };
