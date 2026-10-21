# share-core

Core Share research prototype (CMU 05-688 AI Widgets; IRB STUDY2026_00000385).

Today's Share button sends a container (a URL). Core Share sends **a selection plus intent**: the part of a video the sender wants this person to see, an AI-written line (labeled "AI") and the sender's own note, unchanged.

| Folder | What it is |
|---|---|
| `extension/` | Chrome extension (Manifest V3). On youtube.com: **Share the part** button under the video, **Mark** button on the player (or Shift+M), pins on the progress bar, and a side panel to make and check the card |
| `web/` | Next.js app on Vercel: `/api/core` (one Claude call per card), `/api/cards` (stores a card after the sender creates the link), `/c/[id]` (the card page the recipient opens) and its link-preview image |
| `docs/payload-spec.md` | What a card carries (payload v1) |

Interface language: English.

## Install the extension (developer mode)

1. Download or clone this repo.
2. In Chrome, open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder.
4. Pin **Core Share** in the toolbar, open a YouTube video, and click the Core Share icon once to enter your access code and display name.
5. If the study server is not the default in `extension/config.js`, set it in the side panel's Settings.

## Deploy the web app

Vercel project with Root Directory `web`. Environment variables (see `web/.env.example`):

- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — the Supabase project (all reads and writes go through access-code–checked database functions)
- `ANTHROPIC_API_KEY` — without it, cards are made without an AI line
- `CLAUDE_MODEL` (optional)

Never commit real keys.
