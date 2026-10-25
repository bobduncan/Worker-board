// Redesign Part 2 (2026-10-25): the board hands out every task, so a focus part whose steps are made and refined, none
// given yet, is on the board's list for a worker ("On the list for a worker"); one whose steps are not refined yet waits
// for its refine. Main hands out nothing, so no hint asks the person to make it (Focus 4's "waits for the main chat"
// is gone). Made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { parseGoals } from '../src/goals.mjs'
import * as stateModule from '../src/state.mjs'
import { parseItem } from '../src/work/item.mjs'

const { focusState } = stateModule
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const style = await readFile(join(ROOT, 'public', 'board.css'), 'utf8')
const made = {}
vm.runInNewContext(`${script.slice(script.indexOf('// focus:start'), script.indexOf('// focus:end'))}
Object.assign(this, { focusView })`, made)
const focusView = (...args) => JSON.parse(JSON.stringify(made.focusView(...args)))

const GOALS = [
  'Last id: G2', 'Focus: G2', '',
  '- [~] G2 Fights you can read',
  '    Vibe: you see the damage before you click',
  '    Vibe agreed: 2026-10-18 10:00',
  '    Part: Show the damage · about 1 h · steps B1, B2',
  '    Part: Heavier hits · 2 h · steps B3',
  '    Part: The run map · 1 h · steps B4',
  '    Part: Not made yet · 1 h',
  '    How agreed: 2026-10-18 11:00', '',
].join('\n')
const step = (id, state, owner = null) => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\n${owner === null ? '' : `Owner: ${owner}\n`}Since: 2026-10-18 11:10\n`)
const run = items => focusState(parseGoals(GOALS), items, [], 'Game - ')

test('a part with a refined step and none given is on the list for a worker; not refined, it waits for its refine', () => {
  const state = run([step('B1', 'refined'), step('B2', 'new'), step('B3', 'new'), step('B4', 'queued', 'Game - Map')])
  assert.deepEqual(state.parts.map(part => part.state), ['ready', 'refining', 'next', 'next'])
  // Given or under way, it is not waiting.
  assert.equal(run([step('B1', 'refined'), step('B2', 'in progress', 'Game - Units')]).parts[0].state, 'now')
  assert.ok(state.parts.every(part => part.waitsSince === undefined))
})

test('the run shows "On the list for a worker" in place of Next; the chip has its own look', () => {
  const view = focusView(run([step('B1', 'refined'), step('B2', 'done')]), { nodes: [] }, { canWrite: true })
  assert.deepEqual([view.run.parts[0].chip, view.run.parts[0].tone], ['On the list for a worker', 'ready'])
  assert.deepEqual([view.run.parts[1].chip, view.run.parts[1].tone], ['Next', 'next'])
  const refining = focusView(run([step('B3', 'new')]), { nodes: [] }, { canWrite: true })
  assert.deepEqual([refining.run.parts[1].chip, refining.run.parts[1].tone], ['Waiting for its refine, then it goes on the list', 'refining'])
  assert.match(style, /\.focus-chip\.is-ready \{/)
  assert.ok(!style.includes('.focus-chip.is-handout'))
})

test('no hint asks the person to have the main chat hand out the focus\'s steps any more', () => {
  assert.equal(stateModule.handoutNeeds, undefined)
  assert.ok(!script.includes("need.kind === 'handout'"))
  assert.ok(!script.includes("tag: 'Waits for the main chat'"))
})
