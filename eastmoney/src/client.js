import { RATE_LIMIT, RATE_WINDOW_MS, REQUEST_HEADERS } from './config.js';

export class EastMoneyClient {
  constructor() {
    this.timestamps = []; // 滑动窗口限流
  }

  async throttle() {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(t => now - t < RATE_WINDOW_MS);

    if (this.timestamps.length >= RATE_LIMIT) {
      const oldest = this.timestamps[0];
      const waitMs = RATE_WINDOW_MS - (now - oldest) + 10;
      console.log(`[throttle] 限流等待 ${Math.ceil(waitMs / 1000)}s ...`);
      await new Promise(r => setTimeout(r, waitMs));
      return this.throttle();
    }

    this.timestamps.push(Date.now());
  }

  async request(url, params) {
    await this.throttle();

    const qs = new URLSearchParams(params).toString();
    const fullUrl = `${url}?${qs}`;

    const res = await fetch(fullUrl, {
      method: 'GET',
      headers: REQUEST_HEADERS,
    });

    const data = await res.json();

    if (data.rc !== undefined && data.rc !== 0) {
      throw new Error(`API 错误 [rc=${data.rc}]: ${data.msg || JSON.stringify(data)}`);
    }

    return data;
  }
}
