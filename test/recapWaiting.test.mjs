// 2026-11-05 (G60's recap, rows 10 and 14): a row sent back in an EARLIER round keeps being watched. `recapWaitingOf` says when its new try is
// in and nobody asked for the next round; `fixRootsOf` goes up a `Fix of` chain; the routing takes a fix of a recap step as that row's;
// the partner's word says "is in". Made-up names only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { isTriedSince } from '../src/demoFeedback.mjs'
import { recapWaitingOf } from '../src/recapCard.mjs'
import { recapRoundWords } from '../src/say.mjs'
import { autopilotRoute, recapAskOf } from '../src/work/autopilot.mjs'
import { parseItem } from '../src/work/item.mjs'
import { fixRootsOf } from '../src/work/resultCheck.mjs'

const lines = fields => Object.entries(fields).filter(([, value]) => value !== null).map(([key, value]) => `${key}: ${value}`).join('\n')
const step = (id, head = {}, history = '2026-11-02 10:00') => parseItem(`${lines({ Id: id, Kind: 'step', Title: `Task ${id}`, State: 'done', Owner: 'Painter', Goal: 'G6', ...head })}\n\n## History\n- ${history} Painter: filed\n`)
const store = (...list) => new Map(list.map(one => [one.head.get('Id'), one]))

test('fixRootsOf: the steps up the Fix of chain, nearest first; a loop, a missing link, a non-step and 40 hops end it', () => {
  const items = store(step('B1'), step('B2', { 'Fix of': 'B1' }), step('B3', { 'Fix of': 'B2' }))
  assert.deepEqual(fixRootsOf('B3', items), ['B2', 'B1'])
  assert.deepEqual(fixRootsOf('B1', items), [])
  assert.deepEqual(fixRootsOf('B9', items), [])
  assert.deepEqual(fixRootsOf('B5', store(step('B5', { 'Fix of': 'B8' }))), [], 'a missing link')
  const loop = store(step('B1', { 'Fix of': 'B2' }), step('B2', { 'Fix of': 'B1' }))
  assert.deepEqual(fixRootsOf('B1', loop), ['B2'])
  const ask = parseItem('Id: Q1\nKind: ask\nTitle: x\nState: open\n')
  assert.deepEqual(fixRootsOf('B5', store(step('B5', { 'Fix of': 'Q1' }), ask)), [], 'an ask is no step')
  const long = store(...Array.from({ length: 60 }, (_, at) => step(`B${at + 1}`, at === 59 ? {} : { 'Fix of': `B${at + 2}` })))
  assert.equal(fixRootsOf('B1', long).length, 40)
})

const ROWS = [
  { key: '10. Bridges', title: 'Bridges', steps: ['B91'], changed: false, pending: true, shows: null },
  { key: '11. Shrine', title: 'Shrine', steps: ['B92'], changed: true, pending: false, shows: null },
]
const SENT_1 = { n: 1, at: '2026-11-02 16:17', parts: [{ key: '10. Bridges', verdict: 'sent-back', comment: 'wider' }] }
const OTHERS = { n: 5, at: '2026-11-04 23:03', parts: [{ key: '12. Other', verdict: 'approved', comment: '' }] }
const recapOf = (more = {}) => ({ goal: 'G6', path: 'art/g6/recap/demo.json', rows: [ROWS[0]], rounds: [SENT_1, OTHERS], changedAt: new Date(2026, 10, 4, 22, 0).getTime(), ...more })
const live = () => store(step('B91', {}, '2026-10-30 09:00'), step('B95', { 'Fix of': 'B91' }, '2026-11-03 09:00'), step('B96', { 'Fix of': 'B95' }, '2026-11-04 23:30'))
const waitingOf = (items, recap = recapOf()) => recapWaitingOf({ goal: 'G6', recap, items, now: new Date(2026, 10, 5, 8, 0).getTime() })

test('recapWaitingOf: the live case (sent back in round 1, round 5 judged other rows, row still pending, a fix-of-a-fix try in) waits for round 6', () => {
  assert.deepEqual(waitingOf(live()), { goal: 'G6', path: 'art/g6/recap/demo.json', round: 6, steps: ['B96'] })
})

