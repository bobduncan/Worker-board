// B742 (X95, X96): the person's rule stops all work at 98% of the weekly limit (2026-10-19), but the board counted the
// week full only at 100%. At 98% on 2026-10-27 it handed B738 to Worker 4 (which rightly did not take it) and Workers 2, 3
// and 5 worked on with no word. The week now counts full from the stop line (config `weekStopAt`, 98); the 5-hour limit stays
// at 100. Each working worker is told once (say.mjs `weekStopDue`); a watch rule opens one incident when none obeys.
// Made-up limits and chats only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { messageText } from '../src/bridge.mjs'
import { parseConfig } from '../src/config.mjs'
import { limitsOf } from '../src/limits.mjs'
import { weekStopDue } from '../src/say.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { WATCH_RULES } from '../src/supervisor/rules/watch.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 27, 22, 40).getTime()
const RESET = new Date(2026, 9, 29, 8, 0).getTime()

/** The limits as the board reads them: the app's sample for both windows, the week with a known reset. */
const limits = (week, fiveHour = 40, more = {}) => limitsOf({
  sample: { at: NOW - 2 * MIN, fiveHour, week }, readings: [{ at: NOW - 2 * MIN, fiveHour: null, week: { used: week, resetsAt: RESET } }], stops: [], now: NOW, ...more,
})

test('the week counts full from the stop line: 97 warns, 98 is full, 100 is full; the 5-hour limit has its own line (B758: 95, see fiveHourStop.test.mjs)', () => {
  assert.equal(limits(97).week.level, 'warn')
  assert.equal(limits(98).week.level, 'full')
  assert.equal(limits(98).week.stopAt, 98)
  assert.equal(limits(100).week.level, 'full')
  assert.equal(limits(10, 94).fiveHour.level, 'warn')
  assert.equal(limits(10, 95).fiveHour.level, 'full')
  assert.equal(limits(10, 100).fiveHour.level, 'full')
})

test('the stop line comes from the config; a missing or wrong setting reads 98', () => {
  assert.equal(limits(95, 40, { weekStopAt: 95 }).week.level, 'full')
  assert.equal(limits(97, 40, { weekStopAt: 99 }).week.level, 'warn')
  assert.equal(parseConfig('{}', {}).weekStopAt, 98)
  assert.equal(parseConfig('{"weekStopAt":95}', {}).weekStopAt, 95)
  assert.equal(parseConfig('{"weekStopAt":"x"}', {}).weekStopAt, 98)
  // Left out of limitsOf's call, the line is 98 as well.
  assert.equal(limitsOf({ sample: { at: NOW - MIN, fiveHour: 10, week: 98 }, now: NOW }).week.level, 'full')
})

test('the week back under the line after its reset reads ok again', () => {
  const after = limitsOf({ sample: null, readings: [{ at: NOW - 3 * MIN, fiveHour: null, week: { used: 98, resetsAt: NOW - MIN } }], stops: [], now: NOW })
  assert.equal(after.week.level, 'ok')
  assert.equal(limits(40).week.level, 'ok')
})

// B771: a working worker holds a step not yet reported (in progress), as the store says (`storeSteps`).
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, state: 'working', isRunning: true, storeSteps: [{ id: 'B1', title: 'A step', state: 'in progress' }], ...more })
const board = (week, chats, more = {}) => ({ restart: { main: 'Main' }, chats: [{ name: 'Main', isMain: true, state: 'working' }, ...chats], limits: limits(week), pause: { state: 'running', since: NOW - 5 * 60 * MIN }, ...more })
const THREE = [lane('Worker 2'), lane('Worker 3'), lane('Worker 5')]

test('tonight\'s case: the week at 98 → one word to each of Workers 2, 3 and 5, in the board\'s own voice', () => {
  const words = weekStopDue(board(98, [...THREE, lane('Worker 4', { state: 'free' })]), [])
  assert.deepEqual(words.map(one => one.to), ['Worker 2', 'Worker 3', 'Worker 5'])
  assert.ok(words.every(one => one.command === 'week-stop'))
  assert.equal(words[0].text, 'The weekly limit reached the stop line (98%): bring your work to a safe point (commit, checkpoint), then send the paused note')
  assert.equal(messageText(words[0], () => '22:40'), words[0].text)
})

test('at 97 nothing is said; the 5-hour limit at 98 says nothing', () => {
  assert.deepEqual(weekStopDue(board(97, THREE), []), [])
  assert.deepEqual(weekStopDue({ ...board(40, THREE), limits: limits(40, 98) }, []), [])
})

