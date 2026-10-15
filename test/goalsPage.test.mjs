// B255: the Advisor tab's Goals part, the outline of goals.md zoomed one level at a time (spec 2026-10-15, section 2).
// The view models run here without the page; made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { parseBacklog } from '../src/backlog.mjs'
import { goalCounts, parseGoals } from '../src/goals.mjs'
import { BACKLOG, GOALS } from './fixtures-goals.mjs'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const html = await readFile(join(PUBLIC, 'index.html'), 'utf8')
const made = {}
vm.runInNewContext(`${script.slice(script.indexOf('// goals:start'), script.indexOf('// goals:end'))}
Object.assign(this, { goalAddress, goalCounter, goalCrumb, goalDropTarget, goalFocusOf, goalFrameLine, goalFrameLines, goalHasOpenInside, goalKeyMove, goalLinkChoices, goalNextState, goalOutlineRows, goalPlaceAt, goalTools, goalZoomOut, tabOfAddress })`, made)
// What the page's functions answer, as this file's own objects, so deepEqual compares them by value.
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const page = Object.fromEntries(Object.entries(made).map(([name, made]) => [name, (...args) => plain(made(...args))]))

const stateGoals = (text = GOALS) => {
  const goals = parseGoals(text)
  const counts = goalCounts(goals, parseBacklog(BACKLOG))
  return { roots: goals.roots, problems: goals.problems, nodes: goals.nodes.map(one => ({ ...one, counts: counts.get(one.id) ?? null })) }
}

test('the crumb walks from Goals to the focused node; the counter says what is inside', () => {
  assert.deepEqual(plain(page.goalCrumb(stateGoals(), null)), [{ id: null, title: 'Goals' }])
  assert.deepEqual(page.goalCrumb(stateGoals(), 'G4').map(one => one.id), [null, 'G1', 'G2', 'G4'])
  assert.deepEqual(page.goalCrumb(stateGoals(), 'G99').map(one => one.id), [null])
  assert.equal(page.goalCounter({ nodes: 2, steps: 4, done: 3, open: 1, unknown: 0, missing: 1 }), '2 inside · 4 steps · 3 done · 1 missing')
  assert.equal(page.goalCounter({ nodes: 0, steps: 1, done: 0, open: 0, unknown: 1, missing: 0 }), '1 step · 0 done · 1 unknown')
  assert.equal(page.goalCounter({ nodes: 0, steps: 0, done: 0, open: 0, unknown: 0, missing: 0 }), 'no steps yet')
})

test('the outline shows the whole tree, folded around the focus, its children open and the rest dimmed', () => {
  const rows = page.goalOutlineRows(stateGoals(), 'G2', new Set())
  assert.deepEqual(rows.map(row => row.id), ['G1', 'G2', 'G3', 'G4', 'G5', 'G7'])
  const row = id => rows.find(one => one.id === id)
  assert.equal(row('G2').isFocus, true)
  assert.deepEqual(['G1', 'G2', 'G3', 'G4', 'G5', 'G7'].map(id => row(id).isDim), [true, false, false, false, true, true])
  assert.deepEqual(['G1', 'G2', 'G3', 'G5', 'G7'].map(id => row(id).fold), ['open', 'open', null, 'closed', 'closed'])
  assert.deepEqual([row('G1').depth, row('G2').depth, row('G3').depth], [0, 1, 2])
  assert.equal(row('G2').counter, '2 inside · 4 steps · 3 done · 1 missing')
  assert.equal(row('G4').state, 'now')
})

test('at the top every goal is a row, folded and lit; a ▸ opens one level more without zooming', () => {
  const top = page.goalOutlineRows(stateGoals(), null, new Set(['G5']))
  assert.deepEqual(top.map(row => row.id), ['G1', 'G7'])
  assert.ok(top.every(row => !row.isDim && row.fold === 'closed'))
  const opened = page.goalOutlineRows(stateGoals(), null, new Set(['G1', 'G5']))
  assert.deepEqual(opened.map(row => row.id), ['G1', 'G2', 'G5', 'G6', 'G9', 'G7'])
  // An unknown focus (a link to a goal that is gone) is the top.
  assert.deepEqual(page.goalOutlineRows(stateGoals(), 'G99', new Set()).map(row => row.id), ['G1', 'G7'])
})

