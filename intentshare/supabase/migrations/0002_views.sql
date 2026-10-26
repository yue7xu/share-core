-- Derived research measures (plan §6.4). Everything here is computed from the append-only
-- event log, so a fix to a definition re-computes history. Durations inside one device use
-- perf_ms (monotonic); durations across two devices use clock-aligned timestamps.

-- Events with client time corrected by the session's measured clock offset.
create or replace view study.v_events_aligned with (security_invoker = true) as
select e.*,
       e.client_ts + make_interval(secs => coalesce(s.clock_offset_ms, 0) / 1000.0) as aligned_ts
from study.events e
left join study.sessions s on s.id = e.session_id;

-- One row per share (a composition that contained a link): how long each step took and how many clicks.
create or replace view study.v_share_funnel with (security_invoker = true) as
with ev as (
  select * from study.events where draft_id is not null and not excluded
), agg as (
  select draft_id,
    min(perf_ms) filter (where type in ('compose.focus','compose.input','compose.paste','compose.attach','compose.sample_loaded','compose.plus_open')) as p_compose,
    min(perf_ms) filter (where type = 'share.link_detected')  as p_link,
    min(perf_ms) filter (where type = 'share.trigger_shown')  as p_trigger,
    min(perf_ms) filter (where type = 'share.sheet_opened')   as p_open,
    min(perf_ms) filter (where type = 'share.intent_shown')   as p_intent,
    min(perf_ms) filter (where type = 'share.card_ready')     as p_card,
    max(perf_ms) filter (where type in ('share.sent_card','share.sent_plain','share.closed')) as p_end,
    coalesce(sum((payload->>'keys')::int)    filter (where type = 'compose.input'), 0) as keystrokes,
    coalesce(sum((payload->>'deletes')::int) filter (where type = 'compose.input'), 0) as deletes,
    count(*) filter (where type = 'compose.paste')            as pastes,
    count(*) filter (where type = 'share.regenerate')         as regenerations,
    count(*) filter (where type = 'share.intent_edited')      as intent_edits,
    count(*) filter (where type = 'share.type_changed')       as type_changes,
    count(*) filter (where type = 'share.evidence_hover')     as evidence_hovers,
    bool_or(type = 'share.gap_shown')                         as gap_shown,
    bool_or(type = 'share.gap_answered')                      as gap_answered,
    coalesce(sum((payload->>'wait_ms')::numeric) filter (where type = 'ai.response'), 0) as ai_wait_ms,
    count(*) filter (where type = 'ai.error')                 as ai_errors,
    max((payload->>'max_ratio')::numeric) filter (where type = 'share.preview_scroll') as preview_scroll_max
  from ev group by draft_id
), clicks as (
  -- clicks between the first composer interaction (minus 100 ms: the click that started it) and the decision
  select a.draft_id,
         count(*) filter (where e.perf_ms >= a.p_compose - 100 and e.perf_ms <= a.p_end + 50) as clicks_total,
         count(*) filter (where e.perf_ms >= a.p_open and e.perf_ms <= a.p_end + 50) as clicks_in_preview,
         count(*) filter (where e.perf_ms >= a.p_compose - 100 and e.perf_ms < coalesce(a.p_open, a.p_end)) as clicks_before_preview
  from agg a join ev e on e.draft_id = a.draft_id and e.type = 'ui.click'
  group by a.draft_id
)
select s.id as share_id, s.participant_id, p.code as participant_code, p.pair_id, s.conversation_id,
       s.condition, s.trigger_kind, s.scenario_id, s.expected_type, s.outcome, s.data_origin, s.created_at,
       s.message_text, s.link_url,
       round(((a.p_trigger - a.p_compose) / 1000)::numeric, 3) as s_compose_to_trigger,
       round(((a.p_open    - a.p_trigger) / 1000)::numeric, 3) as s_trigger_to_open,
       round(((a.p_intent  - a.p_open)    / 1000)::numeric, 3) as s_open_to_intent,
       round(((a.p_card    - a.p_open)    / 1000)::numeric, 3) as s_open_to_card,
       round(((a.p_end     - a.p_card)    / 1000)::numeric, 3) as s_card_to_decision,
       round(((a.p_end     - a.p_open)    / 1000)::numeric, 3) as s_in_preview,
       round(((a.p_end     - a.p_compose) / 1000)::numeric, 3) as s_total,
       coalesce(c.clicks_total, 0) as clicks_total, coalesce(c.clicks_before_preview, 0) as clicks_before_preview,
       coalesce(c.clicks_in_preview, 0) as clicks_in_preview,
       a.keystrokes, a.deletes, a.pastes, a.regenerations, a.intent_edits, a.type_changes, a.evidence_hovers,
       a.gap_shown, a.gap_answered, round(a.ai_wait_ms / 1000, 3) as s_ai_wait, a.ai_errors, a.preview_scroll_max,
       (s.outcome = 'sent_card' and a.regenerations = 0 and a.intent_edits = 0 and a.type_changes = 0) as sent_unchanged
