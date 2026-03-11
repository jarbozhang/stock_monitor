import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// === codec.js ===
import { toEastMoneyCode, toIFindCode, convertCodes } from '../src/codec.js';

describe('codec', () => {
  describe('toEastMoneyCode', () => {
    it('深市 SZ → 前缀 0', () => {
      assert.equal(toEastMoneyCode('000001.SZ'), '0.000001');
      assert.equal(toEastMoneyCode('300033.SZ'), '0.300033');
    });

    it('沪市 SH → 前缀 1', () => {
      assert.equal(toEastMoneyCode('600030.SH'), '1.600030');
      assert.equal(toEastMoneyCode('601318.SH'), '1.601318');
    });

    it('北交所 BJ → 前缀 0', () => {
      assert.equal(toEastMoneyCode('430047.BJ'), '0.430047');
    });

    it('未知市场抛出异常', () => {
      assert.throws(() => toEastMoneyCode('000001.HK'), /未知市场后缀/);
    });
  });

  describe('toIFindCode', () => {
    it('前缀 0 → SZ', () => {
      assert.equal(toIFindCode('0.000001'), '000001.SZ');
    });

    it('前缀 1 → SH', () => {
      assert.equal(toIFindCode('1.600030'), '600030.SH');
    });
  });

  describe('convertCodes', () => {
    it('批量转换逗号分隔字符串', () => {
      const result = convertCodes('000001.SZ,600030.SH');
      assert.deepEqual(result, ['0.000001', '1.600030']);
    });

    it('处理含空格的输入', () => {
      const result = convertCodes('000001.SZ, 600030.SH');
      assert.deepEqual(result, ['0.000001', '1.600030']);
    });

    it('单只股票', () => {
      const result = convertCodes('000001.SZ');
      assert.deepEqual(result, ['0.000001']);
    });
  });
});

// === config.js ===
import {
  KLINE_URL, QUOTE_URL, FFLOW_URL,
  KLINE_COLUMNS, QUOTE_FIELDS, INTERVAL_MAP, FQT_MAP,
  RATE_LIMIT, RATE_WINDOW_MS,
} from '../src/config.js';

describe('config', () => {
  it('API URL 格式正确', () => {
    assert.match(KLINE_URL, /^https:\/\/push2his\.eastmoney\.com/);
    assert.match(QUOTE_URL, /^https:\/\/push2\.eastmoney\.com/);
    assert.match(FFLOW_URL, /^https:\/\/push2\.eastmoney\.com/);
  });

  it('KLINE_COLUMNS 包含 11 个字段且首列为 date', () => {
    assert.equal(KLINE_COLUMNS.length, 11);
    assert.equal(KLINE_COLUMNS[0], 'date');
    assert.ok(KLINE_COLUMNS.includes('open'));
    assert.ok(KLINE_COLUMNS.includes('close'));
    assert.ok(KLINE_COLUMNS.includes('volume'));
  });

  it('QUOTE_FIELDS 包含关键字段映射', () => {
    assert.equal(QUOTE_FIELDS.f2, 'latest');
    assert.equal(QUOTE_FIELDS.f3, 'changeRatio');
    assert.equal(QUOTE_FIELDS.f12, 'code');
    assert.equal(QUOTE_FIELDS.f13, 'market');
  });

  it('INTERVAL_MAP 覆盖日/周/分钟', () => {
    assert.equal(INTERVAL_MAP['D'], 101);
    assert.equal(INTERVAL_MAP['W'], 102);
    assert.equal(INTERVAL_MAP['60'], 60);
    assert.equal(INTERVAL_MAP['5'], 5);
  });

  it('FQT_MAP 复权映射正确', () => {
    assert.equal(FQT_MAP['1'], 0); // 不复权
    assert.equal(FQT_MAP['2'], 1); // 前复权
    assert.equal(FQT_MAP['3'], 2); // 后复权
  });

  it('限流参数合理', () => {
    assert.equal(RATE_LIMIT, 100);
    assert.equal(RATE_WINDOW_MS, 60000);
  });
});

// === export.js ===
import { flattenTables } from '../src/export.js';

describe('export - flattenTables', () => {
  it('正常 tables 结构展平为行数组', () => {
    const apiResponse = {
      tables: [{
        thscode: '000001.SZ',
        table: {
          date: ['2025-01-01', '2025-01-02'],
          close: [10.5, 10.8],
          volume: [1000, 2000],
        },
      }],
    };

    const rows = flattenTables(apiResponse);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].code, '000001.SZ');
    assert.equal(rows[0].date, '2025-01-01');
    assert.equal(rows[0].close, 10.5);
    assert.equal(rows[1].date, '2025-01-02');
    assert.equal(rows[1].volume, 2000);
  });

  it('多只股票展平', () => {
    const apiResponse = {
      tables: [
        { thscode: '000001.SZ', table: { close: [10] } },
        { thscode: '600030.SH', table: { close: [20] } },
      ],
    };

    const rows = flattenTables(apiResponse);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].code, '000001.SZ');
    assert.equal(rows[1].code, '600030.SH');
  });

  it('空 tables 返回空数组', () => {
    assert.deepEqual(flattenTables({}), []);
    assert.deepEqual(flattenTables({ tables: [] }), []);
  });

  it('table 为 null 跳过', () => {
    const apiResponse = {
      tables: [{ thscode: '000001.SZ', table: null }],
    };
    assert.deepEqual(flattenTables(apiResponse), []);
  });
});

// === client.js - throttle 逻辑 ===
import { EastMoneyClient } from '../src/client.js';

describe('EastMoneyClient', () => {
  it('构造无参数', () => {
    const client = new EastMoneyClient();
    assert.ok(client);
    assert.deepEqual(client.timestamps, []);
  });

  it('throttle 不超限时立即通过', async () => {
    const client = new EastMoneyClient();
    const start = Date.now();
    await client.throttle();
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 50, `throttle 应立即通过，实际耗时 ${elapsed}ms`);
    assert.equal(client.timestamps.length, 1);
  });

  it('连续多次 throttle 正常记录', async () => {
    const client = new EastMoneyClient();
    for (let i = 0; i < 5; i++) {
      await client.throttle();
    }
    assert.equal(client.timestamps.length, 5);
  });
});
