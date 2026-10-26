import { api } from '@/lib/db';
import { tokenFor, MODE_CHAR, readAuthAll } from '@/lib/auth';
import { env } from '@/lib/env';
import { json, body, fail, isUuid } from '@/lib/http';
export const dynamic = 'force-dynamic';
const MODES = ['study', 'demo', 'booth', 'presentation'];
// POST { code } (study) or { demo: true } (demo / presentation), plus session info -> identity + tokens.
export async function POST(req: Request) {
  const b = await body(req);
  const s = b.session || {};
  if (!isUuid(s.id)) return json({ error: 'bad_session' }, 400);
  const mode = MODES.includes(s.mode) ? s.mode : 'study';
  const demo = mode !== 'study';
  const joining = /^[A-Za-z0-9]{6}$/.test(String(b.code || '').trim());
  if (!demo && !joining) return json({ error: 'unknown_code' }, 400);
  try {
    const r = await api('session_start', {
      code: b.code, demo: demo && !joining, data_origin: mode === 'presentation' ? 'author' : mode === 'booth' ? 'booth' : 'demo',
      session: { id: s.id, user_agent: String(req.headers.get('user-agent') || '').slice(0, 300), viewport: String(s.viewport || '').slice(0, 40),
        tz: String(s.tz || '').slice(0, 60), client_now: Number(s.client_now) || Date.now(), app_version: env.appVersion, mode },
    });
    if (r?.error) return json({ error: r.error }, r.error === 'unknown_code' ? 404 : 403);
    // A participant code can also join a demo/booth pair (phone receiver via QR): mode follows the pair's origin.
    const origin = r.participant.data_origin;
    const m = MODE_CHAR[origin === 'booth' ? 'booth' : origin === 'author' ? 'presentation' : origin === 'demo' ? 'demo' : 'study'];
    r.token = tokenFor(r.participant.id, r.session_id, m);
    if (demo && r.partner) r.partner_token = tokenFor(r.partner.id, r.session_id, m);
    r.mode = mode;
    return json(r);
  } catch (e) { return fail(e); }
}
// POST /api/session?touch=1 handled by the same client on visibility changes.
export async function PATCH(req: Request) {
  const b = await body(req);
  if (!isUuid(b.session_id) || !readAuthAll(req).some((x) => x.sessionId === b.session_id)) return json({ error: 'unauthorized' }, 401);
  const offset = Number.isFinite(Number(b.clock_offset_ms)) ? Math.round(Number(b.clock_offset_ms)) : null;
  try { return json(await api('session_touch', { session_id: b.session_id, ended: !!b.ended, clock_offset_ms: offset })); } catch (e) { return fail(e); }
}
