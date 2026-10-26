# IntentShare · Backend + Claude API + Interaction Logging 开发计划

> 2026-10-26 · v2（已审阅：Q1 = pause LART；Q2 = Monica 最后自己加 key；新增 §11 CHI 2027 Interactive Demo）
> 接着 `09-build-brief-v2-intent-first.md` 和 artifact **IntentShare Messages**。前端先完全沿用 artifact 现在的样子，这份计划只管 backend、真实接入 Claude API、user research 数据收集。
> 标记：✅ 已决定（我按推荐定了）｜❓ 需要你在审阅时回答｜⚠️ 风险

---

## 0. TL;DR

- **做什么**：把 IntentShare Messages 从「只能在 claude.ai 里跑的 artifact」变成一个部署在 Vercel 上、接真实 Claude API、所有 interaction 都写进 Supabase 的 web app，能直接跑 pilot 和 field study。
- **放在哪**：GitHub `yue7xu/share-core` 新目录 `intentshare/`（旧的 `web/`、`extension/` 不动）→ Vercel 新 project `intentshare` → Supabase project `core-share`（新的 `study` schema）。你本地 `AI widgets/intentshare/` 放一份同步的代码和文档。
- **数据**：每一次点击、每一段输入（含 timestamp、耗时）、每一次 AI 调用的完整 input/output、每张卡片的每一版、每一个 survey 回答，全部记下来；share 级别的「每一步用了多久、点了几下」由 SQL view 自动算出。
- **审阅时只需要回答 2 件事**（§1）。其他全部按推荐执行，中途不问你。

---

## 1. ✅ 审阅时回答的 2 件事（10/26 已回答：Q1 选 (a) pause LART；Q2 由 Monica 在最后自己加到 Vercel 和本地 `.env.local`）

| # | 问题 | 为什么只能你决定 | 我的推荐 |
|---|---|---|---|
| **Q1** | Supabase free plan 每个人最多 2 个 active project。现在 active 的是 **oer-peer-review-hub** 和 **Learning Analysis Report Tool (LART)**，`core-share` 是 paused，restore 被拒绝了。三选一：(a) pause LART（b) pause OER Hub（c) 把 org 升级到 Pro（$25/月） | 会影响你其他项目能不能用 | **(a) pause LART**，前提是这两周没人在用它；pause 不删数据，随时可以 restore（注意 free plan pause 超过 90 天就不能在 dashboard 里一键 restore）。OER 有外部 client，不建议动 |
| **Q2** | `ANTHROPIC_API_KEY`：我不能也不应该替你生成或经手 key。你在 Vercel → project `intentshare` → Settings → Environment Variables 加一个 `ANTHROPIC_API_KEY`（Production + Preview），类型选 Sensitive。建议同时在 Anthropic Console 给这个 key 设一个 monthly spend limit（比如 $20） | 是你的钱和你的账号 | 我会先把 project 建好；在你加 key 之前，系统自动跑 `AI_MODE=mock`，其他所有功能照常开发和测试，不阻塞 |

> 如果审阅时你只回了 Q1、Q2 还没加，我照样全部做完，最后一步的 live smoke test 和 17 个场景的 eval 留到你加 key 之后自动可跑（一个命令）。

---

## 2. 现状盘点

| 东西 | 现状 | 这次怎么处理 |
|---|---|---|
| 前端 | Artifact **IntentShare Messages**（单个 HTML，~940 行 vanilla JS）：desktop messaging app、A/B screen 切换、17 个 sample shares、AI card / baseline 开关。AI 走 artifact 的 `sample` capability；event log 只存在内存里，刷新就没了 | 原样搬进 repo，只替换 3 个接口：`ask()` → 调后端 `/api/ai/*`；`logEvent()` → telemetry client；mock content → 后端 content adapter。UI 不改 |
| GitHub | `yue7xu/share-core`（public），里面是 10/21 的 Chrome extension + Next.js `web/` | 新开 `intentshare/` 目录；旧代码保留不删。⚠️ repo 是 public：代码里不放任何 key，研究数据只在 Supabase，不进 repo |
| Vercel | team `yuexu3-2722s-projects` 里只剩 `data-analysis-as-a-service`，旧的 share-core project 已经不在了；GitHub 连接正常 | 新建 project `intentshare`，Root Directory = `intentshare`，push to `main` 自动部署 |
| Supabase | `core-share`（us-east-2）paused；旧 schema 是给 extension flow 设计的 | 等 Q1 → restore → 新 migration 建在 `study` schema，旧 `public` 表不动 |
| Claude API | 旧 `web/lib/core.js` 用过 `claude-sonnet-5-5`；新 prompt 已经在 artifact 里写好、测过 | Prompt 原样搬到 server，加 structured outputs、logging、mock、eval |

