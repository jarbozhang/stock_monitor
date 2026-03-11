import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// === config.js ===
import {
  REFRESH_TOKEN, BASE_URL, TOKEN_CACHE_PATH, OUTPUT_DIR,
  TOKEN_EXPIRY_MS, RATE_LIMIT, RATE_WINDOW_MS,
  HISTORY_INDICATORS, HIGHFREQ_INDICATORS, REALTIME_INDICATORS,
} from '../src/config.js';

describe('config', () => {
  it('REFRESH_TOKEN 已配置', () => {
    assert.ok(REFRESH_TOKEN, 'REFRESH_TOKEN 应已通过 .env 配置');
  });

  it('BASE_URL 指向 51ifind', () => {
    assert.match(BASE_URL, /^https:\/\/quantapi\.51ifind\.com/);
  });

  it('TOKEN_CACHE_PATH 指向 token.json', () => {
    assert.match(TOKEN_CACHE_PATH, /token\.json$/);
  });

  it('TOKEN_EXPIRY_MS 为 6 天', () => {
    assert.equal(TOKEN_EXPIRY_MS, 6 * 24 * 60 * 60 * 1000);
  });

  it('限流 580 次/分钟', () => {
    assert.equal(RATE_LIMIT, 580);
    assert.equal(RATE_WINDOW_MS, 60000);
  });

  it('HISTORY_INDICATORS 包含关键字段', () => {
    assert.match(HISTORY_INDICATORS, /open/);
    assert.match(HISTORY_INDICATORS, /close/);
    assert.match(HISTORY_INDICATORS, /volume/);
    assert.match(HISTORY_INDICATORS, /changeRatio/);
  });

  it('HIGHFREQ_INDICATORS 包含关键字段', () => {
    assert.match(HIGHFREQ_INDICATORS, /open/);
    assert.match(HIGHFREQ_INDICATORS, /close/);
    assert.match(HIGHFREQ_INDICATORS, /volume/);
  });

  it('REALTIME_INDICATORS 包含行情和资金流向字段', () => {
    assert.match(REALTIME_INDICATORS, /latest/);
    assert.match(REALTIME_INDICATORS, /mainNetInflow/);
    assert.match(REALTIME_INDICATORS, /retailNetInflow/);
  });
});

// === export.js ===
import { flattenTables } from '../src/export.js';

describe('export - flattenTables', () => {
  it('正常 tables 展平', () => {
    const apiResponse = {
      tables: [{
        thscode: '000001.SZ',
        table: {
          time: ['2025-01-01', '2025-01-02'],
          close: [10.5, 10.8],
          volume: [1000, 2000],
        },
      }],
    };

    const rows = flattenTables(apiResponse);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].code, '000001.SZ');
    assert.equal(rows[0].time, '2025-01-01');
    assert.equal(rows[0].close, 10.5);
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

  it('空或无 tables 返回空数组', () => {
    assert.deepEqual(flattenTables({}), []);
    assert.deepEqual(flattenTables({ tables: [] }), []);
  });

  it('table 为 null 跳过', () => {
    assert.deepEqual(flattenTables({ tables: [{ thscode: 'X', table: null }] }), []);
  });
});

// === client.js ===
import { IFindClient } from '../src/client.js';

describe('IFindClient', () => {
  it('构造需要 refreshToken', () => {
    const client = new IFindClient('test_token');
    assert.equal(client.refreshToken, 'test_token');
    assert.equal(client.accessToken, null);
    assert.deepEqual(client.timestamps, []);
  });

  it('throttle 不超限时立即通过', async () => {
    const client = new IFindClient('test');
    const start = Date.now();
    await client.throttle();
    assert.ok(Date.now() - start < 50);
    assert.equal(client.timestamps.length, 1);
  });

  it('连续 throttle 正常记录', async () => {
    const client = new IFindClient('test');
    for (let i = 0; i < 10; i++) {
      await client.throttle();
    }
    assert.equal(client.timestamps.length, 10);
  });
});
