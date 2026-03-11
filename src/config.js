import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// 手写 .env 解析
function loadEnv() {
  try {
    const content = readFileSync(resolve(ROOT, '.env'), 'utf-8');
    const env = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
    return env;
  } catch {
    return {};
  }
}

const env = loadEnv();

export const REFRESH_TOKEN = env.REFRESH_TOKEN || process.env.REFRESH_TOKEN || '';
export const BASE_URL = 'https://quantapi.51ifind.com/api/v1';
export const TOKEN_CACHE_PATH = resolve(ROOT, 'token.json');
export const OUTPUT_DIR = resolve(ROOT, 'output');
export const ROOT_DIR = ROOT;

// token 有效期阈值：6天（留1天余量）
export const TOKEN_EXPIRY_MS = 6 * 24 * 60 * 60 * 1000;

// 限流：580次/分钟
export const RATE_LIMIT = 580;
export const RATE_WINDOW_MS = 60 * 1000;

// 历史行情默认 indicators
export const HISTORY_INDICATORS = 'open,high,low,close,volume,amount,changeRatio,turnoverRatio,preClose';

// 高频默认 indicators
export const HIGHFREQ_INDICATORS = 'open,high,low,close,volume,amount,changeRatio';

// 实时行情 indicators（含资金流向）
export const REALTIME_INDICATORS = [
  'latest,open,high,low,change,changeRatio,volume,amount,pe_ttm,pb,totalCapital',
  'mainInflow,mainOutflow,mainNetInflow',
  'retailInflow,retailOutflow,retailNetInflow',
  'largeInflow,largeOutflow,largeNetInflow',
  'bigInflow,bigOutflow,bigNetInflow',
  'middleInflow,middleOutflow,middleNetInflow',
  'smallInflow,smallOutflow,smallNetInflow',
].join(',');
