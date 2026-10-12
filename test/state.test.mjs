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

function build({ apps, tails = {}, plans = {}, lines = [], backlog = '', outbox = [], asks = [], folders = null, pictureLists = {} }) {
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: apps,
    tails: Object.fromEntries(Object.entries(tails).map(([name, value]) => [`cli-${name}`, value])),
    planLineTexts: Object.fromEntries(Object.entries(plans).map(([name, value]) => [`cli-${name}`, value])),
    backlogText: backlog,
    adviceText: null,
    folders,
    askTexts: asks.map(ask => JSON.stringify(ask)),
    pictureLists,
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
    // First seen now, in a turn the person opened 20 minutes ago, with an estimate given 3 minutes ago.
    startedAt: NOW - 20 * MIN, firstEstimateMs: 57 * MIN, waitedMs: 0, workedMs: 20 * MIN,
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
  assert.deepEqual(state.forYou, [{
    id: `chat:Units:${NOW - 9 * MIN}`, from: 'Units', kind: 'input', title: 'Needs your decision', text: 'Pick sheet A or B', at: NOW - 9 * MIN,
    options: [], pictures: [], run: null, checks: [], tried: [], canAnswer: true, answer: null,
  }])
  assert.deepEqual(state.backlogForYou, [{ text: 'Say whether the mage is right', activity: 'Art', pictures: [] }])
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

test('a question asked with the app\'s own form is shown, but cannot be answered on the board', () => {
  const asked = [typed(NOW - 20 * MIN, 'Go'), assistant(NOW - 4 * MIN, 'tool_use', [tool('AskUserQuestion', {})])]
  const need = build({ apps: [app('Units')], tails: { Units: tail(asked, 4) } }).forYou[0]
  assert.deepEqual([need.title, need.kind, need.canAnswer], ['Asked you a question in its chat', 'input', false])
})

test('a request a chat filed is shown as filed, newest first, and stands in for the chat\'s own waiting', () => {
  const ask = (id, at, extra = {}) => ({ id, from: 'Units', kind: 'verify', title: `Check ${id}`, text: 'Look.', at, ...extra })
  const state = build({
    apps: [app('Main'), app('Units', summary('blocked', 'Pick sheet A or B'))],
    tails: { Units: tail(ended) },
    asks: [ask('old', NOW - 50 * MIN), ask('new', NOW - 5 * MIN, { checks: ['It walks'] }), ask('closed', NOW, { state: 'answered' }), { ...ask('stray', NOW - 20 * MIN), from: 'Nobody' }],
  })
  assert.deepEqual(state.forYou.map(need => [need.id, need.from, need.canAnswer]), [['new', 'Units', true], ['stray', 'Nobody', false], ['old', 'Units', true]])
  assert.deepEqual(state.forYou[0].checks, ['It walks'])
})

test('a request shows the answer that was sent for it, until it is delivered or too old', () => {
  const state = build({
    apps: [app('Units')],
    tails: { Units: tail(ended) },
    asks: [{ id: 'sheet', from: 'Units', kind: 'verify', title: 'Check the sheet', at: NOW - 30 * MIN }],
    outbox: [
      { id: 'm1', at: NOW - 9 * MIN, to: 'Units', ask: 'sheet', verdict: 'reject', text: 'Too dark.', state: 'expired' },
      { id: 'm2', at: NOW - MIN, to: 'Units', ask: 'sheet', verdict: 'approve', text: '', state: 'waiting' },
      { id: 'm3', at: NOW - MIN, to: 'Units', ask: 'other', verdict: null, text: 'Hello', state: 'waiting' },
    ],
  })
  assert.deepEqual(state.forYou[0].answer, { at: NOW - MIN, verdict: 'approve', text: '', state: 'waiting' })
})

test('a running turn without a sign of life is raised for you, and cannot be answered on the board', () => {
  const state = build({ apps: [app('Units')], tails: { Units: tail(running, 14) } })
  assert.deepEqual(state.forYou.map(need => [need.id, need.kind, need.title, need.canAnswer]), [['quiet:Units', 'intervene', 'No sign of life for 14 min', false]])
})

test('a working chat with an estimate has a time it expects to be done, and its queue is planned after it', () => {
  const state = build({
    apps: [app('Main'), app('Units'), app('Levels')],
    tails: { Units: tail(running), Levels: tail(running), Main: tail(ended) },
    plans: {
      Units: planLine({ text: 'Archer', step: 1, steps: 3, left: 25 * MIN }),
      Levels: planLine({ text: 'Forest', left: 2 * MIN }),
    },
    backlog: '## Next to hand out (Game - Main)\n- [ ] Knight rows (for Units; about 30 min)\n- [ ] Polish (for Units)\n- [ ] Banner (for Units; about 10 min)\n- [ ] Lava biome (for Levels; about 1 h)\n- [ ] Name the game\n',
  })
  const units = chatNamed(state, 'Units')
  assert.deepEqual(units.eta, { at: NOW + 22 * MIN, leftMs: 22 * MIN, isOverdue: false })
  assert.deepEqual(units.queue.map(step => [step.title, step.minutes]), [['Knight rows', 30], ['Polish', null], ['Banner', 10]])
  // The plan stops at the first step without a time: what follows it cannot be placed.
  assert.deepEqual(units.ahead, [
    { from: NOW, to: NOW + 22 * MIN, title: 'Archer', isQueued: false },
    { from: NOW + 22 * MIN, to: NOW + 52 * MIN, title: 'Knight rows', isQueued: true },
  ])
  // An estimate that has run out gives no time and no plan.
  const levels = chatNamed(state, 'Levels')
  assert.deepEqual([levels.eta.isOverdue, levels.eta.leftMs, levels.ahead], [true, 0, []])
  assert.deepEqual([chatNamed(state, 'Main').eta, chatNamed(state, 'Main').queue], [null, []])
  assert.deepEqual(state.unassigned.map(step => step.title), ['Name the game'])
  assert.equal(state.day.until, NOW + 52 * MIN)
  assert.deepEqual(state.today.map(lane => [lane.chat, lane.ahead.length]), [['Main', 0], ['Units', 2], ['Levels', 0]])
})

test('a folder is shown with the worker an open step names for its branch; the others are listed apart', () => {
  const folder = (name, branch) => ({ path: `C:/game-${name}`, name, branch, ahead: 2, uncommitted: 0, lastCommitAt: NOW })
  const state = build({
    apps: [app('Main'), app('Units')],
    tails: { Units: tail(running) },
    backlog: '## Art #focus\n- [ ] The beast (Game - Units; branch feature/beast)\n- [x] The mage (Game - Units; branch feature/mage)\n',
    folders: [folder('game', 'main'), folder('beast', 'feature/beast'), folder('mage', 'feature/mage'), folder('probe', null), folder('units', 'fix/walk'), folder('main', 'docs/notes')],
  })
  // "beast" by the step that names Units with its branch; "units" and "main" by their names.
  assert.deepEqual(chatNamed(state, 'Units').folders.map(one => one.name), ['beast', 'units'])
  assert.deepEqual(chatNamed(state, 'Main').folders.map(one => one.name), ['main'])
  assert.deepEqual(state.otherFolders.map(one => one.name), ['mage', 'probe'])
  assert.equal(state.hasFolders, true)
})

test('a step for you in the backlog shows the pictures of the folder it points to', () => {
  const state = build({
    apps: [app('Main')],
    backlog: '## Art\n- [ ] Say whether the mage is right (pictures in art-inbox/red-mage) @you\n- [ ] Pick a name @you\n',
    pictureLists: { 'art-inbox/red-mage': ['art-inbox/red-mage/a.png', 'art-inbox/red-mage/b.png'], 'art-inbox/other': ['art-inbox/other/c.png'] },
  })
  assert.deepEqual(state.backlogForYou.map(step => step.pictures), [['art-inbox/red-mage/a.png', 'art-inbox/red-mage/b.png'], []])
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
    startedAt: NOW - 30 * MIN, firstEstimateMs: null, waitedMs: 0, workedMs: 30 * MIN,
  })
  // A report is no task for the main chat; its card shows what started the turn it is in.
  assert.deepEqual([chatNamed(state, 'Main').task.source, chatNamed(state, 'Main').task.by], ['prompt', 'Units'])
})

