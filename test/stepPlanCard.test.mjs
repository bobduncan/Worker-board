// T13, part 2: a task's plan and time stay with the task. A lane in a NEW chat (its card empty, or a topic only) that
// holds a step shows the plan saved with the step (its parts, the part it is on, the time left from the saved times); the
// card's own plan wins when it has one; a step with no plan at all shows the size its refine gave, counted from when the
// step was taken, marked as the refine's estimate; a step with no size keeps "No time". Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { step, toolResult, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState } from '../src/state.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { nextPlan, planText } from '../src/work/stepPlan.mjs'

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 12, 15, 0)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }

/** The step B08, in progress for Units; `extra` lines under it (a refine block says its size). */
const backlog = ({ estimate = '', extra = [] } = {}) => [
  '## Art #focus',
  `- [ ] B08 Portraits (for Units${estimate}) (branch feature/portraits)`,
  ...extra.map(one => `  ${one}`),
  '',
].join('\n')
const REFINED = ['Refined (2026-10-12 10:00; ready):', 'Summary: Draw the portraits.', 'Size: about 1 h', 'What we build:', '- the portraits']

const app = name => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
const tail = lines => ({ text: lines.join('\n'), isCut: false, modifiedAt: NOW })
// A chat that took the step over: its turn began 5 minutes ago, and its card (new session) holds nothing, or a topic only.
const running = [typed(NOW - 5 * MIN, 'Carry on with B08.'), step(NOW - 2 * MIN, 'Run the tests'), toolResult(NOW - MIN)]
const card = task => JSON.stringify({ name: 'x', role: 'worker', state: 'working', task, at: NOW - 3 * MIN })

/**
 * Units' lane on B08. `taken` is when the step was taken (its Since), `plan` the plan saved with it (the fields of
 * `nextPlan`, as the board writes them), `own` the card's task.
 */
function lane({ taken = NOW - 45 * MIN, plan = null, own = null, text = backlog() } = {}) {
  const work = storeFromText(text, { now: taken })
  if (plan !== null) work.items.get('B08').head.set('Plan', planText(plan))
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: [app('Main'), app('Units')],
    tails: { 'cli-Units': tail(running) },
    planLineTexts: own === null ? {} : { 'cli-Units': card(own) },
    work,
    adviceText: null,
    folders: null,
    askTexts: [],
    pictureLists: {},
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], now: NOW, config }).chats.find(chat => chat.name === 'Units')
}

/** The plan Units wrote 20 minutes ago: three parts, on the second; the task runs out in 25 minutes, the part in 10. */
const SAVED = nextPlan(null, { names: ['Sheet', 'Clips', 'Merge'], step: 2, minutes: 45, stepMinutes: 30 }, NOW - 20 * MIN)

test('a lane in a new session (empty card) shows the plan saved with its step: the parts, the part it is on, the time left', () => {
  const one = lane({ plan: SAVED })
  assert.equal(one.state, 'working')
  assert.deepEqual([one.task.names, one.task.step, one.task.steps, one.task.isSavedPlan, one.task.stepId], [['Sheet', 'Clips', 'Merge'], 2, 3, true, 'B08'])
  // The task's time: 45 min from 20 minutes ago, its own estimate (not the step's words), 25 minutes left.
  assert.deepEqual(one.eta, { at: NOW + 25 * MIN, leftMs: 25 * MIN, isOverdue: false, isOver: false, isOwn: true, from: 'own' })
  assert.equal(one.isWithoutTime, false)
  // The part's time: 30 min from 20 minutes ago, 10 left; the page counts it down from when it was said.
  assert.equal(one.task.stepEstimateAt + one.task.stepLeftMs, NOW + 10 * MIN)
})

test('a card that holds a topic only is no plan: the saved plan shows then too', () => {
  const one = lane({ plan: SAVED, own: { text: 'B08 Portraits' } })
  assert.deepEqual([one.task.source, one.task.text, one.task.names, one.task.step, one.task.isSavedPlan], ['plan', 'B08 Portraits', ['Sheet', 'Clips', 'Merge'], 2, true])
  assert.equal(one.eta.at, NOW + 25 * MIN)
})

