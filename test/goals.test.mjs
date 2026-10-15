// The goal map (spec 2026-10-15, section 1): goals.md parsed into nodes with their lines, counted against the backlog.
import assert from 'node:assert/strict'
import test from 'node:test'

import { parseBacklog } from '../src/backlog.mjs'
import { goalCounts, parseGoals, nextAskId, nextGoalId } from '../src/goals.mjs'
import { BACKLOG, GOALS } from './fixtures-goals.mjs'

test('a goals file becomes nodes with id, state, depth, parent and children, in file order', () => {
  const goals = parseGoals(GOALS)
  assert.deepEqual(goals.problems, [])
  assert.deepEqual(goals.roots, ['G1', 'G7'])
  const g2 = goals.byId.get('G2')
  assert.equal(g2.title, 'M1 · The paths are fun')
  assert.equal(g2.state, 'now')
  assert.equal(g2.depth, 1)
  assert.equal(g2.parent, 'G1')
  assert.deepEqual(g2.children, ['G3', 'G4'])
  assert.equal(goals.byId.get('G3').state, 'done')
  assert.equal(goals.byId.get('G5').state, 'open')
})

test('the lines under a node are read by name', () => {
  const goals = parseGoals(GOALS)
  assert.equal(goals.byId.get('G1').doneWhen, 'a stranger walks the garden without a guide')
  assert.equal(goals.byId.get('G1').fromPlan, 'the goal')
  assert.deepEqual(goals.byId.get('G4').steps, ['B03', 'B04'])
  assert.deepEqual(goals.byId.get('G4').missing, ['a second fountain by the gate'])
  assert.deepEqual(goals.byId.get('G7').enables, ['G1'])
  assert.deepEqual(goals.byId.get('G9').alsoPartOf, ['G5'])
  assert.deepEqual(goals.byId.get('G2').recommendation, { id: 'R2', title: 'Add signposts at the forks', why: 'a visitor gets lost once per walk', cost: 'about 2 h', step: 'B44' })
  assert.deepEqual(goals.byId.get('G6').asks, [{ id: 'A1', at: '2026-10-15 18:40', text: 'what differs most from the picture?', answer: null, readAt: null }])
})

test('an answered ask carries its answer, its page and whether it was read', () => {
  const text = GOALS.replace('      Ask (A1, 2026-10-15 18:40): what differs most from the picture?',
    ['      Ask (A1, 2026-10-15 18:40): what differs most from the picture?',
      '      Answer (2026-10-15 19:20, Advisor): the shading: three tones there, one here.',
      '      More: .claude/goal-asks/2026-10-15-benches.md',
      '      Read: 2026-10-15 19:40'].join('\n'))
  const ask = parseGoals(text).byId.get('G6').asks[0]
  assert.deepEqual(ask.answer, { at: '2026-10-15 19:20', by: 'Advisor', text: 'the shading: three tones there, one here.', more: '.claude/goal-asks/2026-10-15-benches.md' })
  assert.equal(ask.readAt, '2026-10-15 19:40')
})

test('the next ids are the highest plus one, over the whole file', () => {
  const goals = parseGoals(GOALS)
  assert.equal(nextGoalId(goals), 'G10')
  assert.equal(nextAskId(goals), 'A2')
  assert.equal(nextAskId(parseGoals('- [ ] G1 Alone\n')), 'A1')
})

test('a broken file is still a map, with each problem named once (Review Focus 1)', () => {
  const twice = parseGoals('- [ ] G1 One\n- [ ] G1 Two\n')
  assert.equal(twice.nodes.length, 2)
  assert.deepEqual(twice.problems, ['line 2: the id G1 is used twice'])
  const odd = parseGoals('- [ ] G1 One\n   - [ ] G2 Three spaces\n')
  assert.deepEqual(odd.problems, ['line 2: indentation is not a multiple of two spaces'])
  assert.equal(odd.byId.get('G2').parent, 'G1')
  const loose = parseGoals('  Done when: nothing above\n- [ ] G1 One\n')
  assert.deepEqual(loose.problems, ['line 1: a line under no goal'])
  assert.deepEqual(parseGoals('').roots, [])
})

test('the file\'s own words at the margin (its rules on top) are no problem and belong to no goal', () => {
  const goals = parseGoals(['# Goals', '', 'Rules: a goal is one line "- [ ] G<n> <title>";', 'two spaces of indentation per level is "part of".', '', GOALS].join('\n'))
  assert.deepEqual(goals.problems, [])
  assert.deepEqual(goals.byId.get('G1').notes, [])
  assert.deepEqual(goals.roots, ['G1', 'G7'])
})

test('a named line in a form the map does not know is kept as a note, never a crash', () => {
  const goals = parseGoals(['- [ ] G1 One', '  Recommendation: no id here', '  Ask: no id either', '  Answer: to nothing', '  Read: never'].join('\n'))
  assert.deepEqual(goals.problems, [])
  const one = goals.byId.get('G1')
  assert.equal(one.recommendation, null)
  assert.deepEqual(one.asks, [])
  assert.deepEqual(one.notes, ['Recommendation: no id here', 'Ask: no id either', 'Answer: to nothing', 'Read: never'])
})

