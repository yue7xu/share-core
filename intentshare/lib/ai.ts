// The two AI tasks (brief §4.3), shared by the API routes and the eval script.
import { TYPES, type ContentObject } from './data';
import { normIntent, normExtraction, type Intent } from './normalize';
import { INTENT_SYSTEM, intentUser, EXTRACT_SYSTEM, CONTENT_ONLY_SYSTEM, extractUser, INTENT_SCHEMA, EXTRACT_SCHEMA } from './prompts';
import { callClaude, MODELS, mockIntent, mockExtract, type CallRecord } from './claude';

export async function runIntent(message: string, content: ContentObject, tier: string, rec: CallRecord) {
  if (!message.trim()) {
    const intent = normIntent({ primary: 'OTHER', confidence: 'low', intentLine: '', missingSlots: ['what'] }, message);
    return { intent, model: 'rule', latencyMs: 0 };
  }
  const r = await callClaude({
    task: 'intent', model: MODELS(tier).intent, system: INTENT_SYSTEM, user: intentUser(message, content),
    schema: INTENT_SCHEMA, maxTokens: 700, timeoutMs: 12000, mock: () => mockIntent(message),
  }, rec);
  const intent = normIntent(r.parsed, message);
  await r.normalizedSink(intent);
  return { intent, model: r.model, latencyMs: r.latencyMs, aiCallId: r.aiCallId };
}

export async function runExtract(message: string, intent: Intent | null, content: ContentObject, tier: string, rec: CallRecord,
  ctx: { previousTitle?: string } = {}) {
  if (!content.units.length) {
    return { extraction: { anchors: [], summary: '', fallback: true, gapQuestion: null, replyOptions: [], discussPrompt: null, containerOnly: true }, model: 'rule', latencyMs: 0 };
  }
  const contentOnly = intent === null;
  const r = await callClaude({
    task: contentOnly ? 'extract_content_only' : 'extract', model: MODELS(tier).extract,
    system: contentOnly ? CONTENT_ONLY_SYSTEM : EXTRACT_SYSTEM, user: extractUser(message, intent, content, ctx),
    schema: EXTRACT_SCHEMA, maxTokens: 1200, timeoutMs: 30000, mock: () => mockExtract(message, intent, content),
  }, rec);
  const extraction = normExtraction(r.parsed, content);
  await r.normalizedSink(extraction);
  return { extraction, model: r.model, latencyMs: r.latencyMs, aiCallId: r.aiCallId };
}

export const isType = (t: unknown): t is string => typeof t === 'string' && t in TYPES;
