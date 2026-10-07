const { resolveModel } = require('../config/models');
const { sanitizeMessages, sanitizeSummary } = require('./lib/leads');

// Keeps a compact rolling summary of the conversation so far, refreshed
// periodically by the widget (every SUMMARY_INTERVAL turns, see
// js/chatbot.js) rather than on every single message. This is the piece
// that lets a long conversation stay coherent without keeping (or paying
// for) the full raw transcript in every /api/chat call: structured facts
// (name/phone/email/bhk/budget) live in the sticky "known lead" state
// (api/lib/leads.js), and everything else the visitor has said that isn't a
// clean structured field, preferences, objections, locations, must-haves,
// gets folded into this short narrative instead of being dropped outright
// once it scrolls out of the message-history window.
const SUMMARY_SYSTEM_PROMPT = `You maintain a short rolling summary of an ongoing chat between a website visitor and Interio Arty's AI design assistant, an interior design studio in Pune. You will be given the current summary (may be empty) and the messages exchanged since it was last updated. Your job is to MERGE them into an updated summary: keep every fact already in the current summary AND add anything new from the messages below it.

Before writing the updated summary, check the new messages for each of these, and add any that appear and are not already in the current summary:
- A location the visitor wants, or an area they want to avoid.
- A material, style, room type or layout preference (e.g. "wants custom carpentry, not a modular kitchen").
- An objection, dislike or something they explicitly ruled out.
- A timeline or urgency signal.
- Any other constraint or must-have they stated.

Rules:
- Keep it to 1-4 short sentences, in plain English, written for a busy salesperson to skim.
- Do NOT include the visitor's name, phone number or email: those are tracked separately.
- Do NOT invent anything not actually said.
- Only return the current summary completely unchanged if you checked every item above and genuinely found nothing new. Do not default to "unchanged" out of caution: if the new messages add ANY concrete detail from the list above, the updated summary must include it.
- Respond with ONLY the updated summary text. No preamble, no labels, no quotes.`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A transient rate limit here used to silently and permanently freeze the
// summary: this endpoint deliberately degrades to "keep the old summary"
// on failure so a Groq blip never breaks the chat itself, but that also
// meant no retry ever happened for the one background call whose whole job
// is to keep the summary current. One retry with backoff catches the
// common transient case before falling back to the stale summary.
async function callGroq(apiKey, body) {
  let groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!groqRes.ok) {
    await sleep(groqRes.status === 429 ? 2500 : 1200);
    groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
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
    const { priorSummary, messages } = req.body || {};
    const clean = sanitizeMessages(messages);
    if (clean.error || clean.list.length === 0) {
      res.status(400).json({ error: 'messages array required' });
      return;
    }
    const safePriorSummary = sanitizeSummary(priorSummary) || '';

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      // Summarization is a background quality improvement, not a critical
      // path: degrade to "keep whatever we had" rather than error, so a
      // missing key never breaks the chat itself.
      res.status(200).json({ summary: safePriorSummary });
      return;
    }

    const transcript = clean.list.map((m) => `${m.role === 'user' ? 'Visitor' : 'Assistant'}: ${m.content}`).join('\n');
    const userContent = `CURRENT SUMMARY:\n${safePriorSummary || '(none yet)'}\n\nNEW MESSAGES SINCE THEN:\n${transcript}`;

    const groqRes = await callGroq(apiKey, {
      model: resolveModel(),
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      temperature: 0.2,
      // The configured model can spend part of this budget on internal
      // reasoning tokens before producing the visible completion (see
      // config/models.js), so a budget sized for just the visible summary
      // text (a few dozen tokens) was getting the reply truncated
      // mid-sentence, sometimes dropping facts it had already started
      // to merge in. Sized generously like api/chat.js's own budget.
      max_tokens: 400,
    });

    if (!groqRes.ok) {
      // Same reasoning: this is a background refinement. On failure, keep
      // the visitor's chat working with whatever summary already existed
      // rather than surfacing an error to the widget.
      res.status(200).json({ summary: safePriorSummary });
      return;
    }

    const data = await groqRes.json();
    const content = (data.choices?.[0]?.message?.content || '').trim();

    // Trim back to the last complete sentence whenever the output doesn't
    // end cleanly, regardless of what finish_reason reports. In testing,
    // this model sometimes stops generating mid-clause ("...Typical pro",
    // "...budget ~60") without the API ever reporting finish_reason:
    // 'length' at all, so gating the trim on that field missed real
    // truncation and let broken, fact-dropping fragments through. Checking
    // the actual text shape catches both the token-cap case and this one.
    let safeContent = content;
    const endsCleanly = /[.!?](["')\]]*)\s*$/.test(content);
    if (content && !endsCleanly) {
      const lastBreak = Math.max(content.lastIndexOf('.'), content.lastIndexOf('!'), content.lastIndexOf('?'));
      // Only trim back if a reasonable chunk of the summary survives;
      // otherwise the model's very first sentence was itself incomplete,
      // and keeping the untrimmed (still imperfect) text beats discarding
      // the whole thing.
      if (lastBreak > content.length * 0.3) safeContent = content.slice(0, lastBreak + 1);
    }

    const updated = sanitizeSummary(safeContent) || safePriorSummary;

    res.status(200).json({ summary: updated });
  } catch (err) {
    res.status(200).json({ summary: '' });
  }
};
