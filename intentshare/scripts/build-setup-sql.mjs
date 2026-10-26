// Concatenates the migrations into supabase/setup.sql (one paste into the Supabase SQL editor).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('../supabase/migrations/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const head = `-- IntentShare: full database setup (generated from supabase/migrations by scripts/build-setup-sql.mjs).
-- Paste into Supabase → SQL Editor → Run. Safe to re-run. Then set the server key (docs/SETUP.md step 3).\n\n`;
writeFileSync(new URL('../supabase/setup.sql', import.meta.url), head + files.map((f) => `-- ===== ${f} =====\n` + readFileSync(new URL(f, dir), 'utf8')).join('\n'));
console.log('supabase/setup.sql from', files.join(', '));
