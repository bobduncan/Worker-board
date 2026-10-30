// B793 (the person, 2026-10-30: Worker 1 on B781 showed "45 h 33 over" after a pause and a restart): the time a task has
// left counts only the time its chat worked on it. A pause, a limit's stop, an asleep or closed chat, the wait for the
// person and the board being off add nothing; a task that runs again counts on from what was left when it stopped. The
// same clock serves the step's time, the time counted from a step's Estimate or its refine's size, the overdue rule
// and the "so far" of the page. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { step, toolResult, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { notWorkedSince } from '../src/history.mjs'
import { buildState } from '../src/state.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { nextPlan, planText } from '../src/work/stepPlan.mjs'

const MIN = 60_000
const H = 60 * MIN
const NOW = Date.UTC(2026, 9, 30, 20, 14)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }

const app = name => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
const tail = lines => ({ text: lines.join('\n'), isCut: false, modifiedAt: NOW })
// A turn that began 10 minutes ago and runs.
const running = [typed(NOW - 10 * MIN, 'Carry on with B08.'), step(NOW - 2 * MIN, 'Run the tests'), toolResult(NOW - MIN)]
const card = (task, at) => JSON.stringify({ name: 'x', role: 'worker', state: 'working', task, at })

/** A history line of Units: the state it was in from `at` on. */
const seen = (at, state, task = 'Archer', extra = {}) => ({ at, chat: 'Units', state, task, step: null, steps: null, leftMs: null, estimateAt: null, startedAt: NOW - 45 * H, source: 'plan', by: null, ...extra })
const gap = at => ({ at, gap: true })

/** The step B08, in progress for Units, with a plan saved with it when `plan` is given. */
const backlog = ({ estimate = '', extra = [] } = {}) => [
  '## Art #focus',
  `- [ ] B08 Portraits (for Units${estimate}) (branch feature/portraits)`,
  ...extra.map(one => `  ${one}`),
  '',
].join('\n')
const REFINED = ['Refined (2026-10-28 10:00; ready):', 'Summary: Draw the portraits.', 'Size: about 1 h', 'What we build:', '- the portraits']

/** Units' lane: its card's task (`own`, given at `ownAt`), the step's saved plan, and the history the board kept. */
function lane({ own = null, ownAt = NOW - 3 * MIN, plan = null, lines = [], text = backlog(), taken = NOW - 45 * H, aliveAt = null } = {}) {
  const work = storeFromText(text, { now: taken })
  if (plan !== null) work.items.get('B08').head.set('Plan', planText(plan))
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: [app('Main'), app('Units')],
    tails: { 'cli-Units': tail(running) },
    planLineTexts: own === null ? {} : { 'cli-Units': card(own, ownAt) },
    work,
    adviceText: null,
    folders: null,
    askTexts: [],
    pictureLists: {},
  }
  return buildState(raw, { lines, outbox: [], runs: [], aliveAt, now: NOW, config }).chats.find(chat => chat.name === 'Units')
}

/** 45 hours ago the plan was given; it worked an hour, then did not work for 44 hours, then worked the last 10 minutes. */
const GIVEN = NOW - 45 * H
const worked = (...between) => [seen(GIVEN, 'working'), ...between, seen(NOW - 10 * MIN, 'working')]

test('the time left counts the working time only: a pause of 44 hours is not time spent', () => {
  const one = lane({ own: { text: 'Archer', left: 2 * H }, ownAt: GIVEN, lines: worked(seen(GIVEN + H, 'suspended')) })
  // 2 hours planned, 1 hour and the last 10 minutes worked: 50 minutes left, not "43 h over".
  assert.deepEqual(one.eta, { at: NOW + 50 * MIN, leftMs: 50 * MIN, isOverdue: false, isOver: false, isOwn: true, from: 'own' })
  assert.equal(one.isWithoutTime, false)
})

