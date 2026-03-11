/**
 * 盯盘数据拉取脚本
 * 拉取 watchlist 中所有股票的：实时行情 + 近 20 日日线 + 近 3 日小时线
 * 输出 JSON 到 stdout 供 Claude 分析
 */

import { resolve, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 将 console.log 重定向到 stderr，保持 stdout 纯净输出 JSON
const _log = console.log;
console.log = (...args) => process.stderr.write(args.join(' ') + '\n');

// 加载内置 eastmoney 模块
const { EastMoneyClient } = await import('./eastmoney/client.js');
const { fetchHistory, fetchHighFreq, fetchRealtime } = await import('./eastmoney/api.js');

// 读取 watchlist
const watchlist = JSON.parse(readFileSync(resolve(__dirname, 'watchlist.json'), 'utf-8'));
const codes = watchlist.codes.join(',');

// 日期工具
function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const today = new Date();
const days20ago = new Date(today.getTime() - 20 * 24 * 60 * 60 * 1000);
const days3ago = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000);

const client = new EastMoneyClient();

// 并行拉取三类数据
const [realtimeResult, dailyResult, hourlyResult] = await Promise.all([
  fetchRealtime(client, { codes }).catch(e => ({ error: e.message, tables: [] })),
  fetchHistory(client, {
    codes,
    startdate: fmt(days20ago),
    enddate: fmt(today),
    interval: 'D',
    cps: '2',
  }).catch(e => ({ error: e.message, tables: [] })),
  fetchHighFreq(client, {
    codes,
    starttime: `${fmt(days3ago)} 09:30:00`,
    endtime: `${fmt(today)} 15:00:00`,
    interval: '60',
  }).catch(e => ({ error: e.message, tables: [] })),
]);

// 组装输出
const output = {
  timestamp: new Date().toISOString(),
  watchlist: watchlist.codes,
  stocks: {},
};

for (const code of watchlist.codes) {
  const stock = { code };

  // 实时行情
  const rtTable = realtimeResult.tables?.find(t => t.thscode === code);
  if (rtTable?.table) {
    const t = rtTable.table;
    stock.realtime = {};
    for (const [key, arr] of Object.entries(t)) {
      stock.realtime[key] = arr[0];
    }
  }

  // 日线（最近 20 日）
  const dailyTable = dailyResult.tables?.find(t => t.thscode === code);
  if (dailyTable?.table) {
    stock.daily = dailyTable.table;
  }

  // 小时线（最近 3 日）
  const hourlyTable = hourlyResult.tables?.find(t => t.thscode === code);
  if (hourlyTable?.table) {
    stock.hourly = hourlyTable.table;
  }

  output.stocks[code] = stock;
}

// 恢复 stdout 输出 JSON
_log(JSON.stringify(output, null, 2));