from study.shares s
join study.participants p on p.id = s.participant_id
left join agg a on a.draft_id = s.id
left join clicks c on c.draft_id = s.id
where not s.excluded;

-- Step-by-step timeline of one share: every meaningful step, how long until the next, clicks in between.
create or replace view study.v_share_timeline with (security_invoker = true) as
with steps as (
  select e.draft_id, e.id as event_id, e.type as step, e.client_ts, e.perf_ms, e.payload,
         lead(e.perf_ms) over (partition by e.draft_id order by e.perf_ms, e.seq) as next_perf,
         row_number()    over (partition by e.draft_id order by e.perf_ms, e.seq) as step_no
  from study.events e
  where e.draft_id is not null and not e.excluded
    and e.type not in ('ui.click','ui.key','compose.input','app.visibility','app.focus','app.blur')
)
select st.draft_id as share_id, st.step_no, st.step, st.client_ts as started_at,
       round(((st.next_perf - st.perf_ms) / 1000)::numeric, 3) as duration_s,
       (select count(*) from study.events c
         where c.draft_id = st.draft_id and c.type = 'ui.click'
           and c.perf_ms >= st.perf_ms and c.perf_ms < coalesce(st.next_perf, 'infinity'::float8)) as clicks,
       (select coalesce(sum((c.payload->>'keys')::int), 0) from study.events c
         where c.draft_id = st.draft_id and c.type = 'compose.input'
           and c.perf_ms >= st.perf_ms and c.perf_ms < coalesce(st.next_perf, 'infinity'::float8)) as keystrokes,
       st.payload
from steps st;

-- One row per shared item (AI card or plain link) from the receiver's side.
create or replace view study.v_receiver_timeline with (security_invoker = true) as
with items as (
  select m.id as message_id, m.kind, m.card_id, m.share_id, m.conversation_id, m.sender_id, m.server_ts as delivered_at,
         m.data_origin
  from study.messages m where m.kind in ('card','plain') and not m.excluded
), recv as (
  select i.*, r.id as receiver_id, r.code as receiver_code, s.pair_id
  from items i
  join study.participants s on s.id = i.sender_id
  join study.participants r on r.pair_id = s.pair_id and r.id <> s.id
), ev as (
  select r.message_id,
    min(e.aligned_ts) filter (where e.type = 'card.rendered')     as rendered_at,
    min(e.aligned_ts) filter (where e.type = 'card.seen')         as seen_at,
    min(e.aligned_ts) filter (where e.type = 'card.chip_click')   as first_chip_at,
    count(*) filter (where e.type = 'card.chip_click')            as chip_clicks,
    count(*) filter (where e.type = 'card.open_original')         as open_original_clicks,
    count(*) filter (where e.type = 'card.action_click')          as action_clicks,
    coalesce(sum((e.payload->>'dwell_ms')::numeric) filter (where e.type = 'card.dwell'), 0) as dwell_ms,
    jsonb_agg(e.payload->'anchor_index') filter (where e.type = 'card.chip_click') as chips_clicked
  from recv r
  join study.v_events_aligned e on e.message_id = r.message_id and e.participant_id = r.receiver_id and not e.excluded
  group by r.message_id
)
select r.message_id, r.kind, r.card_id, r.share_id, r.conversation_id, r.pair_id, r.sender_id, r.receiver_id, r.receiver_code,
       r.data_origin, r.delivered_at, ev.rendered_at, ev.seen_at, ev.first_chip_at,
       reply.reply_at,
       round(extract(epoch from (ev.seen_at - r.delivered_at))::numeric, 3)       as s_delivered_to_seen,
       round(extract(epoch from (ev.first_chip_at - ev.seen_at))::numeric, 3)     as s_seen_to_first_chip,
       round(extract(epoch from (reply.reply_at - ev.seen_at))::numeric, 3)       as s_seen_to_reply,
       round(extract(epoch from (reply.reply_at - r.delivered_at))::numeric, 3)   as s_delivered_to_reply,
       coalesce(ev.chip_clicks, 0) as chip_clicks, coalesce(ev.open_original_clicks, 0) as open_original_clicks,
       coalesce(ev.action_clicks, 0) as action_clicks, round(coalesce(ev.dwell_ms, 0) / 1000, 3) as s_dwell,
       ev.chips_clicked, reply.reply_kind, reply.reply_text
