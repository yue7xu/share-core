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
