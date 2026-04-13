#!/usr/bin/env node
/**
 * AiSee 反馈自动回复工具 - 主执行脚本
 *
 * 功能：
 * 1. 检查知识库是否需要刷新（超90天自动重新获取）
 * 2. iOA 登录状态检查（过期自动发起手机验证）
 * 3. 抓取昨日所有「待首次回复」的反馈
 * 4. 按模板A/B/C + 功能指引生成回复建议
 * 5. 生成可编辑回复工具网页（含 localStorage 落盘）
 * 6. 企业微信通知（暖心话 + 工具链接）
 */

const fs   = require('fs');
const path = require('path');
const http  = require('http');
const https = require('https');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// ===== 配置（按需修改）=====
const CONFIG = {
  SKILL_DIR   : __dirname,
  MEMORY_DIR  : path.join(__dirname, 'memory'),
  KNOWLEDGE_FILE: path.join(__dirname, 'memory', 'knowledge.md'),
  KNOWLEDGE_DOC_ID : 'DTEVpVGZJR3B6QUlw',
  KNOWLEDGE_URL    : 'https://docs.qq.com/aio/DTEVpVGZJR3B6QUlw?u=49e9d070c42e4e15a41bcc294b300099&p=UzHNdSGlGaG0XW85HZImG5',
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
};

