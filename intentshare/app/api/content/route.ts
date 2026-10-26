import { resolveContent } from '@/lib/content';
import { readAuthAll } from '@/lib/auth';
import { json, body, fail } from '@/lib/http';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
// POST { ref } -> ContentObject (fixture, cache, or live adapter; container-only when unreadable)
export async function POST(req: Request) {
  if (!readAuthAll(req).length) return json({ error: 'unauthorized' }, 401);
  const b = await body(req);
  try { return json(await resolveContent(String(b.ref || ''))); } catch (e) { return fail(e); }
}