test('the word is given once for each week: not again whatever became of it; a worker suspended, free, off or not running gets none; a pause holds it back', () => {
  const [first] = weekStopDue(board(98, [lane('Worker 2')]), [])
  for (const state of ['waiting', 'taken', 'expired']) assert.deepEqual(weekStopDue(board(98, [lane('Worker 2')]), [{ ...first, state }]), [])
  // Another worker is still told; the next week is another stop.
  assert.deepEqual(weekStopDue(board(98, [lane('Worker 2'), lane('Worker 3')]), [first]).map(one => one.to), ['Worker 3'])
  assert.equal(weekStopDue(board(98, [lane('Worker 2')]), [{ ...first, weekResets: RESET - 7 * 24 * 60 * MIN }]).length, 1)
  assert.deepEqual(weekStopDue(board(98, [lane('Worker 2', { state: 'suspended' }), lane('Worker 3', { state: 'free' }), lane('Worker 4', { state: 'off' }), lane('Worker 5', { isRunning: false })]), []), [])
  assert.deepEqual(weekStopDue(board(98, THREE, { pause: { state: 'pausing', since: NOW - MIN } }), []), [])
})

test('B771 (X98): the word goes only to a worker that holds a step not yet reported: taken or in progress get it; a step in review, none, or a step waiting on the person get none', () => {
  const held = state => lane('Worker 2', { storeSteps: [{ id: 'B742', title: 'A step', state }] })
  for (const state of ['taken', 'in progress']) assert.deepEqual(weekStopDue(board(98, [held(state)]), []).map(one => one.to), ['Worker 2'], state)
  // Worker 2 reported B742 and its turn runs on (the lane still reads working): the hand-out holds already; a word now starts a turn before its clear.
  for (const state of ['review', 'waiting on you', 'done']) assert.deepEqual(weekStopDue(board(98, [held(state)]), []), [], state)
  assert.deepEqual(weekStopDue(board(98, [lane('Worker 2', { storeSteps: [] }), lane('Worker 3', { storeSteps: undefined })]), []), [])
  // Its report failed the board's check: handed back, it stays in its turn to fix the step, so it holds it (it gets the word).
  const back = lane('Worker 2', { storeSteps: [{ id: 'B742', state: 'review' }] })
  assert.deepEqual(weekStopDue({ ...board(98, [back, lane('Worker 3', { storeSteps: [{ id: 'B743', state: 'review' }] })]), reconciled: { handedBack: ['Worker 2'] } }, []).map(one => one.to), ['Worker 2'])
  // One in review beside one still open: it holds a step.
  assert.equal(weekStopDue(board(98, [lane('Worker 2', { storeSteps: [{ id: 'B1', state: 'review' }, { id: 'B2', state: 'taken' }] })]), []).length, 1)
})

const lanesOf = chats => [{ name: 'Main', isMain: true, state: 'working' }, ...chats]
const viewOf = (week, chats, outbox, now = NOW, more = {}) => buildView({
  state: { chats: lanesOf(chats), today: [], limits: limits(week), pause: more.pause ?? null, chatPrefix: '' }, items: new Map(), outbox, settings: {}, now,
})
const rule = WATCH_RULES.find(one => one.id === 'week-stop-ignored')
// B984 (X138): a word counts from its delivery, of this week's reset only.
let nextWord = 1
const wordAt = (to, minutesAgo, more = {}) => ({ id: `W${nextWord++}`, to, command: 'week-stop', at: NOW - (minutesAgo + 10) * MIN, deliveredAt: NOW - minutesAgo * MIN, state: 'delivered', weekResets: RESET, ...more })
const run = (board, seen = new Map()) => rule.check(board, { seen, observed: [] })

