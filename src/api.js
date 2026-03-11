import { HISTORY_INDICATORS, HIGHFREQ_INDICATORS, REALTIME_INDICATORS } from './config.js';

/**
 * 历史行情（日线/周线）
 */
export async function fetchHistory(client, { codes, startdate, enddate, interval = 'D', cps = '2' }) {
  const body = {
    codes,
    indicators: HISTORY_INDICATORS,
    startdate,
    enddate,
    functionpara: {
      Interval: interval,
      CPS: cps,
    },
  };

  return client.request('/cmd_history_quotation', body);
}

/**
 * 高频序列（小时线等）
 * 时间跨度 > 2年 自动分段请求（API 限制 3 年）
 */
export async function fetchHighFreq(client, { codes, starttime, endtime, interval = '60' }) {
  const segments = splitTimeRange(starttime, endtime, 2);

  if (segments.length === 1) {
    return doFetchHighFreq(client, { codes, starttime, endtime, interval });
  }

  // 多段请求，合并结果
  console.log(`[highfreq] 时间跨度较大，拆分为 ${segments.length} 段请求`);
  let merged = null;

  for (const [segStart, segEnd] of segments) {
    const result = await doFetchHighFreq(client, { codes, starttime: segStart, endtime: segEnd, interval });

    if (!merged) {
      merged = result;
    } else {
      // 合并 tables
      mergeTables(merged, result);
    }
  }

  return merged;
}

async function doFetchHighFreq(client, { codes, starttime, endtime, interval }) {
  const body = {
    codes,
    indicators: HIGHFREQ_INDICATORS,
    starttime,
    endtime,
    functionpara: {
      Interval: interval,
      Fill: 'Original',
    },
  };

  return client.request('/high_frequency', body);
}

/**
 * 实时行情快照
 */
export async function fetchRealtime(client, { codes }) {
  const body = {
    codes,
    indicators: REALTIME_INDICATORS,
  };

  return client.request('/real_time_quotation', body);
}

// === 工具函数 ===

/**
 * 按 yearSpan 年拆分时间段
 * 输入格式: "YYYY-MM-DD HH:mm:ss"
 */
function splitTimeRange(starttime, endtime, yearSpan) {
  const start = new Date(starttime);
  const end = new Date(endtime);

  const diffYears = (end - start) / (365.25 * 24 * 60 * 60 * 1000);
  if (diffYears <= yearSpan + 0.5) {
    return [[starttime, endtime]];
  }

  const segments = [];
  let current = new Date(start);

  while (current < end) {
    const segEnd = new Date(current);
    segEnd.setFullYear(segEnd.getFullYear() + yearSpan);
    if (segEnd > end) segEnd.setTime(end.getTime());

    const fmt = d => {
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
      return `${date} ${time}`;
    };

    segments.push([fmt(current), fmt(segEnd)]);

    // 下一段从 segEnd 后一秒开始
    current = new Date(segEnd.getTime() + 1000);
  }

  return segments;
}

/**
 * 合并两个 API 响应的 tables
 */
function mergeTables(target, source) {
  if (!source.tables) return;

  for (const srcTable of source.tables) {
    const tgtTable = target.tables.find(t => t.thscode === srcTable.thscode);
    if (tgtTable && tgtTable.table) {
      // 合并 time 和各指标数组
      for (const key of Object.keys(srcTable.table)) {
        if (Array.isArray(tgtTable.table[key]) && Array.isArray(srcTable.table[key])) {
          tgtTable.table[key] = tgtTable.table[key].concat(srcTable.table[key]);
        }
      }
    } else {
      target.tables.push(srcTable);
    }
  }
}