from recv r
left join ev on ev.message_id = r.message_id
left join lateral (
  select m2.server_ts as reply_at, m2.kind as reply_kind, m2.text as reply_text
  from study.messages m2
  where m2.conversation_id = r.conversation_id and m2.sender_id = r.receiver_id and m2.server_ts > r.delivered_at
  order by m2.server_ts limit 1
) reply on true;

-- Every AI call with quality fields (expected type comes from the sample or the eval item).
create or replace view study.v_ai_quality with (security_invoker = true) as
select a.id as ai_call_id, a.share_id, a.participant_id, a.eval_run_id, a.task, a.attempt, a.model, a.prompt_version,
       a.latency_ms, a.input_tokens, a.output_tokens, a.cache_read_tokens, a.cache_write_tokens,
       a.stop_reason, a.error, a.data_origin, a.created_at,
       a.normalized->>'primary'    as ai_primary,
       a.normalized->>'secondary'  as ai_secondary,
       a.normalized->>'confidence' as ai_confidence,
       jsonb_array_length(coalesce(a.normalized->'anchors', '[]'::jsonb)) as n_anchors,
       (a.normalized->>'fallback')::boolean as fallback,
       (a.normalized->'gapQuestion') is not null and a.normalized->'gapQuestion' <> 'null'::jsonb as gap_question,
       coalesce(a.meta->>'expected', s.expected_type) as expected_type,
       coalesce(a.meta->>'scenario', s.scenario_id)   as scenario_id,
       case when coalesce(a.meta->>'expected', s.expected_type) is null or a.task <> 'intent' then null
            else a.normalized->>'primary' = coalesce(a.meta->>'expected', s.expected_type) end as primary_match
from study.ai_calls a
left join study.shares s on s.id = a.share_id
where not a.excluded;

-- Intent transfer fidelity inputs, one row per sent share (brief §10).
create or replace view study.v_intent_fidelity with (security_invoker = true) as
select s.id as share_id, s.participant_id as sender_id, p.pair_id, s.condition, s.outcome, s.data_origin, s.created_at,
       s.message_text, s.link_url,
       c.card->'intent'->>'primary'   as ai_primary,
       c.card->'intent'->>'secondary' as ai_secondary,
       max(sa.value) filter (where sa.item = 'm1a' and not sa.skipped)         as m1a,
       max(sa.value) filter (where sa.item = 'm1b' and not sa.skipped)         as m1b,
       max(sa.value) filter (where sa.item = 'm2'  and not sa.skipped)         as m2,
       max(sa.value) filter (where sa.item = 'post_rating' and not sa.skipped) as post_rating,
       max(sa.id::text) filter (where sa.item = 'm1a') as m1a_answer_id,
       max(sa.id::text) filter (where sa.item = 'm2')  as m2_answer_id
from study.shares s
join study.participants p on p.id = s.participant_id
left join study.cards c on c.id = s.final_card_id
left join study.survey_answers sa on sa.share_id = s.id and not sa.excluded
where s.outcome in ('sent_card','sent_plain') and not s.excluded
group by s.id, p.pair_id, c.card;

-- Per participant per day (study timezone): shares sent and active minutes, for the ≥3 shares/day check.
create or replace view study.v_daily_compliance with (security_invoker = true) as
select p.id as participant_id, p.code as participant_code, p.pair_id, p.data_origin,
       (e.client_ts at time zone coalesce(ss.tz, 'America/New_York'))::date as day,
       count(distinct e.draft_id) filter (where e.type in ('share.sent_card','share.sent_plain')) as shares_sent,
       count(distinct e.message_id) filter (where e.type = 'msg.sent') as messages_sent,
       count(distinct date_trunc('minute', e.client_ts)) as active_minutes,
       count(distinct e.session_id) as sessions
from study.events e
join study.participants p on p.id = e.participant_id
left join study.sessions ss on ss.id = e.session_id
where not e.excluded
group by p.id, p.code, p.pair_id, p.data_origin, day;

-- Logging health: missing sequence numbers, clock problems, late arrivals.
create or replace view study.v_data_quality with (security_invoker = true) as
select e.session_id, s.participant_id, s.mode, s.started_at,
       count(*) as events,
       max(e.seq) - min(e.seq) + 1 - count(distinct e.seq) as missing_seq,
       count(*) filter (where e.client_ts > e.server_ts + interval '2 minutes') as client_ahead,
       max(extract(epoch from (e.server_ts - e.client_ts))) as max_upload_delay_s,
       s.clock_offset_ms
from study.events e
left join study.sessions s on s.id = e.session_id
group by e.session_id, s.participant_id, s.mode, s.started_at, s.clock_offset_ms;
