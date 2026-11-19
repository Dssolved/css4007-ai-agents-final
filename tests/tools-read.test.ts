import test from 'node:test'
import assert from 'node:assert/strict'
import { generate } from '../src/data/generate.ts'
import { callTool, specOf, toolMessage } from '../src/tools/registry.ts'
import { READ_TOOLS, baseline, type ReadCtx } from '../src/tools/read.ts'
import { validateArgs, type ArgsSchema } from '../src/tools/schema.ts'

const ctx: ReadCtx = { dataset: generate().dataset }
const call = (name: string, args: unknown) => callTool(READ_TOOLS, { id: 'c', name, arguments: args }, ctx)

test('argument schema: types, real dates, enums, ranges and unknown keys', () => {
  const schema: ArgsSchema = {
    type: 'object',
    properties: { day: { type: 'string', format: 'date' }, n: { type: 'integer', minimum: 1, maximum: 5 }, kind: { type: 'string', enum: ['a', 'b'] } },
    required: ['day'],
    additionalProperties: false,
  }
  assert.ok(validateArgs(schema, { day: '2026-11-20', n: 3, kind: 'a' }).ok)
  const bad = validateArgs(schema, { day: '2026-02-30', n: 2.5, kind: 'c', extra: 1 })
  assert.ok(!bad.ok)
  if (!bad.ok) {
    assert.equal(bad.errors.length, 4)
    assert.ok(bad.errors.some((e) => e.includes('real date')))
    assert.ok(bad.errors.some((e) => e.includes('unknown argument "extra"')))
  }
  assert.ok(!validateArgs(schema, {}).ok)
  assert.ok(!validateArgs(schema, 'not an object').ok)
})

test('unknown tools and malformed arguments never run', () => {
  assert.equal(call('delete_everything', {}).ok, false)
  const reversed = call('get_days', { from: '2026-11-20', to: '2026-11-10' })
  assert.ok(!reversed.ok && reversed.kind === 'invalid_args' && reversed.error.includes('after'))
  const tooLong = call('get_sleep', { from: '2026-09-01', to: '2026-11-20' })
  assert.ok(!tooLong.ok && tooLong.error.includes('at most 31'))
  const future = call('get_baseline', { metric: 'energy', days: 14, until: '2027-01-01' })
  assert.ok(!future.ok)
  // The model sees the error as the tool result and can correct itself
  assert.match(toolMessage(reversed), /"error"/)
})

test('get_days and get_sleep: facts computed by code, gaps reported', () => {
  const days = call('get_days', { from: '2026-10-15', to: '2026-10-20' })
  assert.ok(days.ok)
  const r = days.result as { days: { date: string; sleep: { hours: number } | null }[]; missing: string[] }
  assert.deepEqual(r.missing, ['2026-10-17', '2026-10-18'])
  assert.ok(r.days.every((d) => d.sleep && d.sleep.hours > 4 && d.sleep.hours < 11))
  const sleep = call('get_sleep', { from: '2026-11-22', to: '2026-11-22' })
  assert.ok(sleep.ok)
  const night = (sleep.result as { nights: { morning: string; asleep: string }[] }).nights[0]
  assert.equal(night.morning, '2026-11-22')
  assert.match(night.asleep, /^\d{2}:\d{2}$/)
})

test('get_plan: next week with fixed times, deadlines and the inbox', () => {
  const plan = call('get_plan', { from: '2026-11-23', to: '2026-11-29', include_inbox: true })
  assert.ok(plan.ok)
  const r = plan.result as { days: { date: string; tasks: { title: string; time?: string }[] }[]; inbox: { moved_times?: number }[] }
  assert.equal(r.days.length, 7)
  assert.ok(r.days.find((d) => d.date === '2026-11-26')!.tasks.some((t) => t.title.startsWith('Exam') && t.time === '19:00'))
  assert.ok(r.inbox.length >= 10)
  assert.ok(r.inbox.some((t) => (t.moved_times ?? 0) >= 3))
})

test('get_baseline: own median, only over days with data, says how many', () => {
  const b = baseline(ctx.dataset, 'asleep_time', 30)
  assert.match(String(b.median), /^\d{2}:\d{2}$/)
  assert.ok(b.days_with_data <= 30)
  // The trip weekend has no data: a window over it counts fewer days, not zeros
  const trip = baseline(ctx.dataset, 'energy', 7, '2026-10-20')
  assert.ok(trip.days_with_data <= 5)
  // The heavy two weeks show up against the month before
  const heavy = baseline(ctx.dataset, 'energy', 14)
  const before = baseline(ctx.dataset, 'energy', 28, '2026-11-08')
  assert.ok((heavy.median as number) < (before.median as number))
})

test('every read tool is exposed to the model with a schema and marked read-only', () => {
  for (const t of READ_TOOLS) {
    assert.equal(t.permission, 'read')
    const spec = specOf(t)
    assert.equal((spec.parameters as { additionalProperties?: boolean }).additionalProperties, false)
    assert.ok(spec.description.length > 40)
  }
})
