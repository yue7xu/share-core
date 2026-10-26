import { api } from '@/lib/db';
import { readAuthAll } from '@/lib/auth';
import { json, body, fail, isUuid } from '@/lib/http';
export const dynamic = 'force-dynamic';
// POST { share, version? } — share lifecycle (trigger, outcome) and each generated card version.
export async function POST(req: Request) {
  const b = await body(req);
  const s = b.share || {};
  const a = readAuthAll(req).find((x) => x.participantId === s.participant_id);
  if (!a || !isUuid(s.id)) return json({ error: 'unauthorized' }, 401);
  if (a.mode === 'b') return json({ ok: true, booth: true });
  try {
    const r = await api('share_upsert', s);
    if (b.version) await api('card_version_insert', { ...b.version, share_id: s.id });
    return json(r);
  } catch (e) { return fail(e); }
}
