// B113: the limits in the board's state, a worker held by the limit as a state of its own ("suspended"), and why a
// queued step is not started. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { answer, assistant, fromChat, hitLimit, step, tool, toolResult, typed, usageResult } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState } from './withStore.mjs'
import { storeFromText } from '../src/work/read.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
/** A time of this machine's own clock, on the day of the samples. */
const at = (hour, minute = 0, day = 12) => new Date(2026, 9, day, hour, minute).getTime()
const NOW = at(22, 51)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }

const BACKLOG = [
  '## Board #focus',
  '- [x] B01 A finished step (for Units; about 10 min)',
  '- [ ] B02 The camera (for Features; about 1 h) (branch feature/camera)',
  '- [ ] B03 The archer (for Units; after B01; about 40 min)',
  '- [ ] B04 Portraits (for Units; after B02; about 20 min)',
  '- [ ] B05 The bridge (for Levels; after the art is agreed; about 30 min)',
  '- [ ] B06 The menu (for Features; after B99; about 30 min)',
  '- [ ] B07 The merge order (for Main; about 15 min)',
  '- [ ] B08 A step for a chat that is not there (for Sound; about 15 min)',
  '',
].join('\n')

const app = (name, more = {}) => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1', ...more,
})
const tail = (lines, more = {}) => ({ text: lines.join('\n'), isCut: false, modifiedAt: NOW, ...more })
const planLine = task => JSON.stringify({ name: 'x', role: 'worker', state: 'waiting', task: { since: NOW - 60 * MIN, isReported: false, ...task }, at: NOW - 30 * MIN })
const sample = (when, fh, sd) => `{"version":2,"samples":[{"t":${when},"org":"org-1","u":{"fh":${fh},"sd":${sd}}}]}`

const busy = [typed(NOW - 20 * MIN, 'Zebracorn please'), step(NOW - 2 * MIN, 'Run the tests'), toolResult(NOW - MIN)]
const handOver = fromChat(NOW - 90 * MIN, 'Game - Main', 'Task from Game - Main: backlog step B02, the camera. About 1 h.')
const work = [handOver, step(NOW - 89 * MIN, 'Build'), toolResult(NOW - 88 * MIN)]
const toMain = (when, message) => [assistant(when, 'tool_use', [tool('SendMessage', { to: 'Game - Main', message })]), toolResult(when + 1000)]
const paused = (until = ' until 23:40') => [...work, ...toMain(NOW - 11 * MIN, `Note from Game - Features: paused for the limit${until}.`), answer(NOW - 10 * MIN, 'I stop here.')]
const stopped = [...work, hitLimit(NOW - 14 * MIN, 'You\'ve hit your session limit · resets 11:40pm (Europe/Berlin)')]

function build({ tails = {}, plans = {}, usageText = null, apps = ['Main', 'Units', 'Features', 'Levels'], now = NOW, more = {}, work = undefined } = {}) {
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: apps.map(name => app(name, more[name] ?? {})),
    tails: Object.fromEntries(Object.entries(tails).map(([name, value]) => [`cli-${name}`, value])),
    planLineTexts: Object.fromEntries(Object.entries(plans).map(([name, value]) => [`cli-${name}`, value])),
    backlogText: BACKLOG,
    adviceText: null,
    folders: null,
    askTexts: [],
    pictureLists: {},
    usageText,
    ...(work === undefined ? {} : { work }),
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], now, config })
}
const lane = (state, name) => state.chats.find(chat => chat.name === name)
const why = (state, name, id) => lane(state, name).queue.find(one => one.id === id).why

// The limits

test('the state holds both limits: the figure of the app\'s file, and the reset a chat read', () => {
  const reading = usageResult(at(18, 50), { fiveHour: { used: 6, resetsAt: at(23, 40) }, week: { used: 53, resetsAt: at(21, 0, 15) } })
  const state = build({ usageText: sample(NOW - 3 * MIN, 86, 64), tails: { Main: tail([typed(at(18, 49), 'Zebracorn'), step(at(18, 49), 'Look'), reading, answer(at(18, 51), 'Done.')]) } })
  assert.deepEqual(state.limits, {
    fiveHour: { used: 86, at: NOW - 3 * MIN, resetsAt: at(23, 40), resetAt: null, level: 'warn' },
    week: { used: 64, at: NOW - 3 * MIN, resetsAt: at(21, 0, 15), resetAt: null, level: 'ok' },
  })
})