test('the same over the board being off, a chat that did not run, an asleep chat and a wait for the person', () => {
  const own = { text: 'Archer', left: 2 * H }
  // The board was off from the first hour on: the next line is when it ran again.
  const off = lane({ own, ownAt: GIVEN, lines: [seen(GIVEN, 'working'), gap(GIVEN + H), seen(NOW - 10 * MIN, 'working')] })
  assert.equal(off.eta.leftMs, 50 * MIN)
  for (const state of ['free', 'off', 'unknown', 'interrupted', 'waiting']) {
    const one = lane({ own, ownAt: GIVEN, lines: worked(seen(GIVEN + H, state)) })
    assert.equal(one.eta.leftMs, 50 * MIN, state)
  }
  // The board woke a moment ago and has not written its gap line yet: the open gap counts as off too.
  const waking = lane({ own, ownAt: GIVEN, aliveAt: GIVEN + H, lines: [seen(GIVEN, 'working')] })
  assert.equal(waking.eta.leftMs, H, 'the open gap is not worked: only the first hour counted')
})

test('a restart: the step\'s saved plan counts on from what was left when the chat stopped', () => {
  const saved = nextPlan(null, { names: ['Sheet', 'Clips', 'Merge'], step: 2, minutes: 120, stepMinutes: 60 }, GIVEN)
  const one = lane({ plan: saved, lines: worked(seen(GIVEN + H, 'suspended')) })
  assert.equal(one.task.isSavedPlan, true)
  assert.deepEqual(one.eta, { at: NOW + 50 * MIN, leftMs: 50 * MIN, isOverdue: false, isOver: false, isOwn: true, from: 'own' })
  // The part's time counts the same way: an hour planned, an hour and 10 minutes worked... the page reads it from `stepCountAt`.
  assert.equal(one.task.stepCountAt + one.task.stepLeftMs, NOW - 10 * MIN)
  // The times the chat gave stay as it gave them.
  assert.equal(one.task.stepEstimateAt + one.task.stepLeftMs, GIVEN + H)
})

test('overdue only past twice the estimate and 10 minutes, both in working time', () => {
  const own = { text: 'Archer', left: 30 * MIN }
  // 35 minutes worked before the pause and 10 after: 45 of 30 planned, 15 over, under twice: a little over, no fault.
  const little = lane({ own, ownAt: GIVEN, lines: worked(seen(GIVEN + 35 * MIN, 'suspended')) })
  assert.deepEqual([little.eta.isOver, little.eta.isOverdue, little.eta.leftMs, little.eta.at], [true, false, 0, NOW - 15 * MIN])
  // 70 minutes before the pause and 10 after: 80 of 30 planned, 50 over, past twice: overdue.
  const late = lane({ own, ownAt: GIVEN, lines: worked(seen(GIVEN + 70 * MIN, 'suspended')) })
  assert.deepEqual([late.eta.isOver, late.eta.isOverdue, late.eta.at], [true, true, NOW - 50 * MIN])
})

test('a new plan from the chat replaces the old: it counts from when it was given', () => {
  // Given 3 minutes ago: 40 minutes then, 3 minutes worked since.
  const one = lane({ own: { text: 'Archer', left: 40 * MIN }, ownAt: NOW - 3 * MIN, lines: worked(seen(GIVEN + H, 'suspended')) })
  assert.equal(one.eta.leftMs, 37 * MIN)
})

test('the time of a step\'s Estimate counts from the start in working time', () => {
  // No plan of its own: the step names an hour. 20 minutes worked, a long stop, 10 minutes worked: 30 minutes left.
  const lines = [seen(GIVEN, 'working', 'B08 Portraits', { source: 'step', startedAt: GIVEN }), seen(GIVEN + 20 * MIN, 'suspended', 'B08 Portraits', { source: 'step', startedAt: GIVEN }), seen(NOW - 10 * MIN, 'working', 'B08 Portraits', { source: 'step', startedAt: GIVEN })]
  const one = lane({ text: backlog({ estimate: '; about 1 h' }), lines })
  assert.deepEqual([one.eta.from, one.eta.leftMs, one.eta.isOverdue], ['step', 30 * MIN, false])
})

