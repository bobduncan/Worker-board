// B95: a lane shows the time left, and no working worker is without a time. B94: the misses the comparison with
// the person's design found (a step a worker is on is in progress, "so far" counts from this task, "Now:" is plain
// words, a table is a table, the advice says its age, a window does not say "nothing is written" beside what is).
// The page's own code is run here, cut out of board.js between its marks. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { assistant, fromChat, midTurn, step, tool, toolResult, typed } from '../fixtures/lines.mjs'
import { aboutMinutes } from '../src/backlog.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState } from './withStore.mjs'
import { conversation, doingNow, parseTail, turnStart, turnState } from '../src/transcript.mjs'

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 12, 15, 0)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const MAIN = { mainTitle: 'Game - Main', mainSession: 'local_Main' }

const BACKLOG = [
  '## Board #focus',
  '- [ ] B06 The archer (for Units; about 40 min)',
  '- [ ] B08 Portraits (for Units; about 20 min)',
  '- [x] B09 A finished step (for Units; about 10 min)',
  '- [ ] B10 Verify: Say whether the archer is right (for Units; about 5 min) @you',
  '- [ ] B12 The bridge (for Levels; about 30 min)',
  '- [ ] B13 A check that names no time (for Units)',
  '',
].join('\n')

const app = name => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
const tail = lines => ({ text: lines.join('\n'), isCut: false, modifiedAt: NOW })
/** A chat's own record, written `named` minutes ago. */
const planLine = (task, named = 3) => JSON.stringify({ name: 'x', role: 'worker', state: 'working', task: task === null ? null : { since: NOW - named * MIN, isReported: false, ...task }, at: NOW - named * MIN })
const busy = [step(NOW - 2 * MIN, 'Run the tests'), toolResult(NOW - MIN)]
const running = [typed(NOW - 20 * MIN, 'Zebracorn please'), ...busy]

function build({ tails = {}, plans = {}, lines = [], adviceAt, backlog = BACKLOG }) {
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: [app('Main'), app('Units'), app('Levels')],
    tails: Object.fromEntries(Object.entries(tails).map(([name, value]) => [`cli-${name}`, value])),
    planLineTexts: Object.fromEntries(Object.entries(plans).map(([name, value]) => [`cli-${name}`, value])),
    backlogText: backlog,
    adviceText: 'Some advice.',
    adviceAt,
    folders: null,
    askTexts: [],
    pictureLists: {},
  }
  return buildState(raw, { lines, outbox: [], runs: [], now: NOW, config })
}
const lane = (state, name) => state.chats.find(chat => chat.name === name)
const statusOf = (state, id) => state.backlog.flatMap(activity => activity.steps).find(one => one.id === id).status
const entries = lines => parseTail(lines.join('\n'), false)

// B95: the time of a lane

test('a step\'s time is the first "about <time>" of its note', () => {
  assert.equal(aboutMinutes('About 45 minutes, after B92.'), 45)
  assert.equal(aboutMinutes('fix what is about the archer, about 1 h 30 min'), 90)
  assert.equal(aboutMinutes('about 2 hours'), 120)
  for (const none of ['', 'about the archer', 'roughly 20 min', 'about 300 files']) assert.equal(aboutMinutes(none), null, none)
})

test('B301: a hand-over gives no time: a working worker without a time of its own and without a step has none', () => {
  const handOver = fromChat(NOW - 10 * MIN, 'Game - Main', 'Task from Game - Main: the zebracorn check. About 45 minutes.')
  const units = lane(build({ tails: { Units: tail([handOver, ...busy]) } }), 'Units')
  assert.deepEqual([units.task.source, units.task.stepId, units.task.handMinutes, units.eta, units.isWithoutTime], ['unrecorded', null, undefined, null, true])
})

