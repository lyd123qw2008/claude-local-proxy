# Claude Local Proxy

一个基于 Node.js 的本地代理服务，将 Claude API 格式的请求转换为其他 AI 提供商格式（目前支持 Google Gemini 和 OpenAI）。

## 功能特性

- 🚀 **高性能**: 基于 Hono 框架构建，轻量级且快速
- 🔐 **安全认证**: 支持标准 API 密钥认证
- 🔄 **流式响应**: 完整支持流式和非流式响应
- 🛠️ **工具调用**: 全面支持函数/工具调用功能
- 🌐 **多提供商**: 支持 Gemini 和 OpenAI API
- 🏠 **本地部署**: 完全在本地运行，无需云服务

## 支持的 AI 提供商

- **Google Gemini API** (gemini-1.5-flash, gemini-1.5-pro, etc.)
- **OpenAI API** (gpt-4, gpt-4o, gpt-3.5-turbo, etc.)

## 快速开始

### 1. 安装依赖

```bash
cd ~/code/claude-local-proxy
pnpm install
```

### 2. 配置环境变量

创建 `.env` 文件并添加你的 API 密钥：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
# Gemini API 密钥
GEMINI_API_KEY="your-gemini-api-key"

# OpenAI API 密钥
OPENAI_API_KEY="your-openai-api-key"
```

### 3. 启动服务

```bash
pnpm run dev
```

服务将在 `http://localhost:3000` 启动。

### 4. 健康检查

```bash
curl http://localhost:3000/health
```

应该返回：
```json
{
  "status": "ok",
  "message": "Claude Local Proxy is running"
}
```

## 使用方法

### API 密钥认证

支持两种 API 密钥传递方式：

1. **通过 Header（推荐）**:
   ```bash
   -H "x-api-key: your-api-key"
   ```

2. **通过环境变量**:
   ```bash
   # 在 .env 文件中设置
   GEMINI_API_KEY="your-gemini-api-key"
   OPENAI_API_KEY="your-openai-api-key"
   ```

### 请求格式

所有请求使用标准的 Claude API 格式：

```bash
curl -X POST http://localhost:3000/{provider}/{provider_url} \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "model": "model-name",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'
```

其中 `{provider_url}` 应该是：
- 对于 Gemini：`https://generativelanguage.googleapis.com/v1beta/models/`
- 对于 OpenAI：`https://api.openai.com/v1/chat/completions`

### 示例

#### Gemini 示例

```bash
curl -X POST http://localhost:3000/gemini/https://generativelanguage.googleapis.com/v1beta/models/ \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-gemini-api-key" \
  -d '{
    "model": "gemini-1.5-flash",
    "messages": [{"role": "user", "content": "Hello, how are you?"}],
    "stream": false
  }'
```

#### OpenAI 示例

```bash
curl -X POST http://localhost:3000/openai/api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-openai-api-key" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello, how are you?"}],
    "stream": false
  }'
```

#### 流式响应示例

```bash
curl -X POST http://localhost:3000/gemini/https://generativelanguage.googleapis.com/v1beta/models/ \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-gemini-api-key" \
  -d '{
    "model": "gemini-1.5-flash",
    "messages": [{"role": "user", "content": "Tell me a story"}],
    "stream": true
  }'
```

#### 工具调用示例

```bash
curl -X POST http://localhost:3000/gemini/https://generativelanguage.googleapis.com/v1beta/models/ \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-gemini-api-key" \
  -d '{
    "model": "gemini-1.5-flash",
    "messages": [{"role": "user", "content": "What'\''s the weather in Paris?"}],
    "stream": false,
    "tools": [
      {
        "name": "get_weather",
        "description": "Get the current weather for a location",
        "input_schema": {
          "type": "object",
          "properties": {
            "location": {
              "type": "string",
              "description": "The city name"
            }
          },
          "required": ["location"]
        }
      }
    ]
  }'
```

## 项目结构

```
claude-local-proxy/
├── src/
│   ├── index.ts          # 服务器入口文件
│   ├── gemini.ts         # Gemini 提供商实现
│   ├── openai.ts         # OpenAI 提供商实现
│   ├── provider.ts       # 提供商接口定义
│   ├── types.ts          # 类型定义
│   └── utils.ts          # 工具函数
├── package.json
├── tsconfig.json
├── .env.example          # 环境变量模板
└── README.md
```

## 开发

### 构建项目

```bash
pnpm run build
```

### 开发模式

```bash
pnpm run dev
```

### 添加新的提供商

1. 在 `src/` 目录下创建新的提供商文件（如 `anthropic.ts`）
2. 实现 `provider.Provider` 接口
3. 在 `src/index.ts` 中注册新的提供商
4. 更新类型定义和文档

## API 参考

### 支持的 Claude API 字段

- `model`: 模型名称
- `messages`: 消息数组
- `stream`: 是否启用流式响应
- `temperature`: 温度参数
- `max_tokens`: 最大令牌数
- `tools`: 工具定义数组
- `stop_sequences`: 停止序列

### 响应格式

响应完全兼容 Claude API 格式，包含：

- `id`: 消息 ID
- `type`: 消息类型
- `role`: 角色信息
- `content`: 内容数组
- `stop_reason`: 停止原因
- `usage`: 使用统计

## 安全考虑

- API 密钥通过 HTTPS 传输
- 不支持查询参数传递 API 密钥
- 环境变量方式适合生产环境
- 建议在代理后面添加额外的安全层

## 故障排除

### 常见问题

1. **连接超时**: 检查网络连接和 API 密钥
2. **404 错误**: 确认 URL 格式正确
3. **认证失败**: 检查 API 密钥是否正确
4. **模型不支持**: 确认模型名称正确

### 调试模式

服务器支持调试模式，输出详细的请求和响应信息：

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

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## 更新日志

### v1.0.0
- 初始版本
- 支持 Gemini 和 OpenAI API
- 完整的工具调用支持
- 流式响应支持
- 本地部署