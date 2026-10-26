import { api } from '@/lib/db';
import { readAuthAll } from '@/lib/auth';
import { json, body, fail, isUuid } from '@/lib/http';
export const dynamic = 'force-dynamic';
// POST { message, card? } — sends a message as the logged-in participant (or the demo partner).
export async function POST(req: Request) {
  const b = await body(req);
  const m = b.message || {};
  const ok = readAuthAll(req).some((a) => a.participantId === m.sender_id);
  if (!ok) return json({ error: 'unauthorized' }, 401);
  if (!isUuid(m.id) || !['text', 'card', 'plain'].includes(m.kind)) return json({ error: 'bad_message' }, 400);
  if (typeof m.text === 'string' && m.text.length > 4000) m.text = m.text.slice(0, 4000);
  try {
    const r = await api('message_insert', { message: m, card: m.kind === 'card' ? b.card : null });
    if (r?.error) return json(r, r.error === 'locked' ? 423 : 400);
    return json(r);
  } catch (e) { return fail(e); }
}