test('the worker\'s own time wins, then its step\'s in the store; a hand-over\'s time counts for nothing', () => {
  const backlog = '## Board\n- [ ] B08 Portraits (for Units; about 30 min) (branch feature/portraits)\n- [ ] B13 A check that names no time (for Units) (branch feature/check)\n'
  const handOver = fromChat(NOW - 10 * MIN, 'Game - Main', 'Task from Game - Main: backlog step B08, the portraits. About 2 h.')
  const fromStep = lane(build({ tails: { Units: tail(running) }, backlog }), 'Units')
  assert.deepEqual([fromStep.task.stepId, fromStep.eta.from, fromStep.eta.at], ['B08', 'step', NOW + 10 * MIN])
  const own = lane(build({ tails: { Units: tail([handOver, ...busy]) }, plans: { Units: planLine({ text: 'Portraits', left: 30 * MIN }) }, backlog }), 'Units')
  assert.deepEqual([own.eta.from, own.eta.at], ['own', NOW + 27 * MIN])
  // A step that names no time leaves the worker without one, whatever a hand-over says.
  const noTime = backlog.replace('- [ ] B08', '- [x] B08')
  const third = lane(build({ tails: { Units: tail([fromChat(NOW - 10 * MIN, 'Game - Main', 'Task from Game - Main: backlog step B13. About 15 min.'), ...running]) }, backlog: noTime }), 'Units')
  assert.deepEqual([third.task.stepId, third.eta, third.isWithoutTime], ['B13', null, true])
})

test('a worker that works without a time from anywhere is marked; the main chat and a chat that does not work are not', () => {
  const state = build({ tails: { Units: tail(running), Main: tail(running) } })
  assert.deepEqual([lane(state, 'Units').state, lane(state, 'Units').eta, lane(state, 'Units').isWithoutTime], ['working', null, true])
  assert.deepEqual([lane(state, 'Main').state, lane(state, 'Main').eta, lane(state, 'Main').isWithoutTime], ['working', null, false])
  assert.equal(lane(state, 'Levels').isWithoutTime, false)
})

// B94: a step a worker is on is in progress, not next in a queue

test('a message that arrives in the middle of a turn is read, and opens or ends no turn (B301: it hands over no task)', () => {
  const lines = [typed(10 * MIN, 'Zebracorn please'), step(11 * MIN, 'Build'), toolResult(12 * MIN), midTurn(13 * MIN, 'local_Main', 'Next task from Game - Main: backlog step B06, the quokkaberry. About 25 minutes.'), step(14 * MIN, 'Build'), toolResult(15 * MIN)]
  const read = entries(lines)
  assert.deepEqual(read.map(entry => entry.type), ['user', 'assistant', 'user', 'queued', 'assistant', 'user'])
  assert.equal(turnState(read), 'running')
  assert.equal(turnState(entries([...lines.slice(0, 3), midTurn(13 * MIN, 'local_Main', 'Task: x')])), 'running')
  assert.deepEqual([turnStart(read).at, turnStart(read).by], [10 * MIN, 'you'])
  assert.equal(turnStart(entries(lines.slice(1))), null)
  assert.ok(!JSON.stringify(conversation(read)).includes('quokkaberry'))
  // What is no message of another chat is left out as before.
  assert.deepEqual(entries(['{"type":"attachment","timestamp":"2026-10-12T10:00:00Z","attachment":{"type":"queued_command","prompt":"typed while it worked","origin":{"kind":"human"}}}', '{"type":"attachment","attachment":{"type":"file"}}']), [])
})

test('the step a worker recorded by its id is in progress: it leaves the queue, also without a branch', () => {
  const state = build({ tails: { Units: tail(running) }, plans: { Units: planLine({ text: 'Portraits, B08' }) } })
  assert.equal(lane(state, 'Units').task.stepId, 'B08')
  assert.deepEqual(lane(state, 'Units').queue.map(one => one.id), ['B06', 'B13'])
  assert.deepEqual(['B06', 'B08', 'B12'].map(id => statusOf(state, id)), ['queued', 'progress', 'queued'])
  // Its step's time is the lane's time, for a chat that gave none.
  assert.deepEqual([lane(state, 'Units').eta.from, lane(state, 'Units').isWithoutTime], ['step', false])
})