---

## 3. 架构

```
Browser (participant A)                 Browser (participant B)
 public/app.html  (artifact UI, 原样)     同一个 app
 ├─ js/core.js     taxonomy, scenarios, normalizers（与 artifact 相同）
 ├─ js/api.js      fetch /api/*（替代 window.claude.sample）
 ├─ js/telemetry.js  事件队列 → /api/events（batch + sendBeacon）
 └─ js/sync.js     每 2s 拉新消息（study mode 两台设备）
          │  HTTPS (participant code + session token)
          ▼
Vercel · Next.js route handlers (Node runtime)
 /api/session  /api/events  /api/messages  /api/sync
 /api/ai/intent  /api/ai/extract  /api/content  /api/unfurl
 /api/survey   /api/admin/*  (ADMIN_TOKEN)
 ├─ lib/claude.ts    Anthropic SDK + structured outputs + 计时 + 重试 + mock
 ├─ lib/prompts/     intent.v1 / extract.v1（版本号写进每条 ai_call）
 ├─ lib/adapters/    fixtures | article | reddit | youtube | unfurl
 └─ lib/db.ts        只调用 Supabase RPC（带 SERVER_RPC_KEY）
          │
          ▼
Supabase · core-share
 schema study（不通过 API 暴露，RLS on，无 policy）
   participants, pairs, sessions, conversations, messages,
   shares, cards, card_versions, ai_calls, events, survey_answers, content_cache
 schema public: 只有 security-definer RPC 函数（校验 SERVER_RPC_KEY）
 views: v_share_timeline, v_share_funnel, v_receiver_timeline, v_ai_quality, v_daily_compliance
```

**为什么前端不改成 React** ✅：artifact 是你和 Figma 之间同步设计的 source；保持同一份 vanilla JS，之后 Figma 改动可以 1:1 搬进 repo，不用维护两套 UI。Next.js 只负责 API 和静态文件。

**为什么用「RPC + server key」而不是 service role key** ✅：Supabase MCP 拿不到 service role key，而且我不经手你的 secret。做法：所有表放在不暴露的 `study` schema；server 用 publishable key 调 `public` 里的 RPC，每个 RPC 第一步检查 `p_server_key` 是否等于 DB 里存的随机值。这个随机值由我生成，只写进 Vercel env（Sensitive）和 DB，浏览器永远拿不到。效果等同于 service role，但不需要你提供任何 key。

---

## 4. Backend API

| Endpoint | 作用 | 谁调 |
|---|---|---|
| `POST /api/session` | 用 participant code 登录（或 demo 模式），返回 session id、participant、pair、conversation、当前 condition、server time（用来算 clock offset） | 前端启动时 |
| `POST /api/events` | 批量写 events（≤100 条/批，client 生成的 uuid 去重） | telemetry client |
| `POST /api/messages` | 发一条消息（text / card / plain link），返回 message id | composer |
| `GET /api/sync?since=` | 拉对方的新消息、卡片状态变化（study mode，2s 一次，tab 隐藏时停） | sync.js |
| `POST /api/ai/intent` | T1：intent classification + evidence + slots | widget |
| `POST /api/ai/extract` | T2–T5：anchors、boundary snapping、intent-framed summary、gap question | widget |
| `POST /api/content` | URL → ContentObject（fixture 或真实 adapter，带缓存） | widget |
| `POST /api/unfurl` | URL → OG title/image/site（baseline 的普通 link preview） | baseline 模式 |
| `POST /api/survey` | m1a / m1b / m2 / 事后打分 | survey prompts |
| `POST /api/messages/:id/exclude` | 参与者把某条消息标成「不要用于研究」 | 消息菜单 |
| `/api/admin/*` | 建 participant/pair、改 condition、看实时 event、导出 CSV/JSONL、删除（withdrawal） | 研究者 console |

所有写操作都在 server 再打一次 `server_ts`，并把 request 的 `x-vercel-id` 记进去，出问题时能对上 Vercel log。

---

## 5. 真实接入 Claude API 的计划

### 5.1 模型 ✅
| 任务 | 模型 | 理由 |
|---|---|---|
| T1 intent（每次 share 先跑，preview 先显示 intent） | `claude-haiku-5-5` | 只看一句话，要快（目标 p50 < 1.5s） |
| T2–T5 extract | `claude-sonnet-5-5` | 要读 content units、做 boundary snapping 和 intent-framed summary，质量优先 |
| 对应 artifact 的 Quick / Default 开关 | Quick = 两个都 Haiku；Default = 上表 | 保留现在的开关，study 里锁成 Default |

