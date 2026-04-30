import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, "..");

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const index = trimmed.indexOf("=");
  if (index < 0) return null;
  const key = trimmed.slice(0, index).trim();
  let value = trimmed.slice(index + 1).trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return key ? [key, value] : null;
}

export function loadDotEnv(envPath = path.join(__dirname, ".env")) {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

function envValue(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function hasEnv(name) {
  return process.env[name] !== undefined && process.env[name] !== "";
}

function numberEnv(name, fallback) {
  const raw = envValue(name, "");
  if (raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function resolveLocalPath(value, fallback) {
  const target = value || fallback;
  return path.isAbsolute(target) ? target : path.resolve(__dirname, target);
}

function regionFromEndpoint(endpoint) {
  const host = String(endpoint || "").replace(/^https?:\/\//, "").split("/")[0];
  const match = host.match(/^(oss-[a-z0-9-]+)/i);
  return match ? match[1] : "";
}

export function getRequiredEnv(name) {
  const value = process.env[name];
  if (value === undefined || String(value).trim() === "") {
    throw new Error(`缺少环境变量 ${name}`);
  }
  return String(value).trim();
}

export function assertConfig(requiredNames) {
  const names = Array.isArray(requiredNames) ? requiredNames : [requiredNames];
  return Object.fromEntries(names.map((name) => [name, getRequiredEnv(name)]));
}

const dataDir = resolveLocalPath(envValue("DATA_DIR", projectDir));
const aliyunOssEndpoint = envValue("ALIYUN_OSS_ENDPOINT", "").trim();

export const config = {
  port: numberEnv("PORT", 5178),
  dataDir,
  imageDir: resolveLocalPath(envValue("IMAGE_DIR", path.join(dataDir, "images"))),
  outputDir: resolveLocalPath(envValue("OUTPUT_DIR", dataDir)),
  pushplusToken: envValue("PUSHPLUS_TOKEN", "").trim(),
  aliyunOssAccessKeyId: envValue("ALIYUN_OSS_ACCESS_KEY_ID", "").trim(),
  aliyunOssAccessKeySecret: envValue("ALIYUN_OSS_ACCESS_KEY_SECRET", "").trim(),
  aliyunOssBucket: envValue("ALIYUN_OSS_BUCKET", "").trim(),
  aliyunOssRegion: envValue("ALIYUN_OSS_REGION", regionFromEndpoint(aliyunOssEndpoint)).trim(),
  aliyunOssEndpoint,
  aliyunOssPublicBaseUrl: envValue("ALIYUN_OSS_PUBLIC_BASE_URL", "").trim(),
  aliyunOssKeyPrefix: envValue("ALIYUN_OSS_KEY_PREFIX", "xhs-covers").trim(),
  pollIntervalMs: numberEnv("POLL_INTERVAL_MS", 5000),
  taskIntervalMs: numberEnv("TASK_INTERVAL_MS", numberEnv("POLL_INTERVAL_MS", 5000)),
  autoRefreshSeconds: numberEnv("AUTO_REFRESH_SECONDS", 90),
  imagePollMs: numberEnv("IMAGE_POLL_MS", 2000),
  maxImageRetries: numberEnv("MAX_IMAGE_RETRIES", 2),
  copyThreadId: envValue("XHS_COPY_THREAD_ID", "").trim(),
  codexStateDbPath: resolveLocalPath(envValue("CODEX_STATE_DB_PATH", path.join(process.env.HOME || projectDir, ".codex", "state_5.sqlite"))),
  gptImageChatUrl: envValue("GPT_IMAGE_CHAT_URL", "").trim(),
  storageProvider: envValue("STORAGE_PROVIDER", "aliyunOss").trim(),
  chromeRemoteDebuggingUrl: envValue("CHROME_REMOTE_DEBUGGING_URL", "http://127.0.0.1:9222").trim()
};

function envOverrides() {
  const overrides = {};
  const aliyunOss = {};
  const browser = {};

  if (config.gptImageChatUrl) overrides.gptImageChatUrl = config.gptImageChatUrl;
  if (config.copyThreadId) overrides.copyThreadId = config.copyThreadId;
  if (hasEnv("CODEX_STATE_DB_PATH")) overrides.codexStateDbPath = config.codexStateDbPath;
  if (hasEnv("IMAGE_DIR")) overrides.downloadDir = config.imageDir;
  if (hasEnv("AUTO_REFRESH_SECONDS")) overrides.autoRefreshSeconds = config.autoRefreshSeconds;
  if (hasEnv("IMAGE_POLL_MS")) overrides.imagePollMs = config.imagePollMs;
  if (hasEnv("MAX_IMAGE_RETRIES")) overrides.maxImageRetries = config.maxImageRetries;
  if (hasEnv("STORAGE_PROVIDER")) overrides.storageProvider = config.storageProvider;
  if (config.pushplusToken) overrides.pushplusToken = config.pushplusToken;
  if (config.aliyunOssAccessKeyId) aliyunOss.accessKeyId = config.aliyunOssAccessKeyId;
  if (config.aliyunOssAccessKeySecret) aliyunOss.accessKeySecret = config.aliyunOssAccessKeySecret;
  if (config.aliyunOssBucket) aliyunOss.bucket = config.aliyunOssBucket;
  if (config.aliyunOssRegion) aliyunOss.region = config.aliyunOssRegion;
  if (config.aliyunOssEndpoint) aliyunOss.endpoint = config.aliyunOssEndpoint;
  if (config.aliyunOssPublicBaseUrl) aliyunOss.domain = config.aliyunOssPublicBaseUrl;
  if (hasEnv("ALIYUN_OSS_KEY_PREFIX")) aliyunOss.keyPrefix = config.aliyunOssKeyPrefix;
  if (hasEnv("CHROME_REMOTE_DEBUGGING_URL")) {
    browser.connectOverCDP = true;
    browser.remoteDebuggingUrl = config.chromeRemoteDebuggingUrl;
  }
  if (Object.keys(aliyunOss).length) overrides.aliyunOss = aliyunOss;
  if (Object.keys(browser).length) overrides.browser = browser;

  return overrides;
}

export function mergeConfigFromEnv(fileConfig = {}) {
  const overrides = envOverrides();
  return {
    ...fileConfig,
    downloadDir: fileConfig.downloadDir || config.imageDir,
    autoRefreshSeconds: fileConfig.autoRefreshSeconds || config.autoRefreshSeconds,
    imagePollMs: fileConfig.imagePollMs || config.imagePollMs,
    maxImageRetries: fileConfig.maxImageRetries || config.maxImageRetries,
    storageProvider: fileConfig.storageProvider || config.storageProvider,
    codexStateDbPath: fileConfig.codexStateDbPath || config.codexStateDbPath,
    ...overrides,
    aliyunOss: {
      keyPrefix: config.aliyunOssKeyPrefix,
      ...(fileConfig.aliyunOss || {}),
      ...(overrides.aliyunOss || {})
    },
    browser: {
      connectOverCDP: true,
      remoteDebuggingUrl: config.chromeRemoteDebuggingUrl,
      ...(fileConfig.browser || {}),
      ...(overrides.browser || {})
    }
  };
}
