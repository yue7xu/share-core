import { rpc } from '../../../lib/supabase';
import { body, json, options } from '../../../lib/http';

export const dynamic = 'force-dynamic';
export const OPTIONS = options;

// POST { code, type, data } -> logs one interaction event (Study Materials Part 1).
export async function POST(req) {
  const { code, type, data } = await body(req);
  if (!code || !type) return json({ error: 'Missing fields' }, 400);
  try {
    await rpc('log_event', { p_code: code, p_type: String(type).slice(0, 64), p_data: data ?? null });
    return json({ ok: true });
  } catch {
    return json({ error: 'Could not log' }, 400);
  }
}
