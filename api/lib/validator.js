// Response validator: the last line of defense between what the model
// generated and what the visitor sees. The system prompt already tells the
// model what it already knows about the visitor and asks it not to re-ask
// for those things, but an instruction is a request, not a guarantee. This
// module enforces it deterministically: a generated sentence that re-asks
// for a fact already present in `known` is dropped before it ever reaches
// the client, regardless of what the model decided to say.
//
// This runs per-sentence against the sentence-buffered stream (see
// api/lib/streaming.js), so a single offending sentence in an otherwise
// fine reply is removed without discarding the rest of the reply.

const ASKS_FOR_CONTACT = /\b(phone( number)?|contact( number| info(rmation)?)?|email( address)?|whatsapp number|reach you|contact you|get in touch|share your (number|email|contact)|number where|where (can|could) we (reach|contact) you)\b/i;
const ASKS_FOR_NAME = /\b(your name|may i (?:get|have|know) your name|could i (?:get|have) your name|what'?s your name|who am i (?:speaking|talking) (?:with|to))\b/i;
const IS_QUESTION = /\?\s*$/;

// A sentence "asks" for something when it both mentions the topic and reads
// as a question (or an imperative request like "please share..."). Plain
// mentions of "phone" in an unrelated context (e.g. "call us at ...") are
// not questions and are left alone.
const IMPERATIVE_ASK = /\b(please (?:share|provide|give|send)|could you (?:share|provide|give|send))\b/i;

function looksLikeAsk(sentence) {
  return IS_QUESTION.test(sentence) || IMPERATIVE_ASK.test(sentence);
}

// Returns true if this sentence should be dropped: it re-asks for a detail
// already present in `known`.
function violatesKnownAsk(sentence, known) {
  if (!sentence || !known) return false;
  if (!looksLikeAsk(sentence)) return false;
  if ((known.phone || known.email) && ASKS_FOR_CONTACT.test(sentence)) return true;
  if (known.name && ASKS_FOR_NAME.test(sentence)) return true;
  return false;
}

// Filters a list of complete sentences, dropping any that violate the
// known-ask rule. Kept as a small helper so callers do not need to inline
// the filter/loop themselves.
function filterKnownAsks(sentences, known) {
  return sentences.filter((s) => !violatesKnownAsk(s, known));
}

module.exports = { violatesKnownAsk, filterKnownAsks, looksLikeAsk };
