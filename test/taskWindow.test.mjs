// B281: a task's window says what the task is, from the backlog step, and apart from it that the worker is on the
// person's feedback when their words started its turn. The person, 2026-10-17, of B231's window: "I want the task to
// be clear, recap the original task briefly and state it's busy with feedback on this task." Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, fromChat, step, toolResult, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState } from '../src/state.mjs'

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 17, 10, 30)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const BACKLOG = [
  '## Board',
  '- [ ] B12 The zebracorn\'s walk (for Units; about 1 h) (branch feature/walk)',
  '  Handed to Game - Units on 2026-10-17.',
  '  In progress (Game - Units, 2026-10-17): the sheet is drawn.',
  '  The zebracorn walks in four directions on the big map, with its old idle kept.',
  '  Requirements:',
  '  - Four directions.',
  '',
].join('\n')
const HAND_OVER = 'Task from Game - Main: B12, the zebracorn\'s walk. About 1 h.\n\n- Four directions.\n- Keep the old idle.'
const FEEDBACK = '1. no: almost but his red square is actually 2 squares\n2. yes'

const app = name => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
/** The worker's card: re-planned when the person's feedback came in (`since`), as a worker does. */
const card = (since, text = 'Fix the red square') => JSON.stringify({
  name: 'Units', role: 'worker', state: 'working',
  task: { text, step: 1, steps: 2, left: 20 * MIN, isReported: false, names: ['Fix the square', 'Show it'], stepLeft: 8 * MIN, since },
  at: NOW - 2 * MIN,
})

function lane(lines, { plan = card(NOW - 19 * MIN), backlogText = BACKLOG } = {}) {
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: [app('Main'), app('Units')],
    tails: { 'cli-Units': { text: lines.join('\n'), isCut: false, modifiedAt: NOW - MIN } },
    planLineTexts: { 'cli-Units': plan },
    backlogText, adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], now: NOW, config }).chats.find(chat => chat.name === 'Units')
}

/** B231's case: the main chat's hand-over, the worker asks, the person answers in the worker's chat. */
const onFeedback = (words = FEEDBACK) => [
  fromChat(NOW - 50 * MIN, 'Game - Main', HAND_OVER),
  step(NOW - 49 * MIN, 'Draw the sheet'),
  toolResult(NOW - 48 * MIN),
  answer(NOW - 21 * MIN, 'Does the square look right?'),
  typed(NOW - 20 * MIN, words),
  step(NOW - 2 * MIN, 'Fix the square'),
  toolResult(NOW - MIN),
]

// In the state

test('the task stays the main chat\'s hand-over when the person\'s words started the turn, and those words are the feedback', () => {
  const units = lane(onFeedback())
  assert.equal(units.state, 'working')
  assert.deepEqual(units.givenTask, {
    by: 'main', at: NOW - 50 * MIN, text: HAND_OVER,
    step: { id: 'B12', title: 'The zebracorn\'s walk', about: 'The zebracorn walks in four directions on the big map, with its old idle kept.' },
  })
  assert.deepEqual(units.feedback, { at: NOW - 20 * MIN, text: '1. no: almost but his red square is actually 2 squares · 2. yes' })
})

test('an answer given on the worker board is the feedback without the board\'s mark', () => {
  const units = lane(onFeedback('(answered on the worker board, 10:10) 1. no: two squares'))
  assert.deepEqual(units.feedback, { at: NOW - 20 * MIN, text: '1. no: two squares' })
  const typedThere = lane(onFeedback('Make it two squares.\n(typed on the worker board, 10:10)'))
  assert.deepEqual(typedThere.feedback, { at: NOW - 20 * MIN, text: 'Make it two squares.' })
})

test('no feedback when the main chat\'s hand-over or another chat started the turn', () => {
  const handed = lane([fromChat(NOW - 50 * MIN, 'Game - Main', HAND_OVER), step(NOW - 2 * MIN, 'Draw the sheet'), toolResult(NOW - MIN)], { plan: card(NOW - 49 * MIN, 'Zebracorn walk') })
  assert.equal(handed.givenTask.by, 'main')
  assert.equal(handed.feedback, null)
  const noted = lane([...onFeedback(), answer(NOW - 90 * 1000, 'Fixed.'), fromChat(NOW - 60 * 1000, 'Game - Main', 'Note from Game - Main: the art folder moved.'), step(NOW - 30 * 1000, 'Move')])
  assert.equal(noted.feedback, null)
})

