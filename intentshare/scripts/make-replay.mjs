// CHI booth fallback (plan §11.4): record live AI results for the sample shares so the booth still works
// if the venue Wi-Fi fails. Run once the API key is set, against the deployed app or `npm run dev`:
//   BASE=https://<your-app>.vercel.app node scripts/make-replay.mjs
// Writes public/app/replay.json; commit it. Booth mode shows these results marked "cached" only when a live call fails.
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const BASE = process.env.BASE || 'http://localhost:3000';
const post = async (path, body, token) => {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Session ' + token } : {}) }, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw new Error(path + ' ' + JSON.stringify(j)); return j;
};
const boot = await (await fetch(BASE + '/api/bootstrap')).json();
if (boot.config.ai !== 'live') { console.error('AI is in mock mode on ' + BASE + '; set ANTHROPIC_API_KEY first.'); process.exit(1); }
// A booth session: nothing is logged on the server.
const s = await post('/api/session', { session: { id: randomUUID(), mode: 'booth', client_now: Date.now() } });
const out = {};
for (const sc of boot.scenarios) {
  const ref = sc.url || sc.photo;
  const base = { participant_id: s.participant.id, share_id: randomUUID(), tier: 'default', attempt: 0 };
  try {
    const i = await post('/api/ai/intent', { ...base, message: sc.msg, content_ref: ref }, s.token);
    const x = await post('/api/ai/extract', { ...base, message: sc.msg, intent: i.intent, content_ref: ref }, s.token);
    out[sc.msg + '|' + ref] = { intent: { intent: i.intent, model: i.model, content: i.content }, extract: { extraction: x.extraction, model: x.model } };
    console.log(sc.id, i.intent.primary, x.extraction.anchors.length, 'anchors');
  } catch (e) { console.error(sc.id, e.message); }
}
writeFileSync(new URL('../public/app/replay.json', import.meta.url), JSON.stringify(out));
console.log('wrote', Object.keys(out).length, 'entries');
