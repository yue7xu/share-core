import { api } from '@/lib/db';
import { readAuthAll } from '@/lib/auth';
import { json, body, fail, isUuid } from '@/lib/http';
export const dynamic = 'force-dynamic';
// POST { message_id, participant_id } — "Exclude from study" on one of your own messages.
export async function POST(req: Request) {
  const b = await body(req);
  if (!readAuthAll(req).some((a) => a.participantId === b.participant_id) || !isUuid(b.message_id)) return json({ error: 'unauthorized' }, 401);
  try { return json(await api('message_exclude', { message_id: b.message_id, participant_id: b.participant_id })); } catch (e) { return fail(e); }
}