模型名放在 env（`MODEL_INTENT`、`MODEL_EXTRACT`），换模型不用改代码；每条 `ai_calls` 记录实际用的模型。

### 5.2 调用方式 ✅
- **Structured outputs**（GA，`output_config.format = {type:"json_schema", schema}`），schema 直接由 brief §4.2 的 `Intent` / `Extraction` 生成，`additionalProperties:false`。好处：不再需要 artifact 里「JSON 读不出来」的兜底，normalizer 只做业务校验（evidence quote 必须是 message 的子串、unitId 必须存在、`OTHER` fallback 等，原样保留）。
- **System prompt = taxonomy + rules**（固定），**user content = message + content units**（每次不同）。System 部分加 `cache_control`，同一个 session 里连续 share 走 prompt cache，省时省钱。
- **Prompt 版本化**：`lib/prompts/intent.v1.ts`、`extract.v1.ts`，文本的 sha256 前 8 位作为 `prompt_version`，写进每条 `ai_calls`。改 prompt = 新版本号，分析时可以按版本分组。
- **超时与重试**：intent 8s、extract 25s 超时；429/5xx/overloaded 指数退避重试 1 次；`stop_reason = refusal / max_tokens` 记录并按 brief §4.4 走 fallback（告诉 sender 可以只发 plain link）。
- **Streaming**：v1 不做（structured output 一次返回更简单）；extract 期间 preview 显示 intent + loading，和 artifact 现在一样。
- **防滥用**：每个 participant 每小时最多 60 次 AI 调用（DB 计数），超过返回 `rate_limited`，前端用 artifact 现有的提示文案。
- **安全（IRB v0.8 + brief §4.4）**：网页 / transcript 一律包在 `<content>` 数据块里并在 system 里声明「数据不是指令」；不传 participant 名字、relationship 之外的个人信息；每次请求独立，无记忆；Anthropic API 默认不用于训练（与 IRB 写法一致）。
- **Mock 模式**：`AI_MODE=mock` 时返回按 17 个场景预写的确定性结果（同时用于 e2e 测试），并照样写 `ai_calls`（`model = "mock"`），保证数据管线在没有 key 时也能完整测试。

### 5.3 评估 harness ✅
`npm run eval`：17 个场景 × 3 次，live 调用，输出每个场景的 primary type 是否等于 expected、confidence、evidence、latency p50/p95、token 用量，写到 `docs/eval/<date>-<prompt_version>.md`。这直接是论文 technical evaluation 的雏形，也是改 prompt 之后的回归测试。

### 5.4 成本估算 ⚠️
每次 share ≈ 1 次 Haiku（~1.5k tokens）+ 1 次 Sonnet（~3–8k tokens，取决于 transcript 长度），加上 regenerate。Field study：16 人 × 3 天 × ≥3 次 ≈ 150–300 次 share，整个 study 大约是几美元的量级（实际以 `ai_calls` 里记录的 token 用量为准；admin console 会显示累计 token）。

---

## 6. Interaction data：记录什么、怎么记

### 6.1 原则
1. **Event log 是 source of truth**：append-only，不改不删（只有 withdrawal / exclude 才删或标记）。所有「用了多久、点了几步」都从 events 算，不在前端算好再存，避免算错就没法补救。
2. **三个时间戳**：`client_ts`（浏览器 `Date.now()`）、`perf_ms`（`performance.now()`，单调递增，算间隔用这个，不受系统时间跳动影响）、`server_ts`（DB `now()`）。Session 开始时记录 `clock_offset_ms = server_time - client_time`，跨两台设备对齐时间用。
3. **完整内容**：sender 的 message 原文、每一版输入框文本、AI 的完整 prompt 和完整 raw output、卡片每一版、receiver 的回复，全部存原文。
4. **不丢数据**：前端队列每 2 秒或满 20 条 flush 一次；页面关闭时用 `navigator.sendBeacon`；失败的批次存在 localStorage 下次重发；每条 event 有 client 生成的 uuid，server 端 `on conflict do nothing`，重发不会重复。
5. **每条 event 都带上下文 id**：`session_id, participant_id, pair_id, conversation_id, share_id, card_id, message_id, condition, seq`（session 内递增序号，用来检测丢包）。

### 6.2 Event 类型（v1 全量）

