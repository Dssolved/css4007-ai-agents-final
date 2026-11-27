// Changes the agent can make to the plan, and the journal that undoes them. Every change is
// applied through `applyChange`, which returns its exact inverse; the journal keeps both. Undo is
// a command for the person (CLI / UI), never a tool for the model: the model cannot rewrite what
// it already did behind the person's back.
//
// A conversation is a `Session`: changes the code allowed the agent to make by itself are applied
// at once (with undo); everything else waits in `pending` until the person ticks a checklist.
import { clockOf, type LogicalDate } from '../data/time.ts'
import type { Dataset, Reminder, Task } from '../data/types.ts'
import { planContext, type PlanContext } from './check.ts'

export type Change =
  | { kind: 'add_task'; task: Task }
  | { kind: 'move_task'; taskId: string; to: LogicalDate }
  | { kind: 'add_reminder'; reminder: Reminder }

/** Inverse operations — produced only by `applyChange`, run only by `undo` */
type Inverse = { kind: 'remove_task'; taskId: string } | { kind: 'restore_task'; task: Task } | { kind: 'remove_reminder'; reminderId: string }

export interface Proposal {
  id: string
  change: Change
  summary: string
  /** Why the code would not let the agent do it alone */
  reasons: string[]
}

export interface JournalEntry {
  id: string
  change: Change
  inverse: Inverse
  summary: string
  /** auto — the agent did it alone (allowed by the code); confirmed — the person ticked it */
  how: 'auto' | 'confirmed'
  undone: boolean
}

export interface Session {
  dataset: Dataset
  /** What a normal day holds, usual meals, sleep — fixed at the start of the conversation */
  plan: PlanContext
  /** Untrusted text (notes) was read: from now on the agent changes nothing by itself */
  untrusted: boolean
  pending: Proposal[]
  journal: JournalEntry[]
  nextId: number
}

export function startSession(dataset: Dataset): Session {
  return { dataset, plan: planContext(dataset), untrusted: false, pending: [], journal: [], nextId: 1 }
}

/** After reading untrusted text the "by itself" tier is off until the conversation ends */
export const markUntrusted = (s: Session) => {
  s.untrusted = true
}

const newId = (s: Session, prefix: string) => `${prefix}${s.nextId++}`
const taskOf = (ds: Dataset, id: string) => ds.tasks.find((t) => t.id === id)

/** A short line for the person, e.g. «Move "Laundry": 2026-11-28 → 2026-11-29» */
export function describe(ds: Dataset, c: Change): string {
  switch (c.kind) {
    case 'add_task': {
      const t = c.task
      const when = t.date ? ` on ${t.date}${t.time ? ` at ${t.time}` : ''}` : ' to the inbox'
      return `Add "${t.title}" (${t.sphere}, ${t.size})${when}${t.deadline ? `, due ${t.deadline}` : ''}`
    }
    case 'move_task': {
      const t = taskOf(ds, c.taskId)
      return `Move "${t?.title ?? c.taskId}": ${t?.date ?? 'inbox'} → ${c.to}`
    }
    case 'add_reminder':
      return `Remind ${c.reminder.at.slice(0, 10)} at ${clockOf(c.reminder.at)}: "${c.reminder.text}"`
  }
}

/** Apply a change to the dataset; returns what undoes it. Throws if the change no longer fits */
function applyChange(ds: Dataset, c: Change): Inverse {
  switch (c.kind) {
    case 'add_task':
      if (taskOf(ds, c.task.id)) throw new Error(`task ${c.task.id} already exists`)
      ds.tasks.push({ ...c.task })
      return { kind: 'remove_task', taskId: c.task.id }
    case 'move_task': {
      const t = taskOf(ds, c.taskId)
      if (!t) throw new Error(`no task ${c.taskId}`)
      if (t.doneAt || t.droppedAt) throw new Error(`"${t.title}" is already closed`)
      const before = structuredClone(t)
      if (t.date && !t.firstDate) t.firstDate = t.date
      if (t.date) t.moves += 1
      t.date = c.to
      return { kind: 'restore_task', task: before }
    }
    case 'add_reminder':
      ds.reminders = [...(ds.reminders ?? []), { ...c.reminder }]
      return { kind: 'remove_reminder', reminderId: c.reminder.id }
  }
}

