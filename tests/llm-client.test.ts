import test from 'node:test'
import assert from 'node:assert/strict'
import { createClient, toRequest } from '../src/llm/client.ts'
import { parseReply } from '../src/llm/parse.ts'
import { ModelError } from '../src/llm/types.ts'

const ok = (message: unknown, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ choices: [{ message, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 }, ...extra }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
const fail = (status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { message: 'synthetic failure' } }), { status, headers })

/** A client whose fetch answers from a list and records the requests; no real waiting */
function scripted(responses: (Response | Error)[]) {
  const requests: unknown[] = []
  const waits: number[] = []
  const client = createClient({
    baseUrl: 'https://example.test/v1/',
    apiKey: 'test-key',
    model: 'test-model',
    fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)))
      const next = responses.shift()
      if (!next) throw new Error('no scripted response left')
      if (next instanceof Error) throw next
      return next
    },
    sleep: async (ms) => void waits.push(ms),
  })
  return { client, requests, waits }
}

test('text reply is parsed with usage', async () => {
  const { client } = scripted([ok({ role: 'assistant', content: 'Hello' })])
  const reply = await client.complete([{ role: 'user', content: 'Hi' }])
  assert.equal(reply.text, 'Hello')
  assert.deepEqual(reply.toolCalls, [])
  assert.deepEqual(reply.usage, { inputTokens: 10, outputTokens: 5 })
})

test('tool calls are parsed and the provider signature is sent back unchanged', async () => {
  const call = {
    id: 'c1',
    type: 'function',
    function: { name: 'get_plan', arguments: '{"date":"2026-11-13"}' },
    extra_content: { google: { thought_signature: 'sig' } },
  }
  const reply = parseReply({ choices: [{ message: { role: 'assistant', tool_calls: [call] }, finish_reason: 'tool_calls' }] })
  assert.deepEqual(reply.toolCalls, [{ id: 'c1', name: 'get_plan', arguments: { date: '2026-11-13' }, extra: { google: { thought_signature: 'sig' } } }])

  const body = toRequest('m', [{ role: 'assistant', content: null, toolCalls: reply.toolCalls }], []) as {
    messages: { tool_calls: { extra_content: unknown }[] }[]
  }
  assert.deepEqual(body.messages[0].tool_calls[0].extra_content, { google: { thought_signature: 'sig' } })
})

test('malformed tool-call arguments become invalid_response, not a crash', () => {
  const bad = (args: unknown) => () =>
    parseReply({ choices: [{ message: { tool_calls: [{ id: 'c', function: { name: 'get_plan', arguments: args } }] } }] })
  assert.throws(bad('{"date": '), (e: unknown) => e instanceof ModelError && e.kind === 'invalid_response')
  assert.throws(bad('[1, 2]'), (e: unknown) => e instanceof ModelError && e.kind === 'invalid_response')
  assert.throws(() => parseReply({ choices: [] }), (e: unknown) => e instanceof ModelError && e.kind === 'invalid_response')
})

test('rate limit is retried after Retry-After, then succeeds', async () => {
  const { client, waits, requests } = scripted([fail(429, { 'retry-after': '2' }), ok({ content: 'done' })])
  const reply = await client.complete([{ role: 'user', content: 'Hi' }])
  assert.equal(reply.text, 'done')
  assert.deepEqual(waits, [2000])
  assert.equal(requests.length, 2)
})

test('server errors stop after the retry budget', async () => {
  const { client, requests } = scripted([fail(503), fail(503), fail(503), ok({ content: 'never' })])
  await assert.rejects(client.complete([{ role: 'user', content: 'Hi' }]), (e: unknown) => e instanceof ModelError && e.kind === 'server')
  assert.equal(requests.length, 3) // first attempt + 2 retries
})

test('auth errors are not retried and the key is not in the message', async () => {
  const { client, requests } = scripted([fail(401)])
  await assert.rejects(client.complete([{ role: 'user', content: 'Hi' }]), (e: unknown) => {
    assert.ok(e instanceof ModelError && e.kind === 'auth')
    assert.ok(!e.message.includes('test-key'))
    return true
  })
  assert.equal(requests.length, 1)
})

test('timeouts are reported as timeout and retried', async () => {
  const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' })
  const { client, requests } = scripted([timeout, ok({ content: 'late but fine' })])
  assert.equal((await client.complete([{ role: 'user', content: 'Hi' }])).text, 'late but fine')
  assert.equal(requests.length, 2)
})

test('missing configuration fails before any request', () => {
  assert.throws(() => createClient({ baseUrl: 'https://example.test', apiKey: '', model: 'm' }), (e: unknown) => e instanceof ModelError && e.kind === 'config')
})
