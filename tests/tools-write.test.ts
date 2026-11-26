import test from 'node:test'
import assert from 'node:assert/strict'
import { generate } from '../src/data/generate.ts'
import { callTool, toolMessage, type ToolOutcome } from '../src/tools/registry.ts'
import { WRITE_TOOLS, type WriteCtx } from '../src/tools/write.ts'
import { checklist, confirm, markUntrusted, startSession, undo, undoLast } from '../src/agent/journal.ts'

// Mira's "today" is Sunday 2026-11-22. Laundry (t213, small, Saturday 28th, no time) is the one
// task a small move of which the code may allow without asking.
const fresh = (): WriteCtx => ({ session: startSession(generate().dataset) })
const call = (ctx: WriteCtx, name: string, args: unknown) => callTool(WRITE_TOOLS, { id: 'c', name, arguments: args }, ctx)
const result = (o: ToolOutcome) => {
  assert.ok(o.ok, !o.ok ? o.error : '')
  return o.result as { status: string; journal_id?: string; proposal_id?: string; why?: string[] }
}
const task = (ctx: WriteCtx, id: string) => ctx.session.dataset.tasks.find((t) => t.id === id)!

test('a small move within the limits is done at once, journaled and undoable', () => {
  const ctx = fresh()
  const r = result(call(ctx, 'move_task', { task_id: 't213', to_date: '2026-11-27' }))
  assert.equal(r.status, 'done')
  assert.equal(task(ctx, 't213').date, '2026-11-27')
  assert.equal(task(ctx, 't213').moves, 1)
  assert.equal(task(ctx, 't213').firstDate, '2026-11-28')
  assert.equal(ctx.session.journal[0].how, 'auto')

  const u = undo(ctx.session, r.journal_id!)
  assert.ok(u.ok)
  const back = task(ctx, 't213')
  assert.equal(back.date, '2026-11-28')
  assert.equal(back.moves, 0)
  assert.equal(back.firstDate, undefined)
  assert.ok(!undo(ctx.session, r.journal_id!).ok, 'the same entry cannot be undone twice')
})

test('every failed condition sends the move to the checklist, with the reason', () => {
  const cases: [string, string, RegExp][] = [
    ['t213', '2026-11-29', /weekend/],
    ['t213', '2026-12-03', /more than 7 days/],
    ['t208', '2026-11-25', /fixed time/],
    ['t209', '2026-11-25', /not a small task/],
    ['t214', '2026-11-25', /no day yet/],
  ]
  for (const [id, to, why] of cases) {
    const ctx = fresh()
    const r = result(call(ctx, 'move_task', { task_id: id, to_date: to }))
    assert.equal(r.status, 'waiting_for_confirmation', `${id} → ${to}`)
    assert.ok(r.why!.some((w) => why.test(w)), `${id} → ${to}: ${r.why}`)
    assert.notEqual(task(ctx, id).date, to, 'nothing applied before the tick')
  }
})

test('people and deadlines are always asked; a day that would get heavy too', () => {
  const ctx = fresh()
  const ds = ctx.session.dataset
  // a small people-task with a day, and a small task due before the target day
  ds.tasks.push({ ...task(ctx, 't213'), id: 'x1', title: 'Call grandma', sphere: 'people', date: '2026-11-24' })
  ds.tasks.push({ ...task(ctx, 't213'), id: 'x2', title: 'Return the library book', sphere: 'admin', date: '2026-11-23', deadline: '2026-11-24' })
  assert.ok(result(call(ctx, 'move_task', { task_id: 'x1', to_date: '2026-11-25' })).why!.some((w) => /other people/.test(w)))
  assert.ok(result(call(ctx, 'move_task', { task_id: 'x2', to_date: '2026-11-25' })).why!.some((w) => /deadline/.test(w)))

  // Friday already holds 4 points; two more normal tasks make it 8 + 1 > 6 × 1.25
  for (const id of ['h1', 'h2']) ds.tasks.push({ ...task(ctx, 't209'), id, date: '2026-11-27', deadline: undefined })
  const heavy = result(call(ctx, 'move_task', { task_id: 't213', to_date: '2026-11-27' }))
  assert.equal(heavy.status, 'waiting_for_confirmation')
  assert.ok(heavy.why!.some((w) => /heavy/.test(w)))
})

test('after untrusted text is read, nothing is done alone any more', () => {
  const ctx = fresh()
  markUntrusted(ctx.session)
  const r = result(call(ctx, 'move_task', { task_id: 't213', to_date: '2026-11-27' }))
  assert.equal(r.status, 'waiting_for_confirmation')
  assert.ok(r.why!.some((w) => /notes were read/.test(w)))
  assert.equal(task(ctx, 't213').date, '2026-11-28')
})

