// Autonomy tiers, decided by code — the model never chooses its own tier:
//
//   auto  — the agent may do it alone; it is journaled and the person can undo it
//   ask   — goes to the person's checklist and waits for a tick
//   never — there is no tool for it at all: delete, let go, mark done, change past days
//
// Only one kind of change is ever "auto": moving a small task a little, to a day that can take it.
// Everything else asks. Each failed condition becomes a reason the person sees next to the item.
import { daysBetween, isWeekend } from '../data/time.ts'
import { dayLoad } from '../analytics/rhythm.ts'
import type { Change, Session } from './journal.ts'

export const AUTO_MOVE = {
  /** At most this many days ahead of today */
  maxDaysAhead: 7,
  /** Spheres that involve other people — always asked */
  peopleSpheres: ['people'],
} as const

export type Tier = { tier: 'auto' } | { tier: 'ask'; reasons: string[] }

export function tierOf(s: Session, c: Change): Tier {
  if (c.kind === 'add_task') return { tier: 'ask', reasons: ['new tasks are always yours to accept'] }
  if (c.kind === 'add_reminder') return { tier: 'ask', reasons: ['reminders are always yours to accept'] }

  const ds = s.dataset
  const t = ds.tasks.find((x) => x.id === c.taskId)!
  const reasons: string[] = []
  if (s.untrusted) reasons.push('notes were read in this conversation, so nothing changes without you')
  if (t.size !== 'small') reasons.push(`not a small task (${t.size})`)
  if (!t.date) reasons.push('it has no day yet — planning it is your call')
  if (daysBetween(ds.today, c.to) > AUTO_MOVE.maxDaysAhead) reasons.push(`more than ${AUTO_MOVE.maxDaysAhead} days ahead`)
  if (isWeekend(c.to)) reasons.push('onto a weekend')
  if (t.deadline && c.to > t.deadline) reasons.push(`after its deadline ${t.deadline}`)
  if (t.time) reasons.push(`it has a fixed time (${t.time})`)
  if ((AUTO_MOVE.peopleSpheres as readonly string[]).includes(t.sphere)) reasons.push('it involves other people')
  if (dayLoad({ ...ds, tasks: [...ds.tasks, { ...t, date: c.to }].filter((x) => x !== t) }, c.to, s.capacity).load === 'heavy') reasons.push(`${c.to} would be heavy`)
  return reasons.length ? { tier: 'ask', reasons } : { tier: 'auto' }
}
