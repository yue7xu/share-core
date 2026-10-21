import { rpc } from '../../../lib/supabase';
import { body, json, options, siteUrl } from '../../../lib/http';

export const dynamic = 'force-dynamic';
export const OPTIONS = options;

const str = (v, n) => (v == null ? null : String(v).slice(0, n));

// Keep only the payload fields the card page uses (Card payload v1, see docs/payload-spec.md).
function sanitize(p, senderName) {
  const src = p.source || {};
  const ai = p.ai || {};
  const core = p.core || {};
  return {
    v: 1,
    source: {
      platform: 'youtube',
      video_id: str(src.video_id, 20),
      url: str(src.url, 300),
      title: str(src.title, 300),
      channel: str(src.channel, 200),
      duration: Number(src.duration) || 0,
    },
    sender: {
      name: senderName,
      note: str(p.sender?.note, 1000) || '',
      entry: ['share', 'mark', 'icon'].includes(p.sender?.entry) ? p.sender.entry : 'share',
      marks: (p.sender?.marks || []).slice(0, 30).map((m) => ({ t: Number(m.t) || 0, reaction: str(m.reaction, 300) || '', show: m.show !== false })),
      selected: (p.sender?.selected || []).slice(0, 50).map((s) => str(s, 12)),
    },
    ai: {
      available: Boolean(ai.available),
      model: str(ai.model, 60),
      intent_primary: str(ai.intent_primary, 20),
      intent_secondary: str(ai.intent_secondary, 20),
      about_recipient: Boolean(ai.about_recipient),
      summary_type: str(ai.summary_type, 20),
      headline: str(ai.headline, 220),
      headline_ai: str(ai.headline_ai, 220),
      headline_edited: Boolean(ai.headline_edited),
      points: (ai.points || []).slice(0, 6).map((x) => ({ text: str(x.text, 200), t: Number(x.t) || 0 })),
      rationale: str(ai.rationale, 400),
      not_found: Boolean(ai.not_found),
      clarify: ai.clarify ? { question: str(ai.clarify.question, 200), answer: str(ai.clarify.answer, 300) } : null,
      parts_changed: Boolean(ai.parts_changed),
    },
    core: {
      ranges: (core.ranges || []).slice(0, 12).map((r) => ({
        start: Math.max(0, Math.round(Number(r.start) || 0)),
        end: Math.max(0, Math.round(Number(r.end) || 0)),
        title: str(r.title, 300) || '',
        snippet: str(r.snippet, 1500) || '',
      })),
      duration: Math.round(Number(core.duration) || 0),
    },
  };
}

// POST { code, payload } -> { id, url }. Stored only when the sender creates the link.
export async function POST(req) {
  const { code, payload } = await body(req);
  if (!code || !payload) return json({ error: 'Missing fields' }, 400);
  try {
    const me = await rpc('whoami', { p_code: code });
    if (!me.name) return json({ error: 'Choose a display name first' }, 400);
    const clean = sanitize(payload, me.name);
    if (!clean.source.video_id) return json({ error: 'Missing video' }, 400);
    const id = await rpc('send_card', { p_code: code, p_thread: me.pair_thread, p_payload: clean, p_mark_ids: null });
    return json({ id, url: `${siteUrl()}/c/${id}` });
  } catch (e) {
    if (/study period ended/.test(e.message)) return json({ error: 'The days of use have ended, so cards can no longer be sent to your partner.' }, 403);
    if (/invalid code/.test(e.message)) return json({ error: 'That access code was not found' }, 401);
    return json({ error: 'Could not save the card' }, 500);
  }
}
