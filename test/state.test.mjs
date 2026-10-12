import assert from 'node:assert/strict'
import test from 'node:test'

import { demoSources } from '../fixtures/demo.mjs'
import { answer, assistant, fromChat, step, tool, toolResult, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState, chatState } from '../src/state.mjs'

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 12, 8, 24)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }

const app = (name, extra = {}) => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1', ...extra,
})
const summary = (category, needs = '', detail = '') =>
  ({ postTurnSummary: { status_category: category, status_detail: detail, needs_action: needs, summarizes_uuid: 'u-1' } })
const tail = (lines, quietMinutes = 0) => ({ text: lines.join('\n'), isCut: false, modifiedAt: NOW - quietMinutes * MIN })
const planLine = task => JSON.stringify({ name: 'x', role: 'worker', state: 'working', task, at: NOW - 3 * MIN })
const running = [typed(NOW - 20 * MIN, 'Go'), step(NOW - 2 * MIN, 'Run the tests'), toolResult(NOW - MIN)]
const ended = [typed(NOW - 20 * MIN, 'Go'), answer(NOW - 9 * MIN, 'Done')]

function build({ apps, tails = {}, plans = {}, lines = [], backlog = '', outbox = [] }) {
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: apps,
    tails: Object.fromEntries(Object.entries(tails).map(([name, value]) => [`cli-${name}`, value])),
    planLineTexts: Object.fromEntries(Object.entries(plans).map(([name, value]) => [`cli-${name}`, value])),
    backlogText: backlog,
    adviceText: null,
    folders: null,
  }
  return buildState(raw, { lines, outbox, now: NOW, config })
}
const chatNamed = (state, name) => state.chats.find(chat => chat.name === name)

test('chatState: a running turn is working, whatever the app says', () => {
  assert.equal(chatState({ turn: 'running', category: 'blocked', needsAction: 'Pick one' }), 'working')
})

test('chatState: an ended turn the app calls blocked, or that needs something, waits for you', () => {
  assert.equal(chatState({ turn: 'ended', category: 'blocked', needsAction: '' }), 'waiting')
  assert.equal(chatState({ turn: 'ended', category: 'completed', needsAction: 'Say yes or no' }), 'waiting')
})

test('chatState: an ended turn with anything else is free', () => {
  assert.equal(chatState({ turn: 'ended', category: 'completed', needsAction: '' }), 'free')
  assert.equal(chatState({ turn: 'ended', category: undefined, needsAction: undefined }), 'free')
})

test('chatState: a missing file is unknown', () => {
  assert.equal(chatState({ turn: null }), 'unknown')
  assert.equal(chatState({ turn: 'unknown' }), 'unknown')
})

test('chatState: a turn that asks a question in its chat waits for you', () => {
  assert.equal(chatState({ turn: 'asking', category: undefined, needsAction: undefined }), 'waiting')
})

test('a working chat shows the task of its plan line and what it does now', () => {
  const state = build({
    apps: [app('Main'), app('Units')],
    tails: { Units: tail(running) },
    plans: { Units: planLine({ text: 'Shadow Beast', step: 2, steps: 6, left: 40 * MIN, isReported: false }) },
  })
  const units = chatNamed(state, 'Units')
  assert.equal(units.state, 'working')
  assert.equal(units.doingNow, 'Run the tests')
  assert.equal(units.isQuiet, false)
  assert.deepEqual(units.task, {
    text: 'Shadow Beast', step: 2, steps: 6, leftMs: 40 * MIN, estimateAt: NOW - 3 * MIN, source: 'plan', by: null,
    startedAt: NOW, firstEstimateMs: 40 * MIN, waitedMs: 0,
  })
})