test('a node counts the nodes and the steps inside it once each, done, open, unknown and missing (Review Focus 3)', () => {
  const counts = goalCounts(parseGoals(GOALS), parseBacklog(BACKLOG))
  // G2 holds G3 (B01, B02) and G4 (B03, B04): four steps, three done, one missing line.
  assert.deepEqual(counts.get('G2'), { nodes: 2, steps: 4, done: 3, open: 1, unknown: 0, missing: 1 })
  // G1 holds G2's four and G6's B04, B05: B04 is counted once over the whole of G1.
  assert.deepEqual(counts.get('G1'), { nodes: 5, steps: 5, done: 3, open: 2, unknown: 0, missing: 1 })
  // G9's home is G7; it is also part of G5, but counts under its home only.
  assert.deepEqual(counts.get('G7'), { nodes: 2, steps: 2, done: 1, open: 1, unknown: 0, missing: 0 })
  assert.deepEqual(counts.get('G5'), { nodes: 1, steps: 2, done: 1, open: 1, unknown: 0, missing: 0 })
  // A step that is not on the backlog is unknown, not open.
  const odd = goalCounts(parseGoals('- [ ] G1 A\n  Steps: B99\n'), parseBacklog(BACKLOG))
  assert.deepEqual(odd.get('G1'), { nodes: 0, steps: 1, done: 0, open: 0, unknown: 1, missing: 0 })
})

test('an id used twice, the second inside the first, is counted without going round in circles', () => {
  const goals = parseGoals('- [ ] G1 One\n  - [ ] G2 Two\n    - [ ] G1 One again\n      Steps: B01\n')
  assert.deepEqual(goals.problems, ['line 3: the id G1 is used twice'])
  const counts = goalCounts(goals, parseBacklog(BACKLOG))
  assert.deepEqual(counts.get('G2'), { nodes: 0, steps: 0, done: 0, open: 0, unknown: 0, missing: 0 })
  assert.deepEqual(counts.get('G1'), { nodes: 1, steps: 0, done: 0, open: 0, unknown: 0, missing: 0 })
})

test('the starting map in examples/ is in the form, with no problem', async () => {
  const { readFile } = await import('node:fs/promises')
  const goals = parseGoals(await readFile(new URL('../examples/goals.md', import.meta.url), 'utf8'))
  assert.deepEqual(goals.problems, [])
  assert.deepEqual(goals.roots, ['G1', 'G6'])
  assert.deepEqual(goals.byId.get('G7').alsoPartOf, ['G2'])
})

test('review: a file as editors save it reads the same: a byte-order mark, Windows line ends, tabs named once', () => {
  assert.deepEqual(parseGoals('﻿- [ ] G1 A\n').roots, ['G1'])
  assert.deepEqual(parseGoals('- [ ] G1 A\r\n  Steps: B01\r\n').byId.get('G1').steps, ['B01'])
  const tabbed = parseGoals('- [ ] G1 A\n\t- [ ] G2 B\n\t\tSteps: B01\n')
  assert.deepEqual(tabbed.problems, ['line 2: indented with a tab, not two spaces per level', 'line 3: indented with a tab, not two spaces per level'])
  assert.equal(tabbed.byId.get('G2').parent, 'G1')
  assert.deepEqual(tabbed.byId.get('G2').steps, ['B01'])
})

test('review: a line that looks like a goal but is not in the form is named, never lost into a note', () => {
  const goals = parseGoals(['- [ ] G1 One', '  - [ ] G2: colon', '  - [ ] g3 small', '  - [ ] G4', '- [?] G5 odd box'].join('\n'))
  const form = 'is not a goal in the form "- [ ] G<n> <title>"'
  assert.deepEqual(goals.problems, [`line 2: ${form}`, `line 3: ${form}`, `line 4: ${form}`, `line 5: ${form}`])
  assert.deepEqual(goals.byId.get('G1').notes, [])
  assert.deepEqual(goals.roots, ['G1'])
})

test('review: a named line belongs to the goal one level less indented, also after that goal\'s children', () => {
  const goals = parseGoals('- [ ] G1 A\n  - [ ] G2 B\n    Steps: B02\n  Steps: B01\n')
  assert.deepEqual(goals.byId.get('G1').steps, ['B01'])
  assert.deepEqual(goals.byId.get('G2').steps, ['B02'])
})

test('review: an id used twice stands once among the top goals; an empty file is an empty map', () => {
  assert.deepEqual(parseGoals('- [ ] G1 One\n- [ ] G1 Two\n').roots, ['G1'])
  assert.deepEqual(parseGoals('- [ ] G1 One\n  - [ ] G2 Two\n  - [ ] G2 Again\n').byId.get('G1').children, ['G2'])
  const empty = parseGoals('# Goals\n\nRules: none yet.\n')
  assert.deepEqual([empty.nodes, empty.roots, empty.problems], [[], [], []])
})

test('an id is never used again: the head line "Last id:" counts beside the highest id in the file, "Last ask:" too', () => {
  const kept = parseGoals(['# Goals', 'Last id: G20', 'Last ask: A7', '', GOALS].join('\n'))
  assert.equal(nextGoalId(kept), 'G21')
  assert.equal(nextAskId(kept), 'A8')
  assert.deepEqual(kept.problems, [])
  // A head line below the highest id in the file: the file's id wins. No line: the highest id plus one.
  assert.equal(nextGoalId(parseGoals('Last id: G2\n- [ ] G5 Five\n')), 'G6')
  assert.equal(nextGoalId(parseGoals(GOALS)), 'G10')
})
