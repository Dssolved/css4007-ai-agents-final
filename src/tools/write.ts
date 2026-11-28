// Write tools. They never decide on their own whether a change happens: each builds a Change,
// the code picks its tier (agent/autonomy.ts), and the change is either applied with undo or put
// on the person's checklist. The model learns which one happened from the result and is told not
// to ask the person again item by item — the checklist does that once.
//
// Deliberately missing (tier "never"): delete a task, let it go, mark it done, edit past days.
import { addDays, type LogicalDate } from '../data/time.ts'
import type { TaskSize } from '../data/types.ts'
import { commit, describe, preview, propose, type Change, type Session } from '../agent/journal.ts'
import { tierOf } from '../agent/autonomy.ts'
import { checkPlan } from '../agent/check.ts'
import type { Tool } from './registry.ts'

export interface WriteCtx {
  session: Session
}

const date = (description: string) => ({ type: 'string' as const, format: 'date' as const, description })
const HHMM = '^([01]\\d|2[0-3]):[0-5]\\d$'
const notPast = (d: LogicalDate | undefined, today: LogicalDate, what: string) => (d && d < today ? `"${what}" is in the past; past days are not changed` : null)

/**
 * Check the plan as it would be, then decide the tier and act; this is what the model gets back.
 * A hard finding rejects the change before anyone sees it; soft ones travel with the result.
 */
function act(s: Session, change: Change) {
  const { dataset, touched, added } = preview(s, change)
  const { hard, soft } = checkPlan(dataset, s.plan, touched, added)
  const summary = describe(s.dataset, change)
  if (hard.length)
    return {
      status: 'rejected',
      summary,
      broken: hard.map((f) => `${f.rule}: ${f.message}`),
      note: 'Nothing was changed. Make a different proposal that keeps these rules — do not offer this one to the person.',
    }
  const warnings = soft.length ? { warnings: soft.map((f) => `${f.rule}: ${f.message}`) } : {}
  const tier = tierOf(s, change)
  if (tier.tier === 'auto' && !soft.length) {
    const e = commit(s, change, 'auto')
    return { status: 'done', summary: e.summary, journal_id: e.id, note: 'Done by you within your allowed limits; the person can undo it. Tell them in one line.' }
  }
  const reasons = tier.tier === 'ask' ? tier.reasons : []
  const p = propose(s, change, [...reasons, ...soft.map((f) => f.rule)])
  return {
    status: 'waiting_for_confirmation',
    summary: p.summary,
    proposal_id: p.id,
    why: p.reasons,
    ...warnings,
    note: `Not applied yet. The person will see all pending changes once as a checklist — do not ask about each one.${soft.length ? ' Mention the warnings honestly.' : ''}`,
  }
}

const addTask: Tool<WriteCtx, { title: string; sphere: string; size: TaskSize; date?: string; time?: string; deadline?: string }> = {
  name: 'add_task',
  description:
    'Propose a new task. Without "date" it goes to the inbox. "time" only for things fixed in time (appointments), and needs a date. New tasks always wait for the person\'s confirmation.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', maxLength: 120, description: 'Short title in the person’s words' },
      sphere: { type: 'string', maxLength: 30, description: 'Area of life: work, study, home, health, people, admin…' },
      size: { type: 'string', enum: ['small', 'normal', 'big'], description: 'small ≈ under 30 min, big ≈ half a day' },
      date: date('Planned day, YYYY-MM-DD (optional)'),
      time: { type: 'string', pattern: HHMM, description: 'Fixed time HH:MM (optional, needs date)' },
      deadline: date('Must be done by, YYYY-MM-DD (optional)'),
    },
    required: ['title', 'sphere', 'size'],
    additionalProperties: false,
  },
  permission: 'write',
  check: (a, { session }) => {
    const today = session.dataset.today
    if (a.time && !a.date) return '"time" needs a "date"'
    if (a.date && a.deadline && a.date > a.deadline) return '"date" is after "deadline"'
    return notPast(a.date, today, 'date') ?? notPast(a.deadline, today, 'deadline')
  },
  run: (a, { session: s }) =>
    act(s, {
      kind: 'add_task',
      task: {
        id: `new-${s.nextId}`,
        title: a.title,
        sphere: a.sphere,
        size: a.size,
        ...(a.date ? { date: a.date } : {}),
        ...(a.time ? { time: a.time } : {}),
        ...(a.deadline ? { deadline: a.deadline } : {}),
        createdAt: `${s.dataset.today}T12:00`,
        moves: 0,
      },
    }),
}

const moveTask: Tool<WriteCtx, { task_id: string; to_date: string }> = {
  name: 'move_task',
  description:
    'Move an open task to another day (today or later). Small moves of small tasks may be applied at once with undo; anything bigger waits for the person. Use task ids from get_plan.',
  parameters: {
    type: 'object',
    properties: { task_id: { type: 'string', maxLength: 40, description: 'Task id from get_plan' }, to_date: date('New day, YYYY-MM-DD') },
    required: ['task_id', 'to_date'],
    additionalProperties: false,
  },
  permission: 'write',
  check: (a, { session }) => {
    const ds = session.dataset
    const t = ds.tasks.find((x) => x.id === a.task_id)
    if (!t) return `there is no task "${a.task_id}"`
    if (t.doneAt || t.droppedAt) return `"${t.title}" is already closed`
    if (t.date === a.to_date) return `"${t.title}" is already on ${a.to_date}`
    if (a.to_date > addDays(ds.today, 60)) return '"to_date" may be at most 60 days ahead'
    return notPast(a.to_date, ds.today, 'to_date')
  },
  run: (a, { session: s }) => act(s, { kind: 'move_task', taskId: a.task_id, to: a.to_date }),
}

const scheduleReminder: Tool<WriteCtx, { text: string; date: string; time: string; task_id?: string }> = {
  name: 'schedule_reminder',
  description: 'Propose a reminder at a day and time, optionally about a task. Reminders always wait for the person’s confirmation.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', maxLength: 140, description: 'What the reminder says' },
      date: date('Day, YYYY-MM-DD'),
      time: { type: 'string', pattern: HHMM, description: 'Time HH:MM' },
      task_id: { type: 'string', maxLength: 40, description: 'Related task id (optional)' },
    },
    required: ['text', 'date', 'time'],
    additionalProperties: false,
  },
  permission: 'write',
  check: (a, { session }) => {
    const ds = session.dataset
    if (a.task_id && !ds.tasks.some((t) => t.id === a.task_id)) return `there is no task "${a.task_id}"`
    return notPast(a.date, ds.today, 'date')
  },
  run: (a, { session: s }) =>
    act(s, { kind: 'add_reminder', reminder: { id: `rem-${s.nextId}`, text: a.text, at: `${a.date}T${a.time}`, ...(a.task_id ? { taskId: a.task_id } : {}) } }),
}

export const WRITE_TOOLS = [addTask, moveTask, scheduleReminder] as Tool<WriteCtx>[]
