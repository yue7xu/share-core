# SETUP · 最后需要 Monica 亲手做的几步

> 代码、数据库 schema、测试都已经完成（见 `BUILD-LOG.md`）。下面这几步因为涉及**你的账号权限或 secret**，我不能、也不应该替你做。按顺序做完大约 15 分钟。
> 每一步做完，可以直接告诉 Claude「第 N 步好了」，后面能用 MCP 做的（比如第 2 步）我来接着做。

---

## 第 1 步 · Supabase：腾出一个 active project 的位置

**为什么**：Free plan 每人最多 2 个 active project。你选的是 pause **Learning Analysis Report Tool (LART)**。我用 API 试了很多次，Supabase 一直返回 `Cannot pause project while it is currently hibernating`，而且它的数据库也连不上。这种状态只能在 dashboard 里处理。

1. 打开 [Supabase Dashboard](https://supabase.com/dashboard/projects) → 点开 **Learning Analysis Report Tool**。打开这个页面通常就会把它从 hibernating 状态唤醒，等它显示 Healthy。
2. 进入 **Settings → General → Project availability**，点 **Pause project**。
   - 如果还是提示 hibernating：等 5 分钟再试；还不行就点页面右上角的 **Help → Contact support**，选这个 project，说明 "Cannot pause project while it is hibernating"。
3. 回到项目列表，打开 **core-share**，点 **Resume project**（restore 一般要 2–5 分钟）。

> 只想先跑起来、不想处理 LART？另一个选择是把 org 升级到 Pro（$25/月），然后直接 Resume core-share。

## 第 2 步 · 建数据库表（我来做，或者你自己粘贴）

- **方式 A（推荐）**：告诉 Claude「core-share 恢复了」。我会用 Supabase MCP 依次跑 `supabase/migrations/` 里的 3 个 migration，然后跑 security advisors。
- **方式 B**：在 core-share → **SQL Editor** 里粘贴 `supabase/setup.sql` 的全部内容，点 **Run**（重复跑也没关系）。

## 第 3 步 · 生成 server key，写进数据库

这把 key 只存在两个地方：数据库，和 Vercel 的 server 环境变量。浏览器、GitHub 里都不会出现它。

1. 生成一个随机字符串，至少 32 个字符。可以用密码管理器，或者在 Mac Terminal 里跑：
   ```bash
   openssl rand -base64 36
   ```
2. 在 core-share → **SQL Editor** 里运行下面这句，把 `<KEY>` 换成刚生成的字符串：
   ```sql
   insert into study.config (key, value) values ('server_key', '<KEY>')
   on conflict (key) do update set value = excluded.value;
   ```
3. 再生成**另一个**随机字符串，作为 `ADMIN_TOKEN`（研究者 console 的登录口令）。

## 第 4 步 · Vercel：导入 repo，建 project

我这边的 Vercel connector 没有创建 project 的权限（所有 create 接口都返回 403），所以这一步要你在网页上点。

1. 打开 [vercel.com/new](https://vercel.com/new)，scope 选 **yuexu3-2722's projects**，在 GitHub 列表里找到 **yue7xu/share-core** → **Import**。
2. **Project Name**：`intentshare`
3. **Root Directory**：点 Edit，选 `intentshare`。Framework 会自动识别为 **Next.js**。
4. 展开 **Environment Variables**，逐个添加下表（Production 和 Preview 都勾上）：

| Key | Value |
|---|---|
| `SUPABASE_URL` | `https://rjowwtiomxixvgfjnrik.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | core-share → Settings → API Keys → **Publishable key**（`sb_publishable_…`） |
| `SERVER_RPC_KEY` | 第 3 步生成的 server key |
| `ADMIN_TOKEN` | 第 3 步的另一个随机字符串 |
| `ANTHROPIC_API_KEY` | 你的 Claude API key，类型选 **Sensitive** |
| `AI_MODE` | `live` |
| `MODEL_INTENT` | `claude-haiku-5-5` |
| `MODEL_EXTRACT` | `claude-sonnet-5-5` |
| `MODEL_QUICK` | `claude-haiku-5-5` |
| `AI_CALLS_PER_HOUR` | `60` |
| `LOG_DRAFT_TEXT` | `true`（IRB 如果不允许记录未发送的草稿，改成 `false`，这时只记录长度） |

5. 点 **Deploy**。之后每次 push 到 `main` 都会自动部署。
6. 建议：在 [Anthropic Console](https://console.anthropic.com) 给这个 API key 设一个 monthly spend limit（比如 $20）。

## 第 5 步 · 验证（2 分钟）

| 打开 | 应该看到 |
|---|---|
| `https://<你的域名>/api/health` | `"ok": true`、`"ai": "live"`、`"warnings": []` |
| `https://<你的域名>/demo` | messaging app；左下角显示 "Live AI: on"；点 **+** 选 S1 → 发送 → 出现真实 AI 生成的卡片 |
| `https://<你的域名>/admin` | 输入 ADMIN_TOKEN 后进入 console；Shares 页能看到刚才 S1 那一条，点开有每一步的耗时和完整的 prompt / output |

如果 `warnings` 里提到 temporary key 或 mock，就说明对应的环境变量没设好，或者设完之后没有重新 deploy。改环境变量后，要在 Vercel → Deployments 里点 **Redeploy**。

## 第 6 步 · 本地开发（可选）

在你本地的 `AI widgets/intentshare/` 里（clone 下来的 repo 的 `intentshare/` 目录）：
```bash
cp .env.example .env.local     # 填 ANTHROPIC_API_KEY；不填 SUPABASE_URL 就自动用本地的 PGlite 数据库
npm install
npm run dev                    # http://localhost:3000/demo
```

## 第 7 步 · 有 key 之后跑一次（我也可以替你跑）

1. **Technical evaluation**：console → **AI & eval** → Set 选 `both`，Repeats 选 `3`，点 **Run evaluation**。17 个 sample 加 60 条 held-out，大约 5–10 分钟。
2. **CHI booth 的离线备份**：
   ```bash
   BASE=https://<你的域名> node scripts/make-replay.mjs
   ```
   然后 commit `public/app/replay.json`。
3. **投稿用的 still image**：
   ```bash
   BASE=https://<你的域名> SAMPLE=S10 node scripts/still-image.mjs
   ```
   输出 3840×2160 的 PNG 到 `figures/`。

---

### 各个地址

| 用途 | 路径 |
|---|---|
| Field study 参与者入口 | `/join`（也可以用 `/join?code=ABC123` 直接带上 code） |
| Demo（一个屏幕切换 A / B） | `/demo` |
| 录 video、做截图（隐藏 study 菜单） | `/present` |
| CHI booth（不记录任何数据；⋯ 菜单里有 QR，扫码在手机上打开 B） | `/booth` |
| 研究者 console | `/admin` |
| 健康检查 | `/api/health` |
