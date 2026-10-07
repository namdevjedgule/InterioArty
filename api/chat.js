const { buildSystemPrompt } = require('./lib/prompt');
const { PERSONAS, resolvePersona } = require('../config/personas');
const { resolveModel } = require('../config/models');
const {
  extractLead,
  sanitizeMessages,
  sanitizeKnownLead,
  mergeKnown,
  sanitizeSummary,
  isLongConversation,
  MAX_MESSAGES,
  MAX_MESSAGE_LENGTH,
} = require('./lib/leads');
const { extractCompleteSentences, finalizeTrailingBuffer, stripDashes } = require('./lib/streaming');
const { violatesKnownAsk } = require('./lib/validator');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// ---- Rate limiting (in-memory sliding window) ---------------------------
// Serverless isolates are short-lived, so this is a best-effort per-isolate
// guard, not a hard global quota. It stops the obvious abuse (a script
// hammering /api/chat and burning the Groq key) and costs nothing. If the
// deployment ever outgrows it, swap in Upstash Ratelimit + Vercel KV with
// the same call shape.
const WINDOW_MS = 60_000;
const MAX_PER_IP = 30; // messages per minute per IP
const MAX_GLOBAL = 240; // messages per minute across the isolate
const hits = new Map(); // key -> number[] of timestamps

function rateLimit(ip) {
  const now = Date.now();
  let global = hits.get('global') || [];
  global = global.filter((t) => now - t < WINDOW_MS);
  if (global.length >= MAX_GLOBAL) return { allowed: false, reason: 'global limit reached' };
  const key = `ip:${ip}`;
  let perIp = hits.get(key) || [];
  perIp = perIp.filter((t) => now - t < WINDOW_MS);
  if (perIp.length >= MAX_PER_IP) return { allowed: false, reason: 'too many messages, try again in a minute' };
  global.push(now);
  perIp.push(now);
  hits.set('global', global);
  hits.set(key, perIp);
  if (hits.size > 5000) hits.clear();
  return { allowed: true };
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

// ---- SSE helpers ---------------------------------------------------------
function sendEvent(res, type, payload) {
  res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
}

// A network-level failure (dropped connection, DNS blip) makes fetch throw. That
// used to skip the retry and the polite "busy" reply below and surface as an
// HTTP 500, which the widget shows as "trouble connecting". Treat it like any
// other provider failure instead.
async function callGroq(apiKey, body) {
  try {
    return await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body,
    });
  } catch (err) {
    return { ok: false, status: 0 };
  }
}

