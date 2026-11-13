import { parseReply } from './parse.ts'
import { ModelError, type Message, type ModelReply, type ToolSpec } from './types.ts'

export interface ClientConfig {
  baseUrl: string
  apiKey: string
  model: string
  /** Per attempt */
  timeoutMs?: number
  /** Retries after the first attempt, only for retryable errors */
  maxRetries?: number
  /** Injected in tests; the global fetch otherwise */
  fetch?: typeof fetch
  /** Injected in tests to skip real waiting */
  sleep?: (ms: number) => Promise<void>
}

export interface ModelClient {
  readonly model: string
  complete(messages: Message[], tools?: ToolSpec[]): Promise<ModelReply>
}

const BACKOFF_MS = [1000, 3000, 8000]
const MAX_WAIT_MS = 30_000

/** One OpenAI-compatible chat-completions client: works with Gemini, OpenRouter and OpenAI by base URL */
export function createClient(config: ClientConfig): ModelClient {
  const { baseUrl, apiKey, model } = config
  if (!baseUrl || !apiKey || !model) {
    throw new ModelError('config', 'LLM_BASE_URL, LLM_API_KEY and LLM_MODEL must be set')
  }
  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions'
  const timeoutMs = config.timeoutMs ?? 30_000
  const maxRetries = config.maxRetries ?? 2
  const doFetch = config.fetch ?? fetch
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  async function attempt(body: string): Promise<ModelReply> {
    let response: Response
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (e) {
      const name = (e as Error)?.name
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new ModelError('timeout', `No response within ${timeoutMs} ms`)
      }
      throw new ModelError('network', `Request failed: ${(e as Error)?.message ?? e}`)
    }

    if (!response.ok) {
      const retryAfter = Number(response.headers.get('retry-after'))
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, MAX_WAIT_MS) : undefined
      throw new ModelError(kindOf(response.status), await errorText(response), response.status, wait)
    }

    let json: unknown
    try {
      json = await response.json()
    } catch {
      throw new ModelError('invalid_response', 'Response body is not JSON')
    }
    return parseReply(json)
  }

  return {
    model,
    async complete(messages, tools = []) {
      const body = JSON.stringify(toRequest(model, messages, tools))
      for (let i = 0; ; i++) {
        try {
          return await attempt(body)
        } catch (e) {
          if (!(e instanceof ModelError) || !e.retryable || i >= maxRetries) throw e
          const wait = e.retryAfterMs ?? BACKOFF_MS[i] ?? MAX_WAIT_MS
          await sleep(wait)
        }
      }
    },
  }
}

function kindOf(status: number) {
  if (status === 401 || status === 403) return 'auth' as const
  if (status === 429) return 'rate_limit' as const
  if (status >= 500) return 'server' as const
  return 'bad_request' as const
}

/** Short provider message for the error; never includes request headers (the key) */
async function errorText(response: Response): Promise<string> {
  let detail = ''
  try {
    // Gemini sometimes wraps the error object in a list
    type Body = { error?: { message?: string } }
    const json = (await response.json()) as Body | Body[]
    const err = Array.isArray(json) ? json[0]?.error : json.error
    detail = err?.message ?? ''
  } catch {
    // body is not JSON — the status is enough
  }
  return `HTTP ${response.status}${detail ? ': ' + detail.slice(0, 300) : ''}`
}

/** Our Message shape → OpenAI chat-completions request */
export function toRequest(model: string, messages: Message[], tools: ToolSpec[]) {
  return {
    model,
    messages: messages.map((m) => {
      if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
      if (m.role === 'assistant') {
        return {
          role: 'assistant',
          content: m.content,
          ...(m.toolCalls?.length
            ? {
                tool_calls: m.toolCalls.map((c) => ({
                  id: c.id,
                  type: 'function',
                  function: { name: c.name, arguments: JSON.stringify(c.arguments) },
                  ...(c.extra ? { extra_content: c.extra } : {}),
                })),
              }
            : {}),
        }
      }
      return { role: m.role, content: m.content }
    }),
    ...(tools.length
      ? {
          tools: tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
          tool_choice: 'auto',
        }
      : {}),
  }
}
