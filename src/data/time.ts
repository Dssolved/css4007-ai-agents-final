// Dates and times of the day format. A logical day starts at 04:00: a night after midnight still
// belongs to the evening before. Moments are local date-times without a time zone
// ("2026-11-12T00:55"), so the data reads the same everywhere.

/** YYYY-MM-DD, the logical day */
export type LogicalDate = string
/** YYYY-MM-DDTHH:MM, local time */
export type LocalTime = string

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
export const DAY_START_HOUR = 4

const pad = (n: number) => String(n).padStart(2, '0')
const toUtc = (date: LogicalDate) => {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
const fromUtc = (ms: number) => {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function isValidDate(date: string): boolean {
  return DATE_RE.test(date) && fromUtc(toUtc(date)) === date
}

export function addDays(date: LogicalDate, n: number): LogicalDate {
  return fromUtc(toUtc(date) + n * 86_400_000)
}

/** Whole days from `a` to `b` (b − a) */
export function daysBetween(a: LogicalDate, b: LogicalDate): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000)
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
export function weekday(date: LogicalDate): (typeof WEEKDAYS)[number] {
  return WEEKDAYS[new Date(toUtc(date)).getUTCDay()]
}
export const isWeekend = (date: LogicalDate) => ['Saturday', 'Sunday'].includes(weekday(date))

/** Moment `minutes` after midnight at the start of calendar day `date` (may run past 24:00) */
export function at(date: LogicalDate, minutes: number): LocalTime {
  const m = Math.round(minutes)
  const day = addDays(date, Math.floor(m / 1440))
  const rest = ((m % 1440) + 1440) % 1440
  return `${day}T${pad(Math.floor(rest / 60))}:${pad(rest % 60)}`
}

/** Minutes of a moment after midnight at the start of `date` (negative or > 1440 across days) */
export function minutesFrom(date: LogicalDate, time: LocalTime): number {
  const [d, hm] = time.split('T')
  const [h, m] = hm.split(':').map(Number)
  return daysBetween(date, d) * 1440 + h * 60 + m
}

/** "HH:MM" of a minute count, wrapped to the clock */
export function clock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

export const clockOf = (time: LocalTime) => time.slice(11)
