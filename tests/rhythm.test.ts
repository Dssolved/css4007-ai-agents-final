// The rhythm portrait must show what is planted in the fictional person's data — it is what the
// agent will rely on for advice and planning, so a wrong portrait means wrong advice.
import test from 'node:test'
import assert from 'node:assert/strict'
import { generate } from '../src/data/generate.ts'
import { rhythm } from '../src/analytics/rhythm.ts'
import { callTool } from '../src/tools/registry.ts'
import { READ_TOOLS } from '../src/tools/read.ts'

const { dataset } = generate()
const r = rhythm(dataset)
const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h < 12 ? h + 24 : h) * 60 + m // evening clock times past midnight count as later
}

test('usual times and the energy curve: peak late morning, dip after lunch', () => {
  assert.equal(r.energy_peak, '10–12')
  assert.equal(r.energy_dip, '14–16')
  assert.ok(minutes(r.usual_times.dinner!) < minutes('20:30'))
  assert.match(r.usual_times.workout!, /^1[89]:/)
})

test('lately vs usual: the heavy two weeks are visible', () => {
  assert.ok(r.lately.sleep_hours! < r.usual.sleep_hours! - 0.5)
  assert.ok(minutes(r.lately.asleep!) > minutes(r.usual.asleep!) + 30)
  assert.ok(r.lately.energy! < r.usual.energy! - 0.15)
  assert.ok(r.lately.steps! < r.usual.steps! * 0.7)
  assert.ok(r.sleep_debt_hours_last_7! > 3)
})

test('base habits: the stretch and tooth brushing are slipping, water is not', () => {
  const slipping = r.base_habits.filter((b) => b.slipping).map((b) => b.id)
  assert.deepEqual(slipping.sort(), ['brush', 'stretch'])
})

test('moved tasks come from Thursdays; next week and the inbox are summarised', () => {
  assert.equal(r.moved_tasks_mostly_from, 'Thursday')
  assert.equal(r.next_week.length, 7)
  assert.ok(r.next_week.find((d) => d.weekday === 'Thursday')!.big_tasks.some((t) => t.startsWith('Exam')))
  assert.ok(r.next_week.find((d) => d.weekday === 'Tuesday')!.fixed.some((f) => f.startsWith('15:00')))
  assert.ok(r.inbox.count >= 10 && r.inbox.with_deadline >= 3)
})

test('get_rhythm is a read tool without arguments; extra arguments are rejected', () => {
  const ok = callTool(READ_TOOLS, { id: 'c', name: 'get_rhythm', arguments: {} }, { dataset })
  assert.ok(ok.ok)
  const bad = callTool(READ_TOOLS, { id: 'c', name: 'get_rhythm', arguments: { days: 3 } }, { dataset })
  assert.ok(!bad.ok && bad.kind === 'invalid_args')
})
