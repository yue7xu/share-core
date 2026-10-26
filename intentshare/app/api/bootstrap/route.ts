import { TYPES, TYPE_ORDER, REQUIRED, FIXTURES, SCENARIOS, SLOTS } from '@/lib/data';
import { env, aiIsLive } from '@/lib/env';
import { PROMPT_VERSION } from '@/lib/prompts';
import { json } from '@/lib/http';
export const dynamic = 'force-dynamic';
// Everything the client needs that is shared with the server: taxonomy, sample content, config.
export async function GET() {
  return json({ types: TYPES, order: TYPE_ORDER, required: REQUIRED, content: FIXTURES, scenarios: SCENARIOS, slots: SLOTS,
    config: { ai: aiIsLive() ? 'live' : 'mock', promptVersion: PROMPT_VERSION, version: env.appVersion, logDraftText: env.logDraftText } });
}
