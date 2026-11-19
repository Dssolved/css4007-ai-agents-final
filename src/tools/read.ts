// Read-only tools over a dataset. They return compact, already-computed facts (clock times,
// averages, counts) rather than raw records: cheaper in tokens, and the arithmetic is done by code,
// not by the model. Free-text notes are not exposed here (search_notes comes with untrusted-content
// handling in Week 13).
import { addDays, clock, clockOf, daysBetween, minutesFrom, weekday, type LogicalDate } from '../data/time.ts'
import type { Dataset, Day, Task } from '../data/types.ts'
import type { Tool } from './registry.ts'

export interface ReadCtx {
  dataset: Dataset
}

const MAX_RANGE = 31
const date = (description: string) => ({ type: 'string' as const, format: 'date' as const, description })
const rangeCheck = (max: number) => (a: { from: string; to: string }) => {
  const n = daysBetween(a.from, a.to)
  if (n < 0) return '"from" must not be after "to"'
  if (n >= max) return `the range may cover at most ${max} days`
  return null
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10)
const r2 = (x: number | null) => (x === null ? null : Math.round(x * 100) / 100)
const POINTS = { small: 1, normal: 2, big: 4 } as const

function daysIn(ds: Dataset, from: LogicalDate, to: LogicalDate) {
  const days = ds.days.filter((d) => d.date >= from && d.date <= to)
  const have = new Set(days.map((d) => d.date))
  const missing: LogicalDate[] = []
  for (let d = from; d <= to && d <= ds.today; d = addDays(d, 1)) if (!have.has(d)) missing.push(d)
  return { days, missing }
}

const sleepHours = (d: Day) => (d.sleep ? (minutesFrom(d.date, d.sleep.wake) - minutesFrom(d.date, d.sleep.asleep)) / 60 : null)
const lateScreen = (d: Day) => (d.screen ? d.screen.reduce((s, x) => s + x.lateMinutes, 0) : null)
const tasksOf = (ds: Dataset, day: LogicalDate) => ds.tasks.filter((t) => t.date === day)

function daySummary(ds: Dataset, d: Day) {
  const tasks = tasksOf(ds, d.date)
  const meal = (k: string) => {
    const m = d.meals.find((x) => x.kind === k)
    return m ? clockOf(m.at) : null
  }
  const ev = d.routines.evening
  return {
    date: d.date,
    weekday: weekday(d.date),
    sleep: d.sleep ? { asleep: clockOf(d.sleep.asleep), woke: clockOf(d.sleep.wake), hours: r1(sleepHours(d)) } : null,
    energy: r2(mean(d.energy.map((e) => e.level))),
    mood: r2(mean(d.mood.map((m) => m.valence))),
    tension: r2(mean(d.mood.flatMap((m) => (m.tension === undefined ? [] : [m.tension])))),
    meals: { breakfast: meal('breakfast'), lunch: meal('lunch'), dinner: meal('dinner') },
    workout: d.workout ? `${d.workout.kind}, ${d.workout.minutes} min at ${clockOf(d.workout.at)}` : null,
    steps: d.steps ?? null,
    screen: d.screen
      ? {
          laptop_work_min: d.screen.filter((s) => s.device === 'laptop' && s.category === 'work').reduce((s, x) => s + x.minutes, 0),
          after_22_min: lateScreen(d),
          after_22_by_category: Object.fromEntries(d.screen.filter((s) => s.lateMinutes > 0).map((s) => [`${s.device}_${s.category}`, s.lateMinutes])),
        }
      : null,
    tasks: { planned: tasks.length, done: tasks.filter((t) => t.doneAt).length, moved_away: ds.tasks.filter((t) => t.firstDate === d.date && t.date !== d.date).length },
    evening_routine: ev ? { minutes: minutesFrom(d.date, ev.to) - minutesFrom(d.date, ev.from), done: ev.done } : null,
    notes: d.notes.length,
  }
}

