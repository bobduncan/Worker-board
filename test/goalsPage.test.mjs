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
Object.assign(this, { goalAddress, goalCounter, goalCrumb, goalFocusOf, goalFrameLine, goalFrameLines, goalOutlineRows })`, made)
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

test('the Advisor tab has the Goals part second, opened from the address, drawn when the map or the zoom changes', () => {
  assert.deepEqual([...html.matchAll(/data-advisor-pane="([a-z]+)"/g)].map(match => match[1]), ['way', 'goals', 'plan', 'suggestions', 'chat'])
  assert.match(html, /<section class="panel advisor-goals" id="advisor-goals"/)
  assert.match(script, /const ADVISOR_PANES = \['way', 'goals', 'plan', 'suggestions', 'chat'\]/)
  assert.match(script, /once\('goals', goalsData\(state\), \(\) => drawGoals\(state\)\)/)
  assert.match(script, /addEventListener\('popstate'/)
})
