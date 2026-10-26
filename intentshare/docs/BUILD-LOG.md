# BUILD-LOG · 实现过程中替你做的决定

> 2026-10-26，按 `PLAN.md` v2 执行。你说过中途不问你，所以下面每一条都是我按推荐做的决定，事后可以逐条推翻。
> 标记：✅ 完成 ｜ ⛔ 被权限挡住，需要你操作（见 `SETUP.md`） ｜ 🎨 留给你在 Figma 里改的 UI 问题

## 1. 进度

| Phase | 状态 | 说明 |
|---|---|---|
| P0 Infra | ⛔ 部分完成 | Repo ✅（`yue7xu/share-core/intentshare`，已合并到 `main`）。⛔ **Supabase**：LART 一直处于 "hibernating" 状态，API 无法 pause，`core-share` 也就没法 restore（SETUP 第 1 步）。⛔ **Vercel**：connector 没有创建 project 的权限，所有 create 接口都返回 403（SETUP 第 4 步）。|
| P1 Schema | ✅ | 3 个 migration，外加合并好的 `setup.sql`（可以重复执行）。在 PGlite（真实 Postgres 17 的 WASM 版）上跑过 11 个数据库测试 |
| P2 App + telemetry | ✅ | Artifact 的 UI 原样搬了过来；完整的 event log、message 存储、两台设备之间的 sync |
| P3 Claude | ✅（live 待 key） | Structured outputs、prompt caching、超时重试、rate limit、`ai_calls` 全量记录；mock 模式下 17 个场景全部通过。Eval endpoint 和 console 里的 runner 都已就绪 |
| P4 Study mode | ✅ | `/join`、pair、condition schedule、m1a/m1b/m2/post rating、Exclude、研究期结束后锁定、离线重发 |
| P5 Content adapters | ✅（未在线验证） | YouTube transcript、Reddit `.json`、文章（Readability）、OG unfurl，带缓存。⚠️ 这个 workspace 连不上 YouTube / Reddit，所以真实网站要等部署后再验证 |
| P6 Console | ✅ | `/admin`：Pairs、Live、Shares（逐步时间线 + 完整 prompt）、Receiver、Fidelity、Daily、AI & eval（failure gallery + evaluation runner）、Coding（盲编码 + Cohen's κ）、Export、Data quality |
| P8 CHI demo | ✅ | `/booth`（不记录任何数据，replay cache，扫 QR 用手机当 B）、`/present`、still image 脚本（3840×2160）、Reset |
| P7 验证 + 文档 | ✅（本地） | 40 个 unit/DB 测试；Playwright e2e 覆盖 demo、两台设备、baseline、exclude、离线、booth，外加 console smoke test。线上验证要等 SETUP 完成后再做 |

## 2. 架构上的决定

| # | 决定 | 理由 |
|---|---|---|
| A1 | 代码放在 `share-core/intentshare/`，没有新建 repo | 这个 session 没有新建 GitHub repo 的权限；放在同一个 repo，论文的 artifact 也更集中。旧的 `web/`、`extension/` 没有动 |
| A2 | 前端保持 artifact 的 vanilla JS，Next.js 只负责 API 和静态文件 | 方便你之后把 Figma 里的改动 1:1 搬进来，不用维护两套 UI |
| A3 | Taxonomy 和 17 个 fixtures 只保留一份（`lib/data/*.json`），前端通过 `/api/bootstrap` 拿 | 保证 prompt 里的 taxonomy 和界面上显示的永远一致 |
| A4 | 数据库：所有表放在不对外暴露的 `study` schema，只能通过一个 `SECURITY DEFINER` dispatcher 访问，并且要校验 server key | Supabase MCP 拿不到 service role key，我也不经手你的 secret；这样效果等同于 service role |
| A5 | 浏览器拿到的 session token 是 HMAC 签名的 `participant.session.mode` | 一个浏览器只能以自己登录的那个人的身份写数据；booth 的 token 从 server 端开始就不记录 |
| A6 | 本地开发和测试用 PGlite | 不需要 Docker 或数据库账号，并且和线上跑的是同一套 SQL |
| A7 | 没有 API key 时自动进入 mock AI 模式：对 17 个 sample 返回它们设计时对应的 type，其他输入按 cue 规则猜 | 不阻塞开发，e2e 测试的结果也是确定的。Mock 的调用照样写进 `ai_calls`，model 记为 `mock` |
| A8 | Intent 用 `claude-haiku-5-5`，extract 用 `claude-sonnet-5-5`；Quick 模式两个都用 Haiku | Intent 只读一句话，要快；extract 要读全部 content units，质量优先。Study 和 present 默认用 Default，demo 默认用 Quick |
| A9 | Two-device sync 用 2 秒 polling，没有用 Realtime | 8 对人的量够用，不需要额外配置 RLS policy |
| A10 | 用 NTP 方式校准时钟：调 3 次 `/api/time`，取 round trip 最短的那次 | 测试时发现，用 cold start 期间的 session_start 来算 offset 会差 1 秒以上，导致跨设备的 seen→reply 时间出现负数 |
| A11 | Booth 的两台设备之间还是要通过数据库转发消息（标记为 `booth`），console 里可以一键删除；events 和 AI 调用完全不记录 | 手机当 B 必须有服务器中转。这一点修改了 plan §11.2-C 里「什么都不上传」的写法 |
| A12 | 发出去的 card 里只存 content 摘要（kind、title、URL、时长），不存整份 transcript | 控制数据量；完整的 content 在 `ai_calls.user_prompt` 和 `content_cache` 里都有 |
| A13 | 用 `/api/admin/eval` 一次处理一个 item，由 console 或脚本循环调用 | Vercel Hobby 的单个 function 最多跑 60 秒 |
| A14 | 环境变量里的 `SERVER_RPC_KEY` 和 `ADMIN_TOKEN` 由你生成（SETUP 第 3 步） | 安全检查不允许我在对话里生成或经手真实的 secret；只要 key 还是临时值，`/api/health` 就会一直警告 |

