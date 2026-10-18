// B316: "Hide done" on the Goals part. The person, 2026-10-18: "i want an option to hide complete goals/milestone in
// the diagram". A goal done with everything inside it done hides from the diagram and the outline; the goal zoomed
// into never does; a line says how many hide where they stood. Worked out without the page; made-up names only.
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
const css = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const made = {}
vm.runInNewContext(`${script.slice(script.indexOf('// goals:start'), script.indexOf('// goals:end'))}
Object.assign(this, { goalsHidden, goalsHideLabel, goalOutlineRows, goalTreeLayout })`, made)
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const page = Object.fromEntries(Object.entries(made).map(([name, made]) => [name, (...args) => plain(made(...args))]))
const hidden = (goals, focus) => made.goalsHidden(goals, focus)
const stateGoals = (text = GOALS) => {
  const goals = parseGoals(text)
  const counts = goalCounts(goals, parseBacklog(BACKLOG))
  return { roots: goals.roots, problems: goals.problems, nodes: goals.nodes.map(one => ({ ...one, counts: counts.get(one.id) ?? null })) }
}

// G3 and G8 are done with nothing inside; G10 is done with an open goal inside; G12 is done, and so is all inside it.
const MORE = `${GOALS.trimEnd()}
- [x] G10 The old shed
  - [ ] G11 Paint the door
- [x] G12 The first season
  Enables: G7
  - [x] G13 Plant the bulbs
    Also part of: G5
`

test('a goal hides when it is done and everything inside it is done; a done goal with an open goal inside stays', () => {
  const goals = stateGoals(MORE)
  assert.deepEqual([...hidden(goals, null)].sort(), ['G12', 'G13', 'G3', 'G8'])
  // Without the switch nothing hides: the page passes no set.
  assert.deepEqual(page.goalOutlineRows(goals, null, new Set()).map(row => row.id), ['G1', 'G7', 'G10', 'G12'])
  assert.equal(page.goalsHideLabel(4), 'Hide done (4)')
  assert.equal(page.goalsHideLabel(0), 'Hide done')
})

test('the goal zoomed into never hides, nor the goals on the way down to it (a link to a hidden goal shows it)', () => {
  const goals = stateGoals(MORE)
  assert.deepEqual([...hidden(goals, 'G13')].sort(), ['G3', 'G8'])
  assert.deepEqual([...hidden(goals, 'G3')].sort(), ['G12', 'G13', 'G8'])
  const rows = page.goalOutlineRows(goals, 'G13', new Set(), [...hidden(goals, 'G13')])
  assert.deepEqual(rows.filter(row => row.id !== null).map(row => row.id), ['G1', 'G7', 'G10', 'G12', 'G13'])
  // An unknown focus is the top.
  assert.deepEqual([...hidden(goals, 'G99')].sort(), ['G12', 'G13', 'G3', 'G8'])
})

test('the outline leaves hidden goals out and says per group how many hide there, after the goals that stay', () => {
  const goals = stateGoals(MORE)
  const top = page.goalOutlineRows(goals, null, new Set(['G7']), [...hidden(goals, null)])
  assert.deepEqual(top.map(row => row.id ?? `+${row.hidden}@${row.depth}`), ['G1', 'G7', 'G9', '+1@1', 'G10', '+1@0'])
  const inG2 = page.goalOutlineRows(goals, 'G2', new Set(), [...hidden(goals, 'G2')])
  assert.deepEqual(inG2.map(row => row.id ?? `+${row.hidden}@${row.depth}`), ['G1', 'G2', 'G4', '+1@2', 'G5', 'G7', 'G10', '+1@0'])
  // The line is lit as the rows around it, and the counters stay as they are: they count everything.
  assert.equal(inG2.find(row => row.id === null && row.depth === 2).isDim, false)
  assert.equal(inG2.find(row => row.id === 'G2').counter, '2 inside · 4 steps · 3 done · 1 missing')
  // A reference row to a hidden goal hides with it, and is no "+n".
  const inG5 = page.goalOutlineRows(goals, 'G5', new Set(), [...hidden(goals, 'G5')])
  assert.deepEqual(inG5.filter(row => row.isRef).map(row => row.id), ['G9'])
  assert.equal(inG5.some(row => row.id === null && row.depth === 2), false)
})

test('the diagram leaves hidden boxes, their arrows, references and ghosts out, with one line under the boxes', () => {
  const goals = stateGoals(MORE)
  const shown = page.goalTreeLayout(goals, null, 900)
  assert.deepEqual(shown.boxes.map(box => box.id), ['G1', 'G7', 'G10', 'G12'])
  assert.deepEqual(shown.arrows, [{ from: 'G7', to: 'G1' }, { from: 'G12', to: 'G7' }])
  assert.equal(shown.hiddenLine, null)
  const top = page.goalTreeLayout(goals, null, 900, [...hidden(goals, null)])
  assert.deepEqual(top.boxes.map(box => box.id), ['G1', 'G7', 'G10'])
  assert.deepEqual(top.arrows, [{ from: 'G7', to: 'G1' }])
  assert.equal(top.hiddenLine.count, 1)
  assert.ok(top.hiddenLine.y > top.boxes[0].y + top.boxes[0].h)
  assert.ok(top.height >= top.hiddenLine.y + 6)
  // Inside G5: the hidden G13 is no reference box there. Inside G7: no ghost from the hidden G12.
  assert.deepEqual(page.goalTreeLayout(goals, 'G5', 900).boxes.map(box => box.id), ['G6', 'G9', 'G13'])
  assert.deepEqual(page.goalTreeLayout(goals, 'G5', 900, [...hidden(goals, 'G5')]).boxes.map(box => box.id), ['G6', 'G9'])
  assert.deepEqual(page.goalTreeLayout(goals, 'G7', 900).ghosts.map(ghost => ghost.id), ['G12'])
  const inG7 = page.goalTreeLayout(goals, 'G7', 900, [...hidden(goals, 'G7')])
  assert.deepEqual([inG7.boxes.map(box => box.id), inG7.ghosts, inG7.hiddenLine.count], [['G9'], [], 1])
  // Every goal inside hidden: the frame stays, the line stands where the boxes would.
  const inG12 = page.goalTreeLayout(goals, 'G12', 900, [...hidden(goals, 'G12')])
  assert.deepEqual([inG12.frame.id, inG12.boxes, inG12.hiddenLine.count], ['G12', [], 1])
})

test('the switch stands in the bar beside Diagram and Outline, off by default; on a phone the bar\'s "…" holds it', () => {
  assert.match(html, /id="goals-hide-done"[^>]*aria-pressed="false"/)
  assert.match(html, /id="goals-bar-more"/)
  assert.match(script, /localStorage\.getItem\('goals-hide-done'\)/)
  assert.match(css, /\.goals-bar-more/)
})