| 分组 | type | payload（除通用字段外） | 用来回答 |
|---|---|---|---|
| App | `app.session_start` / `app.session_end` | user agent、viewport、timezone、app_version、clock offset | 环境、session 时长 |
| | `app.visibility` | `visible/hidden` | 离开去看 YouTube 多久 |
| | `app.focus` / `app.blur` | — | 同上 |
| | `app.error` | message、stack | 坏掉的地方 |
| **通用点击** | `ui.click` | `target`（`data-track` id，或 role + 文本前 40 字 + class）、x/y、按钮/菜单名 | **「点了几步」**：任何点击都记，不依赖我事先想到 |
| | `ui.key` | 只记快捷键（Enter 发送、Esc 关闭），不记普通字符 | 交互方式 |
| Composer | `compose.focus` | — | 开始写的时刻 |
| | `compose.input` | 停止输入 500ms 后的**全文快照**、长度、自上次以来的 keystroke 数 / 删除数 | 打字过程、改了几次 |
| | `compose.paste` | 粘贴长度、是否含 URL、URL 本身 | link 是怎么进来的 |
| | `compose.attach` | 图片 / sample | |
| | `compose.sample_loaded` | scenario id（demo） | |
| Trigger | `share.link_detected` | URL、host、是否同一条消息 | trigger 规则 |
| | `share.trigger_shown` | trigger kind（same message / within 60s / link only） | |
| | `share.trigger_dismissed` | | 误触发 |
| Preview（sender） | `share.sheet_opened` | | |
| | `ai.request` / `ai.response` / `ai.error`（前端视角） | task、等待时长 | **用户感知的等待** |
| | `share.intent_shown` | primary/secondary、confidence、evidence | |
| | `share.evidence_hover` | 哪一个 cue | 看没看依据 |
| | `share.intent_edit_start` / `share.intent_edited` | before / after 全文 | 改 intent |
| | `share.type_changed` | from → to | 换 type |
| | `share.regenerate` | 第几次 | loops |
| | `share.gap_shown` / `share.gap_answered` | question、options、选了哪个或自己写的 | gap detection |
| | `share.preview_scroll` | 最大滚动比例 | 看没看完 preview |
| | `share.sent_card` / `share.sent_plain` / `share.closed` | 最终 card id | **outcome** |
| Card（receiver） | `card.rendered` | 出现在对话里 | |
| | `card.seen` | 卡片 ≥50% 可见持续 1s（IntersectionObserver） | **receiver 真正看到的时刻** |
| | `card.chip_click` | anchor index、kind、跳到的 URL / 时间点 | 用了哪个 anchor |
| | `card.open_original` | | |
| | `card.action_click` | action type、选项 | 时间选项等 mock action |
| | `card.dwell` | 卡片可见的累计时长（离开视野时上报） | 看了多久 |
| Message | `msg.sent` / `msg.received` | message id、kind | 回复延迟 |
| Survey | `survey.shown` / `survey.answered` / `survey.skipped` | item id、答案、耗时 | |
| Study | `study.condition_changed`、`study.exclude_message` | | |

> AI 调用除了前端的 `ai.*` 事件，server 端还会在 `ai_calls` 表里存完整记录（§6.3），两者用 `request_id` 连起来，可以区分「模型本身花的时间」和「用户等的总时间」。

### 6.3 表（`study` schema）

| 表 | 关键字段 |
|---|---|
| `participants` | id, code（6 位，登录用）, pair_id, role（A/B）, display_name, relationship_type, known_duration, is_demo, enrolled_at, study_ends_at, withdrawn_at |
| `pairs` | id, label, condition_mode（`ai` / `baseline` / `schedule`）, condition_schedule（jsonb：按日期切换，counterbalance 用）, notes |
| `sessions` | id, participant_id, started_at, last_seen_at, ended_at, user_agent, viewport, tz, clock_offset_ms, app_version |
| `conversations` | id, pair_id（每对一个 conversation；demo 每个 session 一个） |
| `messages` | id, conversation_id, sender_id, kind（text/card/plain_link）, text（verbatim）, link_url, card_id, client_ts, server_ts, excluded |
| `shares` | id（client 生成，trigger 出现时就有）, participant_id, conversation_id, condition, trigger_kind, link_url, outcome, final_card_id, created_at, closed_at |
| `cards` / `card_versions` | card：最终 `ShareCard`（brief §4.2 原样 jsonb）+ status；version：每次 regenerate 一行（intent、extraction、是否 sender 改过 intent） |
| `ai_calls` | id, share_id, task, model, prompt_version, **system + user prompt 全文**, **raw output 全文**, parsed jsonb, stop_reason, input/output/cache tokens, latency_ms, attempt, error, anthropic_request_id |
| `events` | §6.1 的全部字段 + payload jsonb |
| `survey_answers` | id, participant_id, share_id/card_id, item（m1a/m1b/m2/post_rating）, value, shown_at, answered_at |
| `content_cache` | url, content_object jsonb, adapter, fetched_at |