## 3. 数据收集上的决定

| # | 决定 | 理由 |
|---|---|---|
| D1 | 每次 composition 一个 `draft_id`，从第一次和输入框交互开始算（focus、点 "+"、粘贴） | 「这次 share 点了几下」需要一个明确的起点 |
| D2 | `ui.click` 在捕获阶段记下时间，在 handler 跑完之后再写入；`draft_id` 取「点击前」和「点击后」中存在的那个 | 测试发现：开始一次 share 的点击（点 "+"、选 sample）和结束 share 的点击（Send），原来都会丢掉 draft id |
| D3 | `share.link_detected` 在停止打字 500ms 后才记录 | 原来在半截 URL（`https://w`）时就触发了 |
| D4 | 输入框的全文快照在停止打字 500ms 后记录，不记录逐个按键；`LOG_DRAFT_TEXT=false` 时只记长度 | 兼顾「具体的 input」和 IRB 的风险 |
| D5 | Receiver 端：卡片 ≥50% 可见算 rendered，持续 ≥1s 算 seen，离开视野时上报 dwell | 「真正看到」的时刻比「消息送达」更能说明理解成本 |
| D6 | m2 在 receiver「看到」之后、回复之前出现；post rating 在 ≥12 小时后、partner 答完 m2 之后出现 | 对应 brief §10 的时机 |
| D7 | Event 的 id 由 client 生成；server 端遇到重复 id 就跳过；失败的批次存进 localStorage，下次打开时补传 | 不丢、不重复；e2e 里的离线测试通过 |
| D8 | 所有 view 都带 `data_origin`，console 默认看 `study` | demo、pilot、eval 的数据不会混进论文数据 |
| D9 | Held-out set 由我写了 60 条（15 个 type × 4，中英混合），`proposed` 只是临时标签；需要 2 位 coder 在 console 里盲编码之后才作为正式标签 | 对应 plan §11.2-A；κ 会自动计算 |
| D10 | Technical eval 同时跑一个 content-only baseline（不给 intent） | 直接对比出 intent-conditioned extraction 带来的提升，这是 novelty 的证据 |

## 4. 修掉的 bug（artifact 里原本就有的）

| 问题 | 修法 |
|---|---|
| Regenerate 期间 "Send card" 仍然可以点，会把**旧卡片**发出去 | Extract 进行中时禁用 Send |
| `adapt()` 遇到真实 link 只能返回 container-only | 改为先查 fixtures，查不到就由 server 端 adapter 抓取 |

## 5. 🎨 留给你在 Figma 里看的 UI 问题（我没有改设计）

1. **Merged message 的情况**（先发一句话，60 秒内再发 link）：receiver 会看到两遍同一句话，一遍是普通气泡，一遍是卡片上方的 senderNote。建议卡片在这种情况下不再重复显示 note。
2. **新增的界面元素都是用现有 CSS 拼出来的**，需要你设计：登录页（输入 code）、study 问题面板（在输入框上方）、"Exclude from study" 按钮（hover 时出现在自己的消息旁边）、QR 弹层、离线提示 toast。
3. 手机宽度下，sidebar 会被隐藏（artifact 原本就是这样）。在 study 里只有一个对话，这样没问题。

## 6. 还没做 / 后续

- 线上验证（SETUP 完成后）：health、真实的 YouTube / Reddit / 文章 link、live eval、make-replay、still image。
- YouTube transcript 在 Vercel IP 上能不能稳定抓到，还需要一次 spike；抓不到时会优雅地退回 container-only。
- IRB MOD：`IRB-DATA-APPENDIX.md` 是可以直接贴进去的草稿，另外要在 consent 里加「允许在论文中使用卡片截图」。
