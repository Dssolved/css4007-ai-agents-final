// The rhythm portrait: a compact picture of the person computed by code, not by the model —
// usual times, when energy peaks and dips, what a normal day holds, how the last week differs
// from the usual, how loaded the next week is, and whether the base habits are slipping.
// The model gets this instead of re-reading weeks of raw records: cheaper and the arithmetic is right.
import { addDays, clock, clockOf, minutesFrom, weekday, isWeekend, type LogicalDate } from '../data/time.ts'
import type { Dataset, Day } from '../data/types.ts'

const POINTS = { small: 1, normal: 2, big: 4 } as const
const median = (xs: number[]) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!s.length) return null
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10)
const r2 = (x: number | null) => (x === null ? null : Math.round(x * 100) / 100)
const t = (x: number | null) => (x === null ? null : clock(x))

function window(ds: Dataset, from: LogicalDate, to: LogicalDate) {
  return ds.days.filter((d) => d.date >= from && d.date <= to)
}
const sleepHours = (d: Day) => (d.sleep ? (minutesFrom(d.date, d.sleep.wake) - minutesFrom(d.date, d.sleep.asleep)) / 60 : NaN)
const asleep = (d: Day) => (d.sleep ? minutesFrom(d.date, d.sleep.asleep) : NaN)
const dayEnergy = (d: Day) => (d.energy.length ? d.energy.reduce((s, e) => s + e.level, 0) / d.energy.length : NaN)
const late = (d: Day) => (d.screen ? d.screen.reduce((s, x) => s + x.lateMinutes, 0) : NaN)
const mealAt = (d: Day, kind: string) => {
  const m = d.meals.find((x) => x.kind === kind)
  return m ? minutesFrom(d.date, m.at) : NaN
}

/** Medians of the main signals over a set of days */
function signals(days: Day[]) {
  return {
    sleep_hours: r1(median(days.map(sleepHours))),
    asleep: t(median(days.map(asleep))),
    energy: r2(median(days.map(dayEnergy))),
    steps: median(days.map((d) => d.steps ?? NaN)),
    screen_after_22_min: median(days.map(late)),
    dinner: t(median(days.map((d) => mealAt(d, 'dinner')))),
  }
}

export interface RhythmOptions {
  /** Last day of the recent window (default: today) */
  until?: LogicalDate
  /** "Lately": the last N days compared with the usual (default 14) */
  recentDays?: number
  /** Length of the "usual" window that ends right before the recent week */
  usualDays?: number
}

