import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as envConfig, mergeConfigFromEnv } from "./env.js";
import { pushDraftToWechat } from "./wechat-push.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, "config.json");
const sourceJsonPath = path.join(envConfig.dataDir, "publish_source.json");
const latestRunPath = path.join(envConfig.outputDir, "publish_latest_run.json");

function log(message) {
  console.log(`[xhs-wechat-push] ${message}`);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function main() {
  const [fileConfig, source, latestRun] = await Promise.all([
    readJson(configPath),
    readJson(sourceJsonPath),
    readJson(latestRunPath)
  ]);
  const config = mergeConfigFromEnv(fileConfig);
  const imagePath = latestRun.imagePath;
  if (!imagePath) throw new Error("publish_latest_run.json 里没有 imagePath");

  const result = await pushDraftToWechat({ config, source, imagePath, log });
  log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(`[xhs-wechat-push] ${error.message}`);
  process.exitCode = 1;
});
