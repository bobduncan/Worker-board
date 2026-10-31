// T8.5 step 4 (the spec .claude/specs/2026-10-31-handover-design.md, "What the Supervisor rules become"): for a worker on
// the hand-over sequence (the setting "sequence" and its Workers mod 0.27.0 or newer: its lane's `onSequence`) the six
// hand-over rules become four, each tied to one step of the sequence: `handover-held` (a worker HELD, its clear, set or
// restart did not run, for over notClearedMinutes of running time, with the mod's why), `handover-unanswered` (the net
// fired, one per envelope), `ready-while-free` read from the hand-over's own FREE, and `review-stuck` without its report
// part (the decision tells the worker at its turn's end). Step 6: not-cleared, not-taking, the clear part of skip-repeats
// and the report part of review-stuck are gone for every worker; a worker not on the sequence is handed nothing, so it is
// never free for ready-while-free, and the new rules never fire for it. Made-up names.

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildView } from '../../src/supervisor/view.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { parseItem } from '../../src/work/item.mjs'
import { stamp } from '../../src/work/migrate.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 31, 21, 0).getTime()
const ago = minutes => NOW - minutes * MIN
const clockOf = minutes => stamp(ago(minutes)).slice(11)

const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, state: 'free', isRunning: true, session: `s-${name}`, ...more })
const LEAD = lane('Lead', { isMain: true, state: 'working' })
const idle = (minutes = 40) => ({ state: 'idle', since: ago(minutes), background: false, at: ago(0) })
/** A worker on the sequence, its hand-over in `state` (the lane's `handover`, state.mjs), its report idle. */
const onIt = (name, state, more = {}) => lane(name, { onSequence: true, mod: '0.27.0', report: idle(), handover: { state, why: null, step: null }, ...more })
/** The same worker on the timers (an older mod or the setting "timers"): no `onSequence`, whatever else its lane carries. */
const onTimers = (name, state, more = {}) => onIt(name, state, { onSequence: false, mod: '0.26.10', ...more })

/** Its envelope in the outbox (src/work/handoverBoard.mjs), failed `minutes` ago with the mod's outcome. */
const failedEnvelope = (to, minutes, more = {}) => ({
  id: `e-${to}-${minutes}`, at: ago(minutes + 1), to, command: 'handover', about: to, kind: 'task', step: 'B13', clear: { step: 'B12', reportedAt: ago(minutes + 2) },
  restart: false, set: null, line: 'work: B13 is yours; run work next', state: 'failed', failedAt: ago(minutes), settledAt: ago(minutes),
  outcome: { cleared: false, set: null, typed: null, restarted: null, background: true, why: 'its conversation could not be saved as a log (Background work it started is still running)' },
  why: 'its clear did not run: its conversation could not be saved as a log (Background work it started is still running)', ...more,
})
const HELD_WHY = 'its clear did not run: its conversation could not be saved as a log (Background work it started is still running)'

const view = (more = {}) => buildView({
  state: { chats: more.chats ?? [LEAD], today: [], limits: more.limits ?? {}, pause: more.pause ?? null, chatPrefix: '', readyList: more.readyList ?? null, gaps: more.gaps ?? [] },
  items: more.items ?? new Map(), outbox: more.outbox ?? [], settings: {}, now: NOW,
})
const check = (id, board, seen = new Map()) => WATCH_RULES.find(one => one.id === id).check(board, { seen, observed: [] })

test('the watch rules: the two of the sequence stand where not-cleared and not-taking stood, report only (mutant: the list not updated)', () => {
  const ids = WATCH_RULES.map(one => one.id)
  assert.deepEqual(ids.slice(ids.indexOf('effort-mismatch'), ids.indexOf('effort-mismatch') + 3), ['effort-mismatch', 'handover-held', 'handover-unanswered'])
  for (const gone of ['not-cleared', 'not-taking']) assert.equal(ids.includes(gone), false, gone)
  for (const id of ['handover-held', 'handover-unanswered']) assert.equal(WATCH_RULES.find(one => one.id === id).kind, 'watch')
})

