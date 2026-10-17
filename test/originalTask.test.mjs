// B151: a click on a working worker's lane opens a window with the task as it was given: what the person typed there
// (B301: never the main chat's hand-over, which gives no task), with the step it is on and where it stands now.
// The person, 2026-10-14: "I want to be able to click on any worker that is working and in the popup show what it's
// original task is". The lane itself keeps its card's short task (B82). Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, assistant, fromChat, midTurn, step, tool, toolResult, typed, user } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState } from './withStore.mjs'
import { parseTail, taskOrigin } from '../src/transcript.mjs'

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 14, 10, 30)
const entries = lines => parseTail(lines.join('\n'), false)
const HAND_OVER = 'Task from Game - Main: B12, the zebracorn\'s walk. About 1 h.\n\n- Four directions.\n- Keep the old idle.'

// Finding the message

test('B301: the main chat\'s hand-over is no task\'s origin, also one that arrived in the middle of a turn', () => {
  const lines = [fromChat(NOW - 50 * MIN, 'Game - Main', HAND_OVER), step(NOW - 49 * MIN, 'Draw'), toolResult(NOW - 48 * MIN)]
  assert.equal(taskOrigin(entries(lines)), null)
  const queued = [typed(NOW - 60 * MIN, 'Zebracorn please'), step(NOW - 59 * MIN, 'Build'), midTurn(NOW - 50 * MIN, 'local_Main', HAND_OVER, 'Game - Main')]
  assert.deepEqual(taskOrigin(entries(queued)), { by: 'you', at: NOW - 60 * MIN, text: 'Zebracorn please' })
})

test('a task the person typed into the chat is their own words', () => {
  const lines = [typed(NOW - 40 * MIN, 'Make the quokkaberry glow.\nOnly at night.'), step(NOW - 39 * MIN, 'Read'), toolResult(NOW - 38 * MIN)]
  assert.deepEqual(taskOrigin(entries(lines)), { by: 'you', at: NOW - 40 * MIN, text: 'Make the quokkaberry glow.\nOnly at night.' })
})

test('the newest message at or before the task\'s start counts; a note, a tool\'s answer or a slash command is none', () => {
  const lines = [
    typed(NOW - 90 * MIN, 'An older task.'),
    answer(NOW - 80 * MIN, 'Done.'),
    typed(NOW - 50 * MIN, HAND_OVER),
    fromChat(NOW - 30 * MIN, 'Game - Main', 'Note from Game - Main: the art folder moved.'),
    fromChat(NOW - 25 * MIN, 'Game - Units', 'Task from Game - Main: not from the main chat at all.'),
    user(NOW - 20 * MIN, '<command-name>/reload-plugins</command-name>'),
    toolResult(NOW - 15 * MIN),
    typed(NOW - 10 * MIN, 'How far are you?'),
  ]
  // The task started with those words: what came later is about it, not it.
  assert.equal(taskOrigin(entries(lines), NOW - 48 * MIN).text, HAND_OVER)
  // Without a known start, the newest that can start one.
  assert.deepEqual(taskOrigin(entries(lines)), { by: 'you', at: NOW - 10 * MIN, text: 'How far are you?' })
  assert.equal(taskOrigin(entries(lines.slice(3, 7))), null)
})

test('a very long message is kept to its first 6000 characters', () => {
  const long = `B12.\n${'x'.repeat(7000)}`
  const found = taskOrigin(entries([typed(NOW - 5 * MIN, long)]))
  assert.equal(found.text.length, 6001)
  assert.ok(found.text.endsWith('…'))
})

// In the state

const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const BACKLOG = '## Board\n- [ ] B12 The zebracorn\'s walk (for Units; about 1 h) (branch feature/walk)\n'
const app = (name, more = {}) => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1', ...more,
})
const card = JSON.stringify({ name: 'Units', role: 'worker', state: 'working', task: { text: 'Zebracorn walk', step: 2, steps: 3, left: 20 * MIN, isReported: false, names: ['Sheet', 'Views', 'Wire in'], stepLeft: 8 * MIN, since: NOW - 49 * MIN }, at: NOW - 2 * MIN })

function lane(lines, { plan = card, backlogText = BACKLOG } = {}) {
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: [app('Main'), app('Units')],
    tails: { 'cli-Units': { text: lines.join('\n'), isCut: false, modifiedAt: NOW - MIN } },
    planLineTexts: { 'cli-Units': plan },
    backlogText, adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], now: NOW, config }).chats.find(chat => chat.name === 'Units')
}
const working = [typed(NOW - 50 * MIN, HAND_OVER), step(NOW - 2 * MIN, 'Draw the sheet'), toolResult(NOW - MIN)]

