// B281: a task's window says what the task is, from the step (B301: the step the work store holds for the worker; a
// hand-over message says nothing), and apart from it that the worker is on the person's feedback when their words
// started its turn. The person, 2026-10-17, of B231's window: "I want the task to
// be clear, recap the original task briefly and state it's busy with feedback on this task." Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, assistant, fromChat, step, tool, toolResult, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState } from './withStore.mjs'

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

test('B301: the step the store holds is the task, not the hand-over; the person\'s words that started the turn are the feedback', () => {
  const units = lane(onFeedback())
  assert.equal(units.state, 'working')
  // B425: the step's brief for the window is tested in taskPopup.test.mjs.
  const { brief, ...stepPart } = units.givenTask.step
  assert.deepEqual({ ...units.givenTask, step: stepPart }, {
    by: 'step', at: null, text: '',
    step: { id: 'B12', title: 'The zebracorn\'s walk', about: 'The zebracorn walks in four directions on the big map, with its old idle kept.' },
  })
  assert.deepEqual(brief.about, ['The zebracorn walks in four directions on the big map, with its old idle kept.'])
  assert.deepEqual(units.feedback, { at: NOW - 20 * MIN, text: '1. no: almost but his red square is actually 2 squares · 2. yes' })
})

test('what a step is: not the person\'s answers to a quick check, and their own words without the lead before them', () => {
  const golem = BACKLOG.replace(
    '  The zebracorn walks in four directions on the big map, with its old idle kept.\n',
    '  Your answers to the quick check (board, 2026-10-15, 23:52), all as advised: 14 HP, 2 Shields.\n'
      + '  Your words (board, 18:26, in the Advisor\'s round): the zebracorn as the boss, bigger than one tile (2x2).\n',
  )
  assert.equal(lane(onFeedback(), { backlogText: golem }).givenTask.step.about, 'the zebracorn as the boss, bigger than one tile (2x2).')
  const technical = BACKLOG.replace('  The zebracorn walks', '  Touches: src/content, tests.\n  The zebracorn walks')
  assert.equal(lane(onFeedback(), { backlogText: technical }).givenTask.step.about, 'The zebracorn walks in four directions on the big map, with its old idle kept.')
})

test('an answer given on the worker board is the feedback without the board\'s mark', () => {
  const units = lane(onFeedback('(answered on the worker board, 10:10) 1. no: two squares'))
  assert.deepEqual(units.feedback, { at: NOW - 20 * MIN, text: '1. no: two squares' })
  const typedThere = lane(onFeedback('Make it two squares.\n(typed on the worker board, 10:10)'))
  assert.deepEqual(typedThere.feedback, { at: NOW - 20 * MIN, text: 'Make it two squares.' })
})

