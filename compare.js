/**
 * 两渠道数据对比可视化
 * 用法: node compare.js --codes "000001.SZ" --start 2025-01-01 --end 2025-03-01 [--interval D] [--cps 2]
 *
 * 同时从 ifind 和 eastmoney 拉取数据，生成 HTML 对比图表
 * ifind 需要配置 REFRESH_TOKEN，未配置则只展示 eastmoney 数据
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// === CLI 参数解析 ===
function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true';
      opts[key] = val;
      if (val !== 'true') i++;
    }
  }
  return opts;
}

const HIGHFREQ_INTERVALS = new Set(['1', '5', '15', '30', '60']);

function isHighFreq(interval) {
  return HIGHFREQ_INTERVALS.has(interval);
}

// === 动态加载 ifind 模块 ===
async function fetchIfindData(codes, start, end, interval, cps) {
  try {
    const { REFRESH_TOKEN } = await import('./ifind/src/config.js');
    if (!REFRESH_TOKEN) {
      console.log('[ifind] REFRESH_TOKEN 未配置，跳过');
      return null;
    }
    const { IFindClient } = await import('./ifind/src/client.js');
    const api = await import('./ifind/src/api.js');

    const client = new IFindClient(REFRESH_TOKEN);
    console.log('[ifind] 正在获取数据...');

    if (isHighFreq(interval)) {
      return api.fetchHighFreq(client, { codes, starttime: start, endtime: end, interval });
    }
    return api.fetchHistory(client, { codes, startdate: start, enddate: end, interval, cps });
  } catch (e) {
    console.log(`[ifind] 获取失败: ${e.message}`);
    return null;
  }
}

// === 动态加载 eastmoney 模块 ===
async function fetchEastmoneyData(codes, start, end, interval, cps) {
  try {
    const { EastMoneyClient } = await import('./eastmoney/src/client.js');
    const api = await import('./eastmoney/src/api.js');

    const client = new EastMoneyClient();
    console.log('[eastmoney] 正在获取数据...');

    if (isHighFreq(interval)) {
      return api.fetchHighFreq(client, { codes, starttime: start, endtime: end, interval });
    }
    return api.fetchHistory(client, { codes, startdate: start, enddate: end, interval, cps });
  } catch (e) {
    console.log(`[eastmoney] 获取失败: ${e.message}`);
    return null;
  }
}

// === 从 tables 结构提取某只股票的列式数据 ===
function extractStockData(apiResult, code) {
  if (!apiResult?.tables) return null;
  const item = apiResult.tables.find(t => t.thscode === code);
  if (!item?.table) return null;
  return item.table;
}

// === 生成 HTML ===
function generateHTML(stockCode, emData, ifData, opts) {
  const hasEM = emData && emData.date?.length > 0;
  const hasIF = ifData && (ifData.close?.length > 0);

  // 准备 eastmoney 数据
  let emDates = [], emOpen = [], emClose = [], emHigh = [], emLow = [], emVolume = [], emAmount = [], emChangeRatio = [];
  if (hasEM) {
    emDates = emData.date;
    emOpen = emData.open;
    emClose = emData.close;
    emHigh = emData.high;
    emLow = emData.low;
    emVolume = emData.volume;
    emAmount = emData.amount;
    emChangeRatio = emData.changeRatio;
  }

  // 准备 ifind 数据（可能没有日期列）
  let ifDates = [], ifOpen = [], ifClose = [], ifHigh = [], ifLow = [], ifVolume = [], ifAmount = [], ifChangeRatio = [];
  if (hasIF) {
    ifDates = ifData.time || ifData.date || [];
    ifOpen = ifData.open || [];
    ifClose = ifData.close || [];
    ifHigh = ifData.high || [];
    ifLow = ifData.low || [];
    ifVolume = ifData.volume || [];
    ifAmount = ifData.amount || [];
    ifChangeRatio = ifData.changeRatio || [];
  }

  // ifind 没有日期列时：如果 eastmoney 有且条数相同，借用 eastmoney 的日期
  if (hasIF && ifDates.length === 0) {
    if (hasEM && emDates.length === ifClose.length) {
      ifDates = [...emDates];
    } else {
      ifDates = ifClose.map((_, i) => `row_${i}`);
    }
  }

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${stockCode} 数据对比 | ifind vs eastmoney</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d1117; color: #c9d1d9; padding: 20px; }
  h1 { text-align: center; margin-bottom: 8px; font-size: 22px; color: #58a6ff; }
  .subtitle { text-align: center; color: #8b949e; margin-bottom: 20px; font-size: 14px; }
  .chart-container { width: 100%; height: 500px; margin-bottom: 24px; background: #161b22; border-radius: 8px; border: 1px solid #30363d; }
  .chart-row { display: flex; gap: 16px; margin-bottom: 24px; }
  .chart-half { flex: 1; height: 400px; background: #161b22; border-radius: 8px; border: 1px solid #30363d; }
  .section-title { font-size: 16px; color: #58a6ff; margin: 16px 0 8px 4px; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .stats-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; }
  .stats-card h3 { color: #58a6ff; margin-bottom: 12px; font-size: 14px; }
  .stats-card table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .stats-card th, .stats-card td { padding: 6px 8px; text-align: right; border-bottom: 1px solid #21262d; }
  .stats-card th { text-align: left; color: #8b949e; }
  .stats-card td.label { text-align: left; color: #8b949e; }
  .diff-pos { color: #3fb950; }
  .diff-neg { color: #f85149; }
  .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-left: 6px; }
  .tag-em { background: #1f6feb33; color: #58a6ff; }
  .tag-if { background: #f0883e33; color: #f0883e; }
</style>
</head>
<body>

<h1>${stockCode} 数据源对比</h1>
<p class="subtitle">${opts.start} ~ ${opts.end} | 周期=${opts.interval} | 复权=${opts.cps === '1' ? '不复权' : opts.cps === '2' ? '前复权' : '后复权'}</p>

<h2 class="section-title">K线对比</h2>
<div class="chart-row">
  <div id="kline-em" class="chart-half"></div>
  <div id="kline-if" class="chart-half"></div>
</div>

<h2 class="section-title">收盘价叠加对比</h2>
<div id="close-overlay" class="chart-container"></div>

<h2 class="section-title">成交量对比</h2>
<div id="volume-compare" class="chart-container" style="height:350px;"></div>

<h2 class="section-title">涨跌幅对比</h2>
<div id="change-compare" class="chart-container" style="height:350px;"></div>

<div id="stats-section"></div>

<script>
const emData = {
  dates: ${JSON.stringify(emDates)},
  open: ${JSON.stringify(emOpen)},
  close: ${JSON.stringify(emClose)},
  high: ${JSON.stringify(emHigh)},
  low: ${JSON.stringify(emLow)},
  volume: ${JSON.stringify(emVolume)},
  amount: ${JSON.stringify(emAmount)},
  changeRatio: ${JSON.stringify(emChangeRatio)},
};

const ifData = {
  dates: ${JSON.stringify(ifDates)},
  open: ${JSON.stringify(ifOpen)},
  close: ${JSON.stringify(ifClose)},
  high: ${JSON.stringify(ifHigh)},
  low: ${JSON.stringify(ifLow)},
  volume: ${JSON.stringify(ifVolume)},
  amount: ${JSON.stringify(ifAmount)},
  changeRatio: ${JSON.stringify(ifChangeRatio)},
};

const hasEM = emData.dates.length > 0;
const hasIF = ifData.dates.length > 0;

const darkTheme = {
  backgroundColor: 'transparent',
  textStyle: { color: '#c9d1d9' },
  title: { textStyle: { color: '#c9d1d9', fontSize: 14 } },
  legend: { textStyle: { color: '#8b949e' } },
};

// K线图
function renderKline(containerId, title, data, color) {
  if (!data.dates.length) {
    document.getElementById(containerId).innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#8b949e;">无数据</div>';
    return;
  }
  const chart = echarts.init(document.getElementById(containerId));
  const klineData = data.dates.map((_, i) => [data.open[i], data.close[i], data.low[i], data.high[i]]);

  chart.setOption({
    ...darkTheme,
    title: { text: title, left: 'center', ...darkTheme.title },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      backgroundColor: '#1c2128',
      borderColor: '#30363d',
      textStyle: { color: '#c9d1d9' },
    },
    xAxis: { type: 'category', data: data.dates, axisLabel: { color: '#8b949e' }, axisLine: { lineStyle: { color: '#30363d' } } },
    yAxis: { scale: true, axisLabel: { color: '#8b949e' }, splitLine: { lineStyle: { color: '#21262d' } }, axisLine: { lineStyle: { color: '#30363d' } } },
    grid: { left: 60, right: 20, top: 40, bottom: 30 },
    series: [{
      type: 'candlestick',
      data: klineData,
      itemStyle: { color: '#3fb950', color0: '#f85149', borderColor: '#3fb950', borderColor0: '#f85149' },
    }],
    dataZoom: [{ type: 'inside', start: 0, end: 100 }],
  });
  window.addEventListener('resize', () => chart.resize());
}

renderKline('kline-em', 'eastmoney K线', emData, '#58a6ff');
renderKline('kline-if', 'ifind K线', ifData, '#f0883e');

// 收盘价叠加
{
  const chart = echarts.init(document.getElementById('close-overlay'));
  // 对齐日期：以 eastmoney 日期为准
  const series = [];
  if (hasEM) {
    series.push({ name: 'eastmoney 收盘价', type: 'line', data: emData.close, symbol: 'circle', symbolSize: 4, lineStyle: { width: 2 }, itemStyle: { color: '#58a6ff' } });
  }

  let alignedIfClose = ifData.close;
  let xDates = hasEM ? emData.dates : ifData.dates;

  // 如果两边都有日期数据，按日期对齐 ifind
  if (hasEM && hasIF && ifData.dates.length && !ifData.dates[0].startsWith('row_')) {
    const ifMap = {};
    ifData.dates.forEach((d, i) => { ifMap[d] = ifData.close[i]; });
    alignedIfClose = emData.dates.map(d => ifMap[d] ?? null);
  }

  if (hasIF) {
    series.push({ name: 'ifind 收盘价', type: 'line', data: alignedIfClose, symbol: 'diamond', symbolSize: 4, lineStyle: { width: 2, type: 'dashed' }, itemStyle: { color: '#f0883e' } });
  }

  chart.setOption({
    ...darkTheme,
    title: { text: '收盘价叠加对比', left: 'center', ...darkTheme.title },
    tooltip: { trigger: 'axis', backgroundColor: '#1c2128', borderColor: '#30363d', textStyle: { color: '#c9d1d9' } },
    legend: { top: 28, ...darkTheme.legend },
    xAxis: { type: 'category', data: xDates, axisLabel: { color: '#8b949e' }, axisLine: { lineStyle: { color: '#30363d' } } },
    yAxis: { scale: true, axisLabel: { color: '#8b949e' }, splitLine: { lineStyle: { color: '#21262d' } }, axisLine: { lineStyle: { color: '#30363d' } } },
    grid: { left: 60, right: 20, top: 60, bottom: 30 },
    series,
    dataZoom: [{ type: 'inside', start: 0, end: 100 }],
  });
  window.addEventListener('resize', () => chart.resize());
}

// 成交量对比
{
  const chart = echarts.init(document.getElementById('volume-compare'));
  const series = [];
  const xDates = hasEM ? emData.dates : ifData.dates;

  if (hasEM) {
    series.push({ name: 'eastmoney', type: 'bar', data: emData.volume, itemStyle: { color: '#58a6ff88' }, barGap: '0%' });
  }

  let alignedIfVol = ifData.volume;
  if (hasEM && hasIF && ifData.dates.length && !ifData.dates[0].startsWith('row_')) {
    const ifMap = {};
    ifData.dates.forEach((d, i) => { ifMap[d] = ifData.volume[i]; });
    alignedIfVol = emData.dates.map(d => ifMap[d] ?? null);
  }

  if (hasIF) {
    series.push({ name: 'ifind', type: 'bar', data: alignedIfVol, itemStyle: { color: '#f0883e88' }, barGap: '0%' });
  }

  chart.setOption({
    ...darkTheme,
    title: { text: '成交量对比', left: 'center', ...darkTheme.title },
    tooltip: { trigger: 'axis', backgroundColor: '#1c2128', borderColor: '#30363d', textStyle: { color: '#c9d1d9' } },
    legend: { top: 28, ...darkTheme.legend },
    xAxis: { type: 'category', data: xDates, axisLabel: { color: '#8b949e' }, axisLine: { lineStyle: { color: '#30363d' } } },
    yAxis: { axisLabel: { color: '#8b949e', formatter: v => (v / 10000).toFixed(0) + '万' }, splitLine: { lineStyle: { color: '#21262d' } } },
    grid: { left: 80, right: 20, top: 60, bottom: 30 },
    series,
    dataZoom: [{ type: 'inside', start: 0, end: 100 }],
  });
  window.addEventListener('resize', () => chart.resize());
}

// 涨跌幅对比
{
  const chart = echarts.init(document.getElementById('change-compare'));
  const series = [];
  const xDates = hasEM ? emData.dates : ifData.dates;

  if (hasEM) {
    series.push({ name: 'eastmoney', type: 'line', data: emData.changeRatio, symbol: 'none', lineStyle: { width: 1.5 }, itemStyle: { color: '#58a6ff' }, areaStyle: { color: 'rgba(88,166,255,0.1)' } });
  }

  let alignedIfCR = ifData.changeRatio;
  if (hasEM && hasIF && ifData.dates.length && !ifData.dates[0].startsWith('row_')) {
    const ifMap = {};
    ifData.dates.forEach((d, i) => { ifMap[d] = ifData.changeRatio[i]; });
    alignedIfCR = emData.dates.map(d => ifMap[d] ?? null);
  }

  if (hasIF) {
    series.push({ name: 'ifind', type: 'line', data: alignedIfCR, symbol: 'none', lineStyle: { width: 1.5, type: 'dashed' }, itemStyle: { color: '#f0883e' }, areaStyle: { color: 'rgba(240,136,62,0.1)' } });
  }

  chart.setOption({
    ...darkTheme,
    title: { text: '涨跌幅(%)对比', left: 'center', ...darkTheme.title },
    tooltip: { trigger: 'axis', backgroundColor: '#1c2128', borderColor: '#30363d', textStyle: { color: '#c9d1d9' }, valueFormatter: v => v?.toFixed(2) + '%' },
    legend: { top: 28, ...darkTheme.legend },
    xAxis: { type: 'category', data: xDates, axisLabel: { color: '#8b949e' }, axisLine: { lineStyle: { color: '#30363d' } } },
    yAxis: { axisLabel: { color: '#8b949e', formatter: '{value}%' }, splitLine: { lineStyle: { color: '#21262d' } } },
    grid: { left: 60, right: 20, top: 60, bottom: 30 },
    series,
    dataZoom: [{ type: 'inside', start: 0, end: 100 }],
  });
  window.addEventListener('resize', () => chart.resize());
}

// 统计对比表格
if (hasEM || hasIF) {
  function calcStats(data) {
    if (!data.close?.length) return null;
    const close = data.close.filter(v => v != null);
    const vol = data.volume.filter(v => v != null);
    const cr = data.changeRatio.filter(v => v != null);
    const sum = arr => arr.reduce((a, b) => a + b, 0);
    const avg = arr => arr.length ? sum(arr) / arr.length : 0;
    return {
      count: close.length,
      closeMin: Math.min(...close).toFixed(2),
      closeMax: Math.max(...close).toFixed(2),
      closeAvg: avg(close).toFixed(2),
      closeFirst: close[0]?.toFixed(2),
      closeLast: close[close.length - 1]?.toFixed(2),
      volAvg: (avg(vol) / 10000).toFixed(0) + '万',
      volTotal: (sum(vol) / 100000000).toFixed(2) + '亿',
      crMax: Math.max(...cr).toFixed(2) + '%',
      crMin: Math.min(...cr).toFixed(2) + '%',
      crAvg: avg(cr).toFixed(2) + '%',
    };
  }

  const emStats = hasEM ? calcStats(emData) : null;
  const ifStats = hasIF ? calcStats(ifData) : null;

  const rows = [
    ['数据条数', 'count'],
    ['收盘价(首)', 'closeFirst'],
    ['收盘价(末)', 'closeLast'],
    ['收盘价(最低)', 'closeMin'],
    ['收盘价(最高)', 'closeMax'],
    ['收盘价(均值)', 'closeAvg'],
    ['日均成交量', 'volAvg'],
    ['累计成交量', 'volTotal'],
    ['涨跌幅(最大)', 'crMax'],
    ['涨跌幅(最小)', 'crMin'],
    ['涨跌幅(均值)', 'crAvg'],
  ];

  let tableHtml = '<h2 class="section-title">统计摘要对比</h2><div class="stats-grid"><div class="stats-card"><h3>数值对比</h3><table><tr><th>指标</th>' +
    (emStats ? '<th>eastmoney <span class="tag tag-em">EM</span></th>' : '') +
    (ifStats ? '<th>ifind <span class="tag tag-if">IF</span></th>' : '') +
    (emStats && ifStats ? '<th>差异</th>' : '') + '</tr>';

  for (const [label, key] of rows) {
    tableHtml += '<tr><td class="label">' + label + '</td>';
    if (emStats) tableHtml += '<td>' + (emStats[key] ?? '-') + '</td>';
    if (ifStats) tableHtml += '<td>' + (ifStats[key] ?? '-') + '</td>';
    if (emStats && ifStats) {
      const emV = parseFloat(emStats[key]);
      const ifV = parseFloat(ifStats[key]);
      if (!isNaN(emV) && !isNaN(ifV) && ifV !== 0) {
        const diffPct = ((emV - ifV) / Math.abs(ifV) * 100).toFixed(2);
        const cls = diffPct > 0 ? 'diff-pos' : diffPct < 0 ? 'diff-neg' : '';
        tableHtml += '<td class="' + cls + '">' + (diffPct > 0 ? '+' : '') + diffPct + '%</td>';
      } else {
        tableHtml += '<td>-</td>';
      }
    }
    tableHtml += '</tr>';
  }

  tableHtml += '</table></div></div>';
  document.getElementById('stats-section').innerHTML = tableHtml;
}
</script>
</body>
</html>`;

  return html;
}

// === 主流程 ===
async function main() {
  const opts = parseArgs(process.argv);

  if (!opts.codes) {
    console.log('用法: node compare.js --codes "000001.SZ" --start 2025-01-01 --end 2025-03-01 [--interval D] [--cps 2]');
    process.exit(1);
  }

  const codes = opts.codes;
  const start = opts.start || '2025-01-01';
  const end = opts.end || '2025-03-01';
  const interval = opts.interval || 'D';
  const cps = opts.cps || '2';
  const codeList = codes.split(',').map(c => c.trim());

  console.log(`\n对比查询: ${codes} | ${start} ~ ${end} | 周期=${interval} 复权=${cps}\n`);

  // 并行获取两个渠道的数据
  const [emResult, ifResult] = await Promise.all([
    fetchEastmoneyData(codes, start, end, interval, cps),
    fetchIfindData(codes, start, end, interval, cps),
  ]);

  // 为每只股票生成对比页面
  for (const code of codeList) {
    const emData = extractStockData(emResult, code);
    const ifData = extractStockData(ifResult, code);

    if (!emData && !ifData) {
      console.log(`[${code}] 两个渠道均无数据，跳过`);
      continue;
    }

    const html = generateHTML(code, emData, ifData, { start, end, interval, cps });
    const outDir = resolve(__dirname, 'output');
    mkdirSync(outDir, { recursive: true });
    const filename = `compare_${code.replace('.', '_')}_${interval}.html`;
    const filepath = resolve(outDir, filename);
    writeFileSync(filepath, html, 'utf-8');
    console.log(`\n[${code}] 对比页面已生成: ${filepath}`);
  }
}

main();
