import { api } from '@/lib/db';
import { env, aiIsLive } from '@/lib/env';
import { PROMPT_VERSION } from '@/lib/prompts';
import { json } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function GET() {
  let db: any = 'unknown';
  try { db = (await api('ping'))?.ok ? 'ok' : 'error'; } catch (e: any) { db = 'error: ' + String(e.message).slice(0, 80); }
  return json({ ok: db === 'ok', db, dbMode: env.dbMode, ai: aiIsLive() ? 'live' : 'mock',
    models: { intent: env.modelIntent, extract: env.modelExtract, quick: env.modelQuick }, promptVersion: PROMPT_VERSION, version: env.appVersion });
}
