#!/usr/bin/env node
/**
 * AiSee 回复服务（Reply Server）
 *
 * 职责：接收 HTML 工具页发来的 POST /reply 请求，提交回复到 AiSee。
 *
 * 支持两种模式：
 * - OpenAPI 模式（推荐）：通过 HTTP API 直接提交，无需浏览器
 * - Cookie 模式（旧）：通过 agent-browser 驱动浏览器操作
 *
 * 启动方式：node reply_server.js
 * 默认端口：3400（可通过 PORT 环境变量覆盖）
 */

const http = require('http');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// OpenAPI 模块
const openapi = require('./openapi');

// ===== 配置 =====
const AUTH_MODE = process.env.AISEE_AUTH_MODE || 'openapi';
const PORT      = parseInt(process.env.PORT || '3400', 10);

// OpenAPI 配置
const API_CONFIG = {
  secretId:  process.env.AISEE_SECRET_ID  || 'wendan_shouhou',
  appId:     process.env.AISEE_APP_ID     || 'p5sr49xhf1',
  publicKey: process.env.AISEE_PUBLIC_KEY  || 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDdJB2KitBIU5RZK+5/y1ZozixgGM5sum0uk3saTOg5XQ9UHgnCTAdH9YC6emELiLMxyYqbIDyk6/R/aqmT6F+1pSfvCinHCTvT1/BIWM6NMk6kUE0LrkAl7312TfE35SJMw5WxsHsdiv8EbIr023CaCdLmLq/lcKruJDmaQEOW8wIDAQAB',
  userName:  process.env.AISEE_USER_NAME   || 'cathyfwang',
};

// Cookie 模式配置
const BROWSER  = process.env.BROWSER || '/Users/cathy/.workbuddy/agent-browser-local/node_modules/.bin/agent-browser';
const BASE_URL = 'https://aisee.woa.com/admin/p-23ba9e1e-7bfd-3d15-806d-31f9b3e3a531/b-a9ba8a76-deb1-328c-af3b-2fc7c54ac4f6/p5sr49xhf1/operate/aiseeDetail';

// ===== 串行任务队列（防止并发）=====
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

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===== OpenAPI 模式：通过 HTTP API 回复 =====
async function doReplyOpenAPI(fid, answer, needsTag, userId) {
  console.log(`[openapi] 提交回复 fid=${fid}`);

  // 发送回复
  const result = await openapi.sendReply(API_CONFIG, fid, answer, userId || 'anonymous');
  console.log('[openapi] ✅ 回复已提交');

  // 如需打企业版标签
  if (needsTag) {
    try {
      // 通过 modifyFeedback 设置标签
      // 注意：user_tags 的值需要是标签 ID，这里尝试设置
      await openapi.modifyFeedback(API_CONFIG, [fid], { user_tags: ['企业版问题'] });
      console.log('[openapi] ✅ 企业版标签已设置');
    } catch (e) {
      console.warn('[openapi] ⚠️ 标签设置失败（不影响回复）:', e.message);
    }
  }

  return { ok: true };
}

// ===== Cookie 模式：通过浏览器回复（旧逻辑保留）=====
async function browser(cmd, timeout = 30000) {
  console.log('[browser]', cmd.substring(0, 100));
  const { stdout } = await execAsync(`${BROWSER} ${cmd}`, { timeout });
  return stdout.trim();
}

async function doReplyCookie(fid, answer, needsTag) {
  const url = `${BASE_URL}?fid=${fid}`;
  const sel  = `textarea[placeholder*="回复"]`;

  await browser(`open "${url}"`);
  await delay(2500);

  if (needsTag) {
    try { await setEnterpriseTag(); }
    catch(e) { console.error('[tag error]', e.message); }
  }

  await browser(`click "${sel}"`);
  await delay(400);

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
  await browser(`press Enter`);
  await delay(1200);

  const ss = await browser('screenshot');
  console.log('[done] reply sent, screenshot:', ss);
  return { ok: true };
}

// ===== 给反馈打「企业版问题」标签（Cookie 模式专用）=====
async function setEnterpriseTag() {
  console.log('[tag] 给反馈打「企业版问题」标签...');
  try {
    await browser(`eval "var e=document.querySelector('input[placeholder=\\"业务标签\\"]');if(e)e.scrollIntoView({block:'center'})"`);
    await delay(400);
    await browser(`click 'input[placeholder="业务标签"]'`);

    let popperFound = false;
    for (let i = 0; i < 12; i++) {
      await delay(500);
      const check = await browser(`eval "document.querySelector('.MuiAutocomplete-popper')?'yes':'no'"`);
      if (check.includes('yes')) { popperFound = true; break; }
    }
    if (!popperFound) { console.warn('[tag] popper 未出现，跳过'); return; }

    const pickJs = `(function(){var p=document.querySelector(".MuiAutocomplete-popper");if(!p)return JSON.stringify({ok:false,err:"no popper"});var opts=Array.from(p.querySelectorAll("li,[role=option]"));var t=opts.find(function(o){return o.textContent.trim()==="企业版问题"});if(!t)return JSON.stringify({ok:false,err:"no option",all:opts.map(function(o){return o.textContent.trim()})});["mousedown","mouseup","click"].forEach(function(type){t.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window,button:0}))});return JSON.stringify({ok:true})})()`;
    const pickResult = await browser(`eval "${pickJs.replace(/"/g, '\\"')}"`);
    console.log('[tag] 选择结果:', pickResult);
    await delay(600);

    const verifyJs = `(function(){var input=document.querySelector("input[placeholder=\\"业务标签\\"]");if(!input)return"no input";var container=input.closest(".MuiFormControl-root");var chips=Array.from(container.querySelectorAll(".MuiChip-root")).map(function(c){return c.textContent.trim()});return chips.some(function(t){return t==="企业版问题"})?"ok":JSON.stringify(chips)})()`;
    const verifyResult = await browser(`eval "${verifyJs.replace(/"/g, '\\"')}"`);
    await browser(`press Escape`);
    await delay(300);

    if (verifyResult.includes('ok')) {
      console.log('[tag] ✅ 「企业版问题」标签已添加');
    } else {
      console.warn('[tag] ⚠️ 验证未通过:', verifyResult);
    }
  } catch(e) {
    console.error('[tag] 打标签失败:', e.message);
  }
}

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
        const { fid, answer, index, needsTag, user_id } = JSON.parse(body);
        console.log(`\n[reply] #${index} fid=${fid} mode=${AUTH_MODE} tag=${needsTag ? '企业版' : 'no'}`);
        console.log('[answer]', answer.substring(0, 80) + (answer.length > 80 ? '...' : ''));

        let result;
        if (AUTH_MODE === 'openapi') {
          result = await enqueue(() => doReplyOpenAPI(fid, answer, !!needsTag, user_id));
        } else {
          result = await enqueue(() => doReplyCookie(fid, answer, !!needsTag));
        }

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
    res.end(JSON.stringify({ ok: true, mode: AUTH_MODE, ts: Date.now() }));
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`✅ AiSee Reply Server → http://localhost:${PORT}`);
  console.log(`   模式：${AUTH_MODE.toUpperCase()}`);
  console.log(`   POST /reply  { fid, answer, index, user_id }`);
});
