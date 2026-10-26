// B691 (2026-10-26): the person's pick reaches a fix of a step they queued (down the whole fix chain), and a step of a
// goal under the focus goal counts as the focus. A step of an unrelated goal, not picked, still waits. Made-up samples.
import assert from 'node:assert/strict'
import test from 'node:test'

import { CHOICE_WHY, readyList } from '../src/work/handOut.mjs'
import { parseItem } from '../src/work/item.mjs'

const NOW = Date.parse('2026-10-26T14:30:00')
const step = (id, more = '') => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: refined\nRefined: ready\nSince: 2026-10-26 13:00\n${more}`)
const store = (...list) => new Map(list.map(item => [item.head.get('Id'), item]))
const run = (items, options = {}) => readyList(items, { now: NOW, followUpMs: 0, beyondFocus: false, ...options })
const readyIds = list => list.ready.map(one => one.id)
const heldIds = list => list.held.map(one => one.id)

test('a fix of a step the person queued is ready, not held; so is a fix of that fix', () => {
  const items = store(
    step('B1', 'Goal: G9\nQueued by: person, 2026-10-26 14:00:00\n'),
    step('B2', 'Goal: G9\nFix of: B1\n'),
    step('B3', 'Goal: G9\nFix of: B2\n'))
  const list = run(items, { focus: 'G1' })
  assert.deepEqual(readyIds(list), ['B1', 'B2', 'B3'])
  assert.deepEqual(heldIds(list), [])
})

test('a fix of a step nobody picked, outside the focus, still waits for the pick', () => {
  const items = store(step('B1', 'Goal: G9\n'), step('B2', 'Goal: G9\nFix of: B1\n'))
  const list = run(items, { focus: 'G1' })
  assert.deepEqual(list.held, [{ id: 'B1', why: CHOICE_WHY, choice: true }, { id: 'B2', why: CHOICE_WHY, choice: true }])
})

test('a fix of a pinned step goes out too', () => {
  const items = store(step('B1', 'Goal: G9\nPinned: Worker 2\n'), step('B2', 'Goal: G9\nFix of: B1\n'))
  assert.deepEqual(readyIds(run(items, { focus: 'G1' })), ['B1', 'B2'])
})

test('a step of a goal under the focus is rank 1, as the focus goal\'s own step; an unrelated goal\'s step is held', () => {
  const items = store(step('B1', 'Goal: G2\n'), step('B2', 'Goal: G1\n'), step('B3', 'Goal: G9\n'))
  const list = run(items, { focus: 'G1', focusGoals: ['G1', 'G2'] })
  assert.deepEqual(list.ready.map(one => [one.id, one.rank]), [['B1', 1], ['B2', 1]])
  assert.deepEqual(heldIds(list), ['B3'])
})

test('a fix whose root is a step of the focus or a goal under it goes out as rank 1', () => {
  const items = store(step('B1', 'Goal: G2\nState: done\n'.replace('State: done\n', '')), step('B2', 'Goal: G9\nFix of: B1\n'))
  const list = run(items, { focus: 'G1', focusGoals: ['G1', 'G2'] })
  assert.deepEqual(list.ready.map(one => [one.id, one.rank]), [['B1', 1], ['B2', 1]])
})

test('a fix chain that loops on itself does not hang', () => {
  const items = store(step('B1', 'Goal: G9\nFix of: B2\n'), step('B2', 'Goal: G9\nFix of: B1\n'))
  assert.deepEqual(heldIds(run(items, { focus: 'G1' })), ['B1', 'B2'])
})