test('handover-held: a worker on the sequence held 11 min of running time after its clear failed is named once per report, with the mod\'s why', () => {
  const digger = onIt('Digger', 'held', { handover: { state: 'held', why: HELD_WHY, step: 'B13' }, clearOwed: { step: 'B12', reportedAt: ago(13) } })
  const board = (minutes, more = {}) => view({ chats: [LEAD, digger], outbox: [failedEnvelope('Digger', minutes)], ...more })
  const found = check('handover-held', board(11))
  assert.deepEqual(found.map(one => [one.rule, one.key, one.subject]), [['handover-held', 'handover-held Digger B12', 'Digger']])
  assert.equal(found[0].text, `Digger held 11 min: ${HELD_WHY}`)
  assert.match(found[0].evidence, new RegExp(`envelope e-Digger-11 \\(task B13\\) out at ${clockOf(12)}, failed at ${clockOf(11)}: cleared no, background work ran; the Workers mod's why: its conversation could not be saved`))
  assert.match(found[0].evidence, /last report B12; its report now: idle; released by its next turn's end/)
  assert.equal(found[0].since, ago(11))
  assert.equal(found[0].fix, undefined, 'report only')
  // 9 min: not yet.
  assert.deepEqual(check('handover-held', board(9)), [])
  // Running time: the board was off 5 of the 11 minutes.
  assert.deepEqual(check('handover-held', board(11, { gaps: [{ from: ago(8), to: ago(3) }] })), [])
  // Not while the person pauses.
  assert.deepEqual(check('handover-held', board(30, { pause: { state: 'pausing', since: ago(2) } })), [])
  // Released (its lane no longer held): nothing, whatever the outbox still holds.
  assert.deepEqual(check('handover-held', board(30, { chats: [LEAD, onIt('Digger', 'free')] })), [])
})

test('handover-held, mutant "the rule firing for a timers worker": a worker on the timers is never named, whatever its lane and the outbox say', () => {
  const old = onTimers('Digger', 'held', { handover: { state: 'held', why: HELD_WHY, step: 'B13' }, clearOwed: { step: 'B12', reportedAt: ago(40) } })
  assert.deepEqual(check('handover-held', view({ chats: [LEAD, old], outbox: [failedEnvelope('Digger', 30)] })), [])
  // The main chat and a leftover neither.
  const main = { ...onIt('Digger', 'held'), isMain: true }
  assert.deepEqual(check('handover-held', view({ chats: [main], outbox: [failedEnvelope('Digger', 30)] })), [])
})

test('handover-unanswered: the net fired: one finding per envelope, for a day; a timers worker, or an envelope the net did not fire for, none', () => {
  const sent = (id, minutes, netMinutes, more = {}) => ({ id, at: ago(minutes), to: 'Digger', command: 'handover', about: 'Digger', kind: 'task', step: 'B13', clear: null, restart: false, set: null, line: 'work: B13 is yours; run work next', state: 'dropped', ...(netMinutes === null ? {} : { netAt: ago(netMinutes) }), ...more })
  const digger = onIt('Digger', 'unknown', { handover: { state: 'unknown', why: 'did not answer its hand-over (B13)', step: 'B13' } })
  const found = check('handover-unanswered', view({ chats: [LEAD, digger], outbox: [sent('e1', 12, 2), sent('e2', 40, 30, { step: 'B14' }), sent('e3', 5, null)] }))
  assert.deepEqual(found.map(one => [one.rule, one.key, one.subject]), [['handover-unanswered', 'handover-unanswered e2', 'Digger'], ['handover-unanswered', 'handover-unanswered e1', 'Digger']])
  assert.equal(found[1].text, 'Digger did not answer its hand-over (B13) within 10 min; B13 went back on the list')
  assert.match(found[1].evidence, new RegExp(`envelope e1 \\(task\\) out at ${clockOf(12)}, dropped; the net fired at ${clockOf(2)}; its lane now: unknown; its report: idle since ${clockOf(40)}`))
  assert.equal(found[1].since, ago(12))
  // A clear alone (no step): named all the same, without a step.
  assert.equal(check('handover-unanswered', view({ chats: [LEAD, digger], outbox: [sent('e4', 15, 3, { step: null, kind: 'clear', clear: { step: 'B12', reportedAt: ago(20) } })] }))[0].text, 'Digger did not answer its hand-over within 10 min')
  // Over a day after the net: no longer.
  assert.deepEqual(check('handover-unanswered', view({ chats: [LEAD, digger], outbox: [sent('e5', 25 * 60 + 12, 25 * 60)] })), [])
  // Mutant "the rule firing for a timers worker".
  assert.deepEqual(check('handover-unanswered', view({ chats: [LEAD, onTimers('Digger', 'unknown')], outbox: [sent('e1', 12, 2)] })), [])
})

test('ready-while-free reads the hand-over FREE only (R7, X111): held, handing or checking is not free; a worker not on the sequence never is', () => {
  const B5 = parseItem(`Id: B5\nKind: step\nTitle: Step B5\nState: refined\nRefined: ready\nSince: ${stamp(ago(60))}\n`)
  const ready = { ready: [{ id: 'B5', rank: 2, keptFor: null, keptUntil: null, pinned: null }], held: [] }
  const board = chats => view({ chats: [LEAD, ...chats], items: new Map([['B5', B5]]), readyList: ready })
  const seen = new Map([['ready-while-free B5', ago(30)]])
  const found = check('ready-while-free', board([onIt('Digger', 'free')]), seen)
  assert.deepEqual(found.map(one => [one.rule, one.key]), [['ready-while-free', 'ready-while-free B5']])
  assert.equal(found[0].text, 'B5 ready for 30 min while Digger is free')
  assert.match(found[0].evidence, /Digger since \d\d:\d\d \(its hand-over: free\)/)
  // Idle by its report, but its hand-over is not free: no free worker (the old reading would have named it).
  for (const state of ['held', 'handing', 'offered', 'checking', 'unknown', 'restarting', 'suspended', 'working']) {
    assert.deepEqual(check('ready-while-free', board([onIt('Digger', state)]), seen), [], state)
  }
  // A worker not on the sequence (the timers, an older mod) is handed nothing: never free here, whatever its report or lane say.
  assert.deepEqual(check('ready-while-free', board([onTimers('Digger', 'free', { report: { ...idle(), state: 'busy' } })]), seen), [])
  assert.deepEqual(check('ready-while-free', board([onTimers('Digger', 'free')]), seen), [], 'idle by its report, not on the sequence')
})

test('review-stuck: the report part is gone for every worker (the hand-over tells it at its turn end); the result-check part stays', () => {
  const line = (minutes, who, what) => `- ${stamp(ago(minutes))} ${who}: ${what}`
  const failed = owner => parseItem(`Id: B1\nKind: step\nTitle: Step B1\nState: review\nOwner: ${owner}\nSince: ${stamp(ago(80))}\n\n## History\n${[line(75, owner, 'in progress → review'), line(75, 'server', 'check pending'), line(74, 'server', 'check failed: a branch of the step is left')].join('\n')}\n\n## What we build\n- one lamp\n`)
  const board = (owner, chats) => view({ chats: [LEAD, ...chats], items: new Map([['B1', failed(owner)]]) })
  assert.deepEqual(check('review-stuck', board('Digger', [onTimers('Digger', 'free')])), [], 'not on the sequence: no case either')
  assert.deepEqual(check('review-stuck', board('Digger', [onIt('Digger', 'working')])), [])
  // The result-check part is no hand-over: a step whose board check passed an hour ago, with no result check, still counts.
  const passed = parseItem(`Id: B2\nKind: step\nTitle: Step B2\nState: review\nOwner: Digger\nSince: ${stamp(ago(80))}\n\n## History\n${line(75, 'server', 'check passed: merged')}\n\n## What we build\n- one lamp\n`)
  const qa = check('review-stuck', view({ chats: [LEAD, onIt('Digger', 'free')], items: new Map([['B2', passed]]) }), new Map([['review-stuck B2', ago(75)]]))
  assert.equal(qa.length, 1)
  assert.match(qa[0].text, /^B2 in review \d+ min with no result check filed/)
})

test('step 6: the old hand-over rules are gone; the new ones never fire for a worker not on the sequence', () => {
  const owed = { step: 'B12', reportedAt: ago(40), clearedAt: ago(90), why: 'a subagent it started still runs (1)', canClear: true }
  const old = onTimers('Digger', 'held', { clearOwed: owed, handover: { state: 'held', why: HELD_WHY, step: 'B13' } })
  for (const gone of ['not-cleared', 'not-taking']) assert.equal(WATCH_RULES.find(one => one.id === gone), undefined, gone)
  assert.deepEqual(check('handover-held', view({ chats: [LEAD, old], outbox: [failedEnvelope('Digger', 30)] })), [])
})
