#!/usr/bin/env node
/**
 * AiSee 反馈自动回复工具 - 主执行脚本
 *
 * 功能：
 * 0. 自动检查 Git 远端更新，有新版本则自动 pull
 * 1. 检查知识库是否需要刷新（超90天自动重新获取）
 * 2. iOA 登录状态检查（浏览器已有 session 直接跳过，无需手机确认）
 * 3. 抓取昨日所有「待首次回复」的反馈
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
  MCPORTER    : 'mcporter',

  HTML_OUT    : path.join(__dirname, 'output', 'reply_tool.html'),
  REPLY_PORT  : 3400,
  STATIC_PORT : 3399,

  WECOM_WEBHOOK: process.env.WECOM_WEBHOOK ||
    'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=62b8f70c-c8d8-45c7-b0e8-656bae7382fa',

  // 企微 @人配置：填写你的企微 userid
  // 多人用逗号分隔，如 'userid1,userid2'；空字符串则不 @
  WECOM_MENTION_USERID: process.env.WECOM_MENTION_USERID || 'cathyfwang',

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

// ===== 工具函数 =====
const log  = msg => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
const warn = msg => console.warn(`[WARN] ${msg}`);

async function runBrowser(cmd, timeout = 30000) {
  const { stdout } = await execAsync(`${CONFIG.BROWSER} ${cmd}`, { timeout });
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

  const raw = await runBrowser(`eval "JSON.stringify(Array.from(document.querySelectorAll('table tbody tr[data-row-key]')).map(tr=>{const fid=tr.getAttribute('data-row-key');const q=(tr.querySelector('td:nth-child(2) > div:first-child')||{}).innerText||'';const st=(tr.querySelector('td:nth-child(4)')||{}).innerText||'';const t=(tr.querySelector('td:nth-child(6)')||{}).innerText||'';return{fid,question:q.trim().split('\\n')[0],status:st.trim(),time:t.trim()}}).filter(i=>i.fid&&i.question))"`);

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
function generateReply(question) {
  // 优先级1：模板C（企微相关）
  if (KEYWORDS_C.some(k => question.includes(k))) {
    return { answer: TEMPLATE.C, tag: 'fixed', tagLabel: '企微问题 → 模板C', needsAI: false };
  }
  // 优先级2：模板B（会员/发票）
  if (KEYWORDS_B.some(k => question.includes(k))) {
    return { answer: TEMPLATE.B, tag: 'fixed', tagLabel: '会员/发票 → 模板B', needsAI: false };
  }
  // 优先级3：问题不明确 / 外文 → 模板A
  const chineseChars = (question.match(/[\u4e00-\u9fa5]/g) || []).length;
  if (chineseChars < 4) {
    return { answer: TEMPLATE.A, tag: 'fixed', tagLabel: '无法匹配 → 模板A', needsAI: false };
  }
  // 其余：标记为需要 AI 生成回复（answer 留空占位，由 AI 在第二阶段填充）
  return { answer: '', tag: 'ai', tagLabel: '⏳ 待AI生成回复', needsAI: true };
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
<title>AiSee 反馈回复工具 · ${targetDate}</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{--purple:#667eea;--purple-dark:#764ba2;--green:#059669;--orange:#d97706;--red:#dc2626;--bg:#f0f2f5;--card:#fff;--text:#1a1a2e;--sub:#64748b;--border:#e2e8f0;--r:12px}
  body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text);min-height:100vh;padding:24px 20px}
  .header{background:linear-gradient(135deg,var(--purple),var(--purple-dark));color:#fff;padding:22px 28px;border-radius:16px;margin-bottom:20px;box-shadow:0 8px 32px rgba(102,126,234,.28);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
  .header h1{font-size:20px;font-weight:700;margin-bottom:4px}
  .header p{font-size:13px;opacity:.82}
  .srv{display:flex;align-items:center;gap:8px}
  .dot{width:8px;height:8px;border-radius:50%;background:#fbbf24;box-shadow:0 0 6px #fbbf24;transition:all .3s}
  .dot.ok{background:#34d399;box-shadow:0 0 6px #34d399}
  .dot.err{background:#f87171;box-shadow:0 0 6px #f87171}
  .srv-lbl{font-size:12px;color:rgba(255,255,255,.8)}
  .stats{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap}
  .stat{background:var(--card);border-radius:var(--r);padding:14px 20px;flex:1;min-width:110px;box-shadow:0 2px 8px rgba(0,0,0,.05);text-align:center}
  .stat .n{font-size:26px;font-weight:800}
  .stat .l{font-size:12px;color:var(--sub);margin-top:2px}
  .prog-wrap{margin-bottom:20px}
  .prog-bar{height:6px;background:var(--border);border-radius:3px;overflow:hidden}
  .prog-fill{height:100%;background:linear-gradient(90deg,var(--purple),var(--purple-dark));border-radius:3px;transition:width .5s;width:0}
  .prog-lbl{font-size:12px;color:var(--sub);margin-top:6px;text-align:right}
  .cards{display:flex;flex-direction:column;gap:16px}
  .card{background:var(--card);border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,.06);overflow:hidden;border:2px solid transparent;transition:border-color .2s,box-shadow .2s}
  .card.sending{border-color:var(--purple);box-shadow:0 4px 20px rgba(102,126,234,.2)}
  .card.done{border-color:#34d399;background:#f0fdf9}
  .card.err-card{border-color:var(--red)}
  .ch{display:flex;align-items:flex-start;gap:12px;padding:16px 20px 12px;border-bottom:1px solid var(--border)}
  .card.done .ch{border-color:#bbf7d0}
  .badge{flex-shrink:0;width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--purple),var(--purple-dark));color:#fff;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center}
  .card.done .badge{background:linear-gradient(135deg,#34d399,#059669)}
  .qb{flex:1}
  .qt{font-size:14px;font-weight:600;line-height:1.55;margin-bottom:6px}
  .tag{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600}
  .tag-guide{background:#ede9fe;color:#6d28d9}
  .tag-fixed{background:#fef3c7;color:#92400e}
  .cs{flex-shrink:0;font-size:13px;font-weight:600}
  .cs.p{color:var(--sub)}.cs.s{color:var(--purple)}.cs.d{color:var(--green)}.cs.e{color:var(--red)}
  .cb{padding:14px 20px 16px}
  .albl{font-size:11px;font-weight:600;color:var(--sub);letter-spacing:.8px;margin-bottom:8px;display:flex;align-items:center;gap:6px}
  .hint{font-size:11px;color:#a78bfa;background:#ede9fe;padding:2px 8px;border-radius:10px;font-weight:400;letter-spacing:0}
  textarea.ae{width:100%;min-height:100px;max-height:260px;border:1.5px solid var(--border);border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.7;color:var(--text);font-family:inherit;resize:vertical;background:#fafbff;outline:none;transition:border-color .2s,box-shadow .2s}
  textarea.ae:focus{border-color:var(--purple);box-shadow:0 0 0 3px rgba(102,126,234,.12);background:#fff}
  .card.done textarea.ae{background:#f0fdf9;border-color:#bbf7d0;color:#475569;pointer-events:none;resize:none}
  .cf{padding:0 20px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
  .cc{font-size:12px;color:var(--sub)}.cc.warn{color:var(--orange)}
  .btn{display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,var(--purple),var(--purple-dark));color:#fff;border:none;border-radius:8px;padding:9px 20px;font-size:13px;font-weight:700;cursor:pointer;transition:all .2s;box-shadow:0 3px 10px rgba(102,126,234,.35);white-space:nowrap}
  .btn:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 6px 18px rgba(102,126,234,.45)}
  .btn:disabled{opacity:.6;cursor:not-allowed;transform:none;box-shadow:none}
  .btn.sb{background:linear-gradient(135deg,#8b5cf6,#6d28d9);animation:pulse 1.2s infinite}
  .btn.db{background:linear-gradient(135deg,#34d399,#059669);cursor:default;box-shadow:none}
  .btn.rb{background:linear-gradient(135deg,#f87171,var(--red))}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.7}}
  .spin{width:14px;height:14px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:sp .7s linear infinite}
  @keyframes sp{to{transform:rotate(360deg)}}
  .errmsg{font-size:12px;color:var(--red);background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:6px 10px;margin-top:8px}
  .toast{position:fixed;bottom:28px;right:24px;min-width:260px;max-width:360px;background:#1e293b;color:#fff;padding:12px 18px;border-radius:12px;font-size:14px;font-weight:500;box-shadow:0 8px 32px rgba(0,0,0,.25);z-index:9999;opacity:0;transform:translateY(16px);transition:all .3s;display:flex;align-items:center;gap:10px}
  .toast.show{opacity:1;transform:translateY(0)}
  .empty{text-align:center;padding:60px 20px;color:var(--sub)}
  .empty .ei{font-size:48px;margin-bottom:16px}
  .empty h3{font-size:18px;margin-bottom:8px}
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>🎯 AiSee 反馈回复工具</h1>
    <p>腾讯文档企业版 · ${targetDate} 未回复问题 · 生成于 ${now}</p>
  </div>
  <div class="srv">
    <div class="dot" id="dot"></div>
    <span class="srv-lbl" id="srv-lbl">检查服务中...</span>
  </div>
</div>
<div class="stats">
  <div class="stat"><div class="n" style="color:var(--purple)" id="s-total">-</div><div class="l">总条数</div></div>
  <div class="stat"><div class="n" style="color:var(--green)" id="s-done">0</div><div class="l">已回复</div></div>
  <div class="stat"><div class="n" style="color:var(--orange)" id="s-pending">-</div><div class="l">待回复</div></div>
  <div class="stat"><div class="n" style="color:var(--red)" id="s-err">0</div><div class="l">失败</div></div>
</div>
<div class="prog-wrap">
  <div class="prog-bar"><div class="prog-fill" id="prog"></div></div>
  <div class="prog-lbl" id="prog-lbl">0 / - 已回复</div>
</div>
<div class="cards" id="cards"></div>
<div class="toast" id="toast"><span id="ti">✅</span><span id="tm"></span></div>
<script>
const API='http://localhost:${port}/reply';
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
  document.getElementById('s-total').textContent=data.length;
  document.getElementById('s-done').textContent=done;
  document.getElementById('s-pending').textContent=data.length-done;
  document.getElementById('s-err').textContent=err;
  document.getElementById('prog').style.width=(data.length?done/data.length*100:0)+'%';
  document.getElementById('prog-lbl').textContent=done+' / '+data.length+' 已回复';
}

async function go(i){
  const ta=document.getElementById('ed-'+i);
  const ans=ta?ta.value.trim():data[i].answer;
  if(!ans){toast('回复内容不能为空','w');return;}
  states[i]={st:'sending',err:''};render();
  try{
    const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fid:data[i].fid,answer:ans,index:i+1})});
    const j=await r.json();
    if(j.ok){states[i]={st:'done',err:''};saveStates();toast('第'+(i+1)+'条已成功回复 ✅','ok');}
    else throw new Error(j.error||'服务器返回失败');
  }catch(e){states[i]={st:'error',err:e.message};saveStates();toast('第'+(i+1)+'条失败：'+e.message,'e');}
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
  try{await fetch(API,{method:'OPTIONS',mode:'cors'});dot.className='dot ok';lbl.textContent='回复服务已就绪';}
  catch{dot.className='dot err';lbl.textContent='回复服务未启动';}
}

render();chkSrv();setInterval(chkSrv,15000);
</script>
</body>
</html>`;
}

// ===== 企业微信通知 =====
async function sendWecom(url, count, targetDate) {
  if (!CONFIG.WECOM_WEBHOOK) { warn('未配置企微 Webhook，跳过通知'); return; }

  const mentionStr = CONFIG.WECOM_MENTION_USERID
    ? CONFIG.WECOM_MENTION_USERID.split(',').map(id => `<@${id.trim()}>`).join(' ') + '\n\n'
    : '';

  const body = JSON.stringify({
    msgtype: 'markdown',
    markdown: {
      content:
        mentionStr +
        `🌸 **菲菲公主早上好！今天也是元气满满的一天，每一条回复都是对用户最好的照见～** 💪\n\n` +
        `📋 **${targetDate} AiSee 反馈待回复清单已就绪**\n\n` +
        `> 共有 **${count}** 条用户反馈等待回复，AI 已根据腾讯文档功能指引准备好了答案 ✨\n\n` +
        `🔗 [点击打开回复工具](${url})\n\n` +
        `_改完答案点「确认并回复」就会自动提交，刷新不丢状态哦 🎯_`
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
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const targetDate = args[0] || yesterday.toISOString().slice(0, 10);

  log('🚀 AiSee 反馈自动回复工具启动');
  log(`📅 目标日期：${targetDate}`);

  // 0. 确保静态服务从 skill 目录启动（修复问题2+4）
  await ensureStaticServer();

  // 1. 知识库
  const knowledge = await getKnowledge();

  // 2. 登录检查（修复问题3：已有 session 直接跳过）
  const loggedIn = await ensureLogin();
  if (!loggedIn) {
    log('❌ 登录失败，退出'); process.exit(1);
  }

  // 3. 抓取反馈，严格过滤：
  //    - 必须是 targetDate 当天提交（time 字段前10位 === targetDate）
  //    - 状态不含「已回复」（除非 DEBUG_ALL=1）
  const all = await fetchFeedback();
  const unreplied = all.filter(item => {
    const itemDate = (item.time || '').slice(0, 10);
    const dateMatch = itemDate === targetDate;
    const notReplied = !item.status.includes('已回复') || process.env.DEBUG_ALL === '1';
    return dateMatch && notReplied;
  });
  log(`📝 ${targetDate} 待回复：${unreplied.length} 条（共扫描 ${all.length} 条）`);

  // 4. 第一阶段：关键词命中生成回复，其余标记 needsAI
  const items = unreplied.map(item => {
    const { answer, tag, tagLabel, needsAI } = generateReply(item.question);
    return { ...item, answer, tag, tagLabel, needsAI };
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
    warn(`⚠️ 还有 ${empty.length} 条回复为空，请先填充完毕`);
  }

  // 确保静态服务
  await ensureStaticServer();

  // 生成 HTML
  fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });
  const html = buildHTML(items, targetDate);
  fs.writeFileSync(CONFIG.HTML_OUT, html, 'utf8');
  log(`✅ HTML 工具已生成：${CONFIG.HTML_OUT}`);

  // 快照
  const snap = path.join(CONFIG.MEMORY_DIR, `snapshot_${targetDate}.json`);
  fs.writeFileSync(snap, JSON.stringify(items, null, 2), 'utf8');

  // 企微通知（去重）
  const staticUrl = `http://localhost:${CONFIG.STATIC_PORT}/output/reply_tool.html`;
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
