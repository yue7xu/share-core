# IntentShare

Research prototype for **intent-first sharing** (CMU 05-688 AI Widgets; IRB STUDY2026_00000385; CHI 2027 Interactive Demo).
A sender writes a message and pastes a link, as they normally would. AI reads the message as the sender's intent (Searle 1976; Cohen, Carvalho & Mitchell 2004), finds the parts of the content that serve that intent, and builds a share card. The sender reviews the card before anything is sent.

This folder holds the deployed research messaging app: the UI from the *IntentShare Messages* design artifact, a backend, the live Claude API integration, and complete interaction logging for the field study.

| Path | What it is |
|---|---|
| `public/app/` | Messaging app UI (vanilla JS, same markup and CSS as the design artifact). `net.js` handles the API, session, telemetry queue and sync. `ui.js` is the UI plus instrumentation. |
| `public/admin/` | Researcher console (`/admin`): pairs, live events, per-share timelines, measures, evaluation runner, blind coding with Cohen's κ, CSV/JSONL export. |
| `app/api/` | Next.js route handlers (session, events, messages, sync, share, ai/intent, ai/extract, content, unfurl, survey, admin, health). |
| `lib/` | Claude wrapper (structured outputs, prompt caching, retries, full call log), prompts (versioned), normalizers, mock AI, content adapters (YouTube, Reddit, articles, Open Graph). |
| `supabase/` | Migrations: `study` schema, derived-measure views, and the server-key RPC dispatcher. `setup.sql` is all of them in one file. |
| `tests/` | `db/` (PGlite: schema + views), `unit/` (schemas, normalizers, prompts), `e2e/` (Playwright: demo, two-device study, baseline, exclude, booth, console). |
| `scripts/` | `make-replay.mjs` (booth offline cache), `still-image.mjs` (CHI still image / figures), `build-setup-sql.mjs`. |
| `docs/` | `PLAN.md`, `SETUP.md` (deployment steps), `DATA-DICTIONARY.md`, `IRB-DATA-APPENDIX.md`, `PILOT-RUNBOOK.md`, `BUILD-LOG.md`. |

## Run locally

```bash
npm install
npm run dev            # http://localhost:3000/demo — no keys needed: in-process Postgres (PGlite) + mock AI
npm test               # unit + database tests
npm run build && ADMIN_TOKEN=local-admin npx next start -p 3100 &
node tests/e2e/run.mjs # browser end-to-end (needs Playwright)
```

Add `ANTHROPIC_API_KEY` to `.env.local` for live AI. Add `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SERVER_RPC_KEY` to use the real database. See `docs/SETUP.md`.

## Routes

`/join` participants · `/demo` one screen, both roles · `/present` video / figures · `/booth` CHI booth (nothing logged; QR code for a phone) · `/admin` console · `/api/health`.

## Privacy by design

- No email addresses or real names; a 6-character code is the only identity.
- All tables sit in a schema the Supabase Data API does not expose. The browser never talks to the database, and the server authenticates with a secret key.
- Session tokens are HMAC-signed, so a browser can only act as its own participant.
- Every message can be excluded from the study by its sender. Withdrawal deletes everything.
- Booth mode records nothing.
