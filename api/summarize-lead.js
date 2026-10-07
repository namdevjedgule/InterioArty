const { PERSONAS, PERSONA_IDS, resolvePersona } = require('../config/personas');
const { resolveModel } = require('../config/models');
const { extractJsonObject } = require('./lib/json');
const { sanitizeMessages, sanitizeKnownLead, sanitizeSummary } = require('./lib/leads');

const SUMMARY_PROMPT = (assistantName) => `You are a CRM assistant reading a transcript between a website visitor and ${assistantName}, Interio Arty's AI design consultant (an interior design studio in Pune, India that is a one-stop shop from design to execution: turnkey interiors with civil work and full execution handled in-house, plus full home interiors, modular interiors, office interiors, renovations and a design-only service, with VR walkthroughs as an added advantage). Extract what the visitor actually said into structured fields. Never invent details that weren't mentioned, use null for anything not discussed.

Respond with ONLY a single JSON object in this exact shape:
{
  "name": string or null,
  "phone": string or null,
  "email": string or null,
  "projectType": one of "Full Home", "Modular Interior", "Office", "Renovation", or null,
  "bhk": string or null (e.g. "2BHK", "3BHK"),
  "budget": string or null (whatever the visitor implied or stated, e.g. "Above 10L", "12-15L"),
  "location": string or null (the city or area the project is in, e.g. "Kharadi, Pune", exactly as the visitor said it),
  "timeline": string or null (urgency or move-in timeline if mentioned),
  "summary": a 1-2 sentence plain-English summary of what this visitor wants, written for a busy salesperson to skim
}`;

// JSON mode (response_format) is not reliable across Groq models, so this
// first tries it and retries without it when the provider rejects or fails
// to validate, then parses the reply itself. The result is the same either
// way, which makes the endpoint independent of the configured model. It also
// retries transient 429/5xx blips with backoff.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function groqSummary(model, messages) {
  const call = (useJsonMode) =>
    fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        // Sized generously: the configured model can spend part of this
        // budget on internal reasoning tokens before the visible JSON
        // completion (see api/summarize-progress.js, where an identical
        // budget sized for just the visible text caused real truncation).
        max_tokens: 500,
        ...(useJsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    });

  let groqRes = await call(true);
  if (!groqRes.ok) {
    await sleep(1500);
    groqRes = await call(false);
  }
  if (!groqRes.ok) {
    await sleep(2000);
    groqRes = await call(false);
  }
  return groqRes;
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
    const { messages, persona: personaParam, knownLead: knownLeadRaw, conversationSummary: summaryRaw } = req.body || {};
    const personaId = resolvePersona(process.env.CHAT_PERSONA, personaParam);
    const assistantName = PERSONA_IDS.includes(personaId)
      ? PERSONAS[personaId].name
      : PERSONAS[Object.keys(PERSONAS)[0]].name;

    const clean = sanitizeMessages(messages);
    if (clean.error || clean.list.length === 0) {
      res.status(400).json({ error: 'messages array required' });
      return;
    }

    // The transcript sent here is capped at MAX_MESSAGES (30), and the
    // widget itself caps its stored history at 30 messages before that. In
    // a long conversation, a fact stated early on (a budget, a BHK, a
    // location preference) can fall outside that window well before the
    // chat ends, even though the chat itself never lost it (see the sticky
    // knownLead and rolling conversationSummary in api/chat.js). Without
    // this, the CRM record could silently miss details the visitor gave
    // early in a long chat. `known`/`summary` backfill the LLM's raw-
    // transcript extraction with that same durable state.
    const known = sanitizeKnownLead(knownLeadRaw);
    const priorSummary = sanitizeSummary(summaryRaw);

    const transcript = clean.list
      .map((m) => `${m.role === 'user' ? 'Visitor' : assistantName}: ${m.content}`)
      .join('\n');
    const extraContext = priorSummary
      ? `\n\n(Additional context from earlier in this conversation, not shown in the transcript below: ${priorSummary})`
      : '';

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      res.status(200).json({
        name: known.name || null,
        phone: known.phone || null,
        email: known.email || null,
        projectType: known.projectTypeHint || null,
        bhk: known.bhkHint || null,
        budget: known.budgetHint || null,
        location: known.cityHint || null,
        timeline: null,
        summary: priorSummary || 'AI summary unavailable in setup mode. See the raw transcript below.',
      });
      return;
    }

    const groqRes = await groqSummary(resolveModel(), [
      { role: 'system', content: SUMMARY_PROMPT(assistantName) },
      { role: 'user', content: transcript + extraContext },
    ]);

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      res.status(502).json({ error: 'LLM upstream error', detail: errText });
      return;
    }

    const data = await groqRes.json();
    const content = data.choices?.[0]?.message?.content || '';

    const parsed =
      (() => {
        try {
          return JSON.parse(content);
        } catch {
          return null;
        }
      })() || extractJsonObject(content);

    // The LLM's read of the (possibly trimmed) transcript wins when it
    // found something; the sticky knownLead backfills anything it missed
    // because the relevant message had already scrolled out of the window.
    res.status(200).json({
      name: (parsed && parsed.name) || known.name || null,
      phone: (parsed && parsed.phone && String(parsed.phone).replace(/[\s-]/g, '')) || known.phone || null,
      email: (parsed && parsed.email) || known.email || null,
      projectType: (parsed && parsed.projectType) || known.projectTypeHint || null,
      bhk: (parsed && parsed.bhk) || known.bhkHint || null,
      budget: (parsed && parsed.budget) || known.budgetHint || null,
      location: (parsed && parsed.location) || known.cityHint || null,
      timeline: (parsed && parsed.timeline) || null,
      summary:
        parsed && parsed.summary
          ? String(parsed.summary).replace(/\u2014+/g, ', ')
          : priorSummary || content.slice(0, 200),
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error', detail: String(err) });
  }
};