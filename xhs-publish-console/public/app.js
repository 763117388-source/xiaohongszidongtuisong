const $ = (id) => document.getElementById(id);

const fields = {
  coverPrompt: $("coverPrompt"),
  title: $("title"),
  body: $("body"),
  gptImageChatUrl: $("gptImageChatUrl"),
  downloadDir: $("downloadDir"),
  autoRefreshSeconds: $("autoRefreshSeconds"),
  maxImageRetries: $("maxImageRetries"),
  defaultDraftAuthorization: $("defaultDraftAuthorization"),
  enableWechatPush: $("enableWechatPush"),
  pushplusToken: $("pushplusToken"),
  storageProvider: $("storageProvider"),
  aliyunOssAccessKeyId: $("aliyunOssAccessKeyId"),
  aliyunOssAccessKeySecret: $("aliyunOssAccessKeySecret"),
  aliyunOssBucket: $("aliyunOssBucket"),
  aliyunOssRegion: $("aliyunOssRegion"),
  aliyunOssEndpoint: $("aliyunOssEndpoint"),
  aliyunOssDomain: $("aliyunOssDomain"),
  aliyunOssKeyPrefix: $("aliyunOssKeyPrefix"),
  qiniuAccessKey: $("qiniuAccessKey"),
  qiniuSecretKey: $("qiniuSecretKey"),
  qiniuBucket: $("qiniuBucket"),
  qiniuDomain: $("qiniuDomain"),
  qiniuUploadUrl: $("qiniuUploadUrl"),
  qiniuKeyPrefix: $("qiniuKeyPrefix")
};

function setStatus(message, kind = "ok") {
  const node = $("status");
  node.textContent = message;
  node.style.color = kind === "error" ? "#c92841" : kind === "warn" ? "#946200" : "#217a5b";
}

function sourcePayload() {
  return {
    coverPrompt: fields.coverPrompt.value.trim(),
    title: fields.title.value.trim(),
    body: fields.body.value.trim()
  };
}

function configPayload() {
  return {
    gptImageChatUrl: fields.gptImageChatUrl.value.trim(),
    downloadDir: fields.downloadDir.value.trim(),
    autoRefreshSeconds: Number(fields.autoRefreshSeconds.value || 90),
    maxImageRetries: Number(fields.maxImageRetries.value || 2),
    defaultDraftAuthorization: fields.defaultDraftAuthorization.checked,
    enableWechatPush: fields.enableWechatPush.checked,
    pushplusToken: fields.pushplusToken.value.trim(),
    storageProvider: fields.storageProvider.value,
    aliyunOss: {
      accessKeyId: fields.aliyunOssAccessKeyId.value.trim(),
      accessKeySecret: fields.aliyunOssAccessKeySecret.value.trim(),
      bucket: fields.aliyunOssBucket.value.trim(),
      region: fields.aliyunOssRegion.value.trim(),
      endpoint: fields.aliyunOssEndpoint.value.trim(),
      domain: fields.aliyunOssDomain.value.trim(),
      keyPrefix: fields.aliyunOssKeyPrefix.value.trim()
    },
    qiniu: {
      accessKey: fields.qiniuAccessKey.value.trim(),
      secretKey: fields.qiniuSecretKey.value.trim(),
      bucket: fields.qiniuBucket.value.trim(),
      domain: fields.qiniuDomain.value.trim(),
      uploadUrl: fields.qiniuUploadUrl.value.trim(),
      keyPrefix: fields.qiniuKeyPrefix.value.trim()
    }
  };
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error((data.errors || [data.error || "请求失败"]).join("；"));
  }
  return data;
}

function updateCounts() {
  $("titleCount").textContent = `${fields.title.value.trim().length}/20`;
  $("bodyCount").textContent = `${fields.body.value.trim().length}/1000`;
}

function renderExecutionRules(rules = []) {
  const list = $("executionRules");
  list.innerHTML = "";
  for (const rule of rules) {
    const item = document.createElement("li");
    item.textContent = rule;
    list.appendChild(item);
  }
}

function clearSourceFields() {
  fields.coverPrompt.value = "";
  fields.title.value = "";
  fields.body.value = "";
  updateCounts();
}

