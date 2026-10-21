import { rpc } from '../../../lib/supabase';
import { body, json, options } from '../../../lib/http';

export const dynamic = 'force-dynamic';
export const OPTIONS = options;

// POST { code, name? } -> participant info. If name is given, sets the display name first.
export async function POST(req) {
  const { code, name } = await body(req);
  if (!code) return json({ error: 'Missing access code' }, 400);
  try {
    if (name && String(name).trim()) await rpc('set_display_name', { p_code: code, p_name: String(name) });
    const me = await rpc('whoami', { p_code: code });
    return json({ ok: true, me: { name: me.name, partner: me.partner, relationship: me.relationship, locked: me.locked } });
  } catch (e) {
    const bad = /invalid code/.test(e.message);
    return json({ error: bad ? 'That access code was not found' : 'Server error' }, bad ? 401 : 500);
  }
}
