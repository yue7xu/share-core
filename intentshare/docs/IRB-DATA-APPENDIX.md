# Data collection appendix (draft for the IRB modification, STUDY2026_00000385)

Draft text describing what the research messaging app records. It replaces the Chrome-extension data description in protocol v0.8. Edit freely before pasting into SPARCS.

## What the app records

1. **Messages** participants send each other in the research chat, word for word, including links. The chat is a research web page, not a real messaging service; no other conversations are accessed.
2. **Share cards.** When a message contains a link, the app may generate a share card with AI. We store every version of the card that is generated, the version that was sent, and whether the sender sent the card, sent a plain link instead, or closed it.
3. **Interaction log.** Clicks and taps inside the app (which control, where, and when), when the window is in view or hidden, and how long each step of sharing takes. While a participant types, the app stores a snapshot of the unsent text when typing pauses, plus the number of keys and deletions. It does not record keystrokes one by one. It records nothing outside the research web page: no other tabs, apps, browsing history, screen, camera or microphone. *If the board prefers, snapshots of unsent text can be turned off; then only the length is stored.*
4. **AI requests.** For each request to the AI service (Anthropic Claude API), we store the instructions sent to the model, the participant's message and the public content of the shared link as sent to the model, the model's reply, and timing and token counts. Requests carry no names, codes, email addresses or other identifiers. Anthropic's commercial terms do not use API data for model training.
5. **Study questions** shown inside the app: m1a, m1b, m2 and the post-hoc rating (wording in the protocol's Planned Questions). Every question can be skipped.
6. **Technical information:** browser type, screen size, time zone, and the difference between the device clock and the server clock (used to line up timings between the two partners' devices).

Not collected: email addresses, real names (participants choose a display name), location, contacts, IP addresses in the study database, or any content from outside the app.

## Identity and storage

- Each participant signs in with a random 6-character study code. The key linking codes to identities is kept separately by the PI, as described in the protocol.
- Data are stored in a Supabase (PostgreSQL) database in the US (us-east-2). Tables are not reachable from the internet directly. Only the app's server can write to them, using a secret key, and only the research team can read them, through a password-protected researcher console.
- Content from public links (article text, video transcripts) is cached for 7 days to avoid fetching it repeatedly.

## Participant controls

- **Exclude from study:** on any message they sent, a participant can choose "Exclude from study". That message, its card, its AI requests and its interaction events are then excluded from every analysis and export.
- **Personal or private content:** participants are told not to share anything personal or private. If the team finds such content, it is deleted immediately and not analyzed (protocol v0.8).
- **End of the study period:** after the 3-day period the chat becomes read-only.
- **Withdrawal:** the researcher console deletes all data a participant produced: messages, cards, AI requests, events, answers and sessions. If the consent form specifies it, the partner's messages in that chat are deleted too.

## Demonstrations (not research data)

- A public demo page and a CHI conference booth mode use the same app. Data from the demo page are labeled `demo` and are never analyzed with study data.
- Booth mode records no interaction events and no AI requests. When a visitor's phone is used as the second screen, messages pass through the database labeled `booth` and are deleted after the conference.
