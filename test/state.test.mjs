import assert from 'node:assert/strict'
import test from 'node:test'

import { demoSources } from '../fixtures/demo.mjs'
import { answer, assistant, fromChat, modCompaction, step, tool, toolResult, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { hourEnd, hourStart } from '../src/history.mjs'
import { chatState } from '../src/state.mjs'
import { parseItem } from '../src/work/item.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { buildState } from './withStore.mjs'
import { BACKLOG, GOALS } from './fixtures-goals.mjs'

const MIN = 60_000

/** B151: what the page gets outside the window of a working lane, which shows the task as it was given (`givenTask`) and, B281, the feedback it is on (`feedback`). */
const outsideWindow = state => JSON.stringify({ ...state, chats: (state.chats ?? []).map(({ givenTask, feedback, ...lane }) => lane) })
const NOW = Date.UTC(2026, 9, 12, 8, 24)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT, pictureRoots: ['art-inbox'] }

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
// B262: a turn the person opened that has had no answer at all: a quiet one of these runs without a sign of life.
const noAnswer = [typed(NOW - 14 * MIN, 'Go')]

function build({ apps, tails = {}, plans = {}, lines = [], backlog = '', goals = null, outbox = [], asks = [], folders = null, pictureLists = {}, runs = [], restartNote = null, board = null, seen = null, work }) {
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: apps,
    tails: Object.fromEntries(Object.entries(tails).map(([name, value]) => [`cli-${name}`, value])),
    planLineTexts: Object.fromEntries(Object.entries(plans).map(([name, value]) => [`cli-${name}`, value])),
    backlogText: backlog,
    goalsText: goals,
    adviceText: null,
    folders,
    askTexts: asks.map(ask => JSON.stringify(ask)),
    pictureLists,
    restartNote,
    work,
  }
  return buildState(raw, { lines, outbox, runs, board, seen, now: NOW, config })
}
const chatNamed = (state, name) => state.chats.find(chat => chat.name === name)

test('B255: the state carries the goal map with counters and its file, or null without a file', () => {
  const state = build({ apps: [app('Main')], backlog: BACKLOG, goals: GOALS })
  assert.deepEqual(state.goals.roots, ['G1', 'G7'])
  assert.deepEqual(state.goals.problems, [])
  assert.deepEqual(state.goals.nodes.find(one => one.id === 'G2').counts, { nodes: 2, steps: 4, done: 3, open: 1, unknown: 0, missing: 1 })
  assert.equal(state.goals.nodes.find(one => one.id === 'G9').alsoPartOf[0], 'G5')
  assert.equal(state.goals.file, '.claude/goals.md')
  assert.equal(build({ apps: [app('Main')], backlog: BACKLOG }).goals, null)
  assert.equal(build({ apps: [app('Main')], backlog: BACKLOG }).goalsFile, '.claude/goals.md')
})

test('B258: the state lists the asks under the goals, an answer not yet read as a need, and the answers\' folder', () => {
  const answered = GOALS.replace('what differs most from the picture?\n', 'what differs most from the picture?\n      Answer (2026-10-15 19:20, Advisor): the shading.\n')
  const state = build({ apps: [app('Main')], backlog: BACKLOG, goals: answered })
  assert.deepEqual(state.goalAsks.map(one => [one.goal, one.ask.id]), [['G6', 'A1']])
  assert.deepEqual(state.goalAskNeeds.map(need => [need.kind, need.id, need.goal]), [['goal-ask', 'A1', 'G6']])
  assert.equal(state.goalAsksFolder, '.claude/goal-asks')
  // A question still open is nothing for the person yet; no map, no asks.
  assert.deepEqual(build({ apps: [app('Main')], backlog: BACKLOG, goals: GOALS }).goalAskNeeds, [])
  assert.deepEqual(build({ apps: [app('Main')], backlog: BACKLOG }).goalAsks, [])
})

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
    text: 'Shadow Beast', step: 2, steps: 6, names: null, leftMs: 40 * MIN, estimateAt: NOW - 3 * MIN, stepLeftMs: null, stepEstimateAt: null, source: 'plan', by: null,
    // First seen now, in a turn the person opened 20 minutes ago, with an estimate given 3 minutes ago.
    startedAt: NOW - 20 * MIN, firstEstimateMs: 57 * MIN, waitedMs: 0, workedMs: 20 * MIN, stepId: null, stepMinutes: null,
  })
})

test('B301: the app\'s word that a turn ended blocked makes no chat wait: only an open blocking ask in the store does', () => {
  const apps = [app('Main'), app('Units', summary('blocked', 'Pick sheet A or B', 'two sheets drawn'))]
  const blocked = build({ apps, tails: { Units: tail(ended) }, backlog: '## Art\n- [ ] Say whether the mage is right @you\n' })
  assert.equal(chatNamed(blocked, 'Units').state, 'free')
  assert.deepEqual(blocked.forYou, [])
  assert.deepEqual(blocked.backlogForYou.map(step => [step.title, step.activity, step.kind, step.from, step.canAnswer]), [['Say whether the mage is right', 'Art', 'input', 'Main', true]])
  // With its ask filed, blocking, it waits, and the ask is the card.
  const work = storeFromText('## Art\n- [ ] B1 The sheets (for Units)\n', { now: NOW })
  work.items.set('Q1', parseItem('Id: Q1\nKind: ask\nTitle: Sheet A or B?\nState: open\nOwner: Units\nSince: 2026-10-12 14:50\nAsks: decide\nBlocking: yes\nOf: B1\nOptions: A | B\n'))
  const state = build({ apps, tails: { Units: tail(ended) }, work })
  const units = chatNamed(state, 'Units')
  assert.deepEqual([units.state, units.needsYou, units.statusDetail, units.waitingSince, units.doingNow], ['waiting', 'Pick sheet A or B', 'two sheets drawn', NOW - 9 * MIN, null])
  assert.deepEqual(state.forYou.map(need => [need.id, need.from, need.kind, need.title, need.canAnswer, need.blocks]), [['work:Q1', 'Units', 'input', 'Sheet A or B?', true, [{ step: 'B1', owner: 'Units' }]]])
})

