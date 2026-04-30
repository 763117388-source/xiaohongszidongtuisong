import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { config as envConfig, mergeConfigFromEnv } from "./env.js";
import { buildImageGeneratedRun } from "./runner-state.js";
import { pushDraftToWechat } from "./wechat-push.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, "..");
const configPath = path.join(__dirname, "config.json");
const sourceMdPath = path.join(envConfig.dataDir, "publish_source.md");
const runRequestPath = path.join(envConfig.outputDir, "publish_run_request.json");
const latestRunPath = path.join(envConfig.outputDir, "publish_latest_run.json");

const dryRun = process.argv.includes("--dry-run");
const skipImage = process.argv.includes("--skip-image");
const allowSkipImage = process.argv.includes("--allow-skip-image");

function log(message) {
  console.log(`[xhs-runner] ${message}`);
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

function validate(source, config, request) {
  const errors = [];
  if (!request || request.status !== "ready") errors.push("publish_run_request.json 不存在或状态不是 ready");
  if (!source.coverPrompt) errors.push("封面提示词不能为空");
  if (!source.title) errors.push("标题不能为空");
  if (!source.body) errors.push("内文不能为空");
  if (!config.gptImageChatUrl) errors.push("config.gptImageChatUrl 不能为空");
  if (!config.downloadDir) errors.push("config.downloadDir 不能为空");
  if (config.browser?.connectOverCDP === false) errors.push("必须连接已人工登录的 Chrome 调试端口，不能启动未登录的自动化浏览器");
  return errors;
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function readInputs() {
  const [fileConfig, request, markdown] = await Promise.all([
    readJson(configPath, {}),
    readJson(runRequestPath, {}),
    fs.readFile(sourceMdPath, "utf8")
  ]);
  const config = mergeConfigFromEnv(fileConfig);
  const source = parseMarkdown(markdown);
  const errors = validate(source, config, request);
  if (errors.length) throw new Error(errors.join("\n"));
  return { config, request, source };
}

async function ensureRuntimeDirs() {
  await Promise.all([
    fs.mkdir(envConfig.imageDir, { recursive: true }),
    fs.mkdir(envConfig.outputDir, { recursive: true })
  ]);
}

async function latestImage(downloadDir, sinceMs = 0) {
  const names = await fs.readdir(downloadDir);
  const candidates = [];
  for (const name of names) {
    if (!/\.(png|jpe?g|webp)$/i.test(name)) continue;
    const fullPath = path.join(downloadDir, name);
    const stat = await fs.stat(fullPath);
    if (stat.mtimeMs < sinceMs) continue;
    candidates.push({ path: fullPath, name, mtimeMs: stat.mtimeMs, size: stat.size });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0] || null;
}

async function getLatestGeneratedImage(page) {
  const image = await page.locator("img").evaluateAll((imgs) => imgs
    .map((img, index) => {
      const rect = img.getBoundingClientRect();
      return {
        index,
        alt: img.alt || "",
        src: img.currentSrc || img.src,
        width: img.naturalWidth,
        height: img.naturalHeight,
        y: rect.y,
        renderedWidth: rect.width,
        renderedHeight: rect.height
      };
    })
    .filter((item) => item.src.includes("/backend-api/estuary/content") && item.width > 500 && item.height > 500)
    .sort((a, b) => b.index - a.index)[0]);

  return image || null;
}

async function getGeneratedImageSrcs(page) {
  return await page.locator("img").evaluateAll((imgs) => imgs
    .map((img) => ({
      src: img.currentSrc || img.src,
      width: img.naturalWidth,
      height: img.naturalHeight
    }))
    .filter((item) => item.src.includes("/backend-api/estuary/content") && item.width > 500 && item.height > 500)
    .map((item) => item.src));
}

async function downloadLatestGeneratedImageFromPage(page, downloadDir, options = {}) {
  const image = await getLatestGeneratedImage(page);
  if (!image?.src || options.ignoreSrcs?.has(image.src) || image.src === options.ignoreSrc) return null;

  const base64 = await page.evaluate(async (src) => {
    const response = await fetch(src, { credentials: "include" });
    if (!response.ok) throw new Error(`browser fetch failed ${response.status}`);
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }, image.src);

  const filename = `xhs-cover-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
  const target = path.join(downloadDir, filename);
  await fs.writeFile(target, Buffer.from(base64, "base64"));
  return { path: target, name: filename, mtimeMs: Date.now(), size: Buffer.byteLength(base64, "base64") };
}

async function waitForAndDownloadNewGeneratedImage(page, config, previousImageSrcs) {
  const timeoutMs = Number(config.autoRefreshSeconds || 90) * 1000;
  const pollMs = Number(config.imagePollMs || 2000);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const image = await downloadLatestGeneratedImageFromPage(page, config.downloadDir, { ignoreSrcs: previousImageSrcs }).catch(() => null);
    if (image) return image;
    await page.waitForTimeout(pollMs);
  }
  return null;
}

async function waitForPageSettled(page, timeout = 15000) {
  await page.waitForLoadState("domcontentloaded", { timeout }).catch(() => {});
  await page.waitForTimeout(800);
}

async function waitForChatComposerReady(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
  const target = page.locator("#prompt-textarea[contenteditable='true']").first();
  await target.waitFor({ state: "visible", timeout: 90000 });
  await target.scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => {});

  let previous = "";
  for (let i = 0; i < 3; i += 1) {
    const snapshot = await target.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return JSON.stringify({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        text: el.textContent || "",
        active: document.activeElement === el
      });
    });
    if (snapshot === previous) return target;
    previous = snapshot;
    await page.waitForTimeout(1000);
  }
  return target;
}

async function firstVisible(locator) {
  const count = await locator.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const item = locator.nth(i);
    const visibleInViewport = await item.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1 && rect.x >= 0 && rect.y >= 0 && rect.x < window.innerWidth && rect.y < window.innerHeight;
    }).catch(() => false);
    if (visibleInViewport) return item;
  }
  return null;
}

async function waitForStableLocatorText(page, locator, expectedText, options = {}) {
  const stableChecks = options.stableChecks || 3;
  const intervalMs = options.intervalMs || 1000;
  const timeoutMs = options.timeoutMs || 20000;
  const deadline = Date.now() + timeoutMs;
  let previous = null;
  let stableCount = 0;
  while (Date.now() < deadline) {
    const current = await locator.innerText().catch(() => "");
    if (current.includes(expectedText.slice(0, 30)) && current === previous) {
      stableCount += 1;
      if (stableCount >= stableChecks) return current;
    } else {
      stableCount = 0;
      previous = current;
    }
    await page.waitForTimeout(intervalMs);
  }
  throw new Error("ChatGPT 输入框文本未连续稳定，已停止避免误发");
}

async function waitForEnabledSendButton(page) {
  const sendButtonCandidates = page.locator("[data-testid='send-button'], #composer-submit-button")
    .or(page.getByRole("button", { name: /发送|Send/i }));
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await sendButtonCandidates.first().waitFor({ state: "attached", timeout: 5000 }).catch(() => {});
    const sendButton = await firstVisible(sendButtonCandidates);
    if (sendButton) {
      const disabled = await sendButton.evaluate((button) => (
        button.disabled
        || button.getAttribute("disabled") !== null
        || button.getAttribute("aria-disabled") === "true"
      )).catch(() => true);
      if (!disabled) return sendButton;
    }
    await page.waitForTimeout(800);
  }
  throw new Error("ChatGPT 发送按钮未就绪或仍处于 disabled 状态");
}

async function fillChatPrompt(page, text) {
  const previousBodyText = await page.locator("body").innerText().catch(() => "");
  const target = await waitForChatComposerReady(page);
  await target.click();
  await page.keyboard.press("Meta+A").catch(() => {});
  await page.keyboard.press("Backspace").catch(() => {});
  await page.keyboard.insertText(text);
  await waitForStableLocatorText(page, target, text);
  const sendButton = await waitForEnabledSendButton(page);
  await page.waitForTimeout(3000 + Math.floor(Math.random() * 2000));
  await sendButton.click();
  await page.waitForFunction(
    ({ before, needle }) => document.body.innerText.length > before.length + 20 && document.body.innerText.includes(needle),
    { before: previousBodyText, needle: text.slice(0, 60) },
    { timeout: 30000 }
  );
  const afterText = await target.innerText().catch(() => "");
  if (afterText.trim()) throw new Error("ChatGPT 发送后输入框未清空，提示词可能未提交");
}

async function generateImage(page, config, source) {
  const prompt = `请根据下面提示词生成 1 张小红书封面图。只需要生成图片，不需要额外解释。\n\n${source.coverPrompt}`;
  const downloadStart = Date.now() - 1000;
  for (let attempt = 0; attempt <= Number(config.maxImageRetries || 2); attempt += 1) {
    log(`打开 GPT 生图会话，第 ${attempt + 1} 次`);
    log(`发送封面提示词：${source.coverPrompt.slice(0, 80)}${source.coverPrompt.length > 80 ? "..." : ""}`);
    await page.bringToFront().catch(() => {});
    if (page.url() !== config.gptImageChatUrl) {
      await page.goto(config.gptImageChatUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    }
    await waitForChatComposerReady(page);
    const previousImageSrcs = new Set(await getGeneratedImageSrcs(page).catch(() => []));
    const previousDownloadButtonCount = await page.getByRole("button", { name: /下载|Download/i }).count().catch(() => 0);
    await fillChatPrompt(page, prompt);
    const waitMs = Number(config.autoRefreshSeconds || 90) * 1000;
    log(`轮询新图片，最长 ${Math.round(waitMs / 1000)} 秒`);

    const directImage = await waitForAndDownloadNewGeneratedImage(page, config, previousImageSrcs);
    if (directImage) return directImage;

    const downloadButtons = page.getByRole("button", { name: /下载|Download/i });
    const nextDownloadButtonCount = await downloadButtons.count().catch(() => 0);
    const button = nextDownloadButtonCount > previousDownloadButtonCount
      ? await firstVisible(downloadButtons.nth(nextDownloadButtonCount - 1))
      : null;
    if (button) {
      const downloadPromise = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
      await button.click();
      const download = await downloadPromise;
      if (download) {
        const suggested = download.suggestedFilename();
        const target = path.join(config.downloadDir, suggested);
        await download.saveAs(target);
        return { path: target, name: suggested, mtimeMs: Date.now(), size: 0 };
      }
      await page.waitForTimeout(3000);
    }

    const image = await latestImage(config.downloadDir, downloadStart);
    if (image) return image;

    const bodyTail = (await page.locator("body").innerText().catch(() => "")).slice(-300);
    if (!bodyTail.includes(source.coverPrompt.slice(0, 20))) {
      throw new Error("ChatGPT 页面未出现本次提示词，发送失败");
    }
    log("提示词已发送，但未检测到新图片，刷新后重试");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  }
  throw new Error("GPT 生图或下载失败：已达到最大重试次数");
}

async function pickPage(context, matcher, label, fallbackUrl = "") {
  const pages = context.pages();
  const page = pages.find((candidate) => matcher(candidate.url()));
  if (!page && fallbackUrl) {
    const newPage = await context.newPage();
    await newPage.goto(fallbackUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    return newPage;
  }
  if (!page) {
    const urls = pages.map((candidate) => candidate.url()).join("\n");
    throw new Error(`没有找到${label}页面。当前可控页面：\n${urls || "无"}`);
  }
  return page;
}

async function writeLatestRun(data) {
  await fs.writeFile(latestRunPath, JSON.stringify(data, null, 2), "utf8");
}

async function main() {
  await ensureRuntimeDirs();
  const { config, source } = await readInputs();
  log(`读取成功：标题 ${source.title.length} 字，正文 ${source.body.length} 字`);
  if (dryRun) {
    log("dry-run 通过：配置和文案有效，未打开浏览器");
    return;
  }

  const browserConfig = {
    connectOverCDP: true,
    remoteDebuggingUrl: "http://127.0.0.1:9222",
    ...(config.browser || {})
  };
  const userDataDir = browserConfig.userDataDir || path.join(projectDir, ".chrome-automation-profile");
  let context;
  let browser;
  if (browserConfig.connectOverCDP) {
    const endpoint = browserConfig.remoteDebuggingUrl || "http://127.0.0.1:9222";
    log(`连接已人工登录的 Chrome 调试端口：${endpoint}`);
    browser = await chromium.connectOverCDP(endpoint);
    context = browser.contexts()[0];
    if (!context) throw new Error("调试端口已连接，但没有可用 Chrome context");
  } else {
    throw new Error(`已禁止启动未登录的自动化 Chrome：${userDataDir}`);
  }
  const chatPage = await pickPage(context, (url) => url.startsWith("https://chatgpt.com"), "ChatGPT");
  log(`使用 ChatGPT 页面：${chatPage.url()}`);

  try {
    if (skipImage && !allowSkipImage) {
      throw new Error("正式执行已禁止 --skip-image，避免误用旧图；调试时请显式追加 --allow-skip-image");
    }
    const image = skipImage
      ? await latestImage(config.downloadDir)
      : await generateImage(chatPage, config, source);
    if (!image?.path) throw new Error("未找到可上传的封面图片");
    log(`封面图片：${image.path}`);

    const latestRun = buildImageGeneratedRun(image.path);
    await writeLatestRun(latestRun);

    try {
      const wechatPush = await pushDraftToWechat({ config, source, imagePath: image.path, log });
      await writeLatestRun({ ...latestRun, updatedAt: new Date().toISOString(), wechatPush });
      if (wechatPush.status === "sent") {
        log("微信通知已发送");
      } else {
        log(`微信通知已跳过：${wechatPush.reason}`);
      }
    } catch (error) {
      await writeLatestRun({
        ...latestRun,
        updatedAt: new Date().toISOString(),
        wechatPush: { status: "failed", error: error.message }
      });
      log(`微信通知失败，不影响图片生成结果：${error.message}`);
    }
  } catch (error) {
    await writeLatestRun({
      status: "failed",
      updatedAt: new Date().toISOString(),
      error: error.message
    });
    throw error;
  }
}

main().catch((error) => {
  console.error(`[xhs-runner] ${error.message}`);
  process.exitCode = 1;
});
