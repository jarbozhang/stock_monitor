import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const CWD = new URL('..', import.meta.url).pathname;

async function run(...args) {
  const { stdout, stderr } = await exec('node', ['src/index.js', ...args], {
    cwd: CWD,
    timeout: 60000,
  });
  return { stdout, stderr };
}

async function runMayFail(...args) {
  try {
    return await run(...args);
  } catch (e) {
    return { stdout: e.stdout || '', stderr: e.stderr || '', code: e.code };
  }
}

// === API 直接调用测试 ===
import { REFRESH_TOKEN } from '../src/config.js';
import { IFindClient } from '../src/client.js';
import { fetchHistory, fetchHighFreq, fetchRealtime } from '../src/api.js';

const client = new IFindClient(REFRESH_TOKEN);

describe('E2E: API 直接调用', () => {
  describe('fetchHistory - 日线', () => {
    it('单只股票返回正确 tables 结构', async () => {
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
      assert.ok(table.open?.length > 0, '应有开盘价');
      assert.ok(table.close?.length > 0, '应有收盘价');
      assert.ok(table.high?.length > 0, '应有最高价');
      assert.ok(table.low?.length > 0, '应有最低价');
      assert.ok(table.volume?.length > 0, '应有成交量');
      assert.ok(table.amount?.length > 0, '应有成交额');

      // 所有列长度一致
      const len = table.open.length;
      assert.equal(table.close.length, len);
      assert.equal(table.high.length, len);
      assert.equal(table.volume.length, len);
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
      const codes = result.tables.map(t => t.thscode);
      assert.ok(codes.includes('000001.SZ'));
      assert.ok(codes.includes('600030.SH'));
    });

    it('周线条数少于日线', async () => {
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

      const dailyLen = daily.tables[0].table.open.length;
      const weeklyLen = weekly.tables[0].table.open.length;
      assert.ok(weeklyLen < dailyLen, `周线 ${weeklyLen} 条应少于日线 ${dailyLen} 条`);
    });
  });

  describe('fetchHighFreq - 小时线', () => {
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
      assert.ok(table.open?.length > 0, '应有开盘价');
      assert.ok(table.close?.length > 0, '应有收盘价');

      // ifind highfreq 不返回 time 列，验证数据条数合理即可
      const len = table.open.length;
      assert.ok(len > 0 && len <= 40, `数据条数 ${len} 应在合理范围`);
      assert.equal(table.close.length, len, '列长度应一致');
      assert.equal(table.volume.length, len, '列长度应一致');
    });

    it('数据条数与交易日匹配（约每日 4 根）', async () => {
      const result = await fetchHighFreq(client, {
        codes: '000001.SZ',
        starttime,
        endtime,
        interval: '60',
      });

      const len = result.tables[0].table.open.length;
      // 一周约 5 个交易日，每日 4 根 = ~20 根
      assert.ok(len >= 8 && len <= 32, `数据条数 ${len} 应在 8~32 之间（一周小时线）`);
    });
  });

  describe('fetchRealtime - 实时行情', () => {
    it('返回基础行情字段', async () => {
      const result = await fetchRealtime(client, { codes: '000001.SZ' });

      assert.ok(result.tables);
      assert.equal(result.tables.length, 1);
      assert.equal(result.tables[0].thscode, '000001.SZ');

      const table = result.tables[0].table;
      assert.ok('latest' in table, '应有最新价');
      assert.ok('changeRatio' in table, '应有涨跌幅');
      assert.ok('volume' in table, '应有成交量');
      assert.ok('amount' in table, '应有成交额');
    });

    it('多只股票批量返回', async () => {
      const result = await fetchRealtime(client, { codes: '000001.SZ,600030.SH' });

      assert.equal(result.tables.length, 2);
      const codes = result.tables.map(t => t.thscode);
      assert.ok(codes.includes('000001.SZ'));
      assert.ok(codes.includes('600030.SH'));
    });

    it('latest 是合理数值', async () => {
      const result = await fetchRealtime(client, { codes: '000001.SZ' });
      const latest = result.tables[0].table.latest[0];
      assert.equal(typeof latest, 'number');
      assert.ok(latest > 0 && latest < 1000, `最新价 ${latest} 应在合理范围`);
    });
  });
});

