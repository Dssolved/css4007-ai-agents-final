import { ModelError, type ModelReply, type ToolCall } from './types.ts'

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Validates a chat-completions response and turns it into a ModelReply. Anything unexpected —
 * no choices, a tool call without a name, arguments that are not a JSON object — becomes a
 * ModelError('invalid_response') instead of a crash further down the agent loop.
 */
export function parseReply(raw: unknown): ModelReply {
  if (!isObject(raw) || !Array.isArray(raw.choices) || raw.choices.length === 0) {
    throw new ModelError('invalid_response', 'Response has no choices')
  }
  const choice = raw.choices[0]
  if (!isObject(choice) || !isObject(choice.message)) {
    throw new ModelError('invalid_response', 'Choice has no message')
  }
  const message = choice.message
  const content = message.content
  if (content !== null && content !== undefined && typeof content !== 'string') {
    throw new ModelError('invalid_response', 'Message content is not text')
  }

  const toolCalls: ToolCall[] = []
  if (message.tool_calls !== undefined && message.tool_calls !== null) {
    if (!Array.isArray(message.tool_calls)) throw new ModelError('invalid_response', 'tool_calls is not a list')
    message.tool_calls.forEach((call, i) => toolCalls.push(parseToolCall(call, i)))
  }

  const usage = isObject(raw.usage) ? raw.usage : {}
  return {
    text: typeof content === 'string' && content.trim() ? content : null,
    toolCalls,
    usage: {
      inputTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
      outputTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0,
    },
    finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : 'unknown',
  }
}

function parseToolCall(call: unknown, index: number): ToolCall {
  if (!isObject(call) || !isObject(call.function)) {
    throw new ModelError('invalid_response', `Tool call ${index} has no function`)
  }
  const { name, arguments: args } = call.function
  if (typeof name !== 'string' || !name) throw new ModelError('invalid_response', `Tool call ${index} has no name`)

  // Arguments arrive as a JSON string; an empty string means "no arguments"
  let parsed: unknown = {}
  if (typeof args === 'string' && args.trim()) {
    try {
      parsed = JSON.parse(args)
    } catch {
      throw new ModelError('invalid_response', `Tool call ${index} (${name}) has malformed JSON arguments`)
    }
  } else if (isObject(args)) {
    parsed = args
  }
  if (!isObject(parsed)) throw new ModelError('invalid_response', `Tool call ${index} (${name}) arguments are not an object`)

  // Some providers omit ids; the agent needs one to pair the result with the call
  const id = typeof call.id === 'string' && call.id ? call.id : `call_${index}`
  return { id, name, arguments: parsed, ...(isObject(call.extra_content) ? { extra: call.extra_content } : {}) }
}
