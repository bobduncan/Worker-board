// B302: with "One list" off, the Backlog tab groups the steps under the goals of the goal map, nested as there (the
// person's choice A, 2026-10-18), and the steps under no goal at the end. The person, 2026-10-17: "change backlog so
// that when the checkbox for 1 big list is off, and it has these categories. that these categories are the same as
// the goals/milstones the advisors knows." Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { goalCounts, parseGoals } from '../src/goals.mjs'
import { overview, parseBacklog } from '../src/backlog.mjs'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const context = {}
vm.runInNewContext(`${script.slice(script.indexOf('// coordinate:start'), script.indexOf('// coordinate:end'))}\nObject.assign(this, { coordinateList, goalRows, isGoalOpen })`, context)
const plain = value => JSON.parse(JSON.stringify(value))

const BACKLOG = [
  '## Meadow',
  '- [ ] B10 Fence the meadow (for Units)',
  '- [ ] B11 Paint the fence',
  '- [x] B12 Mow the meadow',
  '',
  '## Barn',
  '- [ ] B20 Build the barn (for Units) (branch feature/barn)',
  '- [ ] B21 Count the hay',
  '- [ ] B22 Name the barn cat',
  '',
].join('\n')
const GOALS = [
  '# Goal map',
  '- [~] G1 A farm that runs itself',
  '  - [~] G2 M1 · The herd is safe',
  '    From the game plan: M1',
  '    Steps: B12',
  '    - [ ] G3 A fence all round',
  '      Steps: B10, B11',
  '  - [ ] G4 M2 · A barn for winter',
  '    From the game plan: M2',
  '    Steps: B20, B10',
  '- [ ] G5 Tidy farm',
  '  Steps: B99',
  '',
].join('\n')

function view(backlogText = BACKLOG, goalsText = GOALS) {
  const parsed = parseBacklog(backlogText)
  const goals = parseGoals(goalsText)
  const counts = goalCounts(goals, parsed)
  return { activities: overview(parsed), goals: { roots: goals.roots, nodes: goals.nodes.map(one => ({ ...one, counts: counts.get(one.id) ?? null })) } }
}

const shape = rows => rows.map(row => (row.kind === 'goal' ? `${'  '.repeat(row.depth)}${row.id}${row.isMilestone ? ' (M)' : ''}` : `${'  '.repeat(row.depth)}- ${row.step.id}`))

test('the steps stand under the goals that name them, nested as on the goal map, the rest under no goal at the end', () => {
  const { activities, goals } = view()
  const list = context.coordinateList(activities, { asOne: false })
  const rows = context.goalRows(list, goals)
  assert.deepEqual(shape(rows), [
    'G1',
    '  G2 (M)',
    '    G3',
    '      - B10',
    '      - B11',
    '  G4 (M)',
    // B10 stands under the first goal that names it, G3.
    '    - B20',
    'none',
    '  - B21',
    '  - B22',
  ])
  // A goal says how many of the steps shown under it are open (B10 stands under G3, not G4), and a step keeps its activity.
  const g4 = rows.find(row => row.id === 'G4')
  assert.deepEqual([g4.open, g4.done], [1, 0])
  assert.deepEqual([rows.find(row => row.id === 'G1').open, rows.find(row => row.id === 'G2').open], [3, 2])
  assert.equal(rows.find(row => row.kind === 'step' && row.step.id === 'B21').step.activity, 'Barn')
  const none = rows.find(row => row.id === 'none')
  assert.deepEqual([none.title, none.open, none.isNone], ['Not under a goal', 2, true])
  // A goal with nothing shown under it is left out (G5 names only a step not on the backlog; G2's B12 is finished).
  assert.equal(rows.some(row => row.id === 'G5'), false)
})

test('the review: an id twice in the map keeps the first, as the board does; a milestone is any part of the plan', () => {
  const twice = [
    '- [ ] G1 A farm',
    '  - [ ] G2 The first G2',
    '    From the game plan: Phase 1',
    '    Steps: B20',
    '    - [ ] G3 Under the first',
    '      Steps: B21',
    '  - [ ] G2 The second G2',
    '    Steps: B22',
    '',
  ].join('\n')
  const { activities, goals } = view(BACKLOG, twice)
  const rows = context.goalRows(context.coordinateList(activities, {}), goals)
  assert.deepEqual(shape(rows), ['G1', '  G2 (M)', '    - B20', '    G3', '      - B21', 'none', '  - B10', '  - B11', '  - B22'])
  assert.equal(rows.find(row => row.id === 'G2').title, 'The first G2')
})

test('the filters and the search work as today: only the goals that hold what is shown', () => {
  const { activities, goals } = view()
  const queued = context.goalRows(context.coordinateList(activities, { filter: 'queued' }), goals)
  assert.deepEqual(shape(queued), ['G1', '  G2 (M)', '    G3', '      - B10'])
  // The counts follow what is shown: G1 holds one queued step here.
  assert.equal(queued.find(row => row.id === 'G1').open, 1)
  const found = context.goalRows(context.coordinateList(activities, { find: 'cat' }), goals)
  assert.deepEqual(shape(found), ['none', '  - B22'])
  // Finished steps shown when asked for: B12 under G2.
  const done = context.goalRows(context.coordinateList(activities, { showDone: true }), goals)
  assert.ok(shape(done).includes('    - B12'))
})

test('the roots and the milestones stand open, the other goals folded; what the person folded or opened is kept', () => {
  assert.equal(context.isGoalOpen({ id: 'G1', depth: 0, isMilestone: false }, {}), true)
  assert.equal(context.isGoalOpen({ id: 'G2', depth: 1, isMilestone: true }, {}), true)
  assert.equal(context.isGoalOpen({ id: 'G3', depth: 2, isMilestone: false }, {}), false)
  assert.equal(context.isGoalOpen({ id: 'G3', depth: 2, isMilestone: false }, { G3: true }), true)
  assert.equal(context.isGoalOpen({ id: 'G2', depth: 1, isMilestone: true }, { G2: false }), false)
  assert.equal(context.isGoalOpen({ id: 'none', depth: 0, isNone: true }, {}), true)
})

test('without a goal map the tab groups by activity as before', () => {
  const { activities } = view()
  assert.equal(context.goalRows(context.coordinateList(activities, {}), null), null)
  assert.equal(context.goalRows(context.coordinateList(activities, {}), { roots: [], nodes: [] }), null)
})

test('the page draws the goals as folding headers and keeps the folds in this browser', () => {
  assert.match(script, /const rows = \$\('coordinate-one'\)\.checked \? null : goalRows\(list, state\.goals \?\? null\)/)
  assert.match(script, /dataset\.goalFold = /)
  assert.match(script, /localStorage\.setItem\('backlog-goal-folds', /)
  // The keyboard stays on a header when the list is drawn anew; the fold sign is not read out.
  assert.match(script, /if \(focusedGoal !== null\) \$\('coordinate-list'\)\.querySelector\(`\[data-goal-fold="\$\{focusedGoal\}"\]`\)\?\.focus\(\)/)
  assert.match(script, /sign\.setAttribute\('aria-hidden', 'true'\)/)
  for (const rule of ['.goal-head', '.goal-head.is-milestone', '.goal-head.is-none', '.goal-steps']) assert.ok(style.includes(rule), rule)
})
