# IntentShare data dictionary

Everything the study records, where it lives, and how the derived measures are computed.
Database: Supabase project `core-share`, schema `study` (not exposed through the Data API; the server reaches it only via `public.intentshare_api`).
All timestamps are `timestamptz` (UTC). Durations inside one device use `perf_ms` (monotonic browser clock); durations across two devices use `aligned_ts = client_ts + session.clock_offset_ms`.

## Conventions

| Field | Meaning |
|---|---|
| `data_origin` | `study` (field study), `pilot`, `demo` (public demo page), `author` (presentation / video recording), `booth` (CHI booth: only relayed messages, no events or AI logs), `eval` (technical evaluation). Set by the server from the participant, never by the browser. Every view keeps it so analyses can filter. |
| `excluded` | `true` when a participant pressed "Exclude from study" on the message. All views skip excluded rows. |
| `draft_id` / `share_id` | One id per composition (from the first composer interaction until send). If the composition contained a link it becomes a row in `shares` with the same id. |
| `client_ts` | Browser wall clock at the moment of the event. |
| `perf_ms` | `performance.now()` at the event, in that browser session (monotonic; immune to clock changes). |
| `server_ts` | Database time when the row was written. |
| `seq` | Per-session counter; a gap means events were lost (see `v_data_quality`). |

## Tables

| Table | One row per | Key fields |
|---|---|---|
| `pairs` | participant pair | `label`, `condition_mode` (`ai` / `baseline` / `schedule`), `condition_schedule` (JSON list of `{from, condition}` dates, America/New_York), `relationship_type`, `known_duration` |
| `participants` | person | `code` (6-character login code, the only identity), `pair_id`, `role` (A/B), `display_name` (chosen by participant), `study_ends_at` (after this the chat is read-only), `withdrawn_at` |
| `sessions` | page load | `user_agent`, `viewport`, `tz`, `clock_offset_ms` (server − client, NTP-style best of 3), `mode` |
| `conversations` | pair | one research chat per pair |
| `messages` | sent message | `kind` (`text` / `card` / `plain`), `text` (verbatim), `link_url`, `card_id`, `share_id`, `plain_preview` (baseline link preview), `client_ts`, `server_ts` |
| `shares` | composition containing a link | `condition`, `trigger_kind` (`same_message`, `merged_previous` = text sent within 60 s before the link, `link_only`, `baseline_send`), `message_text` (intent text used), `link_url`, `scenario_id` / `expected_type` (only when a sample was loaded and not edited), `outcome` (`sent_card`, `sent_plain`, `closed`), `final_card_id` |
| `cards` | sent AI card | `card` (full ShareCard JSON: sender note verbatim, intent, content summary, extraction, action), `regenerations`, `replaced_by` |
| `card_versions` | generated card version | `version` (0 = first), `intent`, `extraction`, `edited_intent`, `clarification` (answer to the gap question) |
| `ai_calls` | Claude API call | `task` (`intent`, `extract`, `extract_content_only`), `attempt`, `model`, `prompt_version`, **`system_prompt`, `user_prompt`, `raw_output`** (complete), `parsed`, `normalized` (what the UI received), `stop_reason`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `latency_ms`, `error`, `request_id` (Anthropic), `client_request_id` (joins to `ai.*` events), `meta` (eval item, expected type) |
| `events` | interaction | see the event catalogue below |
| `survey_answers` | answered or skipped study question | `item` (`m1a`, `m1b`, `m2`, `post_rating`), `value`, `skipped`, `shown_at`, `answered_at` |
| `codes` | researcher code | `coder`, `item_kind` (`heldout`, `m1a`, `m2`, `anchor`), `item_id`, `code` (`{type}` or `{units}`) |
| `eval_runs` | technical evaluation run | `prompt_version`, `models`, `summary` (accuracy, latency, anchor P/R, confusions) |
| `content_cache` | fetched URL | adapter output (ContentObject) for 7 days |

## Event catalogue

Every event also carries `session_id, participant_id, pair_id, conversation_id, draft_id, card_id, message_id, seq, client_ts, perf_ms, condition, viewer, app_version`.

