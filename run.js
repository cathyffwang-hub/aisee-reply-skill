#!/usr/bin/env node
/**
 * AiSee 反馈自动回复工具 - 主执行脚本
 *
 * 功能：
 * 0. 自动检查 Git 远端更新，有新版本则自动 pull
 * 1. 检查知识库是否需要刷新（超90天自动重新获取）
 * 2. iOA 登录（使用持久化 Chrome profile，首次登录后无需再验证）
 * 3. 抓取网站上所有未回复的反馈（不限日期）
 * 4. 关键词命中模板B/C/A，其余交AI生成回复
 * 5. 生成可编辑回复工具网页（含 localStorage 落盘）
 * 6. 确保静态服务从 skill 目录启动（自动检查并修正）
 * 7. 企业微信通知（去重：同一天只推一次）
 */

const fs   = require('fs');
const path = require('path');
const http  = require('http');
const https = require('https');
const { exec, spawn, execSync } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// OpenAPI 模块（RSA 签名 + HTTP API 调用）
const openapi = require('./openapi');

// ===== 自动更新检查 =====
function autoUpdate() {
  try {
    const skillDir = __dirname;
    // 检查是否是 git 仓库
    if (!fs.existsSync(path.join(skillDir, '.git'))) return;
    // fetch 远端（静默，超时5秒）
    execSync('git fetch origin --quiet', { cwd: skillDir, timeout: 5000, stdio: 'ignore' });
    // 比较本地和远端
    const local = execSync('git rev-parse HEAD', { cwd: skillDir, timeout: 3000 }).toString().trim();
    const remote = execSync('git rev-parse origin/main', { cwd: skillDir, timeout: 3000 }).toString().trim();
    if (local !== remote) {
      console.log('[AutoUpdate] 检测到新版本，自动更新中...');
      execSync('git pull origin main --quiet', { cwd: skillDir, timeout: 15000, stdio: 'inherit' });
      console.log('[AutoUpdate] ✅ 已更新到最新版本');
    }
  } catch(e) {
    // 更新失败不影响主流程
  }
}
autoUpdate();

// ===== 配置（按需修改）=====
const CONFIG = {
  SKILL_DIR   : __dirname,
  MEMORY_DIR  : path.join(__dirname, 'memory'),
  KNOWLEDGE_FILE: path.join(__dirname, 'memory', 'knowledge.md'),

  // ===== OpenAPI 认证（推荐，无需 iOA cookie）=====
  // 认证模式：'openapi'（推荐）| 'cookie'（旧模式，需 iOA 登录）
  AISEE_AUTH_MODE: process.env.AISEE_AUTH_MODE || 'openapi',
  // OpenAPI 凭证（从邮件审批结果获取）
  AISEE_SECRET_ID: process.env.AISEE_SECRET_ID || 'wendan_shouhou',
  AISEE_PUBLIC_KEY: process.env.AISEE_PUBLIC_KEY || 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDdJB2KitBIU5RZK+5/y1ZozixgGM5sum0uk3saTOg5XQ9UHgnCTAdH9YC6emELiLMxyYqbIDyk6/R/aqmT6F+1pSfvCinHCTvT1/BIWM6NMk6kUE0LrkAl7312TfE35SJMw5WxsHsdiv8EbIr023CaCdLmLq/lcKruJDmaQEOW8wIDAQAB',
  AISEE_APP_ID: process.env.AISEE_APP_ID || 'p5sr49xhf1',
  // OpenAPI 回复时使用的用户名（RTX）
  AISEE_USER_NAME: process.env.AISEE_USER_NAME || 'cathyfwang',
  // 知识库文档源列表（自动刷新时逐个获取并合并）
  KNOWLEDGE_DOCS: [
    { id: 'DTEVpVGZJR3B6QUlw', url: 'https://docs.qq.com/aio/DTEVpVGZJR3B6QUlw', title: '企微SaaS文档-产品知识帮助中心' },
    { id: 'DTG9VUFNvWGpnRnRB', url: 'https://docs.qq.com/doc/DTG9VUFNvWGpnRnRB', title: '腾讯文档企业版(私有化)用户使用手册1.11' },
    { id: 'DTGFscUZIaGREa2tH', url: 'https://docs.qq.com/doc/DTGFscUZIaGREa2tH', title: '腾讯文档企业版(私有化)管理员使用手册1.11' },
    { id: 'DTFBDUldXRFRvU0lk', url: 'https://docs.qq.com/aio/DTFBDUldXRFRvU0lk', title: '智能文档撰写方法与排版技巧' },
    { id: 'DTHJwU09HTWVrV29h', url: 'https://docs.qq.com/doc/DTHJwU09HTWVrV29h', title: '腾讯文档企业版-智能文档使用手册' },
    { id: 'DTGlwcndCZmNmZEJW', url: 'https://docs.qq.com/doc/DTGlwcndCZmNmZEJW', title: '腾讯文档企业版-智能表格使用手册' },
    { id: 'DTHRVYlpvYUJLalVX', url: 'https://docs.qq.com/aio/DTHRVYlpvYUJLalVX', title: '企业版(私有化)更新日志2025' },
    { id: 'DTHZpWHJjdEFyYm1n', url: 'https://docs.qq.com/aio/DTHZpWHJjdEFyYm1n', title: '腾讯文档企业版AI能力简介' },
    { id: 'DTFZXc3prbWRleG9V', url: 'https://docs.qq.com/doc/DTFZXc3prbWRleG9V', title: '智能表格使用常见FAQ' },
    { id: 'DTGRqVk9pcExBWGlD', url: 'https://docs.qq.com/aio/DTGRqVk9pcExBWGlD', title: '企业版私有化-文档权限说明' },
    { id: 'DTGt5S1d3VkFKWWpa', url: 'https://docs.qq.com/aio/DTGt5S1d3VkFKWWpa', title: '企业版文档：如何设置共享空间权限' },
    { id: 'DTGpudHRSaGNKaWJp', url: 'https://docs.qq.com/aio/DTGpudHRSaGNKaWJp', title: '企业版上传导入格式及大小说明' },
    { id: 'DTGtlbXpqYmppYXFG', url: 'https://docs.qq.com/doc/DTGtlbXpqYmppYXFG', title: '收集表提醒说明' },
    { id: 'DTHZkdERneHNmR1dX', url: 'https://docs.qq.com/doc/DTHZkdERneHNmR1dX', title: '快捷键说明（Mac）' },
    { id: 'DTE5XeHJSWGxLZmxn', url: 'https://docs.qq.com/doc/DTE5XeHJSWGxLZmxn', title: '快捷键说明（Windows）' },
  ],
  KNOWLEDGE_REFRESH_DAYS: 90,

  AISEE_LIST  : 'https://aisee.woa.com/admin/p-23ba9e1e-7bfd-3d15-806d-31f9b3e3a531/b-a9ba8a76-deb1-328c-af3b-2fc7c54ac4f6/p5sr49xhf1/operate/aiseeList',
  AISEE_DETAIL: 'https://aisee.woa.com/admin/p-23ba9e1e-7bfd-3d15-806d-31f9b3e3a531/b-a9ba8a76-deb1-328c-af3b-2fc7c54ac4f6/p5sr49xhf1/operate/aiseeDetail',

  BROWSER     : '/Users/cathy/.workbuddy/agent-browser-local/node_modules/.bin/agent-browser',
  // 持久化 Chrome profile 目录：首次 iOA 登录后 cookie 会保存在这里，后续无需再验证
  BROWSER_PROFILE: path.join(__dirname, '.browser-profile'),
  MCPORTER    : 'mcporter',

  HTML_OUT    : path.join(__dirname, 'output', 'reply_tool.html'),
  REPLY_PORT  : 3400,
  STATIC_PORT : 3399,

  WECOM_WEBHOOK: process.env.WECOM_WEBHOOK ||
    'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=62b8f70c-c8d8-45c7-b0e8-656bae7382fa',

  // ===== 值班表（按星期几自动 @对应值班人）=====
  // 0=周日, 1=周一, ..., 5=周五, 6=周六
  DUTY_ROSTER: {
    1: { userid: 'elgong',    name: '龚胜平' },
    2: { userid: 'miaxtfeng', name: '冯小桐' },
    3: { userid: 'cathyfwang', name: '王亚菲' },
    4: { userid: 'zoralluo',  name: '罗港华' },
    5: { userid: 'yojanfan',  name: '范瑶' },
  },

  // GitHub Pages 公网地址（部署后使用）
  PAGES_URL: 'https://cathyffwang-hub.github.io/aisee-reply-skill/',

  // 企微 @人配置（旧，已被值班表替代，保留兼容）
  WECOM_MENTION_USERID: process.env.WECOM_MENTION_USERID || '',

  // 企微通知中使用的称呼（默认取系统用户名，可覆盖为 '小明'、'王老师' 等）
  // 支持环境变量 WECOM_GREETING_NAME 覆盖
  WECOM_GREETING_NAME: process.env.WECOM_GREETING_NAME || process.env.USER || '同事',

  // 企微通知去重文件路径
  NOTIFY_LOCK_FILE: path.join(__dirname, 'memory', 'notify_lock.json'),
};

