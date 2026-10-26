// Spins up an in-memory Postgres (PGlite) with the Supabase roles and our migrations applied.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '../../supabase/migrations');
export const TEST_KEY = 'test-server-key-0123456789abcdef0123456789';

export async function makeDb(dataDir) {
  const db = new PGlite(dataDir);
  await db.exec(`do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  end $$;`);
  for (const f of readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIG, f), 'utf8'));
  }
  await db.query(`insert into study.config(key,value) values ('server_key',$1) on conflict (key) do update set value=excluded.value`, [TEST_KEY]);
  return db;
}

export function apiOf(db, key = TEST_KEY) {
  return async (op, args = {}) => {
    const r = await db.query('select public.intentshare_api($1,$2,$3::jsonb) as r', [key, op, JSON.stringify(args)]);
    return r.rows[0].r;
  };
}
