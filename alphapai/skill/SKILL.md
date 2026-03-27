---
name: alphapai-reader
description: |
  Alpha派（阿尔法派/AlphaPai/alphapie）会议纪要抓取与阅读技能。
  可以从 Alpha派 平台批量抓取卖方路演、专家会议、业绩交流会的完整内容，
  包括 AI 摘要、核心要点、Q&A 问答和录音转录全文，保存为本地 Markdown 文件。
  也可以搜索和阅读已抓取的会议内容，帮助用户快速了解特定行业或公司的最新研究观点。
  当用户提到"alpha派"、"阿尔法派"、"alphapai"、"alphapie"、"抓取会议"、"拉取纪要"、
  "路演纪要"、"卖方会议"时触发此技能。
  也适用于用户想查看已下载的会议内容、搜索特定主题的纪要时触发。
  当用户提到"刷新token"、"获取token"、"token过期"、"重新登录alpha派"时也触发此技能。
---

# Alpha派会议纪要抓取与阅读

你是一个投研数据助手，负责从 Alpha派 平台抓取和管理卖方会议纪要。

## 能力概览

1. **抓取会议** — 从 Alpha派 批量拉取会议纪要，保存为 Markdown
2. **搜索阅读** — 在已下载的纪要中搜索特定内容
3. **Token 管理** — 检查和更新认证 token
4. **浏览器兜底登录** — 当接口认证失效时，自动用 `agent-browser` 登录 Alpha派 后再重试抓取

## 抓取会议

主抓取脚本位于：

```bash
node <skill-dir>/scripts/scraper.mjs [选项]
```

如果希望在认证失败时自动改走浏览器登录兜底，优先使用：

```bash
ALPHAPAI_PHONE="手机号" ALPHAPAI_PASSWORD="密码" \
  <skill-dir>/scripts/fetch-with-browser-fallback.sh [选项]
```

### 支持的选项

| 参数 | 说明 | 示例 |
|------|------|------|
| `--pages N` | 抓取 N 页（每页50条） | `--pages 3` 拉取150条 |
| `--keyword "关键词"` | 按关键词搜索 | `--keyword "AI芯片"` |
| `--days N` | 只抓最近 N 天 | `--days 7` |

参数可组合使用：`--keyword "摩根士丹利" --days 30 --pages 2`

### 常见用法

- 用户说"拉取最新会议" → `node <skill-dir>/scripts/scraper.mjs --days 1`
- 用户说"抓取AI相关的" → `node <skill-dir>/scripts/scraper.mjs --keyword "AI"`
- 用户说"把最近一周的都拉下来" → `node <skill-dir>/scripts/scraper.mjs --days 7 --pages 5`
- 用户说"全量抓取" → 使用较大的 `--pages` 值，注意请求间隔已内置 300ms
- 如果之前报过 `unauthorized` / `缺少或失效的 authorization` → 改用 `fetch-with-browser-fallback.sh`

### 输出格式

每条会议保存为一个 Markdown 文件到数据目录（默认 `<skill-dir>/scripts/data/`），文件名格式：`日期_标题.md`。

每个文件包含以下部分（如果数据可用）：

1. **元信息** — 日期、嘉宾、行业、个股、发言人、时长、字数
2. **摘要** — AI 生成的一段话全文摘要
3. **分段概要** — 按时间分段，每段带标题和摘要
4. **核心要点** — 按主题组织的结构化要点
5. **Q&A** — 问答环节的问题和回答
6. **录音转录** — 完整逐句转录，带发言人识别和时间戳

脚本支持增量抓取，已存在的文件会自动跳过。

同时会生成 `data/_index.json` 索引文件，包含所有会议的 id、标题、日期、行业、个股信息。

## 搜索已下载的会议

已抓取的 Markdown 文件存储在 `<skill-dir>/scripts/data/` 目录下。
搜索时可以：

- 用 Glob 按文件名匹配：`<skill-dir>/scripts/data/*摩根*.md`
- 用 Grep 按内容搜索：在 data 目录下搜索关键词
- 读取 `_index.json` 获取完整索引，按行业或个股筛选

当用户想看某条会议的内容时，直接读取对应的 Markdown 文件并展示关键信息。
用户可能只想看摘要，也可能想看完整转录 —— 根据需求决定展示多少内容。

