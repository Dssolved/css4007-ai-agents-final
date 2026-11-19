// The fictional person's data must be valid, reproducible and must really contain the planted
// patterns — otherwise evaluating whether the agent "finds" them would be meaningless.
import test from 'node:test'
import assert from 'node:assert/strict'
import { generate, HEAVY_FROM, INJECTION_TEXT, TODAY } from '../src/data/generate.ts'
import { validateDataset } from '../src/data/load.ts'
import { addDays, minutesFrom, weekday } from '../src/data/time.ts'
import type { Day } from '../src/data/types.ts'

const { dataset, truth } = generate()
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
const byDate = new Map(dataset.days.map((d) => [d.date, d]))
const asleepMin = (d: Day) => minutesFrom(d.date, d.sleep!.asleep) // relative to that morning's midnight
const dayEnergy = (d: Day) => (d.energy.length ? mean(d.energy.map((e) => e.level)) : undefined)
/** Next-day records split by a flag of the evening before; heavy period excluded to isolate the cause */
function split<T>(flag: keyof (typeof truth.evenings)[string], value: (d: Day) => T | undefined) {
  const yes: T[] = []
  const no: T[] = []
  for (const [date, ev] of Object.entries(truth.evenings)) {
    const next = byDate.get(addDays(date, 1))
    if (!next || date >= HEAVY_FROM) continue
    const v = value(next)
    if (v !== undefined) (ev[flag] ? yes : no).push(v)
  }
  return { yes, no }
}

test('generated dataset is valid and reproducible', () => {
  assert.deepEqual(validateDataset(dataset), [])
  assert.deepEqual(generate(), { dataset, truth })
  assert.notDeepEqual(generate(7).dataset.days[5], dataset.days[5])
  assert.equal(dataset.today, TODAY)
})

test('validation rejects broken records with a path to the problem', () => {
  const broken = structuredClone(dataset)
  broken.days[3].sleep!.asleep = '2026-13-01T25:00'
  broken.tasks[0].size = 'huge' as never
  broken.tasks[1].id = broken.tasks[2].id
  const errors = validateDataset(broken)
  assert.ok(errors.some((e) => e.startsWith('days[3].sleep.asleep')))
  assert.ok(errors.some((e) => e.startsWith('tasks[0].size')))
  assert.ok(errors.some((e) => e.includes('duplicate id')))
})

test('planted: late screens → later sleep and less energy next day', () => {
  const sleep = split('lateScreen', asleepMin)
  assert.ok(mean(sleep.yes) - mean(sleep.no) > 25, 'falls asleep at least ~25 min later')
  const energy = split('lateScreen', dayEnergy)
  assert.ok(mean(energy.yes) < mean(energy.no) - 0.05)
})

test('planted: late dinner → takes longer to fall asleep, worse quality', () => {
  const latency = split('lateDinner', (d) => minutesFrom(d.date, d.sleep!.asleep) - minutesFrom(d.date, d.sleep!.bed))
  assert.ok(mean(latency.yes) - mean(latency.no) > 12)
  const quality = split('lateDinner', (d) => d.sleep!.feel?.quality)
  assert.ok(mean(quality.yes) < mean(quality.no) - 0.15)
})

test('planted: workouts → deeper sleep', () => {
  const quality = split('workout', (d) => d.sleep!.feel?.quality)
  assert.ok(mean(quality.yes) > mean(quality.no) + 0.15)
})

test('planted: Thursdays carry the most tasks and the most moves', () => {
  // Where a task was first planned: the final date of a moved task is where it landed, not where it left
  const firstDay = (t: (typeof dataset.tasks)[number]) => t.firstDate ?? t.date!
  const past = dataset.tasks.filter((t) => t.date && t.date <= TODAY)
  const planned = (wd: string) => past.filter((t) => weekday(firstDay(t)) === wd)
  const movedFrom = (wd: string) => planned(wd).filter((t) => t.firstDate).length
  for (const wd of ['Monday', 'Tuesday', 'Wednesday', 'Friday']) {
    assert.ok(planned('Thursday').length > planned(wd).length, 'planned ' + wd)
    assert.ok(movedFrom('Thursday') > movedFrom(wd), 'moved ' + wd)
  }
})

test('planted: the last two weeks are heavy and the base habits drift', () => {
  const heavy = dataset.days.filter((d) => d.date >= HEAVY_FROM)
  const before = dataset.days.filter((d) => d.date < HEAVY_FROM)
  assert.ok(mean(heavy.map(asleepMin)) > mean(before.map(asleepMin)) + 30)
  assert.ok(mean(heavy.map((d) => d.steps ?? 0)) < mean(before.map((d) => d.steps ?? 0)) * 0.7)
  const stretch = (ds: Day[]) => ds.filter((d) => d.routines.evening?.done.includes('stretch')).length / ds.length
  assert.ok(stretch(heavy) < 0.3 && stretch(before) > 0.6)
  const lastWeek = dataset.days.filter((d) => d.date > addDays(TODAY, -7))
  assert.ok(lastWeek.filter((d) => !d.routines.evening?.done.includes('brush')).length >= 2)
})

test('planted: gaps and exactly one injected instruction', () => {
  assert.ok(!byDate.has('2026-10-17') && !byDate.has('2026-10-18'))
  assert.ok(!byDate.get('2026-10-02')!.screen!.some((s) => s.device === 'laptop'))
  const injected = dataset.days.flatMap((d) => d.notes).filter((n) => n.text === INJECTION_TEXT)
  assert.equal(injected.length, 1)
})

test('next week has the planning scenario: exam, hand-in, appointment and an inbox', () => {
  const next = dataset.tasks.filter((t) => t.date && t.date > TODAY)
  assert.ok(next.some((t) => t.title.startsWith('Exam') && t.time && t.deadline))
  assert.ok(next.some((t) => t.time === '15:00'))
  const inbox = dataset.tasks.filter((t) => !t.date && !t.someday && !t.doneAt && !t.droppedAt)
  assert.ok(inbox.length >= 10)
  assert.ok(inbox.some((t) => t.deadline) && inbox.some((t) => t.moves >= 3))
})
