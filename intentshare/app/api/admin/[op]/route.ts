import { api } from '@/lib/db';
import { isAdmin } from '@/lib/auth';
import { json, body, fail } from '@/lib/http';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Researcher console API. Every call needs Authorization: Bearer <ADMIN_TOKEN>.
const OPS: Record<string, string> = {
  overview: 'admin_overview', pair_create: 'admin_pair_create', pair_update: 'admin_pair_update',
  withdraw: 'admin_withdraw', query: 'admin_query', events_tail: 'admin_events_tail',
  share_detail: 'admin_share_detail', code_upsert: 'admin_code_upsert', purge_booth: 'admin_purge_booth',
  eval_run_start: 'admin_eval_run_start', eval_run_finish: 'admin_eval_run_finish',
};

export async function POST(req: Request, ctx: { params: Promise<{ op: string }> }) {
  if (!isAdmin(req)) return json({ error: 'unauthorized' }, 401);
  const { op } = await ctx.params;
  if (!OPS[op]) return json({ error: 'unknown_op' }, 404);
  try { return json(await api(OPS[op], await body(req))); } catch (e) { return fail(e); }
}

function csv(rows: any[]) {
  if (!rows.length) return '';
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: any) => {
    if (v == null) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
}

// GET /api/admin/export?view=v_share_funnel&origin=study&format=csv|jsonl  (token also accepted as ?token= for downloads)
export async function GET(req: Request, ctx: { params: Promise<{ op: string }> }) {
  const url = new URL(req.url);
  const tok = url.searchParams.get('token');
  const authReq = tok ? new Request(req.url, { headers: { authorization: 'Bearer ' + tok } }) : req;
  if (!isAdmin(authReq)) return json({ error: 'unauthorized' }, 401);
  const { op } = await ctx.params;
  if (op !== 'export') return json({ error: 'unknown_op' }, 404);
  const view = url.searchParams.get('view') || 'v_share_funnel';
  const origin = url.searchParams.get('origin') || null;
  const format = url.searchParams.get('format') || 'csv';
  try {
    const rows = await api('admin_query', { view, origin, limit: 50000 });
    if (!Array.isArray(rows)) return json(rows, 400);
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `intentshare_${view}_${origin || 'all'}_${stamp}.${format === 'jsonl' ? 'jsonl' : 'csv'}`;
    const text = format === 'jsonl' ? rows.map((r) => JSON.stringify(r)).join('\n') : csv(rows);
    return new Response(text, { headers: { 'Content-Type': format === 'jsonl' ? 'application/x-ndjson' : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } });
  } catch (e) { return fail(e); }
}