test('a chat whose turn ended blocked waits for you, and its need leads the For you list', () => {
  const state = build({
    apps: [app('Main'), app('Units', summary('blocked', 'Pick sheet A or B', 'two sheets drawn'))],
    tails: { Units: tail(ended) },
    backlog: '## Art\n- [ ] Say whether the mage is right @you\n',
  })
  const units = chatNamed(state, 'Units')
  assert.equal(units.state, 'waiting')
  assert.equal(units.needsYou, 'Pick sheet A or B')
  assert.equal(units.statusDetail, 'two sheets drawn')
  assert.equal(units.waitingSince, NOW - 9 * MIN)
  assert.equal(units.doingNow, null)
  assert.deepEqual(state.forYou, [
    { text: 'Pick sheet A or B', activity: null, chat: 'Units', since: NOW - 9 * MIN },
    { text: 'Say whether the mage is right', activity: 'Art', chat: null, since: null },
  ])
})

test('a chat whose turn ended with nothing open is free, and one without a transcript is unknown', () => {
  const state = build({
    apps: [app('Main'), app('Units', summary('completed')), app('Levels')],
    tails: { Units: tail(ended), Levels: null },
  })
  assert.equal(chatNamed(state, 'Units').state, 'free')
  assert.equal(chatNamed(state, 'Levels').state, 'unknown')
  assert.equal(chatNamed(state, 'Main').state, 'unknown')
  assert.deepEqual(state.counts, { working: 0, waiting: 0, free: 1, unknown: 2 })
})

test('a chat that asked a question in its own chat waits for you', () => {
  const asked = [typed(NOW - 20 * MIN, 'Go'), assistant(NOW - 4 * MIN, 'tool_use', [tool('AskUserQuestion', {})])]
  const units = chatNamed(build({ apps: [app('Units')], tails: { Units: tail(asked, 4) } }), 'Units')
  assert.equal(units.state, 'waiting')
  assert.equal(units.needsYou, 'Asked you a question in its chat.')
  assert.equal(units.waitingSince, NOW - 4 * MIN)
  assert.equal(units.isQuiet, false)
})

test('a summary the app wrote about an older answer is not used', () => {
  const old = { postTurnSummary: { status_category: 'blocked', needs_action: 'Old question', summarizes_uuid: 'u-0' } }
  const units = chatNamed(build({ apps: [app('Units', old)], tails: { Units: tail(ended) } }), 'Units')
  assert.equal(units.state, 'free')
  assert.equal(units.needsYou, null)
})

test('a running turn that wrote nothing for more than ten minutes is quiet', () => {
  const units = chatNamed(build({ apps: [app('Units')], tails: { Units: tail(running, 14) } }), 'Units')
  assert.equal(units.state, 'working')
  assert.equal(units.quietMs, 14 * MIN)
  assert.equal(units.isQuiet, true)
})

test('a worker without a task in its plan line takes the task handed over to it; the main chat does not', () => {
  const handOver = fromChat(NOW - 30 * MIN, 'Game - Main', 'Task from Game - Main: build the archer.\nDetails follow.')
  const report = fromChat(NOW - 30 * MIN, 'Game - Units', 'The knight is finished.')
  const state = build({
    apps: [app('Main'), app('Units')],
    tails: { Units: tail([handOver, ...running]), Main: tail([report, ...running]) },
    plans: { Units: planLine(null) },
  })
  assert.deepEqual(chatNamed(state, 'Units').task, {
    text: 'Build the archer', step: null, steps: null, leftMs: null, estimateAt: null, source: 'handover', by: null,
    startedAt: NOW - 30 * MIN, firstEstimateMs: null, waitedMs: 0,
  })
  // A report is no task for the main chat; its card shows what started the turn it is in.
  assert.deepEqual([chatNamed(state, 'Main').task.source, chatNamed(state, 'Main').task.by], ['prompt', 'Units'])
})

