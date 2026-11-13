// Week 11: the first working request with tool calling. The model gets one question and two
// tools over a tiny hard-coded day of the fictional person; it decides itself whether to call a
// tool, we run it and send the result back, and the model answers from it.
// Run: npm run first-request -- "How did I sleep last night?"
import { loadModelConfig } from '../config.ts'
import { createClient } from '../llm/client.ts'
import { ModelError, type Message, type ToolSpec } from '../llm/types.ts'

const SLEEP: Record<string, { bed: string; asleep: string; woke: string }> = {
  '2026-11-11': { bed: '23:40', asleep: '00:05', woke: '07:50' },
  '2026-11-12': { bed: '00:30', asleep: '00:55', woke: '07:45' },
}
const PLAN: Record<string, string[]> = {
  '2026-11-12': ['Lab report draft', 'Gym', 'Call the dentist'],
  '2026-11-13': ['Seminar presentation', 'Groceries'],
}
const TODAY = '2026-11-13'

const tools: ToolSpec[] = [
  {
    name: 'get_sleep',
    description: 'Sleep of one night: when the person went to bed, fell asleep and woke up. The night is named by the date of the morning.',
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

function runTool(name: string, args: unknown): string {
  const date = (args as { date?: unknown }).date
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return JSON.stringify({ error: 'date must be YYYY-MM-DD' })
  if (name === 'get_sleep') return JSON.stringify(SLEEP[date] ?? { error: `no sleep record for ${date}` })
  if (name === 'get_plan') return JSON.stringify({ date, tasks: PLAN[date] ?? [] })
  return JSON.stringify({ error: `unknown tool ${name}` })
}

const question = process.argv.slice(2).join(' ') || 'How did I sleep last night, and what is on my plan today?'
const client = createClient(loadModelConfig())
const messages: Message[] = [
  {
    role: 'system',
    content: `You are a warm, non-judgemental companion for a person's day. Today is ${TODAY}. Use the tools for facts; never invent data. Answer briefly.`,
  },
  { role: 'user', content: question },
]

try {
  // At most a few rounds: this is a first request, not the agent loop yet
  for (let round = 1; round <= 4; round++) {
    const reply = await client.complete(messages, tools)
    console.log(`[round ${round}] tokens in/out ${reply.usage.inputTokens}/${reply.usage.outputTokens}, finish: ${reply.finishReason}`)
    messages.push({ role: 'assistant', content: reply.text, toolCalls: reply.toolCalls })
    if (!reply.toolCalls.length) {
      console.log('\n' + (reply.text ?? '(no text)'))
      break
    }
    for (const call of reply.toolCalls) {
      const result = runTool(call.name, call.arguments)
      console.log(`  tool ${call.name}(${JSON.stringify(call.arguments)}) → ${result}`)
      messages.push({ role: 'tool', toolCallId: call.id, content: result })
    }
  }
} catch (e) {
  if (e instanceof ModelError) {
    console.error(`Model error (${e.kind}): ${e.message}`)
    process.exitCode = 1
  } else throw e
}
