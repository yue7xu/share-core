import { runExtract, isType } from '@/lib/ai';
import { AiError } from '@/lib/claude';
import { normIntent } from '@/lib/normalize';
import { prepare, contentFor } from '@/lib/ai-route';
import { json, body, fail } from '@/lib/http';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
// POST { participant_id, share_id, message, intent, content_ref, previous_title, tier, attempt } -> { extraction }
export async function POST(req: Request) {
  const b = await body(req);
  const p = await prepare(req, b); if (p instanceof Response) return p;
  try {
    const content = await contentFor(b);
    if (!content) return json({ error: 'no_content' }, 400);
    const message = String(b.message || '').slice(0, 2000);
    if (!b.intent || !isType(b.intent.primary)) return json({ error: 'bad_intent' }, 400);
    const intent = { ...normIntent(b.intent, message + ' ' + (b.intent.evidence || []).map((e: any) => e.quote).join(' ')),
      edited: !!b.intent.edited, intentLine: String(b.intent.intentLine || '').slice(0, 400) };
    const r = await runExtract(message, intent, content, b.tier === 'quick' ? 'quick' : 'default',
      { shareId: b.share_id, participantId: p.auth.participantId, attempt: b.attempt || 0, clientRequestId: b.client_request_id, noLog: p.auth.mode === 'b' },
      { previousTitle: b.previous_title || content.metadata?.previousTitle });
    return json({ extraction: r.extraction, model: r.model, latency_ms: r.latencyMs, ai_call_id: r.aiCallId });
  } catch (e) {
    if (e instanceof AiError) return json({ error: e.code }, e.code === 'rate_limited' ? 429 : 502);
    return fail(e);
  }
}
