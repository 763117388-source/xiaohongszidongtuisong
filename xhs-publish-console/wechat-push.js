import { createHmac } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OSS from "ali-oss";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultQiniuUploadUrl = "https://upload.qiniup.com";

function storageProvider(config = {}) {
  return config.storageProvider || (config.aliyunOss ? "aliyunOss" : "qiniu");
}

function normalizeQiniuConfig(config = {}) {
  return config.qiniu || {
    accessKey: config.qiniuAccessKey,
    secretKey: config.qiniuSecretKey,
    bucket: config.qiniuBucket,
    domain: config.qiniuDomain,
    uploadUrl: config.qiniuUploadUrl,
    keyPrefix: config.qiniuKeyPrefix
  };
}

function normalizeAliyunOssConfig(config = {}) {
  return config.aliyunOss || {
    accessKeyId: config.aliyunOssAccessKeyId,
    accessKeySecret: config.aliyunOssAccessKeySecret,
    bucket: config.aliyunOssBucket,
    region: config.aliyunOssRegion,
    endpoint: config.aliyunOssEndpoint,
    domain: config.aliyunOssDomain,
    keyPrefix: config.aliyunOssKeyPrefix
  };
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateWechatPushConfig(config = {}) {
  const missing = [];
  if (!nonEmpty(config.pushplusToken)) missing.push("pushplusToken");

  if (storageProvider(config) === "aliyunOss") {
    const aliyunOss = normalizeAliyunOssConfig(config);
    if (!nonEmpty(aliyunOss.accessKeyId)) missing.push("aliyunOss.accessKeyId");
    if (!nonEmpty(aliyunOss.accessKeySecret)) missing.push("aliyunOss.accessKeySecret");
    if (!nonEmpty(aliyunOss.bucket)) missing.push("aliyunOss.bucket");
    if (!nonEmpty(aliyunOss.region)) missing.push("aliyunOss.region");
    if (!nonEmpty(aliyunOss.endpoint)) missing.push("aliyunOss.endpoint");
    return missing;
  }

  const qiniu = normalizeQiniuConfig(config);
  if (!nonEmpty(qiniu.accessKey)) missing.push("qiniu.accessKey");
  if (!nonEmpty(qiniu.secretKey)) missing.push("qiniu.secretKey");
  if (!nonEmpty(qiniu.bucket)) missing.push("qiniu.bucket");
  if (!nonEmpty(qiniu.domain)) missing.push("qiniu.domain");
  return missing;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function compactBodyLines(body) {
  const normalized = String(body || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim());
  const lines = [];
  let previousBlank = true;
  for (const line of normalized) {
    const blank = !line;
    if (blank && previousBlank) continue;
    lines.push(line);
    previousBlank = blank;
  }
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines;
}

export function buildPushplusHtml({ imageUrl, title, body }) {
  const bodyLines = compactBodyLines(body);
  const safeTitle = escapeHtml(title);
  const safeImageUrl = escapeHtml(imageUrl);
  const labelStyle = "margin:18px 0 8px;color:#202124;font-size:17px;font-weight:700;line-height:1.38;";
  const titleBlockStyle = "user-select:text;-webkit-user-select:text;margin:0 0 18px;line-height:1.38;font-size:17px;font-weight:700;color:#202124;";
  const bodyBlockStyle = "user-select:text;-webkit-user-select:text;margin:0;font-size:17px;font-weight:700;color:#202124;";
  const bodyLineStyle = "margin-bottom:2px;";
  const safeBody = bodyLines
    .map((line) => line
      ? `<div style="${bodyLineStyle}">${escapeHtml(line)}</div>`
      : `<div style="height:14px;"></div>`)
    .join("\n");
  return [
    `<p><img src="${safeImageUrl}" style="max-width:100%;height:auto;border-radius:8px;" /></p>`,
    `<div style="${labelStyle}">标题</div>`,
    `<div style="${titleBlockStyle}">${safeTitle}</div>`,
    `<div style="${labelStyle}">内文</div>`,
    `<div style="${bodyBlockStyle}">${safeBody}</div>`
  ].join("\n");
}

export function buildPushplusPayload({ token, title, body, imageUrl }) {
  return {
    token,
    title: arguments[0].notificationTitle || "新小红书图片已生成",
    content: buildPushplusHtml({ imageUrl, title, body }),
    template: "html"
  };
}

function localDateParts(now = new Date()) {
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate()
  };
}

function chineseOrdinal(value) {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const number = Number(value);
  if (number <= 10) return number === 10 ? "十" : digits[number];
  if (number < 20) return `十${digits[number % 10]}`;
  const tens = Math.floor(number / 10);
  const ones = number % 10;
  return `${digits[tens]}十${ones ? digits[ones] : ""}`;
}

export async function nextWechatPushTitle(sequencePath, options = {}) {
  const readFile = options.readFile || fs.readFile;
  const writeFile = options.writeFile || fs.writeFile;
  const { year, month, day } = localDateParts(options.now || new Date());
  const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  let previous = null;
  try {
    previous = JSON.parse(await readFile(sequencePath, "utf8"));
  } catch {
    previous = null;
  }
  const count = previous?.dateKey === dateKey ? Number(previous.count || 0) + 1 : 1;
  await writeFile(sequencePath, JSON.stringify({ dateKey, count }, null, 2), "utf8");
  return {
    title: `${month}月${day}日 小红书墨镜发布第${chineseOrdinal(count)}条`,
    dateKey,
    count
  };
}

function urlsafeBase64(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function qiniuUploadToken(qiniu, key, nowMs = Date.now()) {
  const policy = JSON.stringify({
    scope: `${qiniu.bucket}:${key}`,
    deadline: Math.floor(nowMs / 1000) + Number(qiniu.expires || 3600),
    returnBody: "{\"key\":\"$(key)\",\"hash\":\"$(etag)\",\"name\":\"$(fname)\",\"size\":$(fsize)}"
  });
  const encodedPolicy = urlsafeBase64(policy);
  const sign = createHmac("sha1", qiniu.secretKey).update(encodedPolicy).digest();
  const encodedSign = urlsafeBase64(sign);
  return `${qiniu.accessKey}:${encodedSign}:${encodedPolicy}`;
}

function imageContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

function buildQiniuKey(qiniu, imagePath, now = new Date()) {
  return buildStorageKey(qiniu.keyPrefix, imagePath, now);
}

function buildStorageKey(keyPrefix, imagePath, now = new Date(), randomSuffix = Math.random().toString(36).slice(2, 8)) {
  const prefix = String(keyPrefix || "xhs-covers").replace(/^\/+|\/+$/g, "");
  const ext = path.extname(imagePath).toLowerCase() || ".png";
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `${prefix}/${stamp}-${randomSuffix}${ext}`;
}

export function publicQiniuUrl(qiniu, key) {
  const base = String(qiniu.domain || "").replace(/\/+$/g, "");
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${base}/${encodedKey}`;
}

export function publicAliyunOssUrl(aliyunOss, key) {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const customDomain = String(aliyunOss.domain || "").trim().replace(/\/+$/g, "");
  if (customDomain) return `${customDomain}/${encodedKey}`;
  const endpoint = String(aliyunOss.endpoint || "").replace(/^https?:\/\//, "").replace(/\/+$/g, "");
  return `https://${aliyunOss.bucket}.${endpoint}/${encodedKey}`;
}

export async function uploadImageToQiniu(imagePath, config, options = {}) {
  const qiniu = normalizeQiniuConfig(config);
  const key = options.key || buildQiniuKey(qiniu, imagePath, options.now || new Date());
  const token = qiniuUploadToken(qiniu, key, options.nowMs);
  const uploadUrl = String(qiniu.uploadUrl || defaultQiniuUploadUrl).replace(/\/+$/g, "");
  const buffer = await fs.readFile(imagePath);
  const form = new FormData();
  form.append("token", token);
  form.append("key", key);
  form.append("file", new Blob([buffer], { type: imageContentType(imagePath) }), path.basename(imagePath));

  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(uploadUrl, { method: "POST", body: form });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`七牛上传失败 ${response.status}: ${text}`);
  }
  return { key, url: publicQiniuUrl(qiniu, key), response: text ? JSON.parse(text) : null };
}