test('a reading from further back than the tail counts too, and so does one in the advisor\'s chat', () => {
  const old = usageResult(at(18, 50), { fiveHour: { used: 6, resetsAt: at(23, 40) } })
  const deep = build({ usageText: sample(NOW - 3 * MIN, 50, 64), tails: { Units: tail(busy, { usage: old }) } })
  assert.equal(deep.limits.fiveHour.resetsAt, at(23, 40))
  const advisor = build({ apps: ['Main', 'Units', 'Advisor'], usageText: sample(NOW - 3 * MIN, 50, 64), tails: { Advisor: tail([step(at(18, 49), 'Look'), old, answer(at(18, 51), 'Done.')]) } })
  assert.equal(advisor.limits.fiveHour.resetsAt, at(23, 40))
  assert.equal(lane(deep, 'Units').usage, undefined)
})

test('without the app\'s file and without a reading the limits are not known, and nothing else changes', () => {
  const state = build({ tails: { Units: tail(busy) } })
  assert.deepEqual(state.limits, { fiveHour: null, week: null })
  assert.deepEqual([lane(state, 'Units').state, lane(state, 'Units').suspended, state.counts.suspended], ['working', null, 0])
})

test('the percentage the bar warns from can be set', () => {
  const state = buildState({ listText: '{}', appChatTexts: [], tails: {}, planLineTexts: {}, usageText: sample(NOW - MIN, 60, 10) }, { now: NOW, config: { ...config, limitWarnPercent: 50 } })
  assert.equal(state.limits.fiveHour.level, 'warn')
  assert.equal(parseConfig('{"limitWarnPercent":70}', {}).limitWarnPercent, 70)
  assert.equal(parseConfig('{}', {}).limitWarnPercent, 80)
  // Where the app keeps its samples: beside its other files, unless the config names another place.
  assert.equal(parseConfig('{}', { APPDATA: 'C:\\Users\\x\\Roaming' }).usageHistory, 'C:\\Users\\x\\Roaming\\Claude\\plan-usage-history.json')
  assert.equal(parseConfig(JSON.stringify({ usageHistory: '%HOME%\\usage.json' }), { HOME: 'D:\\me' }).usageHistory, 'D:\\me\\usage.json')
})

// Suspended

test('a chat the app stopped at the limit is suspended, until the time the app named, and keeps its task', () => {
  const state = build({ tails: { Features: tail(stopped) }, plans: { Features: planLine({ text: 'B02 The camera', step: 2, steps: 4 }) }, usageText: sample(NOW - 20 * MIN, 97, 64) })
  const features = lane(state, 'Features')
  assert.equal(features.state, 'suspended')
  assert.deepEqual(features.suspended, { by: 'app', limit: 'fiveHour', since: NOW - 14 * MIN, until: at(23, 40), isBack: false })
  assert.deepEqual([features.task.text, features.task.step, features.eta, features.between, features.doingNow], ['B02 The camera', 2, null, null, null])
  assert.deepEqual([state.counts.suspended, state.counts.working], [1, 0])
  // Nobody is asked anything: it waits for the clock, not for the person.
  assert.deepEqual(state.forYou, [])
  // The limit itself is full while that reset is ahead, whatever the last sample said.
  assert.deepEqual([state.limits.fiveHour.level, state.limits.fiveHour.used, state.limits.fiveHour.resetsAt], ['full', 100, at(23, 40)])
})

test('a worker that told the main chat it paused for the limit is suspended until the time it named', () => {
  const state = build({ tails: { Features: tail(paused()) }, plans: { Features: planLine({ text: 'B02 The camera', step: 2, steps: 4 }) } })
  const features = lane(state, 'Features')
  assert.equal(features.state, 'suspended')
  assert.deepEqual(features.suspended, { by: 'note', limit: 'fiveHour', since: NOW - 11 * MIN, until: at(23, 40), isBack: false })
  assert.equal(features.task.text, 'B02 The camera')
  // The app's own summary of that turn cannot make it wait for the person.
  const asked = build({ tails: { Features: tail(paused()) }, more: { Features: { postTurnSummary: { status_category: 'blocked', status_detail: 'paused', needs_action: 'Resume after the reset.', summarizes_uuid: 'u-1' } } } })
  assert.deepEqual([lane(asked, 'Features').state, asked.forYou.length], ['suspended', 0])
})

