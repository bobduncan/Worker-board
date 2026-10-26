// B691 (2026-10-26): the person's pick reaches a fix of a step they queued (down the whole fix chain), and a step of a
// goal under the focus goal counts as the focus. A step of an unrelated goal, not picked, still waits. Made-up samples.
import assert from 'node:assert/strict'
import test from 'node:test'

import { parseConfig } from '../src/config.mjs'
import { buildState } from '../src/state.mjs'
import { CHOICE_WHY, readyList } from '../src/work/handOut.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { storeFromText } from '../src/work/read.mjs'

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

test('a fix whose root was dropped does not carry the root\'s pick: it waits as an unpicked step does', () => {
  const items = store(step('B1', 'Goal: G9\nQueued by: person, 2026-10-26 14:00:00\n'), step('B2', 'Goal: G9\nFix of: B1\n'))
  items.get('B1').head.set('State', 'dropped')
  assert.deepEqual(run(items, { focus: 'G1' }).held, [{ id: 'B2', why: CHOICE_WHY, choice: true }])
})

// The wiring: buildState reads the goal map, takes the goals under the focus and hands them to the hand-out.
test('buildState: a refined step of a goal under the focus is ready at rank 1; an unrelated one is held', () => {
  const at = new Date(2026, 9, 26, 14, 30).getTime()
  const work = storeFromText('## Work\n', { now: at - 60 * 60_000 })
  for (const [id, goal] of [['B1', 'G59'], ['B2', 'G9']]) {
    work.items.set(id, parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: refined\nRefined: ready\nGoal: ${goal}\nSince: ${stamp(at - 60 * 60_000)}\n`))
    work.activities[0].steps.push(id)
  }
  const goalsText = ['Last id: G60', 'Focus: G60', '', '- [~] G60 The focus', '  - [ ] G59 Under it', '- [ ] G9 Unrelated', ''].join('\n')
  const app = name => JSON.stringify({ title: `Studio · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\game', isArchived: false, createdAt: 1, lastActivityAt: at - 60_000, lastAssistantUuid: 'u' })
  const state = buildState({ listText: '{"prefix":"Studio · ","main":"Lead"}', appChatTexts: ['Lead', 'Worker 1'].map(app), tails: {}, planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work, goalsText },
    { lines: [], outbox: [], runs: [], now: at, config: { ...parseConfig('{}', {}), project: 'C:\game' } })
  assert.deepEqual(state.readyList.ready.map(one => [one.id, one.rank]), [['B1', 1]])
  assert.deepEqual(state.readyList.held.map(one => one.id), ['B2'])
})
