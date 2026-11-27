// Reading a dataset file and checking it against the day format. A broken file must fail loudly
// here, not as a confusing tool result in the middle of an agent run.
import fs from 'node:fs'
import { isValidDate, TIME_RE } from './time.ts'
import type { Dataset } from './types.ts'

export class DatasetError extends Error {
  override name = 'DatasetError'
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const SIZES = ['small', 'normal', 'big']
const MEALS = ['breakfast', 'lunch', 'dinner', 'snack']

/** Returns a list of problems; empty means the dataset is valid */
export function validateDataset(raw: unknown): string[] {
  const errors: string[] = []
  const err = (path: string, what: string) => errors.push(`${path}: ${what}`)
  const time = (path: string, v: unknown) => {
    if (typeof v !== 'string' || !TIME_RE.test(v) || !isValidDate(v.slice(0, 10))) err(path, 'expected YYYY-MM-DDTHH:MM')
  }
  const range = (path: string, v: unknown, lo: number, hi: number) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) err(path, `expected a number in ${lo}…${hi}`)
  }

  if (!isObj(raw)) return ['dataset: expected an object']
  if (raw.version !== 1) err('version', 'expected 1')
  if (typeof raw.today !== 'string' || !isValidDate(raw.today)) err('today', 'expected YYYY-MM-DD')
  if (!isObj(raw.profile) || typeof raw.profile.name !== 'string') err('profile', 'expected an object with a name')
  else if (!Array.isArray(raw.profile.rules)) err('profile.rules', 'expected a list')
  else
    raw.profile.rules.forEach((r: unknown, i: number) => {
      if (!isObj(r) || typeof r.text !== 'string') err(`profile.rules[${i}]`, 'expected { text, form? }')
      else if (r.form !== undefined && (!isObj(r.form) || typeof r.form.kind !== 'string')) err(`profile.rules[${i}].form`, 'expected an object with a kind')
    })
  if (!Array.isArray(raw.days)) err('days', 'expected a list')
  if (!Array.isArray(raw.tasks)) err('tasks', 'expected a list')
  if (errors.length) return errors

  let prevDate = ''
  ;(raw.days as unknown[]).forEach((d, i) => {
    const p = `days[${i}]`
    if (!isObj(d)) return err(p, 'expected an object')
    if (typeof d.date !== 'string' || !isValidDate(d.date)) return err(`${p}.date`, 'expected YYYY-MM-DD')
    if (d.date <= prevDate) err(`${p}.date`, 'days must be in increasing order, one record per day')
    prevDate = d.date
    if (d.sleep !== undefined) {
      if (!isObj(d.sleep)) err(`${p}.sleep`, 'expected an object')
      else {
        for (const k of ['bed', 'asleep', 'wake', 'rise']) time(`${p}.sleep.${k}`, d.sleep[k])
        const s = d.sleep as Record<string, string>
        if (!(s.bed <= s.asleep && s.asleep < s.wake && s.wake <= s.rise)) err(`${p}.sleep`, 'expected bed ≤ asleep < wake ≤ rise')
      }
    }
    for (const k of ['mood', 'energy', 'meals', 'notes']) if (!Array.isArray(d[k])) err(`${p}.${k}`, 'expected a list')
    ;((d.energy as unknown[]) ?? []).forEach((e, j) => isObj(e) && (time(`${p}.energy[${j}].at`, e.at), range(`${p}.energy[${j}].level`, e.level, 0, 1)))
    ;((d.mood as unknown[]) ?? []).forEach((m, j) => isObj(m) && (time(`${p}.mood[${j}].at`, m.at), range(`${p}.mood[${j}].valence`, m.valence, -1, 1)))
    ;((d.meals as unknown[]) ?? []).forEach((m, j) => {
      if (!isObj(m) || !MEALS.includes(m.kind as string)) err(`${p}.meals[${j}]`, `kind must be one of ${MEALS.join(', ')}`)
      else time(`${p}.meals[${j}].at`, m.at)
    })
    ;((d.notes as unknown[]) ?? []).forEach((n, j) => {
      if (!isObj(n) || typeof n.text !== 'string') err(`${p}.notes[${j}]`, 'expected { at, text }')
    })
  })

  const ids = new Set<string>()
  ;(raw.tasks as unknown[]).forEach((t, i) => {
    const p = `tasks[${i}]`
    if (!isObj(t)) return err(p, 'expected an object')
    if (typeof t.id !== 'string' || !t.id) err(`${p}.id`, 'expected a non-empty string')
    else if (ids.has(t.id)) err(`${p}.id`, `duplicate id ${t.id}`)
    else ids.add(t.id)
    if (typeof t.title !== 'string' || !t.title.trim()) err(`${p}.title`, 'expected text')
    if (!SIZES.includes(t.size as string)) err(`${p}.size`, `must be one of ${SIZES.join(', ')}`)
    for (const k of ['date', 'deadline', 'firstDate']) if (t[k] !== undefined && (typeof t[k] !== 'string' || !isValidDate(t[k] as string))) err(`${p}.${k}`, 'expected YYYY-MM-DD')
    if (t.time !== undefined && (typeof t.time !== 'string' || !/^\d{2}:\d{2}$/.test(t.time))) err(`${p}.time`, 'expected HH:MM')
    if (!Number.isInteger(t.moves) || (t.moves as number) < 0) err(`${p}.moves`, 'expected a whole number ≥ 0')
  })
  return errors
}

export function loadDataset(path: string): Dataset {
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(path, 'utf8'))
  } catch (e) {
    throw new DatasetError(`Cannot read ${path}: ${(e as Error).message}`)
  }
  const errors = validateDataset(raw)
  if (errors.length) throw new DatasetError(`${path} is not a valid dataset:\n- ${errors.slice(0, 10).join('\n- ')}`)
  return raw as Dataset
}
