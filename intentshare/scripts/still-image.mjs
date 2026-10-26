// CHI submission still image (≥1920×1080, plan §11.1) and paper figures: renders presentation mode
// with a sample share open (sender preview) and the received card (receiver view).
//   BASE=https://<your-app>.vercel.app SAMPLE=S10 node scripts/still-image.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE || 'http://localhost:3000';
const SAMPLE = process.env.SAMPLE || 'S10';
const OUT = process.env.OUT || 'figures';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, colorScheme: process.env.DARK ? 'dark' : 'light' });
await p.goto(BASE + '/present');
await p.waitForSelector('#gate', { state: 'hidden' });
await p.click('#plusbtn');
const boot = await (await fetch(BASE + '/api/bootstrap')).json();
const idx = boot.scenarios.findIndex((x) => x.id === SAMPLE);
if (idx < 0) throw new Error('unknown sample ' + SAMPLE);
await p.locator('#plusmenu [data-track=plus-sample]').nth(idx).click();
await p.click('#send');
await p.waitForSelector('.sh-foot .btn.pri:not([disabled])', { timeout: 60000 });
await p.screenshot({ path: `${OUT}/${SAMPLE}-sender-preview.png` });
await p.click('[data-track=send-card]');
await p.click('#v-b');
await p.waitForTimeout(800);
await p.screenshot({ path: `${OUT}/${SAMPLE}-receiver.png` });
const card = p.locator('.thread .row.them .rich').last();
await card.screenshot({ path: `${OUT}/${SAMPLE}-card.png` });
console.log('saved to', OUT);
await b.close();
