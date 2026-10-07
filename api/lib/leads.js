const MAX_MESSAGES = 30;
const MAX_MESSAGE_LENGTH = 500;
const MAX_SUMMARY_LENGTH = 700;

// Past this many visitor messages, the model's rolling 12-message context
// window (see api/chat.js) has cycled through several times over and the
// raw-history-based reasoning becomes unreliable no matter how well it's
// prompted. This is a hard, code-owned threshold rather than something the
// model decides for itself.
const LONG_CONVERSATION_TURNS = 20;

function isLongConversation(userTurnCount) {
  return userTurnCount >= LONG_CONVERSATION_TURNS;
}

// Makes the client-supplied transcript safe before it ever reaches the LLM.
// The demo passed messages straight through, which let a visitor inject
// {role: 'system'} instructions. Here every message is coerced to a real
// user/assistant turn, system roles are dropped, lengths are capped and
// control characters are stripped.
function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return { error: 'messages array required', list: [] };
  if (messages.length === 0) return { error: 'messages array is empty', list: [] };
  if (messages.length > MAX_MESSAGES) return { error: `too many messages (max ${MAX_MESSAGES})`, list: [] };

  const list = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    if (typeof m.content !== 'string') continue;
    let content = m.content
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .trim();
    if (!content) continue;
    if (content.length > MAX_MESSAGE_LENGTH) {
      content = content.slice(0, MAX_MESSAGE_LENGTH);
    }
    list.push({ role, content });
  }
  return { error: null, list };
}

const PHONE_RE = /(?:\+?91[\s-]?)?(?:[6-9]\d{2}[\s-]?\d{3}[\s-]?\d{4}|[6-9]\d{4}[\s-]?\d{5})\b/;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;

// Common one-word replies that are not names, so a bare "yes" or "ok" answer
// to some other question never gets mistaken for a name.
const NON_NAME_WORDS = new Set([
  'yes', 'no', 'sure', 'ok', 'okay', 'yeah', 'yep', 'nope', 'maybe', 'thanks',
  'thankyou', 'hi', 'hello', 'hey', 'hmm', 'fine', 'good', 'great', 'cool',
  'home', 'office', 'flat', 'apartment', 'bungalow', 'villa', 'renovation',
  'not', 'really', 'just', 'still', 'trying', 'looking', 'planning', 'hoping',
  'excited', 'happy', 'sorry', 'afraid', 'certain', 'serious', 'kidding',
  'wondering', 'interested', 'curious', 'confused', 'unsure', 'ready',
]);

