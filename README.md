# Hermes Information Evaluation System

面向个人和小团队的信息评估中枢：把飞书消息、网页链接、截图和手动输入统一转成可追踪的结构化任务，再交给多 Agent 流水线完成正文提取、价值评估、行动建议和结果回写。

这个仓库是可公开部署版本，已经移除个人仪表盘、真实账号凭证、生产数据、浏览器 profile 和本地快捷方式。你可以把它当作一套 local-first 的信息处理后端，也可以在此基础上接入飞书、Hermes Profiles、浏览器登录态和自己的 Agent 执行环境。

## 它能做什么

- 接收飞书事件、HTTP API 请求或本地样例 payload。
- 自动识别输入类型，包括普通文本、链接、图片和截图。
- 对链接进行正文增强，支持公开网页抓取、浏览器辅助提取和登录态浏览器会话代理。
- 通过多 Agent 流水线拆分任务：内容理解、价值评估、行动建议和记录写入。
- 生成本地运行记录、任务轨迹和可回放的评估结果。
- 可选回写飞书多维表格，形成个人或团队的信息决策库。
- 提供隐私扫描、冒烟测试和隔离部署验证路径，方便二次开发者安全改造。

## 适合谁

- 想把 X、公众号、小红书、B 站、网页文章等信息统一收集和评估的人。
- 想搭建个人 AI 信息雷达、选题库、机会评估库或研究素材库的人。
- 想研究多 Agent 协作、内容增强、飞书集成和浏览器会话复用的开发者。
- 想让 Codex、Claude Code 或其他编程 Agent 读完仓库后快速部署和扩展的人。

## 工作流程

```text
Input
  -> intake router
  -> content enrichment
  -> content agent
  -> evaluation agent
  -> action agent
  -> local storage / Feishu Bitable
```

默认本地模式不依赖外部账号。启用生产能力后，系统可以从飞书收消息，把链接正文补全，再写回飞书或本地记录。

## 快速开始

### 环境要求

- Node.js 18 或更高版本
- npm
- Windows、macOS 或 Linux

首轮本地启动不需要：

- WSL
- 飞书应用凭证
- Hermes Profiles
- 已登录浏览器
- 个人总控网页

### 安装和启动

```bash
npm install
npm run setup:local
npm start
```

健康检查：

```bash
curl http://127.0.0.1:3000/api/v1/health
```

提交一条样例任务：

```bash
curl -X POST http://127.0.0.1:3000/api/v1/hermes/process \
  -H "Content-Type: application/json" \
  -d @examples/sample-process-payload.json
```

预期结果：

- `/api/v1/health` 返回 `status: ok`
- `/api/v1/hermes/process` 返回 `success: true`
- 本地运行数据写入 `./data`

## API 示例

最小请求体：

```json
{
  "text": "https://example.com/article",
  "source": "manual",
  "metadata": {
    "channel": "local-test"
  }
}
```

更多接口说明见 [API Guide](./docs/api.md)。

## 可选能力

### 飞书接入

本地流程跑通后，可以接入飞书事件入口和多维表格回写。你需要自己准备飞书应用凭证，并通过环境变量配置，不要把真实 token 写入仓库。

参考：[Deployment Guide](./docs/deployment.md)

### 登录态浏览器提取

X、小红书、公众号等平台经常限制匿名抓取。系统提供 Chrome session proxy，让服务可以连接一份你自己登录过的平台浏览器，从而读取公开抓取拿不到的正文。

这项能力默认关闭，因为它依赖本机浏览器、登录态和用户授权。启用前请先理解安全边界。

参考：[Browser Session Guide](./docs/browser-session.md)

### Hermes Profiles / WSL Bridge

如果你已经有 Hermes Agent 运行环境，可以把本地模块执行模式升级为 Hermes Profiles 和 WSL bridge，让不同 Agent 承担更明确的协作角色。

这不是首次部署必需项，建议先跑通本地模块模式。

## 配置说明

首次运行会根据 `.env.example` 生成 `.env`。常用配置包括：

```env
PORT=3000
HERMES_AGENT_EXECUTION_MODE=local_modules
HERMES_ALLOW_REMOTE_FETCH=false
HERMES_DATA_DIR=data
```

浏览器会话、飞书、Bitable 和 Hermes Profiles 相关配置都应放在本地 `.env` 中。`.env` 不应该提交到 GitHub。

## 隐私和安全

这个公开仓库不包含：

- 真实飞书凭证
- 真实 API key
- 浏览器 profile
- 个人总控网页
- 生产日志和真实消息记录
- 本地桌面快捷方式

提交前可以运行：

```bash
npm run scan:privacy
```

完整说明见 [Privacy Guide](./docs/privacy.md)。

## 注意事项

- 不要把 `.env`、真实 token、cookie、浏览器 profile 或飞书导出的生产数据提交到仓库。
- 登录态浏览器能力适合个人本机自动化，不适合直接暴露在公网服务器上。
- 首次部署建议保持 `HERMES_CHROME_SESSION_ENABLED=false`，确认基础链路正常后再启用浏览器会话。
- 如果网页正文提取失败，不要只依赖搜索摘要；应检查目标平台是否需要登录态或浏览器渲染。
- `data/*.sample.json` 是样例数据，真实运行数据应保留在本地。

## 项目结构

```text
hermes/      multi-agent pipeline, enrichment, writers, repositories
routes/      public HTTP routes
scripts/     setup, privacy scan, browser session and bridge helpers
docs/        deployment, API, privacy and browser session guides
examples/    safe sample request payloads
data/        local runtime storage and sample data
tests/       smoke tests
```

## 验证

```bash
npm run verify
```

`verify` 会执行冒烟测试和隐私扫描，适合在提交前确认公开仓库仍然可部署、无明显敏感信息。

## 许可证

MIT