// === CLI 命令测试 ===
describe('E2E: CLI 命令', () => {
  it('无参数显示帮助', async () => {
    const { stdout } = await run('help');
    assert.match(stdout, /iFinD/);
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
    const outFile = `/tmp/ifind_test_realtime_${Date.now()}.json`;
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
    const outFile = `/tmp/ifind_test_history_${Date.now()}.csv`;
    const { stdout } = await run('history', '--codes', '000001.SZ', '--start', '2025-01-01', '--end', '2025-01-15', '--format', 'csv', '--output', outFile);
    assert.match(stdout, /CSV 已导出/);

    const { readFileSync, unlinkSync } = await import('node:fs');
    const lines = readFileSync(outFile, 'utf-8').trim().split('\n');
    assert.ok(lines.length > 1, '应有表头 + 数据行');
    assert.match(lines[0], /code/);
    assert.match(lines[0], /close/);
    unlinkSync(outFile);
  });

  it('realtime --format table 输出到终端', async () => {
    const { stdout } = await run('realtime', '--codes', '000001.SZ', '--format', 'table');
    assert.match(stdout, /000001\.SZ/);
    assert.match(stdout, /最新价/);
  });
});

// === 跨渠道数据一致性测试 ===
describe('E2E: 与 eastmoney 数据一致性', () => {
  it('日线收盘价一致（前复权，误差 < 0.5%）', async () => {
    const ifResult = await fetchHistory(client, {
      codes: '000001.SZ',
      startdate: '2025-02-01',
      enddate: '2025-02-28',
      interval: 'D',
      cps: '2',
    });

    const { EastMoneyClient } = await import('../../eastmoney/src/client.js');
    const emApi = await import('../../eastmoney/src/api.js');
    const emClient = new EastMoneyClient();
    const emResult = await emApi.fetchHistory(emClient, {
      codes: '000001.SZ',
      startdate: '2025-02-01',
      enddate: '2025-02-28',
      interval: 'D',
      cps: '2',
    });

    const ifClose = ifResult.tables[0].table.close;
    const emClose = emResult.tables[0].table.close;

    assert.equal(ifClose.length, emClose.length, `条数应一致: ifind=${ifClose.length} em=${emClose.length}`);

    for (let i = 0; i < ifClose.length; i++) {
      const diff = Math.abs(ifClose[i] - emClose[i]) / emClose[i];
      assert.ok(diff < 0.005, `第${i}条收盘价差异 ${(diff * 100).toFixed(3)}%: ifind=${ifClose[i]} em=${emClose[i]}`);
    }
  });

  it('成交额一致（误差 < 0.1%）', async () => {
    const ifResult = await fetchHistory(client, {
      codes: '000001.SZ',
      startdate: '2025-02-01',
      enddate: '2025-02-28',
      interval: 'D',
      cps: '2',
    });

    const { EastMoneyClient } = await import('../../eastmoney/src/client.js');
    const emApi = await import('../../eastmoney/src/api.js');
    const emClient = new EastMoneyClient();
    const emResult = await emApi.fetchHistory(emClient, {
      codes: '000001.SZ',
      startdate: '2025-02-01',
      enddate: '2025-02-28',
      interval: 'D',
      cps: '2',
    });

    const ifAmount = ifResult.tables[0].table.amount;
    const emAmount = emResult.tables[0].table.amount;

    assert.equal(ifAmount.length, emAmount.length);

    for (let i = 0; i < ifAmount.length; i++) {
      const diff = Math.abs(ifAmount[i] - emAmount[i]) / emAmount[i];
      assert.ok(diff < 0.001, `第${i}条成交额差异 ${(diff * 100).toFixed(4)}%: ifind=${ifAmount[i]} em=${emAmount[i]}`);
    }
  });
});
