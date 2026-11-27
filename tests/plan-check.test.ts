import test from 'node:test'
import assert from 'node:assert/strict'
import { generate } from '../src/data/generate.ts'
import { callTool } from '../src/tools/registry.ts'
import { WRITE_TOOLS, type WriteCtx } from '../src/tools/write.ts'
import { startSession } from '../src/agent/journal.ts'
import { checkPlan } from '../src/agent/check.ts'
import { systemPrompt } from '../src/demo/ask.ts'

// Mira, today Sunday 2026-11-22. Her plan for the week: team sync Mon 10:00, doctor Tue 15:00,
// exam Thu 19:00 (big), project hand-in Fri (big). Usual lunch ~13:12, dinner ~19:48. Last night
// was ~6.6 h against her usual 7.9 h, and she is ~8.5 h short on sleep this week.
type R = { status: string; broken?: string[]; warnings?: string[]; why?: string[] }
const fresh = (): WriteCtx => ({ session: startSession(generate().dataset) })
const add = (ctx: WriteCtx, args: Record<string, unknown>) => {
  const o = callTool(WRITE_TOOLS, { id: 'c', name: 'add_task', arguments: { sphere: 'home', size: 'small', ...args } }, ctx)
  assert.ok(o.ok, !o.ok ? o.error : '')
  return o.result as R
}
const rejectedBy = (r: R, re: RegExp) => {
  assert.equal(r.status, 'rejected', JSON.stringify(r))
  assert.ok(r.broken!.some((b) => re.test(b)), JSON.stringify(r.broken))
}

test('every rule with a form is enforced in the person’s own words', () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ title: 'Design review', size: 'big', date: '2026-11-26' }, /^At most one big task per day: .*2 big tasks/],
    [{ title: 'Answer client email', sphere: 'work', date: '2026-11-28' }, /^No work tasks on weekends/],
    [{ title: 'Movie night', size: 'normal', date: '2026-11-23', time: '21:30' }, /^Keep evenings after 22:00 free/],
    [{ title: 'Call the bank', sphere: 'admin', date: '2026-11-23', time: '09:00' }, /^No calls before 10:00/],
    [{ title: 'Gym', sphere: 'health', size: 'normal', date: '2026-11-25', time: '07:00' }, /^Gym only in the evening/],
    [{ title: 'Pick up a parcel', date: '2026-11-24', time: '18:15' }, /^Course evenings/],
  ]
  for (const [args, re] of cases) {
    const ctx = fresh()
    const before = structuredClone(ctx.session.dataset.tasks)
    rejectedBy(add(ctx, args), re)
    assert.deepEqual(ctx.session.dataset.tasks, before, 'a rejected change leaves no trace')
    assert.equal(ctx.session.pending.length, 0)
  }
})

test('built-in hard checks: overlapping timed tasks and usual meal times', () => {
  rejectedBy(add(fresh(), { title: 'Dentist', sphere: 'health', date: '2026-11-24', time: '15:15' }), /^overlap: .*Doctor appointment/)
  rejectedBy(add(fresh(), { title: 'Pharmacy', sphere: 'health', date: '2026-11-23', time: '13:00' }), /^meal time: .*lunch/)
  // the same task an hour later is fine
  assert.equal(add(fresh(), { title: 'Pharmacy', sphere: 'health', date: '2026-11-23', time: '14:30' }).status, 'waiting_for_confirmation')
})

test('the person’s own plan is not flagged — only what the agent touched', () => {
  const ctx = fresh()
  const ds = ctx.session.dataset
  // Her exam (Thursday 19:00, 2 h) runs into course evening and dinner time; that is her choice
  const all = new Set(ds.tasks.map((t) => t.id))
  assert.ok(checkPlan(ds, ctx.session.plan, all).hard.length > 0, 'the exam would break rules if the agent had put it there')
  assert.deepEqual(checkPlan(ds, ctx.session.plan, new Set()).hard, [])
  // An untimed small task on the same Thursday is accepted
  assert.equal(add(ctx, { title: 'Water the plants', date: '2026-11-26' }).status, 'waiting_for_confirmation')
})

test('a rule without a form reaches the model but is not checked by code', () => {
  const ds = generate().dataset
  const vague = ds.profile.rules.find((r) => !r.form)!
  assert.match(systemPrompt(ds), new RegExp(vague.text))
  const ctx = { session: startSession(ds) }
  // Four new things on Wednesday: no form says "leave room", so code lets the model decide
  for (const title of ['A', 'B', 'C', 'D']) assert.notEqual(add(ctx, { title, date: '2026-11-25' }).status, 'rejected')
})

test('pending changes count together: two fine proposals that clash are caught', () => {
  const ctx = fresh()
  assert.equal(add(ctx, { title: 'Portfolio sprint', sphere: 'work', size: 'big', date: '2026-11-25' }).status, 'waiting_for_confirmation')
  rejectedBy(add(ctx, { title: 'Deep clean', size: 'big', date: '2026-11-25' }), /^At most one big task per day/)
  assert.equal(ctx.session.pending.length, 1)
})

test('soft findings pass with warnings: big task after a short night, late evening while short on sleep, overload', () => {
  const big = add(fresh(), { title: 'Portfolio sprint', sphere: 'work', size: 'big', date: '2026-11-23' })
  assert.equal(big.status, 'waiting_for_confirmation')
  assert.ok(big.warnings!.some((w) => /^after a short night: .*6\.6 h against the usual 7\.9 h/.test(w)), JSON.stringify(big))

  const late = add(fresh(), { title: 'Board game evening', sphere: 'people', date: '2026-11-23', time: '21:00' })
  assert.ok(late.warnings!.some((w) => /^late while short on sleep: .*8\.5 h of sleep debt/.test(w)), JSON.stringify(late))

  const ctx = fresh()
  for (const title of ['Tidy the desk', 'Sort the receipts']) add(ctx, { title, size: 'normal', date: '2026-11-27' })
  const over = add(ctx, { title: 'Fix the shelf', date: '2026-11-27' })
  assert.ok(over.warnings!.some((w) => /^overload: 2026-11-27 holds 9 points/.test(w)), JSON.stringify(over))
})
