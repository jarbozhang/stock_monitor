---
name: ifind-query
description: |
  Use this skill to fetch A股 (Chinese A-share) stock price data via the iFinD/同花顺 API.
  TRIGGER when the user asks to pull, query, or export: daily/weekly K-lines (日线/周线),
  minute/hour intraday bars (分钟线/小时线), OHLCV data (开高低收/成交量), closing prices (收盘价),
  or real-time quotes with capital flow (资金流向) for any A-share stock — by name (茅台, 宁德时代,
  中信证券) or code (300750.SZ, 600519.SH). This is the DEFAULT data-fetching tool for A-share
  market data. If no other data source is specified, use this skill. Also trigger when
  同花顺/iFinD/THS is explicitly mentioned as the data source. Do NOT trigger for:
  东方财富/tushare, US/HK stocks, 财报/fundamental analysis, writing scrapers, or pure market discussion.
---

# iFinD 数据查询

你是一个 A 股数据查询助手，通过 iFinD HTTP API 获取股票行情数据。项目脚本位于 `/Users/jiabozhang/Documents/Develop/vibecoding/stock/ifind/`，零外部依赖，纯 Node.js 实现。

## 股票代码格式

iFinD 使用 `代码.交易所` 格式，多个股票用逗号分隔：
- 深交所: `300033.SZ`, `000001.SZ`
- 上交所: `600030.SH`, `601318.SH`
- 北交所: `830799.BJ`

## 三种查询命令

所有命令的基本调用方式：

```bash
cd /Users/jiabozhang/Documents/Develop/vibecoding/stock/ifind && node src/index.js <command> [options]
```

### 1. history — 历史行情（日线/周线）

查询指定时间范围的 OHLCV 及涨跌幅数据。

```bash
node src/index.js history \
  --codes "300033.SZ,600030.SH" \
  --start 2024-01-01 \
  --end 2025-03-10 \
  --interval D \
  --cps 2 \
  --format json \
  --output /tmp/history.json
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--codes` | 股票代码，逗号分隔 | 必填 |
| `--start` | 开始日期 YYYY-MM-DD | 必填 |
| `--end` | 结束日期 YYYY-MM-DD | 必填 |
| `--interval` | D=日线, W=周线 | D |
| `--cps` | 1=不复权, 2=前复权, 3=后复权 | 2 |
| `--format` | csv / json | json |
| `--output` | 文件路径 | 自动生成到 output/ |

返回字段: `code, time, open, high, low, close, volume, amount, changeRatio, turnoverRatio, preClose`

### 2. highfreq — 高频数据（分钟线/小时线）

查询分钟级 K 线数据，时间跨度超 2 年会自动分段请求并合并。

```bash
node src/index.js highfreq \
  --codes "300033.SZ" \
  --start "2025-03-01 09:30:00" \
  --end "2025-03-10 15:00:00" \
  --interval 60 \
  --format json \
  --output /tmp/highfreq.json
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--codes` | 股票代码 | 必填 |
| `--start` | 开始时间 "YYYY-MM-DD HH:mm:ss" | 必填 |
| `--end` | 结束时间 "YYYY-MM-DD HH:mm:ss" | 必填 |
| `--interval` | 分钟周期: 1/3/5/10/15/30/60 | 60 |
| `--format` | csv / json | json |
| `--output` | 文件路径 | 自动生成 |

返回字段: `code, time, open, high, low, close, volume, amount, changeRatio`

### 3. realtime — 实时行情快照

获取当前实时行情和资金流向数据。

```bash
node src/index.js realtime \
  --codes "300033.SZ,600030.SH" \
  --format json \
  --output /tmp/realtime.json
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--codes` | 股票代码 | 必填 |
| `--format` | table / csv / json | json |
| `--output` | 文件路径 | table 直接终端输出 |

返回字段: `latest, open, high, low, change, changeRatio, volume, amount, pe_ttm, pb, totalCapital` 以及资金流向（主力/散户/超大单/大单/中单/小单的流入流出净额）

## 使用指南

### 选择合适的命令

- 用户想看某只股票过去 N 天/月/年的走势 → **history**
- 用户想看日内分时走势、小时线 → **highfreq**
- 用户想知道现在的价格、今天的涨跌、资金流向 → **realtime**

### 输出处理

默认使用 JSON 格式导出，便于后续读取和分析。拿到数据后：

1. 用 Read 工具读取 JSON 文件
2. 分析数据并回答用户的问题（走势分析、量价关系、横向对比等）
3. 如果用户需要，可以用数据做进一步计算（均线、波动率等）

### 注意事项

- 脚本依赖 `.env` 中的 `REFRESH_TOKEN`，如果报错"REFRESH_TOKEN 未配置"，提醒用户检查配置
- Token 有 7 天有效期（缓存在 `token.json`，6 天自动刷新），通常不需要手动处理
- API 限流 580 次/分钟，脚本内置滑动窗口限流，批量查询无需额外控制
- 高频数据跨度 > 2 年时脚本自动分段，无需手动拆分
- 非交易时间查实时行情会返回最近一个交易日的收盘数据
