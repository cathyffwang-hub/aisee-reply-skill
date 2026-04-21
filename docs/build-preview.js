#!/usr/bin/env node
/**
 * 把 output/reply_tool.html 转换为 docs/index.html（GitHub Pages 云端预览版）
 * 改造项：
 *   1. fid 脱敏为 demo-xxx
 *   2. 顶部注入"仅预览"横幅
 *   3. 关闭本地服务探测，状态常亮为"演示模式"
 *   4. 按钮点击改为弹提示，不再真发 fetch
 *   5. 一键回复按钮禁用，提示"请本地运行 skill"
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../output/reply_tool.html');
const DST = path.resolve(__dirname, 'index.html');

if (!fs.existsSync(SRC)) {
  console.error('❌ 源文件不存在：', SRC);
  console.error('   请先在本地跑一次 skill 生成 output/reply_tool.html');
  process.exit(1);
}

let html = fs.readFileSync(SRC, 'utf8');

// ========== 1. fid 脱敏 ==========
html = html.replace(/"fid":"[a-f0-9]{16,}"/g, (_, i) => {
  return `"fid":"demo-${Math.random().toString(36).slice(2, 10)}"`;
});

// ========== 2. 顶部横幅 + 样式 ==========
const banner = `
<style>
  .cloud-banner{background:linear-gradient(135deg,#fef3c7,#fde68a);border:2px solid #f59e0b;border-radius:14px;padding:14px 20px;margin-bottom:16px;display:flex;align-items:flex-start;gap:12px;box-shadow:0 4px 14px rgba(245,158,11,.18)}
  .cloud-banner .ico{font-size:28px;flex-shrink:0}
  .cloud-banner h3{font-size:15px;font-weight:800;color:#92400e;margin-bottom:4px}
  .cloud-banner p{font-size:12.5px;color:#78350f;line-height:1.6}
  .cloud-banner a{color:#b45309;font-weight:700;text-decoration:underline}
</style>
<div class="cloud-banner">
  <div class="ico">☁️</div>
  <div>
    <h3>云端预览版 · Demo Only</h3>
    <p>
      这是 <b>aisee-reply-skill</b> 生成的工具页静态截图版本，用于向同事展示 UI 和交互逻辑。
      数据为脱敏示例，<b>实际回复功能需在本地运行 skill</b> 才可使用。
      完整能力（抓取反馈 / AI生成 / 一键回复 / 自动打标签）见
      <a href="https://github.com/cathyffwang-hub/aisee-reply-skill" target="_blank">GitHub 仓库 README</a>。
    </p>
  </div>
</div>
`;
html = html.replace('<body>', '<body>\n' + banner);

// ========== 3. 关闭服务探测 + 按钮行为改造 ==========
// 替换整个 script 尾部的 chkSrv + render 启动逻辑
html = html.replace(
  /async function chkSrv\(\)\{[\s\S]*?\}\s*render\(\);chkSrv\(\);setInterval\(chkSrv,15000\);/,
  `function chkSrv(){
  const dot=document.getElementById('dot'),lbl=document.getElementById('srv-lbl');
  dot.className='dot';dot.style.background='#fbbf24';dot.style.boxShadow='0 0 6px #fbbf24';
  lbl.textContent='☁️ 云端演示模式';
}
render();chkSrv();`
);

// 替换 go() 函数：不调 fetch，弹提示
html = html.replace(
  /async function go\(i\)\{[\s\S]*?render\(\);\s*\}/,
  `async function go(i){
  alert('☁️ 云端预览版不支持实际回复操作。\\n\\n如需真实回复 AiSee 反馈，请在本地运行 aisee-reply-skill。\\nGitHub: https://github.com/cathyffwang-hub/aisee-reply-skill');
}`
);

// 替换 replyAll() 函数：直接弹提示
html = html.replace(
  /async function replyAll\(\)\{[\s\S]*?render\(\);\s*\}/,
  `async function replyAll(){
  alert('☁️ 云端预览版不支持批量回复操作。\\n\\n请在本地运行 skill 后使用此功能。');
}`
);

// ========== 3.5 移除无用的 localhost 常量 ==========
html = html.replace(
  /const API='http:\/\/localhost:\d+\/reply';/,
  `const API='';// 云端预览版，不调用任何后端`
);

// ========== 4. 修改 title 和 header 文案 ==========
html = html.replace(
  /<title>.*?<\/title>/,
  '<title>AiSee 反馈回复工具 · 云端演示</title>'
);
html = html.replace(
  /<h1>🎯 AiSee 反馈回复工具<\/h1>\s*<p>.*?<\/p>/,
  `<h1>🎯 AiSee 反馈回复工具</h1>
    <p>腾讯文档企业版 · 云端演示版 · <a href="https://github.com/cathyffwang-hub/aisee-reply-skill" style="color:#fff;text-decoration:underline">查看完整能力</a></p>`
);

fs.writeFileSync(DST, html, 'utf8');
console.log('✅ 云端预览版已生成：', DST);
console.log('   大小：', (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1), 'KB');
