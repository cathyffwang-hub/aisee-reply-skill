# aisee-reply-skill

## Description

AiSee 反馈自动回复工具。适用于腾讯文档企业版 AiSee 反馈平台的定期回复场景。

触发关键词：aisee 回复、反馈回复、处理 aisee 问题、打开回复工具、运行回复流程

## Capabilities

- 自动抓取 AiSee **目标日期当天**（默认昨日）未回复的用户反馈（严格按日期过滤）
- 按内置模板规则（A/B/C/D）+ 腾讯文档功能指引知识库，为每条问题生成回复建议
- 生成可编辑回复确认网页（答案可改，点击确认即实时驱动浏览器回复，状态 localStorage 落盘）
- 自动检查并确保静态服务从 skill 目录正确启动（修复404问题）
- 企业微信通知（@指定账号 + 暖心话 + 工具链接），**同一天只推送一次（去重）**
- 知识库 90 天自动刷新机制
- iOA 登录：浏览器已有 session 直接跳过，无需手机确认；未登录自动发起验证并轮询等待

## Usage

触发此 Skill 时，执行以下流程：

### 0. 确保静态服务正确启动
检查 3399 端口服务的工作目录是否为 skill 目录（`~/.workbuddy/skills/aisee-reply-skill`）。
若不是，杀掉旧进程，重新从 skill 目录以 `npx serve . -p 3399` 启动（detached）。

### 1. 检查知识库
读取 `memory/knowledge.md` 中的 `refresh_after` 日期，若已过期，通过 mcporter 逐个获取 `CONFIG.KNOWLEDGE_DOCS` 列表中的所有文档源并合并更新。

**当前知识库文档源（8个）：**
1. 企微SaaS文档-产品知识帮助中心（`DTEVpVGZJR3B6QUlw`）
2. 腾讯文档企业版(私有化)用户使用手册1.11（`DTG9VUFNvWGpnRnRB`）
3. 腾讯文档企业版(私有化)管理员使用手册1.11（`DTGFscUZIaGREa2tH`）
4. 智能文档撰写方法与排版技巧（`DTFBDUldXRFRvU0lk`）
5. 腾讯文档企业版-智能文档使用手册（`DTHJwU09HTWVrV29h`）
6. 腾讯文档企业版-智能表格使用手册（`DTGlwcndCZmNmZEJW`）
7. 企业版(私有化)更新日志2025（`DTHRVYlpvYUJLalVX`）
8. 腾讯文档企业版AI能力简介（`DTHZpWHJjdEFyYm1n`）

### 2. 确认 iOA 登录
用 agent-browser 打开 AiSee 列表页：
- **已登录**（URL 含 `aisee.woa.com/admin`）→ 直接继续，无需任何手机操作
- **未登录** → 找到「发起验证」按钮点击，每5秒轮询一次，最多等待60秒

### 3. 抓取未回复问题（严格日期过滤）
在 AiSee 列表页用 JS 提取所有 `data-row-key`（fid）和对应的问题文本、回复状态、提交时间。

**双重过滤条件（必须同时满足）：**
1. `time` 字段前10位 === `targetDate`（默认为昨日，即只处理当天提交的）
2. 状态不含「已回复」

### 4. 生成回复建议
按以下优先级匹配：

| 优先级 | 触发条件 | 使用模板 |
|--------|----------|----------|
| 1 | 含「企微/企业微信/企微文档」 | 模板C |
| 2 | 含「会员/退费/发票/开票/充值/付费/订单/退款/vip」 | 模板B |
| 3 | 知识库功能指引精准匹配（标题命中加权，阈值动态调整）| 按指引回复 |
| 4 | 问题明确（中文字符≥8，非个人版关键词）| 模板D |
| 5 | 问题不明确 / 疑似个人版 / 外文 | 模板A |

### 5. 生成 HTML 工具页
使用 `run.js` 中 `buildHTML()` 函数生成，输出到 `output/reply_tool.html`。
必须保持以下风格和功能：
- 深色渐变 header（紫色 #667eea → #764ba2）
- 指标卡（总条数/已回复/待回复/失败）动态计算，**总条数 = data.length**
- 答案区域可直接编辑（textarea）
- 点击「确认并回复」→ 立即 POST 到 reply_server → 实时回复
- 回复成功/失败状态用 localStorage 落盘，刷新后恢复

### 6. 确保服务运行
- 静态服务：端口 3399，**根目录必须是 skill 目录**（步骤0已自动保证）
- 回复服务：`node reply_server.js`（端口 3400）

### 7. 发送企微通知（去重）
检查 `memory/notify_lock.json` 中记录的日期：
- 若当天已推过 → 跳过，打印日志提示
- 若未推过 → 通过 `CONFIG.WECOM_WEBHOOK` 发送 markdown 消息，推送后写入 lock 文件

推送内容包含：
- `<@userid>` @指定账号（支持多人，逗号分隔）
- 一句暖心话 + emoji
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
│   ├── knowledge.md        # 功能指引知识库（含回复模板A/B/C/D，90天自动刷新）
│   ├── notify_lock.json    # 企微通知去重锁（记录当天是否已推送）
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
| `WECOM_MENTION_USERID` | 企微 @人的 userid，多人逗号分隔，留空不@（当前：`cathyfwang`） |
| `BROWSER` | agent-browser 可执行文件路径 |
| `KNOWLEDGE_REFRESH_DAYS` | 知识库刷新周期（默认90天） |
| `REPLY_PORT` | 回复服务端口（默认3400） |
| `STATIC_PORT` | 静态服务端口（默认3399） |
| `NOTIFY_LOCK_FILE` | 企微通知去重文件路径 |

也支持通过环境变量覆盖：`WECOM_WEBHOOK`、`WECOM_MENTION_USERID`

## Reply Templates

### 模板A（问题不明确/疑似个人版/外文）
> 适用：无法判断版本 / 问题描述不清 / 外语提交

### 模板B（会员/发票类）
> 触发词：会员、退费、发票、开票、充值、付费、订单、退款、vip

### 模板C（企微类）
> 触发词：企微、企业微信、企微文档

### 模板D（企业版功能性问题兜底）
> 适用：问题明确（中文字符≥8），知识库无精准匹配，属于企业版功能范畴
> 内容：告知已记录，将安排跟进，可联系企微小助手

### 知识库精准匹配（优先于模板D）
> 按功能块切割知识库，关键词命中+标题加权评分，阈值动态调整（问题≥4词时需≥2分）