// ===== 回复模板 =====
const TEMPLATE = {
  // 模板A：引导用户区分个人版/企业版（问题不明确 / 疑似个人版用户 / 外文）
  A: `您好，这里是腾讯文档企业版的官方反馈入口，请问您使用的是腾讯文档个人版（通过个人qq或微信登录）还是企业版呢？如您使用的是个人版，需点击该链接：https://docs.qq.com/home/feedback?src=1269 ，描述您具体遇到的使用问题，提供相关截图提交反馈。`,

  // 模板B：会员/退费/发票/开票（个人版相关付费问题）
  B: `您好，这里是腾讯文档企业版的官方反馈入口。关于您反馈的个人账号（个人微信/QQ）腾讯文档使用问题，可以点击该链接：https://docs.qq.com/home/feedback?src=1269 ，描述您具体遇到的使用问题，提供相关截图提交反馈，以便更好的为您核实。`,

  // 模板C：企微/企业微信/企微文档
  C: `您好，这里是腾讯文档企业版的官方反馈入口，关于您反馈的关于企微文档的问题，可以在企业微信中联系企微客服或企微小助手。`,
};

const KEYWORDS_B = ['会员', '退费', '发票', '开票', '充值', '付费', '订单', '退款', 'vip', 'VIP'];
const KEYWORDS_C = ['企微', '企业微信', '企微文档'];

// ===== OpenAPI config 便捷方法 =====
function getOpenAPIConfig() {
  return {
    secretId: CONFIG.AISEE_SECRET_ID,
    appId: CONFIG.AISEE_APP_ID,
    publicKey: CONFIG.AISEE_PUBLIC_KEY,
    userName: CONFIG.AISEE_USER_NAME,
  };
}

// ===== 工具函数 =====
const log  = msg => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
const warn = msg => console.warn(`[WARN] ${msg}`);

async function runBrowser(cmd, timeout = 30000) {
  const { stdout } = await execAsync(`${CONFIG.BROWSER} --profile "${CONFIG.BROWSER_PROFILE}" ${cmd}`, { timeout });
  return stdout.trim();
}

// ===== 静态服务管理（修复问题2+4：固定从 skill 目录启动）=====
async function ensureStaticServer() {
  log('🌐 检查静态服务...');
  try {
    // 查询 3399 端口的进程工作目录
    const { stdout: pidOut } = await execAsync(`lsof -i :${CONFIG.STATIC_PORT} | grep LISTEN | awk '{print $2}'`);
    const pid = pidOut.trim();

    if (pid) {
      // 检查工作目录是否是 skill 目录
      const { stdout: cwdOut } = await execAsync(`lsof -p ${pid} | grep cwd | awk '{print $NF}'`);
      const cwd = cwdOut.trim();
      if (cwd === CONFIG.SKILL_DIR) {
        log('✅ 静态服务已就绪（根目录正确）');
        return;
      }
      // 根目录不对，杀掉重启
      log(`⚠️ 静态服务根目录不对（${cwd}），重启中...`);
      await execAsync(`kill ${pid}`);
      await new Promise(r => setTimeout(r, 1000));
    }

    // 启动新的静态服务
    const child = spawn('npx', ['serve', '.', '-p', String(CONFIG.STATIC_PORT), '--no-clipboard'], {
      cwd: CONFIG.SKILL_DIR,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    await new Promise(r => setTimeout(r, 2000));
    log(`✅ 静态服务已启动，根目录：${CONFIG.SKILL_DIR}`);
  } catch(e) {
    warn('静态服务检查异常：' + e.message);
  }
}

// ===== 回复服务管理（端口 3400 reply_server.js，开机/重启后自动拉起）=====
async function ensureReplyServer() {
  log('🤖 检查回复服务...');
  try {
    // 探测端口是否在监听
    const { stdout: pidOut } = await execAsync(`lsof -i :${CONFIG.REPLY_PORT} | grep LISTEN | awk '{print $2}'`).catch(() => ({ stdout: '' }));
    const pid = pidOut.trim();

    if (pid) {
      // 额外确认进程的命令行确实是 reply_server.js，避免端口被别的进程占了
      try {
        const { stdout: cmd } = await execAsync(`ps -p ${pid} -o command= 2>/dev/null`);
        if (cmd.includes('reply_server.js')) {
          log('✅ 回复服务已就绪（' + CONFIG.REPLY_PORT + '）');
          return;
        }
        warn(`端口 ${CONFIG.REPLY_PORT} 被其他进程占用：${cmd.trim().slice(0, 80)}`);
        return;
      } catch (e) {
        // 忽略 ps 异常，按"已在跑"处理
        log('✅ 回复服务已就绪（' + CONFIG.REPLY_PORT + '）');
        return;
      }
    }

    // 启动 reply_server.js（脱离父进程，关掉 terminal 也能活）
    const logFile = '/tmp/aisee-reply-server.log';
    const out = fs.openSync(logFile, 'a');
    const err = fs.openSync(logFile, 'a');
    const child = spawn(process.execPath, [path.join(CONFIG.SKILL_DIR, 'reply_server.js')], {
      cwd: CONFIG.SKILL_DIR,
      detached: true,
      stdio: ['ignore', out, err],
      env: { ...process.env, PORT: String(CONFIG.REPLY_PORT) },
    });
    child.unref();
    // 等它起来
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 500));
      const { stdout: check } = await execAsync(`lsof -i :${CONFIG.REPLY_PORT} | grep LISTEN | awk '{print $2}'`).catch(() => ({ stdout: '' }));
      if (check.trim()) {
        log(`✅ 回复服务已启动（PID ${check.trim()}，端口 ${CONFIG.REPLY_PORT}，日志 ${logFile}）`);
        return;
      }
    }
    warn(`回复服务启动后未在 ${CONFIG.REPLY_PORT} 端口监听，请查看 ${logFile}`);
  } catch(e) {
    warn('回复服务检查异常：' + e.message);
  }
}

