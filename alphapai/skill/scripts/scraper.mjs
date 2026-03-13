#!/usr/bin/env node
/**
 * Alpha派会议纪要抓取工具
 *
 * 用法:
 *   node scraper.mjs                       # 抓取最近50条
 *   node scraper.mjs --pages 3             # 抓取3页（150条）
 *   node scraper.mjs --keyword "AI芯片"     # 按关键词搜索
 *   node scraper.mjs --industry 电子        # 按行业筛选
 *   node scraper.mjs --days 7              # 最近7天的会议
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, 'config.json');
const OUTPUT_DIR = path.join(__dirname, 'data');

// ─── 配置 ───────────────────────────────────────────────
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    const defaultConfig = {
      authorization: '',
      xDevice: '',
      baseUrl: 'https://alphapai-web.rabyte.cn',
      pageSize: 50,
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
    console.error(`请先编辑 ${CONFIG_FILE} 填入 authorization token`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
}

// ─── HTTP 请求封装 ──────────────────────────────────────
function makeHeaders(config) {
  return {
    'accept': 'application/json',
    'authorization': config.authorization,
    'content-type': 'application/json',
    'x-device': config.xDevice || '21ba596c57b2fa20139b6bb6c0cc5325',
    'x-from': 'web',
  };
}

async function fetchList(config, { pageNum = 1, pageSize, keyword = '', beginTime = '', endTime = '' } = {}) {
  const url = `${config.baseUrl}/external/alpha/api/reading/roadshow/summary/list`;
  const body = {
    pageNum,
    pageSize: pageSize || config.pageSize,
    beginTime,
    endTime,
    marketType: [],
    marketTypeV2: 10,
    featureV2: [],
    industry: [],
    stock: [],
    hasRadio: false,
    priceMovementSort: '',
    institution: [],
    durationCategory: '',
    word: keyword,
    isPrivate: false,
    filterNoPermission: true,
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: makeHeaders(config),
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (data.code !== 200000) throw new Error(`List API error: ${data.message}`);
  return data.data;
}

async function fetchDetail(config, summaryId) {
  const url = new URL(`${config.baseUrl}/external/alpha/api/reading/roadshow/summary/detail`);
  url.searchParams.set('id', summaryId);

  const resp = await fetch(url.toString(), {
    method: 'GET',
    headers: makeHeaders(config),
  });
  const data = await resp.json();
  if (data.code !== 200000) throw new Error(`Detail API error: ${data.message} (id=${summaryId})`);
  return data.data;
}

// ─── 数据提取 ────────────────────────────────────────────
function extractMeeting(detail) {
  const v3 = detail.aiSummaryV3 || {};
  const aiSummary = detail.aiSummary || {};

  // 提取 QA 列表
  const qaList = (v3.qaListV2 || v3.qaList || []).map(qa => {
    if (qa.question) {
      // v2 format
      const q = (qa.question.content || []).map(c => c.text).join('');
      const a = (qa.answer || []).map(ans =>
        (ans.content || []).map(c => c.text).join('')
      ).join('\n');
      return { q, a };
    }
    return { q: qa.q, a: qa.a };
  });

  // 提取要点
  const topics = (v3.topicBulletsV2 || v3.topicBullets || []).map(topic => {
    const title = topic.title;
    const bullets = (topic.points || topic.bullets || []).map(b => {
      if (b.content) {
        return b.content.map(c => c.text).join('');
      }
      return b.text || '';
    });
    return { title, bullets };
  });

  // 提取分段摘要
  const segments = (v3.summarySegment || detail.summarySegmentList || []).map(s => ({
    startTime: s.startTime,
    endTime: s.endTime,
    title: s.title,
    summary: s.summary,
  }));

  // 提取录音转录（mtSummary.content）
  const speakerRecognition = v3.speakerRecognition || [];
  const speakerMap = {};
  for (const s of speakerRecognition) {
    speakerMap[String(s.roleId)] = s.name + (s.jobTitle ? `(${s.jobTitle})` : '');
  }

  let transcript = [];
  const mtSummary = detail.mtSummary || {};
  if (mtSummary.content) {
    try {
      const rawSegments = typeof mtSummary.content === 'string'
        ? JSON.parse(mtSummary.content)
        : mtSummary.content;
      // 合并同一发言人的连续段落
      let current = null;
      for (const seg of rawSegments) {
        const speaker = speakerMap[seg.role] || `发言人${seg.role}`;
        const time = formatMs(seg.bg);
        if (current && current.speaker === speaker) {
          current.text += seg.content;
          current.endTime = formatMs(seg.ed);
        } else {
          if (current) transcript.push(current);
          current = { speaker, time, endTime: formatMs(seg.ed), text: seg.content };
        }
      }
      if (current) transcript.push(current);
    } catch (e) {}
  }

  return {
    id: detail.id,
    title: (detail.title || '').replace(/<[^>]+>/g, ''),
    date: detail.roadshowDate,
    guest: detail.guest,
    industry: (detail.industry || []).map(i => i.name),
    stock: (detail.stock || []).map(s => `${s.name}(${s.code})`),
    pv: detail.pv,
    duration: detail.duration || v3.duration,
    wordCount: detail.wordCount || v3.wordCount,
    recorder: detail.recorder,
    fullTextSummary: v3.fullTextSummary || '',
    aiSummaryContent: aiSummary.content || '',
    segments,
    topics,
    qaList,
    transcript,
    speakers: speakerRecognition.map(s => `${s.name}(${s.jobTitle})`),
    hasAudio: !!detail.radio,
    audioUrl: detail.radio || null,
  };
}

// ─── Markdown 格式化 ─────────────────────────────────────
function toMarkdown(meeting) {
  const lines = [];
  lines.push(`# ${meeting.title}`);
  lines.push('');
  lines.push(`- **日期**: ${meeting.date}`);
  lines.push(`- **嘉宾**: ${meeting.guest}`);
  if (meeting.industry.length) lines.push(`- **行业**: ${meeting.industry.join(', ')}`);
  if (meeting.stock.length) lines.push(`- **个股**: ${meeting.stock.join(', ')}`);
  if (meeting.speakers.length) lines.push(`- **发言人**: ${meeting.speakers.join(', ')}`);
  lines.push(`- **时长**: ${meeting.duration || '未知'}分钟 | **字数**: ${meeting.wordCount || '未知'}`);
  lines.push(`- **浏览量**: ${meeting.pv}`);
  lines.push('');

  if (meeting.fullTextSummary) {
    lines.push('## 摘要');
    lines.push('');
    lines.push(meeting.fullTextSummary);
    lines.push('');
  }

  if (meeting.segments.length) {
    lines.push('## 分段概要');
    lines.push('');
    for (const seg of meeting.segments) {
      lines.push(`### [${seg.startTime} - ${seg.endTime}] ${seg.title}`);
      lines.push('');
      lines.push(seg.summary);
      lines.push('');
    }
  }

  if (meeting.topics.length) {
    lines.push('## 核心要点');
    lines.push('');
    for (const topic of meeting.topics) {
      lines.push(`### ${topic.title}`);
      lines.push('');
      for (const b of topic.bullets) {
        lines.push(`- ${b}`);
      }
      lines.push('');
    }
  }

  if (meeting.qaList.length) {
    lines.push('## Q&A');
    lines.push('');
    for (const qa of meeting.qaList) {
      lines.push(`**Q: ${qa.q}**`);
      lines.push('');
      lines.push(qa.a);
      lines.push('');
    }
  }

  if (meeting.aiSummaryContent && !meeting.fullTextSummary) {
    lines.push('## AI 纪要全文');
    lines.push('');
    lines.push(meeting.aiSummaryContent);
    lines.push('');
  }

  if (meeting.transcript.length) {
    lines.push('## 录音转录');
    lines.push('');
    for (const t of meeting.transcript) {
      lines.push(`**${t.speaker}** [${t.time}]`);
      lines.push('');
      lines.push(t.text);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ─── 主流程 ──────────────────────────────────────────────
async function main() {
  const config = loadConfig();
  const args = process.argv.slice(2);

  let pages = 1;
  let keyword = '';
  let days = 0;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pages') pages = parseInt(args[++i]);
    if (args[i] === '--keyword') keyword = args[++i];
    if (args[i] === '--days') days = parseInt(args[++i]);
  }

  let beginTime = '';
  if (days > 0) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    beginTime = d.toISOString().split('T')[0] + ' 00:00:00';
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // 1. 获取会议列表
  let allItems = [];
  for (let p = 1; p <= pages; p++) {
    console.log(`📋 获取列表第 ${p}/${pages} 页...`);
    const result = await fetchList(config, { pageNum: p, keyword, beginTime });
    allItems = allItems.concat(result.list);
    console.log(`   共 ${result.total} 条，本页 ${result.list.length} 条`);

    if (result.list.length < config.pageSize) break; // 没有更多了
    if (p < pages) await sleep(500); // 请求间隔
  }

  console.log(`\n🎯 共获取 ${allItems.length} 条会议，开始抓取详情...\n`);

  // 2. 逐条获取详情并保存
  let success = 0;
  let skip = 0;
  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];
    const dateStr = (item.roadshowDate || item.date || '').split(' ')[0];
    // 清理搜索结果中的 HTML 高亮标签
    const cleanTitle = (item.title || 'untitled').replace(/<[^>]+>/g, '');
    const safeTitle = cleanTitle.replace(/[/\\?%*:|"<>]/g, '_').substring(0, 80);
    const filename = `${dateStr}_${safeTitle}.md`;
    const filepath = path.join(OUTPUT_DIR, filename);

    // 跳过已存在的文件
    if (fs.existsSync(filepath)) {
      skip++;
      continue;
    }

    console.log(`[${i + 1}/${allItems.length}] ${item.title?.substring(0, 60)}...`);

    try {
      const detail = await fetchDetail(config, item.id);
      const meeting = extractMeeting(detail);
      const md = toMarkdown(meeting);
      fs.writeFileSync(filepath, md, 'utf-8');
      success++;
    } catch (err) {
      console.error(`   ❌ ${err.message}`);
    }

    // 请求间隔，避免被限流
    if (i < allItems.length - 1) await sleep(300);
  }

  console.log(`\n✅ 完成！成功 ${success} 条，跳过 ${skip} 条（已存在），保存至 ${OUTPUT_DIR}`);

  // 3. 保存列表索引
  const indexPath = path.join(OUTPUT_DIR, '_index.json');
  const indexData = allItems.map(item => ({
    id: item.id,
    title: item.title,
    date: item.roadshowDate || item.date,
    industry: (item.industry || []).map(i => i.name),
    stock: (item.stock || []).map(s => s.name),
    pv: item.pv,
  }));
  fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf-8');
}

function formatMs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
