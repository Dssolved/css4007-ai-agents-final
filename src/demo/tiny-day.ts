// A tiny hard-coded slice of the fictional person's days and two read tools over it, plus a
// bounded tool-calling round trip. Used by the first request and the model comparison (Week 11);
// the real dataset and tool registry come in Week 12–13.
import type { ModelClient } from '../llm/client.ts'
import type { Message, ToolCall, ToolSpec, Usage } from '../llm/types.ts'

export const TODAY = '2026-11-13'

const SLEEP: Record<string, { bed: string; asleep: string; woke: string }> = {
  '2026-11-11': { bed: '23:40', asleep: '00:05', woke: '07:50' },
  '2026-11-12': { bed: '00:30', asleep: '00:55', woke: '07:45' },
  '2026-11-13': { bed: '23:15', asleep: '23:35', woke: '07:30' },
}
const PLAN: Record<string, string[]> = {
  '2026-11-11': ['Statistics homework', 'Laundry'],
  '2026-11-12': ['Lab report draft', 'Gym', 'Call the dentist'],
  '2026-11-13': ['Seminar presentation', 'Groceries'],
}

export const TOOLS: ToolSpec[] = [
  {
    name: 'get_sleep',
    description:
      'Sleep of one night: when the person went to bed, fell asleep and woke up. A night is named by the date of the MORNING it ends in, so "last night" is today\'s date.',
    parameters: {
      type: 'object',
      properties: { date: { type: 'string', description: 'Morning date, YYYY-MM-DD' } },
      required: ['date'],
    },
  },
  {
    name: 'get_plan',
    description: 'Tasks planned for one day.',
    parameters: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
      required: ['date'],
    },
  },
]

export function runTool(name: string, args: unknown): string {
  const date = (args as { date?: unknown }).date
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return JSON.stringify({ error: 'date must be YYYY-MM-DD' })
  if (name === 'get_sleep') return JSON.stringify(SLEEP[date] ?? { error: `no sleep record for ${date}` })
  if (name === 'get_plan') return JSON.stringify({ date, tasks: PLAN[date] ?? [] })
  return JSON.stringify({ error: `unknown tool ${name}` })
}

export const SYSTEM = `You are a warm, non-judgemental companion for a person's day. Today is ${TODAY}. Use the tools for facts; never invent data. Answer briefly.`

export interface RoundTrip {
  answer: string | null
  calls: ToolCall[]
  rounds: number
  usage: Usage
}

/** Question → tool calls → answer, at most `maxRounds` model calls (not the agent loop yet) */
export async function askWithTools(client: ModelClient, question: string, maxRounds = 4, log?: (line: string) => void): Promise<RoundTrip> {
  const messages: Message[] = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: question },
  ]
  const calls: ToolCall[] = []
  const usage = { inputTokens: 0, outputTokens: 0 }
  for (let round = 1; round <= maxRounds; round++) {
    const reply = await client.complete(messages, TOOLS)
    usage.inputTokens += reply.usage.inputTokens
    usage.outputTokens += reply.usage.outputTokens
    log?.(`[round ${round}] tokens in/out ${reply.usage.inputTokens}/${reply.usage.outputTokens}, finish: ${reply.finishReason}`)
    messages.push({ role: 'assistant', content: reply.text, toolCalls: reply.toolCalls })
    if (!reply.toolCalls.length) return { answer: reply.text, calls, rounds: round, usage }
    for (const call of reply.toolCalls) {
      const result = runTool(call.name, call.arguments)
      log?.(`  tool ${call.name}(${JSON.stringify(call.arguments)}) → ${result}`)
      calls.push(call)
      messages.push({ role: 'tool', toolCallId: call.id, content: result })
    }
  }
  return { answer: null, calls, rounds: maxRounds, usage }
}