test('a chat whose turn ended with nothing open is free, and one without a transcript is unknown', () => {
  const state = build({
    apps: [app('Main'), app('Units', summary('completed')), app('Levels')],
    tails: { Units: tail(ended), Levels: null },
  })
  assert.equal(chatNamed(state, 'Units').state, 'free')
  assert.equal(chatNamed(state, 'Levels').state, 'unknown')
  assert.equal(chatNamed(state, 'Main').state, 'unknown')
  assert.deepEqual(state.counts, { working: 0, waiting: 0, free: 1, unknown: 2, interrupted: 0, suspended: 0, off: 0 })
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
  assert.deepEqual(state.forYou[0].answer, { at: NOW - MIN, verdict: 'approve', text: '', state: 'waiting', takenAt: null, deliveredAt: null })
})

test('a running turn without a sign of life is raised for you, and cannot be answered on the board', () => {
  const state = build({ apps: [app('Units')], tails: { Units: tail(noAnswer, 14) } })
  assert.deepEqual(state.forYou.map(need => [need.id, need.kind, need.title, need.canAnswer]), [['quiet:Units', 'intervene', 'No sign of life for 14 min', false]])
})

test('B247: a worker a mod compacted after its report is free, not a turn without a sign of life', () => {
  const card = JSON.stringify({ name: 'Units', role: 'worker', state: 'waiting', task: null, at: NOW - 9 * MIN, compacted: { at: NOW - 8 * MIN, before: 349824, after: 0 } })
  const state = build({ apps: [app('Units', summary('completed'))], tails: { Units: tail([...ended, ...modCompaction(NOW - 8 * MIN)], 8) }, plans: { Units: card } })
  assert.equal(chatNamed(state, 'Units').state, 'free')
  assert.equal(chatNamed(state, 'Units').isQuiet, false)
  assert.deepEqual(state.forYou, [])
})

test('B247: a quiet chat whose step has no answer names that step, and that it may wait for your approval in its chat', () => {
  const hung = [typed(NOW - 40 * MIN, 'Go'), assistant(NOW - 30 * MIN, 'tool_use', [tool('mcp__Claude_Browser__preview_start', { name: 'demo' })])]
  const state = build({ apps: [app('Units')], tails: { Units: tail(hung, 30) } })
  assert.deepEqual(chatNamed(state, 'Units').unanswered, { doing: 'Working in the browser', since: NOW - 30 * MIN })
  const [need] = state.forYou
  assert.equal(need.title, 'No sign of life for 30 min')
  assert.equal(need.text, 'Its step "Working in the browser" has had no answer for 30 min. The app may wait for your approval of it in its chat, or the tool hangs. Look at its chat.')
  // A running turn without a step that waits keeps the plain words.
  assert.match(build({ apps: [app('Units')], tails: { Units: tail(noAnswer, 14) } }).forYou[0].text, /^Its turn is running, but it has written nothing\./)
  assert.equal(chatNamed(build({ apps: [app('Units')], tails: { Units: tail(noAnswer, 14) } }), 'Units').unanswered, null)
})

// B262: a worker that reported and wrapped up, then compacted by a mod. The board's piece of it ends in the tools'
// answers (the app writes an older stretch again before its mark), then the compaction.
const compactedAfterTools = tail([step(NOW - 27 * MIN, 'Report'), toolResult(NOW - 27 * MIN), ...modCompaction(NOW - 8 * MIN)], 8)

test('B262: a worker compacted after a turn that ended in a tool\'s answer is idle: from the app, else from the transcript', () => {
  const byApp = chatNamed(build({ apps: [app('Units', summary('completed'))], tails: { Units: compactedAfterTools } }), 'Units')
  assert.deepEqual([byApp.state, byApp.isQuiet, byApp.doingNow, byApp.idle], ['free', false, null, { since: NOW - 8 * MIN, from: 'app', isSilent: false }])
  const byTranscript = chatNamed(build({ apps: [app('Units')], tails: { Units: compactedAfterTools } }), 'Units')
  assert.deepEqual([byTranscript.state, byTranscript.idle], ['free', { since: NOW - 8 * MIN, from: 'transcript', isSilent: false }])
})

test('B262: a turn whose last entry is a tool\'s answer, quiet for longer than quietMinutes, ended without a closing message', () => {
  const silent = [typed(NOW - 20 * MIN, 'Go'), step(NOW - 15 * MIN, 'Run the tests'), toolResult(NOW - 14 * MIN)]
  const state = build({ apps: [app('Units')], tails: { Units: tail(silent, 14) } })
  const units = chatNamed(state, 'Units')
  assert.deepEqual([units.state, units.quietMs, units.isQuiet, units.idle], ['free', null, false, { since: NOW - 14 * MIN, from: 'transcript', isSilent: true }])
  assert.deepEqual(state.forYou, [])
  // Not that long yet: it may still be thinking.
  const soon = chatNamed(build({ apps: [app('Units')], tails: { Units: tail(silent, 5) } }), 'Units')
  assert.deepEqual([soon.state, soon.idle], ['working', null])
  // B301: a task handed to it in a message holds nothing; a step the store holds in progress for it keeps it working.
  const handedOver = [fromChat(NOW - 20 * MIN, 'Game - Main', 'Task from Game - Main: build the archer.'), ...silent.slice(1)]
  assert.equal(chatNamed(build({ apps: [app('Main'), app('Units')], tails: { Units: tail(handedOver, 14) } }), 'Units').state, 'free')
  const held = chatNamed(build({ apps: [app('Main'), app('Units')], tails: { Units: tail(handedOver, 14) }, backlog: '## Art\n- [ ] B1 The archer (for Units) (branch feature/archer)\n' }), 'Units')
  assert.deepEqual([held.state, held.between], ['working', 'Its turn has ended; its branch feature/archer is still open.'])
  // A report sent to the main chat ends nothing: the turn is still not over before the quiet limit.
  const reported = [...handedOver, assistant(NOW - 14 * MIN, 'tool_use', [tool('SendMessage', { to: 'Game - Main', message: 'Report from Game - Units: the archer is built.' })]), toolResult(NOW - 14 * MIN)]
  assert.equal(chatNamed(build({ apps: [app('Main'), app('Units', summary('completed'))], tails: { Units: tail(reported, 1) } }), 'Units').state, 'free')
  assert.equal(chatNamed(build({ apps: [app('Main'), app('Units')], tails: { Units: tail(reported, 1) } }), 'Units').state, 'working')
})

