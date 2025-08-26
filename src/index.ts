import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import 'dotenv/config'
import { fetch as undiciFetch, ProxyAgent } from 'undici'

import * as provider from './provider'
import { impl as GeminiImpl } from './gemini'
import { impl as OpenAiImpl } from './openai'

const app = new Hono()

const providers: Record<string, provider.Provider> = {
    gemini: new GeminiImpl(),
    openai: new OpenAiImpl()
}

// Health check endpoint
app.get('/health', (c) => {
    return c.json({ status: 'ok', message: 'Claude Local Proxy is running' })
})

// Route pattern to capture the provider type and the complete provider URL
// Path format: /{type}/{provider_url}
// Where {provider_url} is the complete API endpoint URL for the target provider
app.post('/:type/*', async c => {
    const url = new URL(c.req.url)
    // 只有在 DEBUG 环境变量为 true 时才打印调试日志
    if (process.env.DEBUG === 'true') {
        console.log(`[DEBUG] Full request URL: ${c.req.url}`)
        console.log(`[DEBUG] Parsed URL: ${url}`)
        const pathParts = url.pathname.split('/').filter(part => part !== '')
        console.log(`[DEBUG] Path parts: ${JSON.stringify(pathParts)}`)
    }
    
    const pathParts = url.pathname.split('/').filter(part => part !== '')
    
    if (pathParts.length < 2) {
        return c.json({ error: 'Invalid path format. Expected: /{type}/{provider_url}' }, 400)
    }
    
    const type = pathParts[0]
    // Extract the complete provider URL from the path
    let providerUrlParts = pathParts.slice(1)
    
    // 对于所有提供商，都排除固定的 /v1/messages 部分（如果存在）
    // 因为 Claude 客户端会自动添加这个路径
    const lastTwoParts = providerUrlParts.slice(-2)
    if (lastTwoParts[0] === 'v1' && lastTwoParts[1] === 'messages') {
        providerUrlParts = providerUrlParts.slice(0, -2)
    }
    
    // Reconstruct the complete URL
    let baseUrl
    if (providerUrlParts[0] === 'https:' || providerUrlParts[0] === 'http:') {
        // If it's a complete URL (with protocol)
        baseUrl = providerUrlParts[0] + '//' + providerUrlParts.slice(1).join('/')
    } else {
        // If it's just a domain, add https:// prefix
        baseUrl = `https://${providerUrlParts.join('/')}`
    }
    
    if (!type || !baseUrl) {
        return c.json({ error: 'Missing type or provider_url in path' }, 400)
    }

    console.log(`Received request for provider: ${type}, url: ${baseUrl}`)

    const provider = providers[type]
    if (!provider) {
        return c.json({ error: `Provider ${type} not supported` }, 400)
    }

    // 支持三种 API 密钥传递方式
    let apiKey = c.req.header('x-api-key')
    
    // 如果没有 x-api-key，尝试获取 Authorization header (Claude 客户端使用这种方式)
    if (!apiKey) {
        const authHeader = c.req.header('Authorization')
        if (authHeader && authHeader.startsWith('Bearer ')) {
            apiKey = authHeader.substring(7) // 移除 "Bearer " 前缀
        }
    }
    
    // 如果 header 中都没有，尝试从环境变量获取
    if (!apiKey) {
        const providerType = type.toUpperCase()
        apiKey = process.env[`${providerType}_API_KEY`]
    }
    
    if (!apiKey) {
        return c.json({ 
            error: 'Missing API key. Please provide it via x-api-key header or environment variable (GEMINI_API_KEY or OPENAI_API_KEY)', 
            supported_methods: ['x-api-key header', 'environment variable']
        }, 401)
    }

    try {
        const providerRequest = await provider.convertToProviderRequest(c.req.raw, baseUrl, apiKey)
        
        // Setup proxy agent if proxy environment variables are set
        const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.PROXY_URL
        if (process.env.DEBUG === 'true') {
    console.log(`[DEBUG] Using proxy: ${proxyUrl}`)
}
        
        // Convert headers to object
        const headers: Record<string, string> = {}
        providerRequest.headers.forEach((value, key) => {
            headers[key] = value
        })
        
        if (process.env.DEBUG === 'true') {
    console.log(`[DEBUG] Making request to: ${providerRequest.url}`)
}
        const fetchOptions: RequestInit = {
            method: providerRequest.method,
            headers
        }
        
        // Only add body and duplex if body exists
        if (providerRequest.body) {
            fetchOptions.body = providerRequest.body
            // Only add duplex option for ReadableStream bodies
            if (providerRequest.body instanceof ReadableStream) {
                (fetchOptions as any).duplex = 'half'
            }
        }
        
        if (process.env.DEBUG === 'true') {
    console.log(`[DEBUG] Fetch options:`, {
        url: providerRequest.url,
        method: providerRequest.method,
        hasBody: !!providerRequest.body
    })
}
        
        // Create a clean Request object to avoid body locking issues
        const createCleanRequest = async () => {
            const headers = new Headers(providerRequest.headers)
            let body: string | ReadableStream<Uint8Array> | undefined | null = providerRequest.body
            
            // If body is a stream, read it as text
            if (body instanceof ReadableStream) {
                const reader = body.getReader()
                const decoder = new TextDecoder()
                let chunks = ''
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break
                    chunks += decoder.decode(value, { stream: true })
                }
                body = chunks
            }
            
            // Let the fetch API handle content-length automatically
            headers.delete('content-length')
            
            return new Request(providerRequest.url, {
                method: providerRequest.method,
                headers,
                body,
                ...(body && { duplex: 'half' as const })
            })
        }

        let providerResponse
        const cleanRequest = await createCleanRequest()
        
        if (proxyUrl) {
            console.log(`[DEBUG] Using undici with proxy agent`)
            const dispatcher = new ProxyAgent(proxyUrl)
            
            try {
                providerResponse = await undiciFetch(cleanRequest.url, {
                    method: cleanRequest.method,
                    headers: cleanRequest.headers,
                    body: cleanRequest.body,
                    dispatcher,
                    duplex: cleanRequest.body ? 'half' : undefined,
                    signal: AbortSignal.timeout(60000)
                })
            } catch (proxyError) {
                console.log(`[DEBUG] Proxy failed, falling back to native fetch:`, proxyError)
                // Fall back to native fetch if proxy fails
                const fetchOptions = {
                    ...cleanRequest,
                    signal: AbortSignal.timeout(60000)
                }
                providerResponse = await fetch(cleanRequest.url, fetchOptions)
            }
        } else {
            console.log(`[DEBUG] Using native fetch`)
            const fetchOptions = {
                ...cleanRequest,
                signal: AbortSignal.timeout(60000)
            }
            providerResponse = await fetch(cleanRequest.url, fetchOptions)
        }
        console.log(`[DEBUG] Response status: ${providerResponse.status}`)
        return await provider.convertToClaudeResponse(providerResponse as Response)
    } catch (error) {
        console.error(`Error processing request for ${type}:`, error)
        return c.json({ error: 'Internal server error' }, 500)
    }
})

const port = 3000
console.log(`Server is running on port ${port}`)

serve({
    hostname: "0.0.0.0",
    fetch: app.fetch,
    port
})