test('a node that is also part of another stands under it as a reference row, and its home row says so (Review Focus 3)', () => {
  const inG5 = page.goalOutlineRows(stateGoals(), 'G5', new Set())
  assert.deepEqual(inG5.filter(row => row.isRef).map(row => row.id), ['G9'])
  assert.deepEqual(plain(inG5.find(row => row.id === 'G9').tags), ['also here · home: The gardener\'s tools'])
  assert.equal(inG5.find(row => row.id === 'G9').isDim, false)
  const top = page.goalOutlineRows(stateGoals(), null, new Set(['G7']))
  assert.deepEqual(plain(top.find(row => row.id === 'G7').tags), ['enables → Zebracorn Garden'])
  assert.deepEqual(plain(top.find(row => row.id === 'G9').tags), ['also under M2 · The garden is open'])
})

test('a file with an id twice inside itself is drawn once, without going round in circles (Review Focus 1)', () => {
  const goals = stateGoals('- [ ] G1 One\n  - [ ] G2 Two\n    - [ ] G1 One again\n')
  assert.deepEqual(goals.problems, ['line 3: the id G1 is used twice'])
  assert.deepEqual(page.goalOutlineRows(goals, 'G2', new Set()).map(row => row.id), ['G1', 'G2'])
})

test('the frame folds a node\'s lines to one, and unfolds them all', () => {
  const goals = stateGoals()
  const node = id => goals.nodes.find(one => one.id === id)
  assert.equal(page.goalFrameLine(node('G1')), 'Done when: a stranger walks the garden without a guide')
  assert.equal(page.goalFrameLine(node('G6')), '1 ask pending')
  assert.equal(page.goalFrameLine(node('G4')), '1 missing')
  assert.equal(page.goalFrameLine(node('G5')), '')
  assert.deepEqual(plain(page.goalFrameLines(goals, node('G2'))), [
    'From the game plan: M1',
    'Recommendation (R2): Add signposts at the forks · a visitor gets lost once per walk · about 2 h · B44',
  ])
  assert.deepEqual(plain(page.goalFrameLines(goals, node('G9'))), ['Also part of: M2 · The garden is open (G5)', 'Steps: B07'])
  assert.deepEqual(plain(page.goalFrameLines(goals, node('G6'))), ['Steps: B04, B05', 'Ask (A1, 2026-10-15 18:40): what differs most from the picture?'])
})

test('the focus lives in the address: #advice/goals is the top, #advice/goals/G4 a goal; anything else is not the map', () => {
  assert.equal(page.goalAddress(null), '#advice/goals')
  assert.equal(page.goalAddress('G4'), '#advice/goals/G4')
  assert.equal(page.goalFocusOf('#advice/goals'), null)
  assert.equal(page.goalFocusOf('#advice/goals/G4'), 'G4')
  assert.equal(page.goalFocusOf('#advice'), undefined)
  assert.equal(page.goalFocusOf('#advice/goals/<b>'), undefined)
})

test('review: a reference row never folds, the focus and its ancestors keep their ▾ without a button, the focus is marked once', () => {
  const text = GOALS.replace('    Steps: B07\n', '    Steps: B07\n    - [ ] G10 A finer net\n')
  const inG5 = page.goalOutlineRows(stateGoals(text), 'G5', new Set(['G9']))
  const ref = inG5.find(row => row.id === 'G9' && row.isRef)
  assert.deepEqual([ref.fold, ref.foldable], [null, false])
  assert.equal(inG5.some(row => row.id === 'G10'), false)
  assert.deepEqual(inG5.filter(row => ['G1', 'G5'].includes(row.id)).map(row => [row.fold, row.foldable]), [['open', false], ['open', false]])
  assert.deepEqual(inG5.filter(row => row.id === 'G7').map(row => [row.fold, row.foldable]), [['closed', true]])
  // Zoomed into G9 at its home, with G5 opened: its reference row under G5 is not a second focus.
  const inG9 = page.goalOutlineRows(stateGoals(text), 'G9', new Set(['G1', 'G5']))
  assert.deepEqual(inG9.filter(row => row.isFocus).map(row => [row.id, row.isRef]), [['G9', false]])
  assert.deepEqual(inG9.filter(row => row.id === 'G9').map(row => row.isRef), [true, false])
})