## Token 管理

认证信息存储在 `<skill-dir>/scripts/config.json`：

```json
{
  "authorization": "JWT token / USER_AUTH_TOKEN",
  "xDevice": "设备ID",
  "secretKey": "浏览器 localStorage 中的 SECRET_KEY（如果站点给）",
  "baseUrl": "https://alphapai-web.rabyte.cn",
  "pageSize": 50
}
```

Token 是 JWT 格式，有过期时间。Alpha派 在其他设备登录后会使旧 token 失效；当前站点可能还会校验 `x-device`，部分环境下也可能校验 `SECRET_KEY` / `sk`。

### 自动获取 Token（Playwright 方案）

当 token 过期或认证失败时，可运行：

```bash
node <skill-dir>/scripts/get-token.mjs
```

脚本会：
1. 打开一个可视浏览器窗口，导航到 Alpha派 登录页
2. 用户在浏览器中完成登录（手机号+验证码、微信扫码等）
3. 登录成功后，自动拦截 API 请求中的 JWT token，并尽量提取 `x-device`
4. 同时尝试从 localStorage 读取 `SECRET_KEY`
5. 将 `authorization`、`xDevice`、`secretKey` 保存到 `config.json`

首次使用前需安装依赖：

```bash
cd <skill-dir>/scripts && npm install playwright
npx playwright install chromium
```

### 自动获取 Token（agent-browser 兜底）

如果 Playwright 方式没弹出窗口、登录态不稳定、或用户明确要求走浏览器自动化，则使用：

```bash
<skill-dir>/scripts/refresh-auth-via-agent-browser.sh <phone> <password>
```

也可以通过环境变量传入：

```bash
ALPHAPAI_PHONE="138xxxx" ALPHAPAI_PASSWORD="******" \
  <skill-dir>/scripts/refresh-auth-via-agent-browser.sh
```

如果希望长期本机使用且不想每次手输，优先创建私有本地文件：

```bash
cp <skill-dir>/scripts/auth.local.example.json <skill-dir>/scripts/auth.local.json
# 然后把手机号/密码填进去
```

脚本读取优先级：
1. 命令行参数
2. 环境变量 `ALPHAPAI_PHONE` / `ALPHAPAI_PASSWORD`
3. `<skill-dir>/scripts/auth.local.json`

`auth.local.json` 仅用于本机私有凭据，已加入 `.gitignore`，不要提交到仓库。

这个脚本会：
1. 用 `agent-browser` 打开 Alpha派 登录页
2. 切到“账号密码登录”
3. 自动填入手机号和密码并提交
4. 等待进入站内首页
5. 从 localStorage 提取 `USER_AUTH_TOKEN`
6. **在 `agent-browser` 登录成功后，必须立即把最新的本地接口认证信息同步写回 `config.json`**，至少包括 `authorization`，并尽量更新 `xDevice` / `secretKey`

执行纪律：
- 只要 `agent-browser` 登录成功，不要停留在“浏览器里能用了”。
- 必须把浏览器拿到的最新 token 同步回本地接口配置，确保后续 `scraper.mjs` 能继续直接调用接口。
- 如果浏览器登录成功但没更新 `config.json`，视为流程未完成。

### 推荐抓取流程

遇到以下错误时，默认不要反复盲重试接口，而是切到浏览器兜底：
- `unauthorized`
- `缺少或失效的 authorization`
- `token过期`
- 用户明确说“重新登录 Alpha派”

优先顺序：
1. 直接跑 `scraper.mjs`
2. 若报认证错误，运行 `fetch-with-browser-fallback.sh`
3. 如果仍失败，再人工检查页面结构或站点风控

## 注意事项

- 平台总量约 35000+ 条会议，全量抓取需要较长时间，建议按需拉取
- 请求间隔已内置 300ms，避免被限流
- 部分会议可能没有录音转录（无 mtSummary 数据），这是正常的
- 搜索关键词时 API 返回的标题可能带 HTML 高亮标签，脚本已自动清理
- 如果接口报“系统繁忙，请稍后再试”，这更像站点侧限流/风控，不等于本地认证失效
- 输出使用简体中文
