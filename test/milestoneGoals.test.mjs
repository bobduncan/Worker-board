// B260: the Next milestone part reads the goal map instead of the Advisor's JSON (the Advisor's check, 2026-10-15):
// the first milestone of the game plan that is not done, its children as the row, the last child its own check (the
// milestone's box, as the Advisor writes it), its Recommendation line as the recommendation. Made-up samples only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { parseBacklog } from '../src/backlog.mjs'
import { parseGoals } from '../src/goals.mjs'
import { milestoneFromGoals, milestoneWay } from '../src/milestone.mjs'
import { BACKLOG, GOALS } from './fixtures-goals.mjs'

const way = (text, backlog = BACKLOG) => milestoneFromGoals(parseGoals(text), parseBacklog(backlog))

test('the first unfinished milestone from the plan is the way: its children the row, the last one its check', () => {
  const found = way(GOALS)
  assert.deepEqual(found.milestone, { name: 'M1', title: 'The paths are fun', doneWhen: '' })
  assert.deepEqual(found.nodes.map(node => [node.title, node.isGoal]), [['Lay the first path', false], ['Let the fountains sing', true]])
  assert.deepEqual(found.nodes[1].items.map(item => item.id), ['B03', 'B04'])
  assert.deepEqual(found.nodes[1].missing, ['a second fountain by the gate'])
  assert.deepEqual(found.recommendation, { id: 'R2', title: 'Add signposts at the forks', why: 'a visitor gets lost once per walk', cost: 'about 2 h', step: 'B44' })
  assert.equal(found.updated, '')
})

test('the counts are the ones the Advisor\'s map gave for the same content', () => {
  const map = {
    milestone: { name: 'M1', title: 'The paths are fun', doneWhen: '', check: 'Let the fountains sing', backlog: ['B03', 'B04'], missing: ['a second fountain by the gate'] },
    steps: [{ title: 'Lay the first path', backlog: ['B01', 'B02'], missing: [] }],
    recommendation: null, updated: '',
  }
  const old = milestoneWay(map, parseBacklog(BACKLOG))
  const now = way(GOALS)
  assert.deepEqual(now.nodes, old.nodes)
  assert.deepEqual(now.totals, { done: 3, open: 1, missing: 1, left: 2 })
  assert.deepEqual(now.totals, old.totals)
})

test('a milestone whose own lines name steps or missing things counts them in its box; one without children is that box alone', () => {
  const lone = way('- [~] G1 Garden\n  From the game plan: the goal\n  - [ ] G2 M1 · Alone\n    From the game plan: M1\n    Done when: the gate opens\n    Steps: B05\n    Missing: a key\n')
  assert.deepEqual(lone.milestone, { name: 'M1', title: 'Alone', doneWhen: 'the gate opens' })
  assert.deepEqual(lone.nodes.map(node => [node.title, node.isGoal, node.open, node.missing]), [['the gate opens', true, 1, ['a key']]])
  const both = way(GOALS.replace("    From the game plan: M1\n", "    From the game plan: M1\n    Steps: B06\n"))
  assert.deepEqual(both.nodes.at(-1).items.map(item => item.id), ['B06', 'B03', 'B04'])
})

test('the plan\'s goal itself, a done milestone and a goal not from the plan are passed over; none left: no way', () => {
  const second = way(GOALS.replace('  - [~] G2 M1 · The paths are fun', '  - [x] G2 M1 · The paths are fun'))
  assert.deepEqual([second.milestone.name, second.milestone.title], ['M2', 'The garden is open'])
  assert.deepEqual(second.nodes.map(node => node.title), ['Benches that match the picture'])
  assert.equal(second.recommendation, null)
  assert.equal(way('- [ ] G1 Loose\n  - [ ] G2 Not from the plan\n'), null)
  assert.equal(way('- [x] G1 Done\n  From the game plan: M1\n'), null)
  assert.equal(way('- [ ] G1 Only the goal\n  From the game plan: the goal\n'), null)
  // A title without " · " is the milestone's title, with no name.
  assert.deepEqual(way('- [ ] G1 Plain\n  From the game plan: M4\n').milestone, { name: 'M4', title: 'Plain', doneWhen: '' })
})
