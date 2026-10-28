// B758 (X99): at 99% of the 5-hour limit, 25 min before its reset (12:25 on 2026-10-28), the board gave B744, B743 and B746 and started
// Workers 1 to 3, and the work ran into paid extra usage: it counted the 5-hour limit full only at 100. The limit now counts full from
// a stop line (config `fiveHourStopAt`, 95) while its reset is more than `fiveHourStopMinutes` (10) away; at 100 always. Each working
// worker is told once (say.mjs `fiveHourStopDue`); a watch rule opens one incident when a step is given or a worker started at the
// line. Made-up limits and chats only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { messageText } from '../src/bridge.mjs'
import { parseConfig } from '../src/config.mjs'
import { limitsOf } from '../src/limits.mjs'
import { fiveHourStopDue } from '../src/say.mjs'
import { memoryStore } from '../src/store.mjs'
import { buildState } from '../src/state.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { WATCH_RULES } from '../src/supervisor/rules/watch.mjs'
import { workApi } from '../src/work/api.mjs'
import { deliverWork, givesRefused } from '../src/work/deliver.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'

const MIN = 60_000
const SEC = 1000
const NOW = new Date(2026, 9, 28, 12, 25).getTime()
const RESET = new Date(2026, 9, 28, 12, 50).getTime()
const WEEK_RESET = new Date(2026, 10, 2, 8, 0).getTime()
const at = (hour, minute) => new Date(2026, 9, 28, hour, minute).getTime()

/** The limits as the board reads them: the app's sample for both windows, the 5-hour limit with its reset known (or not). */
const limits = (fiveHour, { now = NOW, resetsAt = RESET, week = 40, ...more } = {}) => limitsOf({
  sample: { at: now - MIN, fiveHour, week },
  readings: resetsAt === null ? [] : [{ at: now - 30 * MIN, fiveHour: { used: 90, resetsAt }, week: null }],
  stops: [], now, ...more,
})

test('the 5-hour limit counts full from the stop line while its reset is over 10 min away: 94 warns, 95 and 99 are full, 100 is full', () => {
  assert.equal(limits(94).fiveHour.level, 'warn')
  assert.equal(limits(95).fiveHour.level, 'full')
  assert.equal(limits(99).fiveHour.level, 'full')
  assert.equal(limits(99).fiveHour.stopAt, 95)
  assert.equal(limits(100).fiveHour.level, 'full')
  assert.equal(limits(79).fiveHour.level, 'ok')
})

test('within 10 min of the reset it hands out as today (warn below 100, full at 100); after the reset the limit is empty again', () => {
  // 12:40 is 10 min before the reset: not over 10, so no hold; 12:39 is 11 min before: held.
  assert.equal(limits(99, { now: at(12, 40) }).fiveHour.level, 'warn')
  assert.equal(limits(99, { now: at(12, 39) }).fiveHour.level, 'full')
  assert.equal(limits(99, { now: at(12, 45) }).fiveHour.level, 'warn')
  assert.equal(limits(100, { now: at(12, 45) }).fiveHour.level, 'full')
  const after = limitsOf({ sample: { at: at(12, 48), fiveHour: 99, week: 40 }, readings: [{ at: at(12, 0), fiveHour: { used: 90, resetsAt: RESET }, week: null }], stops: [], now: at(12, 55) })
  assert.equal(after.fiveHour.level, 'ok')
  assert.equal(after.fiveHour.resetAt, RESET)
})

test('a reset no chat read counts as far off: 95 is full, so no work runs into extra usage on a guess', () => {
  assert.equal(limits(95, { resetsAt: null }).fiveHour.level, 'full')
  assert.equal(limits(94, { resetsAt: null }).fiveHour.level, 'warn')
})

test('the line and the minutes come from the config; a missing or wrong setting reads 95 and 10', () => {
  assert.equal(limits(90, { fiveHourStopAt: 90 }).fiveHour.level, 'full')
  assert.equal(limits(97, { fiveHourStopAt: 98 }).fiveHour.level, 'warn')
  assert.equal(limits(99, { now: at(12, 39), fiveHourStopMinutes: 15 }).fiveHour.level, 'warn')
  assert.equal(limits(99, { now: at(12, 34), fiveHourStopMinutes: 15 }).fiveHour.level, 'full')
  assert.equal(parseConfig('{}', {}).fiveHourStopAt, 95)
  assert.equal(parseConfig('{}', {}).fiveHourStopMinutes, 10)
  assert.equal(parseConfig('{"fiveHourStopAt":90,"fiveHourStopMinutes":5}', {}).fiveHourStopAt, 90)
  assert.equal(parseConfig('{"fiveHourStopAt":90,"fiveHourStopMinutes":5}', {}).fiveHourStopMinutes, 5)
  assert.equal(parseConfig('{"fiveHourStopAt":"x","fiveHourStopMinutes":0}', {}).fiveHourStopAt, 95)
  assert.equal(parseConfig('{"fiveHourStopAt":"x","fiveHourStopMinutes":0}', {}).fiveHourStopMinutes, 10)
  // Left out of limitsOf's call the same.
  assert.equal(limitsOf({ sample: { at: NOW - MIN, fiveHour: 96, week: 10 }, now: NOW }).fiveHour.level, 'full')
})

