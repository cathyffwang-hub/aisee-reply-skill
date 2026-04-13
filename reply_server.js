#!/usr/bin/env node
/**
 * AiSee 回复服务（Reply Server）
 *
 * 职责：接收 HTML 工具页发来的 POST /reply 请求，
 * 驱动 agent-browser 完成在 AiSee 中的实际回复操作。
 *
 * 启动方式：node reply_server.js
 * 默认端口：3400（可通过 PORT 环境变量覆盖）
 */

const http = require('http');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const BROWSER  = process.env.BROWSER || '/Users/cathy/.workbuddy/agent-browser-local/node_modules/.bin/agent-browser';
const BASE_URL = 'https://aisee.woa.com/admin/p-23ba9e1e-7bfd-3d15-806d-31f9b3e3a531/b-a9ba8a76-deb1-328c-af3b-2fc7c54ac4f6/p5sr49xhf1/operate/aiseeDetail';
const PORT     = parseInt(process.env.PORT || '3400', 10);

// ===== 串行任务队列（防止并发操作浏览器）=====
let queue = [], running = false;

async function runQueue() {
  if (running || !queue.length) return;
  running = true;
  const task = queue.shift();
  try { await task(); } catch(e) { console.error('[queue error]', e.message); }
  running = false;
  runQueue();
}

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push(async () => { try { resolve(await fn()); } catch(e) { reject(e); } });
    runQueue();
  });
}

async function browser(cmd, timeout = 30000) {
  console.log('[browser]', cmd.substring(0, 100));
  const { stdout } = await execAsync(`${BROWSER} ${cmd}`, { timeout });
  return stdout.trim();
}

// ===== 核心回复逻辑（已验证：click + type + Enter）=====
async function doReply(fid, answer) {
  const url = `${BASE_URL}?fid=${fid}`;
  const sel  = `textarea[placeholder*="回复"]`;

  // 1. 打开详情页
  await browser(`open "${url}"`);
  await delay(2000);

  // 2. 点击聚焦输入框
  await browser(`click "${sel}"`);
  await delay(400);

  // 3. 逐行输入（Ctrl+Enter 换行，Enter 发送）
  const lines = answer.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line) {
      const escaped = line.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      await browser(`type "${sel}" "${escaped}"`);
    }
    if (i < lines.length - 1) {
      await browser(`press Control+Enter`);
    }
    await delay(80);
  }

  await delay(500);

  // 4. Enter 发送
  await browser(`press Enter`);
  await delay(1200);

  // 5. 截图留档
  const ss = await browser('screenshot');
  console.log('[done] reply sent, screenshot:', ss);

  return { ok: true };
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===== HTTP 服务 =====
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/reply') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      try {
        const { fid, answer, index } = JSON.parse(body);
        console.log(`\n[reply] #${index} fid=${fid}`);
        console.log('[answer]', answer.substring(0, 80) + (answer.length > 80 ? '...' : ''));

        const result = await enqueue(() => doReply(fid, answer));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, fid, index }));
      } catch(e) {
        console.error('[error]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // 健康检查
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ts: Date.now() }));
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`✅ AiSee Reply Server → http://localhost:${PORT}`);
  console.log(`   POST /reply  { fid, answer, index }`);
});