| Type | When | Payload |
|---|---|---|
| `app.session_start` | page ready | mode, AI mode, prompt version, viewport, device pixel ratio, language |
| `app.session_end` | tab closed | ms since load |
| `app.visibility` | tab hidden / visible | `state`, `away_ms` (time spent away, e.g. watching the video) |
| `app.focus` / `app.blur` | window focus | — |
| `app.clock` | after sign-in | `offset_ms`, `rtt_ms` |
| `app.error` | JS error | message, source, line |
| `ui.click` | **every click** | `target` (data-track id, or element + label), x, y, viewport |
| `ui.key` | Enter, Escape, copy/paste shortcuts | `key`, `target` (no other keystrokes are logged as keys) |
| `compose.focus` | composer focused | — |
| `compose.plus_open` | "+" menu opened | — |
| `compose.input` | 500 ms after typing stops | `text` (full draft snapshot; omitted when `LOG_DRAFT_TEXT=false`), `length`, `keys`, `deletes` since the last snapshot |
| `compose.paste` | paste into composer | `length`, `has_url`, `url` |
| `compose.attach` | photo attached / removed | `ref` |
| `compose.sample_loaded` | sample share chosen (demo) | `scenario`, `expected` |
| `share.link_detected` | link present when typing pauses | `url`, `host`, `with_text`, `attachment` |
| `share.trigger_shown` / `share.trigger_hidden` | share-card hint above composer | `kind`, `url_so_far` |
| `share.sheet_opened` | preview opened | `via` (`send_button` / `preview_link`), `url`, `merged_intent` |
| `ai.request` / `ai.response` / `ai.error` | browser side of each AI call | `task`, `client_request_id`, `wait_ms` (what the person waited), `model`, `server_latency_ms`, `code` |
| `share.intent_shown` | intent appears in preview | `primary`, `secondary`, `confidence`, `indirect`, `evidence`, `content_kind`, `container_only` |
| `share.card_ready` | card appears in preview | `version`, `anchors`, `fallback`, `gap`, `container_only` |
| `share.evidence_hover` | hovered / focused an evidence cue (once per cue) | `quote`, `cue` |
| `share.intent_edit_start` / `share.intent_edit_cancel` | "Not right? Change the intent" | `primary` |
| `share.type_changed` | type changed before regenerating | `from`, `to` |
| `share.intent_edited` | intent line changed before regenerating | `before`, `after` |
| `share.regenerate` | regenerate | `n`, `from`, `to` |
| `share.gap_shown` / `share.gap_answered` | clarifying question | `question`, `options` / `answer`, `source` (`option` / `own`) |
| `share.retry` | retry after an AI error | `code` |
| `share.preview_scroll` | preview closed | `max_ratio` (how far the sender scrolled the preview) |
| `share.sent_card` / `share.sent_plain` / `share.closed` | decision | type, edits, regenerations, anchors / condition / reason |
| `msg.sent` / `msg.received` | message sent / arrived by sync | `kind`, `length` |
| `card.rendered` | shared item ≥50 % on the receiver's screen | `kind` (`card` / `plain`) |
| `card.seen` | in view for ≥1 s | `kind` |
| `card.dwell` | item leaves view (≥300 ms) | `dwell_ms` |
| `card.chip_click` | receiver opened an anchor | `anchor_index`, `kind`, `start`, `label`, `href` |
| `card.open_original` | "open original" footer / plain preview | `kind`, `href` |
| `card.action_click` | mock action (time option, reminder…) | `type`, `value` |
| `survey.shown` / `survey.answered` / `survey.skipped` | study questions | `item`, `value`, `ms_since_shown` |
| `study.exclude_message` | participant excluded a message | — |
| `study.condition_changed` / `study.tier_changed` | condition switched (menu or schedule) | `value`, `by` |
| `demo.viewer` / `demo.qr_shown` / `demo.reset` | demo-only controls | — |

## Derived views (measures)

| View | Row | Measures |
|---|---|---|
| `v_share_funnel` | share | `s_compose_to_trigger`, `s_trigger_to_open`, `s_open_to_intent`, `s_open_to_card`, `s_card_to_decision`, `s_in_preview`, `s_total`; `clicks_total` (from the first composer interaction to the decision), `clicks_before_preview`, `clicks_in_preview`; `keystrokes`, `deletes`, `pastes`; `regenerations`, `intent_edits`, `type_changes`, `evidence_hovers`; `gap_shown`, `gap_answered`; `s_ai_wait`, `ai_errors`; `preview_scroll_max`; `sent_unchanged` |
| `v_share_timeline` | step of a share | `step`, `started_at`, `duration_s` (until the next step), `clicks` and `keystrokes` during the step |
| `v_receiver_timeline` | shared item (card or plain link) | `s_delivered_to_seen`, `s_seen_to_first_chip`, `s_seen_to_reply`, `s_delivered_to_reply`, `chip_clicks`, `open_original_clicks`, `action_clicks`, `s_dwell`, `chips_clicked`, `reply_text` |
| `v_ai_quality` | AI call | latency, tokens, `ai_primary`, `expected_type`, `primary_match`, `n_anchors`, `fallback`, `gap_question` |
| `v_intent_fidelity` | sent share | `ai_primary`, `m1a`, `m1b`, `m2`, `post_rating` (+ answer ids for coding) |
| `v_daily_compliance` | participant × day | `shares_sent` (≥3 required), `messages_sent`, `active_minutes`, `sessions` |
| `v_data_quality` | session | `missing_seq`, `client_ahead`, `max_upload_delay_s`, `clock_offset_ms` |

## Study questions (wording)

| Item | Who / when | Wording |
|---|---|---|
| `m1a` | sender, right after sending (skippable) | "In a few words, what do you want {partner} to get from this?" |
| `m1b` | sender, after sending an AI card (1–5) | "How well does the card say what you wanted?" (Not at all … Exactly) |
| `m2` | receiver, once the item has been in view ≥1 s and before they reply | "Before you reply: in a few words, what do you think {partner} wanted you to get from this?" |
| `post_rating` | sender, next time they open the app ≥12 h later, after the partner answered m2 (1–5) | "My partner understood what I meant." (Strongly disagree … Strongly agree), shown with the partner's m2 answer |
