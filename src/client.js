import { BASE_URL, RATE_LIMIT, RATE_WINDOW_MS } from './config.js';
import { getAccessToken } from './auth.js';

export class IFindClient {
  constructor(refreshToken) {
    this.refreshToken = refreshToken;
    this.accessToken = null;
    this.timestamps = []; // 滑动窗口限流
  }

  async init() {
    this.accessToken = await getAccessToken(this.refreshToken);
  }

  async throttle() {
    const now = Date.now();
    // 清除窗口外的记录
    this.timestamps = this.timestamps.filter(t => now - t < RATE_WINDOW_MS);

    if (this.timestamps.length >= RATE_LIMIT) {
      const oldest = this.timestamps[0];
      const waitMs = RATE_WINDOW_MS - (now - oldest) + 10;
      console.log(`[throttle] 限流等待 ${Math.ceil(waitMs / 1000)}s ...`);
      await new Promise(r => setTimeout(r, waitMs));
      return this.throttle(); // 递归检查
    }

    this.timestamps.push(Date.now());
  }

  async request(endpoint, body, retried = false) {
    if (!this.accessToken) await this.init();

    await this.throttle();

    const url = `${BASE_URL}${endpoint}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'access_token': this.accessToken,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    // token 过期自动刷新重试
    if ((data.errorcode === -1010 || data.errorcode === -1302) && !retried) {
      console.log('[client] token 过期，自动刷新 ...');
      this.accessToken = await getAccessToken(this.refreshToken, true);
      return this.request(endpoint, body, true);
    }

    if (data.errorcode !== 0) {
      throw new Error(`API 错误 [${data.errorcode}]: ${data.errmsg || JSON.stringify(data)}`);
    }

    return data;
  }
}
