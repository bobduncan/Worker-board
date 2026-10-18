// B161: the Overview's right side has two tabs, "For you" as it is and "Talk to Main": a chat with the main chat, to
// give it new tasks. What the person types there is typed into the main chat as the advisor's tab does; the main
// chat's answers show with their times. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { answer, fromChat, typed, user } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 14, 10, 30)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const app = name => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
const viaBoard = (at, text) => user(at, text, { origin: { kind: 'plugin', name: 'folder-branches', asUser: true } })

const MAIN_TAIL = [
  typed(NOW - 30 * MIN, 'Add a snowy mountain area.'),
  answer(NOW - 29 * MIN, 'I can split that into terrain, enemies and weather. What should we start with?'),
  fromChat(NOW - 20 * MIN, 'Game - Units', 'Report from Game - Units: B12 is merged.'),
  answer(NOW - 19 * MIN, 'Units finished B12.'),
  viaBoard(NOW - 10 * MIN, 'Create the mountain terrain first.\n(typed on the worker board, 10:20)'),
  answer(NOW - 9 * MIN, 'Handed to Game - Levels.'),
  // What the board typed for itself, not the person's own words to the main chat.
  viaBoard(NOW - 5 * MIN, 'spawn workers\nCount: 1\nWhy: asked with the button\n(typed on the worker board, 10:25)'),
  viaBoard(NOW - 4 * MIN, '(answered on the worker board, 10:26) B14 "The archer": approved. Tick this step in the backlog.'),
]

function build({ tails = { Main: MAIN_TAIL }, outbox = [], running = ['Main'] } = {}) {
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: [app('Main'), app('Units')],
    tails: Object.fromEntries(Object.entries(tails).map(([name, lines]) => [`cli-${name}`, { text: lines.join('\n'), isCut: false, modifiedAt: NOW - MIN }])),
    planLineTexts: {}, backlogText: '', adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  const seen = { shown: Object.fromEntries(running.map(name => [name, NOW - 5000])), other: {} }
  return buildState(raw, { outbox, board: { startedAt: NOW - 10 * MIN, offSince: null }, seen, now: NOW, config })
}

test('the talk with the main chat holds what the person typed to it and its answers, with their times', () => {
  const talk = build().mainTalk
  assert.deepEqual([talk.name, talk.isRunning], ['Main', true])
  assert.deepEqual(talk.messages.map(one => [one.from, one.at, one.text]), [
    ['you', NOW - 30 * MIN, 'Add a snowy mountain area.'],
    ['chat', NOW - 29 * MIN, 'I can split that into terrain, enemies and weather. What should we start with?'],
    ['chat', NOW - 19 * MIN, 'Units finished B12.'],
    // Typed on the board: its words without the board's mark, and said to come from the board.
    ['you', NOW - 10 * MIN, 'Create the mountain terrain first.'],
    ['chat', NOW - 9 * MIN, 'Handed to Game - Levels.'],
  ])
  assert.equal(talk.messages[3].via, 'board')
})

test('the workers\' reports and what the board typed for itself (its words for a worker, an answer to a card) are left out', () => {
  const text = JSON.stringify(build().mainTalk.messages)
  for (const word of ['Report from', 'spawn workers', 'answered on the worker board']) assert.ok(!text.includes(word), word)
})

test('what waits to be typed into the main chat shows as such; the board\'s own words to it and words to others do not', () => {
  const sent = (id, more) => ({ id, at: NOW - MIN, to: 'Main', ask: null, step: null, title: null, version: null, verdict: null, text: 'Then add the weather.', state: 'waiting', ...more })
  const talk = build({ outbox: [sent('m1', {}), sent('m2', { command: 'spawn', text: 'spawn workers' }), sent('m3', { to: 'Units' })] }).mainTalk
  assert.deepEqual(talk.pending.map(one => one.id), ['m1'])
})

test('it says when the main chat\'s chat does not run, and there is no talk without a main chat', () => {
  // Another chat's mod asks the board, the main chat's does not: its chat does not run.
  assert.equal(build({ running: ['Units'] }).mainTalk.isRunning, false)
  // B213: no chat's mod asks at all: without the Workers mod the board cannot tell.
  assert.equal(build({ running: [] }).mainTalk.isRunning, null)
  const raw = { listText: '{"prefix":"Game - ","main":"Main"}', appChatTexts: [app('Units')], tails: {}, planLineTexts: {}, backlogText: '', adviceText: null, folders: null, askTexts: [], pictureLists: {} }
  assert.equal(buildState(raw, { now: NOW, config }).mainTalk, null)
})
