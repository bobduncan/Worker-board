// B328: with no focus goal (none picked yet, or the last one done), the simple view's bar counts the next milestone
// instead (the person's answer of 2026-10-18, brainstorm "Board easier day to day"; picture
// art-inbox/board-highover/simple-view.png, its last line): the milestone the goal map's Next milestone row shows,
// every step under it, its sub-goals' too: "M1 · The loop is fun · 9 of 23 steps done · about 30 h left". Made-up
// samples only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { parseBacklog } from '../src/backlog.mjs'
import { parseGoals } from '../src/goals.mjs'
import { milestoneFromGoals } from '../src/milestone.mjs'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('stepline')}\n${cut('lanetime')}\n${cut('lanewindow')}\n${cut('calmoverview')}\n${cut('focus')}\n${cut('simpleoverview')}\nObject.assign(this, { simpleView })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

const GOALS = [
  '- [~] G1 Garden', '  From the game plan: the goal', '',
  '  - [ ] G2 M1 · The paths are fun', '    From the game plan: M1', '    Done when: a visitor walks it all', '    Steps: B05',
  '    - [~] G3 Lay the first path', '      Steps: B01, B02',
  '    - [ ] G4 Let the fountains sing', '      Steps: B03, B04, B02', '      Missing: a second fountain', '',
].join('\n')
const BACKLOG = [
  '# Backlog', '', '## Paths', '',
  '- [x] B01 Lay the stones (about 1 h)',
  '- [x] B02 Rake the gravel (about 30 min)',
  '- [ ] B03 Dig the basin (about 2 h)',
  '- [ ] B04 Pipe the water (about 1 h 30 min)',
  '- [ ] B05 Walk it all (no time named)', '',
].join('\n')

test('the milestone counts the time its open steps name: the minutes of each, and their sum', () => {
  const way = milestoneFromGoals(parseGoals(GOALS), parseBacklog(BACKLOG))
  assert.deepEqual(way.nodes[1].items.map(item => [item.id, item.minutes]), [['B03', 120], ['B04', 90]])
  // B05 names no time: it counts as a step, not as time; B02, in two sub-goals, counts once
  assert.deepEqual(way.totals, { done: 2, open: 3, missing: 1, left: 4, minutesLeft: 210 })
})

const MILESTONE = { milestone: { name: 'M1', title: 'The loop is fun', doneWhen: '' }, totals: { done: 9, open: 14, missing: 0, left: 14, minutesLeft: 30 * 60 }, isMapped: true }
const AT = new Date(2026, 9, 18, 19, 0).getTime()

test('no focus: the bar counts the next milestone, its steps done of all and the time its open steps name', () => {
  const view = page.simpleView({ focus: null, milestone: MILESTONE }, AT)
  assert.deepEqual(plain(view.bar), { text: 'M1 · The loop is fun · 9 of 23 steps done · about 30 h left', percent: 39, title: 'The next milestone, M1 · The loop is fun' })
  // a time that none of its open steps names is left out; a milestone without steps yet says so, without a count
  assert.equal(page.simpleView({ milestone: { ...MILESTONE, totals: { ...MILESTONE.totals, minutesLeft: null } } }, AT).bar.text, 'M1 · The loop is fun · 9 of 23 steps done')
  assert.deepEqual(plain(page.simpleView({ milestone: { ...MILESTONE, totals: { done: 0, open: 0, missing: 3, left: 3, minutesLeft: null } } }, AT).bar), { text: 'M1 · The loop is fun · no steps of it on the board yet', percent: null, title: 'The next milestone, M1 · The loop is fun' })
  // the parts its Missing lines name are not made yet: all steps done is not all of it
  assert.equal(page.simpleView({ milestone: { ...MILESTONE, totals: { done: 5, open: 0, missing: 2, left: 2, minutesLeft: null } } }, AT).bar.text, 'M1 · The loop is fun · 5 of 5 steps done, 2 not made yet')
  // a milestone the Advisor has not mapped yet says so, as the Next milestone row does
  assert.deepEqual(plain(page.simpleView({ milestone: { ...MILESTONE, isMapped: false } }, AT).bar), { text: 'M1 · The loop is fun · not mapped yet', percent: null, title: 'The next milestone, M1 · The loop is fun' })
  // no focus and no milestone: no bar, as before
  assert.equal(page.simpleView({ focus: null, milestone: null }, AT).bar, null)
})

test('the last focus goal done: the milestone again; a focus at work: the focus, as before', () => {
  const done = { id: 'G12', title: 'Fights you can read', stage: 'done', progress: { done: 3, total: 3, minutesLeft: 0 } }
  assert.equal(page.simpleView({ focus: done, milestone: MILESTONE }, AT).bar.text, 'M1 · The loop is fun · 9 of 23 steps done · about 30 h left')
  // with no milestone left to count, the done goal stays
  assert.equal(page.simpleView({ focus: done, milestone: null }, AT).bar.text, 'Focus G12 · Fights you can read · 3 of 3 steps done')
  const run = { ...done, stage: 'run', progress: { done: 1, total: 3, minutesLeft: 60 } }
  assert.equal(page.simpleView({ focus: run, milestone: MILESTONE }, AT).bar.text, 'Focus G12 · Fights you can read · 1 of 3 steps done · about 1 h left')
  // a focus picked but before its run is still the focus
  assert.equal(page.simpleView({ focus: { ...run, stage: 'vibe' }, milestone: MILESTONE }, AT).bar.text, 'Focus G12 · Fights you can read · agreeing the vibe')
})

test('the page passes the milestone to the bar', () => {
  assert.match(script, /simpleView\(\{ focus: state\.focus \?\? null, counts: state\.counts \?\? \{\}, limits: state\.limits \?\? null, milestone: state\.milestone \?\? null \}\)/)
})
