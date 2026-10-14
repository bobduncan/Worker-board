// B151: a click on a working worker's lane opens a window with the task as it was given: the main chat's hand-over as
// it arrived in that chat, or what the person typed there, with the backlog step it names and where it stands now.
// The person, 2026-10-14: "I want to be able to click on any worker that is working and in the popup show what it's
// original task is". The lane itself keeps its card's short task (B82). Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, fromChat, midTurn, step, toolResult, typed, user } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState } from '../src/state.mjs'
import { parseTail, taskOrigin } from '../src/transcript.mjs'

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 14, 10, 30)
const MAIN = { mainTitle: 'Game - Main', mainSession: 'local_Main' }
const entries = lines => parseTail(lines.join('\n'), false)
const HAND_OVER = 'Task from Game - Main: B12, the zebracorn\'s walk. About 1 h.\n\n- Four directions.\n- Keep the old idle.'

// Finding the message

test('the task\'s first message is the main chat\'s hand-over as it arrived, with all its lines', () => {
  const lines = [fromChat(NOW - 50 * MIN, 'Game - Main', HAND_OVER), step(NOW - 49 * MIN, 'Draw'), toolResult(NOW - 48 * MIN)]
  assert.deepEqual(taskOrigin(entries(lines), MAIN), { by: 'main', at: NOW - 50 * MIN, text: HAND_OVER })
  // One that arrived in the middle of a turn counts too.
  const queued = [typed(NOW - 60 * MIN, 'Zebracorn please'), step(NOW - 59 * MIN, 'Build'), midTurn(NOW - 50 * MIN, 'local_Main', HAND_OVER, 'Game - Main')]
  assert.deepEqual(taskOrigin(entries(queued), MAIN), { by: 'main', at: NOW - 50 * MIN, text: HAND_OVER })
})

test('a task the person typed into the chat is their own words', () => {
  const lines = [typed(NOW - 40 * MIN, 'Make the quokkaberry glow.\nOnly at night.'), step(NOW - 39 * MIN, 'Read'), toolResult(NOW - 38 * MIN)]
  assert.deepEqual(taskOrigin(entries(lines), MAIN), { by: 'you', at: NOW - 40 * MIN, text: 'Make the quokkaberry glow.\nOnly at night.' })
})

test('the newest message at or before the task\'s start counts; a note, a tool\'s answer or a slash command is none', () => {
  const lines = [
    fromChat(NOW - 90 * MIN, 'Game - Main', 'Task from Game - Main: an older task.'),
    answer(NOW - 80 * MIN, 'Done.'),
    fromChat(NOW - 50 * MIN, 'Game - Main', HAND_OVER),
    fromChat(NOW - 30 * MIN, 'Game - Main', 'Note from Game - Main: the art folder moved.'),
    fromChat(NOW - 25 * MIN, 'Game - Units', 'Task from Game - Main: not from the main chat at all.'),
    user(NOW - 20 * MIN, '<command-name>/reload-plugins</command-name>'),
    toolResult(NOW - 15 * MIN),
    typed(NOW - 10 * MIN, 'How far are you?'),
  ]
  // The task started with the hand-over: what came later is about it, not it.
  assert.equal(taskOrigin(entries(lines), MAIN, NOW - 48 * MIN).text, HAND_OVER)
  // Without a known start, the newest that can start one.
  assert.deepEqual(taskOrigin(entries(lines), MAIN), { by: 'you', at: NOW - 10 * MIN, text: 'How far are you?' })
  assert.equal(taskOrigin(entries(lines.slice(3, 7)), MAIN), null)
})

test('a very long message is kept to its first 6000 characters', () => {
  const long = `Task from Game - Main: B12.\n${'x'.repeat(7000)}`
  const found = taskOrigin(entries([fromChat(NOW - 5 * MIN, 'Game - Main', long)]), MAIN)
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
const working = [fromChat(NOW - 50 * MIN, 'Game - Main', HAND_OVER), step(NOW - 2 * MIN, 'Draw the sheet'), toolResult(NOW - MIN)]

test('a working lane carries the task as it was given, with the backlog step it names; its own task stays the card\'s', () => {
  const units = lane(working)
  assert.equal(units.state, 'working')
  assert.equal(units.task.text, 'Zebracorn walk')
  assert.deepEqual(units.givenTask, { by: 'main', at: NOW - 50 * MIN, text: HAND_OVER, step: { id: 'B12', title: 'The zebracorn\'s walk' } })
})

test('a lane that is free, or waits for the person, carries none: its window is another one, or there is none', () => {
  const free = lane([typed(NOW - 30 * MIN, 'Zebracorn please'), answer(NOW - 29 * MIN, 'Done.')], { plan: '', backlogText: '' })
  assert.deepEqual([free.state, free.givenTask], ['free', null])
  const raw = { listText: '{"prefix":"Game - ","main":"Main"}', appChatTexts: [app('Main'), app('Units', { postTurnSummary: { status_category: 'blocked', status_detail: 'x', needs_action: 'Choose.', summarizes_uuid: 'u-1' } })], tails: { 'cli-Units': { text: [...working, answer(NOW - 30 * 1000, 'Which one?')].join('\n'), isCut: false, modifiedAt: NOW } }, planLineTexts: { 'cli-Units': card }, backlogText: BACKLOG, adviceText: null, folders: null, askTexts: [], pictureLists: {} }
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
  assert.deepEqual([view.code, view.title, view.chips], ['B12', 'Zebracorn walk', [{ text: 'Working', tone: 'kind' }, { text: 'Worker: Units', tone: 'to' }]])
  assert.deepEqual(view.given, { from: `Handed over by Game - Main, ${page.clock(NOW - 50 * MIN)}`, text: HAND_OVER })
  assert.deepEqual(view.step, { id: 'B12', title: 'The zebracorn\'s walk' })
  assert.deepEqual(view.standing, ['Step 2 of 3: Views, 6 min left', `ETA: 18 min left, until ${page.clock(NOW + 18 * MIN)}`, 'Now: Draw the sheet'])
})

test('typed by the person, unknown, or a lane whose window this is not', () => {
  const units = lane([typed(NOW - 40 * MIN, 'Make the quokkaberry glow.'), step(NOW - 2 * MIN, 'Draw the sheet'), toolResult(NOW - MIN)], { plan: card.replace(`"since":${NOW - 49 * MIN}`, `"since":${NOW - 39 * MIN}`) })
  assert.equal(page.laneWindowOf(units, NOW, 'Game - Main').given.from, `Typed by you, ${page.clock(NOW - 40 * MIN)}`)
  const lost = plain(page.laneWindowOf({ ...lane(working), givenTask: null }, NOW, 'Game - Main'))
  assert.deepEqual([lost.given, lost.code, lost.step], [null, 'B12', null])
  for (const state of ['free', 'waiting', 'unknown']) assert.equal(page.laneWindowOf({ ...lane(working), state }, NOW, 'Game - Main'), null, state)
})
