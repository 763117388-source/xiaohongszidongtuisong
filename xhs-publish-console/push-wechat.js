import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pushDraftToWechat } from "./wechat-push.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, "..");
const configPath = path.join(__dirname, "config.json");
const sourceJsonPath = path.join(projectDir, "publish_source.json");
const latestRunPath = path.join(projectDir, "publish_latest_run.json");

function log(message) {
  console.log(`[xhs-wechat-push] ${message}`);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function main() {
  const [config, source, latestRun] = await Promise.all([
    readJson(configPath),
    readJson(sourceJsonPath),
    readJson(latestRunPath)
  ]);
  const imagePath = latestRun.imagePath;
  if (!imagePath) throw new Error("publish_latest_run.json 里没有 imagePath");

  const result = await pushDraftToWechat({ config, source, imagePath, log });
  log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(`[xhs-wechat-push] ${error.message}`);
  process.exitCode = 1;
});
