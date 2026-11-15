// B1228 (X201): the real case. Worker 5, 2026-11-14 18:19-18:22: the person's answer (Q809) entered at B1218's turn end, before its
// clear; the clear was refused "a new prompt came in before the clear" and its line ("B1221 is yours") was typed at once, waited
// behind that turn in the app's queue and entered first at its end. In that turn the worker had taken B1221 itself (and reported
// it), so the late line was stale, refused the next clear the same way and made it take the next step: three refusals in a row
// (envelopes 3f977e5764320d40, f9ea0e61c85d93de, add3a7d4c6f836ea), and clear-owed-repeat opened X201. Since Workers mod 0.33.0
// such a line waits in the mod (the stage `line-waiting`) until the turn has ended: there the clear is tried again first, and a
// line whose step was taken meanwhile is not typed ("its step was taken already"). These are the board's parts: the net holds
// while the turn runs, "taken already" is no failure, and the replay ends with the second clear run and the rule quiet. The ids
// and times are the live outbox's (data/outbox.jsonl), copied read-only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { clearOwed } from '../../src/clearOwed.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { HANDOVER_COMMAND, NET_MS, STATES, TAKEN_ALREADY_WHY, decide, failedOf, isClearOwedOnly, isLineWaiting, outcomeOf, stagesOf } from '../../src/work/handover.mjs'
import { settle } from '../../src/work/handoverBoard.mjs'
import { parseItem } from '../../src/work/item.mjs'
import { stamp } from '../../src/work/migrate.mjs'

const MIN = 60_000
const NAME = 'Worker 5'
// The live outbox's times.
const A_AT = 1794676761275
const A_REFUSED = 1794676762939
const B_AT = 1794676819686
const REFUSED_WHY = 'a new prompt came in before the clear'

const file = (head, history) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n\n## History\n${history.join('\n')}\n`)
const said = (when, who, words) => `- ${stamp(when)} ${who}: ${words}`
const mapOf = items => new Map(items.map(item => [item.head.get('Id'), item]))
const ready = (...ids) => ids.map(id => ({ id, rank: 2, keptFor: null, keptUntil: null, pinned: null }))
const reported = (id, when) => file({ Id: id, Kind: 'step', Title: `Task ${id}`, State: 'review', Owner: NAME, Since: stamp(when) }, [
  said(when - 5 * MIN, NAME, 'queued → taken'), said(when, NAME, 'in progress → review'), said(when, 'server', 'check passed'),
])
const queued = (id, when) => file({ Id: id, Kind: 'step', Title: `Task ${id}`, State: 'queued', Owner: NAME, Since: stamp(when), Refined: 'ready' }, [
  said(when, 'server', `refined → queued (given by the board to ${NAME})`),
])
const refined = id => file({ Id: id, Kind: 'step', Title: `Task ${id}`, State: 'refined', Since: stamp(A_AT), Refined: 'ready' }, [said(A_AT - 10 * MIN, 'Advisor', 'refined is ready')])
const lane = report => ({ name: NAME, state: 'free', isMain: false, isLeftover: false, isRunning: true, mod: '0.33.0', model: 'claude-sonnet-5-5', report })

/** Envelope A as the outbox held it after its clear was refused: taken, no outcome; with the 0.33.0 mod also `line-waiting`. */
const envelopeA = (waiting = true) => ({
  id: '3f977e5764320d40', at: A_AT, to: NAME, command: HANDOVER_COMMAND, kind: 'task', step: 'B1221', clear: { step: 'B1218', reportedAt: 1794676740000 },
  restart: false, set: null, line: 'work: B1221 is yours; run work next', back: null, state: 'taken', takenAt: 1794676761666,
  stages: stagesOf([{ stage: 'clear-refused', at: A_REFUSED, why: REFUSED_WHY }, ...(waiting ? [{ stage: 'line-waiting', at: A_REFUSED, why: REFUSED_WHY }] : [])]),
})
/** The outcome the 0.33.0 mod settles it with at the turn's end in which the worker took B1221 itself. */
const STALE = outcomeOf({ cleared: false, set: null, typed: null, restarted: null, background: false, why: TAKEN_ALREADY_WHY, clearWhy: REFUSED_WHY })

