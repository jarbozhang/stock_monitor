import { readFileSync, writeFileSync } from 'node:fs';
import { BASE_URL, TOKEN_CACHE_PATH, TOKEN_EXPIRY_MS } from './config.js';

function readCache() {
  try {
    return JSON.parse(readFileSync(TOKEN_CACHE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function writeCache(data) {
  writeFileSync(TOKEN_CACHE_PATH, JSON.stringify(data, null, 2));
}

function isCacheValid(cache) {
  if (!cache || !cache.access_token || !cache.timestamp) return false;
  return Date.now() - cache.timestamp < TOKEN_EXPIRY_MS;
}

export async function getAccessToken(refreshToken, forceRefresh = false) {
  if (!refreshToken) {
    throw new Error('REFRESH_TOKEN 未配置，请在 .env 文件中设置');
  }

  if (!forceRefresh) {
    const cache = readCache();
    if (isCacheValid(cache)) {
      return cache.access_token;
    }
  }

  console.log('[auth] 获取新 access_token ...');

  const url = `${BASE_URL}/get_access_token`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'refresh_token': refreshToken,
    },
  });

  const data = await res.json();

  if (data.errorcode !== 0) {
    throw new Error(`获取 access_token 失败: [${data.errorcode}] ${data.errmsg || ''}`);
  }

  const accessToken = data.data.access_token;
  writeCache({ access_token: accessToken, timestamp: Date.now() });
  console.log('[auth] access_token 已缓存到 token.json');

  return accessToken;
}