test('B301: the step the store holds in progress is the lane\'s, also when a hand-over names another; a hand-over names none', () => {
  const lines = [typed(NOW - 60 * MIN, 'Zebracorn please'), step(NOW - 59 * MIN, 'Build'), toolResult(NOW - 58 * MIN), midTurn(NOW - 6 * MIN, 'local_Main', 'Next task from Game - Main: backlog step B08.'), ...busy]
  const backlog = BACKLOG.replace('- [ ] B06 The archer (for Units; about 40 min)', '- [ ] B06 The archer (for Units; about 40 min) (branch feature/archer)')
  const recorded = build({ tails: { Units: tail(lines) }, plans: { Units: planLine({ text: 'Against the pictures' }) }, backlog })
  assert.deepEqual([lane(recorded, 'Units').task.source, lane(recorded, 'Units').task.stepId], ['plan', 'B06'])
  assert.deepEqual(lane(recorded, 'Units').queue.map(one => one.id), ['B08', 'B13'])
  assert.deepEqual([statusOf(recorded, 'B06'), statusOf(recorded, 'B08')], ['progress', 'queued'])
  const unrecorded = build({ tails: { Units: tail(lines) }, backlog })
  assert.deepEqual([lane(unrecorded, 'Units').task.source, lane(unrecorded, 'Units').task.stepId, statusOf(unrecorded, 'B06')], ['step', 'B06', 'progress'])
  // Without such a step the hand-over gives the lane no step.
  const none = build({ tails: { Units: tail(lines) } })
  assert.deepEqual([lane(none, 'Units').task.source, lane(none, 'Units').task.stepId, statusOf(none, 'B08')], ['unrecorded', null, 'queued'])
})

test('a record names a step only when it is open and this worker\'s, or nobody\'s', () => {
  for (const [text, id] of [['B12 first, then mine', null], ['B09 again', null], ['B10 for the person', null], ['After B12: B08', 'B08'], ['B77', null]]) {
    const state = build({ tails: { Units: tail(running) }, plans: { Units: planLine({ text }) } })
    assert.equal(lane(state, 'Units').task.stepId, id, text)
    assert.equal(statusOf(state, 'B12'), 'queued', text)
  }
  // A step nobody is on stays where it was; a worker that is free is on none.
  const idle = build({})
  assert.deepEqual(['B06', 'B08'].map(id => statusOf(idle, id)), ['queued', 'queued'])
})

// B94: "so far" counts from the start of this task

const history = (task, startedAt, at = startedAt) => ({ at, chat: 'Units', state: 'working', task, step: null, steps: null, leftMs: null, estimateAt: null, startedAt, source: 'plan', by: null })

test('a task named while the board still showed another one the chat had named starts when it was named', () => {
  // One long turn: the first task for three hours, then the next, named three minutes ago.
  const lines = [typed(NOW - 182 * MIN, 'Zebracorn please'), ...busy]
  const state = build({ tails: { Units: tail(lines) }, plans: { Units: planLine({ text: 'Against the pictures' }) }, lines: [history('The archer', NOW - 182 * MIN)] })
  assert.equal(lane(state, 'Units').task.startedAt, NOW - 3 * MIN)
  // The first task it names in a turn started with the turn.
  const first = build({ tails: { Units: tail(lines) }, plans: { Units: planLine({ text: 'Against the pictures' }) } })
  assert.equal(first.chats.find(chat => chat.name === 'Units').task.startedAt, NOW - 182 * MIN)
  // Once recorded, the start stands, whatever the board showed before.
  const later = build({ tails: { Units: tail(lines) }, plans: { Units: planLine({ text: 'Against the pictures' }) }, lines: [history('The archer', NOW - 182 * MIN), history('Against the pictures', NOW - 3 * MIN, NOW - 2 * MIN)] })
  assert.equal(lane(later, 'Units').task.startedAt, NOW - 3 * MIN)
})

// B94: "Now:" in plain words