test('the week\'s line is unchanged (B742): 97 warns, 98 is full, whatever the 5-hour line says', () => {
  const week = used => limitsOf({ sample: { at: NOW - MIN, fiveHour: 10, week: used }, now: NOW, fiveHourStopAt: 50 }).week.level
  assert.deepEqual([week(97), week(98), week(100)], ['warn', 'full', 'full'])
})

// The board's word to a working worker

// B771: a working worker holds a step not yet reported (in progress), as the store says (`storeSteps`).
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, state: 'working', isRunning: true, storeSteps: [{ id: 'B1', title: 'A step', state: 'in progress' }], ...more })
const board = (fiveHour, chats, more = {}) => ({ restart: { main: 'Main' }, chats: [{ name: 'Main', isMain: true, state: 'working' }, ...chats], limits: limits(fiveHour, more.limits), pause: { state: 'running', since: NOW - 5 * 60 * MIN }, ...more.board })
const THREE = [lane('Worker 1'), lane('Worker 2'), lane('Worker 3')]

test('today\'s case: 99% with the reset at 12:50 → one word to each working worker, in the board\'s own voice, with the time it goes on', () => {
  const words = fiveHourStopDue(board(99, [...THREE, lane('Worker 4', { state: 'free' })]), [])
  assert.deepEqual(words.map(one => one.to), ['Worker 1', 'Worker 2', 'Worker 3'])
  assert.ok(words.every(one => one.command === 'five-hour-stop'))
  assert.equal(words[0].text, 'The 5-hour limit reached the stop line (95%): bring your work to a safe point (commit, checkpoint), then send the paused note until 12:50')
  assert.equal(messageText(words[0], () => '12:25'), words[0].text)
  // A reset nobody read: the word names none.
  const unknown = fiveHourStopDue(board(99, [lane('Worker 1')], { limits: { resetsAt: null } }), [])
  assert.equal(unknown[0].text, 'The 5-hour limit reached the stop line (95%): bring your work to a safe point (commit, checkpoint), then send the paused note')
})

test('at 94, within 10 min of the reset, or with only the week full, nothing is said', () => {
  assert.deepEqual(fiveHourStopDue(board(94, THREE), []), [])
  assert.deepEqual(fiveHourStopDue(board(99, THREE, { limits: { now: at(12, 45) } }), []), [])
  assert.deepEqual(fiveHourStopDue(board(10, THREE, { limits: { week: 99 } }), []), [])
})

test('the word is given once for each window: not again whatever became of it; a worker suspended, free, off or not running gets none; a pause holds it back', () => {
  const [first] = fiveHourStopDue(board(99, [lane('Worker 1')]), [])
  for (const state of ['waiting', 'taken', 'expired']) assert.deepEqual(fiveHourStopDue(board(99, [lane('Worker 1')]), [{ ...first, at: NOW, state }]), [])
  // Another worker is still told.
  assert.deepEqual(fiveHourStopDue(board(99, [lane('Worker 1'), lane('Worker 2')]), [{ ...first, at: NOW }]).map(one => one.to), ['Worker 2'])
  // A word sent before the reset was known, inside the same window, stands for it too.
  assert.deepEqual(fiveHourStopDue(board(99, [lane('Worker 1')]), [{ ...first, fiveHourResets: null, at: RESET - 20 * MIN }]), [])
  // The next window is another stop.
  assert.equal(fiveHourStopDue(board(99, [lane('Worker 1')]), [{ ...first, fiveHourResets: RESET - 5 * 60 * MIN, at: RESET - 5 * 60 * MIN - 20 * MIN }]).length, 1)
  assert.deepEqual(fiveHourStopDue(board(99, [lane('Worker 1', { state: 'suspended' }), lane('Worker 2', { state: 'free' }), lane('Worker 3', { state: 'off' }), lane('Worker 4', { isRunning: false })]), []), [])
  assert.deepEqual(fiveHourStopDue(board(99, THREE, { board: { pause: { state: 'pausing', since: NOW - MIN } } }), []), [])
})