test('B1228, the real case: while the line waits for the turn the person\'s answer started, the net holds; once the chat is idle it counts from then (mutant: the net counting from the envelope)', () => {
  const items = mapOf([reported('B1218', 1794676740000), queued('B1221', A_AT), refined('B1223')])
  const at = (now, report) => decide({ worker: lane(report), items, ready: ready('B1223'), envelopes: [envelopeA()], now })
  assert.equal(isLineWaiting(envelopeA()), true)
  // 12 minutes into the answer's turn: no net, no take-back, nothing new.
  const busy = at(A_AT + 12 * MIN, { state: 'busy', since: A_REFUSED, background: false, at: A_AT + 12 * MIN })
  assert.deepEqual([busy.state, busy.step, busy.takeBack, busy.net, busy.envelope], [STATES.HANDING, 'B1221', null, null, null])
  // A question to the person in that turn holds it too.
  assert.equal(at(A_AT + 12 * MIN, { state: 'asking', since: A_REFUSED, background: false, at: A_AT + 12 * MIN }).state, STATES.HANDING)
  // Idle since 6 min (the turn's end did not settle it, a new process lost the line): the net counts from the idle.
  const idleSince = A_AT + 6 * MIN
  assert.equal(at(A_AT + 12 * MIN, { state: 'idle', since: idleSince, background: false, at: A_AT + 12 * MIN }).state, STATES.HANDING)
  const late = at(idleSince + NET_MS, { state: 'idle', since: idleSince, background: false, at: idleSince + NET_MS })
  assert.deepEqual([late.state, late.takeBack?.id, late.net], [STATES.UNKNOWN, 'B1221', '3f977e5764320d40'])
  // A chat that does not run: the net as before, from the idle it left.
  assert.equal(decide({ worker: { ...lane({ state: 'busy', since: A_REFUSED, background: false, at: A_REFUSED }), isRunning: false }, items, ready: ready('B1223'), envelopes: [envelopeA()], now: A_REFUSED + NET_MS }).state, STATES.UNKNOWN)
  // Unchanged for an envelope without the stage (a 0.32.0 mod): the net from the envelope, also while busy.
  const old = decide({ worker: lane({ state: 'busy', since: A_REFUSED, background: false, at: A_AT + NET_MS }), items, ready: ready('B1223'), envelopes: [envelopeA(false)], now: A_AT + NET_MS })
  assert.equal(old.state, STATES.UNKNOWN)
})