test('no feedback when the main chat\'s hand-over or another chat started the turn', () => {
  const handed = lane([fromChat(NOW - 50 * MIN, 'Game - Main', HAND_OVER), step(NOW - 2 * MIN, 'Draw the sheet'), toolResult(NOW - MIN)], { plan: card(NOW - 49 * MIN, 'Zebracorn walk') })
  assert.equal(handed.givenTask.by, 'step')
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

test('a typed task stays the task when the worker named its card anew for the person\'s feedback', () => {
  const lines = [
    typed(NOW - 40 * MIN, 'Make the quokkaberry glow.'),
    step(NOW - 39 * MIN, 'Read'),
    answer(NOW - 21 * MIN, 'Like this?'),
    typed(NOW - 20 * MIN, 'Brighter, please.'),
    step(NOW - 2 * MIN, 'Glow'),
    toolResult(NOW - MIN),
  ]
  const units = lane(lines, { plan: card(NOW - 19 * MIN, 'Brighter glow'), backlogText: '' })
  assert.deepEqual([units.givenTask.by, units.givenTask.text], ['you', 'Make the quokkaberry glow.'])
  assert.deepEqual(units.feedback, { at: NOW - 20 * MIN, text: 'Brighter, please.' })
})

test('words after a task the worker finished are a new task, not feedback: it said "Done: yes" (B301: a report message is nothing)', () => {
  const report = assistant(NOW - 30 * MIN, 'tool_use', [tool('SendMessage', { to: 'Game - Main', message: 'Report from Units: B12 done.' })])
  const reported = [fromChat(NOW - 50 * MIN, 'Game - Main', HAND_OVER), step(NOW - 49 * MIN, 'Draw'), report, answer(NOW - 29 * MIN, 'Reported.'), typed(NOW - 20 * MIN, 'Now make the quokkaberry glow.'), step(NOW - 2 * MIN, 'Glow'), toolResult(NOW - MIN)]
  const after = lane(reported, { plan: card(NOW - 19 * MIN, 'Quokkaberry glow'), backlogText: '' })
  assert.deepEqual([after.givenTask.by, after.givenTask.text, after.feedback], ['you', 'Now make the quokkaberry glow.', null])
  const done = answer(NOW - 29 * MIN, 'It walks.\n\n---\n\n```diff\n  Prompt: the walk\n  Who:    Game - Units\n+ Done:   yes\n```')
  const said = [fromChat(NOW - 50 * MIN, 'Game - Main', HAND_OVER), step(NOW - 49 * MIN, 'Draw'), done, typed(NOW - 20 * MIN, 'Now make the quokkaberry glow.'), step(NOW - 2 * MIN, 'Glow'), toolResult(NOW - MIN)]
  const next = lane(said, { plan: card(NOW - 19 * MIN, 'Quokkaberry glow'), backlogText: '' })
  assert.deepEqual([next.givenTask.by, next.givenTask.text, next.feedback], ['you', 'Now make the quokkaberry glow.', null])
})

test('the feedback leaves off what the board adds to an answer: a picture\'s place, what to do with a verdict', () => {
  const pictured = lane(onFeedback('Two squares, like this.\nPicture: C:\\game\\art-inbox\\talk\\square.png\n(typed on the worker board, 10:10)'))
  assert.equal(pictured.feedback.text, 'Two squares, like this.')
  const verdict = lane(onFeedback('(answered on the worker board, 10:10) B12 "The zebracorn\'s walk": rejected. Reason: two squares\nPick this up: now if it belongs to what you are doing, else as a step in the queue.'))
  assert.equal(verdict.feedback.text, 'B12 "The zebracorn\'s walk": rejected. Reason: two squares')
  const approved = lane(onFeedback('(answered on the worker board, 10:10) B12 "The zebracorn\'s walk": approved. Tick this step in the backlog.'))
  assert.equal(approved.feedback.text, 'B12 "The zebracorn\'s walk": approved.')
})

test('what a step is: not a plan file, a choice, where it was queued or split, nor any other head\'s part', () => {
  for (const first of ['Plan: .claude/plans/goal-ask.md, Tasks 14-15.', 'Your choice on the worker board (2026-10-15): A.', 'Queued by you on the board.', 'Split on 2026-10-16 into B12 and B13.', 'Held for today.', 'Problem: the map is slow.']) {
    const notes = BACKLOG.replace('  The zebracorn walks', `  ${first}\n  The zebracorn walks`)
    assert.equal(lane(onFeedback(), { backlogText: notes }).givenTask.step.about, 'The zebracorn walks in four directions on the big map, with its old idle kept.', first)
  }
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
  // B425: the step's id and title stand in the head only, not again above what it is.
  assert.deepEqual([view.code, view.title, view.taskHead], ['B12', 'The zebracorn\'s walk', undefined])
  // The step's own first line says what it is.
  assert.equal(view.task, 'The zebracorn walks in four directions on the big map, with its old idle kept.')
  assert.deepEqual(view.feedback, { title: `Now on your feedback (${page.clock(NOW - 20 * MIN)})`, text: '1. no: almost but his red square is actually 2 squares · 2. yes' })
  // B301: no words were typed that gave it: the hand-over is not shown as its task.
  assert.equal(view.given, null)
})

test('B301: a hand-over\'s "In short:" line says nothing: what the step is comes from the store', () => {
  const short = lane(onFeedback().map((line, i) => (i === 0 ? fromChat(NOW - 50 * MIN, 'Game - Main', `${HAND_OVER}\nIn short: the zebracorn walks.`) : line)))
  assert.equal(page.laneWindowOf(short, NOW, 'Game - Main').task, 'The zebracorn walks in four directions on the big map, with its old idle kept.')
  // Typed by the person, an "In short:" line says what a task without a step is.
  const typedTask = lane([typed(NOW - 40 * MIN, 'Make the quokkaberry glow.\nIn short: a glowing quokkaberry.'), step(NOW - 2 * MIN, 'Glow'), toolResult(NOW - MIN)], { plan: card(NOW - 39 * MIN, 'Quokkaberry glow'), backlogText: '' })
  assert.equal(page.laneWindowOf(typedTask, NOW, 'Game - Main').task, 'A glowing quokkaberry.')
})

test('a task without a step keeps today\'s words, with the same feedback part; a window without feedback has none', () => {
  const lines = [typed(NOW - 40 * MIN, 'Make the quokkaberry glow.'), step(NOW - 39 * MIN, 'Read'), answer(NOW - 21 * MIN, 'Like this?'), typed(NOW - 20 * MIN, 'Brighter, please.'), step(NOW - 2 * MIN, 'Glow'), toolResult(NOW - MIN)]
  const view = plain(page.laneWindowOf(lane(lines, { plan: card(NOW - 39 * MIN, 'Quokkaberry glow'), backlogText: '' }), NOW, 'Game - Main'))
  assert.deepEqual([view.refined, view.details, view.task], [null, null, 'Make the quokkaberry glow.'])
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