test('B771 (X98): the word goes only to a worker that holds a step not yet reported (taken or in progress); one in review, or holding none, gets none', () => {
  const held = state => lane('Worker 1', { storeSteps: [{ id: 'B742', title: 'A step', state }] })
  for (const state of ['taken', 'in progress']) assert.deepEqual(fiveHourStopDue(board(99, [held(state)]), []).map(one => one.to), ['Worker 1'], state)
  for (const state of ['review', 'waiting on you', 'done']) assert.deepEqual(fiveHourStopDue(board(99, [held(state)]), []), [], state)
  assert.deepEqual(fiveHourStopDue(board(99, [lane('Worker 1', { storeSteps: [] }), lane('Worker 2', { storeSteps: undefined })]), []), [])
  // Handed back by a failed check: it holds its step, so it gets the word.
  const back = [lane('Worker 1', { storeSteps: [{ id: 'B742', state: 'review' }] }), lane('Worker 2', { storeSteps: [{ id: 'B743', state: 'review' }] })]
  assert.deepEqual(fiveHourStopDue({ ...board(99, back), reconciled: { handedBack: ['Worker 1'] } }, []).map(one => one.to), ['Worker 1'])
})

// The watch rule

const rule = WATCH_RULES.find(one => one.id === 'five-hour-stop-ignored')
const given = (id, to, when) => [id, { head: new Map([['Id', id], ['Kind', 'step'], ['State', 'queued'], ['Owner', to]]), sections: new Map([['History', [`- ${stamp(when)} server: refined → queued (given by the board to ${to})`]]]), problem: null }]
const viewOf = (fiveHour, { items = [], outbox = [], now = NOW + 6 * MIN, more = {} } = {}) => buildView({
  state: { chats: [{ name: 'Main', isMain: true, state: 'working' }, ...THREE], today: [], limits: limitsOf({ sample: { at: NOW - MIN, fiveHour, week: 40 }, readings: [{ at: NOW - 30 * MIN, fiveHour: { used: 90, resetsAt: RESET }, week: null }], stops: [], now }), pause: more.pause ?? null, chatPrefix: '' }, items: new Map(items), outbox, settings: {}, now,
})
const run = view => rule.check(view, { seen: new Map(), observed: [] })
const startWord = (command, about, when) => ({ to: 'Main', command, about, at: when, state: 'delivered', reported: 0 })

test('five-hour-stop-ignored: the figure of 12:24 and three steps given at 12:27, 12:28 and 12:29 plus a start → one incident naming them', () => {
  const found = run(viewOf(99, { items: [given('B744', 'Worker 1', at(12, 27)), given('B743', 'Worker 2', at(12, 28)), given('B746', 'Worker 3', at(12, 29))], outbox: [startWord('start', 'Worker 4', at(12, 28) + 20 * SEC)] }))
  assert.equal(found.length, 1)
  assert.equal(found[0].key, 'five-hour-stop-ignored board')
  assert.match(found[0].text, /B744 at 12:27, B743 at 12:28, B746 at 12:29, start of Worker 4 at 12:28/)
  assert.match(found[0].evidence, /5-hour 99% read at 12:24 \(stop line 95%, resets 12:50\)/)
  assert.equal(run(viewOf(99, { outbox: [startWord('spawn', undefined, at(12, 30))] }))[0].text.includes('a new worker at 12:30'), true)
})

test('five-hour-stop-ignored: quiet below the line, within 10 min of the reset, within 2 min of the reading, for a word that failed, a wake or a line, or while the person pauses', () => {
  const items = [given('B744', 'Worker 1', at(12, 28))]
  assert.deepEqual(run(viewOf(94, { items })), [])
  assert.deepEqual(run(viewOf(99, { items, now: at(12, 45) })), [])
  assert.deepEqual(run(viewOf(99, { items: [given('B744', 'Worker 1', at(12, 24))] })), [])
  assert.deepEqual(run(viewOf(99, { outbox: [{ ...startWord('start', 'Worker 4', at(12, 30)), state: 'failed' }] })), [])
  // A wake of a chat that words wait for carries no `reported`; the line that tells a worker of a step given earlier is no give.
  assert.deepEqual(run(viewOf(99, { outbox: [{ to: 'Main', command: 'start', about: 'Worker 4', at: at(12, 30), state: 'delivered' }, { to: 'Worker 1', command: 'work', about: 'B744', at: at(12, 30), text: 'work: B744 is yours; run work next', state: 'waiting' }] })), [])
  assert.deepEqual(run(viewOf(99, { items, more: { pause: { state: 'pausing', since: at(12, 26) } } })), [])
})

