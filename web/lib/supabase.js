import { createClient } from '@supabase/supabase-js';

let client = null;

export function db() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return null;
  if (!client) {
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export async function rpc(name, args) {
  const c = db();
  if (!c) throw new Error('Database is not configured');
  const { data, error } = await c.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
