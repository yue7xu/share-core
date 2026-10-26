import { DbError } from './db';

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function body<T = any>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { return {} as T; }
}

export function fail(e: unknown) {
  if (e instanceof DbError) return json({ error: e.status === 503 ? 'db_unavailable' : 'db_error', detail: e.message }, e.status);
  console.error(e);
  return json({ error: 'server_error' }, 500);
}

export const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);
