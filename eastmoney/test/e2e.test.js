import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const CLI = ['node', ['src/index.js']];
const CWD = new URL('..', import.meta.url).pathname;

// 辅助：运行 CLI 命令
async function run(...args) {
  const { stdout, stderr } = await exec('node', ['src/index.js', ...args], {
    cwd: CWD,
    timeout: 30000,
  });
  return { stdout, stderr };
}

// 辅助：运行 CLI 命令（允许失败）
async function runMayFail(...args) {
  try {
    return await run(...args);
  } catch (e) {
    return { stdout: e.stdout || '', stderr: e.stderr || '', code: e.code };
  }
}

// === API 直接调用测试 ===
import { EastMoneyClient } from '../src/client.js';
import { fetchHistory, fetchHighFreq, fetchRealtime } from '../src/api.js';

describe('E2E: API 直接调用', () => {
  const client = new EastMoneyClient();

  describe('fetchHistory - 日线', () => {
    it('单只股票返回正确结构', async () => {
      const result = await fetchHistory(client, {
        codes: '000001.SZ',
        startdate: '2025-01-01',
        enddate: '2025-01-31',
        interval: 'D',
        cps: '2',
      });

      assert.ok(result.tables, '应包含 tables');
      assert.equal(result.tables.length, 1);
      assert.equal(result.tables[0].thscode, '000001.SZ');

      const table = result.tables[0].table;
      assert.ok(table.date?.length > 0, '应有日期数据');
      assert.ok(table.open?.length > 0, '应有开盘价');
      assert.ok(table.close?.length > 0, '应有收盘价');
      assert.ok(table.high?.length > 0, '应有最高价');
      assert.ok(table.low?.length > 0, '应有最低价');
      assert.ok(table.volume?.length > 0, '应有成交量');
      assert.ok(table.amount?.length > 0, '应有成交额');

      // 列长度一致
      const len = table.date.length;
      assert.equal(table.open.length, len);
      assert.equal(table.close.length, len);
      assert.equal(table.volume.length, len);
    });

    it('日期范围正确', async () => {
      const result = await fetchHistory(client, {
        codes: '000001.SZ',
        startdate: '2025-02-01',
        enddate: '2025-02-28',
        interval: 'D',
        cps: '1',
      });

      const dates = result.tables[0].table.date;
      assert.ok(dates[0] >= '2025-02-01', `首日 ${dates[0]} 应 >= 2025-02-01`);
      assert.ok(dates[dates.length - 1] <= '2025-02-28', `末日应 <= 2025-02-28`);
    });

    it('多只股票各自返回', async () => {
      const result = await fetchHistory(client, {
        codes: '000001.SZ,600030.SH',
        startdate: '2025-01-01',
        enddate: '2025-01-15',
        interval: 'D',
        cps: '2',
      });

      assert.equal(result.tables.length, 2);
      assert.equal(result.tables[0].thscode, '000001.SZ');
      assert.equal(result.tables[1].thscode, '600030.SH');
    });

    it('周线数据条数少于日线', async () => {
      const daily = await fetchHistory(client, {
        codes: '000001.SZ',
        startdate: '2025-01-01',
        enddate: '2025-03-01',
        interval: 'D',
        cps: '2',
      });
      const weekly = await fetchHistory(client, {
        codes: '000001.SZ',
        startdate: '2025-01-01',
        enddate: '2025-03-01',
        interval: 'W',
        cps: '2',
      });

      const dailyLen = daily.tables[0].table.date.length;
      const weeklyLen = weekly.tables[0].table.date.length;
      assert.ok(weeklyLen < dailyLen, `周线 ${weeklyLen} 条应少于日线 ${dailyLen} 条`);
    });
  });

  describe('fetchHighFreq - 小时线', () => {
    // 用近期日期确保有数据
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const starttime = `${fmt(weekAgo)} 09:30:00`;
    const endtime = `${fmt(today)} 15:00:00`;

    it('60分钟线返回正确结构', async () => {
      const result = await fetchHighFreq(client, {
        codes: '000001.SZ',
        starttime,
        endtime,
        interval: '60',
      });

      assert.ok(result.tables, '应包含 tables');
      assert.equal(result.tables.length, 1);
      assert.equal(result.tables[0].thscode, '000001.SZ');

      const table = result.tables[0].table;
      assert.ok(table.date?.length > 0, '应有日期数据');
      assert.ok(table.close?.length > 0, '应有收盘价');

      // 小时线日期格式包含时间
      assert.match(table.date[0], /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/, '日期应包含时分');
    });

    it('每个交易日应有 4 根 K 线（60分钟）', async () => {
      const result = await fetchHighFreq(client, {
        codes: '000001.SZ',
        starttime,
        endtime,
        interval: '60',
      });

      const dates = result.tables[0].table.date;
      // 统计有多少个不同交易日
      const tradingDays = new Set(dates.map(d => d.split(' ')[0]));
      const avgPerDay = dates.length / tradingDays.size;
      assert.ok(avgPerDay >= 3.5 && avgPerDay <= 4.5, `每日均 ${avgPerDay.toFixed(1)} 根应约等于 4`);
    });
  });

  describe('fetchRealtime - 实时行情', () => {
    it('单只股票返回行情和资金流向', async () => {
      const result = await fetchRealtime(client, { codes: '000001.SZ' });

      assert.ok(result.tables);
      assert.equal(result.tables.length, 1);
      assert.equal(result.tables[0].thscode, '000001.SZ');

      const table = result.tables[0].table;
      // 行情字段
      assert.ok('latest' in table, '应有最新价');
      assert.ok('changeRatio' in table, '应有涨跌幅');
      assert.ok('volume' in table, '应有成交量');
      assert.ok('amount' in table, '应有成交额');
      // 资金流向字段
      assert.ok('mainNetInflow' in table, '应有主力净流入');
    });

    it('多只股票批量返回', async () => {
      const result = await fetchRealtime(client, { codes: '000001.SZ,600030.SH' });

      assert.equal(result.tables.length, 2);
      const codes = result.tables.map(t => t.thscode);
      assert.ok(codes.includes('000001.SZ'));
      assert.ok(codes.includes('600030.SH'));
    });

    it('latest 是合理的数值', async () => {
      const result = await fetchRealtime(client, { codes: '000001.SZ' });
      const latest = result.tables[0].table.latest[0];
      assert.equal(typeof latest, 'number');
      assert.ok(latest > 0 && latest < 1000, `最新价 ${latest} 应在合理范围`);
    });
  });

  describe('错误处理', () => {
    it('无效代码返回 API 错误', async () => {
      await assert.rejects(
        () => fetchRealtime(client, { codes: 'XXXXX.SZ' }),
        /API 错误/,
      );
    });
  });
});