test('B262: the app\'s own word that a turn has ended decides, before the transcript has been quiet long', () => {
  // The app writes its summary when a turn ends, and clears it when the next one starts.
  const units = chatNamed(build({ apps: [app('Units', summary('completed'))], tails: { Units: tail(running, 1) } }), 'Units')
  assert.deepEqual([units.state, units.idle], ['free', { since: NOW - MIN, from: 'app', isSilent: true }])
  // A turn with its closing answer: the app says so too.
  assert.deepEqual(chatNamed(build({ apps: [app('Units', summary('completed'))], tails: { Units: tail(ended, 9) } }), 'Units').idle, { since: NOW - 9 * MIN, from: 'app', isSilent: false })
  // Without the app's summary the transcript decides: a turn that runs has no idle line.
  assert.equal(chatNamed(build({ apps: [app('Units')], tails: { Units: tail(running, 1) } }), 'Units').idle, null)
  // A question asked in its chat still waits for you.
  const asked = [typed(NOW - 20 * MIN, 'Go'), assistant(NOW - 4 * MIN, 'tool_use', [tool('AskUserQuestion', {})])]
  assert.equal(chatNamed(build({ apps: [app('Units', summary('completed'))], tails: { Units: tail(asked, 4) } }), 'Units').state, 'waiting')
})

test('a working chat with an estimate has a time it expects to be done, and its queue is planned after it', () => {
  const state = build({
    apps: [app('Main'), app('Units'), app('Levels')],
    tails: { Units: tail(running), Levels: tail(running), Main: tail(ended) },
    plans: {
      Units: planLine({ text: 'Archer', step: 1, steps: 3, left: 25 * MIN }),
      Levels: planLine({ text: 'Forest', left: 2 * MIN }),
    },
    backlog: '## Next to hand out (Game - Main)\n- [ ] Knight rows (for Units; about 30 min)\n- [ ] Polish (for Units)\n- [ ] Banner (for Units; about 10 min)\n- [ ] Lava biome (for Levels; about 1 h)\n- [ ] Name the game (for Writing)\n',
  })
  const units = chatNamed(state, 'Units')
  assert.deepEqual(units.eta, { at: NOW + 22 * MIN, leftMs: 22 * MIN, isOverdue: false, isOver: false, isOwn: true, from: 'own' })
  assert.deepEqual(units.queue.map(step => [step.id, step.title, step.minutes]), [[null, 'Knight rows', 30], [null, 'Polish', null], [null, 'Banner', 10]])
  assert.deepEqual(units.queue[0], { id: null, title: 'Knight rows', text: 'Knight rows (for Units; about 30 min)', minutes: 30, after: null, branch: null, notes: [], refined: null, pictures: [], why: { reason: 'busy', worker: 'Units', leftMs: 22 * MIN } })
  // The plan stops at the first step without a time: what follows it cannot be placed.
  assert.deepEqual(units.ahead, [
    { from: NOW, to: NOW + 22 * MIN, title: 'Archer', isQueued: false },
    { from: NOW + 22 * MIN, to: NOW + 52 * MIN, title: 'Knight rows', isQueued: true },
  ])
  // An estimate that has run out gives no time and no plan.
  const levels = chatNamed(state, 'Levels')
  assert.deepEqual([levels.eta.isOver, levels.eta.leftMs, levels.ahead], [true, 0, []])
  assert.deepEqual([chatNamed(state, 'Main').eta, chatNamed(state, 'Main').queue], [null, []])
  assert.deepEqual(state.unassigned.map(step => step.title), ['Name the game'])
  assert.equal(state.day.until, NOW + 52 * MIN)
  // The timeline runs from the full hour two hours back to the full hour six hours ahead.
  assert.deepEqual([state.day.from, state.day.to, state.day.end], [hourStart(NOW - 120 * MIN), NOW, hourEnd(NOW + 360 * MIN)])
  assert.deepEqual(state.today.map(lane => [lane.chat, lane.ahead.length]), [['Main', 0], ['Units', 2], ['Levels', 0]])
})