function taskView(t: Task, today: LogicalDate) {
  const status = t.doneAt ? 'done' : t.droppedAt ? 'let go' : t.someday ? 'someday' : !t.date ? 'inbox' : t.date < today ? 'not done, day passed' : 'planned'
  return {
    id: t.id,
    title: t.title,
    sphere: t.sphere,
    size: t.size,
    date: t.date ?? null,
    ...(t.time ? { time: t.time } : {}),
    ...(t.deadline ? { deadline: t.deadline } : {}),
    ...(t.moves ? { moved_times: t.moves } : {}),
    ...(t.repeatEvery ? { repeats_every_days: t.repeatEvery } : {}),
    status,
  }
}

const getDays: Tool<ReadCtx, { from: string; to: string }> = {
  name: 'get_days',
  description: `Overview of each day in a range (at most ${MAX_RANGE} days): sleep (the night that ended that morning), average energy (0…1) and mood (−1…1), tension, meal times, workout, steps, screen time (laptop work and minutes after 22:00 by category), tasks planned/done/moved away, evening routine. Days without any record are listed in "missing".`,
  parameters: { type: 'object', properties: { from: date('First day, YYYY-MM-DD'), to: date('Last day, YYYY-MM-DD') }, required: ['from', 'to'], additionalProperties: false },
  permission: 'read',
  check: rangeCheck(MAX_RANGE),
  run: ({ from, to }, { dataset }) => {
    const { days, missing } = daysIn(dataset, from, to)
    return { days: days.map((d) => daySummary(dataset, d)), missing }
  },
}

const getSleep: Tool<ReadCtx, { from: string; to: string }> = {
  name: 'get_sleep',
  description: `Sleep detail for a range of nights (at most ${MAX_RANGE}). A night is named by the date of the MORNING it ends in, so "last night" is today's date. Times: went to bed, fell asleep, woke up, got up; hours asleep; how it felt (rested and quality, −1…1) when rated.`,
  parameters: { type: 'object', properties: { from: date('First morning, YYYY-MM-DD'), to: date('Last morning, YYYY-MM-DD') }, required: ['from', 'to'], additionalProperties: false },
  permission: 'read',
  check: rangeCheck(MAX_RANGE),
  run: ({ from, to }, { dataset }) => {
    const { days, missing } = daysIn(dataset, from, to)
    return {
      nights: days
        .filter((d) => d.sleep)
        .map((d) => ({
          morning: d.date,
          weekday: weekday(d.date),
          bed: clockOf(d.sleep!.bed),
          asleep: clockOf(d.sleep!.asleep),
          woke: clockOf(d.sleep!.wake),
          got_up: clockOf(d.sleep!.rise),
          hours: r1(sleepHours(d)),
          minutes_to_fall_asleep: minutesFrom(d.date, d.sleep!.asleep) - minutesFrom(d.date, d.sleep!.bed),
          felt: d.sleep!.feel ?? null,
        })),
      missing,
    }
  },
}

const getPlan: Tool<ReadCtx, { from: string; to: string; include_inbox?: boolean }> = {
  name: 'get_plan',
  description:
    'Tasks planned for days in a range (at most 14 days), past or future, with size (small / normal / big), optional fixed time and deadline, how many times each was moved, and status. With include_inbox, also tasks without a day (inbox) and "someday" tasks.',
  parameters: {
    type: 'object',
    properties: { from: date('First day, YYYY-MM-DD'), to: date('Last day, YYYY-MM-DD'), include_inbox: { type: 'boolean', description: 'Also return undated tasks' } },
    required: ['from', 'to'],
    additionalProperties: false,
  },
  permission: 'read',
  check: rangeCheck(14),
  run: ({ from, to, include_inbox }, { dataset }) => {
    const byDay: Record<string, unknown[]> = {}
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const tasks = tasksOf(dataset, d)
      byDay[d] = tasks.map((t) => taskView(t, dataset.today))
    }
    const undated = dataset.tasks.filter((t) => !t.date && !t.doneAt && !t.droppedAt)
    return {
      days: Object.entries(byDay).map(([day, tasks]) => ({
        date: day,
        weekday: weekday(day),
        tasks,
        load_points: dataset.tasks.filter((t) => t.date === day && !t.droppedAt).reduce((s, t) => s + POINTS[t.size], 0),
      })),
      ...(include_inbox
        ? { inbox: undated.filter((t) => !t.someday).map((t) => taskView(t, dataset.today)), someday: undated.filter((t) => t.someday).map((t) => taskView(t, dataset.today)) }
        : {}),
      note: 'load_points: small = 1, normal = 2, big = 4',
    }
  },
}