test('a working chat that named no task shows what started its turn, and who asked', () => {
  const asked = [answer(NOW - 40 * MIN, 'Done'), typed(NOW - 25 * MIN, 'Make the lava glow more. It looks flat.'), step(NOW - 2 * MIN, 'Read the shader')]
  const units = chatNamed(build({ apps: [app('Units')], tails: { Units: tail(asked) } }), 'Units')
  assert.deepEqual(units.task, {
    text: 'Make the lava glow more', step: null, steps: null, leftMs: null, estimateAt: null, source: 'prompt', by: 'you',
    startedAt: NOW - 25 * MIN, firstEstimateMs: null, waitedMs: 0, workedMs: 25 * MIN,
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
  const handOver = fromChat(NOW - 200 * MIN, 'Game - Main', 'Task from Game - Main: build the worker board.')
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
  // Reported, but the turn still runs: the task stands until it ends.
  const report = minutesAgo => assistant(NOW - minutesAgo * MIN, 'tool_use', [tool('SendMessage', { to: 'Game - Main', message: 'Finished.' })])
  const wrappingUp = chatNamed(build({ apps: [app('Units')], tails: { Units: tail([...running, report(1)]) }, lines }), 'Units')
  assert.equal(wrappingUp.task.text, 'Build the archer')
  // Reported and ended, and now on something the person typed: the remembered task is over.
  const next = [typed(NOW - 20 * MIN, 'Go'), report(15), toolResult(NOW - 15 * MIN), answer(NOW - 14 * MIN, 'Reported.'), typed(NOW - 5 * MIN, 'One more thing.'), step(NOW - 2 * MIN, 'Look')]
  const after = chatNamed(build({ apps: [app('Units')], tails: { Units: tail(next) }, lines }), 'Units')
  assert.deepEqual([after.task.text, after.task.source], ['One more thing', 'prompt'])
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
  // Worked: 10 + 50 minutes before it waited, and 30 since. The estimate is compared with this, not with the clock.
  assert.equal(task.workedMs, 90 * MIN)
})

test('the scenarios of the review: a thank-you from the main chat is no task, and an old hand-over is not the start of a new one', () => {
  const handOver = fromChat(NOW - 190 * MIN, 'Game - Main', 'Task from Game - Main: build the archer.')
  const report = assistant(NOW - 100 * MIN, 'tool_use', [tool('SendMessage', { to: 'Game - Main', message: 'Finished.' })])
  const thanks = fromChat(NOW - 95 * MIN, 'Game - Main', 'From the main chat: thanks, merged. Nothing more for now.')
  const past = [handOver, report, toolResult(NOW - 100 * MIN), answer(NOW - 99 * MIN, 'Reported.'), thanks, answer(NOW - 94 * MIN, 'Noted.')]
  const now = [typed(NOW - 30 * MIN, 'Fix the lava glow.'), step(NOW - 2 * MIN, 'Read the shader')]

  const unnamed = chatNamed(build({ apps: [app('Main'), app('Units')], tails: { Units: tail([...past, ...now]) } }), 'Units')
  assert.deepEqual([unnamed.task.text, unnamed.task.source, unnamed.task.startedAt], ['Fix the lava glow', 'prompt', NOW - 30 * MIN])

  const named = chatNamed(build({
    apps: [app('Main'), app('Units')],
    tails: { Units: tail([...past, ...now]) },
    plans: { Units: JSON.stringify({ name: 'Units', task: { text: 'Lava glow', left: 30 * MIN }, at: NOW - 15 * MIN }) },
  }), 'Units')
  assert.deepEqual([named.task.text, named.task.startedAt, named.task.firstEstimateMs], ['Lava glow', NOW - 30 * MIN, 45 * MIN])

  // A hand-over that was never reported is still not the start of a task the person asked for later.
  const unreported = chatNamed(build({
    apps: [app('Main'), app('Units')],
    tails: { Units: tail([handOver, answer(NOW - 99 * MIN, 'Which sheet?'), ...now]) },
    plans: { Units: JSON.stringify({ name: 'Units', task: { text: 'Lava glow', left: 30 * MIN }, at: NOW - 15 * MIN }) },
  }), 'Units')
  assert.equal(unreported.task.startedAt, NOW - 30 * MIN)
})

test('the first estimate is dated by when the chat gave it, also when the board saw it later', () => {
  const state = build({
    apps: [app('Main'), app('Units')],
    tails: { Units: tail([fromChat(NOW - 40 * MIN, 'Game - Main', 'Task from Game - Main: build the archer.'), step(NOW - 2 * MIN, 'Draw')]) },
    plans: { Units: JSON.stringify({ name: 'Units', task: { text: 'Archer', left: 40 * MIN }, at: NOW - 30 * MIN }) },
    // The board recorded the task ten minutes ago, twenty minutes after the estimate was given.
    lines: [{ at: NOW - 10 * MIN, chat: 'Units', state: 'working', task: 'Archer', step: null, steps: null, leftMs: 40 * MIN, estimateAt: NOW - 30 * MIN, startedAt: NOW - 40 * MIN, source: 'plan', by: null }],
  })
  const task = chatNamed(state, 'Units').task
  assert.deepEqual([task.startedAt, task.firstEstimateMs, task.workedMs], [NOW - 40 * MIN, 50 * MIN, 40 * MIN])
})

test('building the state prints nothing, whatever the sources hold', () => {
  const printed = []
  const real = { log: console.log, error: console.error, warn: console.warn, info: console.info }
  for (const name of Object.keys(real)) console[name] = (...parts) => printed.push(parts.join(' '))
  try {
    build({ apps: [app('Main'), app('Units'), '{ broken'], tails: { Units: tail([...running, '{ broken line with words from a chat']), Main: tail(ended) }, backlog: '## A\n- [ ] B @you\n' })
    buildState({ tails: 5, appChatTexts: 'x', planLineTexts: null }, { now: NOW, config })
  } finally {
    Object.assign(console, real)
  }
  assert.deepEqual(printed, [])
})

test('a leftover chat is greyed and not counted, and the advisor has no lane', () => {
  const state = build({
    apps: [app('Main'), app('Main (fork)'), app('Units'), app('Advisor')],
    tails: { Main: tail(ended), Units: tail(running), Advisor: tail(ended) },
    backlog: '## Next to hand out (Game - Main)\n- [ ] Main menu (for Units; about 40 min)\n- [ ] Advice round (for Advisor)\n',
  })
  assert.deepEqual(state.chats.map(chat => [chat.name, chat.isLeftover]), [['Main', false], ['Units', false], ['Main (fork)', true]])
  assert.deepEqual(state.counts, { working: 1, waiting: 0, free: 1, unknown: 0 })
  assert.deepEqual(chatNamed(state, 'Units').queue.map(step => step.title), ['Main menu'])
  assert.deepEqual(state.unassigned.map(step => step.title), ['Advice round'])
  assert.deepEqual(state.today.map(lane => lane.chat), ['Main', 'Units'])
  assert.equal(state.readAt, NOW)
})

test('the advisor is talked with: its conversation, its state, and what was typed to it and is not there yet', () => {
  const state = build({
    apps: [app('Main'), app('Advisor')],
    tails: { Advisor: tail([typed(NOW - 9 * MIN, 'What next?'), fromChat(NOW - 8 * MIN, 'Game - Main', 'From the main chat: the archer is merged.'), answer(NOW - 7 * MIN, 'Hand out the knight.')]) },
    outbox: [
      { id: 'm1', at: NOW - MIN, to: 'Advisor', ask: null, verdict: null, text: 'And after that?', state: 'waiting' },
      { id: 'm2', at: NOW - MIN, to: 'Main', ask: null, verdict: null, text: 'Not for the advisor', state: 'waiting' },
    ],
  })
  assert.deepEqual([state.advisor.name, state.advisor.state], ['Advisor', 'free'])
  assert.deepEqual(state.advisor.messages.map(message => [message.from, message.who, message.text]), [
    ['you', 'You', 'What next?'],
    ['report', 'Main', 'From the main chat: the archer is merged.'],
    ['chat', 'Advisor', 'Hand out the knight.'],
  ])
  assert.deepEqual(state.advisor.pending.map(message => message.text), ['And after that?'])
  assert.equal(build({ apps: [app('Main')] }).advisor, null)
})

test('sources that are missing or broken give an empty board, never an error', () => {
  const state = buildState({}, { now: NOW, config })
  assert.deepEqual(state.chats, [])
  assert.deepEqual([state.forYou, state.backlogForYou, state.unassigned, state.otherFolders, state.today], [[], [], [], [], []])
  assert.deepEqual([state.hasFolders, state.advisor, state.advice], [false, null, null])
  assert.doesNotThrow(() => buildState({ askTexts: ['{', 'null', 5, '{"id":"x"}'], pictureLists: 7, folders: 'x' }, { outbox: 'x', now: NOW, config }))
  assert.doesNotThrow(() => buildState({ appChatTexts: ['{', 'null', '5'], tails: { x: { text: '{', isCut: true, modifiedAt: 1 } }, backlogText: 5 }, { now: NOW, config }))
})

test('the demo shows the second design: five lanes with their queues, two requests, and the advisor', async () => {
  const demo = await demoSources(NOW)
  const state = buildState(demo, { lines: demo.historyLines, now: NOW, config: { ...config, project: demo.project } })
  assert.deepEqual(state.chats.map(chat => [chat.name, chat.state, chat.queue.length]), [
    ['Main', 'working', 3],
    ['Units', 'waiting', 2],
    ['Features', 'working', 3],
    ['Cleanup', 'free', 1],
    ['Levels / Environment', 'working', 2],
  ])
  assert.deepEqual(state.counts, { working: 3, waiting: 1, free: 1, unknown: 0 })
  assert.deepEqual(state.chats.map(chat => (chat.eta === null ? null : Math.round(chat.eta.leftMs / MIN))), [22, null, 105, null, 34])
  assert.deepEqual(state.chats.map(chat => chat.folders.map(folder => folder.name)), [[], ['units'], ['features'], ['cleanup'], ['levels']])
  assert.deepEqual(state.otherFolders.map(folder => folder.name), [])
  assert.deepEqual(state.unassigned.map(step => step.title), ['Decide the name of the game'])

  assert.deepEqual(state.forYou.map(need => [need.from, need.kind, need.title, need.canAnswer]), [
    ['Main', 'verify', 'Test player movement', true],
    ['Units', 'input', 'Choose pathfinding approach', true],
  ])
  assert.deepEqual(state.forYou[1].options.map(option => [option.picture, option.isRecommended]), [
    ['art-inbox/pathfinding/option-a-navmesh.png', true],
    ['art-inbox/pathfinding/option-b-grid.png', false],
  ])
  assert.equal(state.forYou[0].run.url, 'http://localhost:5173/')
  assert.deepEqual(state.backlogForYou.map(step => [step.text, step.pictures]), [
    ['Say whether the jump feels right (picture in art-inbox/jump)', ['art-inbox/jump/jump-arc.png']],
  ])

  assert.deepEqual([state.advisor.name, state.advisor.state, state.advisor.messages.length], ['Advisor', 'free', 4])
  assert.ok(state.today.every(lane => lane.spans.length > 0))
  assert.equal(state.today.filter(lane => lane.ahead.length > 0).length, 3)
  assert.match(state.advice, /pathfinding/)
})
