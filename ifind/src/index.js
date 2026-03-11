import { REFRESH_TOKEN, OUTPUT_DIR } from './config.js';
import { IFindClient } from './client.js';
import { fetchHistory, fetchHighFreq, fetchRealtime } from './api.js';
import { flattenTables, exportCSV, exportJSON } from './export.js';
import { resolve } from 'node:path';

// === CLI 参数解析 ===
function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0];
  const opts = {};

  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true';
      opts[key] = val;
      if (val !== 'true') i++;
    }
  }

  return { command, opts };
}

function printUsage() {
  console.log(`
iFinD 股票数据批量查询工具

用法:
  node src/index.js <command> [options]

命令:
  history    历史行情（日线/周线）
  highfreq   高频序列（小时线）
  realtime   实时行情快照

通用选项:
  --codes    股票代码，逗号分隔 (必填)
             例: "300033.SZ,600030.SH,000001.SZ"

history 选项:
  --start    开始日期 (必填) 例: 2024-01-01
  --end      结束日期 (必填) 例: 2025-03-10
  --interval 周期 D=日线 W=周线 (默认: D)
  --cps      复权方式 1=不复权 2=前复权 3=后复权 (默认: 2)
  --format   导出格式 csv/json (默认: csv)
  --output   导出文件路径 (默认: output/目录)

highfreq 选项:
  --start    开始时间 (必填) 例: "2024-01-01 09:30:00"
  --end      结束时间 (必填) 例: "2025-03-10 15:00:00"
  --interval 分钟周期 1/3/5/10/15/30/60 (默认: 60)
  --format   导出格式 csv/json (默认: csv)
  --output   导出文件路径 (默认: output/目录)

realtime 选项:
  --format   导出格式 csv/json/table (默认: table)
  --output   导出文件路径 (可选)
`);
}

// === 格式化实时行情终端输出 ===
function printRealtimeTable(apiResponse) {
  if (!apiResponse.tables) {
    console.log('无数据');
    return;
  }

  for (const item of apiResponse.tables) {
    const code = item.thscode;
    const t = item.table || {};
    console.log(`\n=== ${code} ===`);

    const fields = [
      ['最新价', 'latest'],
      ['涨跌', 'change'],
      ['涨跌幅%', 'changeRatio'],
      ['开盘', 'open'],
      ['最高', 'high'],
      ['最低', 'low'],
      ['成交量', 'volume'],
      ['成交额', 'amount'],
      ['PE(TTM)', 'pe_ttm'],
      ['PB', 'pb'],
      ['总市值', 'totalCapital'],
      ['主力净流入', 'mainNetInflow'],
      ['散户净流入', 'retailNetInflow'],
      ['超大单净流入', 'largeNetInflow'],
      ['大单净流入', 'bigNetInflow'],
      ['中单净流入', 'middleNetInflow'],
      ['小单净流入', 'smallNetInflow'],
    ];

    for (const [label, key] of fields) {
      const val = t[key]?.[0] ?? '-';
      console.log(`  ${label.padEnd(12)} ${val}`);
    }
  }
}

// === 生成默认文件名 ===
function defaultFilename(command, format) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return resolve(OUTPUT_DIR, `${command}_${ts}.${format}`);
}

// === 主流程 ===
async function main() {
  const { command, opts } = parseArgs(process.argv);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }

  if (!opts.codes) {
    console.error('错误: --codes 参数必填');
    process.exit(1);
  }

  if (!REFRESH_TOKEN) {
    console.error('错误: REFRESH_TOKEN 未配置，请在 .env 文件中设置');
    process.exit(1);
  }

  const client = new IFindClient(REFRESH_TOKEN);

  try {
    switch (command) {
      case 'history': {
        if (!opts.start || !opts.end) {
          console.error('错误: history 命令需要 --start 和 --end 参数');
          process.exit(1);
        }

        if (opts.start > opts.end) {
          console.error('错误: 开始日期不能大于结束日期');
          process.exit(1);
        }

        const interval = opts.interval || 'D';
        const cps = opts.cps || '2';
        const format = opts.format || 'csv';

        console.log(`[history] 查询 ${opts.codes} | ${opts.start} ~ ${opts.end} | 周期=${interval} 复权=${cps}`);

        const result = await fetchHistory(client, {
          codes: opts.codes,
          startdate: opts.start,
          enddate: opts.end,
          interval,
          cps,
        });

        const rows = flattenTables(result);
        const filepath = opts.output || defaultFilename('history', format);

        if (format === 'json') {
          exportJSON(rows, filepath);
        } else {
          exportCSV(rows, filepath);
        }
        break;
      }

      case 'highfreq': {
        if (!opts.start || !opts.end) {
          console.error('错误: highfreq 命令需要 --start 和 --end 参数');
          process.exit(1);
        }

        if (opts.start > opts.end) {
          console.error('错误: 开始时间不能大于结束时间');
          process.exit(1);
        }

        const interval = opts.interval || '60';
        const format = opts.format || 'csv';

        console.log(`[highfreq] 查询 ${opts.codes} | ${opts.start} ~ ${opts.end} | 周期=${interval}分钟`);

        const result = await fetchHighFreq(client, {
          codes: opts.codes,
          starttime: opts.start,
          endtime: opts.end,
          interval,
        });

        const rows = flattenTables(result);
        const filepath = opts.output || defaultFilename('highfreq', format);

        if (format === 'json') {
          exportJSON(rows, filepath);
        } else {
          exportCSV(rows, filepath);
        }
        break;
      }

      case 'realtime': {
        const format = opts.format || 'table';

        console.log(`[realtime] 查询 ${opts.codes}`);

        const result = await fetchRealtime(client, {
          codes: opts.codes,
        });

        if (format === 'table') {
          printRealtimeTable(result);
        } else {
          const rows = flattenTables(result);
          const filepath = opts.output || defaultFilename('realtime', format);
          if (format === 'json') {
            exportJSON(rows, filepath);
          } else {
            exportCSV(rows, filepath);
          }
        }
        break;
      }

      default:
        console.error(`未知命令: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (err) {
    console.error(`错误: ${err.message}`);
    process.exit(1);
  }
}

main();
