// B108: the steps of a task as one line in a lane (which step of how many, the step's name, the time left for that
// step) in place of a chip per step; the names of all steps open on hover and on the keyboard's focus. The page's
// own code is run here, cut out of board.js between its marks. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { step, toolResult, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { parsePlanLine } from '../src/planLines.mjs'
import { buildState } from '../src/state.mjs'

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 12, 15, 0)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const NAMES = ['Look check with the user', 'Sheet and two views', 'Convert and wire in', 'Judges and code review', 'Merge and report']

const app = name => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
const running = [typed(NOW - 20 * MIN, 'Zebracorn please'), step(NOW - 2 * MIN, 'Run the tests'), toolResult(NOW - MIN)]
/** A lane as the board builds it from a chat's own card, written three minutes ago. */
function unitsWith(task) {
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: [app('Main'), app('Units')],
    tails: { 'cli-Units': { text: running.join('\n'), isCut: false, modifiedAt: NOW } },
    planLineTexts: { 'cli-Units': JSON.stringify({ name: 'x', role: 'worker', state: 'working', task: { isReported: false, ...task }, at: NOW - 3 * MIN }) },
    backlogText: '',
    adviceText: null,
    folders: null,
    askTexts: [],
    pictureLists: {},
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], now: NOW, config }).chats.find(chat => chat.name === 'Units')
}

test('a chat\'s card may give the time for the step it is on', () => {
  const line = task => parsePlanLine(JSON.stringify({ task: { text: 'Redesign', ...task } })).task.stepLeftMs
  assert.equal(line({ stepLeft: 12 * MIN }), 12 * MIN)
  for (const none of [{}, { stepLeft: null }, { stepLeft: 'soon' }]) assert.equal(line(none), null)
  // It is true when the card was written, and stands beside the task's own time.
  const lane = unitsWith({ text: 'Redesign', step: 2, steps: 5, names: NAMES, left: 60 * MIN, stepLeft: 15 * MIN })
  assert.deepEqual([lane.task.stepLeftMs, lane.task.stepEstimateAt, lane.task.leftMs, lane.eta.leftMs], [15 * MIN, NOW - 3 * MIN, 60 * MIN, 57 * MIN])
  const without = unitsWith({ text: 'Redesign', step: 2, steps: 5, names: NAMES, left: 60 * MIN })
  assert.deepEqual([without.task.stepLeftMs, without.task.stepEstimateAt], [null, null])
})

// The page

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('stepline')}\nObject.assign(this, { stepLine })`, page)
const stepLine = lane => JSON.parse(JSON.stringify(page.stepLine(lane, NOW)))
const lane = (task, state = 'working') => ({ name: 'Units', state, task: { text: 'Redesign', step: 1, steps: 5, names: NAMES, stepLeftMs: null, stepEstimateAt: null, ...task } })

test('the line says which step of how many, the step\'s name and the time left for it', () => {
  const line = stepLine(lane({ step: 1, stepLeftMs: 15 * MIN, stepEstimateAt: NOW - 3 * MIN }))
  assert.deepEqual([line.count, line.name, line.time, line.tone], ['1/5', 'Look check with the user', '12 min left', 'time'])
  assert.equal(line.label, 'Step 1 of 5: Look check with the user, 12 min left')
  // On built lanes too: the card's own fields are the ones the line reads.
  const built = stepLine(unitsWith({ text: 'Redesign', step: 3, steps: 5, names: NAMES, stepLeft: 15 * MIN }))
  assert.deepEqual([built.count, built.name, built.time], ['3/5', 'Convert and wire in', '12 min left'])
})

test('the step\'s time counts down while the chat works, says by how much it is over, and a step without one says so', () => {
  assert.deepEqual([stepLine(lane({ stepLeftMs: 15 * MIN, stepEstimateAt: NOW - 18 * MIN })).time, stepLine(lane({ stepLeftMs: 15 * MIN, stepEstimateAt: NOW - 18 * MIN })).tone], ['3 min over', 'bad'])
  assert.deepEqual([stepLine(lane({})).time, stepLine(lane({})).tone], ['no time for this step', 'none'])
  assert.match(stepLine(lane({})).label, /, no time for this step$/)
  // A chat that waits for the person, or was cut off, is not working it off: what it said stands.
  for (const state of ['waiting', 'interrupted']) assert.equal(stepLine(lane({ stepLeftMs: 15 * MIN, stepEstimateAt: NOW - 40 * MIN }, state)).time, '15 min left', state)
})

test('every step is in the list by name, with the one the chat is on marked', () => {
  const steps = stepLine(lane({ step: 3 })).steps
  assert.deepEqual(steps.map(one => one.state), ['done', 'done', 'now', 'next', 'next'])
  assert.deepEqual(steps.map(one => one.name), NAMES)
  // A card that names fewer steps than it counts, or is past its names, or on none yet.
  assert.deepEqual([stepLine(lane({ step: 6, steps: 7 })).count, stepLine(lane({ step: 6, steps: 7 })).name], ['6/7', 'Step 6'])
  assert.deepEqual([stepLine(lane({ step: 2, steps: null })).count], ['2/5'])
  const none = stepLine(lane({ step: null }))
  assert.deepEqual([none.count, none.name, none.steps.map(one => one.state), none.label], ['–/5', 'No step yet', ['next', 'next', 'next', 'next', 'next'], 'No step of 5 yet, no time for this step'])
})

test('a card without names keeps the bar and "2 of 5"; a lane without a task has no line', () => {
  assert.equal(page.stepLine(lane({ names: null }), NOW), null)
  assert.equal(page.stepLine(lane({ names: [] }), NOW), null)
  assert.equal(page.stepLine({ name: 'Units', state: 'free', task: null }, NOW), null)
  // B159: in the Progress column, under the bar.
  assert.match(script, /else if \(hasSteps\) progress\.append\(el\('small', 'progress-count', `\$\{task\.step\} of \$\{task\.steps\}`\)\)/)
})

test('the lane draws the one line in place of a chip per step, and its list opens on hover and for the keyboard', () => {
  // B159: the line sits in the lane's Progress column, under the bar of its steps.
  assert.match(script, /const steps = task === null \? null : stepLine\(lane, state\.readAt\)\n\s+if \(steps !== null\) progress\.append\(drawStepLine\(lane, steps\)\)/)
  assert.ok(!script.includes('el(\'ol\', \'steps\')') && !/\n\.steps li/.test(style), 'the chips are still there')
  // The line is a button, so Tab reaches it; the list is its sibling and shows while the pointer or the focus is on it.
  assert.match(script, /const now = el\('button', 'step-now'\)/)
  assert.match(style, /\.step-line:hover \.step-list,\s*\.step-line:focus-within \.step-list\s*\{\s*display:\s*block/)
  assert.match(style, /\.step-list\s*\{[^}]*display:\s*none/)
  // The whole of it is said to a screen reader in the button's own name.
  assert.match(script, /setAttribute\('aria-label', `\$\{line\.label\}\. All steps: /)
  // The lanes are drawn anew at every reading: the line that held the focus holds it again, so its list stays open.
  assert.match(script, /function drawLanes\(state\) \{\n\s+const focused = document\.activeElement\?\.dataset\?\.stepsOf \?\? null/)
  assert.equal([...script.matchAll(/fill\(\$\('lanes'\)/g)].length, 1)
})
