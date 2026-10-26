import { unfurl } from '@/lib/content';
import { readAuthAll } from '@/lib/auth';
import { json, body } from '@/lib/http';
export const dynamic = 'force-dynamic';
// POST { url } -> plain link preview (baseline condition): title, site, image.
export async function POST(req: Request) {
  if (!readAuthAll(req).length) return json({ error: 'unauthorized' }, 401);
  const b = await body(req);
  if (!/^https?:\/\//.test(String(b.url || ''))) return json({ error: 'bad_url' }, 400);
  return json(await unfurl(String(b.url)));
}