test('B1228, the real case: the line not typed as its step was taken already is no failure: delivered, no HELD, no take-back; the turn\'s end gives B1223 with the clear after B1221 (mutant: "taken already" read as failed)', async () => {
  const settled = { ...envelopeA(), outcome: STALE }
  assert.equal(isClearOwedOnly(envelopeA(), STALE), true)
  assert.equal(failedOf(settled), false)
  // The board's settle route: delivered, never failed.
  const lines = [envelopeA()]
  const outbox = { outbox: () => lines, update: async (id, fields) => { const at = lines.findIndex(one => one.id === id); lines[at] = { ...lines[at], ...fields } } }
  assert.equal(await settle(outbox, NAME, '3f977e5764320d40', STALE, A_AT + 59_000), true)
  assert.deepEqual([lines[0].state, lines[0].why], ['delivered', undefined])
  // Only for a task's line: a typed false still fails; the words alone on a lone clear do not count.
  assert.equal(failedOf({ ...envelopeA(), outcome: { ...STALE, typed: false } }), true)
  assert.equal(isClearOwedOnly({ ...envelopeA(), step: null }, STALE), false)
  // The turn's end of 18:20:19: B1221 taken and reported in it; the clear owed after it rides B1223's envelope.
  const items = mapOf([reported('B1218', 1794676740000), reported('B1221', 1794676800000), refined('B1223')])
  const worker = lane({ state: 'idle', since: B_AT, background: false, at: B_AT })
  const owed = clearOwed({ lane: worker, items, afterStep: 'clear' })
  const next = decide({ worker, items, ready: ready('B1223'), owed, envelopes: [lines[0]], now: B_AT, event: { kind: 'turn-ended', since: A_REFUSED } })
  assert.deepEqual([next.state, next.give, next.takeBack, next.envelope?.clear?.step], [STATES.HANDING, 'B1223', null, 'B1221'])
  // While it still holds B1221 (taken, not reported): it works on it, nothing taken back.
  const holding = mapOf([reported('B1218', 1794676740000), file({ Id: 'B1221', Kind: 'step', Title: 'Task B1221', State: 'in progress', Owner: NAME, Since: stamp(B_AT) }, [said(B_AT, NAME, 'queued → taken')])])
  const works = decide({ worker, items: holding, ready: ready('B1223'), envelopes: [lines[0]], now: B_AT })
  assert.deepEqual([works.state, works.takeBack], [STATES.WORKING, null])
})

test('B1228, the real case replayed for clear-owed-repeat: the three refusals of 18:20-18:22 open it; with the 0.33.0 order (the first refused, its line not typed, the second clear run) it stays quiet', () => {
  const NOW = 1794677480344
  const view = outbox => buildView({
    state: { chats: [{ name: 'Main', isMain: true, isLeftover: false, state: 'working', isRunning: true }, { name: NAME, isMain: false, isLeftover: false, state: 'working', isRunning: true, onSequence: true, mod: '0.33.0', report: { state: 'busy', since: NOW - MIN, background: false, at: NOW }, handover: { state: 'working', why: null, step: 'B1217' }, clearOwed: { step: 'B1224', reportedAt: 1794676920000 } }], today: [], limits: {}, pause: null, chatPrefix: '', readyList: null, gaps: [], wakes: {} },
    items: new Map(), outbox, settings: {}, now: NOW,
  })
  const check = outbox => WATCH_RULES.find(one => one.id === 'clear-owed-repeat').check(view(outbox), { seen: new Map(), observed: [] })
  const typedAnyway = (id, at, step, after, settledAt) => ({
    id, at, to: NAME, command: HANDOVER_COMMAND, kind: 'task', step, clear: { step: after, reportedAt: at - 20_000 }, restart: false, set: null, line: `work: ${step} is yours; run work next`,
    state: 'delivered', deliveredAt: settledAt, settledAt, outcome: outcomeOf({ cleared: false, set: null, typed: true, restarted: null, background: false, clearWhy: REFUSED_WHY }),
  })
  const before = [
    typedAnyway('3f977e5764320d40', A_AT, 'B1221', 'B1218', 1794676823437),
    typedAnyway('f9ea0e61c85d93de', B_AT, 'B1223', 'B1221', 1794676866547),
    typedAnyway('add3a7d4c6f836ea', 1794676863749, 'B1224', 'B1223', 1794676941647),
  ]
  assert.deepEqual(check(before).map(one => one.key), [`clear-owed-repeat ${NAME}`])
  // 0.33.0: A settled "taken already" at the turn's end of 18:20:19, then B's clear runs in that idle.
  const after = [
    { ...envelopeA(), state: 'delivered', deliveredAt: B_AT + 1000, settledAt: B_AT + 1000, outcome: STALE },
    { ...before[1], outcome: outcomeOf({ cleared: true, set: null, typed: true, restarted: null, background: false }) },
  ]
  assert.deepEqual(check(after), [])
  // Even a third refusal after it is no run of three.
  assert.deepEqual(check([...after, before[2]]), [])
})
