// Week 11: the first working request with tool calling. The model gets one question and two
// tools over a tiny hard-coded day of the fictional person; it decides itself whether to call a
// tool, we run it and send the result back, and the model answers from it.
// Run: npm run first-request -- "How did I sleep last night?"
import { modelConfig } from '../config.ts'
import { createClient } from '../llm/client.ts'
import { ModelError } from '../llm/types.ts'
import { askWithTools } from './tiny-day.ts'

const question = process.argv.slice(2).join(' ') || 'How did I sleep last night, and what is on my plan today?'

try {
  const result = await askWithTools(createClient(modelConfig()), question, 4, console.log)
  console.log('\n' + (result.answer ?? '(no answer within the round limit)'))
} catch (e) {
  if (e instanceof ModelError) {
    console.error(`Model error (${e.kind}): ${e.message}`)
    process.exitCode = 1
  } else throw e
}
