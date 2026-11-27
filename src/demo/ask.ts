// Week 12: ask a question about the fictional person; the model answers through the read tools.
// Not the agent loop yet (no plan, state or limits beyond a round cap — that is Week 14).
// Run: npm run ask -- "How have I been sleeping these two weeks compared to before?"
import { modelConfig } from '../config.ts'
import { loadDataset } from '../data/load.ts'
import { weekday } from '../data/time.ts'
import type { Dataset } from '../data/types.ts'
import { createClient, type ModelClient } from '../llm/client.ts'
import { ModelError, type Message } from '../llm/types.ts'
import { callTool, specOf, toolMessage } from '../tools/registry.ts'
import { READ_TOOLS } from '../tools/read.ts'

export function systemPrompt(ds: Dataset): string {
  const p = ds.profile
  return [
    `You are a companion for ${p.name}'s days. Today is ${weekday(ds.today)}, ${ds.today}.`,
    `About ${p.name}: ${p.about}`,
    `Base habits (${p.name}'s own words): ${p.base.map((b) => `${b.title} — ${b.cost}, because ${b.why}`).join('; ')}.`,
    `Intentions: ${p.intentions.map((i) => `${i.text} (because ${i.why})`).join('; ')}.`,
    `Planning rules: ${p.rules.map((r) => r.text).join('; ')}.`,
    'Use the tools for every fact about the days; never invent data, and say plainly when data is missing. Compare with the person\'s own usual values (get_baseline), not with general norms.',
    'Voice: warm, direct, like an honest friend. Connect the facts into a cause, give one concrete suggestion tied to the person\'s own intentions, and end with a short question. No lists of statistics; numbers only when they help. No blame, no streaks.',
  ].join('\n')
}

export async function ask(client: ModelClient, ds: Dataset, question: string, log = console.log, maxRounds = 6) {
  const messages: Message[] = [
    { role: 'system', content: systemPrompt(ds) },
    { role: 'user', content: question },
  ]
  const tools = READ_TOOLS.map(specOf)
  for (let round = 1; round <= maxRounds; round++) {
    const reply = await client.complete(messages, tools)
    messages.push({ role: 'assistant', content: reply.text, toolCalls: reply.toolCalls })
    if (!reply.toolCalls.length) return reply.text
    for (const call of reply.toolCalls) {
      const outcome = callTool(READ_TOOLS, call, { dataset: ds })
      log(`  ${outcome.ok ? '✓' : '✗'} ${call.name}(${JSON.stringify(call.arguments)})${outcome.ok ? '' : ' → ' + outcome.error}`)
      messages.push({ role: 'tool', toolCallId: call.id, content: toolMessage(outcome) })
    }
  }
  return null
}

if (process.argv[1]?.endsWith('ask.ts')) {
  const question = process.argv.slice(2).join(' ') || 'How have I been sleeping these two weeks compared to before, and why?'
  try {
    const answer = await ask(createClient(modelConfig()), loadDataset('data/mira.json'), question)
    console.log('\n' + (answer ?? '(no answer within the round limit)'))
  } catch (e) {
    if (e instanceof ModelError) {
      console.error(`Model error (${e.kind}): ${e.message}`)
      process.exitCode = 1
    } else throw e
  }
}
