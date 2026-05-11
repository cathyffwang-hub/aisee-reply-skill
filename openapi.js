#!/usr/bin/env node
/**
 * AiSee OpenAPI 模块
 *
 * 封装 AiSee Open API 的 RSA 签名认证和所有 HTTP 接口调用。
 * 不依赖浏览器、cookie 或 iOA，通过 Secret-Id + RSA 公钥加密实现服务端认证。
 *
 * 参考文档：
 * - 接入指引：https://iwiki.woa.com/p/4013089394
 * - 接口列表：https://iwiki.woa.com/p/4013089395
 */

const crypto = require('crypto');
const https = require('https');
const http = require('http');

const API_BASE = 'https://api.tone.woa.com';

// ===== RSA 签名 =====
function makeSign(secretId, appId, publicKey) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const data = `Secret-Id=${secretId}&App-Id=${appId}&Timestamp=${timestamp}`;
  const publicPem = `-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----`;
  const key = crypto.createPublicKey(publicPem);
  const encrypted = crypto.publicEncrypt(
    { key, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(encodeURIComponent(data))
  );
  const sign = encrypted.toString('base64').replace(/[\s*\t\n\r]/g, '');
  return { timestamp, sign };
}

// ===== 构造请求头 =====
function makeHeaders(config) {
  const { timestamp, sign } = makeSign(config.secretId, config.appId, config.publicKey);
  return {
    'Secret-Id': config.secretId,
    'App-Id': config.appId,
    'Timestamp': timestamp,
    'Sign': sign,
    'Content-Type': 'application/json',
  };
}

// ===== 通用 HTTP POST =====
function apiPost(path, body, config) {
  return new Promise((resolve, reject) => {
    const headers = makeHeaders(config);
    const payload = JSON.stringify(body);
    headers['Content-Length'] = Buffer.byteLength(payload);

    const url = new URL(path, API_BASE);
    const mod = url.protocol === 'https:' ? https : http;

    const req = mod.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers,
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.code && json.code !== 0 && json.code !== 200) {
            reject(new Error(`API error ${json.code}: ${json.message || json.msg || JSON.stringify(json)}`));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(new Error(`API parse error: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', e => reject(new Error(`API request error: ${e.message}`)));
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('API timeout (30s)')); });
    req.write(payload);
    req.end();
  });
}

// ===== 1. 获取反馈列表 =====
/**
 * @param {object} config - { secretId, appId, publicKey }
 * @param {object} opts - { beginTime, endTime, curPage, pageSize, reply_status, status, ... }
 * @returns {Promise<{total: number, feedbacks: Array}>}
 */
async function getFeedbacks(config, opts = {}) {
  const now = Date.now();
  const body = {
    beginTime: opts.beginTime || String(now - 7 * 24 * 3600 * 1000),
    endTime: opts.endTime || String(now),
    curPage: opts.curPage || 1,
    pageSize: opts.pageSize || 100,
  };
  // 可选过滤参数
  if (opts.reply_status !== undefined) body.reply_status = String(opts.reply_status);
  if (opts.status !== undefined) body.status = String(opts.status);
  if (opts.status_list) body.status_list = opts.status_list;
  if (opts.fids) body.fids = opts.fids;
  if (opts.keyword) body.keyword = opts.keyword;
  if (opts.keyword_search_type) body.keyword_search_type = opts.keyword_search_type;
  if (opts.is_export_reply) body.is_export_reply = opts.is_export_reply;

  const result = await apiPost('/aisee/v1/openapi/getFeedbacks', body, config);
  return result.data || { total: 0, feedbacks: [] };
}

// ===== 2. 获取单条反馈 =====
async function getFeedback(config, fid) {
  const result = await apiPost('/aisee/v1/openapi/getFeedback', { fid }, config);
  return result.data;
}

// ===== 3. 获取反馈回复列表 =====
async function getFeedbackReplies(config, fid) {
  const result = await apiPost('/aisee/v1/openapi/getFeedbackReplies', { fid }, config);
  return result.data;
}

// ===== 4. 发送回复 =====
/**
 * @param {object} config - { secretId, appId, publicKey, userName }
 * @param {string} fid - 反馈 ID
 * @param {string} content - 回复内容
 * @param {string} userId - 提交反馈的用户 ID（从反馈数据的 user_id 字段获取）
 * @returns {Promise<object>}
 */
async function sendReply(config, fid, content, userId) {
  const body = {
    fid,
    content,
    user_id: userId,
    user_name: config.userName || config.secretId,
    create_time: String(Date.now()),
    remark: '回复',
    replyContentType: 0,
  };
  return apiPost('/aisee/v1/openapi/sendFeedbackReply', body, config);
}

// ===== 5. 修改反馈（用于设置标签等）=====
/**
 * @param {object} config - { secretId, appId, publicKey }
 * @param {string[]} fidList - 反馈 ID 列表
 * @param {object} sysField - 系统字段修改，如 { user_tags: [tagId] }
 * @param {object} customField - 自定义字段修改
 * @returns {Promise<object>}
 */
async function modifyFeedback(config, fidList, sysField = {}, customField = {}) {
  const body = {
    app_id: config.appId,
    fid_list: fidList,
    sys_field: sysField,
    custom_field: customField,
    remark: '自动修改',
  };
  return apiPost('/aisee/v1/openapi/modifyFeedback', body, config);
}

// ===== 便捷方法：拉取所有未回复反馈（自动翻页）=====
async function getAllUnrepliedFeedbacks(config, opts = {}) {
  const pageSize = 100;
  let curPage = 1;
  let allFeedbacks = [];

  while (true) {
    const data = await getFeedbacks(config, {
      ...opts,
      reply_status: 0,  // 待回复
      curPage,
      pageSize,
    });

    if (data.feedbacks && data.feedbacks.length > 0) {
      allFeedbacks = allFeedbacks.concat(data.feedbacks);
    }

    if (!data.feedbacks || data.feedbacks.length < pageSize || allFeedbacks.length >= (data.total || 0)) {
      break;
    }

    curPage++;
    // 安全上限，避免死循环
    if (curPage > 50) break;
  }

  return allFeedbacks;
}

module.exports = {
  makeSign,
  makeHeaders,
  apiPost,
  getFeedbacks,
  getFeedback,
  getFeedbackReplies,
  sendReply,
  modifyFeedback,
  getAllUnrepliedFeedbacks,
};
