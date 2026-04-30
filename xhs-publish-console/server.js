import http from "node:http";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, "..");
const publicDir = path.join(__dirname, "public");
const sourceMdPath = path.join(projectDir, "publish_source.md");
const sourceJsonPath = path.join(projectDir, "publish_source.json");
const importStatePath = path.join(projectDir, "publish_thread_import_state.json");
const runRequestPath = path.join(projectDir, "publish_run_request.json");
const latestRunPath = path.join(projectDir, "publish_latest_run.json");
const configPath = path.join(__dirname, "config.json");
const runnerPath = path.join(__dirname, "runner.js");
const defaultCopyThreadId = process.env.XHS_COPY_THREAD_ID || "019dd40f-df25-7692-afeb-b924d061d6f9";
const defaultCodexStateDbPath = process.env.CODEX_STATE_DB_PATH || path.join(os.homedir(), ".codex", "state_5.sqlite");
const autoImportIntervalMs = 5000;
let runnerProcess = null;
let autoImportInFlight = false;

const headings = ["封面提示词", "标题", "内文"];
const executionRules = [
  "只连接人工登录 Chrome 调试端口 http://127.0.0.1:9222，禁止启动未登录的自动化 Chrome。",
  "遇到 ChatGPT 人机验证页时必须停止，提示用户手动处理，不绕过验证。",
  "ChatGPT 页面必须完全加载且输入框稳定后才能输入封面提示词，禁止页面还在刷新时抢跑输入。",
  "输入封面提示词后必须二次校验，确认文字没有被页面刷新清空。",
  "发送成功的标准是 ChatGPT 页面正文里出现本次封面提示词，不是只点击了发送按钮。",
  "生图前必须记录页面已有图片 src，下载时只接受新出现的图片，禁止把旧图改名当新图。",
  "正式生图流程禁止使用 --skip-image；调试时必须显式追加 --allow-skip-image。",
  "图片生成后只上传到图片存储并推送微信，禁止打开或填写小红书发布页。"
];
const execFileAsync = promisify(execFile);

function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(text)
  });
  res.end(text);
}

function parseMarkdown(text) {
  const matches = [...text.matchAll(/^#\s*(封面提示词|标题|内文)\s*$/gm)];
  const sections = {};
  for (let i = 0; i < matches.length; i += 1) {
    const key = matches[i][1];
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    sections[key] = text.slice(start, end).trim();
  }
  return {
    coverPrompt: sections["封面提示词"] || "",
    title: sections["标题"] || "",
    body: sections["内文"] || ""
  };
}

function toMarkdown(source) {
  return [
    "# 封面提示词",
    source.coverPrompt.trim(),
    "",
    "# 标题",
    source.title.trim(),
    "",
    "# 内文",
    source.body.trim(),
    ""
  ].join("\n");
}

function validateSource(source) {
  const errors = [];
  if (!source.coverPrompt?.trim()) errors.push("封面提示词不能为空");
  if (!source.title?.trim()) errors.push("标题不能为空");
  if (!source.body?.trim()) errors.push("内文不能为空");
  if ([source.coverPrompt, source.title, source.body].some((value) => /请把|粘贴到这里/.test(value || ""))) {
    errors.push("内容仍包含模板占位文字");
  }
  if ((source.title || "").trim().length > 20) errors.push("标题超过 20 字，可能不适合小红书展示");
  if ((source.body || "").trim().length > 1000) errors.push("内文超过 1000 字，可能不适合小红书展示");
  return errors;
}

function normalizeImportedText(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function contentHash(source) {
  const normalized = [
    normalizeImportedText(source.title),
    normalizeImportedText(source.body),
    normalizeImportedText(source.coverPrompt)
  ].join("\n---\n");
  return createHash("sha256").update(normalized).digest("hex");
}

function stripFences(text) {
  return String(text || "").replace(/^```[^\n]*\n?|\n?```$/g, "").trim();
}

function stripHeartbeat(text) {
  return String(text || "").replace(/\n*<heartbeat>[\s\S]*?<\/heartbeat>\s*$/i, "").trim();
}

function cleanTitleLine(line) {
  return normalizeImportedText(line)
    .replace(/^\s*(?:[-*]|\d+[.、)]|标题\s*\d*[:：])\s*/i, "")
    .replace(/【推荐】/g, "")
    .trim();
}

function pickTitle(text) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const picked = lines.find((line) => line.includes("【推荐】")) || lines[0] || "";
  return cleanTitleLine(picked);
}

function boldSections(message) {
  const matches = [...message.matchAll(/^\s*\*\*([^*\n]+)\*\*\s*$/gm)];
  const sections = {};
  for (let i = 0; i < matches.length; i += 1) {
    const key = matches[i][1].trim();
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : message.length;
    sections[key] = message.slice(start, end).trim();
  }
  return sections;
}

function firstCoverPrompt(text) {
  const cleaned = normalizeImportedText(text);
  const match = cleaned.match(/(?:^|\n)\s*1[.、)]\s*封面图\s*\n([\s\S]*?)(?=\n\s*2[.、)]\s*|\n\s*\d+[.、)]\s*|$)/);
  if (match) return normalizeImportedText(match[1]);
  const fallback = cleaned.match(/封面图\s*\n([\s\S]*?)(?=\n\s*2[.、)]\s*|$)/);
  return fallback ? normalizeImportedText(fallback[1]) : "";
}

