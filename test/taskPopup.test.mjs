// B425: the window of a worker's task says what it builds. The person, 2026-10-19 (I40, of B394's window): "It's
// title is too long and i dont see what its building. if backlog items were refined I expect to see a picture and the
// refined story here?" A short title (the whole one on hover), the goal by its name, then the step's refined summary,
// its picture and what we build; a step without a refine block shows the first lines of its context. Made-up samples
// only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { fromChat, step, toolResult } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 19, 16, 0)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const GOALS = ['# Goals', '', '- [~] G29 Zebracorn meadows worth walking', '  Steps: B12', ''].join('\n')

const REFINED = [
  '## Meadows',
  '- [ ] B12 Build the Clover, the Thistle and the Ring as meadow maps, each crossed by the test herd (for Units; about 2 h) (branch feature/meadows)',
  '  [store] Priority: fix · Goal: G29',
  '  The herd asked for three meadows. Requirements: three maps, each crossed.',
  '  Touches: src/meadows, tests.',
  '  Refined (2026-10-19 15:00; ready):',
  '  Summary: Three new meadows for the zebracorns,',
  '  each one crossed by the test herd before it ships.',
  '  Picture: art-inbox/meadows/plan.png (the three meadows side by side)',
  '  Size: about 2 hours',
  '  What we build:',
  '  - The Clover, the Thistle and the Ring as meadow maps.',
  '  - Not in it: a fourth meadow.',
  '',
].join('\n')

const PLAIN = [
  '## Meadows',
  '- [ ] B12 Fence the meadow: a gate on the north side that only the gardener opens, so the herd stays in (for Units; about 1 h) (branch feature/fence)',
  '  [store] Goal: G29',
  '  The herd keeps walking off the north edge. A gate there keeps it in.',
  '  The gate opens for the gardener only.',
  '  Requirements: a gate, a fence.',
  '  Touches: src/fence.',
  '',
].join('\n')

const app = name => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
const card = JSON.stringify({
  name: 'Units', role: 'worker', state: 'working',
  task: { text: 'Meadow maps', step: 1, steps: 2, left: 20 * MIN, isReported: false, names: ['Draw', 'Test'], stepLeft: 8 * MIN, since: NOW - 30 * MIN },
  at: NOW - 2 * MIN,
})
const LINES = [fromChat(NOW - 40 * MIN, 'Game - Main', 'work: B12 is yours'), step(NOW - 2 * MIN, 'Draw'), toolResult(NOW - MIN)]

function lane(backlogText, goalsText = GOALS) {
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: [app('Main'), app('Units')],
    tails: { 'cli-Units': { text: LINES.join('\n'), isCut: false, modifiedAt: NOW - MIN } },
    planLineTexts: { 'cli-Units': card },
    backlogText, goalsText, adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], now: NOW, config }).chats.find(chat => chat.name === 'Units')
}