test('recapWaitingOf: a try under way, a try before the Send, a QA task, a tried row, an approved row, another goal: nothing', () => {
  assert.equal(waitingOf(store(...live().values(), step('B97', { 'Fix of': 'B96', State: 'in progress' }, '2026-11-05 07:00'))), null, 'under way')
  const old = store(step('B91', {}, '2026-10-30 09:00'), step('B95', { 'Fix of': 'B91' }, '2026-11-01 09:00'))
  assert.equal(waitingOf(old), null, 'made before the Send')
  const qa = store(step('B91', {}, '2026-10-30 09:00'), step('B95', { 'Fix of': 'B91', Checks: 'B91' }, '2026-11-03 09:00'))
  assert.equal(waitingOf(qa), null, 'a QA task is no try')
  const tried = { ...ROWS[0], changed: true, pending: false, shows: { verdict: 'yes', by: 'Checker', at: '2026-11-03 12:00', why: 'ok' } }
  assert.equal(waitingOf(live(), recapOf({ rows: [tried] })), null, 'tried since the Send')
  const approved = { n: 6, at: '2026-11-05 07:00', parts: [{ key: '10. Bridges', verdict: 'approved', comment: '' }] }
  assert.equal(waitingOf(live(), recapOf({ rounds: [SENT_1, approved] })), null, 'approved')
  assert.equal(waitingOf(live(), recapOf({ goal: 'G9' })), null, 'another goal')
  assert.equal(waitingOf(live(), null), null)
})

test('recapWaitingOf: a later round that sent the row back again counts from THAT Send; the newest try in is named', () => {
  const again = { n: 3, at: '2026-11-04 12:00', parts: [{ key: '10. Bridges', verdict: 'sent-back', comment: 'again' }] }
  const items = store(step('B91', {}, '2026-10-30 09:00'), step('B95', { 'Fix of': 'B91' }, '2026-11-03 09:00'))
  assert.equal(waitingOf(items, recapOf({ rounds: [SENT_1, again] })), null, 'B95 was made before the second Send')
  const two = store(...items.values(), step('B96', { 'Fix of': 'B95' }, '2026-11-04 13:00'), step('B97', { 'Fix of': 'B95' }, '2026-11-04 14:00'))
  assert.deepEqual(waitingOf(two, recapOf({ rounds: [SENT_1, again] })).steps, ['B97'])
})

test('isTriedSince: the one test of a row tried since its Send', () => {
  const at = new Date(2026, 10, 2, 16, 17).getTime()
  const row = { changed: true, pending: false, shows: { verdict: 'yes', at: '2026-11-02 17:00' } }
  assert.equal(isTriedSince(row, at, at + 2 * 60_000), true)
  assert.equal(isTriedSince(row, at, at + 30_000), false, 'written in the same minute')
  assert.equal(isTriedSince({ ...row, pending: true }, at, at + 2 * 60_000), false)
  assert.equal(isTriedSince({ ...row, changed: false }, at, at + 2 * 60_000), false)
  assert.equal(isTriedSince({ ...row, shows: null }, at, at + 2 * 60_000), false)
  assert.equal(isTriedSince(row, null, at + 2 * 60_000), false)
})

const look = (head = {}) => parseItem(`${lines({ Id: 'Q668', Kind: 'ask', Title: 'Your eyes in recap row 10', State: 'open', Owner: 'Painter', Asks: 'look', Of: 'B96', Blocking: 'no', ...head })}\n`)
const ctx = (items, more = {}) => ({ roleOf: () => 'worker', items, focusGoal: 'G6', focusHasDemo: true, again: true, recapSteps: [{ step: 'B91', goal: 'G6', path: 'art/g6/recap/demo.json' }], prefix: '', ...more })

test('routing: a look of a fix of a fix of a recap step goes to the recap; with no link up to it, as before', () => {
  assert.equal(autopilotRoute(look(), ctx(live())).to, 'recap')
  const loose = store(step('B91'), step('B96', { 'Fix of': 'B80' }))
  assert.notEqual(autopilotRoute(look(), ctx(loose)).to, 'recap')
  const pictured = look({ Of: null, Pictures: 'art/B96/a.png' })
  assert.deepEqual(recapAskOf(pictured, ctx(live()), 'worker'), { to: 'recap', why: 'its step\'s part of the goal\'s recap asks it already', step: 'B96' })
  assert.equal(recapAskOf(pictured, ctx(loose), 'worker'), null)
})

test('recapRoundWords: "is in" for a row waited on from an earlier round; without it the older line', () => {
  const base = { goal: 'G60', round: 6, step: 'B1048', path: 'art/g60/recap/demo.json', job: 'roles/partner.md' }
  assert.equal(recapRoundWords('Advisor', { ...base, isIn: true }).text.split('\n')[0], 'recap: G60 round 6: B1048 is in (reported and checked; a row you were waiting on, sent back in an earlier round); write the round with its row, `pending` for the rest')
  assert.equal(recapRoundWords('Advisor', base).text.split('\n')[0], 'recap: G60 round 6: B1048 is done; write the round with its row, `pending` for the rest')
})
