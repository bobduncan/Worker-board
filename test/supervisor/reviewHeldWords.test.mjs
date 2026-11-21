// B1295, the fix of X209 (it fired 15 times, closed once as no fault and came back): a step in review (B1159) behind its fix
// (B1288, the focus goal's), which the partner held in words on purpose ("waits for: the person's pick on the rethink ...", then
// "the smaller, leaner Bat landing first ..."), read as stuck every hour. A hold in words on a fix of the focus goal (or a goal
// under it) is a wait on purpose: the rule none-ready already takes it to the partner and Main whenever a worker is free, so
// review-held says nothing. Outside the focus, and for any other hold (a block, ...), review-held fires as before. The health
// summary still counts the chain as held. The live shape, with made-up words; no word names a project.

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildView } from '../../src/supervisor/view.mjs'
import { healthSummary } from '../../src/supervisor/health.mjs'
import { WATCH_RULES, reviewLateOf } from '../../src/supervisor/rules/watch.mjs'
import { reviewWaitOf } from '../../src/work/resultCheck.mjs'
import { stamp } from '../../src/work/migrate.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 21, 10, 0).getTime()
const ago = minutes => NOW - minutes * MIN

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const passed = minutes => `- ${stamp(ago(minutes))} server: check passed: merged`
const failed = (minutes, fix) => `- ${stamp(ago(minutes))} Checker: result check failed: 5 of 7 points pass; fix ${fix} for Painter`

/** B1159 in review, its result check failed and made B1288; B1288 refined and ready, of `goal`. */
const store = goal => items(
  item({ Id: 'B1159', Kind: 'step', Title: 'Step B1159', State: 'review', Owner: 'Painter', Since: stamp(ago(600)), Goal: goal },
    { 'What we build': ['- a family of units'], History: [passed(600), failed(590, 'B1288')] }),
  item({ Id: 'B1288', Kind: 'step', Title: 'Fix: the family', State: 'refined', Refined: 'ready', Since: stamp(ago(590)), 'Fix of': 'B1159', Goal: goal }),
)
/** The partner's hold in words, as the ready list carries it (guards.mjs `readyHold`). */
const WORDS = 'waits for: the smaller, leaner unit landing first, then the family look'
const BLOCKED = 'blocked by B5 (not in the store)'
/** G95 the focus, G96 a goal under it, G12 outside. */
const GOALS = [{ id: 'G95', children: ['G96'] }, { id: 'G96', children: [] }, { id: 'G12', children: [] }]

const LEAD = { name: 'Lead', isMain: true, isLeftover: false, state: 'working', isRunning: true }
const PAINTER = { name: 'Painter', isMain: false, isLeftover: false, state: 'working', isRunning: true }
const view = (goal, why, { focus = 'G95', seen = null } = {}) => buildView({
  state: {
    chats: [LEAD, PAINTER], today: [], limits: {}, pause: null, chatPrefix: '', focus: focus === null ? null : { id: focus }, goals: { nodes: GOALS },
    readyList: { ready: [], held: [{ id: 'B1288', why }] },
  },
  items: store(goal), outbox: [], settings: {}, seen, now: NOW,
})
/** The watch has seen the hold for 83 minutes, as live (held since 22:36, review-held at 23:39). */
const seenFor = why => new Map([[`review-held B1288 ${why.slice(0, 80)}`, ago(83)]])
const watch = (board, why) => WATCH_RULES.find(one => one.id === 'review-held').check(board, { seen: seenFor(why), observed: [] })

test('X209: a fix of the focus goal held in words for 83 min is no review-held case', () => {
  const board = view('G95', WORDS)
  assert.deepEqual(watch(board, WORDS), [])
  const wait = reviewWaitOf(board.items.get('B1159'), board.items, board.held, NOW, board.recaps)
  assert.equal(reviewLateOf(board, board.items.get('B1159'), wait, () => ago(83)).late, false)
})

test('X209: a goal under the focus goal reads the same', () => {
  assert.deepEqual(watch(view('G96', WORDS), WORDS), [])
})

test('X209: the same hold in words on a fix outside the focus goal is a case at 60 min, as before', () => {
  const found = watch(view('G12', WORDS), WORDS)
  assert.deepEqual(found.map(one => [one.rule, one.key]), [['review-held', 'review-held B1159']])
  assert.match(found[0].text, /B1159 in review behind its fix B1288, held 83 min: waits for: the smaller/)
  // With no focus goal at all, nothing is in the focus: a case.
  assert.equal(watch(view('G95', WORDS, { focus: null }), WORDS).length, 1)
})

test('X209: a block on a fix of the focus goal stays a case: only the hold in words is a wait on purpose', () => {
  assert.equal(watch(view('G95', BLOCKED), BLOCKED).length, 1)
})

test('X209: under 60 min the hold outside the focus is no case yet', () => {
  const board = view('G12', WORDS)
  const found = WATCH_RULES.find(one => one.id === 'review-held').check(board, { seen: new Map([[`review-held B1288 ${WORDS.slice(0, 80)}`, ago(30)]]), observed: [] })
  assert.deepEqual(found, [])
})

test('X209: the health summary still counts the chain as held, and does not call it late', () => {
  const text = healthSummary(view('G95', WORDS, { seen: seenFor(WORDS) }), NOW)
  assert.match(text, /1 held/)
  assert.doesNotMatch(text, /review-held/)
})
