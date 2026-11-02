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

test('a free worker with no task: the clear alone; nothing at all when none is owed; the clear envelope is waited for, not sent twice', () => {
  const name = 'Worker 1'
  const items = mapOf([reported('B50', name, at(29, 9, 0))])
  const lane = worker(name, { since: at(29, 9, 1) })
  const owed = owedOf(lane, items)
  const clear = decide({ worker: lane, items, owed, now: at(29, 9, 1), event: { kind: 'turn-ended', since: at(29, 8, 30) } })
  assert.deepEqual([clear.state, clear.envelope.kind, clear.envelope.clear.step, clear.give], [STATES.FREE, 'clear', 'B50', null])
  const out = { id: 'c1', at: at(29, 9, 1), to: name, command: HANDOVER_COMMAND, state: 'taken', ...clear.envelope }
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
  assert.deepEqual(outcomeOf({ cleared: true, set: 'yes', typed: true, why: '  ok\n then ' }), { cleared: true, set: null, typed: true, restarted: null, background: false, why: 'ok then' })
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

test('change 4, decision 5: a turn end while the envelope is only taken (not settled typed) never takes it back, woken or not', () => {
  const lane = worker('Worker 1', { since: day2(11, 14) })
  const items = mapOf([step('B855', 'queued', { Owner: 'Worker 1' })])
  // 93ee0a904d02d2dc: created 11:07:22, taken 11:10:26, typed 11:14:29; a turn that ended 11:12 while it was only taken.
  const envelope = { ...env855({ id: '93ee0a904d02d2dc', to: 'Worker 1', at: day2(11, 7, 22) }), state: 'taken', takenAt: day2(11, 10, 26) }
  const ended = decide({ worker: lane, items, envelopes: [envelope], now: day2(11, 12), event: { kind: 'turn-ended', since: day2(11, 10) } })
  assert.equal(ended.takeBack, null)
  assert.equal(ended.state, STATES.HANDING)
})

test('change 4, D.5 (decision 13): an asleep worker gets nothing at a pass while a running free worker would take the task (mutant: the sleeper picked)', () => {
  const running = worker('Worker 1', { since: day2(10, 0) })
  const items = mapOf([step('B855', 'refined')])
  const asleep = decide({ worker: asleepW5(), items, ready: ready('B855'), now: day2(10, 31), runningFree: [running] })
  assert.deepEqual([asleep.state, asleep.why, asleep.give, asleep.envelope], [STATES.FREE, 'a running worker is free', null, null])
  // No running worker free: the sleeper gets it (its envelope is the wake's need).
  assert.equal(decide({ worker: asleepW5(), items, ready: ready('B855'), now: day2(10, 31), runningFree: [] }).give, 'B855')
  // A running free worker that may not take it (pinned to the sleeper) holds nobody back.
  const pinned = [{ id: 'B855', rank: 2, keptFor: W5, keptUntil: null, pinned: W5 }]
  assert.equal(decide({ worker: asleepW5(), items, ready: pinned, now: day2(10, 31), runningFree: [running] }).give, 'B855')
  // match prefers running lanes over asleep ones.
  assert.equal(match({ ready: ready('B855'), idle: [asleepW5(), running], items })[0].chat, 'Worker 1')
})
