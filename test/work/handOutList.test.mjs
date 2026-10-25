// Redesign Part 2 (spec 2026-10-24, "One list of ready tasks"): the board keeps one ordered list of the tasks that are
// refined and ready and held by nothing; fixes first, then the focus goal's, then by id. A task a worker just finished
// waits on is kept for that worker a while (its follow-up), and a pinned task waits for its worker. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { isReady } from '../../src/work/guards.mjs'
import { HAND_OUT_DEFAULTS, followUpOf, readyList } from '../../src/work/handOut.mjs'
import { parseItem } from '../../src/work/item.mjs'
import { stamp } from '../../src/work/migrate.mjs'

const NOW = new Date(2026, 9, 25, 12, 0).getTime()
const MIN = 60_000
const DAY = 24 * 60 * MIN

/** An item file's text from its head and its sections. */
const file = (head, sections = {}) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${Object.entries(sections).map(([name, lines]) => `\n## ${name}\n${lines.join('\n')}\n`).join('')}`)
const step = (id, state, more = {}, sections = {}) => file({ Id: id, Kind: 'step', Title: `Task ${id}`, State: state, Since: '2026-10-25 10:00', ...(state === 'refined' ? { Refined: 'ready' } : {}), ...more }, sections)
const ask = (id, of, more = {}) => file({ Id: id, Kind: 'ask', Title: `Ask ${id}`, State: 'open', Owner: 'Worker 1', Since: '2026-10-25 10:00', Asks: 'decide', Of: of, ...more })
const mapOf = items => new Map(items.map(item => [item.head.get('Id'), item]))
const list = (items, more = {}) => readyList(mapOf(items), { now: NOW, focus: 'G3', followUpMs: 10 * MIN, standardHold: () => null, routingHeld: new Set(), prefix: 'Team - ', ...more })
const at = ms => `- ${stamp(ms)}`

test('the defaults: two minutes to take, a follow-up a preference only, 20 minutes for a held give, no number of workers', () => {
  assert.deepEqual(HAND_OUT_DEFAULTS, { takeWithinMinutes: 2, followUpMinutes: 0, heldGiveMinutes: 20, maxWorkers: null })
})

test('the order: a fix first, then the focus goal\'s tasks, then the rest; each by id', () => {
  const done = list([step('B2', 'refined'), step('B7', 'refined', { Goal: 'G3' }), step('B5', 'refined', { Goal: 'G3' }), step('B9', 'refined', { Priority: 'fix' }), step('B10', 'refined', { Goal: 'G4' })])
  assert.deepEqual(done.ready.map(one => one.id), ['B9', 'B5', 'B7', 'B2', 'B10'])
  assert.deepEqual(done.ready.map(one => one.rank), [0, 1, 1, 2, 2])
  assert.deepEqual(done.ready[0], { id: 'B9', rank: 0, keptFor: null, keptUntil: null, pinned: null, prefers: null })
  assert.deepEqual(done.held, [])
  // No focus: the focus goal's tasks are the rest.
  assert.deepEqual(list([step('B2', 'refined'), step('B5', 'refined', { Goal: 'G3' })], { focus: null }).ready.map(one => [one.id, one.rank]), [['B2', 2], ['B5', 2]])
})

test('a task something holds is held with one line why; a task not refined is in neither list', () => {
  const done = list([
    step('B3', 'in progress', { Owner: 'Worker 1' }), step('B4', 'refined', { 'Blocked by': 'B3' }),
    step('B6', 'refined'), ask('Q1', 'B6', { Blocking: 'yes' }),
    step('B8', 'refined'), step('B10', 'new'), step('B11', 'refined', { 'Waits for': 'the art from the person' }),
    step('B12', 'refined', { Refined: 'open' }), step('B13', 'refined'), step('B14', 'refined'), step('B15', 'refined', { 'Blocked by': 'B99' }),
  ], { standardHold: item => (item.head.get('Id') === 'B8' ? 'x' : null), routingHeld: new Set(['B13']) })
  assert.deepEqual(done.ready.map(one => one.id), ['B14'])
  assert.deepEqual(done.held, [
    { id: 'B4', why: 'blocked by B3 (in progress)' },
    { id: 'B6', why: 'waits for the answer to Q1' },
    { id: 'B8', why: 'x' },
    { id: 'B11', why: 'waits for: the art from the person' },
    { id: 'B12', why: 'its refine is not ready' },
    { id: 'B13', why: 'held by its routing record' },
    { id: 'B15', why: 'blocked by B99 (not in the store)' },
  ])
})

test('isReady: refined ready, nothing open it waits on, no blocking ask, no answer waiting to be folded in', () => {
  const ctx = items => ({ store: { items: mapOf(items) } })
  const b1 = step('B1', 'refined')
  assert.equal(isReady(b1, ctx([b1])), true)
  const blocked = step('B2', 'refined', { 'Blocked by': 'B1' })
  assert.equal(isReady(blocked, ctx([b1, blocked])), false)
  assert.equal(isReady(blocked, ctx([step('B1', 'done'), blocked])), true)
  // A blocker in review still holds: its work may come back with a fix (and the worker's own take would be refused).
  assert.equal(isReady(blocked, ctx([step('B1', 'review'), blocked])), false)
  const asked = step('B3', 'refined', {}, { Refined: ['  Refined (2026-10-25 09:00; ready):'], History: ['- 2026-10-25 09:00 Advisor: refined is ready'] })
  // An answer the partner has not folded in yet holds it (B309); a non-blocking open ask too.
  assert.equal(isReady(asked, ctx([asked, ask('Q2', 'B3', { State: 'answered', Since: '2026-10-25 09:30' })])), false)
  assert.equal(isReady(asked, ctx([asked, ask('Q2', 'B3', { Blocking: 'no' })])), false)
  assert.equal(isReady(asked, ctx([asked, ask('Q2', 'B3', { State: 'withdrawn' })])), true)
})

test('a follow-up: the task waits on one its worker just finished; kept for that worker ten minutes', () => {
  const finished = NOW - 5 * MIN
  const b11 = step('B11', 'done', { Owner: 'Team - Worker 2' }, { History: [`${at(NOW - 40 * MIN)} Team - Worker 2: in progress → review`, `${at(finished)} server: review → done`] })
  const b12 = step('B12', 'refined', { 'Blocked by': 'B11' })
  const done = list([b11, b12])
  assert.deepEqual(done.ready, [{ id: 'B12', rank: 2, keptFor: 'Worker 2', keptUntil: finished + 10 * MIN, pinned: null, prefers: null }])
  assert.deepEqual(followUpOf(b12, mapOf([b11, b12]), { now: NOW, followUpMs: 10 * MIN, prefix: 'Team - ' }), { worker: 'Worker 2', until: finished + 10 * MIN, at: finished })
  // At 11 minutes it is anyone's.
  assert.equal(list([b11, b12], { now: finished + 11 * MIN }).ready[0].keptFor, null)
  // Waits for names it too; a blocker in review is a follow-up as well (once nothing else holds the task).
  const b13 = step('B13', 'refined', { 'Waits for': 'B11 merged' })
  assert.deepEqual(followUpOf(b13, mapOf([b11, b13]), { now: NOW, followUpMs: 10 * MIN, prefix: 'Team - ' }), { worker: 'Worker 2', until: finished + 10 * MIN, at: finished })
  const inReview = step('B11', 'review', { Owner: 'Worker 2' }, { History: [`${at(NOW - 2 * MIN)} Worker 2: in progress → review`] })
  assert.deepEqual(followUpOf(b12, mapOf([inReview, b12]), { now: NOW, followUpMs: 10 * MIN, prefix: 'Team - ' }), { worker: 'Worker 2', until: NOW + 8 * MIN, at: NOW - 2 * MIN })
  // The board's sync check took the Blocked by line off once B11 was done: its History still names B11.
  const unblocked = step('B12', 'refined', {}, { History: [`${at(finished)} server: no longer blocked by B11 (the board's sync check: B11 is done)`] })
  assert.equal(list([b11, unblocked]).ready[0].keptFor, 'Worker 2')
  // A blocker without an Owner, or still in progress, is no follow-up.
  assert.equal(followUpOf(b12, mapOf([step('B11', 'done', {}, { History: [`${at(finished)} server: review → done`] }), b12]), { now: NOW, followUpMs: 10 * MIN, prefix: '' }), null)
})

