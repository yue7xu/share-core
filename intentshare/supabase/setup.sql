-- IntentShare: full database setup (generated from supabase/migrations by scripts/build-setup-sql.mjs).
-- Paste into Supabase → SQL Editor → Run. Safe to re-run. Then set the server key (docs/SETUP.md step 3).

-- ===== 0001_study_schema.sql =====
-- IntentShare study schema (plan §6.3).
-- All tables live in schema `study`, which is NOT exposed through the Supabase Data API.
-- The only entry point is public.intentshare_api(p_key, p_op, p_args), a SECURITY DEFINER
-- dispatcher that first checks p_key against study.config('server_key'). That key exists only
-- in the database and in the Vercel server environment, never in the browser or in git.

create schema if not exists study;
revoke all on schema study from public, anon, authenticated;

create table if not exists study.config (
  key   text primary key,
  value text not null
);

-- ---------------------------------------------------------------- people
create table if not exists study.pairs (
  id                  uuid primary key default gen_random_uuid(),
  label               text not null,
  condition_mode      text not null default 'ai' check (condition_mode in ('ai','baseline','schedule')),
  condition_schedule  jsonb not null default '[]'::jsonb,   -- [{"from":"2026-12-01","condition":"ai"}, ...] dates in study tz
  relationship_type   text,
  known_duration      text,
  data_origin         text not null default 'study' check (data_origin in ('study','pilot','demo','author','booth','eval')),
  notes               text,
  created_at          timestamptz not null default now()
);

create table if not exists study.participants (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,                    -- 6-char login code; the only identity
  pair_id         uuid not null references study.pairs(id) on delete cascade,
  role            text not null check (role in ('A','B')),
  display_name    text not null,
  data_origin     text not null default 'study',
  enrolled_at     timestamptz not null default now(),
  study_ends_at   timestamptz,
  withdrawn_at    timestamptz,
  unique (pair_id, role)
);

create table if not exists study.sessions (
  id               uuid primary key,                       -- client generated
  participant_id   uuid not null references study.participants(id) on delete cascade,
  started_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  ended_at         timestamptz,
  user_agent       text,
  viewport         text,
  tz               text,
  clock_offset_ms  integer,                                -- server_time - client_time at start
  app_version      text,
  mode             text                                     -- study | demo | booth | presentation
);

