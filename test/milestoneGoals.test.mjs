// B260: the Next milestone part reads the goal map instead of the Advisor's JSON (the Advisor's check, 2026-10-15):
// the first milestone of the game plan that is not done; every sub-goal is a box of the row, counted over everything
// inside it; the milestone itself is the last box (⚑, its Done when line); its Recommendation line is the
// recommendation. Made-up samples only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { parseBacklog } from '../src/backlog.mjs'
import { parseGoals } from '../src/goals.mjs'
import { milestoneFromGoals, milestoneWay } from '../src/milestone.mjs'
import { BACKLOG, GOALS } from './fixtures-goals.mjs'

const way = (text, backlog = BACKLOG) => milestoneFromGoals(parseGoals(text), parseBacklog(backlog))
const PLAN = '- [~] G1 Garden\n  From the game plan: the goal\n'

test('the first unfinished milestone from the plan is the way: its sub-goals the row, the milestone itself the last box', () => {
  const found = way(GOALS)
  assert.deepEqual(found.milestone, { name: 'M1', title: 'The paths are fun', doneWhen: '' })
  assert.deepEqual(found.nodes.map(node => [node.title, node.isGoal]), [['Lay the first path', false], ['Let the fountains sing', false], ['The paths are fun', true]])
  assert.deepEqual(found.nodes[1].items.map(item => item.id), ['B03', 'B04'])
  assert.deepEqual(found.nodes[1].missing, ['a second fountain by the gate'])
  assert.deepEqual(found.recommendation, { id: 'R2', title: 'Add signposts at the forks', why: 'a visitor gets lost once per walk', cost: 'about 2 h', step: 'B44' })
  assert.equal(found.isMapped, true)
})

test('the counts are the ones the Advisor\'s map gave for the same content', () => {
  const map = {
    milestone: { name: 'M1', title: 'The paths are fun', doneWhen: '', check: '', backlog: [], missing: [] },
    steps: [{ title: 'Lay the first path', backlog: ['B01', 'B02'], missing: [] }, { title: 'Let the fountains sing', backlog: ['B03', 'B04'], missing: ['a second fountain by the gate'] }],
    recommendation: null, updated: '',
  }
  const old = milestoneWay(map, parseBacklog(BACKLOG))
  const now = way(GOALS)
  assert.deepEqual(now.nodes, old.nodes)
  assert.deepEqual(now.totals, { done: 3, open: 1, missing: 1, left: 2 })
})

test('the milestone\'s box is its Done when with its own lines; a milestone without sub-goals is not mapped yet', () => {
  const lone = way(`${PLAN}  - [ ] G2 M1 · Alone\n    From the game plan: M1\n    Done when: the gate opens\n    Steps: B05\n    Missing: a key\n`)
  assert.deepEqual(lone.milestone, { name: 'M1', title: 'Alone', doneWhen: 'the gate opens' })
  assert.deepEqual(lone.nodes.map(node => [node.title, node.isGoal, node.open, node.missing]), [['the gate opens', true, 1, ['a key']]])
  assert.equal(lone.isMapped, false)
})

test('review: a box counts everything inside its sub-goal, each step once; a ticked sub-goal without steps is done', () => {
  const deep = way(`${PLAN}  - [ ] G2 M1 · Deep\n    From the game plan: M1\n    - [ ] G3 A step\n      Steps: B01\n      - [ ] G4 Inside it\n        Steps: B01, B03\n        Missing: a lantern\n    - [x] G5 Ticked by hand\n`)
  assert.deepEqual(deep.nodes.map(node => [node.title, node.items.map(item => item.id), node.missing, node.state]), [
    ['A step', ['B01', 'B03'], ['a lantern'], 'part'],
    ['Ticked by hand', [], [], 'done'],
    ['Deep', [], [], 'none'],
  ])
})

test('review: every sub-goal is a box, also past eight', () => {
  const many = Array.from({ length: 10 }, (_, n) => `    - [ ] G${n + 3} Step ${n + 1}\n`).join('')
  assert.equal(way(`${PLAN}  - [ ] G2 M1 · Long\n    From the game plan: M1\n${many}`).nodes.length, 11)
})

test('review: an empty recommendation is none; the title loses only the plan\'s own name', () => {
  const blank = way(GOALS.replace('Recommendation (R2): Add signposts at the forks · a visitor gets lost once per walk · about 2 h · B44', 'Recommendation (R2):'))
  assert.equal(blank.recommendation, null)
  assert.deepEqual(way(`${PLAN}  - [ ] G2 Fun · fast\n    From the game plan: M1\n`).milestone, { name: 'M1', title: 'Fun · fast', doneWhen: '' })
  assert.deepEqual(way(`${PLAN}  - [ ] G2 M1 · Fun · fast\n    From the game plan: M1\n`).milestone.title, 'Fun · fast')
})

test('the plan\'s goal itself, a done milestone, a bare or odd plan line and a goal not from the plan are passed over', () => {
  const second = way(GOALS.replace('  - [~] G2 M1 · The paths are fun', '  - [x] G2 M1 · The paths are fun'))
  assert.deepEqual([second.milestone.name, second.milestone.title], ['M2', 'The garden is open'])
  assert.deepEqual(second.nodes.map(node => node.title), ['Benches that match the picture', 'The garden is open'])
  assert.equal(second.recommendation, null)
  assert.equal(way('- [ ] G1 Loose\n  - [ ] G2 Not from the plan\n'), null)
  assert.equal(way('- [x] G1 Done\n  From the game plan: M1\n'), null)
  assert.equal(way('- [ ] G1 Only the goal\n  From the game plan: the goal\n'), null)
  assert.equal(way('- [ ] G1 Only the goal\n  From the game plan: The goal.\n'), null)
  assert.equal(way('- [ ] G1 Bare\n  From the game plan:\n'), null)
  assert.deepEqual(way('- [ ] G1 Plain\n  From the game plan: M4.\n').milestone, { name: 'M4', title: 'Plain', doneWhen: '' })
})
