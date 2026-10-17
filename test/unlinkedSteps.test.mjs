// B289: the Goals part shows the open steps that no goal's "Steps:" line names ("Not under a goal: N steps"), each
// with its title, and the Advisor's job text says it links every open step to a goal at every round. Made-up samples.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { parseBacklog } from '../src/backlog.mjs'
import { parseGoals, unlinkedSteps } from '../src/goals.mjs'
import { BACKLOG, GOALS } from './fixtures-goals.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const script = await readFile(join(HERE, '..', 'public', 'board.js'), 'utf8')
const page = await readFile(join(HERE, '..', 'public', 'index.html'), 'utf8')
const style = await readFile(join(HERE, '..', 'public', 'board.css'), 'utf8')
const design = await readFile(join(HERE, '..', 'DESIGN.md'), 'utf8')
const advisor = await readFile(join(HERE, '..', 'roles', 'advisor.md'), 'utf8')
const state = await readFile(join(HERE, '..', 'src', 'state.mjs'), 'utf8')

const MORE = [
  BACKLOG.trimEnd(),
  '- [ ] B08 Plant the roses',
  '- [x] B09 Water the lawn',
  '- [ ] Verify: the hedge is trimmed @you',
  '- [ ] B11 Decide: name the pond @you',
  '',
  '## Advisor suggestions',
  '- [ ] B10 Decide: add a maze (Advisor) @you',
  '',
].join('\n')

test('the open steps that no goal names, in the backlog\'s order, each with its title', () => {
  const unlinked = unlinkedSteps(parseGoals(GOALS), parseBacklog(MORE))
  // B01 to B07 stand in a "Steps:" line; B09 is done; a step without an id cannot be linked; the Advisor's own
  // suggestions are not work yet.
  assert.deepEqual(unlinked, [{ id: 'B08', title: 'Plant the roses' }, { id: 'B11', title: 'name the pond' }])
  assert.deepEqual(unlinkedSteps(parseGoals(GOALS), parseBacklog(BACKLOG)), [])
  // A step named under any goal counts, also one under a goal that is part of another, or named twice.
  const named = GOALS.replace('    Steps: B07', '    Steps: B07, B08, B11')
  assert.deepEqual(unlinkedSteps(parseGoals(named), parseBacklog(MORE)), [])
})

test('the state carries them with the goal map', () => {
  assert.ok(/unlinked: unlinkedSteps\(goalMap, backlog\)/.test(state))
})

const goals = {}
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
vm.runInNewContext(`${cut('goals')}\nObject.assign(this, { unlinkedView })`, goals)
const plain = value => JSON.parse(JSON.stringify(value))

test('the Goals part says how many and lists them; none says so; without the list, nothing', () => {
  assert.deepEqual(plain(goals.unlinkedView([{ id: 'B08', title: 'Plant the roses' }, { id: 'B11', title: 'name the pond' }])), {
    summary: 'Not under a goal: 2 steps', rows: [{ id: 'B08', title: 'Plant the roses' }, { id: 'B11', title: 'Name the pond' }],
  })
  assert.equal(goals.unlinkedView([{ id: 'B08', title: 'Plant the roses' }]).summary, 'Not under a goal: 1 step')
  assert.deepEqual(plain(goals.unlinkedView([])), { summary: 'Every open step is under a goal', rows: [] })
  assert.equal(goals.unlinkedView(undefined), null)
})

test('the page draws the part under the map, folded, a row opening the step\'s window; the design and the Advisor say so', () => {
  assert.ok(/<details class="goals-unlinked" id="goals-unlinked" hidden>/.test(page), 'index.html')
  assert.ok(/function drawUnlinked\(goals\)/.test(script) && /drawUnlinked\(goals\)/.test(script), 'drawn with the map')
  assert.ok(/once\('goals-unlinked', view, \(\) =>/.test(script), 'drawn anew only when it changed, so an open list stays open')
  assert.ok(/button\.dataset\.unlinkedStep = row\.id/.test(script) && /closest\('\[data-unlinked-step\]'\)/.test(script), 'a row opens its step')
  assert.ok(/\.goals-unlinked \{/.test(style), 'its style')
  assert.ok(/Not under a goal: N steps/.test(design), 'DESIGN.md')
  assert.ok(/## Steps under no goal/.test(advisor) && /every open step/i.test(advisor) && /proposed goal/i.test(advisor), 'roles/advisor.md')
})