test('week-stop-ignored: delivered 21 min ago and still working → one incident each, naming the worker; 19 min → none (B984: 20 min from delivery)', () => {
  const found = run(viewOf(98, THREE, THREE.map(one => wordAt(one.name, 21))))
  assert.equal(found.length, 3)
  assert.match(found[0].key, /^week-stop-ignored Worker 2 W\d+$/)
  assert.match(found[0].text, /Worker 2 still works 21 min after the board's word/)
  assert.match(found[0].evidence, /reached Worker 2 at 22:19, 21 min ago/)
  assert.deepEqual(run(viewOf(98, THREE, THREE.map(one => wordAt(one.name, 19)))), [])
})

test('week-stop-ignored: a word of an older week, a word taken but never delivered, and one without a delivery time are no case', () => {
  const old = wordAt('Worker 4', 40, { weekResets: RESET - 7 * 24 * 60 * MIN })
  assert.deepEqual(run(viewOf(98, [lane('Worker 4')], [old])), [])
  for (const state of ['taken', 'waiting', 'expired', 'failed']) assert.deepEqual(run(viewOf(98, [lane('Worker 4')], [wordAt('Worker 4', 40, { state })])), [], state)
  assert.deepEqual(run(viewOf(98, [lane('Worker 4')], [wordAt('Worker 4', 40, { deliveredAt: undefined })])), [])
})

test('week-stop-ignored: X138 replayed: the expired word of the week before never times the new word; the new one, delivered 10:13, is quiet to 10:40', () => {
  const stale = wordAt('Worker 4', 0, { id: 'OLD', at: NOW - 12 * 60 * MIN, deliveredAt: NOW - 12 * 60 * MIN + MIN, state: 'expired', weekResets: RESET - 7 * 24 * 60 * MIN })
  const fresh = at => wordAt('Worker 4', (NOW - at) / MIN, { id: 'NEW' })
  const seen = new Map([['week-stop-ignored Worker 4 OLD', NOW - 15 * MIN], ['week-stop-ignored Worker 4', NOW - 15 * MIN]])
  for (let minute = 0; minute <= 18; minute += 3) {
    const now = NOW + minute * MIN
    assert.deepEqual(rule.check(viewOf(98, [lane('Worker 4')], [stale, fresh(NOW)], now), { seen, observed: [] }), [], `${minute} min after delivery`)
  }
  assert.equal(rule.check(viewOf(98, [lane('Worker 4')], [stale, fresh(NOW)], NOW + 21 * MIN), { seen, observed: [] }).length, 1)
})

test('week-stop-ignored: the newest delivered word of the week counts, a key for each word', () => {
  const first = wordAt('Worker 2', 60, { id: 'A' })
  const second = wordAt('Worker 2', 5, { id: 'B' })
  assert.deepEqual(run(viewOf(98, [lane('Worker 2')], [first, second])), [])
  assert.match(run(viewOf(98, [lane('Worker 2')], [first]))[0].key, / A$/)
})

test('week-stop-ignored: Worker 3 suspended while Worker 5 works 21 min → one incident naming Worker 5', () => {
  const found = run(viewOf(98, [lane('Worker 3', { state: 'suspended', suspended: { limit: 'week' } }), lane('Worker 5')], [wordAt('Worker 3', 30), wordAt('Worker 5', 21)]))
  assert.equal(found.length, 1)
  assert.equal(found[0].subject, 'Worker 5')
})

test('week-stop-ignored: quiet when the week is under the line, nobody works, an idle lane, no word was given or the person pauses', () => {
  const outbox = THREE.map(one => wordAt(one.name, 30))
  assert.deepEqual(run(viewOf(97, THREE, outbox)), [])
  assert.deepEqual(run(viewOf(98, THREE.map(one => ({ ...one, state: 'free' })), outbox)), [])
  assert.deepEqual(run(viewOf(98, [lane('Worker 2', { state: 'suspended', suspended: { limit: 'week' } })], outbox)), [])
  assert.deepEqual(run(viewOf(98, THREE, [])), [])
  assert.deepEqual(run(viewOf(98, THREE, outbox, NOW, { pause: { state: 'pausing', since: NOW - MIN } })), [])
  // The person's pause ended 5 min ago: the chats stood still before, so only 5 min count.
  assert.deepEqual(run(viewOf(98, THREE, outbox, NOW, { pause: { state: 'running', since: NOW - 5 * MIN } })), [])
})

// The hand-out holds at the stop line through the state's one level (the week's level full → state.mjs limitsFull → reconcile's handOutHeld).
import { buildState } from './withStore.mjs'

const usage = (at, fiveHour, week) => `{"version":2,"samples":[{"t":${at},"org":"org-1","u":{"fh":${fiveHour},"sd":${week}}}]}`
const stateAt = (week, config = {}) => buildState({ listText: '{}', appChatTexts: [], tails: {}, planLineTexts: {}, usageText: usage(NOW - MIN, 10, week) }, { now: NOW, config: { ...parseConfig('{}', {}), project: 'P', ...config } })

test('the state holds the hand-out at 98 of the week (B738 to Worker 4), and hands out at 97; the setting moves the line', () => {
  assert.equal(stateAt(98).limits.week.level, 'full')
  assert.equal(stateAt(97).limits.week.level, 'warn')
  assert.equal(stateAt(95, { weekStopAt: 95 }).limits.week.level, 'full')
  assert.equal(stateAt(98, { weekStopAt: 100 }).limits.week.level, 'warn')
})