test('the size a step\'s refine gave counts from the take in working time', () => {
  const lines = [seen(GIVEN, 'working', 'B08 Portraits', { source: 'step', startedAt: GIVEN }), seen(GIVEN + 20 * MIN, 'suspended', 'B08 Portraits', { source: 'step', startedAt: GIVEN }), seen(NOW - 10 * MIN, 'working', 'B08 Portraits', { source: 'step', startedAt: GIVEN })]
  const one = lane({ text: backlog({ extra: REFINED }), lines })
  assert.deepEqual([one.eta.from, one.eta.leftMs, one.eta.isOverdue], ['refine', 30 * MIN, false])
})

test('with no history the clock is the wall clock as before', () => {
  const one = lane({ own: { text: 'Archer', left: 25 * MIN }, ownAt: NOW - 3 * MIN })
  assert.equal(one.eta.leftMs, 22 * MIN)
  assert.equal(one.task.countAt, NOW - 3 * MIN)
})

test('notWorkedSince: what is not working, the gaps and the open gap; time before the first line counts as worked', () => {
  const lines = [seen(100 * MIN, 'working'), seen(130 * MIN, 'suspended'), seen(200 * MIN, 'working'), gap(230 * MIN), seen(260 * MIN, 'working')]
  // From the first line: it worked 100-130, 200-230 and 260-300; 70 minutes paused and 30 with the board off.
  assert.equal(notWorkedSince(lines, 'Units', 100 * MIN, 300 * MIN), 100 * MIN)
  // Before the first line: counted as worked.
  assert.equal(notWorkedSince(lines, 'Units', 0, 300 * MIN), 100 * MIN)
  // From the middle of the pause: 50 more of it, and the 30 of the gap.
  assert.equal(notWorkedSince(lines, 'Units', 150 * MIN, 300 * MIN), 80 * MIN)
  // Another chat's lines say nothing of this one; a chat with no line of its own counts as worked.
  assert.equal(notWorkedSince(lines, 'Other', 0, 300 * MIN), 0)
  assert.equal(notWorkedSince([], 'Units', 0, 300 * MIN), 0)
  assert.equal(notWorkedSince(lines, 'Units', 300 * MIN, 300 * MIN), 0)
})

// The page: the same clock for the step line, the "so far" figure and the age of the estimate.

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('lanetime')}\n${cut('stepline')}\n${cut('alerts')}\nObject.assign(this, { stepLine, timeOf, alertsOf })`, page)
const NAMES = ['Sheet', 'Clips', 'Merge']
const onPage = lane => ({ name: 'Units', state: 'working', isLeftover: false, isWithoutTime: false, ...lane })

test('page: the step\'s time counts down from the moment moved on by what was not worked', () => {
  // Given 45 h ago with 3 h to go; 44 h of it not worked: 2 h 15 left, not "42 h over".
  const task = { text: 'Redesign', step: 1, steps: 3, names: NAMES, stepLeftMs: 3 * H, stepEstimateAt: NOW - 45 * H, stepCountAt: NOW - H }
  assert.equal(page.stepLine(onPage({ task }), NOW).time, '2 h left')
  // Without the moved moment (an older board) the page counts as before.
  assert.equal(page.stepLine(onPage({ task: { ...task, stepCountAt: undefined } }), NOW).tone, 'bad')
})

test('page: "so far" is the time worked, and the age of an estimate counts working time', () => {
  const lane = onPage({ task: { startedAt: NOW - 45 * H, offStartMs: 44 * H, stepId: 'B08' }, eta: null, isWithoutTime: true })
  assert.deepEqual([...page.timeOf(lane, NOW).small], ['1 h so far'])
  const old = onPage({ task: { text: 'Archer', estimateAt: NOW - 45 * H, countAt: NOW - 20 * MIN, firstEstimateMs: null, workedMs: 0 }, eta: { at: NOW, leftMs: 0, isOver: false, isOverdue: false } })
  const alerts = page.alertsOf(old, { readAt: NOW, estimateOldMs: 3 * H })
  assert.deepEqual([...alerts].filter(one => /estimate/.test(one)), [])
})