create table if not exists study.conversations (
  id          uuid primary key default gen_random_uuid(),
  pair_id     uuid not null unique references study.pairs(id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- content + AI
create table if not exists study.shares (
  id               uuid primary key,                       -- = draft id from the client
  participant_id   uuid not null references study.participants(id) on delete cascade,
  conversation_id  uuid not null references study.conversations(id) on delete cascade,
  session_id       uuid,
  condition        text not null,
  trigger_kind     text,                                   -- same_message | merged_previous | link_only | baseline_send
  message_text     text,                                   -- verbatim intent text used
  link_url         text,
  scenario_id      text,                                   -- S1..S17 when loaded from a sample
  expected_type    text,                                   -- what the sample was written for (never sent to the AI)
  outcome          text check (outcome in ('sent_card','sent_plain','closed','abandoned')),
  final_card_id    uuid,
  data_origin      text not null default 'study',
  excluded         boolean not null default false,
  created_at       timestamptz not null default now(),
  closed_at        timestamptz
);

create table if not exists study.cards (
  id               uuid primary key,
  share_id         uuid not null references study.shares(id) on delete cascade,
  sender_id        uuid not null references study.participants(id) on delete cascade,
  conversation_id  uuid not null references study.conversations(id) on delete cascade,
  card             jsonb not null,                         -- ShareCard (brief §4.2), verbatim
  status           text not null default 'sent',
  regenerations    integer not null default 0,
  replaced_by      uuid,
  data_origin      text not null default 'study',
  excluded         boolean not null default false,
  created_at       timestamptz not null default now()
);

create table if not exists study.card_versions (
  id              uuid primary key default gen_random_uuid(),
  share_id        uuid not null references study.shares(id) on delete cascade,
  version         integer not null,                        -- 0 = first generation
  intent          jsonb,
  extraction      jsonb,
  edited_intent   boolean not null default false,
  clarification   text,
  created_at      timestamptz not null default now(),
  unique (share_id, version)
);

create table if not exists study.ai_calls (
  id                    uuid primary key default gen_random_uuid(),
  share_id              uuid,                              -- no FK: eval calls have no share
  participant_id        uuid references study.participants(id) on delete cascade,
  eval_run_id           uuid,
  task                  text not null,                     -- intent | extract | extract_content_only
  attempt               integer not null default 0,        -- regeneration index
  model                 text not null,
  prompt_version        text not null,
  system_prompt         text,
  user_prompt           text,
  raw_output            text,
  parsed                jsonb,
  normalized            jsonb,
  stop_reason           text,
  input_tokens          integer,
  output_tokens         integer,
  cache_read_tokens     integer,
  cache_write_tokens    integer,
  latency_ms            integer,
  error                 text,
  request_id            text,                              -- Anthropic request id
  client_request_id     text,                              -- joins to ai.request / ai.response events
  meta                  jsonb,                             -- eval: scenario/item id, expected type, condition
  data_origin           text not null default 'study',
  excluded              boolean not null default false,
  created_at            timestamptz not null default now()
);

create table if not exists study.content_cache (
  url            text primary key,
  adapter        text not null,
  content        jsonb not null,
  fetched_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------- messages + interaction log
create table if not exists study.messages (
  id               uuid primary key,                       -- client generated
  conversation_id  uuid not null references study.conversations(id) on delete cascade,
  sender_id        uuid not null references study.participants(id) on delete cascade,
  kind             text not null check (kind in ('text','card','plain')),
  text             text,                                   -- verbatim
  link_url         text,
  card_id          uuid,
  share_id         uuid,
  plain_preview    jsonb,                                  -- baseline link preview (title, site, image)
  client_ts        timestamptz,
  server_ts        timestamptz not null default now(),
  data_origin      text not null default 'study',
  excluded         boolean not null default false
);

create table if not exists study.events (
  id               uuid primary key,                       -- client generated, dedupes retries
  session_id       uuid,
  participant_id   uuid references study.participants(id) on delete cascade,
  pair_id          uuid,
  conversation_id  uuid,
  draft_id         uuid,                                   -- one per composition; = shares.id when it became a share
  card_id          uuid,
  message_id       uuid,
  seq              integer,                                -- per-session counter, detects gaps
  type             text not null,
  client_ts        timestamptz,
  perf_ms          double precision,                       -- performance.now() in that session
  server_ts        timestamptz not null default now(),
  condition        text,
  viewer           text,
  app_version      text,
  data_origin      text not null default 'study',
  excluded         boolean not null default false,
  payload          jsonb
);

create table if not exists study.survey_answers (
  id               uuid primary key,
  participant_id   uuid not null references study.participants(id) on delete cascade,
  share_id         uuid,
  card_id          uuid,
  item             text not null,                          -- m1a | m1b | m2 | post_rating
  value            text,
  skipped          boolean not null default false,
  shown_at         timestamptz,
  answered_at      timestamptz not null default now(),
  data_origin      text not null default 'study',
  excluded         boolean not null default false
);

-- ---------------------------------------------------------------- researcher coding + eval
create table if not exists study.codes (
  id          uuid primary key default gen_random_uuid(),
  coder       text not null,
  item_kind   text not null,                               -- m1a | m2 | heldout | anchor | evidence
  item_id     text not null,
  code        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (coder, item_kind, item_id)
);

create table if not exists study.eval_runs (
  id              uuid primary key default gen_random_uuid(),
  label           text,
  prompt_version  text,
  models          jsonb,
  summary         jsonb,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz
);

-- ---------------------------------------------------------------- indexes
create index if not exists events_draft_idx        on study.events (draft_id);
create index if not exists events_card_idx         on study.events (card_id);
create index if not exists events_participant_idx  on study.events (participant_id, client_ts);
create index if not exists events_session_seq_idx  on study.events (session_id, seq);
create index if not exists events_type_idx         on study.events (type);
create index if not exists events_server_ts_idx    on study.events (server_ts);
create index if not exists messages_conv_idx       on study.messages (conversation_id, server_ts);
create index if not exists cards_conv_idx          on study.cards (conversation_id);
create index if not exists cards_share_idx         on study.cards (share_id);
create index if not exists ai_calls_share_idx      on study.ai_calls (share_id);
create index if not exists ai_calls_part_idx       on study.ai_calls (participant_id, created_at);
create index if not exists ai_calls_eval_idx       on study.ai_calls (eval_run_id);
create index if not exists shares_part_idx         on study.shares (participant_id, created_at);
create index if not exists survey_part_idx         on study.survey_answers (participant_id);
create index if not exists sessions_part_idx       on study.sessions (participant_id);
create index if not exists participants_pair_idx   on study.participants (pair_id);

-- RLS on everywhere, no policies: nothing is reachable except through the dispatcher.
do $$
declare t text;
begin
  foreach t in array array['config','pairs','participants','sessions','conversations','shares','cards',
    'card_versions','ai_calls','content_cache','messages','events','survey_answers','codes','eval_runs']
  loop
    execute format('alter table study.%I enable row level security', t);
  end loop;
end $$;

-- ===== 0002_views.sql =====
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

-- ===== 0003_api.sql =====
-- The single entry point: public.intentshare_api(p_key, p_op, p_args) -> jsonb.
-- Called only by the Next.js server (Vercel) with the publishable key + SERVER_RPC_KEY.

create or replace function study.assert_server(p_key text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_key is null or length(p_key) < 32
     or p_key is distinct from (select value from study.config where key = 'server_key') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

create or replace function study.new_code() returns text
language plpgsql set search_path = '' as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- no 0/O, 1/I
  c text;
begin
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from study.participants where code = c);
  end loop;
  return c;
end $$;

create or replace function study.condition_for(p_pair uuid, p_at timestamptz default now()) returns text
language plpgsql stable set search_path = '' as $$
declare
  pr study.pairs;
  d date := (p_at at time zone 'America/New_York')::date;
  r text;
begin
  select * into pr from study.pairs where id = p_pair;
  if pr.id is null then return 'ai'; end if;
  if pr.condition_mode <> 'schedule' then return pr.condition_mode; end if;
  select x->>'condition' into r
  from jsonb_array_elements(pr.condition_schedule) x
  where (x->>'from')::date <= d
  order by (x->>'from')::date desc limit 1;
  return coalesce(r, 'ai');
end $$;

create or replace function study.participant_json(p study.participants) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'code', p.code, 'role', p.role, 'display_name', p.display_name,
    'pair_id', p.pair_id, 'data_origin', p.data_origin, 'study_ends_at', p.study_ends_at,
    'locked', (p.study_ends_at is not null and p.study_ends_at < now()) or p.withdrawn_at is not null);
$$;

create or replace function study.create_pair(a jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  pr study.pairs; pa study.participants; pb study.participants; cv study.conversations;
  origin text := coalesce(a->>'data_origin', 'study');
  ends timestamptz := case when a ? 'study_days' and (a->>'study_days') is not null
                           then now() + make_interval(days => (a->>'study_days')::int) else null end;
begin
  insert into study.pairs (label, condition_mode, condition_schedule, relationship_type, known_duration, data_origin, notes)
  values (coalesce(a->>'label', 'pair'), coalesce(a->>'condition_mode', 'ai'), coalesce(a->'condition_schedule', '[]'::jsonb),
          a->>'relationship_type', a->>'known_duration', origin, a->>'notes')
  returning * into pr;
  insert into study.participants (code, pair_id, role, display_name, data_origin, study_ends_at)
  values (study.new_code(), pr.id, 'A', coalesce(a->'names'->>'A', 'A'), origin, ends) returning * into pa;
  insert into study.participants (code, pair_id, role, display_name, data_origin, study_ends_at)
  values (study.new_code(), pr.id, 'B', coalesce(a->'names'->>'B', 'B'), origin, ends) returning * into pb;
  insert into study.conversations (pair_id) values (pr.id) returning * into cv;
  return jsonb_build_object('pair', to_jsonb(pr), 'A', study.participant_json(pa), 'B', study.participant_json(pb),
                            'conversation_id', cv.id);
end $$;

create or replace function study.message_json(m study.messages) returns jsonb
language sql stable set search_path = '' as $$
  select to_jsonb(m) || jsonb_build_object(
    'card', (select c.card || jsonb_build_object('replaced', c.replaced_by is not null) from study.cards c where c.id = m.card_id),
    'sender_role', (select p.role from study.participants p where p.id = m.sender_id));
$$;

create or replace function public.intentshare_api(p_key text, p_op text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a   jsonb := coalesce(p_args, '{}'::jsonb);
  res jsonb;
  p   study.participants;
  q   study.participants;
  pr  study.pairs;
  cv  study.conversations;
  sid uuid;
  n   int;
  origin text;
  v   text;
  cid uuid;
begin
  perform study.assert_server(p_key);

  case p_op

  when 'ping' then
    return jsonb_build_object('ok', true, 'now', now());

  -- ------------------------------------------------------------ sessions
  when 'session_start' then
    if coalesce((a->>'demo')::boolean, false) then
      res := study.create_pair(jsonb_build_object('label', 'demo ' || left(a->'session'->>'id', 8),
               'data_origin', coalesce(a->>'data_origin', 'demo'), 'condition_mode', 'ai'));
      select * into p from study.participants where id = (res->'A'->>'id')::uuid;
    else
      select * into p from study.participants where code = upper(trim(a->>'code'));
      if p.id is null then return jsonb_build_object('error', 'unknown_code'); end if;
      if p.withdrawn_at is not null then return jsonb_build_object('error', 'withdrawn'); end if;
    end if;
    select * into q from study.participants where pair_id = p.pair_id and id <> p.id;
    select * into cv from study.conversations where pair_id = p.pair_id;
    if cv.id is null then insert into study.conversations (pair_id) values (p.pair_id) returning * into cv; end if;
    sid := (a->'session'->>'id')::uuid;
    insert into study.sessions (id, participant_id, user_agent, viewport, tz, clock_offset_ms, app_version, mode)
    values (sid, p.id, a->'session'->>'user_agent', a->'session'->>'viewport', a->'session'->>'tz',
            (extract(epoch from now()) * 1000 - (a->'session'->>'client_now')::numeric)::int,
            a->'session'->>'app_version', a->'session'->>'mode')
    on conflict (id) do update set last_seen_at = now();
    return jsonb_build_object('session_id', sid, 'participant', study.participant_json(p),
      'partner', study.participant_json(q), 'conversation_id', cv.id,
      'condition', study.condition_for(p.pair_id), 'server_now', now());

  when 'session_touch' then
    update study.sessions set last_seen_at = now(),
      clock_offset_ms = coalesce((a->>'clock_offset_ms')::int, clock_offset_ms),
      ended_at = case when coalesce((a->>'ended')::boolean, false) then now() else ended_at end
    where id = (a->>'session_id')::uuid;
    return jsonb_build_object('ok', true);

  -- ------------------------------------------------------------ interaction log
  when 'events_insert' then
    with rows as (
      select * from jsonb_to_recordset(coalesce(a->'events', '[]'::jsonb)) as x(
        id uuid, session_id uuid, participant_id uuid, pair_id uuid, conversation_id uuid, draft_id uuid,
        card_id uuid, message_id uuid, seq int, type text, client_ts timestamptz, perf_ms float8,
        condition text, viewer text, app_version text, payload jsonb)
    ), ins as (
      insert into study.events (id, session_id, participant_id, pair_id, conversation_id, draft_id, card_id, message_id,
        seq, type, client_ts, perf_ms, condition, viewer, app_version, data_origin, payload)
      select r.id, r.session_id, r.participant_id, coalesce(r.pair_id, pp.pair_id), r.conversation_id, r.draft_id, r.card_id,
             r.message_id, r.seq, left(r.type, 64), r.client_ts, r.perf_ms, r.condition, r.viewer, r.app_version,
             coalesce(pp.data_origin, 'study'), r.payload
      from rows r join study.participants pp on pp.id = r.participant_id
      where r.id is not null and r.type is not null
      on conflict (id) do nothing
      returning 1
    )
    select count(*) into n from ins;
    return jsonb_build_object('inserted', n);

  -- ------------------------------------------------------------ shares, cards, AI
  when 'share_upsert' then
    select * into p from study.participants where id = (a->>'participant_id')::uuid;
    if p.id is null then return jsonb_build_object('error', 'unknown_participant'); end if;
    insert into study.shares (id, participant_id, conversation_id, session_id, condition, trigger_kind, message_text,
      link_url, scenario_id, expected_type, outcome, final_card_id, data_origin, closed_at)
    values ((a->>'id')::uuid, p.id, (a->>'conversation_id')::uuid, (a->>'session_id')::uuid,
      coalesce(a->>'condition', 'ai'), a->>'trigger_kind', a->>'message_text', a->>'link_url', a->>'scenario_id',
      a->>'expected_type', a->>'outcome', (a->>'final_card_id')::uuid, p.data_origin,
      case when a->>'outcome' is not null then now() end)
    on conflict (id) do update set
      trigger_kind  = coalesce(excluded.trigger_kind, study.shares.trigger_kind),
      message_text  = coalesce(excluded.message_text, study.shares.message_text),
      link_url      = coalesce(excluded.link_url, study.shares.link_url),
      scenario_id   = coalesce(excluded.scenario_id, study.shares.scenario_id),
      expected_type = coalesce(excluded.expected_type, study.shares.expected_type),
      outcome       = coalesce(excluded.outcome, study.shares.outcome),
      final_card_id = coalesce(excluded.final_card_id, study.shares.final_card_id),
      closed_at     = coalesce(excluded.closed_at, study.shares.closed_at);
    return jsonb_build_object('ok', true);

  when 'card_version_insert' then
    insert into study.card_versions (share_id, version, intent, extraction, edited_intent, clarification)
    values ((a->>'share_id')::uuid, (a->>'version')::int, a->'intent', a->'extraction',
            coalesce((a->>'edited_intent')::boolean, false), a->>'clarification')
    on conflict (share_id, version) do update set intent = excluded.intent, extraction = excluded.extraction,
      edited_intent = excluded.edited_intent, clarification = excluded.clarification;
    return jsonb_build_object('ok', true);

  when 'ai_call_insert' then
    select data_origin into origin from study.participants where id = (a->>'participant_id')::uuid;
    insert into study.ai_calls (share_id, participant_id, eval_run_id, task, attempt, model, prompt_version, system_prompt,
      user_prompt, raw_output, parsed, normalized, stop_reason, input_tokens, output_tokens, cache_read_tokens,
      cache_write_tokens, latency_ms, error, request_id, client_request_id, meta, data_origin)
    values ((a->>'share_id')::uuid, (a->>'participant_id')::uuid, (a->>'eval_run_id')::uuid, a->>'task',
      coalesce((a->>'attempt')::int, 0), a->>'model', a->>'prompt_version', a->>'system_prompt', a->>'user_prompt',
      a->>'raw_output', a->'parsed', a->'normalized', a->>'stop_reason', (a->>'input_tokens')::int,
      (a->>'output_tokens')::int, (a->>'cache_read_tokens')::int, (a->>'cache_write_tokens')::int,
      (a->>'latency_ms')::int, a->>'error', a->>'request_id', a->>'client_request_id', a->'meta',
      coalesce(origin, a->>'data_origin', 'eval'))
    returning jsonb_build_object('id', id) into res;
    return res;

  when 'ai_rate' then
    select count(*) into n from study.ai_calls
    where participant_id = (a->>'participant_id')::uuid and created_at > now() - interval '1 hour';
    return jsonb_build_object('count', n);

  when 'content_get' then
    select to_jsonb(c) into res from study.content_cache c
    where c.url = a->>'url' and c.fetched_at > now() - make_interval(hours => coalesce((a->>'max_age_h')::int, 168));
    return coalesce(res, 'null'::jsonb);

  when 'content_put' then
    insert into study.content_cache (url, adapter, content) values (a->>'url', a->>'adapter', a->'content')
    on conflict (url) do update set adapter = excluded.adapter, content = excluded.content, fetched_at = now();
    return jsonb_build_object('ok', true);

  -- ------------------------------------------------------------ messages
  when 'message_insert' then
    select * into p from study.participants where id = (a->'message'->>'sender_id')::uuid;
    if p.id is null then return jsonb_build_object('error', 'unknown_participant'); end if;
    if (p.study_ends_at is not null and p.study_ends_at < now()) or p.withdrawn_at is not null then
      return jsonb_build_object('error', 'locked');
    end if;
    select * into cv from study.conversations where pair_id = p.pair_id;
    if cv.id is distinct from (a->'message'->>'conversation_id')::uuid then
      return jsonb_build_object('error', 'wrong_conversation');
    end if;
    if a ? 'card' and jsonb_typeof(a->'card') = 'object' then
      insert into study.cards (id, share_id, sender_id, conversation_id, card, status, regenerations, data_origin)
      values ((a->'card'->>'id')::uuid, (a->'message'->>'share_id')::uuid, p.id, cv.id, a->'card', 'sent',
              coalesce((a->'card'->>'regenerations')::int, 0), p.data_origin)
      on conflict (id) do nothing;
      if a->'card'->'action'->>'type' = 'replace_previous' then
        update study.cards set replaced_by = (a->'card'->>'id')::uuid
        where id = (select c.id from study.cards c
                    where c.conversation_id = cv.id and c.sender_id = p.id and c.id <> (a->'card'->>'id')::uuid
                      and c.replaced_by is null
                      and (a->'card'->'action'->'payload'->>'previousTitle' is null
                           or c.card->'content'->>'title' = a->'card'->'action'->'payload'->>'previousTitle')
                    order by c.created_at desc limit 1);
      end if;
    end if;
    insert into study.messages (id, conversation_id, sender_id, kind, text, link_url, card_id, share_id, plain_preview,
      client_ts, data_origin)
    values ((a->'message'->>'id')::uuid, cv.id, p.id, a->'message'->>'kind', a->'message'->>'text',
      a->'message'->>'link_url', (a->'message'->>'card_id')::uuid, (a->'message'->>'share_id')::uuid,
      a->'message'->'plain_preview', (a->'message'->>'client_ts')::timestamptz, p.data_origin)
    on conflict (id) do nothing;
    select study.message_json(m) into res from study.messages m where m.id = (a->'message'->>'id')::uuid;
    return res;

  when 'sync' then
    select * into p from study.participants where id = (a->>'participant_id')::uuid;
    select * into cv from study.conversations where pair_id = p.pair_id;
    if cv.id is null then return jsonb_build_object('error', 'unknown_participant'); end if;
    select coalesce(jsonb_agg(study.message_json(m) order by m.server_ts), '[]'::jsonb) into res
    from study.messages m
    where m.conversation_id = cv.id
      and (a->>'since' is null or m.server_ts > (a->>'since')::timestamptz);
    return jsonb_build_object('messages', res, 'server_now', now(),
      'replaced', (select coalesce(jsonb_agg(c.id), '[]'::jsonb) from study.cards c where c.conversation_id = cv.id and c.replaced_by is not null),
      'condition', study.condition_for(p.pair_id),
      'locked', (p.study_ends_at is not null and p.study_ends_at < now()) or p.withdrawn_at is not null);

  when 'survey_insert' then
    select * into p from study.participants where id = (a->>'participant_id')::uuid;
    if p.id is null then return jsonb_build_object('error', 'unknown_participant'); end if;
    insert into study.survey_answers (id, participant_id, share_id, card_id, item, value, skipped, shown_at, data_origin)
    values ((a->>'id')::uuid, p.id, (a->>'share_id')::uuid, (a->>'card_id')::uuid, a->>'item', a->>'value',
            coalesce((a->>'skipped')::boolean, false), (a->>'shown_at')::timestamptz, p.data_origin)
    on conflict (id) do update set value = excluded.value, skipped = excluded.skipped, answered_at = now();
    return jsonb_build_object('ok', true);

  when 'pending_surveys' then
    -- post_rating: sender rates "My partner understood what I meant" after the partner answered m2 (next day or later).
    select coalesce(jsonb_agg(jsonb_build_object('share_id', f.share_id, 'm2', f.m2, 'message_text', f.message_text,
             'link_url', f.link_url, 'created_at', f.created_at) order by f.created_at), '[]'::jsonb) into res
    from study.v_intent_fidelity f
    where f.sender_id = (a->>'participant_id')::uuid and f.m2 is not null and f.post_rating is null
      and not exists (select 1 from study.survey_answers s where s.share_id = f.share_id and s.item = 'post_rating')
      and f.created_at < now() - make_interval(hours => coalesce((a->>'delay_h')::int, 12));
    return res;

  when 'message_exclude' then
    -- A participant marks one of their own messages "Exclude from study": hide it from every analysis.
    update study.messages set excluded = true
    where id = (a->>'message_id')::uuid and sender_id = (a->>'participant_id')::uuid
    returning share_id, card_id into sid, cid;
    if not found then return jsonb_build_object('error', 'not_found'); end if;
    update study.cards set excluded = true where id = cid;
    update study.shares set excluded = true where id = sid;
    update study.ai_calls set excluded = true where share_id = sid;
    update study.survey_answers set excluded = true where share_id = sid;
    update study.events set excluded = true
    where message_id = (a->>'message_id')::uuid or (sid is not null and draft_id = sid)
       or (cid is not null and card_id = cid);
    return jsonb_build_object('ok', true);

  -- ------------------------------------------------------------ researcher console
  when 'admin_overview' then
    return jsonb_build_object(
      'pairs', (select coalesce(jsonb_agg(jsonb_build_object('pair', to_jsonb(x),
                  'condition_today', study.condition_for(x.id),
                  'participants', (select jsonb_agg(study.participant_json(pp) order by pp.role) from study.participants pp where pp.pair_id = x.id),
                  'conversation_id', (select id from study.conversations c where c.pair_id = x.id),
                  'messages', (select count(*) from study.messages m join study.conversations c on c.id = m.conversation_id where c.pair_id = x.id),
                  'shares', (select count(*) from study.shares s join study.participants pp on pp.id = s.participant_id where pp.pair_id = x.id),
                  'last_event', (select max(e.server_ts) from study.events e where e.pair_id = x.id))
                order by x.created_at desc), '[]'::jsonb)
                from study.pairs x where (a->>'origin' is null or x.data_origin = a->>'origin')),
      'totals', jsonb_build_object(
        'events', (select count(*) from study.events),
        'ai_calls', (select count(*) from study.ai_calls),
        'input_tokens', (select coalesce(sum(input_tokens), 0) from study.ai_calls),
        'output_tokens', (select coalesce(sum(output_tokens), 0) from study.ai_calls),
        'cache_read_tokens', (select coalesce(sum(cache_read_tokens), 0) from study.ai_calls)),
      'server_now', now());

  when 'admin_pair_create' then
    return study.create_pair(a);

  when 'admin_pair_update' then
    update study.pairs set
      condition_mode     = coalesce(a->>'condition_mode', condition_mode),
      condition_schedule = coalesce(a->'condition_schedule', condition_schedule),
      relationship_type  = coalesce(a->>'relationship_type', relationship_type),
      known_duration     = coalesce(a->>'known_duration', known_duration),
      notes              = coalesce(a->>'notes', notes),
      label              = coalesce(a->>'label', label)
    where id = (a->>'pair_id')::uuid;
    if a ? 'study_ends_at' then
      update study.participants set study_ends_at = (a->>'study_ends_at')::timestamptz where pair_id = (a->>'pair_id')::uuid;
    end if;
    if a ? 'names' then
      update study.participants set display_name = a->'names'->>role where pair_id = (a->>'pair_id')::uuid and a->'names' ? role;
    end if;
    return jsonb_build_object('ok', true);

  when 'admin_withdraw' then
    -- Deletes everything the participant produced. With include_partner = true, also deletes the
    -- partner's messages in that conversation (consent: a withdrawing partner's chat context).
    select * into p from study.participants where id = (a->>'participant_id')::uuid;
    if p.id is null then return jsonb_build_object('error', 'not_found'); end if;
    select * into cv from study.conversations where pair_id = p.pair_id;
    delete from study.events e where e.participant_id = p.id
       or e.message_id in (select id from study.messages where sender_id = p.id)
       or e.card_id in (select id from study.cards where sender_id = p.id);
    delete from study.ai_calls where participant_id = p.id;
    delete from study.card_versions where share_id in (select id from study.shares where participant_id = p.id);
    delete from study.survey_answers where participant_id = p.id
       or share_id in (select id from study.shares where participant_id = p.id);
    if coalesce((a->>'include_partner')::boolean, false) then
      delete from study.messages where conversation_id = cv.id;
      delete from study.cards where conversation_id = cv.id;
    else
      delete from study.messages where sender_id = p.id;
      delete from study.cards where sender_id = p.id;
    end if;
    delete from study.shares where participant_id = p.id;
    delete from study.sessions where participant_id = p.id;
    update study.participants set withdrawn_at = now(), display_name = 'withdrawn' where id = p.id;
    return jsonb_build_object('ok', true);

  when 'admin_query' then
    -- Whitelisted reads for the console and exports.
    v := a->>'view';
    if v not in ('v_share_funnel','v_share_timeline','v_receiver_timeline','v_ai_quality','v_intent_fidelity',
                 'v_daily_compliance','v_data_quality','events','messages','shares','cards','card_versions',
                 'ai_calls','survey_answers','sessions','participants','pairs','codes','eval_runs') then
      return jsonb_build_object('error', 'unknown_view');
    end if;
    execute format(
      'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from study.%I x where true %s %s %s order by 1 limit %s offset %s) t',
      v,
      case when a->>'origin' is not null and v not in ('v_share_timeline','v_data_quality','codes','eval_runs','sessions','card_versions')
           then format('and x.data_origin = %L', a->>'origin') else '' end,
      case when a->>'share_id' is not null and v in ('v_share_funnel','v_share_timeline','v_receiver_timeline','v_ai_quality','events','shares','cards','card_versions','ai_calls','survey_answers')
           then format('and x.%I = %L::uuid', case when v = 'events' then 'draft_id' when v in ('shares') then 'id' else 'share_id' end, a->>'share_id') else '' end,
      case when a->>'since' is not null and v = 'events' then format('and x.server_ts > %L::timestamptz', a->>'since') else '' end,
      least(coalesce((a->>'limit')::int, 500), 50000), coalesce((a->>'offset')::int, 0))
    into res;
    return res;

  when 'admin_events_tail' then
    select coalesce(jsonb_agg(t order by t.server_ts desc), '[]'::jsonb) into res from (
      select e.id, e.server_ts, e.client_ts, e.type, e.participant_id, pp.code, pp.role, e.draft_id, e.card_id, e.message_id,
             e.condition, e.data_origin, e.payload
      from study.events e left join study.participants pp on pp.id = e.participant_id
      where (a->>'since' is null or e.server_ts > (a->>'since')::timestamptz)
        and (a->>'origin' is null or e.data_origin = a->>'origin')
      order by e.server_ts desc limit least(coalesce((a->>'limit')::int, 200), 1000)) t;
    return res;

  when 'admin_share_detail' then
    sid := (a->>'share_id')::uuid;
    return jsonb_build_object(
      'share', (select to_jsonb(s) from study.shares s where s.id = sid),
      'funnel', (select to_jsonb(f) from study.v_share_funnel f where f.share_id = sid),
      'timeline', (select coalesce(jsonb_agg(t order by t.step_no), '[]'::jsonb) from study.v_share_timeline t where t.share_id = sid),
      'events', (select coalesce(jsonb_agg(e order by e.perf_ms, e.seq), '[]'::jsonb) from study.events e where e.draft_id = sid),
      'ai_calls', (select coalesce(jsonb_agg(c order by c.created_at), '[]'::jsonb) from study.ai_calls c where c.share_id = sid),
      'versions', (select coalesce(jsonb_agg(v2 order by v2.version), '[]'::jsonb) from study.card_versions v2 where v2.share_id = sid),
      'card', (select to_jsonb(c) from study.cards c where c.share_id = sid order by c.created_at desc limit 1),
      'receiver', (select coalesce(jsonb_agg(r), '[]'::jsonb) from study.v_receiver_timeline r where r.share_id = sid),
      'surveys', (select coalesce(jsonb_agg(s2), '[]'::jsonb) from study.survey_answers s2 where s2.share_id = sid));

  when 'admin_purge_booth' then
    delete from study.pairs where data_origin = 'booth';
    get diagnostics n = row_count;
    return jsonb_build_object('deleted_pairs', n);

  when 'admin_code_upsert' then
    insert into study.codes (coder, item_kind, item_id, code) values (a->>'coder', a->>'item_kind', a->>'item_id', a->'code')
    on conflict (coder, item_kind, item_id) do update set code = excluded.code, updated_at = now();
    return jsonb_build_object('ok', true);

  when 'admin_eval_run_start' then
    insert into study.eval_runs (label, prompt_version, models) values (a->>'label', a->>'prompt_version', a->'models')
    returning jsonb_build_object('id', id) into res;
    return res;

  when 'admin_eval_run_finish' then
    update study.eval_runs set summary = a->'summary', finished_at = now() where id = (a->>'id')::uuid;
    return jsonb_build_object('ok', true);

  else
    raise exception 'unknown op %', p_op using errcode = '22023';
  end case;
end $$;

revoke all on function public.intentshare_api(text, text, jsonb) from public;
grant execute on function public.intentshare_api(text, text, jsonb) to anon, authenticated;
revoke all on all functions in schema study from public, anon, authenticated;
