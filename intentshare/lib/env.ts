// Server configuration. Every value comes from the environment (Vercel project settings or .env.local).
export const env = {
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '',
  serverKey: process.env.SERVER_RPC_KEY || '',
  adminToken: process.env.ADMIN_TOKEN || '',
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  dbMode: (process.env.DB_MODE || (process.env.SUPABASE_URL ? 'supabase' : 'pglite')) as 'supabase' | 'pglite',
  // live = Claude API; mock = deterministic fixtures (also used automatically when no key is set)
  aiMode: (process.env.AI_MODE || (process.env.ANTHROPIC_API_KEY ? 'live' : 'mock')) as 'live' | 'mock',
  modelIntent: process.env.MODEL_INTENT || 'claude-haiku-5-5',
  modelExtract: process.env.MODEL_EXTRACT || 'claude-sonnet-5-5',
  modelQuick: process.env.MODEL_QUICK || 'claude-haiku-5-5',
  aiPerHour: Number(process.env.AI_CALLS_PER_HOUR || 60),
  logDraftText: process.env.LOG_DRAFT_TEXT !== 'false',
  appVersion: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'dev',
};

export function aiIsLive() {
  return env.aiMode === 'live' && Boolean(env.anthropicKey);
}
