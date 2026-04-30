# Changelog

## Unreleased

- Added `.env` loading as a unified portable configuration module.
- Added `.env.example` with placeholders for port, directories, polling intervals, PushPlus, and Aliyun OSS.
- Wired `server.js`, `runner.js`, and manual WeChat push to read merged environment/config values.
- Fixed automatic polling `copyThreadId` scope leakage in `server.js`.
- Added B-machine deployment notes.
