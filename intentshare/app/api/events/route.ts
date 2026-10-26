import { api } from '@/lib/db';
import { readAuthAll } from '@/lib/auth';
import { env } from '@/lib/env';
import { json, body, fail } from '@/lib/http';
export const dynamic = 'force-dynamic';
// POST { events: [...] } — the interaction log. Also accepts text/plain bodies from navigator.sendBeacon,
// which cannot set headers, so the tokens may come inside the body.
export async function POST(req: Request) {
  let b: any;
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('text/plain')) { try { b = JSON.parse(await req.text()); } catch { b = {}; } } else b = await body(req);
  let auths = readAuthAll(req);
  if (!auths.length && Array.isArray(b.tokens)) {
    const h = new Headers({ authorization: 'Session ' + (b.tokens[0] || ''), 'x-session-2': b.tokens[1] || '' });
    auths = readAuthAll(new Request('http://x', { headers: h }));
  }
  if (!auths.length) return json({ error: 'unauthorized' }, 401);
  auths = auths.filter((a) => a.mode !== 'b'); // booth: never logged
  if (!auths.length) return json({ inserted: 0, booth: true });
  const allowed = new Map(auths.map((a) => [a.participantId, a.sessionId]));
  const events = (Array.isArray(b.events) ? b.events : []).slice(0, 200)
    .filter((e: any) => e && allowed.has(e.participant_id) && e.session_id === allowed.get(e.participant_id))
    .map((e: any) => {
      if (!env.logDraftText && e.type === 'compose.input' && e.payload) { e.payload = { ...e.payload, text: undefined }; }
      if (e.payload && JSON.stringify(e.payload).length > 20000) e.payload = { truncated: true };
      return e;
    });
  if (!events.length) return json({ inserted: 0 });
  try { return json(await api('events_insert', { events })); } catch (e) { return fail(e); }
}
