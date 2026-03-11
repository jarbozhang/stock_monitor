// 市场前缀映射
const MARKET_MAP = { SZ: '0', SH: '1', BJ: '0' };
const REVERSE_MAP = { '0': 'SZ', '1': 'SH' };

/**
 * iFinD 代码 → 东方财富 secid
 * "000001.SZ" → "0.000001"
 */
export function toEastMoneyCode(code) {
  const [num, market] = code.split('.');
  const prefix = MARKET_MAP[market];
  if (prefix === undefined) {
    throw new Error(`未知市场后缀: ${market} (代码: ${code})`);
  }
  // 北交所 8/4 开头用 0，创业板/深市也是 0，沪市 6 开头用 1
  // 更精确：根据股票号段判断
  if (market === 'BJ') return `0.${num}`;
  return `${prefix}.${num}`;
}

/**
 * 东方财富 secid → iFinD 代码
 * "0.000001" → "000001.SZ"
 */
export function toIFindCode(secid) {
  const [prefix, num] = secid.split('.');
  const market = REVERSE_MAP[prefix] || 'SZ';
  return `${num}.${market}`;
}

/**
 * 批量转换逗号分隔的代码字符串
 * "000001.SZ,600030.SH" → ["0.000001", "1.600030"]
 */
export function convertCodes(codesStr) {
  return codesStr.split(',').map(c => toEastMoneyCode(c.trim()));
}
