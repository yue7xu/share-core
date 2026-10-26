// End-to-end check of the data model: a pair, one AI share, the receiver's reaction, surveys,
// and the derived views (timings, clicks, fidelity). Runs on PGlite with the real migrations.
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID as uid } from 'node:crypto';
import { makeDb, apiOf } from './pglite.mjs';

let db, api, pair, A, B, conv;
const sessA = uid(), sessB = uid(), draft = uid(), cardId = uid(), msgCard = uid(), msgReply = uid();
const t0 = Date.now() - 60_000;
let seqA = 0, seqB = 0;
const evA = (type, perf, extra = {}) => ({ id: uid(), session_id: sessA, participant_id: A.id, conversation_id: conv,
  draft_id: draft, seq: ++seqA, type, client_ts: new Date(t0 + perf).toISOString(), perf_ms: perf, condition: 'ai', ...extra });
const evB = (type, perf, extra = {}) => ({ id: uid(), session_id: sessB, participant_id: B.id, conversation_id: conv,
  seq: ++seqB, type, client_ts: new Date(t0 + perf).toISOString(), perf_ms: perf, condition: 'ai', ...extra });

beforeAll(async () => {
  db = await makeDb();
  api = apiOf(db);
  pair = await api('admin_pair_create', { label: 'P01', names: { A: 'Ann', B: 'Ben' }, relationship_type: 'friends', study_days: 3 });
  A = pair.A; B = pair.B; conv = pair.conversation_id;
});