function fillSourceFields(source = {}) {
  fields.coverPrompt.value = source.coverPrompt || "";
  fields.title.value = source.title || "";
  fields.body.value = source.body || "";
  updateCounts();
}

async function loadSource() {
  const { source, errors } = await request("/api/source");
  fillSourceFields(source);
  setStatus(errors?.length ? `需修正：${errors[0]}` : "已读取");
}

async function loadInitial() {
  clearSourceFields();
  const { config, executionRules } = await request("/api/config");

  fields.gptImageChatUrl.value = config.gptImageChatUrl || "";
  fields.downloadDir.value = config.downloadDir || "";
  fields.autoRefreshSeconds.value = config.autoRefreshSeconds || 90;
  fields.maxImageRetries.value = config.maxImageRetries ?? 2;
  fields.defaultDraftAuthorization.checked = config.defaultDraftAuthorization !== false;
  fields.enableWechatPush.checked = Boolean(config.enableWechatPush);
  fields.pushplusToken.value = config.pushplusToken || "";
  fields.storageProvider.value = config.storageProvider || "aliyunOss";
  fields.aliyunOssAccessKeyId.value = config.aliyunOss?.accessKeyId || "";
  fields.aliyunOssAccessKeySecret.value = config.aliyunOss?.accessKeySecret || "";
  fields.aliyunOssBucket.value = config.aliyunOss?.bucket || "";
  fields.aliyunOssRegion.value = config.aliyunOss?.region || "";
  fields.aliyunOssEndpoint.value = config.aliyunOss?.endpoint || "";
  fields.aliyunOssDomain.value = config.aliyunOss?.domain || "";
  fields.aliyunOssKeyPrefix.value = config.aliyunOss?.keyPrefix || "xhs-covers";
  fields.qiniuAccessKey.value = config.qiniu?.accessKey || "";
  fields.qiniuSecretKey.value = config.qiniu?.secretKey || "";
  fields.qiniuBucket.value = config.qiniu?.bucket || "";
  fields.qiniuDomain.value = config.qiniu?.domain || "";
  fields.qiniuUploadUrl.value = config.qiniu?.uploadUrl || "https://upload.qiniup.com";
  fields.qiniuKeyPrefix.value = config.qiniu?.keyPrefix || "xhs-covers";
  renderExecutionRules(executionRules);

  setStatus("配置已读取，等待生成图片");
}

async function saveSource() {
  await request("/api/source", {
    method: "POST",
    body: JSON.stringify({ source: sourcePayload() })
  });
  setStatus("内容已保存，已读取");
}

async function saveConfig() {
  await request("/api/config", {
    method: "POST",
    body: JSON.stringify({ config: configPayload() })
  });
  setStatus("配置已保存");
}

async function checkLatestImage() {
  const data = await request("/api/latest-image");
  $("latestImage").textContent = data.image
    ? `${data.image.name}\n${data.image.path}\n${Math.round(data.image.size / 1024)} KB`
    : "下载目录里没有图片";
  setStatus("已检查图片");
}

async function copySummary() {
  const source = sourcePayload();
  const text = [
    `标题：${source.title}`,
    `封面提示词：${source.coverPrompt.slice(0, 80)}${source.coverPrompt.length > 80 ? "..." : ""}`,
    `内文字数：${source.body.length}`
  ].join("\n");
  const copied = await tryWriteClipboard(text);
  setStatus(copied ? "摘要已复制" : "浏览器禁止复制，请手动选择内容", copied ? "ok" : "warn");
}

$("sourceForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await saveSource();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

$("saveConfigButton").addEventListener("click", async () => {
  try {
    await saveConfig();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

$("reloadButton").addEventListener("click", () => loadSource().catch((error) => setStatus(error.message, "error")));
$("latestImageButton").addEventListener("click", () => checkLatestImage().catch((error) => setStatus(error.message, "error")));
$("copySummaryButton").addEventListener("click", () => copySummary().catch((error) => setStatus(error.message, "error")));

for (const field of [fields.title, fields.body]) {
  field.addEventListener("input", updateCounts);
}

loadInitial().catch((error) => setStatus(error.message, "error"));
