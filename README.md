# Interio Arty website

Static HTML/CSS/JS site plus the Arty AI chatbot (Vercel serverless functions in `api/`).

## Chatbot (Arty)

Ported from the `interioarty-chatbot` project. The full pipeline is intact:

- `js/chatbot.js`: Shadow DOM widget (host CSS cannot break it). Streams replies over SSE, restores the
  conversation across pages and reloads, keeps sticky lead memory (`interioarty_known`) and a rolling
  summary (`interioarty_summary`, refreshed every 8 visitor messages), offers WhatsApp/call handoff.
- `api/chat.js`: sanitises input, rate limits, trims history to the last 12 messages, injects known lead
  facts + rolling summary + missing-details checklist into the prompt, streams from Groq sentence by
  sentence, drops re-asks and truncated fragments, strips em dashes.
- `api/meta.js`, `api/summarize-lead.js`, `api/summarize-progress.js`, `api/lib/*`.
- `config/business.js` (all studio facts), `config/personas.js` (Arty's voice), `config/models.js` (model).

Change what Arty knows or how she sounds only in `config/`.

Differences from the source project: the widget uses the site's emerald/gold/Montserrat palette; city
extraction accepts natural answers ("Kharadi, Pune. Budget around 18 lakh"); spaced en dashes are
stripped like em dashes; chips stay hidden mid-conversation after a reload.

## Local dev

```bash
cp .env.example .env     # add GROQ_API_KEY
npm run dev:local        # http://localhost:3009
npm run smoke            # live API tests (real Groq calls; may hit provider rate limits)
npm run test:long        # long-conversation memory test
npm run test:leads       # offline tests for lead delivery and the admin API (no Groq)
```

## Leads and the admin panel

Every qualified chat is sent to `POST /api/leads` and stored server side, so the owner sees it from
any device at `/admin.html` after entering the admin password. Each lead has the AI summary, the details,
the full conversation, a status (New / Contacted / Closed), notes, Call / WhatsApp / Email buttons,
search, CSV export and delete. The page refreshes every 20 seconds.

Vercel setup (one time):

1. Storage: Vercel dashboard > Storage (or Marketplace) > add **Upstash Redis** and connect it to this
   project. That sets `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
2. Set `ADMIN_PASSWORD` (a long passphrase). Optional: `ADMIN_SESSION_SECRET`.
3. Redeploy. Open `/admin.html` and sign in.

Notes: the session is a signed HttpOnly cookie valid for 7 days; changing `ADMIN_PASSWORD` signs everyone
out. The admin page is not linked from the site and is marked noindex. Locally, leads go to
`.data/leads.json` (gitignored) when Redis is not configured; on Vercel without Redis the API reports
`storage_not_configured` instead of losing data. If a sync fails (offline visitor), the lead is still
kept in the visitor's browser and the widget retries.

## Deploy

Vercel: import the repo, set `GROQ_API_KEY` (optional `GROQ_MODEL`) plus the admin and Redis settings above. `api/*.js` become functions.
Without the key the API answers with a polite "call us" message and never errors.

## Known gaps

- Rate limits (chat, lead posts, admin sign-in attempts) are per serverless instance, not global, so use a
  long admin password.