function streamFallbackReply(res, me) {
  // No GROQ_API_KEY configured: degrade gracefully instead of 500ing,
  // so a stray deploy without the env never breaks the widget.
  const phone = '+91 78386 53501';
  const text = `Thanks for your message! I'm running in setup mode without a live AI key right now, so I can't answer precisely just yet. Please call us at ${phone} and our design team will help you right away.`;
  sendEvent(res, 'meta', { assistantName: me, persona: 'fallback', demoMode: true });
  sendEvent(res, 'delta', { text });
  sendEvent(res, 'lead', { lead: null, qualified: false });
  sendEvent(res, 'done', {});
  res.end();
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

  try {
    const { messages, persona: personaParam } = req.body || {};
    if (personaParam && !PERSONAS[personaParam]) {
      res.status(400).json({ error: `unknown persona '${personaParam}'` });
      return;
    }
    const personaId = resolvePersona(process.env.CHAT_PERSONA, personaParam);
    const me = PERSONAS[personaId].name;

    const clean = sanitizeMessages(messages);
    if (clean.error) {
      res.status(400).json({ error: clean.error });
      return;
    }
    if (clean.list.length === 0) {
      res.status(400).json({ error: 'messages array required' });
      return;
    }

    const rl = rateLimit(clientIp(req));
    if (!rl.allowed) {
      res.status(429).json({ error: rl.reason });
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Connection', 'keep-alive');

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      streamFallbackReply(res, me);
      return;
    }

    // Trim history: keep the last 12 messages so cost and latency stay
    // bounded on long conversations, but the flow never loses context.
    const history = clean.list.slice(-12);

    // What we already know about this visitor. `extractLead` re-derives it
    // from whatever transcript this request carries (up to the 30-message
    // cap); `sanitizeKnownLead`/`mergeKnown` layer in the "sticky" memory the
    // widget carries across the whole session (js/chatbot.js: knownLead), so
    // a name/phone/email captured early on is never lost even once it has
    // scrolled out of both the LLM's 12-message window and the 30-message
    // transcript cap. The client-supplied value is untrusted input, so it is
    // validated field-by-field before it can reach the system prompt.
    const known = mergeKnown(extractLead(clean.list), sanitizeKnownLead(req.body && req.body.knownLead));

    // Rolling summary of everything else the visitor has said (preferences,
    // objections, locations, constraints) that isn't a clean structured
    // field, refreshed periodically by the widget so it survives once older
    // messages fall out of the 12-message window below. See
    // api/summarize-progress.js.
    const summary = sanitizeSummary(req.body && req.body.conversationSummary);

    const totalUserTurns = clean.list.filter((m) => m.role === 'user').length;
    const longConversation = isLongConversation(totalUserTurns);

    const systemPrompt = buildSystemPrompt(personaId, known, { longConversation, summary });

    const persona = PERSONAS[personaId];
    const requestBody = JSON.stringify({
      model: resolveModel(),
      messages: [{ role: 'system', content: systemPrompt }, ...history],
      temperature: persona.temperature || 0.6,
      max_tokens: 350,
      stream: true,
    });
    let groqRes = await callGroq(apiKey, requestBody);

    // Retry once on provider rate limits or transient 5xx before giving up.
    if (!groqRes.ok) {
      const wait = groqRes.status === 429 ? 2000 : 1200;
      await new Promise((r) => setTimeout(r, wait));
      groqRes = await callGroq(apiKey, requestBody);
    }

    if (!groqRes.ok) {
      sendEvent(res, 'meta', { assistantName: me, persona: personaId });
      sendEvent(res, 'delta', {
        text: "I'm sorry, our assistant is unusually busy right now. Could you try again in a moment? If it persists, our team is one call away.",
      });
      sendEvent(res, 'lead', { lead: null, qualified: false });
      sendEvent(res, 'done', {});
      res.end();
      return;
    }

    sendEvent(res, 'meta', { assistantName: me, persona: personaId, longConversation });

    const decoder = new TextDecoder();
    const reader = groqRes.body.getReader();
    let buffer = '';
    let reply = '';
    // Sentence-level flush buffer: tokens are held here until a complete
    // sentence is seen, so a reply cut off mid-sentence by max_tokens never
    // shows a broken trailing fragment to the visitor (see api/lib/streaming.js).
    let sentenceBuf = '';
    let finishReason = 'stop';
    let sentAny = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep;
      while ((sep = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, sep).trim();
        buffer = buffer.slice(sep + 1);
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (raw === '[DONE]') continue;
        try {
          const chunk = JSON.parse(raw);
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            // The prompt forbids dashes but the model occasionally slips, so they
            // are stripped here, on the accumulated buffer (see stripDashes).
            reply += delta;
            sentenceBuf = stripDashes(sentenceBuf + delta);
            const { sentences, rest } = extractCompleteSentences(sentenceBuf);
            sentenceBuf = rest;
            for (const s of sentences) {
              // Response validator: the prompt already tells the model what
              // it knows about the visitor and asks it not to re-ask for
              // those things, but that's a request, not a guarantee. Drop
              // any sentence that re-asks for a fact already in `known`
              // before it ever reaches the visitor, regardless of what the
              // model decided to say.
              if (violatesKnownAsk(s, known)) continue;
              sendEvent(res, 'delta', { text: s });
              sentAny = true;
            }
          }
          const fr = chunk.choices?.[0]?.finish_reason;
          if (fr) finishReason = fr;
        } catch {
          // ignore malformed chunk
        }
      }
    }

    // Flush whatever sentence fragment is left. If the model finished
    // normally, it's the natural last sentence: send it. If the model was
    // cut off by the token cap mid-sentence, only send it if it still reads
    // as a complete sentence; otherwise drop the broken fragment rather than
    // show the visitor an unfinished thought.
    const trailing = finalizeTrailingBuffer(sentenceBuf, finishReason);
    if (trailing && !violatesKnownAsk(trailing, known)) {
      sendEvent(res, 'delta', { text: trailing });
      sentAny = true;
    }

    // Some models occasionally stream an empty completion, and the
    // trim-on-truncate guard above can (rarely) drop the only sentence the
    // model produced. Either way, never leave the visitor with a blank
    // bubble: fall back to a polite message instead.
    if (!sentAny || reply.trim().length === 0) {
      sendEvent(res, 'delta', {
        text: "I'm sorry, I could not pull together an answer just now. Could you try again in a moment? If it persists, our team is one call away at +91 78386 53501.",
      });
    }

    const lead = extractLead(clean.list);
    const finalLead = mergeKnown(lead, sanitizeKnownLead(req.body && req.body.knownLead));
    sendEvent(res, 'lead', { lead: finalLead, qualified: !!finalLead.qualified });
    sendEvent(res, 'done', {});
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Server error', detail: String(err) });
    } else {
      try {
        sendEvent(res, 'delta', {
          text: "I'm sorry, something went wrong on my end. Could you try again? Our team is also one call away at +91 78386 53501.",
        });
        sendEvent(res, 'done', {});
        res.end();
      } catch {
        // stream already closed
      }
    }
  }
};