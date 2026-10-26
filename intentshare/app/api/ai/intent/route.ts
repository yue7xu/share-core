import { runIntent } from '@/lib/ai';
import { AiError } from '@/lib/claude';
import { prepare, contentFor } from '@/lib/ai-route';
import { json, body, fail } from '@/lib/http';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
// POST { participant_id, share_id, message, content_ref, tier, attempt, client_request_id } -> { intent, content }
export async function POST(req: Request) {
  const b = await body(req);
  const p = await prepare(req, b); if (p instanceof Response) return p;
  try {
    const content = await contentFor(b);
    if (!content) return json({ error: 'no_content' }, 400);
    const message = String(b.message || '').slice(0, 2000);
    const r = await runIntent(message, content, b.tier === 'quick' ? 'quick' : 'default',
      { shareId: b.share_id, participantId: p.auth.participantId, attempt: b.attempt || 0, clientRequestId: b.client_request_id, noLog: p.auth.mode === 'b' });
    return json({ intent: r.intent, model: r.model, latency_ms: r.latencyMs, ai_call_id: r.aiCallId, content });
  } catch (e) {
    if (e instanceof AiError) return json({ error: e.code }, e.code === 'rate_limited' ? 429 : 502);
    return fail(e);
  }
}
