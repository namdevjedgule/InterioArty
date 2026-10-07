// Single source of truth for which Groq model the API uses. Change the
// default here (or set GROQ_MODEL per deployment) and every handler follows.
//
// Default: openai/gpt-oss-120b. Benchmarked 2026-08-19 across the models
// this key can access (see scripts/bench-models.js). It is the only one
// with consistently on-brand, concise answers on the studio positioning
// (civil work + turnkey + design-only), 0.7-1.1s first token, no reasoning
// text leak, and it is cost-effective ($0.15/$0.60 per 1M tokens).
// Rejected: gpt-oss-20b (drops turnkey nuance), groq/compound and
// compound-mini (empty replies on 2 of 6 probes), qwen/qwen3.6-27b (dumps
// chain-of-thought into replies, 4x cost). No model below is reliable in
// response_format json_object mode, so summarize-lead.js retries without
// it and parses JSON itself.

const DEFAULT_CHAT_MODEL = 'openai/gpt-oss-120b';

function resolveModel() {
  return process.env.GROQ_MODEL || DEFAULT_CHAT_MODEL;
}

module.exports = { DEFAULT_CHAT_MODEL, resolveModel };