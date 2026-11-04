// T8.5, step 1 (the spec .claude/specs/2026-10-31-handover-design.md, part 2): the hand-over as one decision of the board's.
// `decide` is pure: these are the spec's seven real cases ("The real cases for step 1"), each through the decision as the
// board meets it, and the three mutants the brief names (the order swapped, a HELD worker given a task, the untaken task
// offered to the same worker again). Made-up names and times only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { clearOwed } from '../../src/clearOwed.mjs'
import {
  HANDOVER_COMMAND, HANDOVER_MOD, LIMIT_WHY, NET_MS, NOT_TAKEN_WHY, PAUSED_WHY, RESTART_NET_MS, STATES, UNANSWERED_WHY,
  checkPendingOf, contractOf, decide, envelopesOf, laneWords, lineFor, notOfferedAgain, onSequence, outcomeOf,
} from '../../src/work/handover.mjs'
import { match } from '../../src/work/handOut.mjs'
import { parseItem } from '../../src/work/item.mjs'
import { stamp } from '../../src/work/migrate.mjs'

const MIN = 60_000
const at = (day, h, m, s = 0) => new Date(2026, 9, day, h, m, s).getTime()

const file = (head, sections = {}) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${Object.entries(sections).map(([name, lines]) => `\n## ${name}\n${lines.join('\n')}\n`).join('')}`)
const step = (id, state, more = {}, history = []) => file({ Id: id, Kind: 'step', Title: `Task ${id}`, State: state, Since: '2026-10-27 09:00', ...(state === 'refined' ? { Refined: 'ready' } : {}), ...more }, history.length === 0 ? {} : { History: history })
const mapOf = items => new Map(items.map(item => [item.head.get('Id'), item]))
const ready = (...ids) => ids.map(id => ({ id, rank: 2, keptFor: null, keptUntil: null, pinned: null }))
const said = (when, who, words) => `- ${stamp(when)} ${who}: ${words}`
/** A worker lane on the new mod whose report says idle since `since`, heard `heard`. */
const worker = (name, { since, heard = since, background = false, state = 'idle', ...more } = {}) => ({
  name, state: 'free', isMain: false, isLeftover: false, isRunning: true, mod: HANDOVER_MOD, model: 'claude-sonnet-5-5',
  report: { state, since, background, at: heard }, ...more,
})
/** A reported step (in review or done) whose board check passed, reported by `who` at `when`. */
const reported = (id, who, when, state = 'done') => step(id, state, { Owner: who }, [
  said(when - 30 * MIN, who, 'queued → taken'), said(when, who, 'in progress → review'), said(when, 'server', 'check passed'),
])
const owedOf = (lane, items) => clearOwed({ lane, items, afterStep: 'clear' })
/** The envelope the board wrote for a decision (handoverBoard.mjs does the same): the decision's envelope with id, time, state. */
const written = (decision, id, when, more = {}) => ({ id, at: when, to: 'x', command: HANDOVER_COMMAND, state: 'waiting', ...decision.envelope, ...more })

test('the predicate: only a worker on the setting "sequence" and the mod 0.27.0 or newer is on the sequence', () => {
  const lane = worker('Worker 1', { since: 0 })
  assert.equal(onSequence(lane, { handover: 'sequence' }), true)
  assert.equal(onSequence({ ...lane, mod: '0.27.3' }, { handover: 'sequence' }), true)
  assert.equal(onSequence(lane, { handover: 'timers' }), false)
  assert.equal(onSequence(lane, {}), false)
  assert.equal(onSequence({ ...lane, mod: '0.26.10' }, { handover: 'sequence' }), false)
  assert.equal(onSequence({ ...lane, mod: null }, { handover: 'sequence' }), false)
  assert.equal(onSequence({ ...lane, isMain: true }, { handover: 'sequence' }), false)
  assert.equal(onSequence({ ...lane, isLeftover: true }, { handover: 'sequence' }), false)
})

test('2026-11-02 (Workers 3 and 4 held an hour after "/clear did not run within two minutes"): a hold on a failed clear ends after 10 min of running time at the next idle report, with the next try on the lane; a clear the board\'s restart cut is no time-out', async () => {
  const { HELD_RETRY_MS } = await import('../../src/work/handover.mjs')
  const name = 'Worker 3'
  const reportAt = at(27, 21, 10)
  const items = mapOf([reported('B930', name, reportAt), step('B940', 'refined')])
  const idleAt = when => worker(name, { since: at(27, 21, 20), heard: when })
  const owed = owedOf(idleAt(at(27, 21, 25)), items)
  // The clear envelope failed on the mod's own two minutes (no background, no set): nothing but a turn end released it before.
  const failed = { id: 'c1', at: at(27, 21, 25), to: name, command: HANDOVER_COMMAND, kind: 'clear', step: null, clear: { step: 'B930', reportedAt: reportAt }, restart: false, set: null, line: null, state: 'failed', settledAt: at(27, 21, 27), failedAt: at(27, 21, 27), outcome: { cleared: false, set: null, typed: null, restarted: null, background: false, why: '/clear did not run within two minutes' } }
  const soon = decide({ worker: idleAt(at(27, 21, 30)), items, ready: ready('B940'), owed, envelopes: [failed], now: at(27, 21, 30) })
  assert.equal(soon.state, STATES.HELD)
  assert.match(soon.why, /^its clear did not run: \/clear did not run within two minutes; next try 21:37$/)
  assert.equal(soon.envelope, null)
  // 10 minutes of running time on, the next idle report releases it: the clear goes again (and B940 with it).
  const later = decide({ worker: idleAt(at(27, 21, 38)), items, ready: ready('B940'), owed, envelopes: [failed], now: at(27, 21, 38) })
  assert.notEqual(later.state, STATES.HELD)
  assert.deepEqual(later.envelope?.clear, { step: 'B930', reportedAt: reportAt })
  // The board's off time does not count: 10 clock minutes with 5 off is 5 of running time: still held.
  const off = decide({ worker: idleAt(at(27, 21, 38)), items, ready: ready('B940'), owed, envelopes: [failed], now: at(27, 21, 38), runningMs: from => at(27, 21, 38) - from - 5 * MIN })
  assert.equal(off.state, STATES.HELD)
  assert.equal(HELD_RETRY_MS, 10 * MIN)
  // B930's "twice on the board's time-out" cap: a clear the board's own restart cut (sent in the minute before the board
  // started, or refused "not running") is no time-out: the next idle report releases, and the hold never outlives 10 min.
  const timeout = why => ({ ...failed, outcome: { ...failed.outcome, why } })
  const first = { ...timeout('(The worker board did not answer within 15 s)'), id: 'c0', at: at(27, 21, 0), settledAt: at(27, 21, 2), failedAt: at(27, 21, 2) }
  const cut = { ...timeout('(The worker board is not running)'), id: 'c2', at: at(27, 21, 25), settledAt: at(27, 21, 27), failedAt: at(27, 21, 27) }
  const afterCut = decide({ worker: idleAt(at(27, 21, 28)), items, ready: ready('B940'), owed, envelopes: [first, cut], now: at(27, 21, 28), boardStartedAt: at(27, 21, 26) })
  assert.notEqual(afterCut.state, STATES.HELD, 'a restart cut is no second time-out')
  const twice = { ...timeout('(The worker board did not answer within 15 s)'), id: 'c3', at: at(27, 21, 25), settledAt: at(27, 21, 27), failedAt: at(27, 21, 27) }
  const heldTwice = decide({ worker: idleAt(at(27, 21, 28)), items, ready: ready('B940'), owed, envelopes: [first, twice], now: at(27, 21, 28) })
  assert.equal(heldTwice.state, STATES.HELD)
  assert.match(heldTwice.why, /failed twice on the board's own time-out; next try 21:37$/)
  assert.notEqual(decide({ worker: idleAt(at(27, 21, 38)), items, ready: ready('B940'), owed, envelopes: [first, twice], now: at(27, 21, 38) }).state, STATES.HELD, 'twice, but never for ever')
})

test('real case 1, Worker 1 with B738 and B740 (27 Oct, X91, X94): a clear refused for background work holds the worker, its task goes back at once, B740 goes elsewhere', () => {
  const name = 'Worker 1'
  const reportAt = at(27, 21, 39)
  const items = mapOf([reported('B720', name, reportAt), step('B738', 'refined'), step('B740', 'refined')])
  const lane = worker(name, { since: at(27, 21, 59), heard: at(27, 22, 0), background: true })
  const owed = owedOf(lane, items)
  assert.equal(owed.step, 'B720')
  // T at 22:00: one decision, one envelope: the clear first, then B738.
  const first = decide({ worker: lane, items, ready: ready('B738', 'B740'), owed, now: at(27, 22, 0), event: { kind: 'turn-ended', since: at(27, 21, 30) } })
  assert.equal(first.state, STATES.HANDING)
  assert.equal(first.give, 'B738')
  assert.deepEqual(first.envelope.clear, { step: 'B720', reportedAt: reportAt })
  assert.equal(first.envelope.line, lineFor('B738'))
  // The board gave it (refined → queued for Worker 1) and the mod settles: the clear was refused, background work runs.
  const given = mapOf([...items.values()].map(one => (one.head.get('Id') === 'B738' ? step('B738', 'queued', { Owner: name }) : one)))
  const settled = written(first, 'e1', at(27, 22, 0), { state: 'failed', settledAt: at(27, 22, 0, 20), outcome: { cleared: false, set: null, typed: false, background: true, why: 'background work it started still runs' } })
  const held = decide({ worker: lane, items: given, ready: ready('B740'), owed, envelopes: [settled], now: at(27, 22, 0, 21) })
  assert.equal(held.state, STATES.HELD)
  assert.deepEqual(held.takeBack, { id: 'B738', why: 'its clear did not run: background work it started still runs' })
  assert.equal(held.give, null)
  assert.equal(held.envelope, null)
  // B738 is back on the list; the worker stays HELD (no 20 minutes, no second task): B740 is not given to it.
  const back = mapOf([...given.values()].map(one => (one.head.get('Id') === 'B738' ? step('B738', 'refined') : one)))
  const still = decide({ worker: { ...lane, report: { ...lane.report, at: at(27, 22, 5) } }, items: back, ready: ready('B738', 'B740'), owed, envelopes: [settled], now: at(27, 22, 5) })
  assert.equal(still.state, STATES.HELD)
  assert.equal(still.give, null)
  assert.equal(still.takeBack, null)
  // Another free worker gets B738 meanwhile, at once.
  const other = worker('Worker 2', { since: at(27, 21, 0) })
  assert.equal(decide({ worker: other, items: back, ready: ready('B738', 'B740'), now: at(27, 22, 1) }).give, 'B738')
  // B: its report says idle with nothing in the background: decided again, the clear and the next task in one envelope.
  const freed = decide({ worker: { ...lane, report: { state: 'idle', since: lane.report.since, background: false, at: at(27, 22, 12) } }, items: back, ready: ready('B740'), owed, envelopes: [settled], now: at(27, 22, 12) })
  assert.equal(freed.state, STATES.HANDING)
  assert.equal(freed.give, 'B740')
  assert.equal(freed.envelope.clear.step, 'B720')
})

test('real case 2, Worker 2 with B742 and the week\'s stop (X98): suspended at its turn end with its clear owed, nothing sent; at the limit\'s end decided', () => {
  const name = 'Worker 2'
  const items = mapOf([reported('B742', name, at(27, 22, 50)), step('B750', 'refined')])
  const lane = worker(name, { since: at(27, 22, 50, 10) })
  const owed = owedOf(lane, items)
  const stop = decide({ worker: lane, items, ready: ready('B750'), owed, limitFull: true, now: at(27, 22, 50, 15), event: { kind: 'turn-ended', since: at(27, 22, 20) } })
  assert.equal(stop.state, STATES.SUSPENDED)
  assert.equal(stop.why, LIMIT_WHY)
  assert.equal(stop.envelope, null)
  assert.equal(stop.give, null)
  // The clear is still owed: it runs with the decision once the limit is back (a pass, P).
  assert.notEqual(owedOf(lane, items), null)
  const back = decide({ worker: lane, items, ready: ready('B750'), owed, now: at(28, 0, 10) })
  assert.equal(back.state, STATES.HANDING)
  assert.equal(back.envelope.clear.step, 'B742')
  assert.equal(back.give, 'B750')
})

test('real case 3, Worker 3 through the pause (X86, X100): a turn end inside the pause sends nothing; the resume decides, the clear with the next task', () => {
  const name = 'Worker 3'
  const items = mapOf([reported('B727', name, at(28, 12, 27)), step('B751', 'refined')])
  const lane = worker(name, { since: at(28, 12, 28) })
  const owed = owedOf(lane, items)
  const inPause = decide({ worker: lane, items, ready: ready('B751'), owed, paused: true, now: at(28, 12, 28), event: { kind: 'turn-ended', since: at(28, 12, 0) } })
  assert.deepEqual([inPause.state, inPause.why, inPause.envelope, inPause.give], [STATES.SUSPENDED, PAUSED_WHY, null, null])
  const resumed = decide({ worker: lane, items, ready: ready('B751'), owed, now: at(28, 12, 52) })
  assert.equal(resumed.state, STATES.HANDING)
  assert.equal(resumed.envelope.clear.step, 'B727')
  assert.equal(resumed.give, 'B751')
})

test('real case 4, B746 at the pause (X101): the task in flight goes back at the pause, and the resume gives it again', () => {
  const name = 'Worker 2'
  const items = mapOf([step('B746', 'queued', { Owner: name }, [said(at(28, 12, 28), 'server', `refined → queued (given by the board to ${name})`)])])
  const lane = worker(name, { since: at(28, 12, 20) })
  const envelope = { id: 'e1', at: at(28, 12, 28, 16), to: name, command: HANDOVER_COMMAND, state: 'taken', kind: 'task', step: 'B746', clear: null, set: null, line: lineFor('B746') }
  const paused = decide({ worker: lane, items, ready: [], envelopes: [envelope], paused: true, now: at(28, 12, 28, 21) })
  assert.equal(paused.state, STATES.SUSPENDED)
  assert.deepEqual(paused.takeBack, { id: 'B746', why: PAUSED_WHY })
  // At the resume it is decided anew: a pause's take-back is no "did not take it", so B746 may go to the same worker.
  const back = mapOf([step('B746', 'refined', {}, [said(at(28, 12, 28), 'server', `queued → refined (taken back from ${name}: ${PAUSED_WHY})`)])])
  const resumed = decide({ worker: lane, items: back, ready: ready('B746'), envelopes: [{ ...envelope, state: 'delivered' }], now: at(28, 12, 52) })
  assert.equal(resumed.give, 'B746')
})

test('real case 5, B770 (X105): no 2-minute clock; the net takes it back once after 10 minutes of running time, the worker shows "did not answer", and the net does not retry', () => {
  const name = 'Worker 5'
  const givenAt = at(30, 20, 18)
  const items = mapOf([step('B770', 'queued', { Owner: name }), step('B771', 'refined')])
  const lane = worker(name, { since: at(30, 20, 0), isRunning: false, asleep: true, state: 'ended' })
  const envelope = { id: 'e1', at: givenAt, to: name, command: HANDOVER_COMMAND, state: 'waiting', kind: 'task', step: 'B770', clear: null, set: null, line: lineFor('B770') }
  const facts = (now, more = {}) => ({ worker: lane, items, ready: ready('B771'), envelopes: [envelope], now, runningMs: from => now - from, ...more })
  // 20:22, four minutes on: still handing; nothing goes back.
  const early = decide(facts(at(30, 20, 22)))
  assert.deepEqual([early.state, early.takeBack, early.give, early.envelope], [STATES.HANDING, null, null, null])
  // The board was off for 5 of the next 10 minutes: running time 9 min, no net yet.
  const offFive = decide(facts(at(30, 20, 28, 30), { runningMs: from => at(30, 20, 28, 30) - from - 5 * MIN }))
  assert.equal(offFive.takeBack, null)
  // 10 minutes of running time: back once, unknown, the envelope closed (it waits) and marked.
  const net = decide(facts(at(30, 20, 28, 30)))
  assert.equal(net.state, STATES.UNKNOWN)
  assert.deepEqual(net.takeBack, { id: 'B770', why: UNANSWERED_WHY })
  assert.equal(net.net, 'e1')
  assert.equal(net.close, 'e1')
  assert.equal(laneWords(net), `${UNANSWERED_WHY} (B770)`)
  // After it: B770 back on the list, the envelope marked; the next passes take nothing back and send nothing (no retry).
  const back = mapOf([step('B770', 'refined'), step('B771', 'refined')])
  const marked = { ...envelope, state: 'dropped', netAt: at(30, 20, 28, 30) }
  for (const now of [at(30, 20, 29), at(30, 20, 45), at(30, 21, 30)]) {
    const after = decide({ ...facts(now), items: back, ready: ready('B770', 'B771'), envelopes: [marked] })
    assert.deepEqual([after.state, after.takeBack, after.give, after.envelope, after.net], [STATES.UNKNOWN, null, null, null, null])
  }
  // Its next event (a report that changed: it runs again and says idle) decides anew.
  const woke = decide({ ...facts(at(30, 21, 31)), worker: worker(name, { since: at(30, 21, 31) }), items: back, ready: ready('B770', 'B771'), envelopes: [marked] })
  assert.equal(woke.state, STATES.HANDING)
  assert.equal(woke.give, 'B770')
})

test('real case 6, B756 taken and reported in one minute (X102): one decision at the turn end, the clear of B756 with the next task', () => {
  const name = 'Worker 1'
  const items = mapOf([
    step('B756', 'done', { Owner: name }, [said(at(28, 12, 59), name, 'queued → taken'), said(at(28, 12, 59), name, 'in progress → review'), said(at(28, 12, 59), 'server', 'check passed')]),
    step('B757', 'refined'),
  ])
  const lane = worker(name, { since: at(28, 12, 59, 40), compaction: { lastCleared: { at: at(28, 12, 0), step: 'B755' } } })
  const owed = owedOf(lane, items)
  const once = decide({ worker: lane, items, ready: ready('B757'), owed, now: at(28, 13, 0), event: { kind: 'turn-ended', since: at(28, 12, 58) } })
  assert.equal(once.state, STATES.HANDING)
  assert.deepEqual([once.envelope.clear.step, once.give, once.takeBack], ['B756', 'B757', null])
  // The same facts, the same answer (principle 5).
  assert.deepEqual(decide({ worker: lane, items, ready: ready('B757'), owed, now: at(28, 13, 0), event: { kind: 'turn-ended', since: at(28, 12, 58) } }), once)
})

test('real case 7, Worker 1 busy by its report (X111): not free, nothing handed at a pass', () => {
  const items = mapOf([step('B790', 'refined')])
  const busy = decide({ worker: worker('Worker 1', { since: at(31, 0, 51), state: 'busy' }), items, ready: ready('B790'), now: at(31, 1, 2) })
  assert.equal(busy.state, STATES.WORKING)
  assert.equal(busy.give, null)
  // Its turn end is the trigger: then it gets it.
  assert.equal(decide({ worker: worker('Worker 1', { since: at(31, 0, 51), state: 'busy' }), items, ready: ready('B790'), now: at(31, 1, 2), event: { kind: 'turn-ended', since: at(31, 0, 51) } }).give, 'B790')
})

test('the order: a paused worker that holds a step is suspended, not working (mutant: paused after working)', () => {
  const items = mapOf([step('B1', 'in progress', { Owner: 'Worker 1' })])
  const lane = worker('Worker 1', { since: at(28, 9, 0), state: 'busy' })
  assert.equal(decide({ worker: lane, items, paused: true, now: at(28, 9, 5) }).state, STATES.SUSPENDED)
  assert.equal(decide({ worker: lane, items, limitFull: true, now: at(28, 9, 5) }).state, STATES.SUSPENDED)
  assert.equal(decide({ worker: lane, items, now: at(28, 9, 5) }).state, STATES.WORKING)
})

test('a turn that ended after the line without a take gives the task back at once and decides on; that task is not offered to it again until it takes another (mutant)', () => {
  const name = 'Worker 4'
  const items = mapOf([step('B12', 'queued', { Owner: name }), step('B13', 'refined')])
  const lane = worker(name, { since: at(29, 10, 0) })
  const envelope = { id: 'e1', at: at(29, 9, 50), to: name, command: HANDOVER_COMMAND, state: 'delivered', kind: 'task', step: 'B12', clear: null, set: null, line: lineFor('B12'), outcome: { cleared: null, set: null, typed: true, why: null } }
  // Offered: typed, not taken yet.
  assert.equal(decide({ worker: lane, items, ready: ready('B13'), envelopes: [envelope], now: at(29, 9, 55) }).state, STATES.OFFERED)
  // Its turn ends without the take.
  const ended = decide({ worker: lane, items, ready: ready('B12', 'B13'), envelopes: [envelope], now: at(29, 10, 0), event: { kind: 'turn-ended', since: at(29, 9, 51) } })
  assert.deepEqual(ended.takeBack, { id: 'B12', why: NOT_TAKEN_WHY })
  assert.equal(ended.give, 'B13')
  assert.equal(ended.why, 'did not take B12 in its turn')
  // B12 back on the list with the board's History line: with B12 alone ready it gets nothing; another worker gets it.
  const back = mapOf([step('B12', 'refined', {}, [said(at(29, 10, 0), 'server', `queued → refined (taken back from ${name}: ${NOT_TAKEN_WHY})`)])])
  assert.deepEqual([...notOfferedAgain(back, name)], ['B12'])
  const free = decide({ worker: lane, items: back, ready: ready('B12'), envelopes: [envelope], now: at(29, 10, 1) })
  assert.deepEqual([free.state, free.give], [STATES.FREE, null])
  assert.equal(decide({ worker: worker('Worker 5', { since: at(29, 9, 0) }), items: back, ready: ready('B12'), now: at(29, 10, 1) }).give, 'B12')
  // Once it took another task, B12 may come to it again.
  const tookOther = mapOf([...back.values(), step('B14', 'done', { Owner: name }, [said(at(29, 10, 30), name, 'queued → taken'), said(at(29, 11, 0), name, 'in progress → review'), said(at(29, 11, 0), 'server', 'check passed')])])
  assert.deepEqual([...notOfferedAgain(tookOther, name)], [])
  assert.equal(decide({ worker: worker(name, { since: at(29, 11, 1) }), items: tookOther, ready: ready('B12'), now: at(29, 11, 2) }).give, 'B12')
})

test('a turn that ended before the envelope, or an envelope still waiting in the outbox, takes nothing back', () => {
  const name = 'Worker 4'
  const items = mapOf([step('B12', 'queued', { Owner: name })])
  const lane = worker(name, { since: at(29, 10, 0) })
  const envelope = { id: 'e1', at: at(29, 9, 50), to: name, command: HANDOVER_COMMAND, state: 'taken', kind: 'task', step: 'B12', line: lineFor('B12') }
  assert.equal(decide({ worker: lane, items, envelopes: [envelope], now: at(29, 9, 52), event: { kind: 'turn-ended', since: at(29, 9, 40) } }).takeBack, null)
  assert.equal(decide({ worker: lane, items, envelopes: [{ ...envelope, state: 'waiting' }], now: at(29, 9, 52), event: { kind: 'turn-ended', since: at(29, 9, 51) } }).takeBack, null)
  // The take ends it: working.
  assert.equal(decide({ worker: lane, items: mapOf([step('B12', 'taken', { Owner: name })]), envelopes: [envelope], now: at(29, 9, 53) }).state, STATES.WORKING)
})

test('a set that failed: the task back, held until its report; then no step that wants that model goes to it', () => {
  const name = 'Worker 1'
  const opus = { model: 'claude-opus-5-5', effort: 'high' }
  const items = mapOf([step('B20', 'queued', { Owner: name }), step('B21', 'refined')])
  const lane = worker(name, { since: at(29, 10, 0), heard: at(29, 10, 0) })
  const setFor = id => (id === 'B20' ? opus : null)
  const failed = { id: 'e1', at: at(29, 10, 0), to: name, command: HANDOVER_COMMAND, state: 'failed', kind: 'task', step: 'B20', clear: null, set: opus, line: lineFor('B20'), settledAt: at(29, 10, 1), outcome: { cleared: null, set: false, typed: false, why: 'the app refused the model' } }
  const held = decide({ worker: lane, items, ready: ready('B21'), envelopes: [failed], setFor, now: at(29, 10, 1) })
  assert.equal(held.state, STATES.HELD)
  assert.equal(held.takeBack.id, 'B20')
  assert.match(held.why, /could not be set: the app refused the model/)
  const back = mapOf([step('B20', 'refined'), step('B21', 'refined')])
  const next = decide({ worker: worker(name, { since: at(29, 10, 0), heard: at(29, 10, 2) }), items: back, ready: ready('B20', 'B21'), envelopes: [failed], setFor, now: at(29, 10, 2) })
  assert.equal(next.give, 'B21')
})

test('a failed check of its report: the "back to you" words once per failed check, at the turn end; then silent', () => {
  const name = 'Worker 3'
  const items = mapOf([step('B727', 'review', { Owner: name }, [said(at(27, 21, 2), name, 'in progress → review'), said(at(27, 21, 3), 'server', 'check failed: the tests did not pass')])])
  const lane = worker(name, { since: at(27, 21, 10) })
  const first = decide({ worker: lane, items, ready: ready(), now: at(27, 21, 10), event: { kind: 'turn-ended', since: at(27, 21, 4) } })
  assert.equal(first.state, STATES.WORKING)
  assert.match(first.envelope.line, /B727/)
  const told = { id: 'e1', at: at(27, 21, 10), to: name, command: HANDOVER_COMMAND, state: 'delivered', outcome: { typed: true }, ...first.envelope }
  const again = decide({ worker: lane, items, ready: ready(), envelopes: [told], now: at(27, 21, 30), event: { kind: 'turn-ended', since: at(27, 21, 11) } })
  assert.deepEqual([again.state, again.envelope], [STATES.WORKING, null])
})

test('a check still pending: checking, nothing handed; its end decides', () => {
  const name = 'Worker 2'
  const pending = mapOf([step('B30', 'review', { Owner: name }, [said(at(29, 9, 0), name, 'in progress → review'), said(at(29, 9, 0), 'server', 'check pending')]), step('B31', 'refined')])
  assert.deepEqual(checkPendingOf(pending, name), { id: 'B30' })
  const lane = worker(name, { since: at(29, 9, 1) })
  const checking = decide({ worker: lane, items: pending, ready: ready('B31'), now: at(29, 9, 1), event: { kind: 'turn-ended', since: at(29, 8, 50) } })
  assert.deepEqual([checking.state, checking.give, checking.envelope], [STATES.CHECKING, null, null])
  const passed = mapOf([step('B30', 'review', { Owner: name }, [said(at(29, 9, 0), name, 'in progress → review'), said(at(29, 9, 0), 'server', 'check pending'), said(at(29, 9, 2), 'server', 'check passed')]), step('B31', 'refined')])
  assert.equal(decide({ worker: lane, items: passed, ready: ready('B31'), owed: owedOf(lane, passed), now: at(29, 9, 2) }).give, 'B31')
})

test('an older mod than the installed one: one restart envelope, restarting, unknown after 15 minutes; on the new mod decided', () => {
  const name = 'Worker 2'
  const items = mapOf([step('B40', 'refined')])
  const lane = worker(name, { since: at(29, 9, 0) })
  const asked = decide({ worker: lane, items, ready: ready('B40'), installed: '0.27.1', now: at(29, 9, 1), event: { kind: 'turn-ended', since: at(29, 8, 0) } })
  assert.equal(asked.state, STATES.RESTARTING)
  assert.deepEqual([asked.envelope.restart, asked.envelope.version, asked.give], [true, '0.27.1', null])
  const envelope = { id: 'r1', at: at(29, 9, 1), to: name, command: HANDOVER_COMMAND, state: 'delivered', ...asked.envelope, outcome: { restarted: true } }
  assert.deepEqual([decide({ worker: lane, items, ready: ready('B40'), installed: '0.27.1', envelopes: [envelope], now: at(29, 9, 5) }).state], [STATES.RESTARTING])
  assert.equal(decide({ worker: lane, items, ready: ready('B40'), installed: '0.27.1', envelopes: [envelope], now: at(29, 9, 1) + RESTART_NET_MS }).state, STATES.UNKNOWN)
  // M: its first call on the new mod.
  assert.equal(decide({ worker: { ...lane, mod: '0.27.1' }, items, ready: ready('B40'), installed: '0.27.1', envelopes: [envelope], now: at(29, 9, 6) }).give, 'B40')
})

test('a free worker with no task: no clear alone (the lazy clear, R1), nothing at all; a clear envelope of an older board still on its way is waited for, not sent twice', () => {
  const name = 'Worker 1'
  const items = mapOf([reported('B50', name, at(29, 9, 0))])
  const lane = worker(name, { since: at(29, 9, 1) })
  const owed = owedOf(lane, items)
  const free = decide({ worker: lane, items, owed, now: at(29, 9, 1), event: { kind: 'turn-ended', since: at(29, 8, 30) } })
  assert.deepEqual([free.state, free.envelope, free.give], [STATES.FREE, null, null])
  // A clear-only envelope written before the lazy clear (the landing's sweep closes those still waiting; one taken stays).
  const out = { id: 'c1', at: at(29, 9, 1), to: name, command: HANDOVER_COMMAND, state: 'taken', kind: 'clear', step: null, clear: { step: 'B50', reportedAt: owed.reportedAt }, restart: false, set: null, line: null, back: null }
  const waiting = decide({ worker: lane, items: mapOf([...items.values(), step('B51', 'refined')]), ready: ready('B51'), owed, envelopes: [out], now: at(29, 9, 2) })
  assert.deepEqual([waiting.state, waiting.envelope, waiting.give], [STATES.HANDING, null, null])
  assert.deepEqual(decide({ worker: lane, items: new Map(), now: at(29, 9, 1) }).envelope, null)
  // Its clear never answered: the net marks it once, unknown.
  const net = decide({ worker: lane, items, owed, envelopes: [out], now: at(29, 9, 1) + NET_MS })
  assert.deepEqual([net.state, net.net], [STATES.UNKNOWN, 'c1'])
})

test('the envelope as the mod reads it, the outcome as the board takes it, and the worker\'s envelopes', () => {
  const message = { id: 'e9', at: 5, to: 'Game - Worker 1', command: HANDOVER_COMMAND, state: 'waiting', kind: 'task', step: 'B9', clear: { step: 'B8', reportedAt: 4 }, restart: false, set: { model: 'claude-opus-5-5', effort: 'high' }, line: lineFor('B9'), back: null }
  assert.deepEqual(contractOf(message), { id: 'e9', kind: 'task', step: 'B9', clear: { step: 'B8', reportedAt: 4 }, restart: false, set: { model: 'claude-opus-5-5', effort: 'high' }, line: 'work: B9 is yours; run work next' })
  assert.deepEqual(outcomeOf({ cleared: true, set: 'yes', typed: true, why: '  ok\n then ' }), { cleared: true, set: null, typed: true, restarted: null, background: false, why: 'ok then', clearWhy: null, typedAt: null, enteredAt: null })
  // 4c (Workers mod 0.30.0): the line's exact times, finite or null.
  assert.deepEqual([outcomeOf({ typed: true, typedAt: 5, enteredAt: 7 })].map(one => [one.typedAt, one.enteredAt]), [[5, 7]])
  assert.deepEqual([outcomeOf({ typed: true, typedAt: 'soon', enteredAt: Infinity })].map(one => [one.typedAt, one.enteredAt]), [[null, null]])
  assert.equal(outcomeOf('done'), null)
  assert.deepEqual(envelopesOf([{ ...message, at: 9, id: 'b' }, message, { ...message, command: 'work' }], 'Worker 1', 'Game - ').map(one => one.id), ['e9', 'b'])
})

// ---- Signals change 4, B908 (2026-11-02): the hand-over around a wake. The real cases: B855's envelope eb4fe8aada155b05
// to Worker 5 (created 11:01:57, taken 11:07:03, typed 11:07:22); the Advisor's wake message 11:06:50, Worker 5's process
// 11:06:56, its first take (the verdict) 11:07:03; its first turn ended 11:07:21 with no take. Mutants named in each.

const day2 = (h, m, s = 0) => new Date(2026, 10, 2, h, m, s).getTime()
const W5 = 'Worker 5'
const asleepW5 = (more = {}) => worker(W5, { since: day2(9, 0), state: 'ended', isRunning: false, asleep: true, asleepSince: day2(9, 0), ...more })
const queuedB855 = () => mapOf([step('B855', 'queued', { Owner: W5 }), step('B856', 'refined')])
const env855 = (more = {}) => ({ id: 'eb4fe8aada155b05', at: day2(11, 1, 57), to: W5, command: HANDOVER_COMMAND, kind: 'task', step: 'B855', clear: null, set: null, line: lineFor('B855'), state: 'waiting', ...more })

test('change 4, D.2: a task given to a sleeper while its wake is pending is HANDING and the net does not run (mutant: the net during a pending wake)', () => {
  for (const state of ['waiting-sender', 'on-its-way', 'sent', 'launched']) {
    // 25 minutes after the envelope: the net would have fired twice over.
    const held = decide({ worker: asleepW5(), items: queuedB855(), ready: ready('B856'), envelopes: [env855()], now: day2(11, 27), wake: { state, final: false, at: day2(11, 6, 50), by: 'Advisor', wokeAt: null, firstTurnEnd: false } })
    assert.deepEqual([held.state, held.step, held.takeBack, held.net], [STATES.HANDING, 'B855', null, null], state)
  }
  // A first way that failed with the other still to try is still waking.
  const trying = decide({ worker: asleepW5(), items: queuedB855(), envelopes: [env855()], now: day2(11, 27), wake: { state: 'failed', final: false, why: 'the app did not start it' } })
  assert.equal(trying.state, STATES.HANDING)
})

test('change 4, D.2: once every way failed, the task goes back once ("could not wake it"), then the worker gets nothing at a pass', () => {
  const failed = { state: 'failed', final: true, why: 'no report within 2 minutes of the message', wokeAt: null, firstTurnEnd: false }
  const back = decide({ worker: asleepW5(), items: queuedB855(), ready: ready('B856'), envelopes: [env855()], now: day2(11, 10), wake: failed })
  assert.deepEqual([back.state, back.takeBack, back.close, back.give], [STATES.UNKNOWN, { id: 'B855', why: 'could not wake it' }, 'eb4fe8aada155b05', null])
  // The board carried it out: B855 is back on the list, the envelope closed. The next pass gives it no other task to bounce.
  const after = decide({ worker: asleepW5(), items: mapOf([step('B855', 'refined'), step('B856', 'refined')]), ready: ready('B855', 'B856'), envelopes: [env855({ state: 'dropped' })], now: day2(11, 11), wake: failed })
  assert.deepEqual([after.state, after.why, after.give, after.envelope], [STATES.UNKNOWN, 'could not wake it', null, null])
  // A running worker is never held by an old failed wake of its chat.
  const running = decide({ worker: worker(W5, { since: day2(11, 20) }), items: mapOf([step('B856', 'refined')]), ready: ready('B856'), now: day2(11, 21), wake: failed })
  assert.equal(running.give, 'B856')
})

test('change 4, D.2 and decision 10: the net counts from the "woke" verdict, not the envelope\'s creation', () => {
  const woken = worker(W5, { since: day2(11, 7, 3), state: 'busy' })
  const wake = { state: 'woke', final: false, wokeAt: day2(11, 7, 3), firstTurnEnd: false }
  const taken = env855({ state: 'taken', takenAt: day2(11, 7, 3) })
  // 11:15: 13 minutes after the envelope, 8 after the verdict: no net.
  assert.equal(decide({ worker: woken, items: queuedB855(), envelopes: [taken], now: day2(11, 15), wake }).net, null)
  // 11:17:03: 10 minutes after the verdict: the net.
  const net = decide({ worker: woken, items: queuedB855(), envelopes: [taken], now: day2(11, 17, 3), wake })
  assert.deepEqual([net.state, net.net, net.takeBack?.why], [STATES.UNKNOWN, 'eb4fe8aada155b05', UNANSWERED_WHY])
  // Without a wake the net counts from the envelope, as before.
  assert.equal(decide({ worker: woken, items: queuedB855(), envelopes: [taken], now: day2(11, 12), wake: null }).net, 'eb4fe8aada155b05')
})

test('change 4, the 11:07 case (decision 5): the woken chat\'s first turn end takes nothing back (mutant: the turn counted from the envelope\'s creation)', () => {
  const woken = worker(W5, { since: day2(11, 7, 21) })
  const turn = { kind: 'turn-ended', since: day2(11, 6, 56) }
  const first = { state: 'woke', final: false, wokeAt: day2(11, 7, 3), firstTurnEnd: true }
  // 11:07:21: the envelope is only taken (its line was typed 11:07:22): no take-back.
  const taken = decide({ worker: woken, items: queuedB855(), ready: ready('B856'), envelopes: [env855({ state: 'taken', takenAt: day2(11, 7, 3) })], now: day2(11, 7, 21), event: turn, wake: first })
  assert.deepEqual([taken.takeBack, taken.give], [null, null])
  // Even settled typed, the woken chat's first turn end does not count.
  const typed = env855({ state: 'delivered', takenAt: day2(11, 7, 3), deliveredAt: day2(11, 7, 22), outcome: { cleared: null, set: null, typed: true, restarted: null, background: false, why: null } })
  assert.equal(decide({ worker: woken, items: queuedB855(), envelopes: [typed], now: day2(11, 7, 23), event: turn, wake: first }).takeBack, null)
  // The next turn end (the line's own turn, after the first turn end was seen) counts as before: back, not offered again.
  const later = decide({ worker: woken, items: queuedB855(), ready: ready('B855', 'B856'), envelopes: [typed], now: day2(11, 8, 30), event: { kind: 'turn-ended', since: day2(11, 7, 22) }, wake: { ...first, firstTurnEnd: false } })
  assert.deepEqual(later.takeBack, { id: 'B855', why: NOT_TAKEN_WHY })
  assert.equal(later.give, 'B856')
})

test('4c (Workers mod 0.30.0), the 11:07 case: a turn that ended before the line entered takes nothing back; the line\'s own turn does (mutant: the hand-out time)', () => {
  const woken = worker(W5, { since: day2(11, 7, 21) })
  const times = { typedAt: day2(11, 7, 21), enteredAt: day2(11, 7, 22) }
  const typed = env855({ state: 'delivered', takenAt: day2(11, 7, 3), outcome: { cleared: null, set: null, typed: true, restarted: null, background: false, why: null, ...times } })
  // No wake guard here: the times alone decide. The turn 11:06:56-11:07:21 began after the envelope (11:01:57) but before the
  // line entered (11:07:22): not the line's turn.
  const before = decide({ worker: woken, items: queuedB855(), ready: ready('B856'), envelopes: [typed], now: day2(11, 7, 23), event: { kind: 'turn-ended', since: day2(11, 6, 56) } })
  assert.deepEqual([before.takeBack, before.state], [null, STATES.OFFERED])
  // The turn that began 11:07:22, when the line entered, ended with no take: back, not offered again.
  const own = decide({ worker: woken, items: queuedB855(), ready: ready('B855', 'B856'), envelopes: [typed], now: day2(11, 8, 30), event: { kind: 'turn-ended', since: day2(11, 7, 22) } })
  assert.deepEqual(own.takeBack, { id: 'B855', why: NOT_TAKEN_WHY })
  // An outcome with typedAt only (no enteredAt) counts from typedAt; an older mod's outcome (no times) from the hand-out.
  const typedOnly = env855({ ...typed, outcome: { ...typed.outcome, enteredAt: null } })
  assert.equal(decide({ worker: woken, items: queuedB855(), envelopes: [typedOnly], now: day2(11, 7, 23), event: { kind: 'turn-ended', since: day2(11, 7, 20) } }).takeBack, null)
  const older = env855({ ...typed, outcome: { cleared: null, set: null, typed: true, restarted: null, background: false, why: null } })
  assert.deepEqual(decide({ worker: woken, items: queuedB855(), envelopes: [older], now: day2(11, 7, 23), event: { kind: 'turn-ended', since: day2(11, 6, 56) } }).takeBack?.id, 'B855')
})

test('change 4, decision 5: a turn end while the envelope is only taken (not settled typed) never takes it back, woken or not', () => {
  const lane = worker('Worker 1', { since: day2(11, 14) })
  const items = mapOf([step('B855', 'queued', { Owner: 'Worker 1' })])
  // 93ee0a904d02d2dc: created 11:07:22, taken 11:10:26, typed 11:14:29; a turn that ended 11:12 while it was only taken.
  const envelope = { ...env855({ id: '93ee0a904d02d2dc', to: 'Worker 1', at: day2(11, 7, 22) }), state: 'taken', takenAt: day2(11, 10, 26) }
  const ended = decide({ worker: lane, items, envelopes: [envelope], now: day2(11, 12), event: { kind: 'turn-ended', since: day2(11, 10) } })
  assert.equal(ended.takeBack, null)
  assert.equal(ended.state, STATES.HANDING)
})

test('change 4, D.5 (decision 13) by the orderings alone: a running worker whose net fired takes nothing, the sleeper gets the step (the review of 2026-11-02)', () => {
  const items = mapOf([step('B855', 'refined'), step('B700', 'queued', { Owner: 'Worker 1' })])
  // Worker 1 runs, idle, but its hand-over is UNKNOWN after the net: it gets nothing.
  const netted = { id: 'e0', at: day2(10, 0), to: 'Worker 1', command: HANDOVER_COMMAND, kind: 'task', step: 'B700', clear: null, set: null, line: lineFor('B700'), state: 'dropped', netAt: day2(10, 10) }
  const running = decide({ worker: worker('Worker 1', { since: day2(9, 50) }), items, ready: ready('B855'), envelopes: [netted], now: day2(10, 31) })
  assert.deepEqual([running.state, running.give], [STATES.UNKNOWN, null])
  // The sleeper gets B855 (no rule holds it back for a running worker that would not take it).
  const asleep = decide({ worker: asleepW5(), items, ready: ready('B855'), now: day2(10, 31) })
  assert.deepEqual([asleep.state, asleep.give], [STATES.HANDING, 'B855'])
  // The orderings keep decision 13: match puts running lanes first.
  assert.equal(match({ ready: ready('B855'), idle: [asleepW5(), worker('Worker 2', { since: day2(10, 0) })], items })[0].chat, 'Worker 2')
})

// ---- The lazy clear (Workers mod 0.31.0, the brief .claude/plans/2026-11-03-lazy-clear-brief.md, Task 1 with D1, D4, D6):
// a worker owes its clear and is never held for it. The real case first, then the mutants the brief names.

test('the lazy clear, the real case of 2026-11-02 21:25: Worker 3 after B936 with no task ready is FREE, no envelope and no lane word; B937 given later carries the clear (mutant: a clear-only envelope written)', () => {
  const name = 'Worker 3'
  const reportAt = day2(21, 23)
  const items = mapOf([reported('B936', name, reportAt)])
  const lane = worker(name, { since: day2(21, 25), heard: day2(21, 25) })
  const owed = owedOf(lane, items)
  assert.equal(owed.step, 'B936')
  // Its turn end at 21:25 (where the board wrote the lone clear that failed and held it an hour): FREE, nothing sent.
  const ended = decide({ worker: lane, items, ready: ready(), owed, now: day2(21, 25), event: { kind: 'turn-ended', since: day2(21, 0) } })
  assert.deepEqual([ended.state, ended.envelope, ended.give, ended.takeBack], [STATES.FREE, null, null, null])
  assert.equal(laneWords(ended), null)
  // The passes after it change nothing: the clear stays owed, nothing goes alone.
  for (const now of [day2(21, 26), day2(21, 31), day2(21, 39)]) {
    const pass = decide({ worker: worker(name, { since: day2(21, 25), heard: now }), items, ready: ready(), owed, now })
    assert.deepEqual([pass.state, pass.envelope], [STATES.FREE, null])
  }
  assert.notEqual(owedOf(lane, items), null)
  // B937 becomes ready at 21:40: the pass gives it, the owed clear in the same envelope (clear, then the line).
  const withNext = mapOf([...items.values(), step('B937', 'refined')])
  const given = decide({ worker: worker(name, { since: day2(21, 25), heard: day2(21, 40) }), items: withNext, ready: ready('B937'), owed, now: day2(21, 40) })
  assert.deepEqual([given.state, given.give, given.envelope.kind, given.envelope.clear, given.envelope.line], [STATES.HANDING, 'B937', 'task', { step: 'B936', reportedAt: reportAt }, lineFor('B937')])
})

test('the lazy clear, D4: a clear that did not run while its line was typed is no failure: no HELD, no take-back, the clear still owed, the lane quiet (mutants: HELD on cleared:false; takeBack on a clear failure)', async () => {
  const { failedOf, isClearOwedOnly } = await import('../../src/work/handover.mjs')
  const name = 'Worker 3'
  const reportAt = day2(21, 23)
  const queued = mapOf([reported('B936', name, reportAt), step('B937', 'queued', { Owner: name })])
  const lane = worker(name, { since: day2(21, 40), heard: day2(21, 41) })
  const owed = owedOf(lane, queued)
  const outcome = { cleared: false, set: null, typed: true, restarted: null, background: false, why: null, clearWhy: 'a prompt came first', typedAt: day2(21, 40, 21), enteredAt: day2(21, 40, 22) }
  const envelope = { id: 'e937', at: day2(21, 40), to: name, command: HANDOVER_COMMAND, kind: 'task', step: 'B937', clear: { step: 'B936', reportedAt: reportAt }, restart: false, set: null, line: lineFor('B937'), state: 'delivered', settledAt: day2(21, 40, 22), outcome }
  assert.equal(isClearOwedOnly(envelope), true)
  assert.equal(failedOf(envelope), false)
  // Settled cleared:false, typed:true: offered (the line is in), nothing back, not held.
  const offered = decide({ worker: lane, items: queued, ready: ready(), owed, envelopes: [envelope], now: day2(21, 41) })
  assert.deepEqual([offered.state, offered.takeBack, offered.close, offered.envelope], [STATES.OFFERED, null, null, null])
  assert.equal(laneWords(offered), 'offered B937, not taken yet')
  // It takes B937: WORKING on it, no word on the lane; the clear is still owed (no clear ran) and rides its next task.
  const taken = mapOf([reported('B936', name, reportAt), step('B937', 'in progress', { Owner: name })])
  const working = decide({ worker: worker(name, { since: day2(21, 42), state: 'busy' }), items: taken, ready: ready(), owed, envelopes: [envelope], now: day2(21, 45) })
  assert.deepEqual([working.state, working.step, working.takeBack], [STATES.WORKING, 'B937', null])
  assert.equal(laneWords(working), null)
  assert.equal(owedOf(lane, taken).step, 'B936')
  // A waived line (the wake message carried it, handoverBoard.mjs handOut): nothing to type, so no failure either.
  const waived = { ...envelope, line: null, lineWaived: 'the wake message carried its take line', outcome: { ...outcome, typed: null } }
  assert.equal(failedOf(waived), false)
  // Still a failure: the set (D4 keeps it holding), the line not typed, and a 0.30.0 worker's old-style settle (typed not true).
  const setFailed = { ...envelope, state: 'failed', outcome: { ...outcome, set: false, why: 'the app refused the model' } }
  assert.equal(failedOf(setFailed), true)
  const held = decide({ worker: lane, items: queued, ready: ready(), owed, envelopes: [setFailed], now: day2(21, 41) })
  assert.deepEqual([held.state, held.takeBack?.id], [STATES.HELD, 'B937'])
  assert.equal(failedOf({ ...envelope, state: 'failed', outcome: { ...outcome, typed: false, why: 'the chat did not take it' } }), true)
  const old = { ...envelope, state: 'failed', outcome: { cleared: false, set: null, typed: null, restarted: null, background: false, why: '/clear did not run within two minutes' } }
  assert.equal(failedOf(old), true)
  assert.equal(decide({ worker: lane, items: queued, ready: ready(), owed, envelopes: [old], now: day2(21, 41) }).state, STATES.HELD)
})

test('the lazy clear, D1: the clear stages as the board takes them (one per name, the first kept) and the newest `cleared` stage as the clear the card may not show yet', async () => {
  const { stagesOf, mergeStages } = await import('../../src/work/handover.mjs')
  const { clearedStageOf } = await import('../../src/clearOwed.mjs')
  const T = day2(21, 40)
  assert.deepEqual(stagesOf([
    { stage: 'log-saved', at: T, log: 'logs/B936.md', extra: 1 },
    { stage: 'clear-queued', at: T + 1, ticket: 'clear-3-1' },
    { stage: 'cleared', at: T + 2, session: 'new-session', ticket: 7 },
    { stage: 'clear-refused', at: T + 3, why: '  a prompt\n came first ' },
    { stage: 'compacted', at: T }, { stage: 'cleared', at: 'soon' }, null, 'cleared',
  ]), [
    { stage: 'log-saved', at: T, log: 'logs/B936.md' },
    { stage: 'clear-queued', at: T + 1, ticket: 'clear-3-1' },
    { stage: 'cleared', at: T + 2, session: 'new-session', ticket: '7' },
    { stage: 'clear-refused', at: T + 3, why: 'a prompt came first' },
  ])
  assert.equal(stagesOf('cleared'), null)
  assert.equal(stagesOf([]), null)
  const first = [{ stage: 'log-saved', at: T }]
  // A repeat is ignored (the mod's retry): the first entry stays; a new name is added in arrival order.
  assert.deepEqual(mergeStages(first, [{ stage: 'log-saved', at: T + 9 }, { stage: 'clear-queued', at: T + 1 }]), [{ stage: 'log-saved', at: T }, { stage: 'clear-queued', at: T + 1 }])
  assert.equal(mergeStages(first, [{ stage: 'log-saved', at: T + 9 }]), null)
  assert.deepEqual(mergeStages(undefined, first), first)
  // The newest `cleared` stage over the worker's envelopes; none: null.
  const envelopes = [
    { id: 'a', at: T - 60 * MIN, clear: { step: 'B930' }, stages: [{ stage: 'cleared', at: T - 59 * MIN, session: 's1' }] },
    { id: 'b', at: T, clear: { step: 'B936' }, stages: [{ stage: 'log-saved', at: T }, { stage: 'cleared', at: T + 5_000, session: 's2' }] },
    { id: 'c', at: T + MIN, clear: null },
  ]
  assert.deepEqual(clearedStageOf(envelopes), { at: T + 5_000, step: 'B936', session: 's2' })
  assert.equal(clearedStageOf([envelopes[2]]), null)
  // clearOwed: the stage stands for the clear, the card as the fallback, the newer of the two wins; nothing is written.
  const name = 'Worker 3'
  const items = mapOf([reported('B936', name, day2(21, 23))])
  const lane = worker(name, { since: day2(21, 25), compaction: { lastCleared: { at: day2(20, 0), step: 'B930' } } })
  assert.equal(clearOwed({ lane, items, afterStep: 'clear' }).step, 'B936')
  assert.equal(clearOwed({ lane, items, afterStep: 'clear', clearedStage: clearedStageOf(envelopes) }), null)
  assert.equal(clearOwed({ lane, items, afterStep: 'clear', clearedStage: { at: day2(21, 0), step: 'B930', session: 's1' } }).step, 'B936', 'a stage older than the report clears nothing')
  const card = worker(name, { since: day2(21, 25), compaction: { lastCleared: { at: day2(21, 50), step: 'B936' } } })
  assert.equal(clearOwed({ lane: card, items, afterStep: 'clear', clearedStage: { at: day2(21, 0), step: 'B930' } }), null, 'the card newer than the stage (the person\'s own /clear)')
  // outcomeOf keeps 0.30.0's times and takes clearWhy.
  assert.deepEqual(outcomeOf({ cleared: false, typed: true, clearWhy: ' not run\nin 20 s ', typedAt: 5, enteredAt: 6 }), { cleared: false, set: null, typed: true, restarted: null, background: false, why: null, clearWhy: 'not run in 20 s', typedAt: 5, enteredAt: 6 })
})