test('a fix of a task is kept for the task\'s builder ten minutes from when it was made', () => {
  const b13 = step('B13', 'review', { Owner: 'Worker 1' })
  const b14 = step('B14', 'refined', { 'Fix of': 'B13' }, { History: [`${at(NOW - 3 * MIN)} Advisor: made by the result check of B13`] })
  assert.deepEqual(list([b13, b14]).ready, [{ id: 'B14', rank: 2, keptFor: 'Worker 1', keptUntil: NOW + 7 * MIN, pinned: null, prefers: null }])
  // followUpMs 0, the default (the review of 2026-10-25): a preference only, no keep, however long ago.
  assert.deepEqual(list([b13, b14], { followUpMs: 0, now: NOW + 60 * MIN }).ready, [{ id: 'B14', rank: 2, keptFor: null, keptUntil: null, pinned: null, prefers: 'Worker 1' }])
  assert.equal(followUpOf(b14, mapOf([b13, b14]), { now: NOW, followUpMs: 0, prefix: '' }), null)
})

test('a pinned task waits for its worker, however old', () => {
  const b15 = step('B15', 'refined', { Pinned: 'Worker 3', Since: stamp(NOW - DAY) })
  assert.deepEqual(list([b15]).ready, [{ id: 'B15', rank: 2, keptFor: 'Worker 3', keptUntil: null, pinned: 'Worker 3', prefers: null }])
  assert.equal(list([b15], { followUpMs: 0 }).ready[0].keptFor, 'Worker 3')
})