test('review: Esc and ‹ go one level up, the top from a top goal; the address names the tab, the old ones unchanged', () => {
  assert.equal(page.goalZoomOut(stateGoals(), 'G4'), 'G2')
  assert.equal(page.goalZoomOut(stateGoals(), 'G1'), null)
  assert.equal(page.goalZoomOut(stateGoals(), 'G99'), null)
  assert.deepEqual(['', '#advice', '#advice/goals', '#advice/goals/G2', '#backlog', '#coordinate', '#design', '#details=B14', '#play=main'].map(page.tabOfAddress),
    ['overview', 'advice', 'advice', 'advice', 'coordinate', 'coordinate', 'design', null, null])
  assert.match(script, /show\(tabOfAddress\(location\.hash\) \?\? 'overview'\)/)
})

test('the Advisor tab has the Goals part second, opened from the address, drawn when the map or the zoom changes', () => {
  assert.deepEqual([...html.matchAll(/data-advisor-pane="([a-z]+)"/g)].map(match => match[1]), ['way', 'goals', 'plan', 'suggestions', 'chat'])
  assert.match(html, /<section class="panel advisor-goals" id="advisor-goals"/)
  assert.match(script, /const ADVISOR_PANES = \['way', 'goals', 'plan', 'suggestions', 'chat'\]/)
  assert.match(script, /once\('goals', goalsData\(state\), \(\) => drawGoals\(state\)\)/)
  assert.match(script, /addEventListener\('popstate'/)
})

// B256: editing the goal map in the outline (spec 2026-10-15, section 3).

test('B256: a drop lands before or after a sibling or inside a goal, never inside itself or its own branch', () => {
  const goals = stateGoals()
  assert.deepEqual(page.goalDropTarget(goals, 'G4', 'G6', 'before'), { parent: 'G5', index: 0 })
  assert.deepEqual(page.goalDropTarget(goals, 'G4', 'G6', 'after'), { parent: 'G5', index: 1 })
  assert.deepEqual(page.goalDropTarget(goals, 'G4', 'G5', 'into'), { parent: 'G5', index: 1 })
  // Among its own siblings: before G3 is first, after G3 is where it stands.
  assert.deepEqual(page.goalDropTarget(goals, 'G4', 'G3', 'before'), { parent: 'G2', index: 0 })
  assert.deepEqual(page.goalDropTarget(goals, 'G7', 'G1', 'before'), { parent: null, index: 0 })
  assert.equal(page.goalDropTarget(goals, 'G2', 'G3', 'into'), null)
  assert.equal(page.goalDropTarget(goals, 'G2', 'G3', 'before'), null)
  assert.equal(page.goalDropTarget(goals, 'G2', 'G2', 'into'), null)
  assert.equal(page.goalDropTarget(goals, 'G2', 'G99', 'into'), null)
  // On a crumb: inside that goal, last; on "Goals": the top, last.
  assert.deepEqual(page.goalDropTarget(goals, 'G6', 'G1', 'into'), { parent: 'G1', index: 2 })
  assert.deepEqual(page.goalDropTarget(goals, 'G6', null, 'into'), { parent: null, index: 2 })
  // Where the pointer is on a row: its top quarter before, its bottom quarter after, else inside.
  assert.deepEqual([2, 20, 37].map(y => page.goalPlaceAt(y, 40)), ['before', 'into', 'after'])
})

test('B256: keys move among siblings, in under the row above, and out after the parent', () => {
  const goals = stateGoals()
  assert.deepEqual(page.goalKeyMove(goals, 'G4', 'up'), { parent: 'G2', index: 0 })
  assert.equal(page.goalKeyMove(goals, 'G3', 'up'), null)
  assert.deepEqual(page.goalKeyMove(goals, 'G3', 'down'), { parent: 'G2', index: 1 })
  assert.equal(page.goalKeyMove(goals, 'G4', 'down'), null)
  assert.deepEqual(page.goalKeyMove(goals, 'G4', 'in'), { parent: 'G3', index: 0 })
  assert.equal(page.goalKeyMove(goals, 'G3', 'in'), null)
  assert.deepEqual(page.goalKeyMove(goals, 'G4', 'out'), { parent: 'G1', index: 1 })
  assert.equal(page.goalKeyMove(goals, 'G1', 'out'), null)
  assert.deepEqual(page.goalKeyMove(goals, 'G7', 'up'), { parent: null, index: 0 })
})

test('B256: the dot cycles open, in progress, done; done with open goals inside asks once', () => {
  assert.deepEqual(['open', 'now', 'done'].map(page.goalNextState), ['now', 'done', 'open'])
  const goals = stateGoals()
  assert.equal(page.goalHasOpenInside(goals, 'G2'), true)
  assert.equal(page.goalHasOpenInside(goals, 'G3'), false)
  assert.equal(page.goalHasOpenInside(goals, 'G7'), true)
  assert.equal(page.goalHasOpenInside(stateGoals('- [ ] G1 A\n  - [x] G2 B\n'), 'G1'), false)
})

test('B256: the search box offers the goals a link may point to, by words in the title', () => {
  const goals = stateGoals()
  const ids = (id, name, words) => page.goalLinkChoices(goals, id, name, words).map(one => one.id)
  // Not itself, not one it links to already; for "Also part of" not its home nor a goal inside it.
  assert.deepEqual(ids('G6', 'Enables', ''), ['G1', 'G2', 'G3', 'G4', 'G5', 'G7', 'G8', 'G9'])
  assert.deepEqual(ids('G7', 'Enables', ''), ['G2', 'G3', 'G4', 'G5', 'G6', 'G8', 'G9'])
  assert.deepEqual(ids('G2', 'Also part of', ''), ['G5', 'G6', 'G7', 'G8', 'G9'])
  assert.deepEqual(ids('G6', 'Enables', 'fount'), ['G4'])
  // Every word, in any case and order; "garden" also finds "gardener's".
  assert.deepEqual(ids('G6', 'Enables', 'OPEN garden'), ['G5'])
  assert.deepEqual(ids('G6', 'Enables', 'garden'), ['G1', 'G5', 'G7'])
  assert.deepEqual(page.goalLinkChoices(goals, 'G6', 'Enables', 'spade')[0], { id: 'G8', title: 'A sharper spade', where: 'The gardener\'s tools' })
  assert.equal(page.goalLinkChoices(goals, 'G6', 'Enables', 'zebracorn')[0].where, null)
})

test('B256: the page sends a change to /api/goals and draws the file anew; the keys and the drag are wired', () => {
  assert.match(script, /fetch\('\/api\/goals'/)
  for (const key of ["'ArrowUp'", "'ArrowDown'", "'Tab'", "'F2'", "'Enter'", "'z'"]) assert.ok(script.includes(key), key)
  for (const event of ["'dragstart'", "'dragover'", "'drop'", "'dragend'"]) assert.ok(script.includes(event), event)
  assert.match(html, /id="goals-actions"/)
  assert.match(html, /id="goals-note"/)
  assert.match(html, /id="goals-chosen"/)
})

test('review: a goal of the game plan keeps its title, its Done when and its place; others get every tool', () => {
  const goals = stateGoals()
  const kinds = id => page.goalTools(goals.nodes.find(one => one.id === id)).map(([kind]) => kind)
  assert.deepEqual(kinds('G2'), ['add', 'Why', 'note', 'Also part of', 'Enables'])
  assert.deepEqual(kinds('G7'), ['add', 'rename', 'Done when', 'Why', 'note', 'Also part of', 'Enables', 'dissolve'])
  assert.deepEqual(kinds('G8').at(-1), 'delete')
})

test('review: the keys move a goal only from its title; the arrows walk the rows; a drag carries its own kind', () => {
  assert.match(script, /event\.target\.closest\('\.goal-title'\)/)
  assert.ok(script.includes("'ArrowRight'") && script.includes("'ArrowLeft'"))
  assert.ok(script.includes("'application/x-goal'"))
})