test('a pause that names no time ends when the 5-hour limit resets, as far as the board knows that', () => {
  const reading = usageResult(at(18, 50), { fiveHour: { used: 6, resetsAt: at(23, 40) } })
  const known = build({ tails: { Features: tail(paused('')), Main: tail([step(at(18, 49), 'Look'), reading, answer(at(18, 51), 'Done.')]) } })
  assert.deepEqual(lane(known, 'Features').suspended, { by: 'note', limit: 'fiveHour', since: NOW - 11 * MIN, until: at(23, 40), isBack: false })
  assert.deepEqual(lane(build({ tails: { Features: tail(paused('')) } }), 'Features').suspended, { by: 'note', limit: 'fiveHour', since: NOW - 11 * MIN, until: null, isBack: false })
})

test('after that time a worker that paused by a note is still suspended, and the board says the limit is back; the stop of the app is over', () => {
  const later = at(23, 50)
  const note = build({ tails: { Features: tail(paused()) }, now: later })
  assert.deepEqual([lane(note, 'Features').state, lane(note, 'Features').suspended.until, lane(note, 'Features').suspended.isBack], ['suspended', at(23, 40), true])
  // 2026-10-24: an app's stop past the reset it named holds the worker no longer (it kept workers suspended for days):
  // the lane is what its turn says.
  const stop = build({ tails: { Features: tail(stopped) }, now: later })
  assert.deepEqual([lane(stop, 'Features').state === 'suspended', lane(stop, 'Features').suspended], [false, null])
  // A pause without a time: the reset the board knew has passed (nothing read since: it stays suspended), or (B312)
  // a reading after the pause shows a new window of five hours began since: it is free.
  const reading = when => usageResult(when, { fiveHour: { used: 6, resetsAt: at(23, 40) } })
  const passed = build({ tails: { Features: tail(paused('')), Main: tail([step(at(18, 49), 'Look'), reading(at(18, 50)), answer(at(18, 51), 'Done.')]) }, now: later })
  assert.deepEqual([lane(passed, 'Features').suspended.until, lane(passed, 'Features').suspended.isBack], [at(23, 40), true])
  const next = usageResult(at(23, 45), { fiveHour: { used: 1, resetsAt: at(4, 40, 13) } })
  const began = build({ tails: { Features: tail(paused('')), Main: tail([step(at(23, 44), 'Look'), next, answer(at(23, 46), 'Done.')]) }, now: later })
  assert.deepEqual([lane(began, 'Features').state === 'suspended', lane(began, 'Features').suspended], [false, null])
})

test('a worker that works again is not suspended, and the main chat cannot pause by a note to itself', () => {
  const again = build({ tails: { Features: tail([...paused(), fromChat(NOW - 3 * MIN, 'Game - Main', 'Go on.'), step(NOW - 2 * MIN, 'Build'), toolResult(NOW - MIN)]) } })
  assert.deepEqual([lane(again, 'Features').state, lane(again, 'Features').suspended], ['working', null])
  const midTurn = build({ tails: { Features: tail(paused().slice(0, -1)) } })
  assert.equal(lane(midTurn, 'Features').state, 'working')
  const main = build({ tails: { Main: tail(paused()) } })
  assert.equal(lane(main, 'Main').suspended, null)
})

// Why a queued step is not started

