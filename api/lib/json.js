// Extracts the first balanced JSON object from a model reply. Models vary:
// some wrap the object in markdown fences, some append reasoning, some
// ignore response_format entirely. This never throws and returns null when
// no parseable object exists, so callers always have a defined fallback.
function extractJsonObject(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/```(?:json)?/gi, '').trim();
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

module.exports = { extractJsonObject };