test('a saved time that has run out is never negative: the lane reads it as an overrun, as for the card\'s own', () => {
  const late = nextPlan(null, { names: ['Sheet', 'Clips'], step: 1, minutes: 10, stepMinutes: 5 }, NOW - 40 * MIN)
  const one = lane({ plan: late })
  assert.ok(one.task.leftMs >= 0 && one.task.stepLeftMs >= 0)
  // The time ran out 30 minutes ago (10 minutes from 40 minutes ago): over twice and by 10 minutes: Overdue, as before.
  assert.deepEqual(one.eta, { at: NOW - 30 * MIN, leftMs: 0, isOverdue: true, isOver: true, isOwn: true, from: 'own' })
  assert.equal(one.task.stepEstimateAt + one.task.stepLeftMs, NOW - 35 * MIN)
})

test('the card\'s own plan wins over the saved one, also a card that has only a time', () => {
  const own = { text: 'B08 Portraits', step: 1, steps: 2, names: ['Draw', 'Check'], left: 50 * MIN, stepLeft: 20 * MIN }
  const one = lane({ plan: SAVED, own })
  assert.deepEqual([one.task.names, one.task.step, one.task.steps, one.task.isSavedPlan], [['Draw', 'Check'], 1, 2, undefined])
  assert.equal(one.eta.at, NOW - 3 * MIN + 50 * MIN)
  const timeOnly = lane({ plan: SAVED, own: { text: 'B08 Portraits', left: 15 * MIN } })
  assert.deepEqual([timeOnly.task.names, timeOnly.task.isSavedPlan, timeOnly.eta.at], [null, undefined, NOW - 3 * MIN + 15 * MIN])
})

test('no plan but the refine\'s size: the lane shows it as a first estimate from the take time, marked as the refine\'s', () => {
  // Taken 45 minutes ago, its refine said about 1 h: 15 minutes left, whatever time the new chat's turn began.
  const one = lane({ text: backlog({ extra: REFINED }) })
  assert.deepEqual(one.eta, { at: NOW + 15 * MIN, leftMs: 15 * MIN, isOverdue: false, isOver: false, isOwn: false, from: 'refine' })
  assert.deepEqual([one.task.refineMinutes, one.task.stepMinutes, one.isWithoutTime], [60, null, false])
  // The same with a card that holds a topic only; the plan the worker records later takes its place.
  assert.equal(lane({ text: backlog({ extra: REFINED }), own: { text: 'B08 Portraits' } }).eta.from, 'refine')
  const recorded = lane({ text: backlog({ extra: REFINED }), own: { text: 'B08 Portraits', left: 30 * MIN } })
  assert.deepEqual([recorded.eta.from, recorded.eta.isOwn, recorded.eta.at], ['own', true, NOW - 3 * MIN + 30 * MIN])
  // A step that names a time of its own (its Estimate) keeps that, as before.
  const estimated = lane({ text: backlog({ estimate: '; about 20 min', extra: REFINED }), taken: NOW - 15 * MIN })
  assert.deepEqual([estimated.eta.from, estimated.eta.isOwn], ['step', false])
})

test('no plan and no size: "No time", as today', () => {
  const one = lane()
  assert.deepEqual([one.eta, one.isWithoutTime, one.task.refineMinutes, one.task.isSavedPlan], [null, true, undefined, undefined])
  // A refine block that names no size gives none.
  const noSize = lane({ text: backlog({ extra: REFINED.filter(one => !one.startsWith('Size:')) }) })
  assert.deepEqual([noSize.eta, noSize.isWithoutTime], [null, true])
})

// The page: where the time is from.
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const cut = name => {
  const [from, to] = [script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`)]
  assert.ok(from >= 0 && to > from, `board.js has no part "${name}"`)
  return script.slice(from, to)
}
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('lanetime')}\nObject.assign(this, { clock, span, timeOf })`, page)
const timeOf = one => JSON.parse(JSON.stringify(page.timeOf(JSON.parse(JSON.stringify(one)), NOW)))

test('the page marks the refine\'s size as the refine\'s estimate, and a step\'s own time as before', () => {
  const time = timeOf(lane({ text: backlog({ extra: REFINED }) }))
  assert.deepEqual([time.label, time.main, time.from.text], ['ETA', '15 min left', 'refine\'s estimate'])
  assert.match(time.from.title, /no plan yet.*size the refine of B08 gave.*taken/)
  assert.equal(timeOf(lane({ text: backlog({ estimate: '; about 20 min' }), taken: NOW - 15 * MIN })).from.text, 'from B08')
  // A saved plan is the worker's own: no "from".
  assert.equal(timeOf(lane({ plan: SAVED })).from, null)
  const none = timeOf(lane())
  assert.deepEqual([none.main, none.tone], ['No time', 'fault'])
})