// The real case through the server's own pass: state → reconcile → delivery

const PROJECT = 'C:\\garden'
const ROLES = { Lead: 'main', W1: 'worker', W2: 'worker', W3: 'worker' }
const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)), problem: null })
const task = (id, more = {}) => item({ Id: id, Kind: 'step', Title: `Task ${id}`, State: 'refined', Activity: 'Garden', Since: stamp(NOW - 60 * MIN), Refined: 'ready', ...more }, { History: [`- ${stamp(NOW - 60 * MIN)} Partner: made`] })
const app = (name, more = {}) => JSON.stringify({ title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1', ...more })
const usage = (when, fiveHour, week) => `{"version":2,"samples":[{"t":${when},"org":"org-1","u":{"fh":${fiveHour},"sd":${week}}}]}`

/** A garden with B744, B743 and B746 ready, W1 idle and W2 and W3 off, the limits as `fiveHour` says at `now`; the pass as the server runs it. */
async function pass(fiveHour, now) {
  const dir = await mkdtemp(join(tmpdir(), 'five-hour-stop-'))
  try {
    const items = new Map(['B744', 'B743', 'B746'].map(id => [id, task(id)]))
    await writeStore(dir, { items, activities: [{ name: 'Garden', isFocus: false, steps: [...items.keys()], notes: [], loose: [] }] }, undefined, { now: NOW - 60 * MIN })
    const config = { ...parseConfig(JSON.stringify({ handOutBeyondFocus: true, maxWorkers: 3 }), {}), project: PROJECT }
    const reports = new Map([
      ['W1', { state: 'idle', since: now - 60 * SEC, background: false, at: now - 2 * SEC, session: 'cli-W1', mod: '0.19.0' }],
      ['W2', { state: 'ended', since: now - 30 * MIN, background: false, at: now - 30 * MIN, session: 'cli-W2', mod: '0.19.0' }],
      ['W3', { state: 'ended', since: now - 30 * MIN, background: false, at: now - 30 * MIN, session: 'cli-W3', mod: '0.19.0' }],
    ])
    const outbox = memoryStore()
    const raw = {
      listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: ['Lead', 'W1', 'W2', 'W3'].map(name => app(name)), tails: {}, planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {},
      usageText: usage(at(12, 24), fiveHour, 40), work: { ok: true, dir, ...(await readStore(dir)) },
    }
    const state = buildState(raw, {
      lines: [], outbox: outbox.outbox(), runs: [], board: { startedAt: NOW - 60 * MIN, offSince: null }, seen: { shown: { Lead: now }, other: {} }, reports, now, config,
      keptReadings: [{ at: at(12, 0), fiveHour: { used: 90, resetsAt: RESET }, week: { used: 40, resetsAt: WEEK_RESET } }], refusedGives: givesRefused(dir, now),
    })
    let n = 0
    const done = await deliverWork({ state, dir, outbox, apply: async body => workApi(body, { dir, now, prefix: 'Garden · ', roleOf: chat => ROLES[chat] ?? null, as: 'server' }), now, maxChars: 2000, newId: () => `m${(n += 1)}` })
    return { level: state.limits.fiveHour.level, gives: state.reconciled.gives.map(one => one.id), start: state.reconciled.start, given: done.given, sent: outbox.outbox().map(one => one.command) }
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

test('the real case (5-hour 99% read at 12:24, reset 12:50, B743, B744 and B746 ready, Workers 1 to 3): no give and no start until 12:40, then as today', async () => {
  const early = await pass(99, NOW)
  assert.deepEqual([early.level, early.gives, early.start, early.given, early.sent], ['full', [], null, [], []])
  const late = await pass(99, at(12, 39))
  assert.deepEqual([late.level, late.gives, late.start, late.given], ['full', [], null, []])
  // 12:40 on: the reset is no more than 10 min off, and the board hands out as before.
  const open = await pass(99, at(12, 40))
  assert.equal(open.level, 'warn')
  assert.deepEqual(open.gives, ['B743'])
  assert.deepEqual(open.start, { start: 'W2' })
  assert.deepEqual(open.given, ['B743'])
})

test('the real case at 94%: the board hands out as today', async () => {
  const today = await pass(94, NOW)
  assert.deepEqual([today.level, today.gives, today.given], ['warn', ['B743'], ['B743']])
  assert.deepEqual(today.start, { start: 'W2' })
})
