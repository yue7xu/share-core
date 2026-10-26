import { api } from '@/lib/db';
import { readAuth, readAuthAll } from '@/lib/auth';
import { json, body, fail, isUuid } from '@/lib/http';
export const dynamic = 'force-dynamic';
const ITEMS = ['m1a', 'm1b', 'm2', 'post_rating'];
// POST { id, participant_id, share_id, card_id, item, value, skipped, shown_at }
export async function POST(req: Request) {
  const b = await body(req);
  const a = readAuthAll(req).find((x) => x.participantId === b.participant_id);
  if (!a) return json({ error: 'unauthorized' }, 401);
  if (a.mode === 'b') return json({ ok: true, booth: true });
  if (!isUuid(b.id) || !ITEMS.includes(b.item)) return json({ error: 'bad_answer' }, 400);
  b.value = b.value == null ? null : String(b.value).slice(0, 1000);
  try { return json(await api('survey_insert', b)); } catch (e) { return fail(e); }
}
// GET -> sender post-hoc ratings waiting for this participant.
export async function GET(req: Request) {
  const a = readAuth(req);
  if (!a) return json({ error: 'unauthorized' }, 401);
  const delay = Number(new URL(req.url).searchParams.get('delay_h') ?? 12);
  try { return json(await api('pending_surveys', { participant_id: a.participantId, delay_h: delay })); } catch (e) { return fail(e); }
}