test('a working chat that named no task shows what started its turn, and who asked', () => {
  const asked = [answer(NOW - 40 * MIN, 'Done'), typed(NOW - 25 * MIN, 'Make the lava glow more. It looks flat.'), step(NOW - 2 * MIN, 'Read the shader')]
  const units = chatNamed(build({ apps: [app('Units')], tails: { Units: tail(asked) } }), 'Units')
  assert.deepEqual(units.task, {
    text: 'Make the lava glow more', step: null, steps: null, leftMs: null, estimateAt: null, source: 'prompt', by: 'you',
    startedAt: NOW - 25 * MIN, firstEstimateMs: null, waitedMs: 0,
  })
  const main = chatNamed(build({
    apps: [app('Main')],
    tails: { Main: tail([answer(NOW - 40 * MIN, 'Done'), fromChat(NOW - 5 * MIN, 'Game - Units', 'The archer is merged.'), step(NOW - 2 * MIN, 'Read the backlog')]) },
  }), 'Main')
  assert.deepEqual([main.task.text, main.task.by], ['The archer is merged', 'Units'])
  const ended = chatNamed(build({ apps: [app('Units')], tails: { Units: tail([typed(NOW - 25 * MIN, 'Make the lava glow more.'), answer(NOW - 9 * MIN, 'Done')]) } }), 'Units')
  assert.equal(ended.task, null)
})

test('what the history recorded as the start of a long turn stands when the tail only holds a later remark', () => {
  const lines = [{ at: NOW - 90 * MIN, chat: 'Units', state: 'working', task: 'Make the lava glow more', step: null, steps: null, leftMs: null, startedAt: NOW - 91 * MIN, source: 'prompt', by: 'you' }]
  const remark = [toolResult(NOW - 12 * MIN), typed(NOW - 10 * MIN, 'How far are you?'), step(NOW - 2 * MIN, 'Run the tests')]
  const units = chatNamed(build({ apps: [app('Units')], tails: { Units: tail(remark) }, lines }), 'Units')
  assert.deepEqual([units.task.text, units.task.by, units.task.startedAt], ['Make the lava glow more', 'you', NOW - 91 * MIN])
  const fresh = chatNamed(build({ apps: [app('Units')], tails: { Units: tail(remark) } }), 'Units')
  assert.equal(fresh.task.text, 'How far are you')
})

test('a task handed over further back than the tail is found by the longer look back', () => {
  const handOver = fromChat(NOW - 200 * MIN, 'Game - Main', 'Build the worker board.')
  const report = minutesAgo => assistant(NOW - minutesAgo * MIN, 'tool_use', [tool('SendMessage', { to: 'Game - Main', message: 'Done.' })])
  const units = chatNamed(build({
    apps: [app('Units')],
    tails: { Units: { ...tail(running), earlier: [report(210), handOver].join('\n') } },
  }), 'Units')
  assert.equal(units.task.text, 'Build the worker board')
  assert.equal(units.task.source, 'handover')
  assert.equal(units.task.startedAt, NOW - 200 * MIN)
  assert.equal(units.doingNow, 'Run the tests')
  // Reported since: that task is finished, and the chat is on what was typed to it afterwards.
  const after = chatNamed(build({
    apps: [app('Units')],
    tails: { Units: { ...tail(running), earlier: [handOver, report(190), answer(NOW - 189 * MIN, 'Reported.')].join('\n') } },
  }), 'Units')
  assert.deepEqual([after.task.text, after.task.source], ['Go', 'prompt'])
})

test('a handed-over task the tail no longer holds is kept from the history, until the chat is free', () => {
  const lines = [{ at: NOW - 60 * MIN, chat: 'Units', state: 'working', task: 'Build the archer', step: null, steps: null, leftMs: null, startedAt: NOW - 62 * MIN, source: 'handover' }]
  const busy = chatNamed(build({ apps: [app('Units')], tails: { Units: tail(running) }, lines }), 'Units')
  assert.equal(busy.task.text, 'Build the archer')
  assert.equal(busy.task.startedAt, NOW - 62 * MIN)
  const free = chatNamed(build({ apps: [app('Units', summary('completed'))], tails: { Units: tail(ended) }, lines }), 'Units')
  assert.equal(free.task, null)
  const reported = [...running, assistant(NOW - MIN, 'tool_use', [tool('SendMessage', { to: 'Game - Main', message: 'Finished.' })])]
  assert.equal(chatNamed(build({ apps: [app('Units')], tails: { Units: tail(reported) }, lines }), 'Units').task, null)
})