test('"Now:" never shows a tool\'s own name', () => {
  const now = (name, input) => doingNow(entries([assistant(MIN, 'tool_use', [tool(name, input)])]))
  const calls = [
    ['mcp__Claude_Browser__javascript_tool', { action: 'javascript_exec', text: 'x' }, 'Working in the browser'],
    ['mcp__Claude_Browser__computer', { action: 'left_click', action_summary: 'Opens the Filters menu' }, 'Opens the Filters menu'],
    ['mcp__claude-in-chrome__navigate', { url: 'x' }, 'Working in the browser'],
    ['Read', { file_path: 'C:\\game\\src\\app.ts' }, 'Reading app.ts'],
    ['Write', { file_path: '/game/notes.md' }, 'Editing notes.md'],
    ['Edit', {}, 'Editing a file'],
    ['Glob', { pattern: '**/*.ts' }, 'Searching the files'],
    ['Bash', { command: 'npm test' }, 'Running a command'],
    ['Bash', { command: 'npm test', description: 'Run the tests' }, 'Run the tests'],
    ['SendMessage', { to: 'Game - Main', message: 'x' }, 'Writing to another chat'],
    ['mcp__folder-branches__chat', { action: 'plan' }, 'Recording its task'],
    ['mcp__some_server__some_tool', {}, 'Using a tool'],
    ['SomethingNew', {}, 'Using a tool'],
  ]
  for (const [name, input, words] of calls) {
    assert.equal(now(name, input), words, name)
    assert.ok(!/mcp|__|javascript_tool|Claude_Browser/.test(words) && (words !== name), name)
  }
})