### 6.4 自动算出的指标（SQL views）

| View | 每行 | 字段（举例） |
|---|---|---|
| `v_share_timeline` | 一个 share 的每一步 | step、开始时间、**本步耗时**、本步点击数、本步 keystroke 数 |
| `v_share_funnel` | 一个 share | compose→trigger、trigger→sheet、sheet→intent 显示、intent→card 显示、card→send 的秒数；**总点击数**；regenerate 次数；改 intent 次数；是否回答 gap；outcome；AI 等待总时长 |
| `v_receiver_timeline` | 一张卡 | 送达→seen、seen→第一次点 chip、seen→回复的秒数；点了哪些 chip；dwell |
| `v_ai_quality` | 一次 AI 调用 | AI type vs scenario expected（demo）/ vs 研究者编码（study，编码表之后加）、confidence、latency |
| `v_daily_compliance` | participant × 日 | 当天 share 数（≥3 的要求）、使用分钟数 |
| `v_intent_fidelity` | 一张卡 | m1a、m1b、m2、事后打分放在一行，方便编码 |

Admin console 直接显示这些 view，并能导出 CSV（给 R / Python 分析）和 JSONL（原始 events）。

### 6.5 隐私 / IRB 相关 ✅（⚠️ 有两条要写进 MOD）
- 不收集 email、真名；participant code 是唯一身份。
- 参与者可以在任何消息上点「Exclude from study」→ 这条消息和它的卡片、AI 调用、相关 events 都标 `excluded`，所有 view 和导出自动跳过。
- Withdrawal：admin 一键删除某个 participant 的全部数据（按 IRB v0.8 的 pair 规则，可选择同时删除对方与之相关的消息）。
- 研究期结束（`study_ends_at`）后，该 participant 只能看，不能再发。
- ⚠️ **要写进 IRB MOD**：(1) 记录输入框的**未发送草稿**快照和所有点击；(2) AI 调用的完整 prompt/output 存在 Supabase。这两条在 v0.8 里描述得不够细。我会在 `docs/irb-data-appendix.md` 里写一份可以直接贴进 MOD 的数据收集说明。

---

## 7. 前端要动的地方（最小改动，UI 不变）

| 改动 | 说明 |
|---|---|
| 拆文件 | artifact 的单个 HTML → `public/app.html` + `js/core.js` + `js/ui.js`，内容不变 |
| `ask()` | 改成 `fetch('/api/ai/intent' | '/api/ai/extract')`，错误码沿用 artifact 的 `ERR` 文案 |
| `logEvent()` | 改成 telemetry client；artifact 里已有的 log 点全部保留，再补 §6.2 里缺的 |
| Content | `adapt()` 先查前端 fixtures，查不到调 `/api/content` |
| Baseline | link preview 用 `/api/unfurl` 的真实 OG 数据 |
| **新增：登录** | `/join`：输入 6 位 code（沿用现有样式的一个小卡片）；`/demo`：不登录，保留 A/B screen 切换 |
| **新增：两台设备** | Study mode 里隐藏 A/B 切换，对方的消息由 `sync.js` 拉进来 |
| **新增：survey** | 发送后在卡片下方出现可跳过的 m1a/m1b；receiver 打开卡片、回复前出现 m2；事后打分在第二天打开 app 时出现。用 artifact 现有的 `.gap` 样式，不另做设计 |
| **新增：Exclude** | 消息右键 / 长按菜单 |

这些新增界面先用现有 CSS 拼出来，之后你在 Figma 里改了再同步。

---

## 8. 执行阶段（按阶段，不按日期）

