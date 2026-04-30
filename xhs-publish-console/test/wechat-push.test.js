import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPushplusHtml,
  buildPushplusPayload,
  nextWechatPushTitle,
  publicAliyunOssUrl,
  publicQiniuUrl,
  uploadImageToStorage,
  validateWechatPushConfig
} from "../wechat-push.js";

test("buildPushplusHtml renders image, title, and body without the cover prompt", () => {
  const html = buildPushplusHtml({
    imageUrl: "https://cdn.example.com/xhs-cover.png",
    title: "脸大拍照显土？试试这种猫眼墨镜",
    body: "第一行\n第二行",
    coverPrompt: "不应该出现在微信里的封面提示词"
  });

  assert.match(html, /<img src="https:\/\/cdn\.example\.com\/xhs-cover\.png"/);
  assert.match(html, /脸大拍照显土/);
  assert.match(html, /<div style="margin-bottom:2px;">第一行<\/div>/);
  assert.match(html, /<div style="margin-bottom:2px;">第二行<\/div>/);
  assert.doesNotMatch(html, /封面提示词/);
  assert.doesNotMatch(html, /不应该出现在微信里/);
});

test("buildPushplusHtml keeps WeChat-friendly text blocks without broken buttons", () => {
  const html = buildPushplusHtml({
    imageUrl: "https://cdn.example.com/xhs-cover.png",
    title: "脸大拍照显土？试试这种猫眼墨镜",
    body: "第一行\n第二行"
  });

  assert.doesNotMatch(html, /长按图片保存/);
  assert.match(html, /标题/);
  assert.match(html, /内文/);
  assert.match(html, /user-select:text/);
  assert.match(html, /line-height:1\.38/);
  assert.match(html, /margin-bottom:2px/);
  assert.match(html, /font-weight:700/);
  assert.doesNotMatch(html, /line-height:0\.7/);
  assert.doesNotMatch(html, /white-space:pre-wrap/);
  assert.doesNotMatch(html, /border:1px solid/);
  assert.doesNotMatch(html, /background:#fafafa/);
  assert.doesNotMatch(html, /button/);
  assert.doesNotMatch(html, /download=/);
  assert.doesNotMatch(html, /<script/);
});

test("buildPushplusHtml preserves one blank line in body display", () => {
  const html = buildPushplusHtml({
    imageUrl: "https://cdn.example.com/xhs-cover.png",
    title: "标题",
    body: "第一行\n\n\n第二行"
  });

  assert.match(html, /<div style="margin-bottom:2px;">第一行<\/div>/);
  assert.match(html, /<div style="height:14px;"><\/div>/);
  assert.match(html, /<div style="margin-bottom:2px;">第二行<\/div>/);
  assert.doesNotMatch(html, /第一行<br>\n<br>\n/);
});

test("buildPushplusPayload uses the provided notification title to avoid duplicate preview text", () => {
  const payload = buildPushplusPayload({
    token: "token",
    notificationTitle: "4月30日 小红书墨镜发布第一条",
    title: "脸大拍照显土？试试这种猫眼墨镜",
    body: "圆脸/方圆脸姐妹",
    imageUrl: "https://cdn.example.com/xhs-cover.png"
  });

  assert.equal(payload.title, "4月30日 小红书墨镜发布第一条");
  assert.match(payload.content, /脸大拍照显土/);
  assert.doesNotMatch(payload.content.split("\n")[0], /脸大拍照显土/);
});

test("nextWechatPushTitle increments per local date", async () => {
  const writes = [];
  const memory = {
    "wechat_push_sequence.json": JSON.stringify({ dateKey: "2026-04-30", count: 1 })
  };
  const result = await nextWechatPushTitle("/project/wechat_push_sequence.json", {
    now: new Date("2026-04-30T05:00:00.000Z"),
    readFile: async (filePath) => memory[filePath.split("/").pop()],
    writeFile: async (filePath, content) => {
      writes.push({ filePath, content });
    }
  });

  assert.equal(result.title, "4月30日 小红书墨镜发布第二条");
  assert.equal(result.dateKey, "2026-04-30");
  assert.equal(result.count, 2);
  assert.deepEqual(JSON.parse(writes[0].content), { dateKey: "2026-04-30", count: 2 });
});

test("publicQiniuUrl joins configured domain and uploaded key", () => {
  assert.equal(
    publicQiniuUrl({ domain: "https://cdn.example.com/base/" }, "xhs/cover image.png"),
    "https://cdn.example.com/base/xhs/cover%20image.png"
  );
});

test("validateWechatPushConfig reports missing push and qiniu fields", () => {
  assert.deepEqual(validateWechatPushConfig({ enableWechatPush: true }), [
    "PUSHPLUS_TOKEN",
    "qiniu.accessKey",
    "qiniu.secretKey",
    "qiniu.bucket",
    "qiniu.domain"
  ]);
});

test("validateWechatPushConfig reports missing aliyun OSS fields", () => {
  assert.deepEqual(validateWechatPushConfig({
    enableWechatPush: true,
    storageProvider: "aliyunOss",
    pushplusToken: "token"
  }), [
    "ALIYUN_OSS_ACCESS_KEY_ID",
    "ALIYUN_OSS_ACCESS_KEY_SECRET",
    "ALIYUN_OSS_BUCKET",
    "ALIYUN_OSS_ENDPOINT",
    "ALIYUN_OSS_PUBLIC_BASE_URL"
  ]);
});

test("publicAliyunOssUrl joins configured bucket endpoint and uploaded key", () => {
  assert.equal(
    publicAliyunOssUrl({
      bucket: "bucket-name",
      endpoint: "oss-cn-shanghai.aliyuncs.com"
    }, "xhs/cover image.png"),
    "https://bucket-name.oss-cn-shanghai.aliyuncs.com/xhs/cover%20image.png"
  );
});

test("uploadImageToStorage dispatches to aliyun OSS client and returns public URL", async () => {
  const calls = [];
  const result = await uploadImageToStorage("/tmp/cover.png", {
    storageProvider: "aliyunOss",
    aliyunOss: {
      accessKeyId: "ak",
      accessKeySecret: "secret",
      bucket: "bucket-name",
      region: "oss-cn-shanghai",
      endpoint: "oss-cn-shanghai.aliyuncs.com",
      keyPrefix: "xhs-covers"
    }
  }, {
    now: new Date("2026-04-30T00:00:00.000Z"),
    randomSuffix: "abc123",
    createAliyunOssClient: (options) => ({
      async put(key, filePath, putOptions) {
        calls.push({ options, key, filePath, putOptions });
        return { name: key };
      },
      signatureUrl(key) {
        return `https://signed.example.com/${key}`;
      }
    })
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, "xhs-covers/2026-04-30T00-00-00-000Z-abc123.png");
  assert.equal(calls[0].filePath, "/tmp/cover.png");
  assert.equal(calls[0].options.secure, true);
  assert.deepEqual(calls[0].putOptions, {});
  assert.equal(result.url, "https://signed.example.com/xhs-covers/2026-04-30T00-00-00-000Z-abc123.png");
});