// The page

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const cut = name => {
  const [from, to] = [script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`)]
  assert.ok(from >= 0 && to > from, `board.js has no part "${name}"`)
  return script.slice(from, to)
}
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('lanetime')}\n${cut('rich')}\n${cut('window')}\nObject.assign(this, { clock, span, timeOf, partsOf, adviceAge, windowOf })`, page)
const plain = value => JSON.parse(JSON.stringify(value))
const timeOf = one => plain(page.timeOf(one, NOW))
const working = { state: 'working', isLeftover: false, isWithoutTime: false, task: { startedAt: NOW - 5 * MIN, stepId: 'B08' } }

test('a working lane shows the time left as the main figure and the clock time small', () => {
  const time = timeOf({ ...working, eta: { at: NOW + 24 * MIN, leftMs: 24 * MIN, isOverdue: false, isOwn: true, from: 'own' } })
  assert.deepEqual(time, { label: 'ETA', main: '24 min left', tone: 'time', small: [`until ${page.clock(NOW + 24 * MIN)}`], from: null })
  assert.equal(timeOf({ ...working, eta: { at: NOW + 105 * MIN, leftMs: 105 * MIN, isOverdue: false, isOwn: true, from: 'own' } }).main, '1 h 45 left')
  // A time that has run out says by how much, not a clock time.
  const late = timeOf({ ...working, eta: { at: NOW - 12 * MIN, leftMs: 0, isOverdue: true, isOwn: true, from: 'own' } })
  assert.deepEqual([late.label, late.main, late.tone, late.small], ['Overdue', '12 min over', 'bad', [`was ${page.clock(NOW - 12 * MIN)}`]])
})

test('a time that is not the worker\'s own says where it is from', () => {
  const eta = { at: NOW + 15 * MIN, leftMs: 15 * MIN, isOverdue: false, isOwn: false }
  assert.equal(timeOf({ ...working, eta: { ...eta, from: 'step' } }).from.text, 'from B08')
  assert.match(timeOf({ ...working, eta: { ...eta, from: 'step' } }).from.title, /time its step names/)
})

test('a worker that works without a time is shown as a fault, on one line, with the time of this task so far', () => {
  const time = timeOf({ ...working, eta: null, isWithoutTime: true })
  assert.deepEqual([time.label, time.main, time.tone, time.small], ['ETA', 'No time', 'fault', ['5 min so far']])
  assert.match(time.title, /without a time/)
  // The main chat has no task to time: no fault.
  const main = timeOf({ ...working, eta: null, isWithoutTime: false })
  assert.deepEqual([main.main, main.tone], ['Working', 'muted'])
  // Every figure of the column stays on one line, and a fault is drawn as one.
  assert.match(style, /\.eta b,\s*\.eta \.state\s*\{[^}]*white-space:\s*nowrap/)
  assert.match(style, /\.eta \.state\.is-fault\s*\{[^}]*var\(--warn\)/)
})

test('the other states of a lane say what they said before', () => {
  assert.deepEqual([timeOf({ state: 'free' }).main, timeOf({ state: 'waiting' }).main, timeOf({ state: 'unknown' }).main, timeOf({ isLeftover: true, state: 'unknown' }).main], ['Available', 'Blocked', 'Unknown', 'Leftover'])
  assert.deepEqual([timeOf({ state: 'interrupted', cutOffAt: null }).label, timeOf({ state: 'interrupted', cutOffAt: null }).main], ['Cut off', 'by a restart'])
})

test('a table as a chat writes it is read as a table: its head, its rows, and the text around it', () => {
  const parts = plain(page.partsOf('Your steps:\n\n| Id | Asks |\n|---|:--:|\n| B01 | **Verify** |\n| B02 | Do |\n\nThat is all.'))
  assert.deepEqual(parts, [
    { text: 'Your steps:' },
    { table: { head: ['Id', 'Asks'], rows: [['B01', '**Verify**'], ['B02', 'Do']] } },
    { text: 'That is all.' },
  ])
  // Without a line of dashes there is no head; one line between bars is no table.
  assert.deepEqual(plain(page.partsOf('| a | b |\n| c | d |')), [{ table: { head: null, rows: [['a', 'b'], ['c', 'd']] } }])
  assert.deepEqual(plain(page.partsOf('| just bars |\nand text')), [{ text: '| just bars |\nand text' }])
  assert.deepEqual(plain(page.partsOf('No table here.\nTwo lines.')), [{ text: 'No table here.\nTwo lines.' }])
  // The page draws the parts: the advice and a message of the advisor.
  // B218: the game plan draws its tables with its links working.
  assert.match(script, /add\(drawTable\(part\.table, linker\)\)/)
  assert.match(script, /rich\(bubble, text\)/)
})

test('the advice says how old it is, and warns when it is old', () => {
  assert.equal(build({ adviceAt: NOW - 30 * MIN }).adviceAt, NOW - 30 * MIN)
  assert.equal(build({}).adviceAt, null)
  const fresh = plain(page.adviceAge(NOW - 30 * MIN, NOW))
  assert.deepEqual(fresh, { text: `Written 30 min ago, at ${page.clock(NOW - 30 * MIN)}.`, isOld: false })
  const old = plain(page.adviceAge(NOW - 5 * 60 * MIN, NOW))
  assert.deepEqual([old.isOld, old.text.startsWith('Written 5 h ago, ')], [true, true])
  assert.match(old.text, /decided since is not in it\.$/)
  assert.match(plain(page.adviceAge(NOW - 3 * 24 * 60 * MIN, NOW)).text, /^Written 3 days ago, on \d+ \w+ at \d\d:\d\d\./)
  assert.equal(page.adviceAge(null, NOW), null)
})

test('a step\'s window says "nothing more is written" only when nothing is', () => {
  const names = { ask: () => 'Verify', kind: () => 'kind' }
  const queued = notes => plain(page.windowOf({ step: { id: 'B89', title: 'Compare', notes, status: 'queued' }, lane: 'Units' }, names))
  assert.equal(queued([]).hasNotes, false)
  // Its lines are its checklist and its context: they stand on the right, and the left does not deny them.
  const written = queued([{ title: 'Requirements', lines: [], points: ['tab by tab'] }, { title: 'Context', lines: ['the worker\'s side'], points: [] }])
  assert.deepEqual([written.hasNotes, written.checklist, written.notes.length], [true, ['tab by tab'], 1])
  assert.match(script, /else if \(!view\.hasNotes\) left\.append\(section\('Description'/)
})
