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
      secretKey: '',
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
  const headers = {
    'accept': 'application/json',
    'authorization': config.authorization,
    'content-type': 'application/json',
    'x-device': config.xDevice || '21ba596c57b2fa20139b6bb6c0cc5325',
    'x-from': 'web',
    'origin': config.baseUrl,
    'referer': `${config.baseUrl}/`,
    'user-agent': 'Mozilla/5.0 OpenClaw AlphaPai Reader',
  };
  if (config.secretKey) {
    headers['cookie'] = `sk=${config.secretKey}`;
  }
  return headers;
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
  if (data.code !== 200000) {
    if (resp.status === 401 || data.code === 401000) {
      throw new Error('List API unauthorized: 缺少或失效的 authorization / secretKey(sk) / xDevice');
    }
    throw new Error(`List API error: ${data.message || data.msg || JSON.stringify(data)}`);
  }
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

  const qaList = (v3.qaListV2 || v3.qaList || []).map(qa => {
    if (qa.question) {
      const q = (qa.question.content || []).map(c => c.text).join('');
      const a = (qa.answer || []).map(ans =>
        (ans.content || []).map(c => c.text).join('')
      ).join('\n');
      return { q, a };
    }
    return { q: qa.q, a: qa.a };
  });

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

  const segments = (v3.summarySegment || detail.summarySegmentList || []).map(s => ({
    startTime: s.startTime,
    endTime: s.endTime,
    title: s.title,
    summary: s.summary,
  }));

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

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
}

function formatMs(ms) {
  if (ms == null) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = { pages: 1, keyword: '', days: 0 };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--pages') args.pages = parseInt(argv[++i], 10) || 1;
    else if (arg === '--keyword') args.keyword = argv[++i] || '';
    else if (arg === '--days') args.days = parseInt(argv[++i], 10) || 0;
    else if (arg === '--help' || arg === '-h') {
      console.log('用法: node scraper.mjs [--pages N] [--keyword 关键词] [--days N]');
      process.exit(0);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const config = loadConfig();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let beginTime = '';
  let endTime = '';
  if (args.days > 0) {
    const now = new Date();
    const past = new Date(now.getTime() - args.days * 24 * 60 * 60 * 1000);
    beginTime = past.toISOString().slice(0, 10);
    endTime = now.toISOString().slice(0, 10);
  }

  const allMeetings = [];
  const index = [];

  for (let page = 1; page <= args.pages; page++) {
    console.log(`📄 抓取第 ${page}/${args.pages} 页...`);
    const listData = await fetchList(config, {
      pageNum: page,
      keyword: args.keyword,
      beginTime,
      endTime,
    });

    const items = listData.list || [];
    if (items.length === 0) {
      console.log('没有更多数据');
      break;
    }

    for (const item of items) {
      try {
        const title = (item.title || '').replace(/<[^>]+>/g, '');
        const date = item.roadshowDate || 'unknown-date';
        const filename = sanitizeFilename(`${date}_${title}.md`);
        const filepath = path.join(OUTPUT_DIR, filename);

        if (fs.existsSync(filepath)) {
          console.log(`⏭️  跳过已存在: ${filename}`);
          index.push({
            id: item.id,
            title,
            date,
            industry: (item.industry || []).map(i => i.name),
            stock: (item.stock || []).map(s => `${s.name}(${s.code})`),
            file: filename,
          });
          continue;
        }

        console.log(`  ↳ 下载: ${title}`);
        const detail = await fetchDetail(config, item.id);
        const meeting = extractMeeting(detail);
        const md = toMarkdown(meeting);
        fs.writeFileSync(filepath, md, 'utf-8');

        index.push({
          id: meeting.id,
          title: meeting.title,
          date: meeting.date,
          industry: meeting.industry,
          stock: meeting.stock,
          file: filename,
        });
        allMeetings.push(meeting);

        await sleep(300);
      } catch (err) {
        console.error(`  ❌ 失败: ${item.title} - ${err.message}`);
      }
    }

    await sleep(500);
  }

  const indexPath = path.join(OUTPUT_DIR, '_index.json');
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');

  console.log(`\n✅ 完成！`);
  console.log(`- 新下载: ${allMeetings.length} 条`);
  console.log(`- 索引文件: ${indexPath}`);
  console.log(`- 输出目录: ${OUTPUT_DIR}`);
}

main().catch(err => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});