test('a queued step says why it is not started: its worker is busy, waits for you, or is free and nobody handed it out', () => {
  // B299, B301: the main chat waits for the person when it asks with the app's question form (or holds an open blocking
  // ask), never because its answer has a "For you" block.
  const asking = [typed(NOW - 30 * MIN, 'Zebracorn'), assistant(NOW - 29 * MIN, 'tool_use', [tool('AskUserQuestion', { questions: [{ question: 'Which one?', options: [{ label: 'A' }, { label: 'B' }] }] })])]
  const state = build({ tails: { Units: tail(busy), Main: tail(asking) }, plans: { Units: JSON.stringify({ name: 'x', role: 'worker', state: 'working', task: { text: 'The zebracorn', step: 1, steps: 2, left: 25 * MIN, isReported: false }, at: NOW - 5 * MIN }) }, more: { Main: { postTurnSummary: { status_category: 'blocked', status_detail: 'asked', needs_action: 'Choose one.', summarizes_uuid: 'u-1' } } } })
  assert.deepEqual(why(state, 'Units', 'B03'), { reason: 'busy', worker: 'Units', leftMs: 20 * MIN })
  assert.deepEqual(why(state, 'Main', 'B07'), { reason: 'you', worker: 'Main' })
  const done = [typed(NOW - 30 * MIN, 'Zebracorn'), answer(NOW - 29 * MIN, 'Done.')]
  const free = build({ tails: { Units: tail(done), Main: tail(done) } })
  // A "For you" block alone leaves the main chat free: the board says so as a warning, and hands out.
  const block = build({ tails: { Units: tail(done), Main: tail([typed(NOW - 30 * MIN, 'Zebracorn'), answer(NOW - 29 * MIN, '> **For you**\n> 1. **Answer:** Which one?')]) } })
  assert.deepEqual(why(block, 'Main', 'B07'), { reason: 'handout', main: 'Game - Main', isOwn: true })
  assert.deepEqual(why(free, 'Units', 'B03'), { reason: 'handout', main: 'Game - Main', isOwn: false })
  assert.deepEqual(why(free, 'Main', 'B07'), { reason: 'handout', main: 'Game - Main', isOwn: true })
})

test('a condition that is not met comes before the worker: an open step by its id, else the condition\'s own words', () => {
  const state = build({ tails: { Units: tail(busy) } })
  // B01 is done: that condition is met, so the reason is the worker.
  assert.equal(why(state, 'Units', 'B03').reason, 'busy')
  assert.deepEqual(why(state, 'Units', 'B04'), { reason: 'after', steps: ['B02'] })
  assert.deepEqual(why(state, 'Levels', 'B05'), { reason: 'after', words: 'the art is agreed' })
  // A step the backlog does not hold: the board cannot tell, and says the condition as it is written.
  assert.deepEqual(why(state, 'Features', 'B06'), { reason: 'after', words: 'B99' })
})

test('B542: a condition on a step in review says it waits for that step\'s check', () => {
  const work = storeFromText(BACKLOG, { now: NOW - 60 * MIN })
  work.items.get('B02').head.set('State', 'review')
  const state = build({ tails: { Units: tail(busy) }, work })
  assert.deepEqual(why(state, 'Units', 'B04'), { reason: 'after', steps: ['B02'], checks: ['B02'] })
})

test('a suspended worker and a full limit come before everything else, also for a step that names no worker here', () => {
  const held = build({ tails: { Features: tail(paused()) } })
  assert.deepEqual(why(held, 'Features', 'B06'), { reason: 'suspended', worker: 'Features', until: at(23, 40), isBack: false, by: 'note' })
  assert.deepEqual(held.unassigned.map(one => [one.id, one.why]), [['B08', { reason: 'nobody' }]])
  const full = build({ tails: { Features: tail(stopped), Units: tail(busy) } })
  for (const [name, id] of [['Units', 'B03'], ['Units', 'B04'], ['Features', 'B06'], ['Main', 'B07']]) assert.deepEqual(why(full, name, id), { reason: 'limit', limit: 'fiveHour', until: at(23, 40) }, id)
  assert.deepEqual(full.unassigned[0].why, { reason: 'limit', limit: 'fiveHour', until: at(23, 40) })
})

test('a worker that was cut off, or whose state is not known, is the reason too', () => {
  const state = build({ tails: { Units: tail([]) } })
  assert.deepEqual(why(state, 'Units', 'B03'), { reason: 'unknown', worker: 'Units' })
  // Its own file says waiting since after the turn began, and the transcript did not move on: the app was closed.
  const open = [typed(NOW - 20 * MIN, 'Zebracorn please'), step(NOW - 19 * MIN, 'Build'), toolResult(NOW - 18 * MIN)]
  const cut = build({ tails: { Units: tail(open, { modifiedAt: NOW - 18 * MIN }) }, plans: { Units: JSON.stringify({ name: 'x', role: 'worker', state: 'waiting', task: null, at: NOW - 10 * MIN }) } })
  assert.deepEqual([lane(cut, 'Units').state, why(cut, 'Units', 'B03')], ['interrupted', { reason: 'cut', worker: 'Units' }])
})
