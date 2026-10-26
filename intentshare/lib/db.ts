// The only way the server touches the database: public.intentshare_api(p_key, p_op, p_args).
// Production: Supabase REST RPC with the publishable key + SERVER_RPC_KEY.
// Local dev / tests: the same SQL running in PGlite (in-process Postgres).
import { env } from './env';

export class DbError extends Error {
  constructor(message: string, public status = 500) { super(message); }
}

type Api = (op: string, args?: unknown) => Promise<any>;
let local: Promise<Api> | null = null;

async function pglite(): Promise<Api> {
  const { PGlite } = await import('@electric-sql/pglite');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dir = path.join(process.cwd(), '.data', 'pglite');
  const fresh = !fs.existsSync(dir);
  fs.mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir);
  if (fresh) {
    await db.exec(`do $$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
    end $$;`);
  }
  const migDir = path.join(process.cwd(), 'supabase', 'migrations');
  for (const f of fs.readdirSync(migDir).filter((f: string) => f.endsWith('.sql')).sort()) {
    await db.exec(fs.readFileSync(path.join(migDir, f), 'utf8'));
  }
  const key = env.serverKey || 'local-dev-server-key-0123456789abcdef';
  await db.query(`insert into study.config(key,value) values ('server_key',$1) on conflict (key) do update set value=excluded.value`, [key]);
  return async (op, args = {}) => {
    try {
      const r = await db.query<{ r: any }>('select public.intentshare_api($1,$2,$3::jsonb) as r', [key, op, JSON.stringify(args)]);
      return r.rows[0].r;
    } catch (e: any) {
      throw new DbError(e.message || 'db error', e.message === 'forbidden' ? 403 : 500);
    }
  };
}

export async function api(op: string, args: unknown = {}): Promise<any> {
  if (env.dbMode === 'pglite') {
    local ||= pglite();
    return (await local)(op, args);
  }
  if (!env.supabaseUrl || !env.supabaseKey || !env.serverKey) throw new DbError('Database is not configured', 503);
  const res = await fetch(`${env.supabaseUrl}/rest/v1/rpc/intentshare_api`, {
    method: 'POST',
    headers: { apikey: env.supabaseKey, Authorization: `Bearer ${env.supabaseKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_key: env.serverKey, p_op: op, p_args: args }),
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { msg = JSON.parse(text).message || text; } catch {}
    throw new DbError(msg.slice(0, 300), res.status === 401 || /forbidden/.test(msg) ? 403 : 500);
  }
  return text ? JSON.parse(text) : null;
}