/** Metric → value of a day (minutes after the morning's midnight for clock times; may be negative) */
export const METRICS: Record<string, { unit: 'time' | 'hours' | 'level' | 'minutes' | 'count' | 'points'; of: (d: Day, ds: Dataset) => number | null }> = {
  asleep_time: { unit: 'time', of: (d) => (d.sleep ? minutesFrom(d.date, d.sleep.asleep) : null) },
  bed_time: { unit: 'time', of: (d) => (d.sleep ? minutesFrom(d.date, d.sleep.bed) : null) },
  wake_time: { unit: 'time', of: (d) => (d.sleep ? minutesFrom(d.date, d.sleep.wake) : null) },
  sleep_hours: { unit: 'hours', of: sleepHours },
  energy: { unit: 'level', of: (d) => mean(d.energy.map((e) => e.level)) },
  mood: { unit: 'level', of: (d) => mean(d.mood.map((m) => m.valence)) },
  dinner_time: { unit: 'time', of: (d) => d.meals.filter((m) => m.kind === 'dinner').map((m) => minutesFrom(d.date, m.at))[0] ?? null },
  screen_after_22_min: { unit: 'minutes', of: lateScreen },
  steps: { unit: 'count', of: (d) => d.steps ?? null },
  tasks_done_points: { unit: 'points', of: (d, ds) => (tasksOf(ds, d.date).length || d.date < ds.today ? tasksOf(ds, d.date).filter((t) => t.doneAt).reduce((s, t) => s + POINTS[t.size], 0) : null) },
}

function quantile(sorted: number[], q: number) {
  const i = (sorted.length - 1) * q
  const lo = Math.floor(i)
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo)
}

/** The person's own usual value of a metric over the last `days` days up to `until` */
export function baseline(ds: Dataset, metric: string, days: number, until = ds.today) {
  const m = METRICS[metric]
  const from = addDays(until, -(days - 1))
  const values = ds.days
    .filter((d) => d.date >= from && d.date <= until)
    .map((d) => m.of(d, ds))
    .filter((v): v is number => v !== null && Number.isFinite(v))
    .sort((a, b) => a - b)
  if (!values.length) return { metric, from, to: until, days_with_data: 0, of_days: days, median: null }
  const fmt = (v: number) => (m.unit === 'time' ? clock(v) : m.unit === 'hours' ? r1(v) : m.unit === 'level' ? r2(v) : Math.round(v))
  return {
    metric,
    from,
    to: until,
    median: fmt(quantile(values, 0.5)),
    usual_range: [fmt(quantile(values, 0.25)), fmt(quantile(values, 0.75))],
    days_with_data: values.length,
    of_days: days,
  }
}

const getBaseline: Tool<ReadCtx, { metric: string; days: number; until?: string }> = {
  name: 'get_baseline',
  description:
    "The person's own usual value of a metric: the median and the usual range (middle half) over the last N days, counted only over days that have this data. Compare with the person's own usual, never with general norms. Clock times are HH:MM.",
  parameters: {
    type: 'object',
    properties: {
      metric: { type: 'string', enum: Object.keys(METRICS), description: 'What to measure' },
      days: { type: 'integer', minimum: 7, maximum: 60, description: 'How many days back' },
      until: date('Last day of the window, YYYY-MM-DD (default: today)'),
    },
    required: ['metric', 'days'],
    additionalProperties: false,
  },
  permission: 'read',
  check: (a, { dataset }) => (a.until && a.until > dataset.today ? '"until" cannot be in the future' : null),
  run: ({ metric, days, until }, { dataset }) => baseline(dataset, metric, days, until),
}

export const READ_TOOLS = [getDays, getSleep, getPlan, getBaseline] as Tool<ReadCtx>[]
