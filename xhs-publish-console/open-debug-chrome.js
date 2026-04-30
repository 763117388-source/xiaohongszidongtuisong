import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const profileDir = path.resolve(__dirname, "..", ".chrome-human-profile");
fs.mkdirSync(profileDir, { recursive: true });

const args = [
  "--remote-debugging-port=9222",
  `--user-data-dir=${profileDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "https://chatgpt.com"
];

console.log("Opening Chrome with a human-controlled debugging profile:");
console.log(profileDir);
console.log("");
console.log("请在弹出的 Chrome 里手动登录 ChatGPT，并完成人机验证。");
console.log("登录完成后保持这个 Chrome 不要关闭；控制台会自动抓取新文案、生图并推送微信。");

const chrome = spawn("open", ["-na", "Google Chrome", "--args", ...args], {
  stdio: "inherit"
});

chrome.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
