import { aiAvailable, callClaude, cleanInput, finalize } from '../../../lib/core';
import { body, json, options } from '../../../lib/http';

export const maxDuration = 60;
export const OPTIONS = options;

// POST { video, units, marks, selected, note, relationship, clarify? }
// -> { status: 'clarify', clarify } or { status: 'card', ai, core_units, ranges }
export async function POST(req) {
  const input = cleanInput(await body(req));
  if (!input.video.id) return json({ error: 'Missing video' }, 400);

  if (!aiAvailable()) {
    return json({ status: 'card', ai_error: 'AI is not connected', ...finalize(input, null) });
  }
  try {
    const ai = await callClaude(input);
    const unsure = ai.clarify && ai.clarify.question && Array.isArray(ai.clarify.options) && (ai.confidence ?? 1) < 0.6;
    if (unsure && !input.clarify) {
      return json({
        status: 'clarify',
        clarify: { question: String(ai.clarify.question).slice(0, 200), options: ai.clarify.options.slice(0, 3).map((o) => String(o).slice(0, 80)) },
      });
    }
    return json({ status: 'card', ...finalize(input, ai) });
  } catch (e) {
    return json({ status: 'card', ai_error: 'The AI service is unavailable right now', detail: String(e.message).slice(0, 300), ...finalize(input, null) });
  }
}