// ===== 知识库管理 =====
function getKnowledgeMeta() {
  if (!fs.existsSync(CONFIG.KNOWLEDGE_FILE)) return null;
  const raw = fs.readFileSync(CONFIG.KNOWLEDGE_FILE, 'utf8');
  const fetchedAt    = (raw.match(/fetched_at:\s*(.+)/)    || [])[1]?.trim();
  const refreshAfter = (raw.match(/refresh_after:\s*(.+)/) || [])[1]?.trim();
  const body = raw.replace(/^---[\s\S]*?---\n/, '');
  return { fetchedAt, refreshAfter, body };
}

function needsRefresh() {
  const meta = getKnowledgeMeta();
  if (!meta?.fetchedAt) return true;
  const deadline = new Date(meta.refreshAfter || new Date(meta.fetchedAt).getTime() + CONFIG.KNOWLEDGE_REFRESH_DAYS * 86400000);
  return new Date() > deadline;
}

async function refreshKnowledge() {
  log('📚 知识库已过期，重新获取多个文档源...');
  try {
    const docs = CONFIG.KNOWLEDGE_DOCS;
    const contents = [];
    for (const doc of docs) {
      try {
        const { stdout } = await execAsync(
          `${CONFIG.MCPORTER} call "tencent-docs" "get_content" --args '{"file_id":"${doc.id}"}'`,
          { timeout: 60000 }
        );
        const parsed = JSON.parse(stdout);
        const content = (parsed.content || '').trim();
        if (content) {
          contents.push(`### 📄 来源：${doc.title}\n> doc_id: ${doc.id}\n> url: ${doc.url}\n\n${content}`);
          log(`  ✅ ${doc.title}（${content.length}字）`);
        } else {
          warn(`  ⚠️ ${doc.title} 返回为空`);
        }
      } catch(e) {
        warn(`  ❌ ${doc.title} 获取失败：${e.message}`);
      }
    }

    if (contents.length === 0) throw new Error('所有文档获取均失败');

    const now = new Date();
    const refreshAfter = new Date(now.getTime() + CONFIG.KNOWLEDGE_REFRESH_DAYS * 86400000);
    const header = [
      '---',
      `sources:`,
      ...docs.map(d => `  - ${d.url}`),
      `fetched_at: ${now.toISOString().slice(0,19).replace('T',' ')}`,
      `refresh_after: ${refreshAfter.toISOString().slice(0,10)}`,
      `doc_count: ${docs.length}`,
      'title: 腾讯文档企业版-综合知识库',
      '---',
      '',
      '## ===== 标准回复模板规则（优先于功能指引内容匹配）=====',
      '',
      '### 模板A：默认回复',
      '**适用场景：** FAQ无匹配 / 问题不明确 / 疑似非企业版用户 / 外文误提交',
      '',
      `> ${TEMPLATE.A}`,
      '',
      '---',
      '',
      '### 模板B：会员/退费/发票/开票',
      '**触发关键词：** 会员、退费、发票、开票、充值、付费、订单、退款、vip',
      '',
      `> ${TEMPLATE.B}`,
      '',
      '---',
      '',
      '### 模板C：企微/企业微信/企微文档',
      '**触发关键词：** 企微、企业微信、企微文档',
      '',
      `> ${TEMPLATE.C}`,
      '',
      '---',
      '',
      '### 模板D：企业版功能性问题兜底',
      '**适用场景：** 问题明确（中文字符≥8），知识库无精准匹配',
      '',
      `> ${TEMPLATE.D}`,
      '',
      '---',
      '',
      '## ===== 匹配优先级说明 =====',
      '1. 先检查触发关键词：含「会员/退费/发票/开票」→ 模板B；含「企微/企业微信/企微文档」→ 模板C',
      '2. 可在功能指引中找到精准答案 → 按功能指引内容回答',
      '3. 问题明确（中文字符≥8）但知识库无匹配 → 模板D',
      '4. 无法匹配、问题不明确、外文 → 模板A（默认回复）',
      '',
      '## ===== 腾讯文档功能指引内容 =====',
      '',
    ].join('\n');

    const body = contents.join('\n\n---\n\n');
    fs.mkdirSync(CONFIG.MEMORY_DIR, { recursive: true });
    fs.writeFileSync(CONFIG.KNOWLEDGE_FILE, header + body, 'utf8');
    log(`✅ 知识库已更新（${contents.length}/${docs.length} 个文档），下次刷新：${refreshAfter.toISOString().slice(0,10)}`);
    return body;
  } catch(e) {
    warn(`知识库刷新失败：${e.message}，沿用缓存`);
    return getKnowledgeMeta()?.body || '';
  }
}

async function getKnowledge() {
  if (needsRefresh()) return await refreshKnowledge();
  log('📚 使用缓存知识库');
  return getKnowledgeMeta()?.body || '';
}

