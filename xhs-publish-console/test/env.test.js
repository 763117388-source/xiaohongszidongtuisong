import test from "node:test";
import assert from "node:assert/strict";

const envKeys = [
  "PORT",
  "DATA_DIR",
  "IMAGE_DIR",
  "OUTPUT_DIR",
  "PUSHPLUS_TOKEN",
  "ALIYUN_OSS_ACCESS_KEY_ID",
  "ALIYUN_OSS_ACCESS_KEY_SECRET",
  "ALIYUN_OSS_BUCKET",
  "ALIYUN_OSS_ENDPOINT",
  "ALIYUN_OSS_PUBLIC_BASE_URL",
  "POLL_INTERVAL_MS",
  "TASK_INTERVAL_MS"
];

async function importEnvWith(overrides) {
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  Object.assign(process.env, overrides);
  const mod = await import(`../env.js?case=${Date.now()}-${Math.random()}`);
  for (const key of envKeys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  return mod;
}

test("config reads portable settings from process.env", async () => {
  const { config } = await importEnvWith({
    PORT: "3123",
    DATA_DIR: "./tmp-data",
    IMAGE_DIR: "./tmp-images",
    OUTPUT_DIR: "./tmp-output",
    PUSHPLUS_TOKEN: "push-token",
    ALIYUN_OSS_ACCESS_KEY_ID: "ak",
    ALIYUN_OSS_ACCESS_KEY_SECRET: "secret",
    ALIYUN_OSS_BUCKET: "bucket",
    ALIYUN_OSS_ENDPOINT: "https://oss-cn-hangzhou.aliyuncs.com",
    ALIYUN_OSS_PUBLIC_BASE_URL: "https://bucket.example.com",
    POLL_INTERVAL_MS: "60000",
    TASK_INTERVAL_MS: "5000"
  });

  assert.equal(config.port, 3123);
  assert.equal(config.dataDir.endsWith("tmp-data"), true);
  assert.equal(config.imageDir.endsWith("tmp-images"), true);
  assert.equal(config.outputDir.endsWith("tmp-output"), true);
  assert.equal(config.pushplusToken, "push-token");
  assert.equal(config.aliyunOssAccessKeyId, "ak");
  assert.equal(config.aliyunOssAccessKeySecret, "secret");
  assert.equal(config.aliyunOssBucket, "bucket");
  assert.equal(config.aliyunOssEndpoint, "https://oss-cn-hangzhou.aliyuncs.com");
  assert.equal(config.aliyunOssPublicBaseUrl, "https://bucket.example.com");
  assert.equal(config.pollIntervalMs, 60000);
  assert.equal(config.taskIntervalMs, 5000);
});

test("getRequiredEnv reports the missing environment variable name", async () => {
  const { getRequiredEnv } = await importEnvWith({});

  assert.throws(
    () => getRequiredEnv("PUSHPLUS_TOKEN"),
    /缺少环境变量 PUSHPLUS_TOKEN/
  );
});