test('a working lane carries the task as it was given: the step the store holds for it, else the person\'s words; its own task stays the card\'s', () => {
  const units = lane(working)
  assert.equal(units.state, 'working')
  assert.equal(units.task.text, 'Zebracorn walk')
  assert.deepEqual(units.givenTask, { by: 'step', at: null, text: '', step: { id: 'B12', title: 'The zebracorn\'s walk', about: null } })
  // Without a step of the store, what the person typed.
  assert.deepEqual(lane(working, { backlogText: '' }).givenTask, { by: 'you', at: NOW - 50 * MIN, text: HAND_OVER, step: null })
  // B301: a hand-over of the main chat gives it none.
  assert.equal(lane([fromChat(NOW - 50 * MIN, 'Game - Main', HAND_OVER), step(NOW - 2 * MIN, 'Draw the sheet'), toolResult(NOW - MIN)], { backlogText: '' }).givenTask, null)
})

test('a lane that is free, or waits for the person, carries none: its window is another one, or there is none', () => {
  const free = lane([typed(NOW - 30 * MIN, 'Zebracorn please'), answer(NOW - 29 * MIN, 'Done.')], { plan: '', backlogText: '' })
  assert.deepEqual([free.state, free.givenTask], ['free', null])
  // It asks with the app's question form.
  const asking = assistant(NOW - 30 * 1000, 'tool_use', [tool('AskUserQuestion', { questions: [{ question: 'Which one?', options: [{ label: 'A' }] }] })])
  const raw = { listText: '{"prefix":"Game - ","main":"Main"}', appChatTexts: [app('Main'), app('Units')], tails: { 'cli-Units': { text: [...working, asking].join('\n'), isCut: false, modifiedAt: NOW } }, planLineTexts: { 'cli-Units': card.replace('"state":"working"', '"state":"asking"') }, backlogText: BACKLOG, adviceText: null, folders: null, askTexts: [], pictureLists: {} }
  const waiting = buildState(raw, { now: NOW, config }).chats.find(chat => chat.name === 'Units')
  assert.deepEqual([waiting.state, waiting.givenTask], ['waiting', null])
})

// On the page

const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
const cut = name => {
  const [from, to] = [script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`)]
  assert.ok(from >= 0 && to > from, `board.js has no part "${name}"`)
  return script.slice(from, to)
}
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('lanetime')}\n${cut('stepline')}\n${cut('lanewindow')}\nObject.assign(this, { clock, laneWindowOf })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

test('the window shows the card\'s task in its head, the task as it was given, its step, and where it stands now', () => {
  const units = lane(working)
  const view = plain(page.laneWindowOf(units, NOW, 'Game - Main'))
  // B299: the lane names its step by the store's title, not the card's short topic.
  assert.deepEqual([view.code, view.title, view.chips], ['B12', 'The zebracorn\'s walk', [{ text: 'Working', tone: 'kind' }, { text: 'Worker: Units', tone: 'to' }]])
  // B301: the step is the task; no words gave it.
  assert.equal(view.given, null)
  assert.deepEqual(plain(page.laneWindowOf(lane(working, { backlogText: '' }), NOW, 'Game - Main')).given, { from: `Typed by you, ${page.clock(NOW - 50 * MIN)}`, text: HAND_OVER })
  assert.deepEqual(view.step, { id: 'B12', title: 'The zebracorn\'s walk', about: null })
  assert.deepEqual(view.standing, ['Step 2 of 3: Views, 6 min left', `ETA: 18 min left, until ${page.clock(NOW + 18 * MIN)}`, 'Now: Draw the sheet'])
})

test('typed by the person, unknown, or a lane whose window this is not', () => {
  const units = lane([typed(NOW - 40 * MIN, 'Make the quokkaberry glow.'), step(NOW - 2 * MIN, 'Draw the sheet'), toolResult(NOW - MIN)], { plan: card.replace(`"since":${NOW - 49 * MIN}`, `"since":${NOW - 39 * MIN}`), backlogText: '' })
  assert.equal(page.laneWindowOf(units, NOW, 'Game - Main').given.from, `Typed by you, ${page.clock(NOW - 40 * MIN)}`)
  const lost = plain(page.laneWindowOf({ ...lane(working), givenTask: null }, NOW, 'Game - Main'))
  assert.deepEqual([lost.given, lost.code, lost.step], [null, 'B12', null])
  for (const state of ['free', 'waiting', 'unknown']) assert.equal(page.laneWindowOf({ ...lane(working), state }, NOW, 'Game - Main'), null, state)
})
