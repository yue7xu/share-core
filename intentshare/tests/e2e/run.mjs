// End-to-end: real browser against a running server (default http://localhost:3100, mock AI + PGlite,
// ADMIN_TOKEN=local-admin). Checks the whole data path: UI -> API -> DB -> derived views.
//   BASE=http://localhost:3100 ADMIN=local-admin node tests/e2e/run.mjs
import { createRequire } from 'node:module';
// Playwright is preinstalled globally in CI/dev images; locally: npm i -D playwright
const { chromium } = createRequire(import.meta.url)('playwright');
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3100';
const ADMIN = process.env.ADMIN || 'local-admin';
const SHOTS = process.env.SHOTS || 'test-results';
mkdirSync(SHOTS, { recursive: true });
const admin = async (op, body) => {
  const r = await fetch(`${BASE}/api/admin/${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN}` }, body: JSON.stringify(body || {}) });
  const j = await r.json(); if (!r.ok) throw new Error(op + ' ' + JSON.stringify(j)); return j;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('·', ...a);

const browser = await chromium.launch();
const errors = [];
const page = async (ctx) => { const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(String(e))); return p; };

try {
  /* ---------------- 1. Demo: one screen, A shares S1, edits intent, sends; B sees, clicks, replies ---------------- */
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const p = await page(ctx);
  await p.goto(`${BASE}/demo`);
  await p.waitForSelector('#gate', { state: 'hidden' });
  await p.click('#plusbtn');
  await p.click('#plusmenu [data-track=plus-sample] >> nth=0');           // S1
  await p.click('#send');
  await p.waitForSelector('.sh-foot .btn.pri:not([disabled])', { timeout: 15000 });
  await p.hover('.cue >> nth=0').catch(() => {});
  await p.screenshot({ path: `${SHOTS}/1-demo-preview.png` });
  await p.click('[data-track=change-intent]');
  await p.selectOption('#ed-type', 'SUGGEST·activity');
  await p.fill('#ed-line', '想让你自己去试试');
  await p.click('[data-track=regenerate]');
  await p.waitForSelector('.sh-foot .btn.pri:not([disabled])', { timeout: 15000 });
  await p.click('[data-track=send-card]');
  await p.waitForSelector('.thread .rich >> nth=1');
  await p.click('#v-b');
  await wait(1600);                                   // card.seen needs 1 s in view
  const [pop] = await Promise.all([ctx.waitForEvent('page', { timeout: 3000 }).catch(() => null), p.click('.thread .row.them .anc >> nth=-1')]);
  if (pop) await pop.close();
  await p.fill('#input', '好呀 周六去');
  await p.click('#send');
  await wait(300);
  await p.screenshot({ path: `${SHOTS}/2-demo-receiver.png` });
  await p.evaluate(() => T.flush());
  await wait(1500);
  const demoShares = await admin('query', { view: 'v_share_funnel', origin: 'demo', limit: 50 });
  const f = demoShares.find((r) => r.scenario_id === 'S1');
  assert.ok(f, 'S1 share row exists');
  log('demo funnel', JSON.stringify({ outcome: f.outcome, compose_to_trigger: f.s_compose_to_trigger, open_to_card: f.s_open_to_card, in_preview: f.s_in_preview, clicks: f.clicks_total, in_preview_clicks: f.clicks_in_preview, regen: f.regenerations, type_changes: f.type_changes, edits: f.intent_edits }));
  assert.equal(f.outcome, 'sent_card');
  assert.equal(f.regenerations, 1);
  assert.equal(f.type_changes, 1);
  assert.equal(f.intent_edits, 1);
  assert.ok(f.clicks_total >= 5, 'clicks counted');
  assert.ok(Number(f.s_open_to_card) > 0, 'timing computed');
  const recv = await admin('query', { view: 'v_receiver_timeline', share_id: f.share_id });
  log('demo receiver', JSON.stringify(recv.map((r) => ({ seen: !!r.seen_at, chips: r.chip_clicks, reply: r.reply_text, s_seen_to_reply: r.s_seen_to_reply }))));
  assert.equal(recv[0].chip_clicks, 1);
  assert.ok(recv[0].seen_at, 'card.seen logged');
  assert.equal(recv[0].reply_text, '好呀 周六去');
  const ai = await admin('query', { view: 'v_ai_quality', share_id: f.share_id });
  assert.ok(ai.some((r) => r.task === 'intent' && r.primary_match === true), 'intent call logged with expected type');
  assert.equal(ai.filter((r) => r.task === 'extract').length, 2, 'two extract calls (original + regenerate)');
  const detail = await admin('share_detail', { share_id: f.share_id });
  assert.equal(detail.versions.length, 2, 'two card versions');
  assert.ok(detail.ai_calls[0].system_prompt && detail.ai_calls[0].user_prompt, 'full prompt stored');
  assert.ok(detail.events.some((e) => e.type === 'compose.input' && e.payload.text), 'draft text snapshot stored');
  await ctx.close();

  /* ---------------- 2. Study: two devices, sync, surveys, exclude ---------------- */
  const pair = await admin('pair_create', { label: 'E2E pair', names: { A: 'Ana', B: 'Bo' }, relationship_type: 'friends', data_origin: 'pilot', study_days: 3 });
  const ca = await browser.newContext({ viewport: { width: 1200, height: 820 } });
  const cb = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const a = await page(ca), b = await page(cb);
  await a.goto(`${BASE}/join`);
  await a.fill('.codein', pair.A.code.toLowerCase());
  await a.click('#gate .btn.pri');
  await a.waitForSelector('#gate', { state: 'hidden' });
  await b.goto(`${BASE}/join?code=${pair.B.code}`);
  await b.waitForSelector('#gate', { state: 'hidden' });
  assert.equal(await a.textContent('#top-name'), 'Bo');
  assert.equal(await a.isHidden('#viewseg'), true);
  // A types a message, then a link on its own (merged within 60 s)
  await a.click('#input'); await a.keyboard.type('这个视频说的对，我们以后协作应该也采用这样的模式');
  await a.keyboard.press('Enter');
  await a.click('#input'); await a.keyboard.type('https://www.youtube.com/watch?v=S-sYlFiGFv8');
  await a.waitForSelector('.trig:not([hidden])');
  await a.click('#send');
  await a.waitForSelector('.sh-foot .btn.pri:not([disabled])', { timeout: 15000 });
  await a.screenshot({ path: `${SHOTS}/3-study-sender-preview.png` });
  await a.click('[data-track=send-card]');
  await a.waitForSelector('.survey');
  await a.fill('[data-track=survey-m1a]', 'agree with the async principle');
  await a.click('[data-track=survey-m1b] >> nth=3');
  await a.click('[data-track=survey-submit]');
  // B receives through sync, sees it, answers m2, replies
  await b.waitForSelector('.thread .rich', { timeout: 8000 });
  await wait(1500);
  await b.waitForSelector('.survey', { timeout: 5000 });
  await b.screenshot({ path: `${SHOTS}/4-study-receiver-phone.png` });
  await b.fill('[data-track=survey-m2]', 'he likes the way of working in the video');
  await b.click('[data-track=survey-submit]');
  await b.fill('#input', 'yes let us try async updates'); await b.click('#send');
  await a.waitForSelector('.thread .row.them .bub >> text=yes let us try', { timeout: 8000 });
  // baseline day: plain link preview, no card
  await admin('pair_update', { pair_id: pair.pair.id, condition_mode: 'baseline' });
  await wait(2500);
  await a.fill('#input', 'fyi https://reddit.example.com/r/f1visa/comments/opt_changes_915');
  await a.click('#send');
  await b.waitForSelector('.thread .lp', { timeout: 8000 });
  await a.screenshot({ path: `${SHOTS}/5-study-baseline.png` });
  // exclude the baseline message
  await a.hover('.thread .row.me >> nth=-1');
  await a.click('.thread .row.me >> nth=-1 >> [data-track=exclude-message]');
  await a.waitForSelector('text=Excluded from study');
  // offline: the message is queued and delivered after reconnecting (same id, no duplicate)
  await ca.setOffline(true);
  await a.fill('#input', 'sent while offline'); await a.click('#send'); await wait(800);
  await ca.setOffline(false);
  await b.waitForSelector('.thread >> text=sent while offline', { timeout: 20000 });
  assert.equal(await b.locator('.thread >> text=sent while offline').count(), 1, 'delivered once');
  for (const x of [a, b]) await x.evaluate(() => T.flush());
  await wait(1500);
  const fid = await admin('query', { view: 'v_intent_fidelity', origin: 'pilot', limit: 20 });
  log('fidelity', JSON.stringify(fid.map((r) => ({ cond: r.condition, ai: r.ai_primary, m1a: r.m1a, m1b: r.m1b, m2: r.m2 }))));
  const card = fid.find((r) => r.condition === 'ai');
  assert.equal(card.m1a, 'agree with the async principle');
  assert.equal(card.m1b, '4');
  assert.equal(card.m2, 'he likes the way of working in the video');
  const funnel = await admin('query', { view: 'v_share_funnel', origin: 'pilot', limit: 20 });
  log('study funnel', JSON.stringify(funnel.map((r) => ({ cond: r.condition, trig: r.trigger_kind, outcome: r.outcome, total_s: r.s_total, clicks: r.clicks_total, keys: r.keystrokes }))));
  assert.ok(funnel.some((r) => r.trigger_kind === 'merged_previous' && r.outcome === 'sent_card'));
  assert.equal(funnel.filter((r) => r.condition === 'baseline').length, 0, 'excluded baseline share is hidden');
  const daily = await admin('query', { view: 'v_daily_compliance', origin: 'pilot' });
  log('daily', JSON.stringify(daily.map((r) => ({ code: r.participant_code, shares: r.shares_sent, msgs: r.messages_sent, minutes: r.active_minutes }))));
  const dq = await admin('query', { view: 'v_data_quality' });
  assert.ok(dq.every((r) => Number(r.missing_seq) === 0), 'no missing event sequence numbers: ' + JSON.stringify(dq.map((r) => r.missing_seq)));
  await ca.close(); await cb.close();

  /* ---------------- 3. Booth: nothing logged ---------------- */
  const before = (await admin('overview', {})).totals;
  const cbooth = await browser.newContext(); const bo = await page(cbooth);
  await bo.goto(`${BASE}/booth`); await bo.waitForSelector('#gate', { state: 'hidden' });
  await bo.click('#plusbtn'); await bo.click('#plusmenu [data-track=plus-sample] >> nth=1');
  await bo.click('#send'); await bo.waitForSelector('.sh-foot .btn.pri:not([disabled])', { timeout: 15000 });
  await bo.click('[data-track=send-card]'); await bo.evaluate(() => T.flush()); await wait(800);
  const after = (await admin('overview', {})).totals;
  assert.equal(after.events, before.events, 'booth mode logs no events');
  assert.equal(after.ai_calls, before.ai_calls, 'booth mode logs no AI calls');
  await cbooth.close();

  assert.deepEqual(errors, [], 'no page errors');
  console.log('\nE2E PASSED');
} catch (e) {
  console.error('\nE2E FAILED:', e.message);
  if (errors.length) console.error('page errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
