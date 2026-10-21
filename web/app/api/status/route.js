import { aiAvailable, MODEL } from '../../../lib/core';
import { db } from '../../../lib/supabase';
import { json, options } from '../../../lib/http';

export const dynamic = 'force-dynamic';
export const OPTIONS = options;

export async function GET() {
  return json({ ai: aiAvailable(), model: aiAvailable() ? MODEL : null, db: Boolean(db()) });
}