function applyInverse(ds: Dataset, inv: Inverse) {
  switch (inv.kind) {
    case 'remove_task':
      ds.tasks = ds.tasks.filter((t) => t.id !== inv.taskId)
      break
    case 'restore_task': {
      const i = ds.tasks.findIndex((t) => t.id === inv.task.id)
      if (i < 0) throw new Error(`no task ${inv.task.id}`)
      ds.tasks[i] = structuredClone(inv.task)
      break
    }
    case 'remove_reminder':
      ds.reminders = (ds.reminders ?? []).filter((r) => r.id !== inv.reminderId)
      break
  }
}

const touches = (c: Change) => (c.kind === 'add_task' ? c.task.id : c.kind === 'move_task' ? c.taskId : c.reminder.id)

/**
 * The plan as it would be with everything pending plus `change`, on a copy — what the plan check
 * looks at. `touched`: tasks the agent changed in this conversation (applied, waiting, this one)
 */
export function preview(s: Session, change: Change): { dataset: Dataset; touched: Set<string> } {
  const copy = structuredClone(s.dataset)
  for (const p of s.pending)
    try {
      applyChange(copy, p.change)
    } catch {
      // a pending item that no longer fits is skipped at confirmation too
    }
  applyChange(copy, change)
  const touched = new Set([...s.journal.filter((e) => !e.undone).map((e) => e.change), ...s.pending.map((p) => p.change), change].map(touches))
  return { dataset: copy, touched }
}

/** Apply now and write to the journal */
export function commit(s: Session, change: Change, how: JournalEntry['how']): JournalEntry {
  const summary = describe(s.dataset, change)
  const inverse = applyChange(s.dataset, change)
  const entry: JournalEntry = { id: newId(s, 'j'), change, inverse, summary, how, undone: false }
  s.journal.push(entry)
  return entry
}

/** Keep for the person's checklist */
export function propose(s: Session, change: Change, reasons: string[]): Proposal {
  const p: Proposal = { id: newId(s, 'p'), change, summary: describe(s.dataset, change), reasons }
  s.pending.push(p)
  return p
}

/** The checklist the person sees: everything ticked by default, untick what you don't want */
export function checklist(s: Session): string {
  if (!s.pending.length) return 'Nothing waits for your OK.'
  return [
    `${s.pending.length} change(s) wait for your OK — untick what you don't want:`,
    ...s.pending.map((p) => `[x] ${p.id}  ${p.summary}  — ${p.reasons.join('; ')}`),
  ].join('\n')
}

/**
 * The person's answer to the checklist: the ticked proposals are applied, the rest are dropped.
 * A proposal that no longer fits (the task was closed meanwhile) is skipped and reported.
 */
export function confirm(s: Session, ticked: string[]) {
  const applied: JournalEntry[] = []
  const skipped: { id: string; summary: string; why: string }[] = []
  for (const p of s.pending) {
    if (!ticked.includes(p.id)) continue
    try {
      applied.push(commit(s, p.change, 'confirmed'))
    } catch (e) {
      skipped.push({ id: p.id, summary: p.summary, why: (e as Error).message })
    }
  }
  const dropped = s.pending.filter((p) => !ticked.includes(p.id)).map((p) => p.id)
  s.pending = []
  return { applied, skipped, dropped }
}

/**
 * Undo a journal entry (the person's command). Refused while a later, still active entry touches
 * the same task: undoing out of order would silently erase that later change.
 */
export function undo(s: Session, entryId: string): { ok: true; summary: string } | { ok: false; error: string } {
  const i = s.journal.findIndex((e) => e.id === entryId)
  if (i < 0) return { ok: false, error: `no journal entry ${entryId}` }
  const e = s.journal[i]
  if (e.undone) return { ok: false, error: `${entryId} is already undone` }
  const later = s.journal.slice(i + 1).find((x) => !x.undone && touches(x.change) === touches(e.change))
  if (later) return { ok: false, error: `undo ${later.id} first: it changed the same thing later` }
  applyInverse(s.dataset, e.inverse)
  e.undone = true
  return { ok: true, summary: `Undone: ${e.summary}` }
}

/** Undo the last active entry */
export function undoLast(s: Session) {
  const last = [...s.journal].reverse().find((e) => !e.undone)
  return last ? undo(s, last.id) : ({ ok: false, error: 'nothing to undo' } as const)
}
