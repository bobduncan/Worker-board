// B286: the Advisor tab lists the steps by where their refine stands: not refined, the Advisor on it now, your answers
// waiting, answered and waiting for the next round, ready; each row opens the step's window. Goal G17. Made-up
// samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const script = await readFile(join(here, '..', 'public', 'board.js'), 'utf8')
const html = await readFile(join(here, '..', 'public', 'index.html'), 'utf8')
const css = await readFile(join(here, '..', 'public', 'board.css'), 'utf8')

const page = {}
/** Out of the page's sandbox, as plain values. */
const plain = value => JSON.parse(JSON.stringify(value))
vm.runInNewContext(`${script.slice(script.indexOf('// refinelist:start'), script.indexOf('// refinelist:end'))}\nObject.assign(this, { refineGroups, REFINE_GROUPS })`, page)

const step = (id, refineState, more = {}) => ({ key: id, id, title: `Step ${id}`, status: 'open', refineState, ...more })
const BACKLOG = [
  { name: 'Work', steps: [step('B1', 'none'), step('B2', 'answers'), step('B3', 'ready', { status: 'queued' }), step('B4', 'none', { status: 'done' })] },
  { name: 'Look', steps: [step('B5', 'asking'), step('B6', 'answered'), step('B7', 'answers', { status: 'you' }), step('B8', 'none', { status: 'progress' }), step(null, 'none', { key: '1:0' })] },
]

test('the groups come in the order of a refine, each with its steps in the backlog\'s order', () => {
  const groups = plain(page.refineGroups(BACKLOG))
  assert.deepEqual(groups.map(group => group.state), ['none', 'asking', 'answers', 'answered', 'ready'])
  assert.deepEqual(groups.map(group => group.title), ['Not refined', 'The Advisor on it now', 'Your answers waiting', 'Answered, waiting for the next round', 'Ready'])
  assert.deepEqual(groups.map(group => group.steps.map(one => one.id)), [['B1'], ['B5'], ['B2'], ['B6'], ['B3']])
  // Each row carries what opens the step's window, and the activity it stands under.
  assert.deepEqual(groups[2].steps[0], { key: 'B2', id: 'B2', title: 'Step B2', activity: 'Work' })
})

test('never a finished step, one for the person, one in progress, or one without an id', () => {
  const ids = plain(page.refineGroups(BACKLOG)).flatMap(group => group.steps.map(one => one.id))
  for (const id of ['B4', 'B7', 'B8', null]) assert.equal(ids.includes(id), false, String(id))
  // An empty backlog gives every group, empty.
  assert.deepEqual(plain(page.refineGroups([])).map(group => group.steps.length), [0, 0, 0, 0, 0])
  assert.deepEqual(plain(page.refineGroups(undefined)).map(group => group.steps.length), [0, 0, 0, 0, 0])
})

test('the Advisor tab has a Refine part with its count of steps waiting for your answers, and it shows alone', () => {
  assert.match(html, /<button type="button" data-advisor-pane="refine" aria-pressed="false">Refine <small id="advisor-refine-count"><\/small><\/button>/)
  assert.match(html, /<section class="panel advisor-refine" id="advisor-refine" aria-label="The steps by where their refine stands"><\/section>/)
  assert.match(script, /const ADVISOR_PANES = \['way', 'goals', 'plan', 'suggestions', 'refine', 'chat'\]/)
  assert.match(css, /#view-advice > \.advisor-refine/)
  assert.match(css, /#view-advice\[data-pane="refine"\] > \.advisor-refine/)
})

test('a row opens the step\'s window, and the list is drawn anew when the backlog changes', () => {
  const draw = script.slice(script.indexOf('function drawRefineList('), script.indexOf('// refinelist:events'))
  assert.match(draw, /row\.dataset\.refineStep = one\.key/)
  assert.match(draw, /\$\('advisor-refine-count'\)\.textContent/)
  assert.match(script, /const row = event\.target\.closest\('\[data-refine-step\]'\)\n {2}if \(row !== null\) openDetails\(\{ step: row\.dataset\.refineStep \}\)/)
  assert.match(script, /once\('refine-list', \[state\.backlog \?\? null\], \(\) => drawRefineList\(state\)\)/)
})
