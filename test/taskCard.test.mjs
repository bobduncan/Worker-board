// B82: a lane shows what the chat recorded about its task (topic, steps by name, time) and never the words of a
// prompt. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { answer, fromChat, step, toolResult, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { parsePlanLine } from '../src/planLines.mjs'
import { buildState } from '../src/state.mjs'
import { parseTail, taskStart } from '../src/transcript.mjs'

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 12, 15, 0)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }

const BACKLOG = [
  '## Art #focus',
  '- [ ] B06 The archer (for Units; about 40 min)',
  '- [ ] B08 Portraits (for Units; about 20 min)',
  '- [x] B09 A finished step (for Units; about 10 min)',
  '- [ ] B10 Verify: Say whether the archer is right (for Units; about 5 min) @you',
  '',
].join('\n')

const app = name => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
const tail = lines => ({ text: lines.join('\n'), isCut: false, modifiedAt: NOW })
const planLine = task => JSON.stringify({ name: 'x', role: 'worker', state: 'working', task, at: NOW - 3 * MIN })
const running = [typed(NOW - 20 * MIN, 'Zebracorn please'), step(NOW - 2 * MIN, 'Run the tests'), toolResult(NOW - MIN)]

function build({ tails = {}, plans = {}, lines = [] }) {
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: [app('Main'), app('Units')],
    tails: Object.fromEntries(Object.entries(tails).map(([name, value]) => [`cli-${name}`, value])),
    planLineTexts: Object.fromEntries(Object.entries(plans).map(([name, value]) => [`cli-${name}`, value])),
    backlogText: BACKLOG,
    adviceText: null,
    folders: null,
    askTexts: [],
    pictureLists: {},
  }
  return buildState(raw, { lines, outbox: [], runs: [], now: NOW, config })
}
const units = state => state.chats.find(chat => chat.name === 'Units')

test('a plan line may name its steps: short strings, in order', () => {
  const line = names => parsePlanLine(JSON.stringify({ task: { text: 'Camera', step: 2, steps: 3, names } })).task.names
  assert.deepEqual(line(['Tests', ' Build ', 'Merge']), ['Tests', 'Build', 'Merge'])
  // What is not a name is left out; no names at all is null, and the page shows "2 of 3".
  assert.deepEqual(line(['Tests', '', 7, null, 'Merge']), ['Tests', 'Merge'])
  for (const none of [undefined, null, 'Tests, Build', [], [' ', 3]]) assert.equal(line(none), null)
  assert.equal(line(['x'.repeat(200)])[0].length, 80)
  assert.equal(line(Array.from({ length: 50 }, (_, i) => `step ${i}`)).length, 30)
})

test('a lane shows what the chat recorded: the topic, the steps by name with the one it is on, and the time', () => {
  const state = build({
    tails: { Units: tail(running) },
    plans: { Units: planLine({ text: 'Archer at 4x', step: 2, steps: 3, names: ['Sheet', 'Clips', 'Merge'], left: 25 * MIN, isReported: false }) },
  })
  const { task, eta } = units(state)
  assert.deepEqual([task.text, task.source, task.step, task.steps, task.names], ['Archer at 4x', 'plan', 2, 3, ['Sheet', 'Clips', 'Merge']])
  assert.deepEqual(eta, { at: NOW + 22 * MIN, leftMs: 22 * MIN, isOverdue: false, isOwn: true, from: 'own' })
})

test('a chat that recorded nothing shows the backlog step it was handed, by the id the hand-over names', () => {
  const handOver = fromChat(NOW - 15 * MIN, 'Game - Main', 'Task from Game - Main: backlog steps B08 and then B06, the zebracorn portraits.\nDetails follow.')
  const state = build({ tails: { Units: tail([handOver, step(NOW - 2 * MIN, 'Draw'), toolResult(NOW - MIN)]) } })
  const { task, eta } = units(state)
  // The first step it names that is open, with the backlog's own words for it and its "about 20 min".
  assert.deepEqual([task.text, task.source, task.stepId, task.stepMinutes, task.startedAt], ['B08 Portraits', 'step', 'B08', 20, NOW - 15 * MIN])
  assert.deepEqual(eta, { at: NOW + 5 * MIN, leftMs: 5 * MIN, isOverdue: false, isOwn: false, from: 'step' })
  assert.ok(!JSON.stringify(state).includes('zebracorn'))
})

test('a hand-over that names no open step of the backlog leaves the task without words', () => {
  for (const firstLine of ['Task from Game - Main: do the zebracorn thing.', 'Task from Game - Main: backlog step B09 again.', 'Task from Game - Main: step B10 and B77.']) {
    const state = build({ tails: { Units: tail([fromChat(NOW - 15 * MIN, 'Game - Main', firstLine), step(NOW - 2 * MIN, 'Draw'), toolResult(NOW - MIN)]) } })
    assert.deepEqual([units(state).task.text, units(state).task.source, units(state).task.stepId], ['', 'unrecorded', null], firstLine)
  }
})

test('taskStart: the ids of the steps a hand-over names in its first line, each once', () => {
  const entries = lines => parseTail(lines.join('\n'), false)
  const main = { mainTitle: 'Game - Main', mainSession: null }
  const ids = body => taskStart(entries([fromChat(1, 'Game - Main', body)]), main).steps
  assert.deepEqual(ids('Two tasks from Game - Main: backlog steps B64 and then B65, and B64 again.\nAlso B99 further down.'), ['B64', 'B65'])
  assert.deepEqual(ids('Task from Game - Main: build the archer.'), [])
})

test('no word of a prompt or of a hand-over reaches the page, whatever the chat does', () => {
  const words = ['zebracorn', 'quokkaberry', 'narwhalish']
  const handOver = fromChat(NOW - 40 * MIN, 'Game - Main', 'Task from Game - Main: the quokkaberry level.\nMore about quokkaberry.')
  const typedLater = typed(NOW - 10 * MIN, 'And make it narwhalish too.')
  const cases = {
    'working after a prompt': [...running],
    'working after a hand-over': [handOver, step(NOW - 2 * MIN, 'Build'), toolResult(NOW - MIN)],
    'a remark in the middle of a turn': [handOver, step(NOW - 12 * MIN, 'Build'), toolResult(NOW - 11 * MIN), typedLater, step(NOW - 2 * MIN, 'Build'), toolResult(NOW - MIN)],
    'ended with the hand-over not reported': [handOver, step(NOW - 12 * MIN, 'Build'), toolResult(NOW - 11 * MIN), answer(NOW - 5 * MIN, 'Paused')],
  }
  // What the history kept from before: lines that still hold the words of a prompt and of a hand-over.
  const lines = [
    { at: NOW - 90 * MIN, chat: 'Units', state: 'working', task: 'A zebracorn prompt', step: null, steps: null, leftMs: null, startedAt: NOW - 91 * MIN, source: 'prompt', by: 'you' },
    { at: NOW - 60 * MIN, chat: 'Units', state: 'working', task: 'The quokkaberry level', step: null, steps: null, leftMs: null, startedAt: NOW - 61 * MIN, source: 'handover' },
  ]
  for (const [name, entries] of Object.entries(cases)) {
    const text = JSON.stringify(build({ tails: { Units: tail(entries), Main: tail(running) }, lines }))
    for (const word of words) assert.ok(!text.includes(word), `${name}: the page would get "${word}"`)
  }
})

test('a lane with nothing recorded and no step says so in the timeline ahead too', () => {
  const state = build({ tails: { Units: tail(running) } })
  assert.deepEqual([units(state).task.text, units(state).ahead], ['', []])
})
