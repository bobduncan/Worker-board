// B1294 (X109 came back at 2026-11-21 00:51, seen 80 times): the board's "go on" line to Worker 4 for B1293, written at 00:39:56,
// waited while Worker 4's chat hung (its last tool call 00:33:55, the app down; launches at 00:42 and 00:51 did not start it). The
// board's own cure for such a line is the give-back 15 minutes after it: B1293 went back at 00:55:01 and the sweep closed the line.
// Rule 8 named it at 00:51 after its plain 10 minutes, four minutes before that cure: a "go on" line waits for its give-back plus
// the limit; every other word keeps the plain limit (a step's hand-over to a free worker is still named after 10 minutes).

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildView } from '../src/supervisor/view.mjs'
import { WATCH_RULES, undeliveredWords } from '../src/supervisor/rules/watch.mjs'
import { GIVE_BACK_MINUTES, goOnWaitMs, isGoOnWord } from '../src/work/holderTimers.mjs'

const MIN = 60_000
const AT = 1795217996481 // 2026-11-21 00:39:56, the "go on" line
const keep = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN }
const LINE = 'go on with B1293 from your checkpoint: branch b1293-bat-smaller, commit none, next: judges in motion 74/74/68 (middle 74, first round 72/68/61); strips cut in with per-sheet size fix; run npm test (logs/b1293-test1.log queued), re-pin hashes/screens, gate, merge main, merge, report'

/** The live word of outbox.jsonl, as the board wrote it before B1294 (no `giveBackMs`). */
const OLD = Object.freeze({
  id: '856613314d45e54f', at: AT, to: 'Worker 4', ask: null, step: null, title: null, version: null, verdict: null, command: 'handover', about: 'Worker 4',
  text: `hand-over\nLine: ${LINE}`, state: 'waiting', kind: 'resume', clear: null, restart: false, set: null, line: LINE, back: null, resume: 'resume B1293 1795217695771',
})
/** The same line as the board writes it now. */
const GO_ON = Object.freeze({ ...OLD, giveBackMs: GIVE_BACK_MINUTES * MIN })
/** A step's hand-over to a free worker (kind task): unchanged by B1294. */
const TASK = Object.freeze({ ...OLD, id: 'task-word', text: 'hand-over\nLine: work: B1300 is yours; run work next', kind: 'task', step: 'B1300', line: 'work: B1300 is yours; run work next', resume: undefined })

// Worker 4 at 00:51:08: interrupted, its chat not running, no wake attempt yet in its spell (the spell began anew at 00:45:05).
const WORKER4 = { name: 'Worker 4', isMain: false, isLeftover: false, isRunning: false, state: 'interrupted', report: { state: 'busy', at: AT - 6 * MIN, since: AT - 6 * MIN } }
const board = (gaps = []) => ({ gaps, restart: { main: 'Main' }, pause: { state: 'running', since: AT - 60 * MIN }, chats: [{ name: 'Main', isMain: true, isLeftover: false, isRunning: true, state: 'working' }, WORKER4] })
const item = (id, state, owner) => [id, { head: new Map([['Id', id], ['Kind', 'step'], ['State', state], ['Owner', owner]]) }]
const held = new Map([item('B1293', 'in progress', 'Worker 4')])
const givenBack = new Map([item('B1293', 'refined', '-')])
const view = (outbox, now, items = held, gaps = []) => buildView({ state: board(gaps), items, outbox, keep, settings: {}, now })
const named = (outbox, now, items, gaps) => undeliveredWords(view(outbox, now, items, gaps)).map(one => one.id)
const rule = WATCH_RULES.find(one => one.id === 'undelivered')

test('a "go on" line is told apart from every other hand-over, and waits its give-back\'s minutes (the default for an older line)', () => {
  assert.equal(isGoOnWord(GO_ON), true)
  assert.equal(isGoOnWord(OLD), true)
  assert.equal(isGoOnWord(TASK), false)
  assert.equal(isGoOnWord({ ...GO_ON, command: 'work' }), false)
  assert.equal(goOnWaitMs(GO_ON), 15 * MIN)
  assert.equal(goOnWaitMs(OLD), 15 * MIN, 'an older line without the field: the default')
  assert.equal(goOnWaitMs({ ...GO_ON, giveBackMs: 30 * MIN }), 30 * MIN)
  assert.equal(goOnWaitMs({ ...GO_ON, giveBackMs: 0 }), 15 * MIN)
})

test('X109 at 00:51:08: the "go on" line of 00:39:56 is not named while Worker 4 still holds B1293 and its give-back is not due', () => {
  const at0051 = AT + 11 * MIN + 12_000
  assert.deepEqual(rule.check(view([{ ...GO_ON }], at0051)), [], 'mutant: the plain 10 min for a go-on line')
  assert.deepEqual(named([{ ...OLD }], at0051), [], 'the live word, written before B1294, too')
  // At 00:55:01 the give-back moved B1293 back: the sweep drops the line, so rule 8 never names it, however late.
  assert.deepEqual(named([{ ...GO_ON }], AT + 30 * MIN, givenBack), [])
})

test('a give-back that never comes: the line is named once its give-back and the limit passed (25 min), never before', () => {
  assert.deepEqual(named([{ ...GO_ON }], AT + 24 * MIN), [])
  const late = rule.check(view([{ ...GO_ON }], AT + 25 * MIN + 1_000))
  assert.equal(late.length, 1)
  assert.equal(late[0].key, 'undelivered Worker 4')
  assert.equal(late[0].text, '1 word to Worker 4 not delivered, the oldest for 25 min')
  assert.match(late[0].evidence, /^\d\d:\d\d handover Worker 4 \(waiting\)$/)
})

test('the give-back\'s own minutes count: a 30 min give-back is named after 40 min, not at 35', () => {
  const slow = { ...GO_ON, giveBackMs: 30 * MIN }
  assert.deepEqual(named([slow], AT + 35 * MIN), [])
  assert.deepEqual(named([slow], AT + 40 * MIN + 1_000), [slow.id])
})

test('every other word keeps the plain limit: a step\'s hand-over to a free worker is still named after 11 min', () => {
  const tasks = new Map([...held, item('B1300', 'queued', 'Worker 4')])
  assert.deepEqual(named([{ ...TASK }], AT + 11 * MIN, tasks), ['task-word'])
  // Beside a waiting go-on line, only the task word is named.
  assert.deepEqual(named([{ ...GO_ON }, { ...TASK }], AT + 11 * MIN, tasks), ['task-word'])
})

test('review 1: the board off while the line waits (a stop or PC sleep) does not count, as for the give-back (mutant: wall time)', () => {
  // The verifier's probe: the board off from 3 to 33 min after the line; the give-back comes at 15 min of running time (46 min).
  const off = [{ from: AT + 3 * MIN, to: AT + 33 * MIN }]
  assert.deepEqual(named([{ ...GO_ON }], AT + 34 * MIN, held, off), [])
  assert.deepEqual(named([{ ...GO_ON }], AT + 44 * MIN, held, off), [])
  assert.deepEqual(named([{ ...GO_ON }], AT + 54 * MIN, held, off), [], '24 min of running time')
  assert.deepEqual(named([{ ...GO_ON }], AT + 55 * MIN + 1_000, held, off), [GO_ON.id], 'a give-back that never came: 25 min of running time')
  // Every other word keeps its wall time.
  const tasks = new Map([...held, item('B1300', 'queued', 'Worker 4')])
  assert.deepEqual(named([{ ...TASK }], AT + 34 * MIN, tasks, off), ['task-word'])
})