// ===== 回复模板 =====
const TEMPLATE = {
  // 模板A：默认兜底（FAQ无匹配 / 不明确 / 外文）
  A: `您好，这里是腾讯文档企业版的官方反馈入口，请问您使用的是腾讯文档个人版（通过个人qq或微信登录）还是企业版呢？如您使用的是个人版，需点击该链接：https://docs.qq.com/home/feedback?src=1269 ，描述您具体遇到的使用问题，提供相关截图提交反馈。`,

  // 模板B：会员/退费/发票/开票
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

// ===== 知识库管理 =====
function getKnowledgeMeta() {
  if (!fs.existsSync(CONFIG.KNOWLEDGE_FILE)) return null;
  const raw = fs.readFileSync(CONFIG.KNOWLEDGE_FILE, 'utf8');
  const fetchedAt    = (raw.match(/fetched_at:\s*(.+)/)    || [])[1]?.trim();
  const refreshAfter = (raw.match(/refresh_after:\s*(.+)/) || [])[1]?.trim();
  // content = 去掉 frontmatter 的全部文本
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
  log('📚 知识库已过期，重新获取...');
  try {
    const { stdout } = await execAsync(
      `${CONFIG.MCPORTER} call "tencent-docs" "get_content" --args '{"file_id":"${CONFIG.KNOWLEDGE_DOC_ID}"}'`,
      { timeout: 60000 }
    );
    const parsed  = JSON.parse(stdout);
    const content = parsed.content || '';
    if (!content) throw new Error('返回内容为空');

    const now = new Date();
    const refreshAfter = new Date(now.getTime() + CONFIG.KNOWLEDGE_REFRESH_DAYS * 86400000);
    const header = [
      '---',
      `source: ${CONFIG.KNOWLEDGE_URL}`,
      `fetched_at: ${now.toISOString().slice(0,19).replace('T',' ')}`,
      `refresh_after: ${refreshAfter.toISOString().slice(0,10)}`,
      `doc_id: ${CONFIG.KNOWLEDGE_DOC_ID}`,
      'title: 企微SaaS文档-产品知识帮助中心',
      '---',
      '',
      '## ===== 标准回复模板规则 =====',
      '',
      '### 模板A：默认回复',
      '适用场景：FAQ无匹配 / 问题不明确 / 疑似非企业版用户 / 外文误提交',
      '',
      `> ${TEMPLATE.A}`,
      '',
      '---',
      '',
      '### 模板B：会员/退费/发票/开票',
      '触发关键词：会员、退费、发票、开票',
      '',
      `> ${TEMPLATE.B}`,
      '',
      '---',
      '',
      '### 模板C：企微/企业微信/企微文档',
      '触发关键词：企微、企业微信、企微文档',
      '',
      `> ${TEMPLATE.C}`,
      '',
      '---',
      '',
      '## ===== 腾讯文档功能指引内容 =====',
      '',
    ].join('\n');

    fs.mkdirSync(CONFIG.MEMORY_DIR, { recursive: true });
    fs.writeFileSync(CONFIG.KNOWLEDGE_FILE, header + content, 'utf8');
    log(`✅ 知识库已更新，下次刷新：${refreshAfter.toISOString().slice(0,10)}`);
    return content;
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

// ===== iOA 登录 =====
async function ensureLogin() {
  log('🔐 检查 AiSee 登录状态...');
  try {
    await runBrowser(`open "${CONFIG.AISEE_LIST}"`);
    await new Promise(r => setTimeout(r, 2000));
    const url = (await runBrowser('eval "window.location.href"')).replace(/"/g, '');
    if (url.includes('aisee.woa.com/admin')) { log('✅ 已登录'); return true; }

    log('⚠️ 需要 iOA 登录，发起验证...');
    await new Promise(r => setTimeout(r, 1500));
    const snap = await runBrowser('snapshot -i');
    const m = snap.match(/button "发起验证" \[ref=(e\d+)\]/);
    if (m) { await runBrowser(`click "${m[1]}"`); log('📱 已发起 iOA 推送，等待手机确认...'); }
    return false;
  } catch(e) { warn('登录检查异常：' + e.message); return false; }
}

// ===== 抓取反馈列表 =====
async function fetchFeedback() {
  log('📋 抓取 AiSee 反馈列表...');
  await runBrowser(`open "${CONFIG.AISEE_LIST}"`);
  await new Promise(r => setTimeout(r, 2000));

  const raw = await runBrowser(`eval "JSON.stringify(Array.from(document.querySelectorAll('table tbody tr[data-row-key]')).map(tr=>{const fid=tr.getAttribute('data-row-key');const q=(tr.querySelector('td:nth-child(2) > div:first-child')||{}).innerText||'';const st=(tr.querySelector('td:nth-child(4)')||{}).innerText||'';const t=(tr.querySelector('td:nth-child(6)')||{}).innerText||'';return{fid,question:q.trim().split('\\n')[0],status:st.trim(),time:t.trim()}}).filter(i=>i.fid&&i.question))"`);

  try {
    const list = JSON.parse(raw);
    log(`✅ 获取 ${list.length} 条反馈`);
    return list;
  } catch(e) {
    warn('解析反馈列表失败：' + e.message);
    return [];
  }
}

// ===== 生成回复 =====
function generateReply(question, knowledge) {
  // 优先级1：模板C（企微相关）
  if (KEYWORDS_C.some(k => question.includes(k))) {
    return { answer: TEMPLATE.C, tag: 'fixed', tagLabel: '企微问题 → 模板C' };
  }
  // 优先级2：模板B（会员/发票）
  if (KEYWORDS_B.some(k => question.includes(k))) {
    return { answer: TEMPLATE.B, tag: 'fixed', tagLabel: '会员/发票 → 模板B' };
  }
  // 优先级3：功能指引匹配
  if (knowledge) {
    const matched = matchKnowledge(question, knowledge);
    if (matched) return { answer: matched, tag: 'guide', tagLabel: '按功能指引回复' };
  }
  // 兜底：模板A
  return { answer: TEMPLATE.A, tag: 'fixed', tagLabel: '无法匹配 → 模板A' };
}

function matchKnowledge(question, knowledge) {
  const kws = question.replace(/[？?！!。，,、\s]/g, ' ').split(' ').filter(w => w.length >= 2);
  const sections = knowledge.split(/\n(?=##|如何|怎么|怎样)/);
  let best = 0, bestSec = null;
  for (const sec of sections) {
    const score = kws.filter(k => sec.includes(k)).length;
    if (score > best) { best = score; bestSec = sec; }
  }
  if (best >= 2 && bestSec) {
    const trimmed = bestSec.trim();
    return `您好！关于您的问题，以下是相关指引：\n\n${trimmed.substring(0, 500)}`;
  }
  return null;
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
  const body = JSON.stringify({
    msgtype: 'markdown',
    markdown: {
      content:
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

  // 1. 知识库
  const knowledge = await getKnowledge();

  // 2. 登录检查
  const loggedIn = await ensureLogin();
  if (!loggedIn) {
    log('⏳ 等待 iOA 手机确认（最多60秒）...');
    await new Promise(r => setTimeout(r, 60000));
    const url = (await runBrowser('eval "window.location.href"').catch(() => '')).replace(/"/g, '');
    if (!url.includes('aisee.woa.com/admin')) {
      log('❌ 登录超时，退出'); process.exit(1);
    }
    log('✅ 登录成功');
  }

  // 3. 抓取反馈
  const all = await fetchFeedback();
  // 过滤「待首次回复」（状态不含"已回复"）
  const unreplied = all.filter(item =>
    !item.status.includes('已回复') || process.env.DEBUG_ALL === '1'
  );
  log(`📝 待回复：${unreplied.length} 条`);

  // 4. 生成回复建议
  const items = unreplied.map(item => {
    const { answer, tag, tagLabel } = generateReply(item.question, knowledge);
    return { ...item, answer, tag, tagLabel };
  });

  // 5. 生成 HTML
  fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });
  const html = buildHTML(items, targetDate);
  fs.writeFileSync(CONFIG.HTML_OUT, html, 'utf8');
  log(`✅ HTML 工具已生成：${CONFIG.HTML_OUT}`);

  // 6. 快照
  const snap = path.join(CONFIG.MEMORY_DIR, `snapshot_${targetDate}.json`);
  fs.writeFileSync(snap, JSON.stringify(items, null, 2), 'utf8');

  // 7. 通知
  const staticUrl = `http://localhost:${CONFIG.STATIC_PORT}/output/reply_tool.html`;
  if (items.length > 0) {
    await sendWecom(staticUrl, items.length, targetDate);
  } else {
    log('ℹ️ 无待回复问题，跳过企微通知');
  }

  log(`🎉 完成！工具地址：${staticUrl}`);
  return { items, targetDate, staticUrl };
}

if (require.main === module) {
  main().catch(e => { console.error('❌', e.message); process.exit(1); });
}

module.exports = { main, getKnowledge, generateReply, buildHTML };
