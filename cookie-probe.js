#!/usr/bin/env node
/**
 * AiSee Cookie 保活探针
 *
 * 目的：验证"持续访问是否会让 iOA Cookie 自动续期"
 *
 * 机制：
 *   - 每次运行用现有 .browser-profile 打开一次 AiSee 列表页
 *   - 判断是否落在 /admin（已登录）或被踢去登录页
 *   - 把结果（时间 + 状态）追加到 cookie-probe.log
 *   - **绝不触发 iOA 推送**（只读探测，不打扰用户）
 *
 * 使用：
 *   node cookie-probe.js                  # 单次探测
 *   通过 launchd 每小时自动运行
 *
 * 一周后看 cookie-probe.log：
 *   - 如果一直 LOGGED_IN → iOA 策略是滑动过期，保活方案可行
 *   - 如果 7 天后变 NOT_LOGGED_IN → 策略是绝对过期，此方案无效
 */
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const CONFIG = {
  SKILL_DIR: __dirname,
  NODE_BIN: process.execPath,  // 当前 Node 的绝对路径，绕开 env shebang
  BROWSER_ENTRY: '/Users/cathy/.workbuddy/agent-browser-local/node_modules/agent-browser/bin/agent-browser.js',
  BROWSER_PROFILE: path.join(__dirname, '.browser-profile'),
  AISEE_LIST: 'https://aisee.woa.com/admin/p-23ba9e1e-7bfd-3d15-806d-31f9b3e3a531/b-a9ba8a76-deb1-328c-af3b-2fc7c54ac4f6/p5sr49xhf1/operate/aiseeList',
  LOG_FILE: path.join(__dirname, 'cookie-probe.log'),
};

async function runBrowser(cmd, timeout = 20000) {
  const { stdout } = await execAsync(
    `"${CONFIG.NODE_BIN}" "${CONFIG.BROWSER_ENTRY}" --profile "${CONFIG.BROWSER_PROFILE}" ${cmd}`,
    { timeout }
  );
  return stdout.trim();
}

function logLine(status, detail = '') {
  // CST (Asia/Shanghai) 本地时间，格式 YYYY-MM-DD HH:mm:ss
  const ts = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const line = `${ts}  ${status}  ${detail}\n`;
  fs.appendFileSync(CONFIG.LOG_FILE, line);
  console.log(line.trim());
}

async function probe() {
  // 若已有 Chrome 进程在用这个 profile，agent-browser 可能冲突
  // 轻量做法：如果 browser open 失败直接记录 SKIPPED
  try {
    await runBrowser(`open "${CONFIG.AISEE_LIST}"`);
  } catch (e) {
    const msg = (e.message || '').slice(0, 120);
    logLine('SKIPPED_OPEN_FAIL', msg);
    return;
  }

  await new Promise(r => setTimeout(r, 4000));

  let url = '';
  try {
    url = (await runBrowser('eval "window.location.href"')).replace(/"/g, '');
  } catch (e) {
    logLine('SKIPPED_EVAL_FAIL', (e.message || '').slice(0, 120));
    return;
  }

  if (url.includes('aisee.woa.com/admin')) {
    logLine('LOGGED_IN', `url=${url.slice(0, 120)}`);
  } else if (url.includes('aisee.woa.com')) {
    logLine('NOT_LOGGED_IN', `url=${url.slice(0, 120)}`);
  } else {
    logLine('UNKNOWN', `url=${url.slice(0, 120)}`);
  }
}

(async () => {
  try {
    await probe();
  } catch (e) {
    logLine('ERROR', (e.message || '').slice(0, 200));
  } finally {
    // 收尾：如果有残留 chrome 进程，留给 agent-browser 自己管（它 open 完后本身有 teardown）
    process.exit(0);
  }
})();
