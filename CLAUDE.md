# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个 Claude 本地代理服务 - 一个基于 Node.js 的本地代理服务，将 Claude API 格式的请求转换为其他 AI 提供商格式（目前支持 Google Gemini 和 OpenAI）。该代理使客户端能够使用 Claude API 兼容接口，同时将请求路由到不同的 AI 提供商。

## 开发命令

### 开发模式
```bash
pnpm run dev
```
使用 tsx 启动开发服务器并监听文件变化。服务器运行在端口 3000。

### 构建项目
```bash
pnpm run build
```
使用 TypeScript 编译器将 TypeScript 文件编译到 `dist/` 目录。

### 安装依赖
```bash
pnpm install
```
使用 pnpm（package.json 中指定的包管理器）安装所有依赖。

## 架构

### 核心组件

- **src/index.ts**: 使用 Hono 框架的主服务器入口点。处理路由、API 密钥认证（通过 header 或环境变量）和代理请求转发，支持 HTTP/HTTPS 代理配置。

- **src/provider.ts**: 定义所有 AI 提供商必须实现的 `Provider` 接口。每个提供商处理 Claude API 和目标提供商 API 之间的请求/响应格式转换。

- **src/gemini.ts**: 实现 Google Gemini API 提供商。处理 Claude API 格式和 Gemini 格式之间的转换，包括支持流式响应和工具调用。

- **src/openai.ts**: 实现 OpenAI API 提供商。处理 Claude API 格式和 OpenAI 格式之间的转换，包括流式响应和工具调用支持。

- **src/types.ts**: Claude、Gemini 和 OpenAI API 的全面 TypeScript 类型定义。定义请求/响应格式和流式事件类型。

- **src/utils.ts**: 实用函数，包括：
  - 流式响应处理（SSE 处理）
  - URL 构建和清理
  - 工具调用的 JSON 模式清理
  - 消息和内容块处理

### 请求流程

1. 客户端发送 Claude API 格式请求到 `/{provider}/{provider_url}`
2. 服务器验证提供商类型并从路径中提取基础 URL
3. 通过 `x-api-key` header 或环境变量（`GEMINI_API_KEY`、`OPENAI_API_KEY`）进行 API 密钥认证
4. 提供商实现将 Claude 请求转换为目标提供商格式
5. 对于 Gemini，根据 Claude 请求中的模型参数拼接完整的目标 URL；对于 OpenAI，直接使用用户提供的完整 URL
6. 请求转发到目标 URL
7. 响应转换回 Claude API 格式并返回给客户端

### 关键特性

- **双重认证**: 支持 header API 密钥（推荐）或环境变量
- **代理支持**: 如果通过环境变量配置，自动使用 HTTP/HTTPS 代理
- **流式响应**: 完整支持服务器发送事件（SSE）流式响应
- **工具调用**: 完整的函数/工具调用支持，跨所有提供商
- **灵活的 URL 处理**: 接受路径中的完整 URL 或域名

### 添加新提供商

1. 在 `src/` 目录中创建新的提供商文件（如 `anthropic.ts`）
2. 实现 `src/provider.ts` 中的 `Provider` 接口
3. 在 `src/index.ts` 的 providers 对象中注册提供商
4. 如果需要新的请求/响应格式，更新 `src/types.ts` 中的类型

### URL 模式

请求遵循模式：`/{provider}/{provider_url}`

其中 `{provider_url}` 应该是基础 API URL：
- 对于 Gemini：`https://generativelanguage.googleapis.com/v1beta/models/`
- 对于 OpenAI：`https://api.openai.com/v1/chat/completions`

### 环境变量

- `GEMINI_API_KEY`: Google Gemini API 密钥
- `OPENAI_API_KEY`: OpenAI API 密钥
- `HTTPS_PROXY`/`HTTP_PROXY`: 出站请求的代理配置
- `DEBUG`: 启用调试模式，输出详细日志信息（可选，值：true/false）

### 测试

健康检查端点：`GET /health` 返回 `{"status": "ok", "message": "Claude Local Proxy is running"}`
- 始终使用中文回复

### 调试模式

服务器支持调试模式，通过环境变量 `DEBUG=true` 启用：

```bash
# 启用调试模式
DEBUG=true pnpm run dev

# 输出到文件
npm run dev > server.log 2>&1 &
```

调试日志包含：
- 完整的请求 URL
- URL 解析过程
- 代理使用情况
- 目标 API 请求详情
- 响应状态码

查看日志文件：
```bash
cat server.log
```
- 不能取消代理