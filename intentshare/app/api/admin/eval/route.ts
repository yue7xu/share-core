// Technical evaluation (plan §11.2-A): one item per request so runs fit in serverless time limits.
// The console and scripts/eval.mjs loop over items. Every call is stored in ai_calls with eval_run_id.
import { isAdmin } from '@/lib/auth';
import { resolveContent } from '@/lib/content';
import { runIntent, runExtract } from '@/lib/ai';
import { AiError } from '@/lib/claude';
import { json, body } from '@/lib/http';
import heldout from '@/lib/data/heldout.json';
import { SCENARIOS } from '@/lib/data';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isAdmin(req)) return json({ error: 'unauthorized' }, 401);
  const scen = SCENARIOS.map((s) => ({ id: s.id, kind: 'scenario', message: s.msg, content_ref: s.url || s.photo, expected: s.exp, secondary: s.sec || null }));
  const held = heldout.items.map((h: any) => ({ id: h.id, kind: 'heldout', message: h.message, content_ref: h.content_ref, proposed: h.proposed }));
  return json({ scenarios: scen, heldout: held });
}

// POST { run_id, item: {id, kind, message, content_ref, expected}, tier, content_only: bool }
export async function POST(req: Request) {
  if (!isAdmin(req)) return json({ error: 'unauthorized' }, 401);
  const b = await body(req);
  const it = b.item || {};
  const tier = b.tier === 'quick' ? 'quick' : 'default';
  const meta = { item: it.id, item_kind: it.kind, expected: it.expected || null };
  const rec = (task: string) => ({ evalRunId: b.run_id || null, dataOrigin: 'eval', meta: { ...meta, task } });
  try {
    const content = await resolveContent(String(it.content_ref || ''));
    const message = String(it.message || '');
    const i = await runIntent(message, content, tier, rec('intent'));
    const x = await runExtract(message, i.intent, content, tier, rec('extract'));
    const out: any = { id: it.id, primary: i.intent.primary, secondary: i.intent.secondary, confidence: i.intent.confidence,
      evidence: i.intent.evidence, intent_ms: i.latencyMs, extract_ms: x.latencyMs,
      anchors: x.extraction.anchors.map((a) => a.unitIds), fallback: x.extraction.fallback, gap: !!x.extraction.gapQuestion,
      summary: x.extraction.summary, model: i.model };
    if (b.content_only) {
      const c = await runExtract('', null, content, tier, rec('extract_content_only'));
      out.content_only_anchors = c.extraction.anchors.map((a) => a.unitIds);
      out.content_only_summary = c.extraction.summary;
    }
    return json(out);
  } catch (e) {
    return json({ id: it.id, error: e instanceof AiError ? e.code : String((e as any)?.message || e).slice(0, 200) }, 200);
  }
}
