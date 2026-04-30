# Handoff

## 当前状态

- 配置入口为 `env.js`，启动时加载 `.env` 并导出统一 `config`。
- `server.js`、`runner.js`、`push-wechat.js` 会通过 `mergeConfigFromEnv()` 合并本机 `config.json` 与环境变量。
- 环境变量显式设置时优先级高于 `config.json`；未设置时保留本机 `config.json`，避免破坏 A 机器 V1。
- `copyThreadId` 自动轮询作用域残留已修复，轮询时使用同一次 SQLite 查询解析出来的线程 ID。

## B 机器注意事项

- 从 `.env.example` 复制 `.env` 后填写真实值。
- 不要提交 `.env` 或 `config.json`。
- PushPlus 需要 `PUSHPLUS_TOKEN`。
- 阿里云 OSS 需要 `ALIYUN_OSS_ACCESS_KEY_ID`、`ALIYUN_OSS_ACCESS_KEY_SECRET`、`ALIYUN_OSS_BUCKET`、`ALIYUN_OSS_ENDPOINT`、`ALIYUN_OSS_PUBLIC_BASE_URL`。
- 自动导入 Codex 文案需要 `XHS_COPY_THREAD_ID` 和 `CODEX_STATE_DB_PATH`。

## 验证建议

```bash
npm test
npm start
npm run push:wechat
```
