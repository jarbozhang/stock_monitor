#!/usr/bin/env node
/**
 * Alpha派 Token 自动获取
 * 打开浏览器让用户登录，自动拦截 API 请求捕获 JWT token 并保存
 *
 * 用法: node get-token.mjs
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, 'config.json');
const BASE_URL = 'https://alphapai-web.rabyte.cn';
const TIMEOUT_MS = 5 * 60 * 1000;

async function main() {
  console.log('🚀 正在启动浏览器...\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  let capturedToken = null;
  let capturedDevice = null;
  let capturedSecretKey = null;
  let resolveToken;
  const tokenPromise = new Promise(r => { resolveToken = r; });

  page.on('request', req => {
    if (capturedToken) return;
    const headers = req.headers();
    const auth = headers['authorization'];
    if (auth && auth.startsWith('eyJ')) {
      capturedToken = auth;
      capturedDevice = headers['x-device'] || null;
      console.log('✅ Token 已捕获！');
      resolveToken();
    }
  });

  await page.goto(BASE_URL);

  console.log('📱 请在浏览器中登录 Alpha派');
  console.log('   登录成功后会自动捕获 token 并保存');
  console.log('   超时时间：5 分钟\n');

  const timer = setTimeout(() => resolveToken(), TIMEOUT_MS);
  await tokenPromise;
  clearTimeout(timer);

  if (!capturedToken) {
    try {
      capturedToken = await page.evaluate(() => {
        const direct = localStorage.getItem('USER_AUTH_TOKEN');
        if (direct && direct.startsWith('eyJ')) return direct;
        for (const key of Object.keys(localStorage)) {
          const val = localStorage.getItem(key);
          if (val && val.startsWith('eyJ')) return val;
        }
        return null;
      });
      if (capturedToken) console.log('✅ 从 localStorage 提取到 Token！');
    } catch {}
  }

  if (!capturedSecretKey) {
    try {
      capturedSecretKey = await page.evaluate(() => localStorage.getItem('SECRET_KEY'));
      if (capturedSecretKey) console.log('✅ 从 localStorage 提取到 SECRET_KEY！');
    } catch {}
  }

  if (!capturedDevice) {
    try {
      capturedDevice = await page.evaluate(() => localStorage.getItem('xDevice'));
    } catch {}
  }

  if (capturedToken) {
    let config = {};
    if (fs.existsSync(CONFIG_FILE)) {
      config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
    config.authorization = capturedToken;
    if (capturedDevice) config.xDevice = capturedDevice;
    if (capturedSecretKey) config.secretKey = capturedSecretKey;
    if (!config.baseUrl) config.baseUrl = BASE_URL;
    if (!config.pageSize) config.pageSize = 50;

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log(`\n💾 认证信息已保存到 config.json`);
    console.log(`   token前缀: ${capturedToken.substring(0, 30)}...`);
    if (capturedDevice) console.log(`   xDevice: ${capturedDevice}`);
    if (capturedSecretKey) console.log(`   secretKey前缀: ${capturedSecretKey.substring(0, 12)}...`);
  } else {
    console.log('\n❌ 超时未能捕获 token，请重新运行');
  }

  await browser.close();
  console.log('\n🏁 浏览器已关闭');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