| Phase | 内容 | 完成标准 |
|---|---|---|
| **P0 · Infra** | 按 Q1 restore `core-share`；repo 建 `intentshare/`（Next.js + TS）；Vercel project `intentshare` 连 repo；env：`SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`、`SERVER_RPC_KEY`、`ADMIN_TOKEN`、`AI_MODE`、`MODEL_*` | push 到 main 自动部署成功，`/api/health` 返回 DB ok |
| **P1 · Schema** | `study` schema 全部表、索引、RPC、views；跑 Supabase security + performance advisors 并修掉 | advisors 无 error；SQL 测试脚本插入一组假 events，views 算出正确的时长 |
| **P2 · App + telemetry** | 前端搬进 repo；`/api/session`、`/api/events`、`/api/messages`；telemetry client（队列、beacon、重发、去重）；mock AI | demo 模式跑完 S1：DB 里能看到完整 event 链，`v_share_funnel` 有正确的一行 |
| **P3 · Claude** | `lib/claude.ts`、两个 prompt、structured outputs、`ai_calls` logging、超时重试、rate limit、eval harness（含 §11.2 的 held-out message set） | mock 下 17 个场景全通过；有 key 后 live smoke test + eval 报告 |
| **P4 · Study mode** | `/join`、pair、两台设备 sync、condition（含按日期 schedule）、survey、Exclude、研究期结束锁定 | 两个浏览器 context 模拟一对 participant：A 发卡 → B 收到、看到、点 chip、回复、答 m2；所有 timing view 正确 |
| **P5 · Content adapters** | unfurl（OG）；article（fetch + Readability，按段落切 units）；Reddit（`.json`）；YouTube（尝试抓 transcript，失败 fallback 到 oEmbed 标题 + container-only）；`content_cache` | 真实 article / Reddit link 能出卡；YouTube 失败时优雅 fallback ⚠️ |
| **P6 · Researcher console** | `/admin`（ADMIN_TOKEN）：participants/pairs 管理、实时 event 流、单个 share 的时间线回放、views 表格、CSV/JSONL 导出、withdrawal 删除；**coding 工具**（§11.2：两位 coder 给 m1a/m2/held-out message 编 intent type、给 content 标「正确的 anchor」，自动算 Cohen's κ 和 anchor overlap） | 能从 console 建一对 participant 并导出他们的数据 |
| **P8 · CHI demo readiness**（§11.4） | Booth mode（不记录任何参与者数据）、replay cache（会场断网也能跑）、presentation mode、receiver 手机视图 + QR、still image 导出、video 录制辅助 | 断网状态下 5 分钟内能完整演示 3 个场景 |
| **P7 · 验证与文档** | Playwright e2e（demo + pair）；数据 QA 脚本（seq 缺口、孤立 event、时间倒流）；README、data dictionary、IRB 数据附录、pilot runbook；同步到你本地 folder 和 Project | 全部测试通过；一份 pilot 用的 checklist |

每个 phase 结束：commit + push（自动部署）→ 线上验证 → 同步本地 `AI widgets/intentshare/` → 更新 `docs/BUILD-LOG.md`（每个我自己做的决定都写进去，方便你事后翻）。

---

## 9. 我会自己决定的默认值（不再问你）

| 项 | 默认 |
|---|---|
| Repo 位置 | `share-core/intentshare/`（这个 session 没法新建 GitHub repo；同一 repo 也方便论文 artifact 统一） |
| Participant code | 6 位大写字母 + 数字，排除易混字符（0/O、1/I） |
| Demo 数据 | demo 模式的数据也存，但 `is_demo = true`，所有 study view 默认排除 |
| Condition | 默认按 pair 设置；支持按日期 schedule（例如 Day 1–2 AI、Day 3 baseline，counterbalance 起始），具体分配等 IRB MOD 定了再填 |
| Sync | 2 秒 polling（8 对人足够，比 Realtime 少一层权限配置） |
| 未发送草稿 | 记录（§6.5，写进 MOD）；如果 IRB 不允许，一个 env 开关 `LOG_DRAFT_TEXT=false` 就只记长度不记内容 |
| 界面语言 | English（IRB）；demo 场景里的中文 message 不变 |
| 时区 | DB 全部 UTC `timestamptz`，session 记录参与者时区 |

---

## 10. 风险 ⚠️

| 风险 | 应对 |
|---|---|
| Q1 没解决 → 没有数据库 | 其他部分可以在本地 Postgres 先开发测试；但上线必须有 |
| YouTube transcript 在 Vercel IP 上经常被挡 | Demo 用 fixtures；field study 前单独 spike，失败就 fallback（brief §13 #8） |
| Repo 是 public | 不放 key、不放数据；你之后改 private 不影响 Vercel 部署 |
| IRB v0.8 描述的是 extension flow | 这套 backend 同时支持 demo（不受 IRB 限制）和 study mode；study mode 上线前等 MOD |
| 记录过细，数据量大 | 估算：每个 share ~100 条 events，整个 study < 10 万行，远低于 free plan 500MB |
| Free plan 一周无活动会自动 pause | Field study 期间每天有流量不会触发；console 首页显示 DB 状态 |

