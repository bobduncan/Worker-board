// Redesign Part 1 (2026-10-24): the board shows what a chat reports of its turn state (busy, idle, asking) instead of
// reading it from the chat's transcript, card and timers; a chat that sends no report (an older Workers mod, or none
// yet after the board started) keeps that reading. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { hitLimit, step, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 24, 20, 56).getTime()
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const NAMES = ['Main', 'Board', 'Support', 'Helper', 'Watcher']

const app = name => JSON.stringify({
  title: `Team - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 2 * MIN, lastAssistantUuid: 'u-1',
})
/** A turn under way by its transcript: written 20 seconds ago. */
const working = { lines: [typed(NOW - 20 * MIN, 'Go on.'), step(NOW - 20_000, 'Build')], at: NOW - 20_000 }
const stepItem = (id, owner, state = 'in progress') => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\nOwner: ${owner}\nSince: ${stamp(NOW - 40 * MIN)}\n`)
const askItem = (id, owner) => parseItem(`Id: ${id}\nKind: ask\nTitle: Which hat?\nState: open\nOwner: ${owner}\nSince: ${stamp(NOW - 10 * MIN)}\nAsks: decide\nBlocking: yes\n`)
/** A report as the server keeps it (bridge.mjs `noteReport`): fresh, from the session the board shows, on mod 0.19.0. */
const report = (name, state, more = {}) => [name, { state, since: NOW - 2 * MIN, background: false, at: NOW - 5_000, session: `cli-${name}`, mod: '0.19.0', ...more }]

/** Every chat's transcript shows a turn running; the board started 30 minutes ago and its bridge heard Main lately. */
function build({ reports = null, items = [], appStartedAt = NOW - 3 * 60 * MIN, startedAt = NOW - 30 * MIN } = {}) {
  const work = storeFromText('## Board\n', { now: NOW - 60 * MIN })
  for (const item of items) work.items.set(item.head.get('Id'), item)
  const raw = {
    listText: '{"prefix":"Team - ","main":"Main","helper":"Helper","supervisor":"Watcher"}',
    appChatTexts: NAMES.map(app),
    tails: Object.fromEntries(NAMES.map(name => [`cli-${name}`, { text: working.lines.join('\n'), isCut: false, modifiedAt: working.at }])),
    planLineTexts: {},
    work, adviceText: null, folders: null, askTexts: [], pictureLists: {},
    ...(appStartedAt === null ? {} : { appStartedAt }),
  }
  return buildState(raw, {
    lines: [], outbox: [], runs: [], now: NOW, config, seen: { shown: { Main: NOW - 5_000 }, other: {} },
    board: { startedAt, offSince: null }, ...(reports === null ? {} : { reports: new Map(reports) }),
  })
}
const lane = (state, name) => state.chats.find(chat => chat.name === name)
const shown = (state, name) => [lane(state, name).state, lane(state, name).isRunning]

test('a worker the transcript reads as working, whose report says idle with no task, is free and runs', () => {
  assert.equal(lane(build(), 'Board').state, 'working', 'today\'s reading of its transcript')
  const state = build({ reports: [report('Board', 'idle')] })
  assert.deepEqual(shown(state, 'Board'), ['free', true])
  // busy is working, asking waiting; each runs.
  assert.deepEqual(shown(build({ reports: [report('Board', 'busy')] }), 'Board'), ['working', true])
  assert.deepEqual(shown(build({ reports: [report('Board', 'asking')] }), 'Board'), ['waiting', true])
  // Idle with background work still running works, between two turns.
  const background = lane(build({ reports: [report('Board', 'idle', { background: true })] }), 'Board')
  assert.deepEqual([background.state, background.isRunning, background.between], ['working', true, 'Its turn has ended; background work it started is still running.'])
})

test('a report older than unknownAfterSeconds is unknown; asleep once the app started after it (its process ended with the app)', () => {
  const old = report('Board', 'busy', { at: NOW - 40_000 })
  // T13 part 3: asleep, no longer off: its turn was cut, it resumes by itself.
  assert.deepEqual(shown(build({ reports: [old], appStartedAt: NOW - 20_000 }), 'Board'), ['interrupted', false])
  assert.deepEqual([lane(build({ reports: [old], appStartedAt: NOW - 20_000 }), 'Board').asleep, lane(build({ reports: [old], appStartedAt: NOW - 20_000 }), 'Board').asleepSince], [true, NOW - 20_000])
  assert.deepEqual(shown(build({ reports: [old], appStartedAt: NOW - 3 * 60 * MIN }), 'Board'), ['unknown', null])
  assert.deepEqual(shown(build({ reports: [old], appStartedAt: null }), 'Board'), ['unknown', null])
  // The setting decides how old is too old.
  const later = buildState({ ...rawOf(), }, optionsOf({ reports: [old], unknownAfterSeconds: 60 }))
  assert.deepEqual(shown(later, 'Board'), ['working', true])
})

/** The raw and options `build` makes, for a test that changes a setting. */
function rawOf() {
  return {
    listText: '{"prefix":"Team - ","main":"Main","helper":"Helper","supervisor":"Watcher"}',
    appChatTexts: NAMES.map(app),
    tails: Object.fromEntries(NAMES.map(name => [`cli-${name}`, { text: working.lines.join('\n'), isCut: false, modifiedAt: working.at }])),
    planLineTexts: {}, work: storeFromText('## Board\n', { now: NOW - 60 * MIN }), adviceText: null, folders: null, askTexts: [], pictureLists: {},
    appStartedAt: NOW - 3 * 60 * MIN,
  }
}
function optionsOf({ reports, unknownAfterSeconds }) {
  return {
    lines: [], outbox: [], runs: [], now: NOW, config: { ...config, unknownAfterSeconds }, seen: { shown: { Main: NOW - 5_000 }, other: {} },
    board: { startedAt: NOW - 30 * MIN, offSince: null }, reports: new Map(reports),
  }
}

test('Review Focus 3: right after the board started no chat has reported yet: each shows today\'s reading, never unknown or off', () => {
  const fresh = build({ reports: [], startedAt: NOW - 10_000 })
  const before = build({ startedAt: NOW - 10_000 })
  for (const name of ['Main', 'Board', 'Support']) assert.deepEqual(lane(fresh, name), lane(before, name), name)
  assert.ok(fresh.chats.every(chat => chat.state !== 'unknown' && chat.state !== 'off'))
})

test('a chat on mod 0.18.1, or a report from a session the board does not show under that name, keeps today\'s reading', () => {
  const today = build()
  assert.deepEqual(lane(build({ reports: [report('Board', 'idle', { mod: '0.18.1' })] }), 'Board'), lane(today, 'Board'))
  assert.deepEqual(lane(build({ reports: [report('Board', 'idle', { mod: null })] }), 'Board'), lane(today, 'Board'))
  assert.deepEqual(lane(build({ reports: [report('Board', 'idle', { session: 'cli-old' })] }), 'Board'), lane(today, 'Board'))
})

test('Review Focus 5: idle while the store holds its step in progress is interrupted, never free; with a blocking ask open, waiting', () => {
  const holding = build({ reports: [report('Board', 'idle')], items: [stepItem('B12', 'Board')] })
  assert.deepEqual(shown(holding, 'Board'), ['interrupted', true])
  // Its step stays its task.
  assert.equal(lane(holding, 'Board').task?.text, 'B12 Step B12')
  const asking = build({ reports: [report('Board', 'idle')], items: [stepItem('B12', 'Board'), askItem('Q3', 'Board')] })
  assert.deepEqual(shown(asking, 'Board'), ['waiting', true])
  // A step waiting on the person holds it waiting too.
  assert.deepEqual(shown(build({ reports: [report('Board', 'idle')], items: [stepItem('B12', 'Board', 'waiting on you')] }), 'Board'), ['waiting', true])
  // A step in review holds nobody.
  assert.deepEqual(shown(build({ reports: [report('Board', 'idle')], items: [stepItem('B12', 'Board', 'review')] }), 'Board'), ['free', true])
})

test('a lane suspended for the limit stays suspended whatever it reports', () => {
  const tails = Object.fromEntries(NAMES.map(name => [`cli-${name}`, { text: working.lines.join('\n'), isCut: false, modifiedAt: working.at }]))
  tails['cli-Board'] = { text: [typed(NOW - 20 * MIN, 'Go on.'), hitLimit(NOW - 10 * MIN, "You've hit your limit · resets 11pm")].join('\n'), isCut: false, modifiedAt: NOW - 10 * MIN }
  const raw = { ...rawOf(), tails }
  assert.equal(lane(buildState(raw, optionsOf({ reports: [], unknownAfterSeconds: 30 })), 'Board').state, 'suspended', 'the made-up stop reads as one')
  assert.equal(lane(buildState(raw, optionsOf({ reports: [report('Board', 'idle')], unknownAfterSeconds: 30 })), 'Board').state, 'suspended')
})

test('the helper\'s and the supervisor\'s lanes follow their reports the same way', () => {
  const state = build({ reports: [report('Helper', 'idle'), report('Watcher', 'asking')] })
  assert.deepEqual([state.advisorHelper.state, state.advisorHelper.isRunning], ['free', true])
  assert.deepEqual([state.supervisorChat.state, state.supervisorChat.isRunning], ['waiting', true])
  // T13 part 3: after the app's start a busy one is asleep and interrupted, no longer off.
  const stale = build({ reports: [report('Helper', 'busy', { at: NOW - 40_000 }), report('Watcher', 'busy', { at: NOW - 40_000 })], appStartedAt: NOW - 20_000 })
  assert.deepEqual([stale.advisorHelper.state, stale.advisorHelper.isRunning, stale.advisorHelper.asleep], ['interrupted', false, true])
  assert.deepEqual([stale.supervisorChat.state, stale.supervisorChat.isRunning, stale.supervisorChat.asleep], ['interrupted', false, true])
})

test('the counts add up over the reported states', () => {
  const state = build({ reports: [report('Main', 'idle'), report('Board', 'busy'), report('Support', 'busy', { at: NOW - 40_000 })] })
  assert.deepEqual(state.chats.map(chat => [chat.name, chat.state]), [['Main', 'free'], ['Board', 'working'], ['Support', 'unknown']])
  assert.deepEqual(state.counts, { working: 1, waiting: 0, free: 1, unknown: 1, interrupted: 0, suspended: 0, off: 0 })
})

test('gap 1: a chat whose card says a reporting mod and that sent no report is unknown, then off: never free by the older reading', () => {
  const card = mod => JSON.stringify({ name: 'Board', role: 'worker', state: 'waiting', task: null, at: NOW - 60 * MIN, mod })
  const run = ({ mod = '0.19.0', startedAt = NOW - 30 * MIN, cardAt = NOW - 60 * MIN, reports = [], settings = {} } = {}) => buildState(
    { ...rawOf(), planLineTexts: { 'cli-Board': card(mod) }, planLineAt: { 'cli-Board': cardAt } },
    { ...optionsOf({ reports, unknownAfterSeconds: 30 }), config: { ...config, ...settings }, board: { startedAt, offSince: null } })
  const pad = n => String(n).padStart(2, '0')
  const hhmm = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
  // Off after offAfterMinutes, counted from the board's start: not running, and why.
  const off = lane(run(), 'Board')
  assert.deepEqual([off.state, off.isRunning, off.offWhy, off.report], ['off', false, `no report since the board started at ${hhmm(NOW - 30 * MIN)}`, null])
  assert.equal(off.offSince, null, 'no card left working')
  // Unknown once the board has run unknownAfterSeconds, and before offAfterMinutes.
  assert.deepEqual(shown(run({ startedAt: NOW - 2 * MIN }), 'Board'), ['unknown', null])
  assert.deepEqual(shown(run({ settings: { offAfterMinutes: 60 } }), 'Board'), ['unknown', null])
  // Counted from the later of the board's start and the card's last write.
  assert.deepEqual(shown(run({ cardAt: NOW - 2 * MIN }), 'Board'), ['unknown', null])
  assert.deepEqual(shown(run({ cardAt: NOW - 6 * MIN }), 'Board'), ['off', false])
  // Right after the board started: today's reading, as for an older mod; an older mod keeps it.
  const older = lane(run({ mod: '0.18.1' }), 'Board')
  assert.notEqual(older.state, 'off')
  assert.deepEqual(lane(run({ startedAt: NOW - 10_000 }), 'Board').state, lane(run({ mod: '0.18.1', startedAt: NOW - 10_000 }), 'Board').state)
  assert.deepEqual(shown(run({ startedAt: NOW - 10_000 }), 'Board'), [older.state, older.isRunning])
  // A report from its session decides; the others' lanes are untouched (their cards say no mod).
  assert.deepEqual(shown(run({ reports: [report('Board', 'idle')] }), 'Board'), ['free', true])
  assert.deepEqual(lane(run(), 'Support'), lane(run({ mod: '0.18.1' }), 'Support'))
  // The counts add up.
  assert.equal(run().counts.off, 1)
})