// ===== iOA 登录（修复问题3：浏览器已有 session 直接跳过，不触发手机验证）=====
async function ensureLogin() {
  log('🔐 检查 AiSee 登录状态...');
  try {
    await runBrowser(`open "${CONFIG.AISEE_LIST}"`);
    await new Promise(r => setTimeout(r, 3000));
    const url = (await runBrowser('eval "window.location.href"')).replace(/"/g, '');

    if (url.includes('aisee.woa.com/admin')) {
      log('✅ 已登录，直接继续');
      return true;
    }

    // 未登录：检查页面上是否有「发起验证」按钮
    log('⚠️ 检测到未登录，尝试自动触发验证...');
    await new Promise(r => setTimeout(r, 1500));
    const snap = await runBrowser('snapshot -i');
    const m = snap.match(/button "发起验证" \[ref=(e\d+)\]/);
    if (m) {
      await runBrowser(`click "${m[1]}"`);
      log('📱 已发起 iOA 推送，等待手机确认（最多60秒）...');
      // 每5秒轮询一次，最多等60秒
      for (let i = 0; i < 12; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const curUrl = (await runBrowser('eval "window.location.href"').catch(() => '')).replace(/"/g, '');
        if (curUrl.includes('aisee.woa.com/admin')) {
          log('✅ iOA 验证通过，登录成功');
          return true;
        }
        log(`⏳ 等待中... (${(i+1)*5}s)`);
      }
      log('❌ iOA 验证超时，请手动登录后重试');
      return false;
    } else {
      log('⚠️ 未找到「发起验证」按钮，请检查页面状态');
      return false;
    }
  } catch(e) {
    warn('登录检查异常：' + e.message);
    return false;
  }
}

// ===== 抓取反馈列表 =====
async function fetchFeedback() {
  log('📋 抓取 AiSee 反馈列表...');
  await runBrowser(`open "${CONFIG.AISEE_LIST}"`);
  await new Promise(r => setTimeout(r, 2000));

  const raw = await runBrowser(`eval "JSON.stringify(Array.from(document.querySelectorAll('table tbody tr[data-row-key]')).map(tr=>{const fid=tr.getAttribute('data-row-key');const q=(tr.querySelector('td:nth-child(2) > div:first-child')||{}).innerText||'';const st=(tr.querySelector('td:nth-child(5)')||{}).innerText||'';const t=(tr.querySelector('td:nth-child(6)')||{}).innerText||'';return{fid,question:q.trim().split('\\n')[0],status:st.trim(),time:t.trim()}}).filter(i=>i.fid&&i.question))"`);

  try {
    let parsed = JSON.parse(raw);
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
    const list = Array.isArray(parsed) ? parsed : [];
    log(`✅ 获取 ${list.length} 条反馈`);
    return list;
  } catch(e) {
    warn('解析反馈列表失败：' + e.message);
    warn('原始内容片段：' + String(raw).slice(0, 200));
    return [];
  }
}

// ===== 生成回复（分两阶段：第一阶段关键词命中，第二阶段交AI生成）=====
// 第一阶段：关键词明确命中 → 直接使用模板；其余标记 needsAI
// needsTag：问题中含「企业版」关键词，回复时需给反馈打「企业版问题」标签
function generateReply(question) {
  // 是否需要打企业版标签
  const needsTag = question.includes('企业版');

  // 优先级1：模板C（企微相关）
  if (KEYWORDS_C.some(k => question.includes(k))) {
    return { answer: TEMPLATE.C, tag: 'fixed', tagLabel: '企微问题 → 模板C', needsAI: false, needsTag };
  }
  // 优先级2：模板B（会员/发票）
  if (KEYWORDS_B.some(k => question.includes(k))) {
    return { answer: TEMPLATE.B, tag: 'fixed', tagLabel: '会员/发票 → 模板B', needsAI: false, needsTag };
  }
  // 优先级3：问题不明确 / 外文 → 模板A
  const chineseChars = (question.match(/[\u4e00-\u9fa5]/g) || []).length;
  if (chineseChars < 4) {
    return { answer: TEMPLATE.A, tag: 'fixed', tagLabel: '无法匹配 → 模板A', needsAI: false, needsTag };
  }
  // 其余：标记为需要 AI 生成回复（answer 留空占位，由 AI 在第二阶段填充）
  return { answer: '', tag: 'ai', tagLabel: '⏳ 待AI生成回复', needsAI: true, needsTag };
}

// ===== 企微通知去重（修复问题6：同一天同批次只推一次）=====
function hasNotifiedToday(targetDate) {
  try {
    if (!fs.existsSync(CONFIG.NOTIFY_LOCK_FILE)) return false;
    const lock = JSON.parse(fs.readFileSync(CONFIG.NOTIFY_LOCK_FILE, 'utf8'));
    return lock.date === targetDate;
  } catch(e) { return false; }
}

function markNotified(targetDate) {
  try {
    fs.mkdirSync(CONFIG.MEMORY_DIR, { recursive: true });
    fs.writeFileSync(CONFIG.NOTIFY_LOCK_FILE, JSON.stringify({ date: targetDate, notifiedAt: new Date().toISOString() }), 'utf8');
  } catch(e) { warn('写入通知锁失败：' + e.message); }
}

// ===== 生成 HTML（含 localStorage 落盘）=====
function buildHTML(items, targetDate) {
  const dataJson = JSON.stringify(items, null, 0);
  const now = new Date().toLocaleString('zh-CN');
  const port = CONFIG.REPLY_PORT;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>腾讯文档｜Aisee AI 小助手 · ${targetDate}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  @keyframes fadeInUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
  @keyframes sp{to{transform:rotate(360deg)}}
  :root{--primary:#3370FF;--primary-light:#99CAFF;--accent:#5B9BFF;--muted:#94a3b8;--green:#22c55e;--orange:#f59e0b;--red:#ef4444;--card:rgba(255,255,255,.65);--card-border:rgba(255,255,255,.45);--text:#1e293b;--sub:#64748b;--border:#d8dff0;--r:24px;--shadow:0 8px 32px rgba(31,38,135,.08);--blur:blur(20px)}
  body{font-family:"Inter",-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif;background:#F4FAFF;color:var(--text);min-height:100vh;padding:0;-webkit-font-smoothing:antialiased;overflow-x:hidden}
  body::before{content:'';position:fixed;inset:0;background:linear-gradient(160deg,#F4FAFF 0%,#f0f5ff 25%,#F4FAFF 50%,#E6F4F1 75%,#F4FAFF 100%);z-index:-3}
  body::after{content:'';position:fixed;inset:0;background:repeating-linear-gradient(135deg,transparent,transparent 100px,rgba(43,94,255,.015) 100px,rgba(43,94,255,.015) 101px);z-index:-2;pointer-events:none}
  .bg-orb{position:fixed;border-radius:50%;filter:blur(80px);opacity:.35;z-index:-1;pointer-events:none}
  .bg-orb-1{width:500px;height:500px;background:radial-gradient(circle,#d4e6ff,transparent 70%);top:-100px;right:-100px}
  .bg-orb-2{width:400px;height:400px;background:radial-gradient(circle,#d4e6ff,transparent 70%);bottom:10%;left:-80px}
  .bg-orb-3{width:300px;height:300px;background:radial-gradient(circle,#E6F4F1,transparent 70%);top:40%;right:10%}

  .page-wrap{max-width:100%;margin:0 auto;padding:0 8px 40px;animation:fadeInUp .6s ease}

  .header{background:var(--card);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);border:1px solid var(--card-border);color:var(--text);padding:16px 28px;margin:16px 0;border-radius:var(--r);box-shadow:var(--shadow);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;position:sticky;top:12px;z-index:20}
  .header-left{display:flex;align-items:center;gap:14px;min-width:0}
  .header-logo{height:36px;flex-shrink:0}
  .header-title-wrap{min-width:0;display:flex;flex-direction:column;gap:3px}
  .app-brand-line{display:flex;align-items:center;gap:8px;min-width:0;white-space:nowrap}
  .header-brand{font-size:20px;font-weight:800;color:var(--text);letter-spacing:-.3px;white-space:nowrap;line-height:1.15}
  .header-divider{width:1.5px;height:24px;background:var(--border);opacity:.65;flex-shrink:0}
  .app-name{font-size:18px;font-weight:800;color:var(--text);letter-spacing:-.3px;white-space:nowrap;line-height:1.15}
  .header h1{font-size:15px;font-weight:600;color:var(--text);letter-spacing:-.1px}
  .header p{font-size:11px;color:var(--sub);margin-top:1px;font-weight:400}
  .header-action{display:flex;align-items:center}
  .srv{display:inline-flex;align-items:center;gap:6px;margin-left:12px}
  .dot{width:7px;height:7px;border-radius:50%;background:#fbbf24;transition:all .3s}
  .dot.ok{background:var(--green);box-shadow:0 0 8px rgba(34,197,94,.4)}
  .dot.err{background:var(--red);box-shadow:0 0 8px rgba(239,68,68,.4)}
  .srv-lbl{font-size:11px;color:var(--sub);font-weight:500}

  .stats{display:flex;gap:12px;margin:20px 0 16px;flex-wrap:wrap}
  .stat{background:var(--card);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);border:1px solid var(--card-border);border-radius:var(--r);padding:24px 16px;flex:1;min-width:100px;text-align:center;box-shadow:var(--shadow);transition:transform .25s,box-shadow .25s;animation:fadeInUp .5s ease both}
  .stat:nth-child(1){animation-delay:.05s}.stat:nth-child(2){animation-delay:.1s}.stat:nth-child(3){animation-delay:.15s}.stat:nth-child(4){animation-delay:.2s}
  .stat:hover{transform:translateY(-4px);box-shadow:0 12px 40px rgba(31,38,135,.12)}
  .stat .n{font-size:36px;font-weight:800;letter-spacing:-.5px;line-height:1;background:linear-gradient(135deg,#3370FF,#5B9BFF);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
  .stat .l{font-size:10px;color:var(--sub);margin-top:8px;text-transform:uppercase;letter-spacing:1.5px;font-weight:600}

  .prog-wrap{margin:0 0 16px}
  .prog-bar{height:4px;background:rgba(255,255,255,.5);border-radius:2px;overflow:hidden;backdrop-filter:var(--blur)}
  .prog-fill{height:100%;background:linear-gradient(90deg,#3370FF,#5B9BFF);border-radius:2px;transition:width .6s cubic-bezier(.4,0,.2,1)}
  .prog-lbl{font-size:11px;color:var(--sub);margin-top:6px;text-align:right;font-weight:500}

  .cards{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .card{background:var(--card);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);border:1px solid var(--card-border);border-radius:var(--r);box-shadow:var(--shadow);overflow:hidden;transition:transform .25s,box-shadow .25s,border-color .25s;animation:fadeInUp .5s ease both}
  .card:last-child:nth-child(odd){grid-column:1 / -1}
  .card:nth-child(1){animation-delay:.1s}.card:nth-child(2){animation-delay:.2s}.card:nth-child(3){animation-delay:.3s}.card:nth-child(4){animation-delay:.4s}.card:nth-child(5){animation-delay:.5s}
  .card:hover{transform:translateY(-4px);box-shadow:0 16px 48px rgba(31,38,135,.1)}
  .card.sending{border-color:rgba(51,112,255,.35);box-shadow:0 0 0 3px rgba(51,112,255,.1),var(--shadow)}
  .card.done{border-color:rgba(34,197,94,.25);background:rgba(240,253,244,.7)}
  .card.err-card{border-color:rgba(239,68,68,.25)}

  .ch{display:flex;align-items:flex-start;gap:14px;padding:22px 26px 16px;border-bottom:1px solid rgba(216,223,240,.4)}
  .card.done .ch{border-color:rgba(187,247,208,.5)}
  .badge{flex-shrink:0;width:32px;height:32px;border-radius:12px;background:linear-gradient(135deg,#3370FF,#5B9BFF);color:#fff;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(51,112,255,.25)}
  .card.done .badge{background:linear-gradient(135deg,#86EFAC,var(--green));box-shadow:0 4px 12px rgba(34,197,94,.15)}
  .qb{flex:1}
  .qt{font-size:14px;font-weight:600;line-height:1.55;margin-bottom:8px;color:var(--text)}
  .tag{display:inline-block;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:600;backdrop-filter:blur(8px)}
  .tag-guide{background:rgba(240,245,255,.8);color:var(--primary)}
  .tag-fixed{background:rgba(254,243,199,.8);color:#92400e}
  .tag-ai{background:rgba(244,250,255,.8);color:#5B9BFF}
  .cs{flex-shrink:0;font-size:13px;font-weight:600}
  .cs.p{color:var(--muted)}.cs.s{color:var(--primary)}.cs.d{color:var(--green)}.cs.e{color:var(--red)}

  .cb{padding:18px 26px 22px}
  .albl{font-size:10px;font-weight:600;color:var(--sub);letter-spacing:1px;margin-bottom:10px;display:flex;align-items:center;gap:6px;text-transform:uppercase}
  .hint{font-size:11px;color:#5B9BFF;background:rgba(244,250,255,.7);padding:3px 10px;border-radius:20px;font-weight:500;text-transform:none;letter-spacing:0}

  textarea.ae{width:100%;min-height:100px;max-height:260px;border:1px solid rgba(216,223,240,.5);border-radius:16px;padding:16px 18px;font-size:13.5px;line-height:1.75;color:var(--text);font-family:inherit;resize:vertical;background:rgba(255,255,255,.5);backdrop-filter:blur(8px);outline:none;transition:border-color .2s,box-shadow .2s}
  textarea.ae:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgba(43,94,255,.08);background:rgba(255,255,255,.8)}
  .card.done textarea.ae{background:rgba(240,253,244,.5);border-color:rgba(187,247,208,.5);color:#475569;pointer-events:none;resize:none}

  .cf{padding:0 26px 22px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
  .cc{font-size:12px;color:var(--sub)}.cc.warn{color:var(--orange)}

  .btn{display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,#3370FF,#5B9BFF);color:#fff;border:none;border-radius:14px;padding:10px 22px;font-size:13px;font-weight:600;cursor:pointer;transition:all .25s;box-shadow:0 4px 16px rgba(51,112,255,.25);white-space:nowrap}
  .btn:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 8px 28px rgba(51,112,255,.3)}
  .btn:active:not(:disabled){transform:translateY(0);box-shadow:0 2px 8px rgba(43,94,255,.15)}
  .btn:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}
  .btn.sb{animation:pulse 1.2s infinite}
  .btn.db{background:linear-gradient(135deg,#34d399,var(--green));cursor:default;box-shadow:0 4px 16px rgba(34,197,94,.2)}
  .btn.rb{background:linear-gradient(135deg,#f87171,var(--red));box-shadow:0 4px 16px rgba(239,68,68,.2)}

  .spin{width:14px;height:14px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:sp .7s linear infinite}
  .errmsg{font-size:12px;color:var(--red);background:rgba(254,242,242,.8);border:1px solid rgba(254,202,202,.5);border-radius:12px;padding:10px 14px;margin-top:8px;backdrop-filter:blur(8px)}

  .toast{position:fixed;bottom:28px;right:24px;min-width:260px;max-width:360px;background:rgba(30,41,59,.9);backdrop-filter:var(--blur);color:#f8fafc;padding:14px 20px;border-radius:20px;font-size:14px;font-weight:500;box-shadow:0 16px 48px rgba(0,0,0,.15);z-index:9999;opacity:0;transform:translateY(16px) scale(.96);transition:all .35s cubic-bezier(.4,0,.2,1);display:flex;align-items:center;gap:10px}
  .toast.show{opacity:1;transform:translateY(0) scale(1)}

  .empty{text-align:center;padding:80px 20px;color:var(--sub)}
  .empty .ei{font-size:48px;margin-bottom:16px}
  .empty h3{font-size:20px;font-weight:700;margin-bottom:8px;letter-spacing:-.3px}

  .batch-bar{padding:16px 8px;margin-top:20px;display:flex;align-items:center;justify-content:flex-end;gap:12px;flex-wrap:wrap-reverse;position:sticky;bottom:16px;z-index:10}
  .btn-all{background:linear-gradient(135deg,#3370FF,#5B9BFF);color:#fff;border:none;border-radius:16px;padding:13px 30px;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 6px 24px rgba(51,112,255,.3);transition:all .25s;white-space:nowrap}
  .btn-all:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 10px 36px rgba(51,112,255,.35)}
  .btn-all:active:not(:disabled){transform:translateY(0)}
  .btn-all:disabled{opacity:.35;cursor:not-allowed;background:var(--muted);box-shadow:none;transform:none}
  .batch-hint{font-size:11px;color:var(--sub);text-align:right}

  .tag-ent{display:inline-flex;align-items:center;gap:3px;background:rgba(254,243,199,.8);color:#92400e;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:600;margin-left:6px;border:none;backdrop-filter:blur(8px)}

  /* ===== Mobile responsive (iOS / Android) ===== */
  @media(max-width:768px){
    .page-wrap{padding:0 6px 100px}
    .header{flex-direction:column;align-items:flex-start;gap:10px;padding:14px 16px;margin:8px 0;border-radius:18px;position:relative;top:0}
    .header-action{display:none}
    .header-left{flex-wrap:nowrap;gap:8px;width:100%;overflow:hidden}
    .header-logo{height:28px}
    .header-title-wrap{min-width:0;flex:1;overflow:hidden}
    .app-brand-line{gap:6px;max-width:100%;overflow:hidden}
    .header-brand{font-size:15px;flex-shrink:0}
    .header-divider{height:16px;flex-shrink:0}
    .app-name{font-size:15px;min-width:0;overflow:hidden;text-overflow:ellipsis}
    .header p{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%}
    .stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px 0 10px}
    .stat{min-width:0;width:100%;padding:18px 12px;border-radius:18px}
    .stat .n{font-size:28px}
    .stat .l{font-size:9px;letter-spacing:1px}
    .cards{grid-template-columns:1fr;gap:10px}
    .card:last-child:nth-child(odd){grid-column:auto}
    .card{border-radius:18px}
    .ch{padding:16px 16px 12px;gap:10px}
    .badge{width:28px;height:28px;border-radius:10px;font-size:12px}
    .qt{font-size:13px}
    .cb{padding:12px 16px 16px}
    textarea.ae{border-radius:12px;padding:12px 14px;font-size:13px;min-height:80px}
    .cf{padding:0 16px 16px}
    .btn{border-radius:12px;padding:9px 18px;font-size:12px}
    .mobile-batch{display:flex;position:fixed;bottom:0;left:0;right:0;padding:12px 16px;padding-bottom:calc(12px + env(safe-area-inset-bottom));background:rgba(255,255,255,.85);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-top:1px solid rgba(216,223,240,.5);z-index:30;justify-content:center}
    .mobile-batch .btn-all{width:100%;text-align:center;justify-content:center;border-radius:14px;padding:14px 20px;font-size:16px}
  }
  @media(min-width:769px){
    .mobile-batch{display:none}
  }
</style>
</head>
<body>
<div class="bg-orb bg-orb-1"></div><div class="bg-orb bg-orb-2"></div><div class="bg-orb bg-orb-3"></div>
<div class="page-wrap">
<div class="header">
  <div class="header-left">
    <img class="header-logo" src="data:image/png;base64,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" alt="腾讯文档">
    <div class="header-title-wrap">
      <div class="app-brand-line">
        <span class="header-brand">腾讯文档</span>
        <div class="header-divider"></div>
        <span class="app-name">Aisee AI 小助手</span>
      </div>
      <p>生成于 ${now} <span class="srv"><span class="dot" id="dot"></span><span class="srv-lbl" id="srv-lbl">检查服务中...</span></span></p>
    </div>
  </div>
  <div class="header-action">
    <button class="btn-all" id="btn-all" onclick="replyAll()">🚀 一键全部回复（剩余 <span id="remain">0</span> 条）</button>
  </div>
</div>
<div class="stats">
  <div class="stat"><div class="n" style="color:var(--primary)" id="s-total">-</div><div class="l">总条数</div></div>
  <div class="stat"><div class="n" style="color:var(--green)" id="s-done">0</div><div class="l">已回复</div></div>
  <div class="stat"><div class="n" style="color:var(--primary)" id="s-pending">-</div><div class="l">待回复</div></div>
  <div class="stat"><div class="n" style="color:var(--red)" id="s-err">0</div><div class="l">失败</div></div>
</div>
<div class="prog-wrap">
  <div class="prog-bar"><div class="prog-fill" id="prog"></div></div>
  <div class="prog-lbl" id="prog-lbl">0 / - 已回复</div>
</div>
<div class="cards" id="cards"></div>
<div class="toast" id="toast"><span id="ti">✅</span><span id="tm"></span></div>
<script src="https://cdn.jsdelivr.net/npm/jsencrypt@3.3.2/bin/jsencrypt.min.js"></script>
<script>
// ===== AiSee OpenAPI 前端直调配置 =====
const AISEE_CONFIG={
  secretId:'${CONFIG.AISEE_SECRET_ID}',
  appId:'${CONFIG.AISEE_APP_ID}',
  publicKey:'${CONFIG.AISEE_PUBLIC_KEY}',
  userName:'${CONFIG.AISEE_USER_NAME}',
  apiBase:'https://api.tone.woa.com/aisee/v1/openapi'
};

function makeSign(){
  const ts=Math.floor(Date.now()/1000).toString();
  const raw='Secret-Id='+AISEE_CONFIG.secretId+'&App-Id='+AISEE_CONFIG.appId+'&Timestamp='+ts;
  const enc=new JSEncrypt();
  enc.setPublicKey('-----BEGIN PUBLIC KEY-----\\n'+AISEE_CONFIG.publicKey+'\\n-----END PUBLIC KEY-----');
  const sign=enc.encrypt(encodeURIComponent(raw));
  return{ts,sign};
}

async function apiPost(path,body){
  const{ts,sign}=makeSign();
  const r=await fetch(AISEE_CONFIG.apiBase+path,{
    method:'POST',
    headers:{'Secret-Id':AISEE_CONFIG.secretId,'App-Id':AISEE_CONFIG.appId,'Timestamp':ts,'Sign':sign,'Content-Type':'application/json'},
    body:JSON.stringify(body)
  });
  return r.json();
}

async function sendReply(fid,content,userId){
  return apiPost('/sendFeedbackReply',{fid,content,user_id:userId,user_name:AISEE_CONFIG.userName,create_time:String(Date.now()),remark:'回复',replyContentType:0});
}

const data=${dataJson};

// ===== localStorage 落盘（key 绑定当日 fid 指纹）=====
const SKEY='aisee_'+btoa(data.map(d=>d.fid).join(',')).slice(0,16);
function loadStates(){
  try{
    const s=JSON.parse(localStorage.getItem(SKEY)||'[]');
    return data.map((_,i)=>{
      const x=s[i];
      if(!x)return{st:'pending',err:''};
      return{st:x.st==='done'?'done':x.st==='error'?'error':'pending',err:x.err||''};
    });
  }catch(e){return data.map(()=>({st:'pending',err:''}));}
}
function saveStates(){try{localStorage.setItem(SKEY,JSON.stringify(states));}catch(e){}}
const states=loadStates();

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function render(){
  const c=document.getElementById('cards');
  if(!data.length){
    c.innerHTML='<div class="empty"><div class="ei">🎉</div><h3>暂无未回复问题</h3><p>所有反馈均已回复完毕！</p></div>';
    ['s-total','s-pending'].forEach(id=>document.getElementById(id).textContent='0');
    document.getElementById('prog-lbl').textContent='全部已回复';
    return;
  }
  c.innerHTML='';
  data.forEach((item,i)=>{
    const s=states[i],isDone=s.st==='done',dis=s.st==='sending'||isDone;
    const statusMap={
      pending:'<span class="cs p">待回复</span>',
      sending:'<span class="cs s"><span class="spin" style="display:inline-block;vertical-align:middle;margin-right:4px"></span>回复中...</span>',
      done:'<span class="cs d">✅ 已回复</span>',
      error:'<span class="cs e">❌ 失败</span>'
    };
    const btnMap={
      pending:'<button class="btn" onclick="go('+i+')">✓ 确认并回复</button>',
      sending:'<button class="btn sb" disabled><span class="spin"></span> 回复中...</button>',
      done:'<button class="btn db" disabled>✅ 已回复</button>',
      error:'<button class="btn rb" onclick="go('+i+')">↺ 重试</button>'
    };
    const el=document.createElement('div');
    el.className='card'+(s.st==='sending'?' sending':'')+(isDone?' done':'')+(s.st==='error'?' err-card':'');
    el.id='card-'+i;
    el.innerHTML=\`
      <div class="ch">
        <div class="badge">\${i+1}</div>
        <div class="qb">
          <div class="qt">\${esc(item.question)}</div>
          <span class="tag tag-\${item.tag}">\${esc(item.tagLabel)}</span>
          \${item.needsTag?'<span class="tag-ent">🏷️ 将自动打标签：企业版问题</span>':''}
        </div>
        \${statusMap[s.st]}
      </div>
      <div class="cb">
        <div class="albl">📝 建议回复内容 \${!isDone?'<span class="hint">✏️ 可直接编辑修改</span>':''}</div>
        <textarea class="ae" id="ed-\${i}" rows="5" \${dis?'disabled':''} oninput="uc(\${i})">\${esc(item.answer)}</textarea>
        \${s.err?'<div class="errmsg">⚠️ '+esc(s.err)+'</div>':''}
      </div>
      <div class="cf">
        <span class="cc" id="cc-\${i}">\${item.answer.length} 字</span>
        \${btnMap[s.st]}
      </div>\`;
    c.appendChild(el);
  });
  stats();
}

function uc(i){const ta=document.getElementById('ed-'+i),cc=document.getElementById('cc-'+i);if(!ta||!cc)return;const l=ta.value.length;cc.textContent=l+' 字';cc.className='cc'+(l>800?' warn':'');data[i].answer=ta.value;}

function stats(){
  const done=states.filter(s=>s.st==='done').length,err=states.filter(s=>s.st==='error').length;
  const remain=data.length-done;
  document.getElementById('s-total').textContent=data.length;
  document.getElementById('s-done').textContent=done;
  document.getElementById('s-pending').textContent=remain;
  document.getElementById('s-err').textContent=err;
  document.getElementById('prog').style.width=(data.length?done/data.length*100:0)+'%';
  document.getElementById('prog-lbl').textContent=done+' / '+data.length+' 已回复';
  const rEl=document.getElementById('remain');if(rEl)rEl.textContent=remain;
  const btnAll=document.getElementById('btn-all');if(btnAll){btnAll.disabled=(remain===0);if(remain===0){btnAll.textContent='🎉 全部已回复';}}
  const rElM=document.getElementById('remain-m');if(rElM)rElM.textContent=remain;
  const btnAllM=document.getElementById('btn-all-m');if(btnAllM){btnAllM.disabled=(remain===0);if(remain===0){btnAllM.textContent='🎉 全部已回复';}}
}

async function go(i){
  const ta=document.getElementById('ed-'+i);
  const ans=ta?ta.value.trim():data[i].answer;
  if(!ans){toast('回复内容不能为空','w');return;}
  states[i]={st:'sending',err:''};render();
  try{
    const j=await sendReply(data[i].fid,ans,data[i].user_id||'anonymous');
    if(j.code&&j.code!==0&&j.code!==200) throw new Error(j.message||j.msg||'API错误:'+j.code);
    states[i]={st:'done',err:''};saveStates();toast('第'+(i+1)+'条已成功回复 ✅','ok');
  }catch(e){states[i]={st:'error',err:e.message};saveStates();toast('第'+(i+1)+'条失败：'+e.message,'e');}
  render();
}

// ===== 一键全部回复：依次执行所有「待回复」或「失败」状态的条目 =====
let allRunning=false;
async function replyAll(){
  if(allRunning)return;
  const targets=[];
  for(let i=0;i<data.length;i++){
    if(states[i].st!=='done'&&states[i].st!=='sending')targets.push(i);
  }
  if(targets.length===0){toast('没有待回复的条目','w');return;}
  if(!confirm('即将依次回复 '+targets.length+' 条反馈，过程中请勿关闭页面。确认继续？'))return;
  allRunning=true;
  const btnAll=document.getElementById('btn-all');
  btnAll.disabled=true;btnAll.textContent='⏳ 正在批量回复 0/'+targets.length;
  let ok=0,fail=0;
  for(let k=0;k<targets.length;k++){
    const i=targets[k];
    btnAll.textContent='⏳ 正在批量回复 '+(k+1)+'/'+targets.length;
    try{
      await go(i);
      if(states[i].st==='done')ok++;else fail++;
    }catch(e){fail++;}
    // 每条之间等 1 秒，避免服务端压力
    await new Promise(r=>setTimeout(r,1000));
  }
  allRunning=false;
  toast('批量完成：成功 '+ok+' 条，失败 '+fail+' 条',fail?'w':'ok');
  render();
}

function toast(msg,type='ok'){
  const icons={ok:'✅',w:'⚠️',e:'❌'};
  document.getElementById('ti').textContent=icons[type]||'💬';
  document.getElementById('tm').textContent=msg;
  const t=document.getElementById('toast');t.className='toast show';
  setTimeout(()=>t.className='toast',3500);
}

async function chkSrv(){
  const dot=document.getElementById('dot'),lbl=document.getElementById('srv-lbl');
  try{
    const{ts,sign}=makeSign();
    const r=await fetch(AISEE_CONFIG.apiBase+'/getFeedbacks',{method:'POST',headers:{'Secret-Id':AISEE_CONFIG.secretId,'App-Id':AISEE_CONFIG.appId,'Timestamp':ts,'Sign':sign,'Content-Type':'application/json'},body:JSON.stringify({beginTime:String(Date.now()-3600000),endTime:String(Date.now()),curPage:1,pageSize:1})});
    if(r.ok){dot.className='dot ok';lbl.textContent='OpenAPI 已连接';}
    else throw new Error();
  }catch{dot.className='dot err';lbl.textContent='需办公网访问';}
}

render();chkSrv();setInterval(chkSrv,15000);
</script>
</div><!-- page-wrap -->
<div class="mobile-batch">
  <button class="btn-all" id="btn-all-m" onclick="replyAll()">🚀 一键全部回复（剩余 <span id="remain-m">0</span> 条）</button>
</div>
</body>
</html>`;
}

// ===== 企业微信通知 =====
async function sendWecom(url, count, targetDate) {
  if (!CONFIG.WECOM_WEBHOOK) { warn('未配置企微 Webhook，跳过通知'); return; }

  // ===== 值班表自动 @当天值班人 =====
  const dayOfWeek = new Date().getDay(); // 0=周日, 1=周一...
  const duty = CONFIG.DUTY_ROSTER[dayOfWeek];
  const mentionStr = duty ? `<@${duty.userid}>\n\n` : '';
  const dutyName = duty ? duty.name : '同事';

  const hour = new Date().getHours();
  const timeGreet = hour < 11 ? '早上好' : (hour < 14 ? '中午好' : (hour < 18 ? '下午好' : '晚上好'));
  const openers = [
    `🌸 **${dutyName} ${timeGreet}！今天也是元气满满的一天，每一条回复都是对用户最好的照见～** 💪`,
    `☀️ **${dutyName} ${timeGreet}！AiSee AI小助手已为你整理好今日待办，一起高效开启一天吧～** ✨`,
    `🎯 **${dutyName} ${timeGreet}！用户的每一条反馈都值得被温柔对待，我们来搞定它们～** 💖`,
    `🍀 **${dutyName} ${timeGreet}！今天也要做被用户认可的客服明星哦～** 🌟`,
    `🌈 **${dutyName} ${timeGreet}！AI 已经把初稿备好，你只需要优雅地点确认～** 🫶`,
  ];
  const opener = openers[Math.floor(Math.random() * openers.length)];

  const body = JSON.stringify({
    msgtype: 'markdown',
    markdown: {
      content:
        mentionStr +
        opener + '\n\n' +
        `📋 **${targetDate} AiSee 反馈待回复清单已就绪**\n\n` +
        `> 共有 **${count}** 条用户反馈等待回复，AI 已根据腾讯文档功能指引准备好了答案 ✨\n\n` +
        `🔗 [点击打开回复工具](${url})\n\n` +
        `_改完答案可点「确认并回复」逐条提交，也可点「🚀 一键全部回复」批量搞定～ 🎯_`
    }
  });

  const u = new URL(CONFIG.WECOM_WEBHOOK);
  const mod = u.protocol === 'https:' ? https : http;
  return new Promise(resolve => {
    const req = mod.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { log('✅ 企微通知已发送：' + d); resolve(d); });
    });
    req.on('error', e => { warn('企微通知失败：' + e.message); resolve(null); });
    req.write(body);
    req.end();
  });
}

// ===== 主流程 =====
async function main() {
  const args = process.argv.slice(2);
  const today = new Date().toISOString().slice(0, 10);
  const targetDate = args[0] || today;  // 仅用于通知和HTML标题，不用于数据过滤
  const authMode = CONFIG.AISEE_AUTH_MODE;

  log('🚀 AiSee 反馈自动回复工具启动');
  log(`📅 运行日期：${targetDate}（抓取所有未回复问题）`);
  log(`🔑 认证模式：${authMode.toUpperCase()}`);

  // 0. 确保静态服务从 skill 目录启动
  await ensureStaticServer();

  // 1. 知识库
  const knowledge = await getKnowledge();

  let unreplied;

  if (authMode === 'openapi') {
    // ===== OpenAPI 模式：无需浏览器，直接 HTTP 调用 =====
    log('🔐 OpenAPI 模式：跳过浏览器登录');
    const apiConfig = getOpenAPIConfig();

    try {
      // 拉取近30天未回复的反馈
      const now = Date.now();
      const data = await openapi.getFeedbacks(apiConfig, {
        beginTime: String(now - 30 * 24 * 3600 * 1000),
        endTime: String(now),
        reply_status: 0,  // 待回复
        pageSize: 100,
      });

      const feedbacks = (data.feedbacks || []).map(f => ({
        fid: f.id,
        question: (f.msg || '').trim(),
        status: '待首次回复',
        time: f.create_time ? new Date(Number(f.create_time)).toISOString().replace('T', ' ').slice(0, 19) : '',
        user_id: f.user_id || '',  // OpenAPI 回复时需要
      }));

      log(`✅ OpenAPI 获取 ${feedbacks.length} 条待回复反馈（共 ${data.total || feedbacks.length} 条）`);
      unreplied = feedbacks.filter(f => f.question);
    } catch (e) {
      log('❌ OpenAPI 调用失败：' + e.message);
      log('💡 提示：检查 Secret-Id / 公钥 / App-Id 是否正确，Sign 有 3 分钟有效期');
      process.exit(1);
    }
  } else {
    // ===== Cookie 模式（旧）：通过浏览器登录 + DOM 抓取 =====
    const loggedIn = await ensureLogin();
    if (!loggedIn) {
      log('❌ 登录失败，退出'); process.exit(1);
    }

    const all = await fetchFeedback();
    unreplied = all.filter(item => {
      if (process.env.DEBUG_ALL === '1') return true;
      return item.status === '待首次回复';
    });
    log(`📝 待回复：${unreplied.length} 条（共扫描 ${all.length} 条）`);
  }

  // 4. 第一阶段：关键词命中生成回复，其余标记 needsAI
  const items = unreplied.map(item => {
    const { answer, tag, tagLabel, needsAI, needsTag } = generateReply(item.question);
    return { ...item, answer, tag, tagLabel, needsAI, needsTag };
  });

  const aiNeeded = items.filter(i => i.needsAI);
  const fixedCount = items.length - aiNeeded.length;
  log(`📝 关键词命中 ${fixedCount} 条，需AI生成 ${aiNeeded.length} 条`);

  // 输出待 AI 回复的问题到 pending_ai.json（供 AI 读取并填充）
  const pendingFile = path.join(__dirname, 'output', 'pending_ai.json');
  fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });
  fs.writeFileSync(pendingFile, JSON.stringify(items, null, 2), 'utf8');
  log(`✅ 问题列表已输出：${pendingFile}`);
  log(`⏳ 等待 AI 填充 ${aiNeeded.length} 条回复后，调用 node run.js --build 生成 HTML`);

  // 返回数据，供外部（AI）使用
  return { items, targetDate, pendingFile, aiNeededCount: aiNeeded.length };
}

// ===== 第二阶段：从 AI 填充后的 JSON 生成 HTML 并推送 =====
async function buildAndNotify(targetDate) {
  const pendingFile = path.join(__dirname, 'output', 'pending_ai.json');
  if (!fs.existsSync(pendingFile)) {
    log('❌ 未找到 pending_ai.json，请先运行 node run.js 抓取问题');
    process.exit(1);
  }

  const items = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
  const empty = items.filter(i => !i.answer || i.answer.trim() === '');
  if (empty.length > 0) {
    warn(`❌ 还有 ${empty.length} 条回复为空，HTML 将生成但企微通知跳过。请先完成 AI 回复填充`);
    // 仍生成 HTML 以便查看，但不推送企微
    const docsHtml = path.join(__dirname, 'docs', 'index.html');
    fs.writeFileSync(docsHtml, buildHTML(items, targetDate), 'utf8');
    log(`✅ docs/index.html 已更新`);
    return;
  }

  // 确保静态服务
  await ensureStaticServer();
  // 确保回复服务（关键：否则工具页里点提交会 Load failed）
  await ensureReplyServer();

  // 生成 HTML
  fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });
  const html = buildHTML(items, targetDate);
  fs.writeFileSync(CONFIG.HTML_OUT, html, 'utf8');
  log(`✅ HTML 工具已生成：${CONFIG.HTML_OUT}`);

  // ===== 同步到 GitHub Pages =====
  const docsHtml = path.join(__dirname, 'docs', 'index.html');
  fs.writeFileSync(docsHtml, html, 'utf8');
  try {
    execSync('git add docs/index.html', { cwd: __dirname, stdio: 'ignore' });
    execSync(`git commit -m "回复工具 ${targetDate}: ${items.length}条反馈处理完毕"`, { cwd: __dirname, stdio: 'ignore' });
    execSync('git push origin main', { cwd: __dirname, timeout: 30000, stdio: 'ignore' });
    log('✅ 已同步到 GitHub Pages');
  } catch(e) {
    warn('⚠️ Git同步失败：' + e.message);
  }

  // 快照
  const snap = path.join(CONFIG.MEMORY_DIR, `snapshot_${targetDate}.json`);
  fs.writeFileSync(snap, JSON.stringify(items, null, 2), 'utf8');

  // 企微通知（去重）— 使用 GitHub Pages 公网地址
  const staticUrl = CONFIG.PAGES_URL || `http://localhost:${CONFIG.STATIC_PORT}/output/reply_tool.html`;
  if (items.length > 0) {
    if (hasNotifiedToday(targetDate)) {
      log(`ℹ️ 今天（${targetDate}）已推送过企微通知，跳过重复推送`);
    } else {
      await sendWecom(staticUrl, items.length, targetDate);
      markNotified(targetDate);
    }
  } else {
    log('ℹ️ 无待回复问题，跳过企微通知');
  }

  log(`🎉 完成！工具地址：${staticUrl}`);
  return { items, targetDate, staticUrl };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--build') {
    // 第二阶段：AI 填充完毕后，生成 HTML 并推送
    const targetDate = args[1] || (() => { const d = new Date(); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); })();
    buildAndNotify(targetDate).catch(e => { console.error('❌', e.message); process.exit(1); });
  } else {
    // 第一阶段：抓取 + 关键词预处理
    main().catch(e => { console.error('❌', e.message); process.exit(1); });
  }
}

module.exports = { main, buildAndNotify, getKnowledge, generateReply, buildHTML };
