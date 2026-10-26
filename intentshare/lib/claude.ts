// Claude API wrapper: structured outputs, prompt caching, timeouts, one retry, and a complete
// record of every call in study.ai_calls (prompt, raw output, parsed result, tokens, latency).
import Anthropic from '@anthropic-ai/sdk';
import { env, aiIsLive } from './env';
import { api } from './db';
import { PROMPT_VERSION } from './prompts';
import { mockIntent, mockExtract } from './mock-ai';

let client: Anthropic | null = null;
const anthropic = () => (client ||= new Anthropic({ apiKey: env.anthropicKey, maxRetries: 0 }));

export class AiError extends Error {
  constructor(public code: string, message?: string) { super(message || code); }
}

export type CallRecord = {
  shareId?: string | null; participantId?: string | null; evalRunId?: string | null;
  attempt?: number; clientRequestId?: string | null; meta?: Record<string, unknown>; dataOrigin?: string; noLog?: boolean;
};

export type CallSpec = {
  task: 'intent' | 'extract' | 'extract_content_only';
  model: string;
  system: string;
  user: string;
  schema: object;
  maxTokens: number;
  timeoutMs: number;
  mock: () => unknown;
};

export type CallResult = { parsed: any; model: string; latencyMs: number; aiCallId?: string; usage?: any };

function errCode(e: any): string {
  if (e instanceof AiError) return e.code;
  const s = e?.status;
  if (s === 429) return 'rate_limited';
  if (s === 529 || s === 503) return 'overloaded';
  if (s === 401 || s === 403) return 'auth';
  if (e?.name === 'AbortError' || /timed? ?out/i.test(String(e?.message))) return 'timeout';
  return 'api_error';
}

export async function callClaude(spec: CallSpec, rec: CallRecord, log = true): Promise<CallResult & { normalizedSink: (n: unknown) => Promise<void> }> {
  const started = Date.now();
  const live = aiIsLive();
  let parsed: any = null, raw = '', stop: string | null = null, usage: any = null, requestId: string | null = null, error: string | null = null;
  const model = live ? spec.model : 'mock';
  try {
    if (!live) {
      await new Promise((r) => setTimeout(r, spec.task === 'intent' ? 250 : 600)); // keep the UI's loading states visible
      parsed = spec.mock();
      raw = JSON.stringify(parsed);
      stop = 'end_turn';
    } else {
      let lastErr: any;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const resp: any = await anthropic().messages.create({
            model: spec.model,
            max_tokens: spec.maxTokens,
            system: [{ type: 'text', text: spec.system, cache_control: { type: 'ephemeral' } }],
            messages: [{ role: 'user', content: spec.user }],
            output_config: { format: { type: 'json_schema', schema: spec.schema as any } },
          } as any, { timeout: spec.timeoutMs });
          requestId = resp._request_id || null;
          stop = resp.stop_reason;
          usage = resp.usage;
          raw = (resp.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
          if (stop === 'refusal') throw new AiError('refused');
          if (stop === 'max_tokens') throw new AiError('truncated');
          parsed = JSON.parse(raw);
          lastErr = null;
          break;
        } catch (e: any) {
          lastErr = e;
          const code = errCode(e);
          if (attempt === 0 && ['rate_limited', 'overloaded', 'timeout', 'api_error'].includes(code)) {
            await new Promise((r) => setTimeout(r, 800 + Math.random() * 700));
            continue;
          }
          break;
        }
      }
      if (lastErr) throw lastErr;
    }
  } catch (e: any) {
    error = errCode(e);
  }
  const latencyMs = Date.now() - started;
  let aiCallId: string | undefined;
  // The row is written after normalisation (normalizedSink) so it carries what the UI actually got.
  const write = async (normalized: unknown) => {
    if (!log || rec.noLog) return;
    try {
      const r = await api('ai_call_insert', {
        share_id: rec.shareId || null, participant_id: rec.participantId || null, eval_run_id: rec.evalRunId || null,
        task: spec.task, attempt: rec.attempt || 0, model, prompt_version: PROMPT_VERSION,
        system_prompt: spec.system, user_prompt: spec.user, raw_output: raw || null, parsed, normalized,
        stop_reason: stop, input_tokens: usage?.input_tokens ?? null, output_tokens: usage?.output_tokens ?? null,
        cache_read_tokens: usage?.cache_read_input_tokens ?? null, cache_write_tokens: usage?.cache_creation_input_tokens ?? null,
        latency_ms: latencyMs, error, request_id: requestId, client_request_id: rec.clientRequestId || null,
        meta: rec.meta || null, data_origin: rec.dataOrigin || null,
      });
      aiCallId = r?.id;
    } catch (e) { console.error('ai_call log failed', e); }
  };
  if (error) { await write(null); throw new AiError(error); }
  return { parsed, model, latencyMs, usage, aiCallId, normalizedSink: write };
}

export const MODELS = (tier: string) => tier === 'quick'
  ? { intent: env.modelQuick, extract: env.modelQuick }
  : { intent: env.modelIntent, extract: env.modelExtract };

export { mockIntent, mockExtract };