---

## 11. CHI 2027 Interactive Demo：要收集的数据和开发注意事项

### 11.1 官方要求（CHI 2027 Interactive Demos CfP）

| 项 | 要求 | 对我们的影响 |
|---|---|---|
| 截止 | **2027-01-21（AoE）** 投稿；2/18 通知；3/18 camera-ready | Field study 必须在 1 月初前跑完，才有时间写进去 |
| Proposal | ≤ 6 页单栏 ACM（不含 references），150 字以内 abstract；系统描述、解决的问题、和 CHI 的相关性、**user experience** 怎么样 | 需要真实的卡片截图、pipeline 图、技术数字、使用数据 |
| Walkthrough video | **必交**，≤ 5 分钟（建议 ≤ 3 分钟），要展示用户怎么交互、体验多长 | 需要稳定、可重复的演示流程（presentation mode + replay） |
| Still image | ≥ 1920×1080，加 image description | 需要导出高分辨率卡片 / 界面图 |
| Booth 计划 | 约 2m×2m；桌子、WiFi、插座；**每位访客最多 5 分钟**；要说明 bystander 怎么看懂；需要的插座数提交时就要写 | 要有 5 分钟内能讲完的路径、不依赖会场 WiFi、旁观者能看懂的第二块屏幕 |
| 审稿看重 | Novelty（写清楚和已有工作的区别）、**现场可行性**（要求的资源太多会被拒） | 设备尽量少：一台 laptop + 一部手机 |
| 不匿名 | 要写全部作者 | 无影响；repo 保持可公开 |
| Human subjects | 必须符合本校 ethics review，并给 reviewer 写一段说明 | 论文里用到的参与者数据都必须来自 IRB 批准后的 session |
| 媒体权利 | 视频 / 图片里的可识别的人要有授权；音乐要 rights-free；所有内容都要有使用许可 | Demo 素材用 mock 内容或 CC 授权的内容，不用别人的 YouTube 画面截图 |
| Accessibility | 按 SIGCHI accessible submission guide 和 video guide | 视频要有字幕；界面要支持键盘操作、足够的对比度 |
| AI 使用 | 遵守 ACM 关于 LLM 的 authorship policy | 写论文时 AI 生成的文字要按 policy 标注（这和系统里用 AI 是两件事） |

> CfP 没有要求必须有 user study，但 demo 只有 4 页（camera-ready 双栏），能放进去的证据很有限，所以要选**最能支撑 novelty 的几个数字**，而不是什么都报。

### 11.2 要收集的数据（按优先级）

**A. 不需要参与者、随时可以做的（technical evaluation）** —— 这是 demo paper 最稳的证据，P3 / P6 里实现

| 数据 | 怎么收 | 论文里怎么用 |
|---|---|---|
| Intent classification 准确率 | 17 个场景 + **一个 held-out message set**（60–100 条真实风格的 message，覆盖 15 个 type，由你和另一位 coder 独立标注，算 Cohen's κ 作为 human agreement 的上限）；AI 结果 vs 人工标注 | 「AI 和人一致到什么程度」+ confusion matrix（哪些 type 容易混，例如 SUGGEST vs PROPOSE 的 indirect 版本） |
| Evidence 的有效性 | Evidence quote 是否真的是 IFID（人工打分 0/1） | 支撑「依据可以帮 sender 发现 AI 误解」这个设计主张 |
| Anchor 质量 | 对每个场景的 content，人工标「和 intent 相关的 units」；算 AI anchors 与人工标注的 precision / recall，time range 算 IoU | 「intent-conditioned extraction」是 core contribution，这是最直接的数字 |
| Boundary snapping | Anchor 起止点是否落在句子 / 段落边界（自动检查） | 一句话即可 |
| Latency | 每次 share 的 trigger → intent 显示、trigger → card 显示（p50 / p95）；模型本身时间 vs 用户等待时间 | 回答「会不会打扰正常聊天」，也是 booth 可行性的依据 |
| Gap detection / fallback 比例 | 哪些 message 触发了追问或 fallback | 说明系统在低 confidence 时的行为 |
| 成本 | 每次 share 的 token 数 | 一句话 |
| Prompt / 模型版本 | 每条 `ai_calls` 都有 | 可复现性 |

**B. Field study（IRB 批准 + MOD 之后）** —— 已经在 §6 的 logging 里，这里列出 demo paper 会用到的部分