export async function uploadImageToAliyunOss(imagePath, config, options = {}) {
  const aliyunOss = normalizeAliyunOssConfig(config);
  const key = options.key || buildStorageKey(
    aliyunOss.keyPrefix,
    imagePath,
    options.now || new Date(),
    options.randomSuffix
  );
  const createClient = options.createAliyunOssClient || ((clientOptions) => new OSS(clientOptions));
  const client = createClient({
    region: aliyunOss.region,
    endpoint: aliyunOss.endpoint,
    accessKeyId: aliyunOss.accessKeyId,
    accessKeySecret: aliyunOss.accessKeySecret,
    bucket: aliyunOss.bucket,
    secure: true
  });
  const response = await client.put(key, imagePath, {});
  const signedUrl = typeof client.signatureUrl === "function"
    ? client.signatureUrl(key, { expires: Number(aliyunOss.signedUrlExpires || 60 * 60 * 24 * 30) })
    : "";
  return { key, url: signedUrl || publicAliyunOssUrl(aliyunOss, key), response };
}

export async function uploadImageToStorage(imagePath, config, options = {}) {
  if (storageProvider(config) === "aliyunOss") {
    return await uploadImageToAliyunOss(imagePath, config, options);
  }
  return await uploadImageToQiniu(imagePath, config, options);
}

export async function sendPushplusMessage({ token, notificationTitle, title, body, imageUrl }, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl("https://www.pushplus.plus/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildPushplusPayload({ token, notificationTitle, title, body, imageUrl }))
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!response.ok || (data && data.code !== undefined && Number(data.code) !== 200)) {
    throw new Error(`PushPlus 推送失败 ${response.status}: ${text}`);
  }
  return data;
}

export async function pushDraftToWechat({ config, source, imagePath, log = () => {} }) {
  if (!config.enableWechatPush) {
    return { status: "skipped", reason: "disabled" };
  }

  const missing = validateWechatPushConfig(config);
  if (missing.length) {
    return { status: "skipped", reason: `missing_config:${missing.join(",")}` };
  }

  const stat = await fs.stat(imagePath).catch(() => null);
  if (!stat?.isFile()) {
    return { status: "skipped", reason: "missing_image" };
  }

  log(storageProvider(config) === "aliyunOss" ? "上传封面图到阿里云 OSS" : "上传封面图到七牛云");
  const uploaded = await uploadImageToStorage(imagePath, config);
  const sequencePath = config.wechatPushSequencePath || path.resolve(__dirname, "..", "wechat_push_sequence.json");
  const notification = await nextWechatPushTitle(sequencePath);
  log("发送 PushPlus 微信通知");
  const pushplus = await sendPushplusMessage({
    token: config.pushplusToken,
    notificationTitle: notification.title,
    title: source.title,
    body: source.body,
    imageUrl: uploaded.url
  });

  return { status: "sent", notificationTitle: notification.title, imageUrl: uploaded.url, storageKey: uploaded.key, provider: storageProvider(config), pushplus };
}