function capitalizeWord(w) {
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

function looksLikeBareName(text) {
  const t = text.trim();
  if (!t || t.length > 40) return false;
  if (!/^[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2}$/.test(t)) return false;
  const words = t.toLowerCase().split(/\s+/);
  if (words.some((w) => NON_NAME_WORDS.has(w))) return false;
  return true;
}

// Same idea as NON_NAME_WORDS, for the bare-reply city/location heuristic
// below: common short replies that are not place names.
const NON_LOCATION_WORDS = new Set([
  'yes', 'no', 'sure', 'ok', 'okay', 'yeah', 'yep', 'nope', 'maybe', 'thanks',
  'hi', 'hello', 'hey', 'hmm', 'fine', 'good', 'great', 'cool', 'not', 'sure',
  "don't", 'dont', "didn't", 'didnt', "haven't", 'havent', 'know', 'idk', 'decided',
  'decide', 'undecided', 'yet', 'later', 'tbd', 'unsure', 'whatever', 'anything',
  'skip', 'thinking',
  'anywhere', 'nowhere', 'somewhere', 'nearby', 'here', 'there',
]);

function looksLikeBareLocation(text) {
  if (/^(?:the|a|an|my|our|your|this|that)\b/i.test(String(text).trim())) return false;
  const t = text.trim();
  if (!t || t.length > 40) return false;
  if (!/^[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2}$/.test(t)) return false;
  const words = t.toLowerCase().split(/\s+/);
  if (words.some((w) => NON_LOCATION_WORDS.has(w))) return false;
  return true;
}

// Pulls a place name out of a visitor's reply to "which city or area?".
// Real answers are rarely a bare word: "Kharadi, Pune", "Kharadi, Pune.
// Budget around 18 lakh", "it's in Baner". Keep only the first clause (up to
// sentence punctuation or a trailing budget/"and" aside), drop a leading
// "it's in" style lead-in, flatten commas, then apply the same shape and
// stopword check used for bare replies.
function locationFromReply(text) {
  let t = String(text || '').replace(/[\u2018\u2019]/g, "'").split(/[.!?;\n]/)[0];
  t = t.split(/\b(?:budget|approx(?:imately)?|about|and|with)\b|\baround\s+(?:₹|rs\.?\s*|inr\s*)?\d/i)[0];
  t = t.replace(/^\s*(?:it'?s|its|it is|we are|we're|i am|i'm)?\s*(?:in|at|near|around|within|based in|located in)?\s+/i, '');
  t = t.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  if (!looksLikeBareLocation(t)) return null;
  return t.split(' ').map(capitalizeWord).join(' ');
}

// Quick regex pass over what the visitor actually typed. Only user-authored
// text is scanned (scanning assistant replies risks matching the studio's
// own listed phone number). Qualification requires name AND phone or email,
// which the system prompt nudges the assistant to collect.
//
// `messages` must include both roles (not just user turns): a bare one-word
// reply like "Asd" to "could I get your name?" only reads as a name because
// we can see what the assistant just asked.
function extractLead(rawMessages) {
  // iPhones type a curly apostrophe in "I'm Rajesh"; normalise so the name,
  // place and non-answer checks below all see a plain one.
  const messages = rawMessages.map((m) => ({ ...m, content: String(m.content).replace(/[\u2018\u2019]/g, "'") }));
  const userMsgs = messages.filter((m) => m.role === 'user');
  // Joined with ". " rather than a bare space: the two-word place-name
  // capture in the city regex below (for names like "Navi Mumbai") was
  // bridging across message boundaries when a plain space joined them, so
  // "...in Kharadi" immediately followed by "Around 15 lakh..." from the
  // NEXT message matched as the single place "Kharadi Around". A period
  // boundary stops the word-character regex from crossing between messages.
  const userText = userMsgs.map((m) => m.content).join('. ');

  // Indian mobile formats: 9876543210, 98765 43210, +91 98765 43210,
  // 987-654-3210. Two shapes: 3-3-4 and 5-5, with optional separators.
  const phoneMatch = userText.match(PHONE_RE);
  const emailMatch = userText.match(EMAIL_RE);
  // Deliberately NOT case-insensitive: with the /i flag, "[A-Z]" in the
  // capture group would also match a lowercase letter, so "I'm looking to
  // redo my apartment" would capture "looking" as a name (and did, in
  // testing). The trigger phrase is spelled out in both cases instead, so
  // only a genuinely capitalized word right after it can match.
  const nameMatch = userText.match(/\b(?:[Ii]'?m|[Ii] am|[Tt]his is|[Mm]y name is)\s+([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*){0,2})\b/);

  // Still run the candidate through the same shape/stopword check used for
  // bare-word replies below, so a sentence-initial capital on an ordinary
  // word ("I'm Sure that works", "I'm Not sure yet") can't slip through
  // just because it happened to be capitalized.
  let name = nameMatch && looksLikeBareName(nameMatch[1]) ? nameMatch[1].split(/\s+/).map(capitalizeWord).join(' ') : null;

  if (!name) {
    for (let i = 0; i < messages.length - 1; i++) {
      const m = messages[i];
      if (m.role !== 'assistant' || !/\bname\b/i.test(m.content)) continue;
      const next = messages[i + 1];
      if (
        next &&
        next.role === 'user' &&
        looksLikeBareName(next.content) &&
        !PHONE_RE.test(next.content) &&
        !EMAIL_RE.test(next.content)
      ) {
        name = next.content.trim().split(/\s+/).map(capitalizeWord).join(' ');
        break;
      }
    }
  }

  const phone = phoneMatch ? phoneMatch[0].replace(/[\s-]/g, '') : null;
  const email = emailMatch ? emailMatch[0] : null;

  // City/location: same "assistant asked, visitor gave a bare short reply"
  // heuristic used for names above, since city names are open-ended proper
  // nouns with no fixed vocabulary to regex-match directly (unlike BHK or
  // budget, which have a small, predictable shape).
  let city = null;
  for (let i = 0; i < messages.length - 1; i++) {
    const m = messages[i];
    if (m.role !== 'assistant' || !/\b(city|cities|location|locality|neighbou?rhood|which\s+area|what\s+area|area\s+(?:is|are)|where\s+(?:is|are)\s+(?:you|it|this|the|your))\b/i.test(m.content)) continue;
    const next = messages[i + 1];
    if (next && next.role === 'user' && !PHONE_RE.test(next.content) && !EMAIL_RE.test(next.content)) {
      const candidate = locationFromReply(next.content);
      if (candidate) {
        city = candidate;
        break;
      }
    }
  }
  // Fallback: an explicit "in/at/near <Place>" mention anywhere in the
  // visitor's own text (e.g. "I want it in Kharadi", "based in Mumbai").
  // Requires a capitalized word so it does not fire on "in the evening" or
  // "at some point".
  if (!city) {
    // Only statements count. A question that merely mentions a place ("Do you
    // only work in Pune?", "Can you do projects in Mumbai?") says nothing about
    // where the visitor's own project is, and the first value found is kept for
    // the whole chat, so it must not be taken as their city.
    const isQuestion = (sentence) =>
      /\?\s*$/.test(sentence) || /^\s*(?:do|does|did|can|could|are|is|will|would|how|what|which|where|when|why|have|has)\b/i.test(sentence);
    const statements = userMsgs.flatMap((m) => m.content.split(/(?<=[.!?])\s+/)).filter((sentence) => !isQuestion(sentence));
    for (const sentence of statements) {
      const cityMatch = sentence.match(/\b(?:in|at|near|based in|located in)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/);
      if (cityMatch && looksLikeBareLocation(cityMatch[1])) {
        city = cityMatch[1].split(/\s+/).map(capitalizeWord).join(' ');
        break;
      }
    }
  }

  // Soft, best-effort hints only, used to stop the assistant re-asking
  // things it already knows. The CRM's authoritative structured fields come
  // from /api/summarize-lead, which reasons over the whole transcript.
  const bhkMatch = userText.match(/\b([1-9])\s?-?\s?BHK\b/i);
  const budgetMatch = userText.match(/(?:₹|rs\.?|inr)?\s?(\d+(?:\.\d+)?)\s?(lakh|lac|crore|cr)s?\b/i);
  const projectTypeMatch = userText.match(/\b(bungalow|villa|office|renovation|apartment|flat|showroom|shop|penthouse)\b/i);

  const bhkHint = bhkMatch ? bhkMatch[0].toUpperCase().replace(/\s+/g, '') : null;
  const budgetHint = budgetMatch ? budgetMatch[0].trim() : null;
  const cityHint = city;

  return {
    name,
    phone,
    email,
    // "Qualified" means the CRM has everything the client asked us to
    // require before a lead is treated as handoff-ready: name, a way to
    // reach them, the city/location of the project, and a budget. Until
    // all four are present, the studio should not tell the visitor "our
    // design team will reach out" (see api/lib/prompt.js hard rules) and
    // the widget should not push the lead into the CRM inbox (js/chatbot.js).
    qualified: !!(name && (phone || email) && cityHint && budgetHint),
    bhkHint,
    budgetHint,
    projectTypeHint: projectTypeMatch ? capitalizeWord(projectTypeMatch[0]) : null,
    cityHint,
  };
}

// Validates the client-supplied "sticky" lead memory (see js/chatbot.js:
// InterioArtyWidget.knownLead). This is the one piece of visitor state that
// survives longer than the message-history caps, so a long conversation
// never loses a name/phone/email once it has been captured. Because it
// arrives as free-form input on every request, it must be validated exactly
// like any other untrusted field before it gets embedded into the system
// prompt: reject anything that doesn't look like the field it claims to be,
// strip control characters/newlines, and cap length, so a crafted payload
// can never smuggle extra instructions into the prompt.
function sanitizeKnownLead(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const clean = (v, max) => {
    if (typeof v !== 'string') return null;
    const s = v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
    if (!s || s.length > max) return null;
    return s;
  };
  const name = clean(raw.name, 60);
  const phone = clean(raw.phone, 20);
  const email = clean(raw.email, 100);
  const bhkHint = clean(raw.bhkHint, 20);
  const budgetHint = clean(raw.budgetHint, 40);
  const projectTypeHint = clean(raw.projectTypeHint, 30);
  const cityHint = clean(raw.cityHint, 40);

  return {
    name: name && looksLikeBareName(name) ? name : null,
    phone: phone && PHONE_RE.test(phone) ? phone.replace(/[\s-]/g, '') : null,
    email: email && EMAIL_RE.test(email) ? email : null,
    bhkHint: bhkHint && /^[1-9]\s?-?\s?BHK$/i.test(bhkHint) ? bhkHint.toUpperCase().replace(/\s+/g, '') : null,
    budgetHint:
      budgetHint && /^(?:₹|rs\.?|inr)?\s?\d+(?:\.\d+)?\s?(lakh|lac|crore|cr)s?$/i.test(budgetHint) ? budgetHint : null,
    projectTypeHint:
      projectTypeHint && /^(bungalow|villa|office|renovation|apartment|flat|showroom|shop|penthouse)$/i.test(projectTypeHint)
        ? capitalizeWord(projectTypeHint)
        : null,
    cityHint: cityHint && looksLikeBareLocation(cityHint) ? cityHint : null,
  };
}

// Combines what this request's transcript shows with the sticky memory
// carried from earlier in the conversation. Freshly-extracted facts win
// (the transcript is the source of truth when it's available), and the
// sticky value only fills in what has since scrolled out of the
// history/message caps.
function mergeKnown(fresh, sticky) {
  const s = sticky || {};
  const f = fresh || {};
  return {
    name: f.name || s.name || null,
    phone: f.phone || s.phone || null,
    email: f.email || s.email || null,
    bhkHint: f.bhkHint || s.bhkHint || null,
    budgetHint: f.budgetHint || s.budgetHint || null,
    projectTypeHint: f.projectTypeHint || s.projectTypeHint || null,
    cityHint: f.cityHint || s.cityHint || null,
    // Mandatory-details gate: name, a way to reach them, the project's
    // city/location, and a budget. This is what the client asked for: the
    // studio does not want "our design team will reach out" said, or a lead
    // pushed into the CRM inbox, until all four are on record.
    get qualified() {
      return !!(this.name && (this.phone || this.email) && this.cityHint && this.budgetHint);
    },
  };
}

// Validates the client-supplied rolling conversation summary (see
// js/chatbot.js: InterioArtyWidget.conversationSummary, and
// api/summarize-progress.js which produces it). Unlike the structured lead
// fields, a summary is free text by nature, so it cannot be shape-validated
// the same way; it is still bounded and stripped of control characters
// before it can reach the system prompt, since it is untrusted client input.
function sanitizeSummary(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
  if (!s) return null;
  return s.length > MAX_SUMMARY_LENGTH ? s.slice(0, MAX_SUMMARY_LENGTH) : s;
}

module.exports = {
  sanitizeMessages,
  extractLead,
  sanitizeKnownLead,
  mergeKnown,
  sanitizeSummary,
  isLongConversation,
  LONG_CONVERSATION_TURNS,
  MAX_MESSAGES,
  MAX_MESSAGE_LENGTH,
  MAX_SUMMARY_LENGTH,
};