| 数据 | 来源 | 论文里怎么用 |
|---|---|---|
| 使用量 | `v_daily_compliance` | 「N 对、M 次 share、覆盖哪些 content type 和 intent type」 |
| Sender 的 control 和 trust | 不改直接发的比例、改 intent 次数、regenerate 次数、dismiss（Send as plain link）比例 | 对应 L0–L4「who decides the core」 |
| **Intent transfer fidelity** | m1a vs m2 的 type 一致率（研究者编码），AI card vs baseline | 最核心的 user-side 证据：卡片是否让 receiver 更准确地理解 sender |
| 事后 sender 打分 | 「My partner understood what I meant」 | 同上，主观层面 |
| Receiver 行为 | seen → 第一次点 chip、seen → 回复的时间；点了哪个 anchor | 卡片是否真的被使用 |
| 真实卡片示例 | 参与者同意后的卡片截图（只用不含个人信息的） | Figure；**consent 里要有允许使用截图的选项** ⚠️ |
| 定性引述 | Exit interview（录音，不在这个系统里） | 1–2 句 quote |

**C. CHI booth 现场** —— **默认什么都不记录**

在会场收集访客数据需要单独的 IRB 批准，而且没有必要。Booth mode 只在本地计数（演示了几次、用了哪些场景），不存任何访客输入，不上传。

### 11.3 时间上的依赖（倒推）

| 里程碑 | 依赖 | 最晚 |
|---|---|---|
| A 类 technical eval 跑完 | 有 API key + held-out set 标注完 | 12 月中 |
| IRB 批准 | 11/3 convened review | 11 月 |
| IRB MOD（新 flow + logging 细节 + 截图使用） | §6.5 的数据附录 | 11 月中提交 |
| Field study（8 对 × 3 天） | MOD 批准 | 12 月 |
| 写 proposal、录 video | Presentation mode、still image 导出 | 1 月初 |
| 投稿 | — | **1/21** |

⚠️ 如果 MOD 赶不上，demo paper 只用 A 类数据 + 作者自己演示的 walkthrough 也可以投（CfP 不要求 user study）；field study 的结果留给 UIST。

### 11.4 开发时要注意的（已加进 P8 和其他 phase）

| 注意事项 | 怎么做 | Phase |
|---|---|---|
| **数据来源分开** | 每条记录有 `data_origin`：`study` / `pilot` / `demo` / `author` / `booth` / `eval`。论文只用 `study`（和 IRB 允许的 `pilot`）；所有 view 默认按 origin 过滤 | P1 |
| **会场 WiFi 不可靠** | Replay cache：每个 preset 场景的 live AI 结果存一份；断网或超时就回放，并在屏幕角落标「cached」（不对访客隐瞒） | P8 |
| **5 分钟限制** | Booth mode 有 3 个预设路径（PROPOSE / DELIVER·opinion / 只发 link 的 gap question），一键 reset；每次演示从打字到 receiver 收到 < 60 秒 | P8 |
| **Bystander 看得懂** | 第二块屏幕：receiver 视图在手机上（扫 QR 进入同一个 conversation）；可选的「layer view」显示 ContentObject → Intent → Anchors → Card（复用旧 artifact 的 playground 思路） | P8 |
| **设备少** | 只需要 1 台 laptop + 1 部手机 + 1 个插座；receiver 视图必须适配手机宽度 | P8 |
| **Video 可重复** | Presentation mode：隐藏 study 菜单和 event 计数、固定名字 A / B、固定时间；用 replay cache 让每次录制结果一致 | P8 |
| **Still image** | Admin 里一键把任意卡片 / 界面导出成 1920×1080 PNG（Playwright 截图） | P8 |
| **素材版权** | Demo 和 video 只用 mock 内容或 CC 授权内容；界面上不出现 Apple / iMessage 名字和图标（已经是这样） | 全程 |
| **Accessibility** | 键盘可操作（composer、preview、chips）、ARIA label、颜色对比 ≥ 4.5:1、不只靠颜色区分 Searle class；video 加字幕 | P7 |
| **可复现** | Repo 公开时附 payload spec、prompt 文件、eval 脚本和 held-out set（不含参与者数据） | P7 |
| **Novelty 证据** | Baseline 开关从第一天就在；technical eval 也跑一个「content-only summary」baseline（不看 intent），对比 anchor 质量，直接说明 intent-conditioned 的价值 | P3 |
| **失败案例** | `ai_calls` 里 classification 错误、fallback 的例子自动收集到 admin 的「failure gallery」，写 limitations 用 | P6 |
| **截图授权** | Consent 加一项「允许在论文中使用不含个人信息的卡片截图」 | IRB MOD |
