import * as types from './types'
import * as provider from './provider'
import * as utils from './utils'

export class impl implements provider.Provider {
    async convertToProviderRequest(request: Request, baseUrl: string, apiKey: string): Promise<Request> {
        const claudeRequest = (await request.json()) as types.ClaudeRequest
        const openaiRequest = this.convertToOpenAIRequestBody(claudeRequest)

        // 对于 OpenAI，baseUrl 应该是完整的 URL，直接使用
        const finalUrl = baseUrl

        const headers = new Headers(request.headers)
        headers.set('Authorization', `Bearer ${apiKey}`)
        headers.set('Content-Type', 'application/json')

        return new Request(finalUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(openaiRequest)
        })
    }

    async convertToClaudeResponse(openaiResponse: Response): Promise<Response> {
        if (!openaiResponse.ok) {
            return openaiResponse
        }

        const contentType = openaiResponse.headers.get('content-type') || ''
        const isStream = contentType.includes('text/event-stream')

        if (isStream) {
            return this.convertStreamResponse(openaiResponse)
        } else {
            return this.convertNormalResponse(openaiResponse)
        }
    }

    private convertToOpenAIRequestBody(claudeRequest: types.ClaudeRequest): types.OpenAIRequest {
        const openaiRequest: types.OpenAIRequest = {
            model: claudeRequest.model,
            messages: this.convertMessages(claudeRequest.messages),
            stream: claudeRequest.stream
        }

        if (claudeRequest.tools && claudeRequest.tools.length > 0) {
            openaiRequest.tools = claudeRequest.tools.map(tool => ({
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: utils.cleanJsonSchema(tool.input_schema)
                }
            }))
        }

        if (claudeRequest.temperature !== undefined) {
            openaiRequest.temperature = claudeRequest.temperature
        }

        if (claudeRequest.max_tokens !== undefined) {
            openaiRequest.max_tokens = claudeRequest.max_tokens
        }

        return openaiRequest
    }

    private convertMessages(claudeMessages: types.ClaudeMessage[]): types.OpenAIMessage[] {
        // 添加调试日志
        if (process.env.DEBUG === 'true') {
            console.log('[DEBUG] convertMessages - Received Claude messages:', JSON.stringify(claudeMessages, null, 2));
        }
        
        // 清理不完整的工具调用对，确保每个 tool_use 都有对应的 tool_result
        const cleanedMessages = this.cleanIncompleteToolCalls(claudeMessages);
        if (process.env.DEBUG === 'true') {
            console.log('[DEBUG] convertMessages - Cleaned Claude messages:', JSON.stringify(cleanedMessages, null, 2));
        }
        
        const openaiMessages: types.OpenAIMessage[] = []
        const toolCallMap = new Map<string, string>()

        // First pass: collect all successful tool_results to know which tool_calls have responses
        const successfulToolResultIds = new Set<string>()
        for (const message of claudeMessages) {
            if (typeof message.content !== 'string') {
                for (const content of message.content) {
                    if (content.type === 'tool_result') {
                        const isError = (content as any).is_error === true
                        if (!isError) {
                            successfulToolResultIds.add(content.tool_use_id)
                        }
                    }
                }
            }
        }
        
        // 添加调试日志
        if (process.env.DEBUG === 'true') {
            console.log('[DEBUG] convertMessages - Successful tool result IDs:', Array.from(successfulToolResultIds));
        }

        for (const message of cleanedMessages) {
            if (typeof message.content === 'string') {
                openaiMessages.push({
                    role: message.role === 'assistant' ? 'assistant' : 'user',
                    content: message.content
                })
                continue
            }

            const textContents: string[] = []
            const toolCalls: types.OpenAIToolCall[] = []
            const toolResults: Array<{ tool_call_id: string; content: string }> = []

            for (const content of message.content) {
                switch (content.type) {
                    case 'text':
                        textContents.push(content.text)
                        break
                    case 'tool_use':
                        // 添加调试日志
                        if (process.env.DEBUG === 'true') {
                            console.log(`[DEBUG] Found tool_use: id=${content.id}, name=${content.name}`);
                        }
                        toolCallMap.set(content.id, content.id)
                        // Only include tool_calls that have successful tool_results
                        if (successfulToolResultIds.has(content.id)) {
                            if (process.env.DEBUG === 'true') {
                                console.log(`[DEBUG] Tool call ${content.id} has successful result, keeping it`);
                            }
                            toolCalls.push({
                                id: content.id,
                                type: 'function',
                                function: {
                                    name: content.name,
                                    arguments: JSON.stringify(content.input)
                                }
                            })
                        } else {
                            if (process.env.DEBUG === 'true') {
                                console.log(`[DEBUG] Tool call ${content.id} has no successful result, converting to text`);
                            }
                            // Convert failed tool_use to meaningful feedback message
                            textContents.push(`[User interrupted: ${content.name} operation was cancelled by user]`)
                        }
                        break
                    case 'tool_result':
                        // 添加调试日志
                        if (process.env.DEBUG === 'true') {
                            console.log(`[DEBUG] Found tool_result: tool_use_id=${content.tool_use_id}, is_error=${(content as any).is_error}`);
                        }
                        const isError = (content as any).is_error === true
                        if (!isError) {
                            // Successful tool result
                            toolResults.push({
                                tool_call_id: content.tool_use_id,
                                content: typeof content.content === 'string' ? content.content : JSON.stringify(content.content)
                            })
                        } else {
                            // Convert error tool result to user feedback about interruption
                            const errorContent = typeof content.content === 'string' ? content.content : JSON.stringify(content.content)
                            if (errorContent.includes('Interrupted by user')) {
                                textContents.push(`[User provided feedback: The previous action was interrupted. Please pay attention to the new user input and adjust your approach accordingly.]`)
                            } else {
                                textContents.push(`[Tool execution error: ${errorContent}]`)
                            }
                        }
                        break
                }
            }

            if (textContents.length > 0 || toolCalls.length > 0) {
                const openaiMessage: types.OpenAIMessage = {
                    role: message.role === 'assistant' ? 'assistant' : 'user'
                }

                if (textContents.length > 0) {
                    openaiMessage.content = textContents.join('\n')
                }

                if (toolCalls.length > 0) {
                    openaiMessage.tool_calls = toolCalls
                }

                openaiMessages.push(openaiMessage)
            }

            // Add successful tool results as separate messages
            for (const toolResult of toolResults) {
                openaiMessages.push({
                    role: 'tool',
                    tool_call_id: toolResult.tool_call_id,
                    content: toolResult.content
                })
            }
        }

        return openaiMessages
    }

    private cleanIncompleteToolCalls(messages: types.ClaudeMessage[]): types.ClaudeMessage[] {
        // 收集所有 tool_result 的 tool_use_id
        const toolResultIds = new Set<string>();
        for (const message of messages) {
            if (typeof message.content !== 'string') {
                for (const content of message.content) {
                    if (content.type === 'tool_result') {
                        toolResultIds.add(content.tool_use_id);
                    }
                }
            }
        }
        
        if (process.env.DEBUG === 'true') {
            console.log('[DEBUG] cleanIncompleteToolCalls - Tool result IDs:', Array.from(toolResultIds));
        }
        
        // 过滤掉不完整的消息对，只保留工具调用和结果都完整的消息
        return messages.filter(message => {
            if (typeof message.content === 'string') {
                return true; // 文本消息总是保留
            }
            
            // 检查是否包含 tool_use
            const hasToolUse = message.content.some(content => content.type === 'tool_use');
            if (!hasToolUse) {
                return true; // 没有 tool_use 的消息总是保留
            }
            
            // 检查所有 tool_use 是否都有对应的 tool_result
            const incompleteToolUses = message.content.filter(content => {
                if (content.type === 'tool_use') {
                    return !toolResultIds.has(content.id);
                }
                return false;
            }) as Array<{ type: 'tool_use'; id: string; name: string; input: any }>;
            
            if (incompleteToolUses.length > 0) {
                if (process.env.DEBUG === 'true') {
                    console.log('[DEBUG] cleanIncompleteToolCalls - Removing message with incomplete tool uses:', incompleteToolUses.map(tu => ({ id: tu.id, name: tu.name })));
                }
                return false; // 移除有不完整 tool_use 的消息
            }
            
            return true;
        });
    }

    private async convertNormalResponse(openaiResponse: Response): Promise<Response> {
        const openaiData = (await openaiResponse.json()) as types.OpenAIResponse

        const claudeResponse: types.ClaudeResponse = {
            id: utils.generateId(),
            type: 'message',
            role: 'assistant',
            content: []
        }

        if (openaiData.choices && openaiData.choices.length > 0) {
            const choice = openaiData.choices[0]
            const message = choice.message

            if (message.content) {
                claudeResponse.content.push({
                    type: 'text',
                    text: message.content
                })
            }

            if (message.tool_calls) {
                for (const toolCall of message.tool_calls) {
                    let input: any = {};
                    try {
                        // Fix Qwen3-coder's single quotes issue
                        let argsString = toolCall.function.arguments || '{}';
                        // 尝试直接解析
                        try {
                            input = JSON.parse(argsString);
                        } catch (e1) {
                            // 如果直接解析失败，尝试修复单引号问题
                            if (process.env.DEBUG === 'true') {
                                console.log('[DEBUG] Failed to parse arguments directly, trying to fix single quotes:', argsString);
                            }
                            argsString = argsString.replace(/'/g, '"');
                            try {
                                input = JSON.parse(argsString);
                            } catch (e2) {
                                console.error('Failed to parse tool arguments after fixing single quotes:', argsString, 'Error:', e2);
                                input = {};
                            }
                        }
                    } catch (e) {
                        console.error('Failed to parse tool arguments:', toolCall.function.arguments, 'Error:', e);
                        input = {};
                    }
                    
                    claudeResponse.content.push({
                        type: 'tool_use',
                        id: toolCall.id,
                        name: toolCall.function.name,
                        input: input
                    })
                }
                claudeResponse.stop_reason = 'tool_use'
            } else if (choice.finish_reason === 'length') {
                claudeResponse.stop_reason = 'max_tokens'
            } else {
                claudeResponse.stop_reason = 'end_turn'
            }
        }

        if (openaiData.usage) {
            claudeResponse.usage = {
                input_tokens: openaiData.usage.prompt_tokens,
                output_tokens: openaiData.usage.completion_tokens
            }
        }

        return new Response(JSON.stringify(claudeResponse), {
            status: openaiResponse.status,
            headers: {
                'Content-Type': 'application/json'
            }
        })
    }

    private async convertStreamResponse(openaiResponse: Response): Promise<Response> {
        return utils.processProviderStream(openaiResponse, (jsonStr, textBlockIndex, toolUseBlockIndex) => {
            const openaiData = JSON.parse(jsonStr) as types.OpenAIStreamResponse
            if (!openaiData.choices || openaiData.choices.length === 0) {
                return null
            }

            const choice = openaiData.choices[0]
            const delta = choice.delta
            const events: string[] = []
            let currentTextIndex = textBlockIndex
            let currentToolIndex = toolUseBlockIndex

            if (delta.content) {
                events.push(...utils.processTextPart(delta.content, currentTextIndex))
                currentTextIndex++
            }

            if (delta.tool_calls) {
                for (const toolCall of delta.tool_calls) {
                    if (toolCall.function?.name && toolCall.function?.arguments) {
                        events.push(
                            ...utils.processToolUsePart(
                                {
                                    name: toolCall.function.name,
                                    args: JSON.parse(toolCall.function.arguments)
                                },
                                currentToolIndex
                            )
                        )
                        currentToolIndex++
                    }
                }
            }

            return {
                events,
                textBlockIndex: currentTextIndex,
                toolUseBlockIndex: currentToolIndex
            }
        })
    }
}