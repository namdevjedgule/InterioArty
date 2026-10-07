// Pure, unit-testable helpers for turning a raw token stream into
// sentence-safe chunks. Pulled out of api/chat.js so the truncation-safety
// behavior (never show a reply broken off mid-sentence) can be tested
// directly with a crafted buffer, without depending on a live model call
// behaving a particular way on a given day.

// Sentence end = ./!/? optionally followed by a closing quote/bracket, then
// real whitespace. Requiring the trailing whitespace (rather than treating
// end-of-buffer as a boundary) avoids splitting on a decimal like "12.5" or
// on whatever punctuation happens to be the last token received so far.
const SENTENCE_BREAK = /[.!?](["'”’)\]]*)\s+/;
const ENDS_CLEANLY_RE = /[.!?](["'”’)\]]*)\s*$/;

// Given the buffer accumulated so far, pulls out every complete sentence it
// can find. Returns { sentences, rest } where `rest` is the leftover partial
// sentence to keep buffering.
function extractCompleteSentences(buf) {
  const sentences = [];
  let rest = buf;
  let m;
  while ((m = rest.match(SENTENCE_BREAK))) {
    const endIdx = m.index + m[0].length;
    sentences.push(rest.slice(0, endIdx));
    rest = rest.slice(endIdx);
  }
  return { sentences, rest };
}

// Decides what to do with whatever is left in the buffer once the stream
// ends. If the model finished normally ("stop"), the leftover is the
// natural last sentence and should be shown even without trailing
// whitespace. If the model was cut off by the token cap ("length"), only
// show it when it still reads as a complete sentence; otherwise the visitor
// would see an unfinished thought, so it is dropped entirely.
function finalizeTrailingBuffer(buf, finishReason) {
  const trimmed = buf.trim();
  if (!trimmed) return null;
  if (finishReason === 'length' && !ENDS_CLEANLY_RE.test(trimmed)) return null;
  return buf;
}

// Brand rule: no em dashes, and no spaced en dashes ("homes - offices" style)
// either. This has to run on the accumulated, not-yet-sent buffer rather than
// on each streamed chunk: the model can emit the dash and the spaces around it
// in separate chunks, which a per-chunk pattern never sees as one match.
function stripDashes(text) {
  return String(text)
    .replace(/\s*\u2014+\s*/g, ', ')
    .replace(/ \u2013 /g, ', ')
    .replace(/, {2,}/g, ', ');
}

module.exports = { extractCompleteSentences, finalizeTrailingBuffer, stripDashes, SENTENCE_BREAK, ENDS_CLEANLY_RE };
