// Provider-neutral shapes for one exchange with a chat model (OpenAI-compatible tool calling).

export type Role = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCall {
  /** Provider-assigned id; the tool result must echo it back */
  id: string
  name: string
  /** Parsed JSON arguments. Not validated yet: that happens before the tool runs */
  arguments: unknown
  /**
   * Opaque provider data that must be sent back unchanged with the call in the next request
   * (Gemini 3: `extra_content.google.thought_signature`, otherwise HTTP 400)
   */
  extra?: Record<string, unknown>
}

export type Message =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }

/** A tool as the model sees it: a name, a description and a JSON Schema for the arguments */
export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface Usage {
  inputTokens: number
  outputTokens: number
}

export interface ModelReply {
  text: string | null
  toolCalls: ToolCall[]
  usage: Usage
  /** Why the model stopped: 'stop', 'tool_calls', 'length', … as the provider reports it */
  finishReason: string
}

export type ModelErrorKind =
  | 'config' // missing key / model / base URL
  | 'auth' // 401, 403
  | 'rate_limit' // 429
  | 'server' // 5xx
  | 'timeout'
  | 'network'
  | 'bad_request' // other 4xx
  | 'invalid_response' // reply we cannot parse, including malformed tool-call JSON

export class ModelError extends Error {
  readonly kind: ModelErrorKind
  readonly status: number | undefined
  /** Worth retrying the same request later */
  readonly retryable: boolean
  /** Wait the provider asked for (Retry-After), if any */
  readonly retryAfterMs: number | undefined

  constructor(kind: ModelErrorKind, message: string, status?: number, retryAfterMs?: number) {
    super(message)
    this.name = 'ModelError'
    this.kind = kind
    this.status = status
    this.retryAfterMs = retryAfterMs
    this.retryable = kind === 'rate_limit' || kind === 'server' || kind === 'timeout' || kind === 'network'
  }
}
