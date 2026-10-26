import { api } from '@/lib/db';
import { env, aiIsLive } from '@/lib/env';
import { PROMPT_VERSION } from '@/lib/prompts';
import { json } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function GET() {
  let db: any = 'unknown';
  try { db = (await api('ping'))?.ok ? 'ok' : 'error'; } catch (e: any) { db = 'error: ' + String(e.message).slice(0, 80); }
  const warnings: string[] = [];
  if (!env.serverKey || env.serverKey.startsWith('temp-')) warnings.push('SERVER_RPC_KEY is temporary: replace it (docs/SETUP.md)');
  if (!env.adminToken || env.adminToken.startsWith('temp-')) warnings.push('ADMIN_TOKEN is temporary: replace it (docs/SETUP.md)');
  if (!aiIsLive()) warnings.push('ANTHROPIC_API_KEY not set: AI runs in mock mode');
  return json({ ok: db === 'ok', warnings, db, dbMode: env.dbMode, ai: aiIsLive() ? 'live' : 'mock',
    models: { intent: env.modelIntent, extract: env.modelExtract, quick: env.modelQuick }, promptVersion: PROMPT_VERSION, version: env.appVersion });
}