function parseAgentCandidate(message) {
  const text = stripFences(message);
  const sections = boldSections(text);
  const direct = {
    title: pickTitle(sections["标题"] || ""),
    body: stripHeartbeat(sections["内文"] || ""),
    coverPrompt: normalizeImportedText(sections["封面提示词"] || "")
  };
  if (direct.title && direct.body && direct.coverPrompt) return direct;

  const imagePrompts = sections["6张图AI提示词"] || sections["6 张图AI提示词"] || sections["6张图 AI 提示词"] || "";
  const titles = sections["标题3个"] || sections["标题 3 个"] || sections["标题"] || "";
  const carousel = {
    title: pickTitle(titles),
    body: stripHeartbeat(sections["内文"] || ""),
    coverPrompt: firstCoverPrompt(imagePrompts)
  };
  return carousel.title && carousel.body && carousel.coverPrompt ? carousel : null;
}

async function rolloutPathFromSqlite() {
  const config = await readJsonFile(configPath, {});
  const copyThreadId = config.copyThreadId || defaultCopyThreadId;
  const codexStateDbPath = config.codexStateDbPath || defaultCodexStateDbPath;
  const { stdout } = await execFileAsync("sqlite3", [
    codexStateDbPath,
    "select rollout_path from threads where id = '" + copyThreadId.replace(/'/g, "''") + "' limit 1;"
  ]);
  const rolloutPath = stdout.trim();
  if (!rolloutPath) throw new Error("未找到文案线程 rollout 路径");
  return rolloutPath;
}

async function importLatestFromThread() {
  const rolloutPath = await rolloutPathFromSqlite();
  const previousState = await readJsonFile(importStatePath, null);
  const startLine = previousState?.threadId === copyThreadId ? Number(previousState.lastSeenLine || 0) : 0;
  let lineNo = 0;
  let latestCandidate = null;
  const reader = readline.createInterface({
    input: createReadStream(rolloutPath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  for await (const line of reader) {
    lineNo += 1;
    if (lineNo <= startLine) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "event_msg" || entry.payload?.type !== "agent_message") continue;
    const candidate = parseAgentCandidate(entry.payload.message || "");
    if (candidate) latestCandidate = { source: candidate, lineNo };
  }

  const baseState = {
    threadId: copyThreadId,
    rolloutPath,
    lastSeenLine: lineNo,
    lastAcceptedLine: previousState?.lastAcceptedLine || 0,
    contentHash: previousState?.contentHash || "",
    lastAcceptedAt: previousState?.lastAcceptedAt || ""
  };

  if (!latestCandidate) {
    await fs.writeFile(importStatePath, JSON.stringify(baseState, null, 2), "utf8");
    return { imported: false, reason: "no_new", state: baseState };
  }

  const normalized = {
    coverPrompt: normalizeImportedText(latestCandidate.source.coverPrompt),
    title: normalizeImportedText(latestCandidate.source.title),
    body: normalizeImportedText(latestCandidate.source.body)
  };
  const hash = contentHash(normalized);
  if (hash === previousState?.contentHash) {
    await fs.writeFile(importStatePath, JSON.stringify(baseState, null, 2), "utf8");
    return { imported: false, reason: "duplicate", source: normalized, state: baseState };
  }

  const errors = validateSource(normalized);
  if (errors.length) return { imported: false, reason: "invalid", errors, source: normalized, state: baseState };

  const acceptedState = {
    ...baseState,
    lastAcceptedLine: latestCandidate.lineNo,
    contentHash: hash,
    lastAcceptedAt: new Date().toISOString()
  };
  await fs.writeFile(sourceMdPath, toMarkdown(normalized), "utf8");
  await fs.writeFile(sourceJsonPath, JSON.stringify({ ...normalized, updatedAt: acceptedState.lastAcceptedAt }, null, 2), "utf8");
  await fs.writeFile(importStatePath, JSON.stringify(acceptedState, null, 2), "utf8");
  return { imported: true, source: normalized, state: acceptedState };
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function readSource() {
  try {
    const markdown = await fs.readFile(sourceMdPath, "utf8");
    return parseMarkdown(markdown);
  } catch {
    return { coverPrompt: "", title: "", body: "" };
  }
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function buildRunRequest() {
  return {
    status: "ready",
    createdAt: new Date().toISOString(),
    sourceMdPath,
    sourceJsonPath,
    configPath,
    executionRules,
    runPolicy: {
      imageGenerationPreApproved: true,
      xhsAutomationDisabled: true
    }
  };
}

async function validateRunInputs() {
  const source = await readSource();
  const config = await readJsonFile(configPath, {});
  const errors = validateSource(source);
  if (!config.gptImageChatUrl) errors.push("请先填写指定 GPT 生图会话 URL");
  return { source, config, errors };
}

async function writeRunRequest() {
  const request = buildRunRequest();
  await fs.writeFile(runRequestPath, JSON.stringify(request, null, 2), "utf8");
  return request;
}

async function startRunnerProcess() {
  if (runnerProcess && !runnerProcess.killed && runnerProcess.exitCode === null) {
    return { pid: runnerProcess.pid, alreadyRunning: true };
  }

  await fs.writeFile(latestRunPath, JSON.stringify({
    status: "running",
    updatedAt: new Date().toISOString(),
    xhsAutomationDisabled: true
  }, null, 2), "utf8");

  runnerProcess = execFile(process.execPath, [runnerPath], {
    cwd: __dirname,
    windowsHide: true
  }, async (error) => {
    runnerProcess = null;
    if (!error) return;
    await fs.writeFile(latestRunPath, JSON.stringify({
      status: "failed",
      updatedAt: new Date().toISOString(),
      error: error.message,
      xhsAutomationDisabled: true
    }, null, 2), "utf8").catch(() => {});
  });
  runnerProcess.unref();
  return { pid: runnerProcess.pid, alreadyRunning: false };
}

async function startRunFromCurrentSource() {
  const { errors } = await validateRunInputs();
  if (errors.length) return { started: false, errors };
  const request = await writeRunRequest();
  const runner = await startRunnerProcess();
  return { started: !runner.alreadyRunning, request, ...runner };
}

async function autoImportAndRunOnce() {
  if (autoImportInFlight) return;
  autoImportInFlight = true;
  try {
    const result = await importLatestFromThread();
    if (!result.imported) return;
    const run = await startRunFromCurrentSource();
    const status = {
      updatedAt: new Date().toISOString(),
      import: result,
      run
    };
    await fs.writeFile(path.join(projectDir, "auto_import_latest_run.json"), JSON.stringify(status, null, 2), "utf8");
  } catch (error) {
    await fs.writeFile(path.join(projectDir, "auto_import_latest_run.json"), JSON.stringify({
      updatedAt: new Date().toISOString(),
      error: error.message
    }, null, 2), "utf8").catch(() => {});
  } finally {
    autoImportInFlight = false;
  }
}

async function latestImage(downloadDir) {
  const names = await fs.readdir(downloadDir);
  const imageFiles = [];
  for (const name of names) {
    if (!/\.(png|jpe?g|webp)$/i.test(name)) continue;
    const fullPath = path.join(downloadDir, name);
    const stat = await fs.stat(fullPath);
    imageFiles.push({ name, path: fullPath, modifiedAt: stat.mtime.toISOString(), size: stat.size });
  }
  imageFiles.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
  return imageFiles[0] || null;
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/source" && req.method === "GET") {
    const source = await readSource();
    return sendJson(res, 200, { source, errors: validateSource(source), paths: { sourceMdPath, sourceJsonPath } });
  }

  if (url.pathname === "/api/source" && req.method === "POST") {
    const { source } = await readRequestBody(req);
    const normalized = {
      coverPrompt: source?.coverPrompt || "",
      title: source?.title || "",
      body: source?.body || ""
    };
    const errors = validateSource(normalized);
    if (errors.length) return sendJson(res, 422, { errors });
    await fs.writeFile(sourceMdPath, toMarkdown(normalized), "utf8");
    await fs.writeFile(sourceJsonPath, JSON.stringify({ ...normalized, updatedAt: new Date().toISOString() }, null, 2), "utf8");
    return sendJson(res, 200, { ok: true, paths: { sourceMdPath, sourceJsonPath } });
  }

  if (url.pathname === "/api/import-thread-latest" && req.method === "POST") {
    const result = await importLatestFromThread();
    if (result.errors?.length) return sendJson(res, 422, result);
    return sendJson(res, 200, result);
  }

  if (url.pathname === "/api/config" && req.method === "GET") {
    const config = await readJsonFile(configPath, {});
    return sendJson(res, 200, { config, executionRules, path: configPath });
  }

  if (url.pathname === "/api/config" && req.method === "POST") {
    const { config } = await readRequestBody(req);
    const currentConfig = await readJsonFile(configPath, {});
    const nextConfig = {
      gptImageChatUrl: String(config?.gptImageChatUrl || "").trim(),
      downloadDir: String(config?.downloadDir || path.join(os.homedir(), "Downloads")).trim(),
      autoRefreshSeconds: Number(config?.autoRefreshSeconds || 90),
      maxImageRetries: Number(config?.maxImageRetries || 2),
      defaultDraftAuthorization: Boolean(config?.defaultDraftAuthorization),
      enableWechatPush: Boolean(config?.enableWechatPush),
      pushplusToken: String(config?.pushplusToken || currentConfig.pushplusToken || "").trim(),
      storageProvider: String(config?.storageProvider || currentConfig.storageProvider || "aliyunOss").trim(),
      aliyunOss: {
        accessKeyId: String(config?.aliyunOss?.accessKeyId || currentConfig.aliyunOss?.accessKeyId || "").trim(),
        accessKeySecret: String(config?.aliyunOss?.accessKeySecret || currentConfig.aliyunOss?.accessKeySecret || "").trim(),
        bucket: String(config?.aliyunOss?.bucket || currentConfig.aliyunOss?.bucket || "").trim(),
        region: String(config?.aliyunOss?.region || currentConfig.aliyunOss?.region || "").trim(),
        endpoint: String(config?.aliyunOss?.endpoint || currentConfig.aliyunOss?.endpoint || "").trim(),
        domain: String(config?.aliyunOss?.domain || currentConfig.aliyunOss?.domain || "").trim(),
        keyPrefix: String(config?.aliyunOss?.keyPrefix || currentConfig.aliyunOss?.keyPrefix || "xhs-covers").trim()
      },
      qiniu: {
        accessKey: String(config?.qiniu?.accessKey || currentConfig.qiniu?.accessKey || "").trim(),
        secretKey: String(config?.qiniu?.secretKey || currentConfig.qiniu?.secretKey || "").trim(),
        bucket: String(config?.qiniu?.bucket || currentConfig.qiniu?.bucket || "").trim(),
        domain: String(config?.qiniu?.domain || currentConfig.qiniu?.domain || "").trim(),
        uploadUrl: String(config?.qiniu?.uploadUrl || currentConfig.qiniu?.uploadUrl || "https://upload.qiniup.com").trim(),
        keyPrefix: String(config?.qiniu?.keyPrefix || currentConfig.qiniu?.keyPrefix || "xhs-covers").trim()
      },
      browser: config?.browser || currentConfig.browser || {
        connectOverCDP: true,
        remoteDebuggingUrl: "http://127.0.0.1:9222"
      }
    };
    await fs.writeFile(configPath, JSON.stringify(nextConfig, null, 2), "utf8");
    return sendJson(res, 200, { ok: true, config: nextConfig, path: configPath });
  }

  if (url.pathname === "/api/latest-image" && req.method === "GET") {
    const config = await readJsonFile(configPath, {});
    try {
      return sendJson(res, 200, { image: await latestImage(config.downloadDir || path.join(os.homedir(), "Downloads")) });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

  if (url.pathname === "/api/run-request" && req.method === "POST") {
    const { errors } = await validateRunInputs();
    if (errors.length) return sendJson(res, 422, { errors });
    const request = await writeRunRequest();
    return sendJson(res, 200, { ok: true, request, path: runRequestPath });
  }

  if (url.pathname === "/api/run-now" && req.method === "POST") {
    const result = await startRunFromCurrentSource();
    if (result.errors?.length) return sendJson(res, 422, { errors: result.errors });
    return sendJson(res, 200, { ok: true, ...result, latestRunPath });
  }

  return sendJson(res, 404, { error: "Not found" });
}

async function handleStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) return sendText(res, 403, "Forbidden");
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const type = ext === ".css" ? "text/css; charset=utf-8" : ext === ".js" ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  } catch {
    sendText(res, 404, "Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return await handleStatic(req, res, url);
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
});

const port = Number(process.env.PORT || 5178);
server.listen(port, "127.0.0.1", () => {
  console.log(`XHS publish console running at http://127.0.0.1:${port}`);
  setInterval(() => {
    autoImportAndRunOnce();
  }, autoImportIntervalMs).unref();
  autoImportAndRunOnce();
});