describe('study data model', () => {
  it('logs in with a code and records clock offset', async () => {
    const r = await api('session_start', { code: A.code.toLowerCase(), session: { id: sessA, client_now: Date.now() - 1500, tz: 'America/New_York', mode: 'study' } });
    expect(r.participant.id).toBe(A.id);
    expect(r.partner.id).toBe(B.id);
    expect(r.conversation_id).toBe(conv);
    expect(r.condition).toBe('ai');
    const s = await db.query('select clock_offset_ms from study.sessions where id=$1', [sessA]);
    expect(Math.abs(s.rows[0].clock_offset_ms - 1500)).toBeLessThan(500);
    await api('session_start', { code: B.code, session: { id: sessB, client_now: Date.now(), mode: 'study' } });
    expect((await api('session_start', { code: 'ZZZZZZ', session: { id: uid(), client_now: Date.now() } })).error).toBe('unknown_code');
  });

  it('stores a share, AI calls, the card and the message', async () => {
    await api('share_upsert', { id: draft, participant_id: A.id, conversation_id: conv, session_id: sessA, condition: 'ai',
      trigger_kind: 'same_message', message_text: 'let us go', link_url: 'https://x.example/a', scenario_id: 'S1', expected_type: 'PROPOSE·activity' });
    await api('ai_call_insert', { share_id: draft, participant_id: A.id, task: 'intent', model: 'mock', prompt_version: 'abc',
      normalized: { primary: 'PROPOSE·activity', confidence: 'high' }, latency_ms: 800, input_tokens: 900, output_tokens: 120 });
    await api('card_version_insert', { share_id: draft, version: 0, intent: { primary: 'PROPOSE·activity' }, extraction: { anchors: [] } });
    const card = { id: cardId, senderNote: 'let us go', intent: { primary: 'PROPOSE·activity' }, action: { type: 'time_options', payload: {} }, content: { title: 'Noodle Lab' }, regenerations: 1 };
    const m = await api('message_insert', { message: { id: msgCard, conversation_id: conv, sender_id: A.id, kind: 'card', text: 'let us go', card_id: cardId, share_id: draft, client_ts: new Date().toISOString() }, card });
    expect(m.card.id).toBe(cardId);
    expect(m.sender_role).toBe('A');
    await api('share_upsert', { id: draft, participant_id: A.id, conversation_id: conv, outcome: 'sent_card', final_card_id: cardId });
  });

  it('dedupes retried event batches and ignores unknown participants', async () => {
    const batch = [
      evA('compose.focus', 0), evA('compose.input', 1500, { payload: { keys: 9, deletes: 1, text: 'let us go' } }),
      evA('compose.paste', 2000, { payload: { has_url: true } }), evA('share.link_detected', 2001), evA('share.trigger_shown', 2002),
      evA('ui.click', 2600, { payload: { target: 'send' } }), evA('share.sheet_opened', 2700),
      evA('ai.request', 2710, { payload: { task: 'intent' } }), evA('ai.response', 3700, { payload: { task: 'intent', wait_ms: 990 } }),
      evA('share.intent_shown', 3710), evA('ai.response', 7700, { payload: { task: 'extract', wait_ms: 3990 } }),
      evA('share.card_ready', 7710), evA('ui.click', 9000, { payload: { target: 'change-intent' } }), evA('share.regenerate', 9500),
      evA('ui.click', 9500, { payload: { target: 'regenerate' } }), evA('share.card_ready', 12000),
      evA('ui.click', 14000, { payload: { target: 'send-card' } }), evA('share.sent_card', 14001, { card_id: cardId, message_id: msgCard }),
    ];
    expect((await api('events_insert', { events: batch })).inserted).toBe(batch.length);
    expect((await api('events_insert', { events: batch })).inserted).toBe(0);
    const bogus = [{ ...evA('ui.click', 1), participant_id: uid() }];
    expect((await api('events_insert', { events: bogus })).inserted).toBe(0);
  });

  it('computes the share funnel (durations, clicks, keystrokes)', async () => {
    const [f] = await api('admin_query', { view: 'v_share_funnel', share_id: draft });
    expect(f.outcome).toBe('sent_card');
    expect(Number(f.s_compose_to_trigger)).toBeCloseTo(2.002, 3);
    expect(Number(f.s_trigger_to_open)).toBeCloseTo(0.698, 3);
    expect(Number(f.s_open_to_intent)).toBeCloseTo(1.01, 3);
    expect(Number(f.s_open_to_card)).toBeCloseTo(5.01, 3);
    expect(Number(f.s_total)).toBeCloseTo(14.001, 3);
    expect(f.clicks_total).toBe(4);
    expect(f.clicks_before_preview).toBe(1);
    expect(f.clicks_in_preview).toBe(3);
    expect(f.keystrokes).toBe(9);
    expect(f.regenerations).toBe(1);
    expect(f.sent_unchanged).toBe(false);
    expect(Number(f.s_ai_wait)).toBeCloseTo(4.98, 2);
  });

  it('computes a step-by-step timeline', async () => {
    const t = await api('admin_query', { view: 'v_share_timeline', share_id: draft, limit: 100 });
    const steps = t.sort((a, b) => a.step_no - b.step_no).map((r) => r.step);
    expect(steps[0]).toBe('compose.focus');
    expect(steps.at(-1)).toBe('share.sent_card');
    const regen = t.find((r) => r.step === 'share.regenerate');
    expect(Number(regen.duration_s)).toBeCloseTo(2.5, 3);
    expect(regen.clicks).toBe(1);
  });

  it('computes the receiver timeline across devices', async () => {
    await api('events_insert', { events: [
      evB('card.rendered', 15000, { card_id: cardId, message_id: msgCard }),
      evB('card.seen', 16000, { card_id: cardId, message_id: msgCard }),
      evB('card.chip_click', 20000, { card_id: cardId, message_id: msgCard, payload: { anchor_index: 1 } }),
      evB('card.dwell', 25000, { card_id: cardId, message_id: msgCard, payload: { dwell_ms: 9000 } }),
    ] });
    await api('message_insert', { message: { id: msgReply, conversation_id: conv, sender_id: B.id, kind: 'text', text: 'Sat works', client_ts: new Date().toISOString() } });
    const [r] = await api('admin_query', { view: 'v_receiver_timeline', share_id: draft });
    expect(r.receiver_id).toBe(B.id);
    expect(r.chip_clicks).toBe(1);
    expect(Number(r.s_dwell)).toBe(9);
    expect(Number(r.s_seen_to_first_chip)).toBeCloseTo(4, 1);
    expect(r.reply_text).toBe('Sat works');
    expect(r.reply_at).not.toBeNull();
  });

  it('syncs messages to the partner and lists surveys', async () => {
    const s = await api('sync', { participant_id: B.id });
    expect(s.messages.map((m) => m.id)).toEqual([msgCard, msgReply]);
    const later = await api('sync', { participant_id: B.id, since: s.messages[1].server_ts });
    expect(later.messages.length).toBe(0);
    await api('survey_insert', { id: uid(), participant_id: A.id, share_id: draft, card_id: cardId, item: 'm1a', value: 'plan a dinner' });
    await api('survey_insert', { id: uid(), participant_id: B.id, share_id: draft, card_id: cardId, item: 'm2', value: 'wants to go eat together' });
    const [f] = await api('admin_query', { view: 'v_intent_fidelity', share_id: draft });
    expect(f.m1a).toBe('plan a dinner');
    expect(f.m2).toBe('wants to go eat together');
    expect(f.ai_primary).toBe('PROPOSE·activity');
    expect(await api('pending_surveys', { participant_id: A.id, delay_h: 0 })).toHaveLength(1);
  });

  it('reports AI quality against the sample\'s expected type', async () => {
    const [q] = await api('admin_query', { view: 'v_ai_quality', share_id: draft });
    expect(q.primary_match).toBe(true);
    expect(q.scenario_id).toBe('S1');
  });

  it('excludes a message from every analysis', async () => {
    await api('message_exclude', { message_id: msgCard, participant_id: A.id });
    expect(await api('admin_query', { view: 'v_share_funnel', share_id: draft })).toHaveLength(0);
    expect(await api('admin_query', { view: 'v_ai_quality', share_id: draft })).toHaveLength(0);
    const ev = await db.query('select count(*)::int n from study.events where draft_id=$1 and not excluded', [draft]);
    expect(ev.rows[0].n).toBe(0);
  });

  it('locks a participant after the study period and deletes on withdrawal', async () => {
    await api('admin_pair_update', { pair_id: pair.pair.id, study_ends_at: new Date(Date.now() - 1000).toISOString() });
    const r = await api('message_insert', { message: { id: uid(), conversation_id: conv, sender_id: A.id, kind: 'text', text: 'late' } });
    expect(r.error).toBe('locked');
    await api('admin_withdraw', { participant_id: A.id });
    const left = await db.query('select (select count(*) from study.events where participant_id=$1)::int e, (select count(*) from study.messages where sender_id=$1)::int m', [A.id]);
    expect(left.rows[0]).toEqual({ e: 0, m: 0 });
    expect((await api('session_start', { code: A.code, session: { id: uid(), client_now: Date.now() } })).error).toBe('withdrawn');
  });

  it('supports dated condition schedules and demo sessions', async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const p2 = await api('admin_pair_create', { label: 'P02', condition_mode: 'schedule',
      condition_schedule: [{ from: '2000-01-01', condition: 'ai' }, { from: today, condition: 'baseline' }] });
    const s = await api('session_start', { code: p2.B.code, session: { id: uid(), client_now: Date.now() } });
    expect(s.condition).toBe('baseline');
    const d = await api('session_start', { demo: true, session: { id: uid(), client_now: Date.now(), mode: 'demo' } });
    expect(d.participant.data_origin).toBe('demo');
    expect(d.partner.role).toBe('B');
  });
});