export function rhythm(ds: Dataset, { until = ds.today, recentDays = 14, usualDays = 28 }: RhythmOptions = {}) {
  const recentFrom = addDays(until, -(recentDays - 1))
  const usualTo = addDays(recentFrom, -1)
  const usualFrom = addDays(usualTo, -(usualDays - 1))
  const recent = window(ds, recentFrom, until)
  const usual = window(ds, usualFrom, usualTo)
  const workdays = usual.filter((d) => !isWeekend(d.date))

  // Usual clock times
  const times = {
    wake_workday: t(median(workdays.map((d) => (d.sleep ? minutesFrom(d.date, d.sleep.wake) : NaN)))),
    wake_weekend: t(median(usual.filter((d) => isWeekend(d.date)).map((d) => (d.sleep ? minutesFrom(d.date, d.sleep.wake) : NaN)))),
    asleep: t(median(usual.map(asleep))),
    breakfast: t(median(usual.map((d) => mealAt(d, 'breakfast')))),
    lunch: t(median(usual.map((d) => mealAt(d, 'lunch')))),
    dinner: t(median(usual.map((d) => mealAt(d, 'dinner')))),
    workout: t(median(usual.flatMap((d) => (d.workout ? [minutesFrom(d.date, d.workout.at)] : [])))),
  }

  // Energy through the day, in two-hour blocks
  const blocks = [8, 10, 12, 14, 16, 18, 20].map((h) => {
    const levels = usual.flatMap((d) => d.energy.filter((e) => Number(clockOf(e.at).slice(0, 2)) >= h && Number(clockOf(e.at).slice(0, 2)) < h + 2).map((e) => e.level))
    return { hours: `${String(h).padStart(2, '0')}–${h + 2}`, level: r2(median(levels)), samples: levels.length }
  })
  const rated = blocks.filter((b) => b.level !== null && b.samples >= 3)
  const peak = rated.reduce((a, b) => (b.level! > a.level! ? b : a), rated[0])
  const dip = rated.reduce((a, b) => (b.level! < a.level! ? b : a), rated[0])

  // What a normal day holds: done task points per day (workdays / weekends)
  const donePoints = (d: Day) => ds.tasks.filter((x) => x.date === d.date && x.doneAt).reduce((s, x) => s + POINTS[x.size], 0)
  const capacity = {
    workday_points: median(workdays.map(donePoints)),
    weekend_points: median(usual.filter((d) => isWeekend(d.date)).map(donePoints)),
    note: 'points of tasks actually done per day: small = 1, normal = 2, big = 4',
  }

  // Lately against the usual
  const now = signals(recent)
  const before = signals(usual)
  const usualHours = before.sleep_hours ?? 7.5
  const lastWeek = window(ds, addDays(until, -6), until)
  const sleepDebt = r1(lastWeek.reduce((s, d) => s + Math.max(0, usualHours - (Number.isFinite(sleepHours(d)) ? sleepHours(d) : usualHours)), 0))

  // Base habits: how often done recently vs usually
  const doneShare = (days: Day[], id: string) => {
    const withRoutine = days.filter((d) => d.routines.morning || d.routines.evening)
    if (!withRoutine.length) return null
    return r2(withRoutine.filter((d) => [...(d.routines.morning?.done ?? []), ...(d.routines.evening?.done ?? [])].includes(id)).length / withRoutine.length)
  }
  const base = ds.profile.base.map((b) => {
    const r = doneShare(recent, b.id)
    const u = doneShare(usual, b.id)
    return { id: b.id, title: b.title, recent_share: r, usual_share: u, slipping: r !== null && u !== null && u - r >= 0.25 }
  })

  // Where moved tasks were first planned
  const movedFrom: Record<string, number> = {}
  for (const x of ds.tasks) if (x.firstDate && x.firstDate >= usualFrom && x.firstDate <= until) movedFrom[weekday(x.firstDate)] = (movedFrom[weekday(x.firstDate)] ?? 0) + 1
  const mostMovedFrom = Object.entries(movedFrom).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  // The next seven days against what a normal day holds
  const next = Array.from({ length: 7 }, (_, i) => addDays(until, i + 1)).map((date) => {
    const tasks = ds.tasks.filter((x) => x.date === date && !x.doneAt && !x.droppedAt)
    const points = tasks.reduce((s, x) => s + POINTS[x.size], 0)
    const cap = (isWeekend(date) ? capacity.weekend_points : capacity.workday_points) ?? 4
    return {
      date,
      weekday: weekday(date),
      points,
      load: points > cap * 1.25 ? 'heavy' : points < cap * 0.5 ? 'light' : 'normal',
      big_tasks: tasks.filter((x) => x.size === 'big').map((x) => x.title),
      fixed: tasks.filter((x) => x.time).map((x) => `${x.time} ${x.title}`),
      deadlines: ds.tasks.filter((x) => x.deadline === date && !x.doneAt && !x.droppedAt).map((x) => x.title),
    }
  })
  const inbox = ds.tasks.filter((x) => !x.date && !x.someday && !x.doneAt && !x.droppedAt)

  return {
    windows: { recent: [recentFrom, until], usual: [usualFrom, usualTo], recent_days_with_data: recent.length, usual_days_with_data: usual.length },
    usual_times: times,
    energy_by_hours: blocks,
    energy_peak: peak?.hours ?? null,
    energy_dip: dip?.hours ?? null,
    capacity,
    lately: now,
    usual: before,
    sleep_debt_hours_last_7: sleepDebt,
    base_habits: base,
    moved_tasks_mostly_from: mostMovedFrom,
    next_week: next,
    inbox: { count: inbox.length, with_deadline: inbox.filter((x) => x.deadline).length, moved_3_plus: inbox.filter((x) => x.moves >= 3).map((x) => x.title) },
  }
}