test('the timeline reaches as far ahead as what is planned, and shows only the last hours of what was', () => {
  const state = build({
    apps: [app('Units')],
    tails: { Units: tail(running) },
    plans: { Units: planLine({ text: 'Archer', left: 300 * MIN }) },
    backlog: '## Next to hand out (Game - Main)\n- [ ] Knight (for Units; about 4 h)\n- [ ] Bat (for Units; about 3 h)\n',
    lines: [
      { at: NOW - 400 * MIN, chat: 'Units', state: 'free', task: null },
      { at: NOW - 30 * MIN, chat: 'Units', state: 'working', task: 'Archer' },
    ],
  })
  // Planned: the task until about five hours from now, then four hours of queue. A step that would start more
  // than eight hours from now is not planned.
  assert.equal(state.day.end, hourEnd(state.day.until))
  assert.deepEqual(state.today[0].ahead.map(span => span.title), ['Archer', 'Knight'])
  assert.ok(state.day.end > NOW + 8 * 60 * MIN)
  assert.deepEqual(state.today[0].spans.map(span => [span.from, span.state]), [[hourStart(NOW - 120 * MIN), 'free'], [NOW - 30 * MIN, 'working']])
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

test('the ticked steps for you are kept apart as closed, and take no answer', () => {
  const state = build({
    apps: [app('Main')],
    backlog: '## Art\n- [x] B03 Verify: the mage is right (pictures in art-inbox/red-mage) @you\n- [ ] B14 Decide: the bridge @you\n',
    pictureLists: { 'art-inbox/red-mage': ['art-inbox/red-mage/a.png'] },
    outbox: [{ id: 'm1', at: NOW, to: 'Main', ask: 'backlog:B03', verdict: 'approve', text: '', state: 'waiting' }],
  })
  assert.deepEqual(state.backlogForYou.map(step => [step.step, step.isClosed, step.canAnswer]), [['B14', false, true]])
  assert.deepEqual(state.backlogClosed.map(step => [step.step, step.isClosed, step.canAnswer, step.answer, step.kind, step.pictures]), [
    ['B03', true, false, null, 'verify', ['art-inbox/red-mage/a.png']],
  ])
  assert.deepEqual(buildState({}, { now: NOW, config }).backlogClosed, [])
})

test('a step carries what its details show: its words, its notes in sections, its branch, and a queued step its pictures', () => {
  const state = build({
    apps: [app('Main'), app('Units')],
    backlog: [
      '## Art',
      '- [ ] B14 Verify: the walk is smooth (branch fix/archer-walk; pictures in art-inbox/archer) @you',
      '  Requirements:',
      '  - No sliding feet',
      '## Next to hand out (Game - Main)',
      '- [ ] B59 Redraw the portrait, see art-inbox/beast (for Units; about 20 min)',
      '  Context: keep the glowing eyes. The icons are in art-inbox/hud.',
    ].join('\n'),
    pictureLists: { 'art-inbox/archer': ['art-inbox/archer/walk.png'], 'art-inbox/beast': ['art-inbox/beast/old.png'], 'art-inbox/hud': ['art-inbox/hud/icons.png'] },
  })
  const [step] = state.backlogForYou
  assert.deepEqual([step.words, step.branch, step.notes], [
    'Verify: the walk is smooth (branch fix/archer-walk; pictures in art-inbox/archer)',
    'fix/archer-walk',
    [{ title: 'Requirements', lines: [], points: ['No sliding feet'] }],
  ])
  const [queued] = chatNamed(state, 'Units').queue
  // Pictures are found in the step's own line and in the lines under it.
  assert.deepEqual([queued.id, queued.pictures, queued.notes], ['B59', ['art-inbox/beast/old.png', 'art-inbox/hud/icons.png'], [{ title: 'Context', lines: ['keep the glowing eyes. The icons are in art-inbox/hud.'], points: [] }]])
})

test('a step for you in the backlog is a card of its kind, answered to the worker it names or to the main chat', () => {
  const backlog = '## Art\n- [ ] Verify: the walk is smooth (Game - Units) @you\n- [ ] Decide: the bridge @you\n- [ ] Provide: the plan @you\n- [ ] Do: quit the app @you\n- [ ] Pick a name @you\n'
  const state = build({ apps: [app('Main'), app('Units')], backlog, outbox: [] })
  assert.deepEqual(state.backlogForYou.map(step => [step.kind, step.asks, step.title, step.from]), [
    ['verify', 'verify', 'the walk is smooth', 'Units'],
    ['input', 'decide', 'the bridge', 'Main'],
    ['input', 'provide', 'the plan', 'Main'],
    ['do', 'do', 'quit the app', 'Main'],
    ['input', null, 'Pick a name', 'Main'],
  ])
  assert.match(state.backlogForYou[0].id, /^backlog:[0-9a-f]+$/)
  assert.equal(new Set(state.backlogForYou.map(step => step.id)).size, 5)
  // A step with an id is known by it, also when its words are changed.
  const withIds = text => build({ apps: [app('Main')], backlog: `## Art\n- [ ] B14 Verify: ${text} @you\n` }).backlogForYou[0]
  assert.deepEqual([withIds('the walk is smooth').id, withIds('the walk is smooth').step, withIds('the walk is smooth').title], ['backlog:B14', 'B14', 'the walk is smooth'])
  assert.equal(withIds('the walk is smooth now').id, 'backlog:B14')
  // The answer that was sent for a step is shown with it; without a main chat nobody can be told.
  const answered = build({ apps: [app('Main')], backlog, outbox: [{ id: 'm1', at: NOW, to: 'Main', ask: state.backlogForYou[3].id, verdict: 'done', text: '', state: 'waiting' }] })
  assert.deepEqual(answered.backlogForYou[3].answer, { at: NOW, verdict: 'done', text: '', state: 'waiting', takenAt: null, deliveredAt: null })
  assert.deepEqual(build({ apps: [app('Units')], backlog }).backlogForYou.map(step => [step.from, step.canAnswer])[1], [null, false])
})

test('a summary the app wrote about an older answer is not used', () => {
  const old = { postTurnSummary: { status_category: 'blocked', needs_action: 'Old question', summarizes_uuid: 'u-0' } }
  const units = chatNamed(build({ apps: [app('Units', old)], tails: { Units: tail(ended) } }), 'Units')
  assert.equal(units.state, 'free')
  assert.equal(units.needsYou, null)
})

test('a running turn that wrote nothing for more than ten minutes is quiet', () => {
  const units = chatNamed(build({ apps: [app('Units')], tails: { Units: tail(noAnswer, 14) } }), 'Units')
  assert.equal(units.state, 'working')
  assert.equal(units.quietMs, 14 * MIN)
  assert.equal(units.isQuiet, true)
})

test('a worker that recorded nothing has a task without words, from when its turn was opened; no word of the message is shown', () => {
  const handOver = fromChat(NOW - 30 * MIN, 'Game - Main', 'Task from Game - Main: build the archer.\nDetails follow.')
  const report = fromChat(NOW - 30 * MIN, 'Game - Units', 'The knight is finished.')
  const state = build({
    apps: [app('Main'), app('Units')],
    tails: { Units: tail([handOver, ...running]), Main: tail([report, ...running]) },
    plans: { Units: planLine(null) },
  })
  assert.deepEqual(chatNamed(state, 'Units').task, {
    text: '', step: null, steps: null, names: null, leftMs: null, estimateAt: null, stepLeftMs: null, stepEstimateAt: null, source: 'unrecorded', by: null,
    startedAt: NOW - 30 * MIN, firstEstimateMs: null, waitedMs: 0, workedMs: 30 * MIN, stepId: null, stepMinutes: null,
  })
  // A report is no task for the main chat; it works, on something it has not recorded.
  assert.deepEqual([chatNamed(state, 'Main').task.source, chatNamed(state, 'Main').task.text], ['unrecorded', ''])
  assert.ok(!outsideWindow(state).includes('archer') && !outsideWindow(state).includes('knight'))
})

test('a working chat that recorded no task has one without words, from when its turn started', () => {
  const asked = [answer(NOW - 40 * MIN, 'Done'), typed(NOW - 25 * MIN, 'Make the lava glow more. It looks flat.'), step(NOW - 2 * MIN, 'Read the shader')]
  const state = build({ apps: [app('Units')], tails: { Units: tail(asked) } })
  const units = chatNamed(state, 'Units')
  assert.deepEqual(units.task, {
    text: '', step: null, steps: null, names: null, leftMs: null, estimateAt: null, stepLeftMs: null, stepEstimateAt: null, source: 'unrecorded', by: null,
    startedAt: NOW - 25 * MIN, firstEstimateMs: null, waitedMs: 0, workedMs: 25 * MIN, stepId: null, stepMinutes: null,
  })
  assert.ok(!outsideWindow(state).includes('lava'))
  const main = chatNamed(build({
    apps: [app('Main')],
    tails: { Main: tail([answer(NOW - 40 * MIN, 'Done'), fromChat(NOW - 5 * MIN, 'Game - Units', 'The archer is merged.'), step(NOW - 2 * MIN, 'Read the backlog')]) },
  }), 'Main')
  assert.deepEqual([main.task.text, main.task.source, main.task.startedAt], ['', 'unrecorded', NOW - 5 * MIN])
  const ended = chatNamed(build({ apps: [app('Units')], tails: { Units: tail([typed(NOW - 25 * MIN, 'Make the lava glow more.'), answer(NOW - 9 * MIN, 'Done')]) } }), 'Units')
  assert.equal(ended.task, null)
})

test('what the history recorded as the start of a long turn stands when the tail only holds a later remark', () => {
  // The line is from before the board stopped keeping a prompt's words: its start counts, its words are not shown.
  const lines = [{ at: NOW - 90 * MIN, chat: 'Units', state: 'working', task: 'Make the lava glow more', step: null, steps: null, leftMs: null, startedAt: NOW - 91 * MIN, source: 'prompt', by: 'you' }]
  const remark = [toolResult(NOW - 12 * MIN), typed(NOW - 10 * MIN, 'How far are you?'), step(NOW - 2 * MIN, 'Run the tests')]
  const state = build({ apps: [app('Units')], tails: { Units: tail(remark) }, lines })
  const units = chatNamed(state, 'Units')
  assert.deepEqual([units.task.text, units.task.source, units.task.startedAt], ['', 'unrecorded', NOW - 91 * MIN])
  assert.ok(!outsideWindow(state).includes('lava') && !outsideWindow(state).includes('How far'))
  const fresh = chatNamed(build({ apps: [app('Units')], tails: { Units: tail(remark) } }), 'Units')
  assert.deepEqual([fresh.task.text, fresh.task.startedAt], ['', NOW - 10 * MIN])
})

test('a task handed over further back than the tail is found by the longer look back', () => {
  const handOver = fromChat(NOW - 200 * MIN, 'Game - Main', 'Task from Game - Main: build the worker board.')
  const report = minutesAgo => assistant(NOW - minutesAgo * MIN, 'tool_use', [tool('SendMessage', { to: 'Game - Main', message: 'Done.' })])
  const units = chatNamed(build({
    apps: [app('Units')],
    tails: { Units: { ...tail(running), earlier: [report(210), handOver].join('\n') } },
  }), 'Units')
  assert.deepEqual([units.task.text, units.task.source], ['', 'unrecorded'])
  assert.equal(units.task.startedAt, NOW - 200 * MIN)
  assert.equal(units.doingNow, 'Run the tests')
  // Reported since: that task is finished, and the chat is on what started its turn afterwards.
  const after = chatNamed(build({
    apps: [app('Units')],
    tails: { Units: { ...tail(running), earlier: [handOver, report(190), answer(NOW - 189 * MIN, 'Reported.')].join('\n') } },
  }), 'Units')
  assert.deepEqual([after.task.text, after.task.source, after.task.startedAt], ['', 'unrecorded', NOW - 20 * MIN])
})

test('a handed-over task the tail no longer holds keeps its start from the history, until the chat is free', () => {
  const lines = [{ at: NOW - 60 * MIN, chat: 'Units', state: 'working', task: 'Build the archer', step: null, steps: null, leftMs: null, startedAt: NOW - 62 * MIN, source: 'handover' }]
  const state = build({ apps: [app('Units')], tails: { Units: tail(running) }, lines })
  const busy = chatNamed(state, 'Units')
  assert.deepEqual([busy.task.text, busy.task.startedAt], ['', NOW - 62 * MIN])
  // The words the history kept from before are not shown, on the lane or in the day's timeline.
  assert.ok(!outsideWindow(state).includes('archer'))
  const free = chatNamed(build({ apps: [app('Units', summary('completed'))], tails: { Units: tail(ended) }, lines }), 'Units')
  assert.equal(free.task, null)
  // Reported, but the turn still runs: the task stands until it ends.
  const report = minutesAgo => assistant(NOW - minutesAgo * MIN, 'tool_use', [tool('SendMessage', { to: 'Game - Main', message: 'Finished.' })])
  const wrappingUp = chatNamed(build({ apps: [app('Units')], tails: { Units: tail([...running, report(1)]) }, lines }), 'Units')
  assert.deepEqual([wrappingUp.task.text, wrappingUp.task.startedAt], ['', NOW - 62 * MIN])
  // Reported and ended, and now on something the person typed: the remembered task is over.
  const next = [typed(NOW - 20 * MIN, 'Go'), report(15), toolResult(NOW - 15 * MIN), answer(NOW - 14 * MIN, 'Reported.'), typed(NOW - 5 * MIN, 'One more thing.'), step(NOW - 2 * MIN, 'Look')]
  const after = chatNamed(build({ apps: [app('Units')], tails: { Units: tail(next) }, lines }), 'Units')
  assert.deepEqual([after.task.text, after.task.source, after.task.startedAt], ['', 'unrecorded', NOW - 5 * MIN])
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
  assert.deepEqual([unnamed.task.text, unnamed.task.source, unnamed.task.startedAt], ['', 'unrecorded', NOW - 30 * MIN])

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
  assert.deepEqual(state.counts, { working: 1, waiting: 0, free: 1, unknown: 0, interrupted: 0, suspended: 0, off: 0 })
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

test('the demo shows the second design: six lanes with their queues, three requests, and the advisor', async () => {
  const demo = await demoSources(NOW)
  const state = buildState(demo, { lines: demo.historyLines, now: NOW, config: { ...config, project: demo.project } })
  assert.deepEqual(state.chats.map(chat => [chat.name, chat.state, chat.queue.length]), [
    ['Main', 'working', 3],
    ['Units', 'waiting', 2],
    ['Features', 'suspended', 3],
    ['Cleanup', 'free', 1],
    ['Levels / Environment', 'working', 2],
    // B262: its turn ended without a closing message.
    ['Audio', 'free', 0],
  ])
  assert.deepEqual(state.counts, { working: 2, waiting: 1, free: 2, unknown: 0, interrupted: 0, suspended: 1, off: 0 })
  assert.deepEqual(state.chats[5].idle, { since: NOW - 26 * MIN, from: 'transcript', isSilent: true })
  // B155: the steps finished this morning, newest first: one approved by the person, one closed through the work store, one with only the day.
  assert.deepEqual(state.finished.map(one => [one.id, one.how, one.by]), [['B05', 'line', 'you'], ['B06', 'store', 'Cleanup'], ['B07', 'day', 'Levels / Environment']])
  // B148: Cleanup's last answer ends with "+ Done:   yes": free, although its card still names its task.
  assert.deepEqual([state.chats[3].state, state.chats[3].task], ['free', null])
  assert.equal(JSON.parse(demo.planLineTexts['demo-cleanup']).task.isReported, false)
  assert.deepEqual(state.chats.map(chat => (chat.eta === null ? null : Math.round(chat.eta.leftMs / MIN))), [22, null, null, null, 34, null])
  // B113: the limits, a worker that paused for the limit, and why each first queued step is not started.
  assert.deepEqual([state.limits.fiveHour.used, state.limits.fiveHour.level, Math.round((state.limits.fiveHour.resetsAt - NOW) / MIN), state.limits.week.used], [86, 'warn', 52, 64])
  assert.deepEqual([state.chats[2].suspended.by, Math.round((state.chats[2].suspended.until - NOW) / MIN), state.chats[2].task.text], ['note', 52, 'Add save / load system'])
  assert.deepEqual(state.chats.map(chat => chat.queue[0]?.why.reason ?? null), ['busy', 'after', 'suspended', 'handout', 'busy', null])
  assert.deepEqual(state.chats.map(chat => chat.folders.map(folder => folder.name)), [[], ['units'], ['features'], ['cleanup'], ['levels'], []])
  assert.deepEqual(state.otherFolders.map(folder => folder.name), [])
  assert.deepEqual(state.unassigned.map(step => step.title), ['Decide the name of the game'])

  assert.deepEqual(state.forYou.map(need => [need.from, need.kind, need.title, need.canAnswer]), [
    // Plan (2026-10-19): since the demo's partner filed its ask on the product plan's P5, its questions are no
    // longer unfiled: the ask stands here as well as on the Plan part's row.
    ['Advisor', 'input', 'P5: how does the game reach people?', true],
    ['Main', 'verify', 'Test player movement', true],
    ['Units', 'input', 'Choose pathfinding approach', true],
  ])
  assert.deepEqual(state.forYou[2].options.map(option => [option.picture, option.isRecommended]), [
    ['art-inbox/pathfinding/option-a-navmesh.png', true],
    ['art-inbox/pathfinding/option-b-grid.png', false],
  ])
  assert.deepEqual([state.forYou[1].game.branch, state.forYou[1].game.folder, state.forYou[1].game.url], ['main', 'game', null])
  assert.deepEqual(state.backlogForYou.map(step => [step.title, step.kind, step.from, step.pictures]), [
    ['the jump feels right', 'verify', 'Main', ['art-inbox/jump/jump-arc.png']],
    ['quit and reopen the app once', 'do', 'Main', []],
    // B173: an Advisor suggestion is answered under For you; the answer goes to the main chat, which hands it out.
    ['Make a unit template before the second unit', 'input', 'Main', []],
  ])

  assert.deepEqual([state.advisor.name, state.advisor.state, state.advisor.messages.length], ['Advisor', 'free', 4])
  assert.ok(state.today.every(lane => lane.spans.length > 0))
  // A worker held by the limit has no time it expects to be done, so nothing is planned ahead in its lane.
  assert.equal(state.today.filter(lane => lane.ahead.length > 0).length, 2)
  assert.match(state.advice, /pathfinding/)
})

test('work to verify names the game to look at: its branch, else main, with the folder that holds it', () => {
  const folder = (name, branch) => ({ path: `C:/game-${name}`, name, branch, ahead: 2, uncommitted: 0, lastCommitAt: NOW })
  const state = build({
    apps: [app('Main'), app('Units')],
    tails: { Units: tail(running) },
    asks: [
      { id: 'walk', from: 'Units', kind: 'verify', title: 'Check the walk', at: NOW - 3 * MIN, run: { branch: 'fix/walk' } },
      { id: 'sheet', from: 'Units', kind: 'verify', title: 'Check the sheet', at: NOW - 4 * MIN },
      { id: 'lost', from: 'Units', kind: 'verify', title: 'Check the jump', at: NOW - 5 * MIN, run: { branch: 'fix/jump' } },
      { id: 'name', from: 'Units', kind: 'input', title: 'Pick a name', at: NOW - 6 * MIN },
    ],
    backlog: '## Art\n- [ ] B14 Verify: the mage is right @you\n- [ ] B15 Verify: the walk (branch fix/walk) @you\n- [ ] B16 Decide: a name @you\n- [ ] B17 Verify: the board on http://127.0.0.1:4311/ @you\n- [x] B02 Verify: the torch @you\n',
    folders: [folder('main', 'main'), folder('units', 'fix/walk')],
    runs: [{ path: 'c:\\game-units', url: 'http://127.0.0.1:5301/', startedAt: NOW - MIN }],
  })
  const games = Object.fromEntries([...state.forYou, ...state.backlogForYou, ...state.backlogClosed].map(need => [need.id, need.game]))
  assert.deepEqual(games.walk, { branch: 'fix/walk', folder: 'units', path: 'C:/game-units', url: 'http://127.0.0.1:5301/', since: NOW - MIN })
  assert.deepEqual(games.sheet, { branch: 'main', folder: 'main', path: 'C:/game-main', url: null, since: null })
  assert.deepEqual(games.lost, { branch: 'fix/jump', folder: null, path: null, url: null, since: null })
  assert.equal(games.name, null)
  assert.equal(games['backlog:B14'].branch, 'main')
  assert.equal(games['backlog:B15'].url, 'http://127.0.0.1:5301/')
  assert.equal(games['backlog:B16'], null)
  // A step that gives an address of its own is not about the game.
  assert.equal(games['backlog:B17'], null)
  assert.equal(games['backlog:B02'].branch, 'main')
})

test('without an answer from git, no game is offered', () => {
  const state = build({ apps: [app('Main')], backlog: '## Art\n- [ ] B14 Verify: the mage is right @you\n' })
  assert.equal(state.backlogForYou[0].game, null)
})

test('an answer stands for the step as it was: a step that changed since asks again, and shows the earlier answer', () => {
  const answerTo = step => ({ id: 'm1', at: NOW - MIN, to: 'Main', ask: step.id, version: step.version, verdict: 'reject', text: 'The feet slide', state: 'delivered' })
  const first = build({ apps: [app('Main')], backlog: '## Art\n- [ ] B14 Verify: the walk @you\n' }).backlogForYou[0]
  assert.match(first.version, /^[0-9a-f]+$/)

  const same = build({ apps: [app('Main')], backlog: '## Art\n- [ ] B14 Verify: the walk @you\n', outbox: [answerTo(first)] }).backlogForYou[0]
  assert.deepEqual([same.answer?.verdict, same.answer?.state, same.earlier], ['reject', 'delivered', null])

  const reworked = build({ apps: [app('Main')], backlog: '## Art\n- [ ] B14 Verify: the walk @you\n  Reworked: the feet stay put now\n', outbox: [answerTo(first)] }).backlogForYou[0]
  assert.equal(reworked.answer, null)
  assert.deepEqual([reworked.earlier.verdict, reworked.earlier.text], ['reject', 'The feet slide'])
})

test('a request a chat filed asks again when it was filed anew, also under the same name', () => {
  const ask = at => ({ id: 'walk', from: 'Units', kind: 'verify', title: 'Check the walk', at })
  const first = build({ apps: [app('Main'), app('Units')], tails: { Units: tail(running) }, asks: [ask(NOW - 30 * MIN)] }).forYou[0]
  assert.match(first.version, /^[0-9a-f]+$/)
  const answer = { id: 'm1', at: NOW - 20 * MIN, to: 'Units', ask: 'walk', version: first.version, verdict: 'reject', text: 'Feet slide', state: 'delivered' }
  const same = build({ apps: [app('Main'), app('Units')], tails: { Units: tail(running) }, asks: [ask(NOW - 30 * MIN)], outbox: [answer] }).forYou[0]
  assert.equal(same.answer.verdict, 'reject')
  const again = build({ apps: [app('Main'), app('Units')], tails: { Units: tail(running) }, asks: [ask(NOW - 5 * MIN)], outbox: [answer] }).forYou[0]
  assert.deepEqual([again.answer, again.earlier.text], [null, 'Feet slide'])
})

test('each chat carries the id of its session, for the bridge to know which chat asks, and main\'s game is always offered', () => {
  const folder = (name, branch) => ({ path: `C:/game-${name}`, name, branch, ahead: 0, uncommitted: 0, lastCommitAt: NOW - 90 * MIN, lastCommit: { hash: 'b0c4559', subject: 'Merge the camera' } })
  const state = build({ apps: [app('Main'), app('Units'), app('Advisor')], folders: [folder('main', 'main'), folder('units', 'fix/walk')] })
  assert.deepEqual(state.chats.map(chat => [chat.name, chat.session]), [['Main', 'cli-Main'], ['Units', 'cli-Units']])
  assert.equal(state.advisor.session, 'cli-Advisor')
  assert.deepEqual(state.mainGame, { branch: 'main', folder: 'main', path: 'C:/game-main', url: null, since: null, lastCommitAt: NOW - 90 * MIN, commit: { hash: 'b0c4559', subject: 'Merge the camera' } })
  assert.equal(build({ apps: [app('Main')] }).mainGame, null)
  // B132: a project without a game (no folders read) offers no game for a step to verify either.
  const noGame = build({ apps: [app('Main')], backlog: '## Art\n- [ ] B14 Verify: the walk is smooth (branch fix/walk) @you\n' })
  assert.deepEqual([noGame.mainGame, noGame.backlogForYou.map(step => step.game)], [null, [null]])
})

// The chat's own file, as its process keeps it: what it says the chat does, and when it last wrote.
const ownFile = (state, at, task = null) => JSON.stringify({ name: 'x', role: 'worker', state, task, at })
const beast = { text: 'Shadow Beast', step: 2, steps: 6, left: 40 * MIN, isReported: false }

test('a chat cut off in the middle of its turn is interrupted: its own file was set to waiting after the turn began', () => {
  // The transcript still shows the turn as open (it began 20 minutes ago); the process that ran it is gone.
  const state = build({
    apps: [app('Main'), app('Units')],
    tails: { Units: tail(running, 6) },
    plans: { Units: ownFile('waiting', NOW - 2 * MIN, beast) },
  })
  const units = chatNamed(state, 'Units')
  assert.equal(units.state, 'interrupted')
  // What it was on is kept; it expects nothing and is not reported as quiet on top.
  assert.equal(units.task.text, 'Shadow Beast')
  assert.deepEqual([units.eta, units.isQuiet, units.doingNow], [null, false, null])
  assert.equal(units.cutOffAt, NOW - 6 * MIN)
  assert.equal(state.counts.interrupted, 1)
  assert.deepEqual(state.restart.interrupted, ['Units'])
  assert.equal(state.forYou.some(need => need.id === 'quiet:Units'), false)
})

test('a chat whose file still says working but is no longer renewed is interrupted too', () => {
  const stale = build({ apps: [app('Units')], tails: { Units: tail(running, 4) }, plans: { Units: ownFile('working', NOW - 4 * MIN, beast) } })
  assert.equal(chatNamed(stale, 'Units').state, 'interrupted')
  // Renewed within the last minutes: the turn is alive, however long its tool runs.
  const alive = build({ apps: [app('Units')], tails: { Units: tail(running, 4) }, plans: { Units: ownFile('working', NOW - MIN, beast) } })
  assert.equal(chatNamed(alive, 'Units').state, 'working')
})

test('a chat that keeps no file of its own in this turn is never called interrupted', () => {
  // A file from yesterday: this chat's process does not write one, so it says nothing about the turn.
  for (const said of ['working', 'waiting']) {
    const state = build({ apps: [app('Units')], tails: { Units: tail(running, 1) }, plans: { Units: ownFile(said, NOW - 20 * 60 * MIN, beast) } })
    assert.equal(chatNamed(state, 'Units').state, 'working')
  }
  assert.equal(chatNamed(build({ apps: [app('Units')], tails: { Units: tail(running, 1) } }), 'Units').state, 'working')
  // A turn that ended is free, whatever the file says.
  assert.equal(chatNamed(build({ apps: [app('Units', summary('completed'))], tails: { Units: tail(ended) }, plans: { Units: ownFile('waiting', NOW - MIN) } }), 'Units').state, 'free')
})

test('the restart: who was cut off, and how long the board was off; Pause 2: nothing of "prepare restart" or restart.md', () => {
  const quiet = build({ apps: [app('Main'), app('Units', summary('completed'))], tails: { Units: tail(ended) } })
  assert.deepEqual(quiet.restart, { main: 'Main', interrupted: [], notRunning: [], starting: [], copied: null, off: null })

  const prepare = { id: 'p1', at: NOW - 10 * MIN, to: 'Main', ask: null, command: 'prepare restart', text: 'prepare restart', state: 'delivered' }
  const after = build({
    apps: [app('Main'), app('Units'), app('Features', summary('completed'))],
    tails: { Units: tail(running), Features: tail(ended) },
    outbox: [prepare],
    restartNote: { at: NOW - 3 * MIN },
    board: { startedAt: NOW - 20 * MIN, offSince: NOW - 28 * MIN },
  })
  assert.deepEqual(after.restart, { main: 'Main', interrupted: [], notRunning: [], starting: [], copied: null, off: { from: NOW - 28 * MIN, to: NOW - 20 * MIN } })
  // A board that has run for long says no more about having been off.
  const later = build({ apps: [app('Main')], board: { startedAt: NOW - 3 * 60 * MIN, offSince: NOW - 4 * 60 * MIN } })
  assert.equal(later.restart.off, null)
  // Without a main chat there is nobody to do the resuming.
  assert.equal(build({ apps: [app('Units')] }).restart.main, null)
})

test('Pause 2: a worker\'s "Safe point:" line to the main chat no longer stops it: a stop for a restart is the store\'s pause', () => {
  const prepare = { id: 'p1', at: NOW - 10 * MIN, to: 'Main', ask: null, command: 'prepare restart', text: 'prepare restart', state: 'delivered' }
  const toMain = (when, message, to) => [assistant(when, 'tool_use', [tool('SendMessage', { to, message })]), toolResult(when + 1000)]
  const units = [typed(NOW - 30 * MIN, 'Go'), step(NOW - 20 * MIN, 'Build'), fromChat(NOW - 9 * MIN, 'Game - Main', 'prepare restart'),
    ...toMain(NOW - 8 * MIN, 'Note from Game - Units: Safe point: B12 at b12 1a2b3c4; next: the tests.', 'local_Main')]
  const state = build({ apps: [app('Main'), app('Units')], tails: { Units: tail(units) }, outbox: [prepare], restartNote: { at: NOW - 2 * MIN } })
  assert.notEqual(chatNamed(state, 'Units').state, 'suspended')
  assert.equal(chatNamed(state, 'Units').suspended, null)
})

test('a turn that kept writing after its chat\'s file said waiting is alive, not interrupted', () => {
  // The file says waiting since 8 minutes ago (the turn before ended then); the open turn wrote a minute ago.
  // A turn opened by a slash command or a background notice has no opening of its own, so the file looks newer
  // than the turn: what tells them apart is that the transcript moved on.
  const state = build({ apps: [app('Units')], tails: { Units: tail(running, 1) }, plans: { Units: ownFile('waiting', NOW - 8 * MIN, beast) } })
  assert.equal(chatNamed(state, 'Units').state, 'working')
})

test('a chat whose process asks the board is running; one that has not asked for a while is not', () => {
  // After a restart of the app a chat does not run until something starts it. A running chat's mod asks the
  // board every few seconds what waits for it: `seen` holds when each last asked.
  const apps = [app('Main'), app('Units'), app('Features'), app('Advisor')]
  const state = build({ apps, seen: { shown: { Main: NOW - 5_000, Units: NOW - 10 * MIN }, other: {} }, board: { startedAt: NOW - 5 * MIN, offSince: null } })
  assert.deepEqual(state.chats.map(chat => [chat.name, chat.isRunning]), [['Main', true], ['Units', false], ['Features', false]])
  assert.equal(state.advisor.isRunning, false)
  // The lanes that are not running, in the board's order; the advisor is not one of the workers.
  assert.deepEqual(state.restart.notRunning, ['Units', 'Features'])
})

test('just after the board started, and where no chat can ask it, nothing is said about who runs', () => {
  const apps = [app('Main'), app('Units')]
  // Half a minute is given for every running chat to have asked once.
  const young = build({ apps, seen: { shown: { Main: NOW - 1000 }, other: {} }, board: { startedAt: NOW - 10_000, offSince: null } })
  assert.deepEqual(young.chats.map(chat => chat.isRunning), [null, null])
  assert.deepEqual(young.restart.notRunning, [])
  // The demo, and a board without a bridge: nobody asks, so nobody is called "not running".
  const deaf = build({ apps, seen: null, board: { startedAt: NOW - 5 * MIN, offSince: null } })
  assert.deepEqual([deaf.chats.map(chat => chat.isRunning), deaf.restart.notRunning], [[null, null], []])
})

test('a chat that asks under its name from another session than the board shows is not called "not running"', () => {
  // Two chats of one title, or a chat the app's files are behind on: somebody is there, the board cannot tell who.
  const state = build({ apps: [app('Main'), app('Units')], seen: { shown: { Main: NOW - 5_000 }, other: { Units: NOW - 4_000 } }, board: { startedAt: NOW - 5 * MIN, offSince: null } })
  assert.deepEqual(state.chats.map(chat => [chat.name, chat.isRunning]), [['Main', true], ['Units', null]])
  assert.deepEqual(state.restart.notRunning, [])
})

test('an answer carries when it was handed to its chat and when it was typed; a chat carries the id the app knows it by', () => {
  const backlog = '## Art\n- [ ] B14 Verify: the walk @you\n'
  const first = build({ apps: [app('Main')], backlog }).backlogForYou[0]
  const typed = { id: 'm1', at: NOW - 9 * MIN, to: 'Main', ask: first.id, version: first.version, verdict: 'approve', text: '', state: 'delivered', takenAt: NOW - 8 * MIN, deliveredAt: NOW - 7 * MIN }
  const state = build({ apps: [app('Main'), app('Advisor')], backlog, outbox: [typed] })
  assert.deepEqual(state.backlogForYou[0].answer, { at: NOW - 9 * MIN, verdict: 'approve', text: '', state: 'delivered', takenAt: NOW - 8 * MIN, deliveredAt: NOW - 7 * MIN })
  assert.deepEqual([state.chats[0].appSession, state.advisor.appSession], ['local_Main', 'local_Advisor'])
})

test('the board says which chats the main chat was asked to start, for ten minutes', () => {
  const asked = (about, at, state = 'delivered') => ({ id: `w-${about}-${at}`, at, to: 'Main', ask: null, command: 'start', about, text: `start ${about}`, state })
  const state = build({ apps: [app('Main'), app('Units')], outbox: [asked('Units', NOW - 5 * MIN, 'expired'), asked('Units', NOW - MIN), asked('Advisor', NOW - 11 * MIN)] })
  assert.deepEqual(state.restart.starting, [{ chat: 'Units', at: NOW - MIN, state: 'delivered' }])
})
