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
async function doReply(fid, answer, needsTag) {
  const url = `${BASE_URL}?fid=${fid}`;
  const sel  = `textarea[placeholder*="回复"]`;

  // 1. 打开详情页
  await browser(`open "${url}"`);
  await delay(2500);

  // 1.5. 如需打企业版标签：在回复前先设置好标签
  if (needsTag) {
    try {
      await setEnterpriseTag();
    } catch(e) {
      console.error('[tag error]', e.message);
      // 标签失败不影响回复主流程
    }
  }

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

// ===== 给反馈打「企业版问题」标签 =====
// AiSee 的业务标签字段是 MUI Autocomplete 组件（非 Ant Design）
// 关键发现：
//   1. MUI Autocomplete 必须用真实 click 命令触发展开（纯 JS .click() 无效）
//   2. 下拉 popper 在 body 下，class 含 MuiAutocomplete-popper
//   3. 选择选项时必须 dispatch 完整的 mousedown+mouseup+click 事件序列，
//      因为 MUI 的监听器绑在 mousedown 上，光 .click() 会被忽略
//   4. 验证 chip 要在业务标签字段所在的 FormControl 容器内查找，避免误读其他字段的 chip
async function setEnterpriseTag() {
  console.log('[tag] 给反馈打「企业版问题」标签...');

  try {
    // 1. 滚到业务标签字段位置并点击（触发 MUI Autocomplete 展开）
    await browser(`eval "var e=document.querySelector('input[placeholder=\\"业务标签\\"]');if(e)e.scrollIntoView({block:'center'})"`);
    await delay(400);
    await browser(`click 'input[placeholder="业务标签"]'`);

    // 2. 轮询等 popper 出现（最多 6 秒）
    let popperFound = false;
    for (let i = 0; i < 12; i++) {
      await delay(500);
      const check = await browser(`eval "document.querySelector('.MuiAutocomplete-popper')?'yes':'no'"`);
      if (check.includes('yes')) { popperFound = true; break; }
    }
    if (!popperFound) {
      console.warn('[tag] popper 未出现，跳过打标签');
      return;
    }

    // 3. 用完整鼠标事件序列点击「企业版问题」选项（关键！MUI 监听 mousedown）
    const pickJs = `(function(){var p=document.querySelector(".MuiAutocomplete-popper");if(!p)return JSON.stringify({ok:false,err:"no popper"});var opts=Array.from(p.querySelectorAll("li,[role=option]"));var t=opts.find(function(o){return o.textContent.trim()==="企业版问题"});if(!t)return JSON.stringify({ok:false,err:"no option",all:opts.map(function(o){return o.textContent.trim()})});["mousedown","mouseup","click"].forEach(function(type){t.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window,button:0}))});return JSON.stringify({ok:true})})()`;
    const pickResult = await browser(`eval "${pickJs.replace(/"/g, '\\"')}"`);
    console.log('[tag] 选择结果:', pickResult);

    await delay(600);

    // 4. 验证：在业务标签字段所在的 FormControl 容器内查找 chip
    const verifyJs = `(function(){var input=document.querySelector("input[placeholder=\\"业务标签\\"]");if(!input)return"no input";var container=input.closest(".MuiFormControl-root");var chips=Array.from(container.querySelectorAll(".MuiChip-root")).map(function(c){return c.textContent.trim()});return chips.some(function(t){return t==="企业版问题"})?"ok":JSON.stringify(chips)})()`;
    const verifyResult = await browser(`eval "${verifyJs.replace(/"/g, '\\"')}"`);

    // 5. 按 Escape 关闭下拉
    await browser(`press Escape`);
    await delay(300);

    if (verifyResult.includes('ok')) {
      console.log('[tag] ✅ 「企业版问题」标签已添加');
    } else {
      console.warn('[tag] ⚠️ 验证未通过:', verifyResult);
    }
  } catch(e) {
    console.error('[tag] 打标签失败:', e.message);
    // 标签失败不影响主流程
  }
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
        const { fid, answer, index, needsTag } = JSON.parse(body);
        console.log(`\n[reply] #${index} fid=${fid} tag=${needsTag ? '企业版' : 'no'}`);
        console.log('[answer]', answer.substring(0, 80) + (answer.length > 80 ? '...' : ''));

        const result = await enqueue(() => doReply(fid, answer, !!needsTag));
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