test('a task keeps the start, the first estimate and the waiting time the history recorded', () => {
  const line = (minutesAgo, state, leftMs) =>
    ({ at: NOW - minutesAgo * MIN, chat: 'Units', state, task: 'Shadow Beast', step: 1, steps: 6, leftMs, startedAt: null, source: 'plan' })
  const state = build({
    apps: [app('Units')],
    tails: { Units: tail(running) },
    plans: { Units: planLine({ text: 'Shadow Beast', step: 2, steps: 6, left: 40 * MIN, isReported: false }) },
    lines: [line(110, 'working', null), line(100, 'working', 120 * MIN), line(50, 'waiting', 80 * MIN), line(30, 'working', 60 * MIN)],
  })
  const task = chatNamed(state, 'Units').task
  assert.equal(task.startedAt, NOW - 110 * MIN)
  assert.equal(task.firstEstimateMs, 130 * MIN)
  assert.equal(task.waitedMs, 20 * MIN)
  assert.equal(task.leftMs, 40 * MIN)
})

test('the queue, the open work and the outbox pass through, and a leftover chat is greyed and not counted', () => {
  const state = build({
    apps: [app('Main'), app('Main (fork)'), app('Units')],
    tails: { Main: tail(ended), Units: tail(running) },
    backlog: '## Game #focus\n- [ ] Step 4 (branch feature/x)\n\n## Next to hand out (Game - Main)\n- [ ] Main menu (for Units; about 40 min)\n',
    outbox: [{ id: 'a', at: NOW, text: 'Hello', state: 'waiting' }],
  })
  assert.deepEqual(state.chats.map(chat => [chat.name, chat.isLeftover]), [['Main', false], ['Units', false], ['Main (fork)', true]])
  assert.deepEqual(state.counts, { working: 1, waiting: 0, free: 1, unknown: 0 })
  assert.deepEqual(state.queue.map(item => [item.title, item.worker, item.minutes]), [['Main menu', 'Units', 40]])
  assert.deepEqual(state.openWork.map(item => item.branch), ['feature/x'])
  assert.deepEqual(state.outbox, [{ id: 'a', at: NOW, text: 'Hello', state: 'waiting' }])
  assert.deepEqual(state.today.map(lane => lane.chat), ['Main', 'Units'])
  assert.equal(state.readAt, NOW)
})

test('the dock shows the main chat, with the names of the chats that reported', () => {
  const state = build({
    apps: [app('Main'), app('Units')],
    tails: { Main: tail([typed(NOW - 9 * MIN, 'Status?'), fromChat(NOW - 8 * MIN, 'Game - Units', 'Archer done.'), answer(NOW - 7 * MIN, 'Units is done.')]) },
  })
  assert.deepEqual(state.mainChat.map(message => [message.who, message.text]), [['You', 'Status?'], ['Units', 'Archer done.'], ['Main', 'Units is done.']])
})

test('sources that are missing or broken give an empty board, never an error', () => {
  const state = buildState({}, { now: NOW, config })
  assert.deepEqual(state.chats, [])
  assert.deepEqual([state.forYou, state.queue, state.openWork, state.mainChat, state.outbox, state.today], [[], [], [], [], [], []])
  assert.equal(state.folders, null)
  assert.equal(state.advice, null)
  assert.doesNotThrow(() => buildState({ appChatTexts: ['{', 'null', '5'], tails: { x: { text: '{', isCut: true, modifiedAt: 1 } }, backlogText: 5 }, { now: NOW, config }))
})

test('the demo shows the five chats of the design, in the states the design shows', async () => {
  const demo = await demoSources(NOW)
  const state = buildState(demo, { lines: demo.historyLines, now: NOW, config: { ...config, project: demo.project } })
  assert.deepEqual(state.chats.map(chat => [chat.name, chat.state]), [
    ['Main', 'working'],
    ['Units', 'waiting'],
    ['Features', 'working'],
    ['Cleanup', 'free'],
    ['Levels / Environment', 'working'],
  ])
  assert.deepEqual(state.counts, { working: 3, waiting: 1, free: 1, unknown: 0 })
  assert.equal(state.queue.length, 3)
  assert.equal(state.folders.length, 5)
  assert.ok(state.mainChat.length >= 5)
  assert.ok(state.today.every(lane => lane.spans.length > 0))
  assert.match(state.advice, /pathfinding/)
})
