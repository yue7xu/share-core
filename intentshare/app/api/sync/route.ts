import { api } from '@/lib/db';
import { readAuth } from '@/lib/auth';
import { json, fail } from '@/lib/http';
export const dynamic = 'force-dynamic';
// GET ?since=<server_ts> — new messages in this participant's conversation.
export async function GET(req: Request) {
  const a = readAuth(req);
  if (!a) return json({ error: 'unauthorized' }, 401);
  const since = new URL(req.url).searchParams.get('since');
  try { return json(await api('sync', { participant_id: a.participantId, since: since || null })); } catch (e) { return fail(e); }
}
