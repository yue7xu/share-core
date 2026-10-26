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
