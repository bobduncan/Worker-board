// The backup focus (the person, 2026-11-24: "too often at the end when the goal is almost finished I have workers who do
// nothing"; "i prefer to pick up fix items from the backlog before focusing on the backup focus"). A head line `Backup: G<n>`
// in the goal map; its steps go out after the focus's and after every fix; it becomes the focus once the focus is done.
// Made-up samples.
import assert from 'node:assert/strict'
import test from 'node:test'

import { parseConfig } from '../src/config.mjs'
import { parseGoals } from '../src/goals.mjs'
import { setBackup, setFocus } from '../src/goalsWrite.mjs'
import { buildState } from '../src/state.mjs'
import { BACKUP_RANK, CHOICE_WHY, readyList } from '../src/work/handOut.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { storeFromText } from '../src/work/read.mjs'

const NOW = Date.parse('2026-11-24T10:00:00')
const step = (id, more = '') => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: refined\nRefined: ready\nSince: 2026-11-24 09:00\n${more}`)
const store = (...list) => new Map(list.map(item => [item.head.get('Id'), item]))
const run = (items, options = {}) => readyList(items, { now: NOW, followUpMs: 0, beyondFocus: false, ...options })
const MAP = ['# Goals', 'Last id: G3', 'Focus: G1', '', '- [~] G1 The focus', '  Done when: it works', '- [ ] G2 The backup', '  Done when: it works too', '  - [ ] G3 Under the backup', ''].join('\n')

test('the goal map reads its Backup line; "Backup:" alone is none, and a Backup line under a goal is no head line', () => {
  assert.equal(parseGoals(MAP.replace('Focus: G1', 'Focus: G1\nBackup: G2')).backup, 'G2')
  assert.equal(parseGoals(MAP.replace('Focus: G1', 'Focus: G1\nBackup:')).backup, null)
  assert.equal(parseGoals(MAP).backup, null)
  assert.equal(parseGoals(MAP.replace('  Done when: it works\n', '  Done when: it works\nBackup: G2\n')).backup, null)
})

test('setBackup writes the line right after Focus, replaces it in place, takes it out; refuses the focus and a goal not in the map', () => {
  const set = setBackup(MAP, 'G2')
  assert.equal(set.ok, true)
  assert.match(set.text, /Focus: G1\nBackup: G2\n/)
  const again = setBackup(set.text, 'G3')
  assert.match(again.text, /Focus: G1\nBackup: G3\n/)
  assert.equal(parseGoals(setBackup(again.text, null).text).backup, null)
  assert.deepEqual(setBackup(MAP, 'G1'), { ok: false, why: 'isFocus' })
  assert.equal(setBackup(MAP, 'G9').ok, false)
})

test('the backup becoming the focus takes its Backup line out in the same write; another focus keeps it', () => {
  const backed = setBackup(MAP, 'G2').text
  const moved = parseGoals(setFocus(backed, 'G2').text)
  assert.equal(moved.focus, 'G2')
  assert.equal(moved.backup, null)
  const other = parseGoals(setFocus(backed, 'G3').text)
  assert.deepEqual([other.focus, other.backup], ['G3', 'G2'])
})

test('order: a fix first, then the focus, then the backup and the goals under it, then the person\'s additions; the rest waits', () => {
  const items = store(
    step('B1', 'Goal: G2\n'),
    step('B2', 'Goal: G3\n'),
    step('B3', 'Goal: G1\n'),
    step('B4', 'Goal: G9\nPriority: fix\n'),
    step('B5', 'Goal: G9\nQueued by: person, 2026-11-24 09:30:00\n'),
    step('B6', 'Goal: G9\n'))
  const list = run(items, { focus: 'G1', backup: 'G2', backupGoals: ['G3'] })
  assert.deepEqual(list.ready.map(one => [one.id, one.rank]), [['B4', 0], ['B3', 1], ['B1', BACKUP_RANK], ['B2', BACKUP_RANK], ['B5', 2]])
  assert.deepEqual(list.held, [{ id: 'B6', why: CHOICE_WHY, choice: true }])
})

test('a fix of a backup step goes out at rank 1.5 as its root does; a backup under the focus counts as the focus', () => {
  const items = store(step('B1', 'Goal: G2\n'), step('B2', 'Goal: G9\nFix of: B1\n'))
  assert.deepEqual(run(items, { focus: 'G1', backup: 'G2' }).ready.map(one => [one.id, one.rank]), [['B1', BACKUP_RANK], ['B2', BACKUP_RANK]])
  assert.deepEqual(run(items, { focus: 'G1', focusGoals: ['G2'], backup: 'G2' }).ready.map(one => one.rank), [1, 1])
})

test('no backup: a step of another goal waits for the person, as before', () => {
  assert.deepEqual(run(store(step('B1', 'Goal: G2\n')), { focus: 'G1' }).held.map(one => one.id), ['B1'])
})

test('buildState: the backup goal\'s steps and those of the goals under it are ready at rank 1.5', () => {
  const at = new Date(2026, 10, 24, 10, 0).getTime()
  const work = storeFromText('## Work\n', { now: at - 60 * 60_000 })
  for (const [id, goal] of [['B1', 'G1'], ['B2', 'G3'], ['B3', 'G9']]) {
    work.items.set(id, parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: refined\nRefined: ready\nGoal: ${goal}\nSince: ${stamp(at - 60 * 60_000)}\n`))
    work.activities[0].steps.push(id)
  }
  const goalsText = MAP.replace('Focus: G1', 'Focus: G1\nBackup: G2') + '- [ ] G9 Unrelated\n'
  const app = name => JSON.stringify({ title: `Studio · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\game', isArchived: false, createdAt: 1, lastActivityAt: at - 60_000, lastAssistantUuid: 'u' })
  const state = buildState({ listText: '{"prefix":"Studio · ","main":"Lead"}', appChatTexts: ['Lead', 'Worker 1'].map(app), tails: {}, planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work, goalsText },
    { lines: [], outbox: [], runs: [], now: at, config: { ...parseConfig('{}', {}), project: 'C:\\game' } })
  assert.deepEqual(state.readyList.ready.map(one => [one.id, one.rank]), [['B1', 1], ['B2', BACKUP_RANK]])
  assert.deepEqual(state.readyList.held.map(one => one.id), ['B3'])
})
