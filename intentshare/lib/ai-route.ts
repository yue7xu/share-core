// Shared checks for the AI endpoints: identity, per-participant hourly limit, content resolution.
import { api } from './db';
import { readAuthAll, type Auth } from './auth';
import { env } from './env';
import { resolveContent } from './content';
import { json } from './http';

export async function prepare(req: Request, b: any): Promise<{ auth: Auth } | Response> {
  const auth = readAuthAll(req).find((a) => a.participantId === b.participant_id);
  if (!auth) return json({ error: 'unauthorized' }, 401);
  if (auth.mode === 'b') return { auth };
  try {
    const r = await api('ai_rate', { participant_id: auth.participantId });
    if (r.count >= env.aiPerHour) return json({ error: 'rate_limited' }, 429);
  } catch {}
  return { auth };
}

export async function contentFor(b: any) {
  const ref = String(b.content_ref || '');
  if (!ref) return null;
  return resolveContent(ref);
}