// === CLI 端到端测试 ===
describe('E2E: CLI 命令', () => {
  it('无参数显示帮助', async () => {
    const { stdout } = await run('help');
    assert.match(stdout, /东方财富/);
    assert.match(stdout, /history/);
    assert.match(stdout, /highfreq/);
    assert.match(stdout, /realtime/);
  });

  it('缺少 --codes 报错', async () => {
    const { stderr } = await runMayFail('history', '--start', '2025-01-01', '--end', '2025-01-31');
    assert.match(stderr, /--codes/);
  });

  it('history 缺少日期参数报错', async () => {
    const { stderr } = await runMayFail('history', '--codes', '000001.SZ');
    assert.match(stderr, /--start.*--end/);
  });

  it('未知命令报错', async () => {
    const { stderr } = await runMayFail('foobar', '--codes', '000001.SZ');
    assert.match(stderr, /未知命令/);
  });

  it('realtime --format json 输出 JSON 文件', async () => {
    const outFile = `/tmp/eastmoney_test_realtime_${Date.now()}.json`;
    const { stdout } = await run('realtime', '--codes', '000001.SZ', '--format', 'json', '--output', outFile);
    assert.match(stdout, /JSON 已导出/);

    const { readFileSync, unlinkSync } = await import('node:fs');
    const content = JSON.parse(readFileSync(outFile, 'utf-8'));
    assert.ok(Array.isArray(content));
    assert.ok(content.length > 0);
    assert.equal(content[0].code, '000001.SZ');
    unlinkSync(outFile);
  });

  it('history --format csv 输出 CSV 文件', async () => {
    const outFile = `/tmp/eastmoney_test_history_${Date.now()}.csv`;
    const { stdout } = await run('history', '--codes', '000001.SZ', '--start', '2025-01-01', '--end', '2025-01-15', '--format', 'csv', '--output', outFile);
    assert.match(stdout, /CSV 已导出/);

    const { readFileSync, unlinkSync } = await import('node:fs');
    const lines = readFileSync(outFile, 'utf-8').trim().split('\n');
    assert.ok(lines.length > 1, '应有表头 + 数据行');
    assert.match(lines[0], /code/, '表头应包含 code');
    assert.match(lines[0], /close/, '表头应包含 close');
    unlinkSync(outFile);
  });

  it('realtime --format table 输出到终端', async () => {
    const { stdout } = await run('realtime', '--codes', '000001.SZ', '--format', 'table');
    assert.match(stdout, /000001\.SZ/);
    assert.match(stdout, /最新价/);
  });
});
