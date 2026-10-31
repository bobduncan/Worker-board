// Focus 3 (spec 2026-10-18, sections 3 and 4, the run): each part of the agreed how follows its steps in the work
// store: all finished → done; one taken, in progress, waiting on the person or in review → in progress with its owner;
// else next. The progress counts the parts done, and the page shows no step ids. Made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { parseGoals } from '../src/goals.mjs'
import { focusState } from '../src/state.mjs'
import { parseItem } from '../src/work/item.mjs'

const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
const made = {}
vm.runInNewContext(`${script.slice(script.indexOf('// focus:start'), script.indexOf('// focus:end'))}
Object.assign(this, { focusView })`, made)
const focusView = (...args) => JSON.parse(JSON.stringify(made.focusView(...args)))

const GOALS = [
  'Last id: G2',
  'Focus: G2',
  '',
  '- [~] G2 Fights you can read',
  '    Vibe: you see the damage before you click',
  '    Vibe agreed: 2026-10-18 10:00',
  '    Part: Show the damage · about 1 h · steps B1, B2',
  '    Part: Heavier hits · 2 h · steps B3',
  '    Part: The run map · 1 h · steps B4, B5',
  '    Part: One look at the loop · 30 min · steps B6',
  '    How agreed: 2026-10-18 11:00',
  '',
].join('\n')
const step = (id, state, owner = null) => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\n${owner === null ? '' : `Owner: ${owner}\n`}Since: 2026-10-18 09:00\n`)
const run = (items, lanes = null) => focusState(parseGoals(GOALS), items, [], 'Game - ', null, null, lanes)

test('a part is done when every step is finished (done, closed or dropped)', () => {
  const state = run([step('B1', 'done'), step('B2', 'dropped'), step('B3', 'queued', 'Game - Units')])
  assert.deepEqual([state.parts[0].state, state.parts[0].done, state.parts[0].total], ['done', 2, 2])
  assert.equal(state.parts[1].state, 'next')
})

test('a part is in progress, with the worker its card shows, while a step is taken, in progress, waiting on you or in review', () => {
  // 2026-10-31 (B689): the worker on it is one whose card shows the step; its Owner alone names nobody.
  const cards = [{ name: 'Features', isLeftover: false, task: { stepId: 'B2' } }]
  for (const busy of ['taken', 'in progress', 'waiting on you', 'review']) {
    const state = run([step('B1', 'done'), step('B2', busy, 'Game - Features')], cards)
    assert.deepEqual([state.parts[0].state, state.parts[0].owner], ['now', 'Features'], busy)
    assert.equal(run([step('B1', 'done'), step('B2', busy, 'Game - Features')]).parts[0].owner, null, busy)
  }
})

test('else a part is next: steps queued, or none known to the store; made but not refined, it waits for its refine (redesign Part 2)', () => {
  const state = run([step('B3', 'queued', 'Game - Units'), step('B4', 'new'), step('B5', 'done')])
  assert.deepEqual(state.parts.map(part => part.state), ['next', 'next', 'refining', 'next'])
  // Refined, it is on the board's list for a worker.
  assert.equal(run([step('B3', 'queued', 'Game - Units'), step('B4', 'refined'), step('B5', 'done')]).parts[2].state, 'ready')
  // A part half done with nobody on it and its other step not given yet waits, its bar half full.
  assert.deepEqual([state.parts[2].done, state.parts[2].total], [1, 2])
})

test('the progress counts the parts done of all, and the time the parts not done still name', () => {
  // 2026-10-31 (B689): Map's card shows B4, so Map is on it.
  const state = run([step('B1', 'done'), step('B2', 'done'), step('B3', 'done'), step('B4', 'in progress', 'Game - Map'), step('B6', 'queued')], [{ name: 'Map', isLeftover: false, task: { stepId: 'B4' } }])
  assert.deepEqual(state.progress, { done: 2, total: 4, minutesLeft: 90 })
  const view = focusView(state, null)
  // Work blocks (2026-10-31): the progress counts work blocks.
  assert.deepEqual(view.progress, { text: '2 of 4 work blocks done · about 1.5 h left', percent: 50 })
  assert.deepEqual(view.run.parts.map(part => [part.chip, part.owner]), [['Done', null], ['Done', null], ['In progress', 'Map is on it'], ['Next', null]])
  assert.doesNotMatch(JSON.stringify(view.run.parts.map(({ blocks, count, toggle, isOpen, steps, ...part }) => part)), /\bB\d+\b/)
})

test('every part done: all four, and nothing left to name', () => {
  const state = run(['B1', 'B2', 'B3', 'B4', 'B5', 'B6'].map(id => step(id, 'done')))
  assert.deepEqual(state.progress, { done: 4, total: 4, minutesLeft: null })
  // Work blocks (2026-10-31): the progress counts work blocks.
  assert.equal(focusView(state, null).progress.text, '4 of 4 work blocks done')
})
