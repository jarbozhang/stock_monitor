import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

export const OUTPUT_DIR = resolve(ROOT, 'output');
export const ROOT_DIR = ROOT;

// API 端点
export const KLINE_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
export const QUOTE_URL = 'https://push2.eastmoney.com/api/qt/ulist.np/get';
export const FFLOW_URL = 'https://push2.eastmoney.com/api/qt/stock/fflow/kline/get';

// 限流：100次/分钟
export const RATE_LIMIT = 100;
export const RATE_WINDOW_MS = 60 * 1000;

// K线返回列名（逗号分隔字符串的列序）
export const KLINE_COLUMNS = [
  'date', 'open', 'close', 'high', 'low',
  'volume', 'amount', 'amplitude', 'changeRatio', 'change', 'turnoverRatio',
];

// 实时行情字段码映射
export const QUOTE_FIELDS = {
  f2: 'latest',
  f3: 'changeRatio',
  f4: 'change',
  f5: 'volume',
  f6: 'amount',
  f7: 'amplitude',
  f8: 'turnoverRatio',
  f9: 'pe_ttm',
  f12: 'code',
  f13: 'market',
  f14: 'name',
  f15: 'high',
  f16: 'low',
  f17: 'open',
  f23: 'pb',
  f20: 'totalCapital',
};

// 资金流向字段映射（日内分时资金流向 kline）
export const FFLOW_COLUMNS = [
  'date', 'mainInflow', 'smallInflow', 'middleInflow', 'bigInflow', 'largeInflow',
];

// interval 映射: CLI 参数 → 东方财富 klt 值
export const INTERVAL_MAP = {
  'D': 101,
  'W': 102,
  'M': 103,
  '1': 1,
  '5': 5,
  '15': 15,
  '30': 30,
  '60': 60,
};

// 复权映射: CPS 值 → 东方财富 fqt 值
// CPS: 1=不复权, 2=前复权, 3=后复权
export const FQT_MAP = {
  '1': 0,
  '2': 1,
  '3': 2,
};

// 请求 headers
export const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://quote.eastmoney.com/',
};
