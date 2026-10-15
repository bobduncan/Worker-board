// B257: the goal tree beside the outline (spec 2026-10-15, section 2, zoom style 1): the focused goal as the frame,
// its goals inside as boxes in rows under it, with the part-of lines, the enables arrows and a ghost for an arrow's
// source outside the view. Worked out without the page; made-up names only.
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
Object.assign(this, { goalTitleLines, goalTreeDrop, goalTreeLayout })`, made)
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const page = Object.fromEntries(Object.entries(made).map(([name, made]) => [name, (...args) => plain(made(...args))]))
const stateGoals = (text = GOALS) => {
  const goals = parseGoals(text)
  const counts = goalCounts(goals, parseBacklog(BACKLOG))
  return { roots: goals.roots, problems: goals.problems, nodes: goals.nodes.map(one => ({ ...one, counts: counts.get(one.id) ?? null })) }
}

test('two goals stand centred in one row under the frame, with a trunk, a bus and a drop each', () => {
  const out = page.goalTreeLayout(stateGoals(), 'G1', 540)
  assert.deepEqual(out.boxes.map(box => box.id), ['G2', 'G5'])
  assert.equal(out.boxes[0].y, 180)
  assert.equal(out.boxes[0].x + out.boxes[0].w + 20, out.boxes[1].x)
  assert.equal(out.boxes[0].x, 540 - (out.boxes[1].x + out.boxes[1].w))
  assert.equal(out.lines.length, 1 + 1 + 2)
  assert.deepEqual(out.ghosts.map(ghost => [ghost.id, ghost.arrowTo]), [['G7', 'G1']])
  // The ghost stands at the right edge; the frame leaves it room.
  assert.equal(out.ghosts[0].x + out.ghosts[0].w, 540)
  assert.ok(out.frame.x + out.frame.w < out.ghosts[0].x)
  assert.ok(out.height >= out.boxes[0].y + out.boxes[0].h)
})

test('seven goals wrap into rows; a reference box stands with the goals inside; a top view has no frame', () => {
  const many = ['- [ ] G1 Root', ...['G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8'].map(id => `  - [ ] ${id} ${id}`)].join('\n')
  const out = page.goalTreeLayout(stateGoals(many), 'G1', 540)
  assert.deepEqual(out.boxes.map(box => box.row), [0, 0, 0, 1, 1, 1, 2])
  assert.equal(out.boxes[3].y, 300)
  // One bus per row, one drop per box, one trunk.
  assert.equal(out.lines.length, 1 + 3 + 7)
  const inG5 = page.goalTreeLayout(stateGoals(), 'G5', 540)
  assert.deepEqual(inG5.boxes.map(box => [box.id, box.kind]), [['G6', 'child'], ['G9', 'ref']])
  const top = page.goalTreeLayout(stateGoals(), null, 540)
  assert.equal(top.frame, null)
  assert.equal(top.lines.length, 0)
  assert.deepEqual(top.arrows.map(arrow => [arrow.from, arrow.to]), [['G7', 'G1']])
  assert.deepEqual(top.ghosts, [])
  // A narrow diagram has one box a row.
  assert.deepEqual(page.goalTreeLayout(stateGoals(many), 'G1', 200).boxes.map(box => box.row), [0, 1, 2, 3, 4, 5, 6])
})

test('an unknown focus is the top; an id used twice is one box', () => {
  assert.equal(page.goalTreeLayout(stateGoals(), 'G99', 540).frame, null)
  const twice = page.goalTreeLayout(stateGoals('- [ ] G1 One\n  - [ ] G2 Two\n  - [ ] G2 Again\n'), 'G1', 540)
  assert.deepEqual(twice.boxes.map(box => box.id), ['G2'])
})

test('a title is cut into two lines at a space, the second shortened with an ellipsis', () => {
  assert.deepEqual(page.goalTitleLines('Short one', 22), ['Short one'])
  assert.deepEqual(page.goalTitleLines('Five harder fights, and a real boss', 22), ['Five harder fights,', 'and a real boss'])
  assert.deepEqual(page.goalTitleLines('The polish you need to judge fun and more words beyond', 22), ['The polish you need to', 'judge fun and more wo…'])
  assert.deepEqual(page.goalTitleLines('Supercalifragilisticexpialidocious', 22), ['Supercalifragilistice…'])
})

test('a box dropped on another goes in its middle, before or after it at its sides', () => {
  const goals = stateGoals()
  const out = page.goalTreeLayout(goals, 'G1', 540)
  const g5 = out.boxes[1]
  assert.deepEqual(page.goalTreeDrop(goals, out, 'G9', g5.x + g5.w / 2, g5.y + 20), { place: 'into', over: 'G5', target: { parent: 'G5', index: 1 } })
  assert.deepEqual(page.goalTreeDrop(goals, out, 'G9', g5.x + 5, g5.y + 20), { place: 'before', over: 'G5', target: { parent: 'G1', index: 1 } })
  assert.deepEqual(page.goalTreeDrop(goals, out, 'G9', g5.x + g5.w - 5, g5.y + 20), { place: 'after', over: 'G5', target: { parent: 'G1', index: 2 } })
  // Into the frame: last inside the goal zoomed into. Nowhere: null. Into its own branch: no target.
  assert.deepEqual(page.goalTreeDrop(goals, out, 'G9', 20, 20), { place: 'into', over: 'G1', target: { parent: 'G1', index: 2 } })
  assert.equal(page.goalTreeDrop(goals, out, 'G9', 5, 500), null)
  assert.equal(page.goalTreeDrop(goals, out, 'G2', g5.x + g5.w / 2, g5.y + 20).target === null, false)
  const g2 = out.boxes[0]
  assert.equal(page.goalTreeDrop(goals, page.goalTreeLayout(goals, 'G2', 540), 'G2', 20, 20).target, null)
  assert.equal(g2.id, 'G2')
})

test('the page draws the tree as svg beside the outline, with a divider, both views switchable, the phone with the outline alone', () => {
  assert.ok(script.includes("createElementNS('http://www.w3.org/2000/svg'"))
  assert.match(html, /id="goals-resizer"/)
  assert.match(html, /data-goals-view="diagram"/)
  assert.match(html, /data-goals-view="outline"/)
  assert.match(css, /@media \(max-width: 760px\)[^}]*\.goals-split \{ flex-direction: column/)
})