test('new tasks and reminders always wait; the checklist applies only what is ticked', () => {
  const ctx = fresh()
  const a = result(call(ctx, 'add_task', { title: 'Buy cat food', sphere: 'home', size: 'small', date: '2026-11-24' }))
  const b = result(call(ctx, 'add_task', { title: 'Plan the holiday', sphere: 'home', size: 'normal' }))
  const c = result(call(ctx, 'schedule_reminder', { text: 'Leave for the doctor', date: '2026-11-24', time: '14:30', task_id: 't208' }))
  assert.deepEqual([a.status, b.status, c.status], Array(3).fill('waiting_for_confirmation'))
  const before = ctx.session.dataset.tasks.length

  const list = checklist(ctx.session)
  assert.match(list, /3 change\(s\) wait/)
  assert.match(list, /\[x\] p\d+ {2}Add "Buy cat food"/)
  assert.match(list, /Remind 2026-11-24 at 14:30/)

  // The person unticks the holiday
  const done = confirm(ctx.session, [a.proposal_id!, c.proposal_id!])
  assert.equal(done.applied.length, 2)
  assert.deepEqual(done.dropped, [b.proposal_id])
  assert.equal(ctx.session.dataset.tasks.length, before + 1)
  assert.equal(ctx.session.dataset.reminders?.length, 1)
  assert.equal(ctx.session.pending.length, 0)
  assert.ok(ctx.session.journal.every((e) => e.how === 'confirmed'))

  // Undo in reverse order restores the plan exactly
  assert.ok(undoLast(ctx.session).ok)
  assert.ok(undoLast(ctx.session).ok)
  assert.equal(ctx.session.dataset.tasks.length, before)
  assert.equal(ctx.session.dataset.reminders?.length, 0)
  assert.ok(!undoLast(ctx.session).ok)
})

test('undo out of order is refused when a later change touched the same task', () => {
  const ctx = fresh()
  const first = result(call(ctx, 'move_task', { task_id: 't213', to_date: '2026-11-27' }))
  const second = result(call(ctx, 'move_task', { task_id: 't213', to_date: '2026-11-26' }))
  assert.equal(second.status, 'done')
  const refused = undo(ctx.session, first.journal_id!)
  assert.ok(!refused.ok && /undo j\d+ first/.test(refused.error))
  assert.ok(undo(ctx.session, second.journal_id!).ok)
  assert.ok(undo(ctx.session, first.journal_id!).ok)
  assert.equal(task(ctx, 't213').date, '2026-11-28')
})

test('a ticked proposal that no longer fits is skipped, not forced', () => {
  const ctx = fresh()
  const p = result(call(ctx, 'move_task', { task_id: 't209', to_date: '2026-11-25' }))
  task(ctx, 't209').doneAt = '2026-11-22T15:00' // the person finished it meanwhile
  const r = confirm(ctx.session, [p.proposal_id!])
  assert.equal(r.applied.length, 0)
  assert.match(r.skipped[0].why, /already closed/)
})

test('past days, closed tasks and impossible arguments are rejected before anything runs', () => {
  const ctx = fresh()
  const bad: [string, unknown, RegExp][] = [
    ['move_task', { task_id: 't213', to_date: '2026-11-20' }, /past/],
    ['move_task', { task_id: 'nope', to_date: '2026-11-27' }, /no task/],
    ['move_task', { task_id: 't213', to_date: '2026-11-28' }, /already on/],
    ['add_task', { title: 'X', sphere: 'home', size: 'small', time: '10:00' }, /time.*needs a/],
    ['add_task', { title: 'X', sphere: 'home', size: 'huge' }, /one of/],
    ['schedule_reminder', { text: 'X', date: '2026-11-24', time: '25:00' }, /pattern|match/],
    ['delete_task', { task_id: 't213' }, /no tool/],
  ]
  for (const [name, args, why] of bad) {
    const o = call(ctx, name, args)
    assert.ok(!o.ok, `${name} ${JSON.stringify(args)} should fail`)
    assert.match(toolMessage(o), why)
  }
  const closed = task(ctx, 't206')
  closed.doneAt = '2026-11-22T10:00'
  assert.match(toolMessage(call(ctx, 'move_task', { task_id: 't206', to_date: '2026-11-24' })), /already closed/)
  assert.equal(ctx.session.journal.length + ctx.session.pending.length, 0)
})
