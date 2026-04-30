# XHS Publish Console

本目录是小红书发布控制台 V1。服务会读取本地 `.env`，再合并本机忽略提交的 `config.json`。B 机器首次部署时应优先使用 `.env`，不要依赖 A 机器遗留配置。

## B 机器部署

1. 安装依赖：

```bash
npm install
```

2. 创建本机配置：

```bash
cp .env.example .env
```

3. 编辑 `.env`，至少按需填写：

```bash
PORT=3000
DATA_DIR=./data
IMAGE_DIR=./data/images
OUTPUT_DIR=./data/posts
POLL_INTERVAL_MS=60000
GPT_IMAGE_CHAT_URL=https://chatgpt.com/c/your-image-chat
XHS_COPY_THREAD_ID=your_codex_copy_thread_id
CODEX_STATE_DB_PATH=/Users/your-name/.codex/state_5.sqlite
PUSHPLUS_TOKEN=your_pushplus_token
ALIYUN_OSS_ACCESS_KEY_ID=your_access_key_id
ALIYUN_OSS_ACCESS_KEY_SECRET=your_access_key_secret
ALIYUN_OSS_BUCKET=your_bucket
ALIYUN_OSS_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
ALIYUN_OSS_PUBLIC_BASE_URL=https://your-bucket.oss-cn-hangzhou.aliyuncs.com
```

`.env` 是本机私密文件，已被 git 忽略，不要提交。`config.json` 仍可作为本机 UI 保存配置使用，但 PushPlus 和 OSS 推荐放在 `.env`。

## 启动与验证

启动服务：

```bash
npm start
```

打开控制台：

```text
http://127.0.0.1:${PORT}
```

测试 OSS 上传和 PushPlus 推送：

```bash
npm run push:wechat
```

该命令会读取 `.env` 合并后的配置、`DATA_DIR/publish_source.json` 和 `OUTPUT_DIR/publish_latest_run.json`。缺少 PushPlus 或 OSS 配置时，错误会指出缺少的环境变量名。
