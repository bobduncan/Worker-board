import assert from 'node:assert/strict'
import test from 'node:test'

import { closedForYou, forYou, noteSections, openWork, parseBacklog, queue } from '../src/backlog.mjs'

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
    { id: null, text: 'Main menu (for Features; after the battle page merges; about 40 min)', title: 'Main menu', worker: 'Features', branch: null, after: 'the battle page merges', minutes: 40, notes: [], refined: null },
    { id: null, text: 'Level streaming (for Levels / Environment; about 2 h)', title: 'Level streaming', worker: 'Levels / Environment', branch: null, after: null, minutes: 120, notes: [], refined: null },
  ])
  // B172: under "Next to hand out" too, a step that names no worker in its note waits for the main chat, not for a
  // worker: a chat named in its words ("tell Game - Units") does not make it that chat's.
  assert.ok(!queue(backlog).some(step => /beast merges|art inbox/.test(step.text)))
})

test('an open step starts with its id, before its kind; the id is not part of its words', () => {
  const text = '## Art\n- [ ] B14 Verify: the walk is smooth (pictures in art-inbox/archer; Game - Units) @you\n- [ ] B7 Draw the bat\n- [x] B03 Do: quit the app @you\n- [ ] Build B12 later\n\n## Next to hand out (Game - Main)\n- [ ] B59 Redraw the portrait (for Features; after the camera; about 20 min)\n'
  const backlog = parseBacklog(text, RULES)
  assert.deepEqual(backlog.activities[0].steps.map(step => [step.id, step.asks, step.title]), [
    ['B14', 'verify', 'the walk is smooth (pictures in art-inbox/archer; Game - Units)'],
    ['B7', null, 'Draw the bat'],
    ['B03', 'do', 'quit the app'],
    [null, null, 'Build B12 later'],
  ])
  assert.deepEqual(forYou(backlog).map(step => [step.id, step.asks, step.worker]), [['B14', 'verify', 'Units']])
  assert.deepEqual(queue(backlog).map(step => [step.id, step.title, step.worker, step.minutes]), [['B59', 'Redraw the portrait', 'Features', 20]])
})

test('the indented lines under a step are its details, in sections', () => {
  const text = [
    '## Next to hand out (Game - Main)',
    '- [ ] B59 Redraw the beast\'s portrait (for Features; branch feature/hud-portrait; about 20 min)',
    '  The portrait on the HUD uses the old concept.',
    '  Redraw it in the current style.',
    '  Requirements:',
    '  - Same style as the other icons',
    '  * Readable at 32 by 32',
    '  Context: Focus on the face. See art-inbox/shadow-beast.',
    '  (handed over on 2026-10-12: no)',
    '- [ ] B60 Tidy (for Units)',
  ].join('\n')
  const [portrait, tidy] = queue(parseBacklog(text, RULES))
  assert.deepEqual(portrait.notes, [
    { title: null, lines: ['The portrait on the HUD uses the old concept.', 'Redraw it in the current style.'], points: [] },
    { title: 'Requirements', lines: [], points: ['Same style as the other icons', 'Readable at 32 by 32'] },
    { title: 'Context', lines: ['Focus on the face. See art-inbox/shadow-beast.', '(handed over on 2026-10-12: no)'], points: [] },
  ])
  assert.deepEqual([portrait.branch, tidy.notes], ['feature/hud-portrait', []])
  assert.deepEqual(noteSections(['- only a point', 'http://example.com: not a name']), [{ title: null, lines: ['http://example.com: not a name'], points: ['only a point'] }])
})

test('closedForYou: the steps for the person that are ticked, with their id and kind', () => {
  const text = '## Art\n- [x] B03 Verify: the mage is right @you\n- [x] Say whether the knight is right @you\n- [ ] B14 Decide: the bridge @you\n- [x] B20 Draw the bat\n'
  const backlog = parseBacklog(text, RULES)
  assert.deepEqual(closedForYou(backlog).map(step => [step.id, step.asks, step.title, step.activity]), [
    ['B03', 'verify', 'the mage is right', 'Art'],
    [null, null, 'Say whether the knight is right', 'Art'],
  ])
  assert.deepEqual(forYou(backlog).map(step => step.id), ['B14'])
})

test('queue: a condition with brackets of its own, and a time in hours and minutes', () => {
  const text = '## Next to hand out (Game - Main)\n- [ ] Knight rows (for Units; after the archer (branch fix/archer-walk) merges; about 1 h 30 min)\n- [ ] Tidy (for Units; about 1.5 hours)\n'
  assert.deepEqual(queue(parseBacklog(text, RULES)).map(step => [step.title, step.worker, step.after, step.minutes]), [
    ['Knight rows', 'Units', 'the archer (branch fix/archer-walk) merges', 90],
    ['Tidy', 'Units', null, 90],
  ])
})

test('forYou: every open step that ends in @you, with its activity', () => {
  assert.deepEqual(forYou(backlog), [
    { id: null, text: 'Say whether the run does what you intended', title: 'Say whether the run does what you intended', asks: null, worker: null, branch: null, notes: [], activity: 'Architecture' },
    { id: null, text: 'Say which plan the music came from', title: 'Say which plan the music came from', asks: null, worker: null, branch: null, notes: [], activity: 'Sound' },
  ])
})

test('forYou: a step says what it asks of the person, and names the worker it is about', () => {
  const text = '## Art\n- [ ] Verify: the bone ranger walks smoothly (pictures in art-inbox/archer) @you\n- [ ] decide: accept the bridge or continue (options in Game - Levels / Environment) @you\n- [ ] Provide: the Suno plan @you\n- [ ] Do: quit the app once @you\n'
  assert.deepEqual(forYou(parseBacklog(text, RULES)).map(step => [step.asks, step.title, step.worker]), [
    ['verify', 'the bone ranger walks smoothly (pictures in art-inbox/archer)', null],
    ['decide', 'accept the bridge or continue (options in Game - Levels / Environment)', 'Levels / Environment'],
    ['provide', 'the Suno plan', null],
    ['do', 'quit the app once', null],
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
