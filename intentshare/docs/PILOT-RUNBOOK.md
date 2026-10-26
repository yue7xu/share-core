# Pilot runbook · 用两位 labmate 跑一次完整流程

> 目的：在 IRB MOD 批下来之前，用 `pilot` origin 把 field study 的每一步走一遍，确认数据完整。pilot 数据**不进论文**（除非 IRB 允许），只用来查问题。

## 开始前（10 分钟）

1. 打开 `/api/health`，确认 `ok: true`、`ai: live`、`warnings: []`。
2. 打开 `/admin` → **Pairs** → New pair：
   - label 填 `PILOT-1`，A、B 填两人想用的显示名；
   - origin 选 **pilot**，days 填 `1`，condition 选 `schedule`；
   - schedule 改成 `[{"from":"<今天>","condition":"ai"}]`，跑完 AI 那部分再改成 baseline。
3. 把两个 code 分别发给两位参与者，链接是 `https://<域名>/join`。

## Session 中（每人约 20 分钟）

| 步骤 | 研究者做什么 | 在 console 里核对 |
|---|---|---|
| 1. 登录 | 两人在各自的电脑或手机上打开 `/join`，输入 code | **Live** 里出现两个人的 `app.session_start` 和 `app.clock` |
| 2. 普通聊天 | 互发几条文字 | `msg.sent` / `msg.received`，两边都能实时看到对方的消息（2 秒内） |
| 3. AI share ×3 | A 打一句话并贴一个真实的 YouTube / article / Reddit link 发出，看 preview，至少一次点 "Not right? Change the intent" | **Shares** 里出现 3 行；点开一行，能看到每一步的耗时、点击数和完整的 prompt / output |
| 4. Study questions | A 回答 m1a/m1b；B 看到卡片后回答 m2，再回复 | **Fidelity** 里同一行同时有 m1a、m1b、m2 |
| 5. 切到 baseline | console 里把 schedule 改成 baseline（或把 mode 改成 baseline） | 2 秒内 A 再发 link，会直接以普通 link preview 的形式发出 |
| 6. Exclude | A 在任意一条自己的消息上点 "Exclude from study" | 这一条从 **Shares** 和 **Receiver** 里消失 |
| 7. 断网测试（可选） | A 关掉 Wi-Fi，发一条消息，再连上 | 页面提示 "couldn't be delivered"；重新连上后，**Data quality** 里 `missing_seq = 0`（离线期间的 events 补传上来了） |

## 结束后

1. **Data quality**：所有 session 的 `missing_seq = 0`，`clock_offset_ms` 都在 ±2000 以内。
2. **Export**：下载 `v_share_funnel` 和 `v_receiver_timeline` 的 CSV，用 R / Python 打开，确认字段可以直接分析。
3. 记下问题：哪里卡住了、等 AI 等了多久（看 `s_open_to_card`）、有没有误触发（`share.trigger_hidden` 比 `share.sheet_opened` 多很多就说明误触发多）。
4. 如果这些 pilot 数据不需要保留：在 **Pairs** 里点这个 pair → Withdraw A 和 B（会删除他们的全部数据）。

## 正式 field study 前的检查清单

- [ ] IRB MOD 已批准（新的 flow、logging 细节、截图使用授权）。
- [ ] `LOG_DRAFT_TEXT` 和 IRB 批准的写法一致。
- [ ] 每一对的 `study_days = 3`、condition schedule 已经 counterbalance（一半的 pair 先 AI，一半先 baseline）。
- [ ] Anthropic Console 设了 spend limit。
- [ ] 用一个真实的 YouTube link 测过 transcript 能抓到（Vercel 的 IP 有时会被 YouTube 挡；抓不到时卡片会退回到只有 message + link 的 container-only 形式，console 的 **AI & eval** 里看 failure gallery）。
