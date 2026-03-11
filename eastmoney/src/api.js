import { KLINE_URL, QUOTE_URL, FFLOW_URL, KLINE_COLUMNS, QUOTE_FIELDS, INTERVAL_MAP, FQT_MAP } from './config.js';
import { toEastMoneyCode, toIFindCode, convertCodes } from './codec.js';

/**
 * 解析 K 线字符串数组为列式结构
 * klines: ["2025-01-02,10.5,10.8,11.0,10.3,100000,1050000,6.7,2.86,0.3,1.5", ...]
 */
function parseKlines(klines) {
  const table = {};
  for (const col of KLINE_COLUMNS) {
    table[col] = [];
  }

  for (const line of klines) {
    const parts = line.split(',');
    for (let i = 0; i < KLINE_COLUMNS.length; i++) {
      const col = KLINE_COLUMNS[i];
      const val = parts[i] ?? '';
      // date 保持字符串，数值列转数字
      table[col].push(col === 'date' ? val : (val === '' ? null : Number(val)));
    }
  }

  return table;
}

/**
 * 历史行情（日线/周线）—— 逐只请求
 */
export async function fetchHistory(client, { codes, startdate, enddate, interval = 'D', cps = '2' }) {
  const codeList = codes.split(',').map(c => c.trim());
  const klt = INTERVAL_MAP[interval] || 101;
  const fqt = FQT_MAP[cps] ?? 1;

  const tables = [];

  for (const code of codeList) {
    const secid = toEastMoneyCode(code);
    console.log(`[history] 请求 ${code} (${secid}) ...`);

    const data = await client.request(KLINE_URL, {
      secid,
      fields1: 'f1,f2,f3,f4,f5,f6',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
      klt,
      fqt,
      beg: startdate.replace(/-/g, ''),
      end: enddate.replace(/-/g, ''),
      lmt: 10000,
      ut: 'fa5fd1943c7b386f172d6893dbbd4dc0',
    });

    const klines = data?.data?.klines || [];
    if (klines.length === 0) {
      console.log(`[history] ${code} 无数据`);
      continue;
    }

    const table = parseKlines(klines);
    tables.push({ thscode: code, table });
    console.log(`[history] ${code} 获取 ${klines.length} 条`);
  }

  return { tables };
}

/**
 * 高频序列（小时线等）—— 同一 K 线接口，klt 不同
 */
export async function fetchHighFreq(client, { codes, starttime, endtime, interval = '60' }) {
  const codeList = codes.split(',').map(c => c.trim());
  const klt = INTERVAL_MAP[interval] || 60;

  // 从 datetime 中提取日期部分
  const beg = starttime.split(' ')[0].replace(/-/g, '');
  const end = endtime.split(' ')[0].replace(/-/g, '');

  const tables = [];

  for (const code of codeList) {
    const secid = toEastMoneyCode(code);
    console.log(`[highfreq] 请求 ${code} (${secid}) ...`);

    const data = await client.request(KLINE_URL, {
      secid,
      fields1: 'f1,f2,f3,f4,f5,f6',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
      klt,
      fqt: 1,
      beg,
      end,
      lmt: 10000,
      ut: 'fa5fd1943c7b386f172d6893dbbd4dc0',
    });

    const klines = data?.data?.klines || [];
    if (klines.length === 0) {
      console.log(`[highfreq] ${code} 无数据`);
      continue;
    }

    // 过滤时间范围
    const filtered = klines.filter(line => {
      const dt = line.split(',')[0];
      return dt >= starttime && dt <= endtime;
    });

    const table = parseKlines(filtered);
    tables.push({ thscode: code, table });
    console.log(`[highfreq] ${code} 获取 ${filtered.length} 条`);
  }

  return { tables };
}

/**
 * 实时行情快照 —— 批量行情 + 逐只资金流向
 */
export async function fetchRealtime(client, { codes }) {
  const codeList = codes.split(',').map(c => c.trim());
  const secids = codeList.map(c => toEastMoneyCode(c));

  // 批量行情
  const fields = Object.keys(QUOTE_FIELDS).join(',');
  const quoteData = await client.request(QUOTE_URL, {
    fltt: 2,
    fields: fields,
    secids: secids.join(','),
    ut: 'fa5fd1943c7b386f172d6893dbbd4dc0',
  });

  // 构建行情 map: ifindCode → field values
  const quoteMap = {};
  const diffList = quoteData?.data?.diff || [];
  for (const item of diffList) {
    // f13 是市场代码(0=SZ,1=SH)，f12 是股票代码
    const market = String(item.f13);
    const ifindCode = toIFindCode(`${market}.${item.f12}`);
    const mapped = {};
    for (const [fKey, name] of Object.entries(QUOTE_FIELDS)) {
      mapped[name] = item[fKey] ?? null;
    }
    quoteMap[ifindCode] = mapped;
  }

  // 逐只资金流向
  const tables = [];
  for (const code of codeList) {
    const secid = toEastMoneyCode(code);
    const quote = quoteMap[code] || {};

    // 请求今日资金流向
    let fflow = {};
    try {
      const fflowData = await client.request(FFLOW_URL, {
        secid,
        fields1: 'f1,f2,f3,f7',
        fields2: 'f51,f52,f53,f54,f55,f56',
        klt: 1,
        lmt: 0,
        ut: 'fa5fd1943c7b386f172d6893dbbd4dc0',
      });

      const klines = fflowData?.data?.klines || [];
      if (klines.length > 0) {
        // 取最后一条（最新）
        const last = klines[klines.length - 1].split(',');
        // f52=主力, f53=小单, f54=中单, f55=大单, f56=超大单
        fflow = {
          mainNetInflow: Number(last[1]) || 0,
          smallNetInflow: Number(last[2]) || 0,
          middleNetInflow: Number(last[3]) || 0,
          bigNetInflow: Number(last[4]) || 0,
          largeNetInflow: Number(last[5]) || 0,
          retailNetInflow: (Number(last[2]) || 0) + (Number(last[3]) || 0),
        };
      }
    } catch (e) {
      console.log(`[realtime] ${code} 资金流向获取失败: ${e.message}`);
    }

    // 组装为 ifind 兼容的 table 结构（单行列式）
    const table = {};
    for (const [key, val] of Object.entries(quote)) {
      if (key === 'code' || key === 'name' || key === 'market') continue;
      table[key] = [val];
    }
    for (const [key, val] of Object.entries(fflow)) {
      table[key] = [val];
    }

    tables.push({ thscode: code, table });
  }

  return { tables };
}
