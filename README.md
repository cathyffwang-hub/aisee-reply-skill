# AiSee 反馈自动回复工具

> 腾讯文档企业版 · AiSee 反馈平台的定期回复助手
>
> **设计理念**：工具生成答案、人工审核确认、一键提交 → 高效 + 可控

---

## 功能特性

- ✅ 自动抓取指定日期的未回复用户反馈
- ✅ 按规则（模板A/B/C + 功能指引）自动生成回复建议
- ✅ 答案可编辑，改完一键确认，实时驱动浏览器回复
- ✅ 回复状态 localStorage 落盘，刷新不丢失
- ✅ 企业微信通知（暖心话 + 工具链接）
- ✅ 功能指引知识库 90 天自动刷新

---

## 安装说明

### 前置要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | ≥ 18 | 运行环境 |
| agent-browser | 已安装 | 浏览器自动化 |
| mcporter | 已安装 | 腾讯文档 MCP 调用 |
| iOA | 手机已安装 | AiSee 登录验证 |

### 安装步骤

```bash
# 1. 克隆仓库
git clone https://github.com/cathyfwang-hub/aisee-reply-skill.git
cd aisee-reply-skill

# 2. 安装 agent-browser（如未安装）
npm install agent-browser --prefix ~/.workbuddy/agent-browser-local

# 3. 修改配置（见下方配置说明）
vim run.js
```

### 配置修改

打开 `run.js`，找到顶部 `CONFIG` 对象，修改以下字段：

```js
const CONFIG = {
  // ⚠️ 必改：你的 AiSee 列表页地址
  AISEE_LIST: 'https://aisee.woa.com/admin/p-xxx.../operate/aiseeList',
  AISEE_DETAIL: 'https://aisee.woa.com/admin/p-xxx.../operate/aiseeDetail',

  // ⚠️ 必改：agent-browser 路径
  BROWSER: '/path/to/agent-browser',

  // ⚠️ 必改：企业微信群机器人 Webhook
  WECOM_WEBHOOK: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=你的key',

  // 可选：腾讯文档功能指引文档 ID（默认已配置）
  KNOWLEDGE_DOC_ID: 'DTEVpVGZJR3B6QUlw',
};
```

---

## 使用方式

### 方式一：手动运行

```bash
# 在项目目录下

# 终端1：启动回复服务
node reply_server.js

# 终端2：启动静态服务
npx serve . -p 3399

# 终端3：执行主流程（默认处理昨天的未回复问题）
node run.js

# 也可以手动指定日期
node run.js 2026-04-12
```

执行后：
1. 浏览器打开 `http://localhost:3399/output/reply_tool.html`
2. 或等待企业微信通知，点击链接打开
3. 在网页中审核/修改答案，点击「确认并回复」即可

### 方式二：WorkBuddy 自动化（推荐）

在 WorkBuddy 中设置定时任务，每周固定时间自动触发。

示例：每周三 10:00 自动执行
- 自动抓取周二的未回复问题
- 生成回复工具页
- 发送企微通知，等待你确认

---

## 回复规则说明

| 优先级 | 触发条件 | 使用模板 |
|--------|---------|---------|
| 1 | 含「企微/企业微信/企微文档」 | 模板C |
| 2 | 含「会员/退费/发票/开票/充值/付费/订单/退款」 | 模板B |
| 3 | 功能指引中找到相关内容（关键词匹配≥2） | 按指引回复 |
| 4 | 无法匹配/外文/不明确 | 模板A（默认兜底） |

---

## 目录结构

```
aisee-reply-skill/
├── SKILL.md              # WorkBuddy Skill 定义文件
├── README.md             # 本文件
├── run.js                # 主执行脚本
├── reply_server.js       # 回复服务（端口3400）
├── memory/
│   ├── knowledge.md      # 功能指引知识库（90天刷新）
│   └── snapshot_*.json  # 每日数据快照
└── output/
    └── reply_tool.html   # 生成的回复工具页
```

---

## 常见问题

**Q：登录需要 iOA，每次都要手机确认吗？**
A：不需要。iOA Cookie 持久化，有效期内无需重复确认。仅在 Cookie 过期时会自动发起一次 iOA 推送。

**Q：知识库内容过时了怎么办？**
A：每 90 天自动从腾讯文档重新获取一次。也可以手动删除 `memory/knowledge.md` 触发立即刷新。

**Q：有的答案不准确，可以修改吗？**
A：可以。工具页中每条答案都是可编辑的 textarea，改完再点「确认并回复」即可。

**Q：如何切换到其他 AiSee 产品线？**
A：修改 `run.js` 中 `CONFIG.AISEE_LIST` 和 `CONFIG.AISEE_DETAIL` 的 URL 即可。

---

## License

MIT © 腾讯文档企业版团队
