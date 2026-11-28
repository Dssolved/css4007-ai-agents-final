// Plan check by code, before anything is shown to the person. It looks only at tasks the agent
// touched in this conversation (moved, added — applied or waiting): the person's own plan may
// break their rules on purpose, and that is not the agent's business to flag here.
//
//   hard — the proposal is rejected and the model must make another one: past a deadline, two
//          timed tasks overlapping, a timed task over a usual meal, a rule with a form broken
//   soft — accepted, but the model is warned and should say it: a day over capacity, a big task
//          right after a short night, a late evening while short on sleep
import { clock, isWeekend, minutesFrom, weekday, addDays, type LogicalDate } from '../data/time.ts'
import type { Dataset, RuleForm, Task } from '../data/types.ts'
import { dayLoad, rhythm, type Capacity } from '../analytics/rhythm.ts'

/** Assumed length of a timed task by size, minutes */
export const DURATION = { small: 30, normal: 60, big: 120 } as const
/** A meal "takes" from 15 min before its usual time to 45 min after */
const MEAL_BEFORE = 15
const MEAL_AFTER = 45
/** Last night this much shorter than usual — "a short night" */
const SHORT_NIGHT_H = 1
/** Sleep debt over the last seven nights from which a late evening is warned about */
const DEBT_H = 3
const LATE_EVENING = 20 * 60

export interface PlanContext {
  capacity: Capacity
  /** Usual meal times, minutes after midnight */
  meals: { kind: string; at: number }[]
  usualSleepHours: number | null
  lastNightHours: number | null
  sleepDebtHours: number | null
}

const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

export function planContext(ds: Dataset): PlanContext {
  const r = rhythm(ds)
  const meals = (['lunch', 'dinner'] as const).flatMap((k) => (r.usual_times[k] ? [{ kind: k, at: mins(r.usual_times[k]!) }] : []))
  const night = ds.days.find((d) => d.date === ds.today)?.sleep
  return {
    capacity: r.capacity,
    meals,
    usualSleepHours: r.usual.sleep_hours,
    lastNightHours: night ? (minutesFrom(ds.today, night.wake) - minutesFrom(ds.today, night.asleep)) / 60 : null,
    sleepDebtHours: r.sleep_debt_hours_last_7,
  }
}

export interface Finding {
  /** The rule's text, or a short name of a built-in check */
  rule: string
  message: string
  taskIds: string[]
}

export interface CheckResult {
  hard: Finding[]
  soft: Finding[]
}

const open = (t: Task) => !t.doneAt && !t.droppedAt
const span = (t: Task) => (t.time ? [mins(t.time), mins(t.time) + DURATION[t.size]] : null)
const has = (t: Task, words: string[]) => words.some((w) => new RegExp(`\\b${w}`, 'i').test(t.title))

function brokenForm(form: RuleForm, tasks: Task[], day: LogicalDate): { message: string; ids: string[] } | null {
  switch (form.kind) {
    case 'max_per_day': {
      const n = tasks.filter((t) => t.size === form.size)
      return n.length > form.max ? { message: `${day} would have ${n.length} ${form.size} tasks: ${n.map((t) => `"${t.title}"`).join(', ')}`, ids: n.map((t) => t.id) } : null
    }
    case 'sphere_not_on_weekend': {
      const n = isWeekend(day) ? tasks.filter((t) => t.sphere === form.sphere) : []
      return n.length ? { message: `${n.map((t) => `"${t.title}"`).join(', ')} on ${weekday(day)} ${day}`, ids: n.map((t) => t.id) } : null
    }
    case 'free_after': {
      if (form.weekdays && !form.weekdays.includes(weekday(day))) return null
      const n = tasks.filter((t) => span(t) && span(t)![1] > mins(form.time))
      return n.length ? { message: `${n.map((t) => `"${t.title}" at ${t.time}`).join(', ')} runs past ${form.time} on ${weekday(day)} ${day}`, ids: n.map((t) => t.id) } : null
    }
    case 'not_before': {
      const n = tasks.filter((t) => span(t) && has(t, form.titleHas) && span(t)![0] < mins(form.time))
      return n.length ? { message: `${n.map((t) => `"${t.title}" at ${t.time}`).join(', ')} is before ${form.time}`, ids: n.map((t) => t.id) } : null
    }
    case 'only_between': {
      const n = tasks.filter((t) => span(t) && has(t, form.titleHas) && (span(t)![0] < mins(form.from) || span(t)![1] > mins(form.to)))
      return n.length ? { message: `${n.map((t) => `"${t.title}" at ${t.time}`).join(', ')} is outside ${form.from}–${form.to}`, ids: n.map((t) => t.id) } : null
    }
  }
}

/** Check the plan as it would be; only findings that involve a touched task are reported */
/** Words of a title that carry meaning (3+ letters, lower case) */
const words = (title: string) => new Set(title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3))
/** Most of the shorter title's words are in the other one */
export function sameThing(a: string, b: string) {
  const [x, y] = [words(a), words(b)]
  const [small, big] = x.size <= y.size ? [x, y] : [y, x]
  if (!small.size) return false
  return [...small].filter((w) => big.has(w)).length / small.size >= 0.75
}

