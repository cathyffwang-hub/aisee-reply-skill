# aisee-reply-skill

## Description

AiSee 反馈自动回复工具。适用于腾讯文档企业版 AiSee 反馈平台的定期回复场景。

触发关键词：aisee 回复、反馈回复、处理 aisee 问题、打开回复工具、运行回复流程

## Capabilities

- 自动抓取 AiSee 指定日期的未回复用户反馈
- 按内置模板规则（A/B/C）+ 腾讯文档功能指引知识库，为每条问题生成回复建议
- 生成可编辑回复确认网页（答案可改，点击确认即实时驱动浏览器回复，状态 localStorage 落盘）
- 发送企业微信通知（暖心话 + 工具链接）
- 知识库 90 天自动刷新机制

## Usage

触发此 Skill 时，执行以下流程：

### 1. 检查知识库
读取 `memory/knowledge.md` 中的 `refresh_after` 日期，若已过期，调用 mcporter 重新获取腾讯文档内容并更新文件。

### 2. 确认 iOA 登录
用 agent-browser 打开 AiSee 列表页，检查是否已登录。若未登录，找到「发起验证」按钮点击，等待用户手机 iOA 确认。

### 3. 抓取未回复问题
在 AiSee 列表页用 JS 提取所有 `data-row-key`（fid）和对应的问题文本、回复状态、提交时间。
过滤出状态不含「已回复」的条目。

### 4. 生成回复建议
按以下优先级匹配：
1. 含「企微/企业微信/企微文档」→ 模板C
2. 含「会员/退费/发票/开票/充值/付费/订单/退款」→ 模板B
3. 可在功能指引中匹配到精准内容（关键词得分 ≥ 2）→ 按指引回复
4. 其他 / 无法匹配 / 外文 → 模板A

### 5. 生成 HTML 工具页
使用 `run.js` 中 `buildHTML()` 函数生成，输出到 `output/reply_tool.html`。
必须保持以下风格和功能：
- 深色渐变 header（紫色 #667eea → #764ba2）
- 指标卡（总条数/已回复/待回复/失败）动态计算，**总条数 = data.length**
- 答案区域可直接编辑（textarea）
- 点击「确认并回复」→ 立即 POST 到 reply_server → 实时回复
- 回复成功/失败状态用 localStorage 落盘，刷新后恢复

### 6. 启动服务
确保以下两个服务正在运行：
- 静态服务：端口 3399（serve 或 http-server）
- 回复服务：`node reply_server.js`（端口 3400）

### 7. 发送企微通知
通过 `CONFIG.WECOM_WEBHOOK` 发送 markdown 消息，包含：
- 一句非常暖心的话 + emoji
- 待回复问题数量
- 工具链接 `http://localhost:3399/output/reply_tool.html`

## File Structure

```
aisee-reply-skill/
├── SKILL.md          # 本文件
├── README.md         # 安装和配置说明
├── run.js            # 主执行脚本
├── reply_server.js   # 浏览器驱动回复服务（端口3400）
├── memory/
│   ├── knowledge.md  # 功能指引知识库（含回复模板A/B/C，90天自动刷新）
│   └── snapshot_YYYY-MM-DD.json  # 每次运行的数据快照
└── output/
    └── reply_tool.html  # 生成的回复确认工具页
```

## Configuration

在 `run.js` 的 `CONFIG` 对象中修改：

| 字段 | 说明 |
|------|------|
| `AISEE_LIST` | AiSee 列表页 URL（含 product/bot/page ID） |
| `AISEE_DETAIL` | AiSee 详情页 URL |
| `WECOM_WEBHOOK` | 企业微信群机器人 Webhook 地址 |
| `BROWSER` | agent-browser 可执行文件路径 |
| `KNOWLEDGE_REFRESH_DAYS` | 知识库刷新周期（默认90天） |
| `REPLY_PORT` | 回复服务端口（默认3400） |
| `STATIC_PORT` | 静态服务端口（默认3399） |

## Reply Templates

### 模板A（默认兜底）
> 适用：FAQ 无匹配 / 不明确 / 外文

### 模板B（会员/发票类）
> 触发词：会员、退费、发票、开票、充值、付费、订单、退款

### 模板C（企微类）
> 触发词：企微、企业微信、企微文档
