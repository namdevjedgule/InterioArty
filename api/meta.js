const { resolvePersona } = require('../config/personas');

// Persona metadata for the widget: name, greeting and suggestion chips come
// from here, fetched once per visitor session. Zero LLM cost, cacheable.
// The deployment serves the single studio persona (Arty); a ?persona=
// query param is accepted for compatibility and any unknown value
// resolves to studio.
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const personaId = resolvePersona(process.env.CHAT_PERSONA, url.searchParams.get('persona'));
  const persona = require('../config/personas').PERSONAS[personaId];

  res.status(200).json({
    persona: personaId,
    assistantName: persona.name,
    assistantTitle: persona.title,
    greeting: persona.greeting,
    suggestions: persona.suggestions,
  });
};