/**
 * Check the plan as it would be; only findings that involve a touched task are reported.
 * `added`: tasks the agent created in this conversation (checked against copies of existing ones)
 */
export function checkPlan(ds: Dataset, pc: PlanContext, touched: Set<string>, added: Set<string> = new Set()): CheckResult {
  const hard: Finding[] = []
  const soft: Finding[] = []
  const mine = ds.tasks.filter((t) => touched.has(t.id) && open(t))
  const add = (to: Finding[], rule: string, message: string, ids: string[]) => {
    if (ids.some((id) => touched.has(id))) to.push({ rule, message, taskIds: ids })
  }

  // A new task that is an existing open one under another wording: plan that one instead.
  // Repeating tasks are left out — another session of a habit is not a copy
  for (const t of mine.filter((x) => added.has(x.id))) {
    const twin = ds.tasks.find((o) => o.id !== t.id && !added.has(o.id) && open(o) && !o.repeatEvery && sameThing(o.title, t.title))
    if (twin) add(hard, 'duplicate', `"${t.title}" looks like the existing task "${twin.title}" (id ${twin.id}, ${twin.date ?? 'inbox'}) — plan that one with move_task instead of adding a copy`, [t.id])
  }

  for (const t of mine) if (t.date && t.deadline && t.date > t.deadline) add(hard, 'deadline', `"${t.title}" on ${t.date} is after its deadline ${t.deadline}`, [t.id])

  const days = [...new Set(mine.flatMap((t) => (t.date ? [t.date] : [])))].sort()
  for (const day of days) {
    const tasks = ds.tasks.filter((t) => t.date === day && open(t))
    const timed = tasks.filter((t) => t.time).sort((a, b) => mins(a.time!) - mins(b.time!))

    for (let i = 0; i < timed.length; i++)
      for (let j = i + 1; j < timed.length; j++)
        if (span(timed[j])![0] < span(timed[i])![1])
          add(hard, 'overlap', `"${timed[i].title}" at ${timed[i].time} and "${timed[j].title}" at ${timed[j].time} overlap on ${day}`, [timed[i].id, timed[j].id])

    for (const t of timed) {
      const [a, b] = span(t)!
      for (const m of pc.meals)
        if (a < m.at + MEAL_AFTER && b > m.at - MEAL_BEFORE) add(hard, 'meal time', `"${t.title}" at ${t.time} takes the usual ${m.kind} time (~${clock(m.at)}) on ${day}`, [t.id])
    }

    for (const r of ds.profile.rules) {
      if (!r.form) continue
      const broken = brokenForm(r.form, tasks, day)
      if (broken) add(hard, r.text, broken.message, broken.ids)
    }

    // A task without a time that may only happen in a window ("gym 18–20") on a day where
    // another rule closes that window ("nothing after 18:00 on Tuesdays") cannot fit at all
    for (const r of ds.profile.rules) {
      if (r.form?.kind !== 'only_between') continue
      const { titleHas, from, to } = r.form
      const closer = ds.profile.rules.find((c) => c.form?.kind === 'free_after' && (!c.form.weekdays || c.form.weekdays.includes(weekday(day))) && mins(c.form.time) <= mins(from))
      if (!closer) continue
      const n = tasks.filter((t) => !t.time && has(t, titleHas))
      if (n.length) add(hard, r.text, `${n.map((t) => `"${t.title}"`).join(', ')} can only be ${from}–${to}, and on ${weekday(day)} ${day} "${closer.text}" closes that window`, n.map((t) => t.id))
    }

    const load = dayLoad(ds, day, pc.capacity)
    if (load.load === 'heavy') add(soft, 'overload', `${day} holds ${load.points} points, a normal ${isWeekend(day) ? 'weekend day' : 'workday'} ~${load.cap}`, tasks.filter((t) => touched.has(t.id)).map((t) => t.id))

    const shortNight = pc.lastNightHours !== null && pc.usualSleepHours !== null && pc.lastNightHours <= pc.usualSleepHours - SHORT_NIGHT_H
    if (shortNight && day <= addDays(ds.today, 1))
      for (const t of tasks.filter((x) => x.size === 'big'))
        add(soft, 'after a short night', `"${t.title}" is big, and last night was ${pc.lastNightHours!.toFixed(1)} h against the usual ${pc.usualSleepHours} h`, [t.id])

    if (pc.sleepDebtHours !== null && pc.sleepDebtHours >= DEBT_H)
      for (const t of timed.filter((x) => span(x)![1] > LATE_EVENING))
        add(soft, 'late while short on sleep', `"${t.title}" at ${t.time} keeps the evening busy, with ${pc.sleepDebtHours} h of sleep debt this week`, [t.id])
  }
  return { hard, soft }
}