test('a task the person typed keeps their words as the task; their later words are the feedback', () => {
  const lines = [
    typed(NOW - 40 * MIN, 'Make the quokkaberry glow.'),
    step(NOW - 39 * MIN, 'Read'),
    answer(NOW - 21 * MIN, 'Like this?'),
    typed(NOW - 20 * MIN, 'Brighter, please.'),
    step(NOW - 2 * MIN, 'Glow'),
    toolResult(NOW - MIN),
  ]
  const units = lane(lines, { plan: card(NOW - 39 * MIN, 'Quokkaberry glow'), backlogText: '' })
  assert.deepEqual([units.givenTask.by, units.givenTask.text, units.givenTask.step], ['you', 'Make the quokkaberry glow.', null])
  assert.deepEqual(units.feedback, { at: NOW - 20 * MIN, text: 'Brighter, please.' })
})

test('a lane that is not on a task carries no feedback', () => {
  const free = lane([typed(NOW - 30 * MIN, 'Zebracorn please'), answer(NOW - 29 * MIN, 'Done.')], { plan: '', backlogText: '' })
  assert.deepEqual([free.state, free.feedback], ['free', null])
})

// On the page

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const design = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'DESIGN.md'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('stepline')}\n${cut('lanetime')}\n${cut('lanewindow')}\nObject.assign(this, { clock, laneWindowOf })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

test('the window names the step and what it is, and apart from it the feedback the worker is on, with its time', () => {
  const view = plain(page.laneWindowOf(lane(onFeedback()), NOW, 'Game - Main'))
  assert.equal(view.taskHead, 'B12 · The zebracorn\'s walk')
  // The hand-over has no "In short:" line: the step's own first line says what it is.
  assert.equal(view.task, 'The zebracorn walks in four directions on the big map, with its old idle kept.')
  assert.deepEqual(view.feedback, { title: `Now on your feedback (${page.clock(NOW - 20 * MIN)})`, text: '1. no: almost but his red square is actually 2 squares · 2. yes' })
  // The task as it was given, folded below, is still the hand-over.
  assert.deepEqual(view.given, { from: `Handed over by Game - Main, ${page.clock(NOW - 50 * MIN)}`, text: HAND_OVER })
})

test('the hand-over\'s "In short:" line says what the step is when it has one', () => {
  const short = lane(onFeedback().map((line, i) => (i === 0 ? fromChat(NOW - 50 * MIN, 'Game - Main', `${HAND_OVER}\nIn short: the zebracorn walks.`) : line)))
  assert.equal(page.laneWindowOf(short, NOW, 'Game - Main').task, 'The zebracorn walks.')
})

test('a task without a step keeps today\'s words, with the same feedback part; a window without feedback has none', () => {
  const lines = [typed(NOW - 40 * MIN, 'Make the quokkaberry glow.'), step(NOW - 39 * MIN, 'Read'), answer(NOW - 21 * MIN, 'Like this?'), typed(NOW - 20 * MIN, 'Brighter, please.'), step(NOW - 2 * MIN, 'Glow'), toolResult(NOW - MIN)]
  const view = plain(page.laneWindowOf(lane(lines, { plan: card(NOW - 39 * MIN, 'Quokkaberry glow'), backlogText: '' }), NOW, 'Game - Main'))
  assert.deepEqual([view.taskHead, view.task], [null, 'Make the quokkaberry glow.'])
  assert.equal(view.feedback.text, 'Brighter, please.')
  const handed = lane([fromChat(NOW - 50 * MIN, 'Game - Main', HAND_OVER), step(NOW - 2 * MIN, 'Draw the sheet'), toolResult(NOW - MIN)], { plan: card(NOW - 49 * MIN, 'Zebracorn walk') })
  assert.equal(page.laneWindowOf(handed, NOW, 'Game - Main').feedback, null)
})

test('the window draws the step on top, the feedback as its own part set apart, then the plan; the design says so', () => {
  assert.ok(/view => briefPart\(\[\['The task', taskNodes\(view\)\], \[view\.feedback\?\.title \?\? '', feedbackNodes\(view\.feedback\)\], \['Its plan', planNodes\(view\.plan\)\]\]\)/.test(script), "view => briefPart: the task, the feedback, the plan")
  assert.ok(/const feedbackNodes = feedback => \(feedback === null \? \[\] : \[el\('p', 'brief-feedback', feedback\.text\)\]\)/.test(script), "const feedbackNodes = feedback => \\(feedback === ")
  assert.ok(/\.task-brief \.brief-part:has\(\.brief-feedback\) \{[^}]*border-left/.test(style), "\\.task-brief \\.brief-part:has\\(\\.brief-feedback\\)")
  assert.ok(/\.task-brief \.brief-feedback \{[^}]*-webkit-line-clamp: 2/.test(style), "\\.task-brief \\.brief-feedback \\{[^}]*-webkit-line")
  assert.ok(/Now on your feedback \(HH:MM\)/.test(design), "Now on your feedback \\(HH:MM\\)/")
})
