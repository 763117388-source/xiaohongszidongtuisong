# XHS Image Push Console

V1 自动链路：

1. 服务端轮询指定 Codex 文案线程。
2. 抓取到新的封面提示词、标题、内文后写入本地运行态文件。
3. 连接已人工登录的 ChatGPT Chrome 调试端口。
4. 自动发送封面提示词并下载新生成图片。
5. 上传图片到阿里云 OSS。
6. 通过 PushPlus 推送图片、标题、内文到微信。

不会打开、填写或发布小红书。

## Setup

```bash
cd xhs-publish-console
npm install
cp config.example.json config.json
npm run chrome:debug
npm start
```

在 `config.json` 填入：

- ChatGPT 生图会话 URL
- PushPlus token
- 阿里云 OSS AccessKey、bucket、endpoint、domain

`config.json`、Chrome profile、运行态 JSON、生成图片都不会进入 git。

## Scripts

```bash
npm start          # 启动控制台和自动轮询
npm run chrome:debug
npm run run:image  # 手动跑一次生图推送
npm run push:wechat
npm test
```

## Notes

- 需要提前保持 `npm run chrome:debug` 打开的 Chrome 已登录 ChatGPT。
- 推送标题按日期自动递增，例如 `4月30日 小红书墨镜发布第一条`。
- 微信详情页保留源文案空行，正文用紧凑行距显示。