const HERE = dirname(fileURLToPath(import.meta.url))
const script = await readFile(join(HERE, '..', 'public', 'board.js'), 'utf8')
const style = await readFile(join(HERE, '..', 'public', 'board.css'), 'utf8')
const design = await readFile(join(HERE, '..', 'DESIGN.md'), 'utf8')
const stateSource = await readFile(join(HERE, '..', 'src', 'state.mjs'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('stepline')}\n${cut('lanetime')}\n${cut('lanewindow')}\nObject.assign(this, { laneWindowOf, shortTitle })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

// In the state

test('a lane on a refined step carries its brief: summary, picture, what we build, its goal by name, its context', () => {
  const units = lane(REFINED)
  assert.equal(units.givenTask.step.id, 'B12')
  assert.deepEqual(plain(units.givenTask.step.brief), {
    goal: 'G29 Zebracorn meadows worth walking',
    summary: ['Three new meadows for the zebracorns,', 'each one crossed by the test herd before it ships.'],
    picture: 'art-inbox/meadows/plan.png (the three meadows side by side)',
    what: ['The Clover, the Thistle and the Ring as meadow maps.', 'Not in it: a fourth meadow.'],
    about: ['The herd asked for three meadows.'],
    context: ['The herd asked for three meadows. Requirements: three maps, each crossed.', 'Touches: src/meadows, tests.'],
    touches: ['src/meadows, tests.'],
    history: units.givenTask.step.brief.history,
  })
  assert.ok(units.givenTask.step.brief.history.length > 0)
  // What a step is, said in a line, is never the store's own line.
  assert.equal(units.givenTask.step.about, 'The herd asked for three meadows. Requirements: three maps, each crossed.')
})

test('a goal the map does not name stays its id; a step without a goal has none; without a goal map, its id', () => {
  assert.equal(lane(REFINED, '# Goals\n').givenTask.step.brief.goal, 'G29')
  assert.equal(lane(REFINED, null).givenTask.step.brief.goal, 'G29')
  assert.equal(lane(REFINED.replace('  [store] Priority: fix · Goal: G29\n', '')).givenTask.step.brief.goal, null)
})

// On the page

test('a refined step: a short title with the whole one on hover, the goal as a chip, the summary, picture and what we build', () => {
  const view = plain(page.laneWindowOf(lane(REFINED), NOW, 'Game - Main'))
  assert.equal(view.code, 'B12')
  assert.equal(view.title, 'Build the Clover, the Thistle and the Ring as meadow maps')
  assert.equal(view.fullTitle, 'Build the Clover, the Thistle and the Ring as meadow maps, each crossed by the test herd')
  assert.deepEqual(view.chips.map(chip => chip.text), ['Working', 'Worker: Units', 'G29 Zebracorn meadows worth walking'])
  assert.equal(view.chips[2].tone, 'goal')
  assert.deepEqual(view.refined, {
    summary: 'Three new meadows for the zebracorns, each one crossed by the test herd before it ships.',
    picture: 'art-inbox/meadows/plan.png (the three meadows side by side)',
    what: ['The Clover, the Thistle and the Ring as meadow maps.', 'Not in it: a fourth meadow.'],
  })
  // The title no longer stands twice, and the store's own line is not the task.
  assert.equal(view.taskHead, undefined)
  assert.ok(!JSON.stringify(view).includes('[store]'))
})

test('a step without a refine block: no refined part, the first lines of its context instead', () => {
  const view = plain(page.laneWindowOf(lane(PLAIN), NOW, 'Game - Main'))
  // The first clause is too short to say anything ("Fence the meadow"): up to the next one.
  assert.equal(view.title, 'Fence the meadow: a gate on the north side that only the gardener opens')
  assert.equal(view.fullTitle, 'Fence the meadow: a gate on the north side that only the gardener opens, so the herd stays in')
  assert.equal(view.refined, null)
  assert.equal(view.task, 'The herd keeps walking off the north edge. A gate there keeps it in. The gate opens for the gardener only.')
  assert.deepEqual(view.chips.map(chip => chip.text), ['Working', 'Worker: Units', 'G29 Zebracorn meadows worth walking'])
})

test('the details keep the rest: the step with its whole title, its context, what it touches and its history', () => {
  const view = plain(page.laneWindowOf(lane(REFINED), NOW, 'Game - Main'))
  assert.deepEqual(view.details.step, 'B12 · Build the Clover, the Thistle and the Ring as meadow maps, each crossed by the test herd')
  // What it touches stands apart, not again in the context.
  assert.deepEqual(view.details.context, ['The herd asked for three meadows. Requirements: three maps, each crossed.'])
  assert.deepEqual(view.details.touches, ['src/meadows, tests.'])
  assert.ok(view.details.history.length > 0)
  // The brief holds the last lines of the history only; the step's own window has them all.
  assert.ok(/history: item\.history\.slice\(-BRIEF_HISTORY\)/.test(stateSource) && /const BRIEF_HISTORY = 12/.test(stateSource))
})

/** REFINED without its summary and what we build; with `picture` for its picture line. */
const pictureOnly = (picture = null) => {
  const bare = REFINED.replace(/ {2}Summary:[^\n]*\n[^\n]*\n/, '').replace(/ {2}What we build:\n(?: {2}- [^\n]*\n)+/, '')
  return picture === null ? bare : bare.replace(/ {2}Picture: [^\n]*/, `  Picture: ${picture}`)
}

test('a refine block with a picture only, or with "Picture: none (...)"', () => {
  const view = plain(page.laneWindowOf(lane(pictureOnly()), NOW, 'Game - Main'))
  assert.deepEqual(view.refined, { summary: '', picture: 'art-inbox/meadows/plan.png (the three meadows side by side)', what: [] })
  // Without a summary, the two lines say what the step is, from its context.
  assert.equal(view.task, 'The herd asked for three meadows.')
  assert.equal(plain(page.laneWindowOf(lane(REFINED.replace(/ {2}Picture: [^\n]*/, '  Picture: none (a rule only)')), NOW, 'Game - Main')).refined.picture, null)
  // A picture of none alone is no refine block to show.
  assert.equal(page.laneWindowOf(lane(pictureOnly('none (a rule only)')), NOW, 'Game - Main').refined, null)
})

test('what a step is leaves off the lead of the person\'s words, and the lines of what happened to it', () => {
  const said = PLAIN.replace('  The herd keeps walking', '  Asked Q12 (look): is the gate high enough?\n  Your words (board, 18:26): the herd keeps walking')
  assert.deepEqual(lane(said).givenTask.step.brief.about[0], 'the herd keeps walking off the north edge. A gate there keeps it in.')
})

test('a short title: the first clause of a long one, a cut at a word for one without, a short one whole', () => {
  assert.equal(page.shortTitle('Make the Ballista read at play size, loaded state visible'), 'Make the Ballista read at play size, loaded state visible')
  assert.equal(page.shortTitle('Fix: the sound definition of done\'s own checks are not all met: no test pins when map_choose plays'), 'Fix: the sound definition of done\'s own checks are not all met')
  // A clause too short to say anything ("Build the Clover,", above) is not cut off: the next one is. A comma in a list
  // ends no clause.
  assert.equal(page.shortTitle('Build the Causeway, the Terraces and the Ring as World 1 maps, each won by the test players'), 'Build the Causeway, the Terraces and the Ring as World 1 maps')
  assert.equal(page.shortTitle('Show a step\'s refined summary, picture and What we build in the worker\'s task popup'), 'Show a step\'s refined summary, picture and What we build in the worker\'s…')
  const long = 'Keep the board and the Workers mod\'s work tool in step with one table of actions and a test'
  assert.equal(page.shortTitle(long), 'Keep the board and the Workers mod\'s work tool in step with one table of…')
})

test('the window draws the refined parts under the title, the picture opening in the picture popup; the design says so', () => {
  assert.ok(/function taskNodes\(view\)[\s\S]*?pictureRow\(/.test(script), 'taskNodes draws the picture with pictureRow (opens in the picture popup)')
  assert.ok(/function taskNodes\(view\)[\s\S]*?buildList\(view\.refined\.what\)/.test(script), 'taskNodes draws what we build')
  assert.ok(/heading\.title = view\.fullTitle/.test(script), 'the whole title on hover')
  assert.ok(/\.task-brief ul\.refined-build/.test(style), '.task-brief ul.refined-build')
  assert.ok(/B425/.test(design) && /refined summary/.test(design), 'DESIGN.md names the window\'s refined parts')
})
