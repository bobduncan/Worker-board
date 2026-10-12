import assert from 'node:assert/strict'
import test from 'node:test'

import { forYou, openWork, parseBacklog, queue } from '../src/backlog.mjs'

const TEXT = `# Backlog

Some words about the format, with a \`- [ ]\` in them.

## Architecture #focus
- [x] Step 3: collision damage
- [ ] Step 4: a battle in one page (branch feature/battle-page)
  (handed to Game - Features on 2026-10-12)
- [ ] Say whether the run does what you intended @you

## Sound
- [ ] Say which plan the music came from @you
- [ ] Louder footsteps

## Next to hand out (Game - Main)
- [x] Hand out the archer
- [ ] Main menu (for Features; after the battle page merges; about 40 min)
- [ ] Level streaming (for Levels / Environment; about 2 h)
- [ ] When the beast merges: tell Game - Units the portrait is old
- [ ] Tidy the art inbox
`

const RULES = { prefix: 'Game - ', names: ['Main', 'Units', 'Features', 'Levels / Environment'] }
const backlog = parseBacklog(TEXT.replace(/\n/g, '\r\n'), RULES)

test('parseBacklog reads the activities and which are in the focus', () => {
  assert.deepEqual(backlog.activities.map(a => [a.name, a.isFocus]), [
    ['Architecture', true],
    ['Sound', false],
    ['Next to hand out (Game - Main)', false],
  ])
})

test('parseBacklog reads open and finished steps, and @you', () => {
  const steps = backlog.activities[0].steps
  assert.deepEqual(steps.map(s => [s.isDone, s.isYou]), [[true, false], [false, false], [false, true]])
  assert.equal(steps[2].text, 'Say whether the run does what you intended')
})

test('parseBacklog keeps the brackets in the text and picks out the branch and the worker', () => {
  const step = backlog.activities[0].steps[1]
  assert.equal(step.text, 'Step 4: a battle in one page (branch feature/battle-page)')
  assert.equal(step.branch, 'feature/battle-page')
  assert.equal(step.worker, 'Features')
})

test('parseBacklog adds an indented line to the step above it', () => {
  assert.deepEqual(backlog.activities[0].steps[1].notes, ['(handed to Game - Features on 2026-10-12)'])
})

test('queue: the open steps to hand out, with the worker, the condition and the time picked out', () => {
  assert.deepEqual(queue(backlog), [
    { text: 'Main menu (for Features; after the battle page merges; about 40 min)', title: 'Main menu', worker: 'Features', branch: null, after: 'the battle page merges', minutes: 40 },
    { text: 'Level streaming (for Levels / Environment; about 2 h)', title: 'Level streaming', worker: 'Levels / Environment', branch: null, after: null, minutes: 120 },
    { text: 'When the beast merges: tell Game - Units the portrait is old', title: 'When the beast merges: tell Game - Units the portrait is old', worker: 'Units', branch: null, after: null, minutes: null },
    { text: 'Tidy the art inbox', title: 'Tidy the art inbox', worker: null, branch: null, after: null, minutes: null },
  ])
})

test('forYou: every open step that ends in @you, with its activity', () => {
  assert.deepEqual(forYou(backlog), [
    { text: 'Say whether the run does what you intended', activity: 'Architecture' },
    { text: 'Say which plan the music came from', activity: 'Sound' },
  ])
})

test('openWork: the open steps of the focus, without the ones for the person', () => {
  assert.deepEqual(openWork(backlog), [
    { text: 'Step 4: a battle in one page (branch feature/battle-page)', activity: 'Architecture', worker: 'Features', branch: 'feature/battle-page' },
  ])
})

test('an empty or strange backlog gives empty lists', () => {
  const empty = parseBacklog('', RULES)
  assert.deepEqual([queue(empty), forYou(empty), openWork(empty)], [[], [], []])
  assert.deepEqual(parseBacklog('- [ ] a step before any heading', RULES).activities, [])
})
