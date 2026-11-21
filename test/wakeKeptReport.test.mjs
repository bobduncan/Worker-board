// F38 (B1300): a kept report moved to the board's start is no new sleep. Seen live 2026-11-21 (board.log, history.jsonl,
// wakes.json): Worker 4, holding B1293, last reported busy at about 00:35:30 (its mod's run of 2026-11-20 00:19:09) and its
// chat died. The board started at 00:36:54 and again at 00:45:05; T13 moved the kept report to each start (state.mjs), so the
// lane read Working for 30 s, then Asleep since that start. The wake code read the moved time as the chat's own: a new
// spell at 00:36:54 and at 00:45:05, one failed launch each (00:42:57, 00:51:05), and "could not wake" never went final.
// Now the wake code reads the report's own time (`heardAt`, chatReport.mjs `heardTimeOf`); the lane's reading after a start
// stays as the person ruled (T13 part 3, 2026-10-28).

import assert from 'node:assert/strict'
import test from 'node:test'

import { step, typed } from '../fixtures/lines.mjs'
import { heardTimeOf, laneFromReport } from '../src/chatReport.mjs'
import { parseConfig } from '../src/config.mjs'
import { claim, emptyWakes, newSpell, nextPath, noticeOf, pass, ranSince, sent, spellOf, statusOf, wakeOf, wakeableOf } from '../src/wake.mjs'
import { canCarry } from '../src/wakeCarry.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const at = (h, m, s = 0, day = 21) => new Date(2026, 10, day, h, m, s).getTime()
const hm = ms => new Date(ms).toTimeString().slice(0, 5)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const NAMES = ['Main', 'Worker 4']
const CLI = { Main: '0e928772-ccfd-4c85-874b-c3e9f4f866ea', 'Worker 4': '06e9b6da-78d4-4268-a9ec-e6904e9689a7' }
/** Worker 4's last report: busy at 00:35:30, from its mod's process of 2026-11-20 00:19:09. */
const LAST = at(0, 35, 30)
const RUN = at(0, 19, 9, 20)
const START_1 = at(0, 36, 54)
const START_2 = at(0, 45, 5)
const LAUNCH = at(0, 42, 57)
const FAILED = at(0, 45, 12)
const APP_STARTED = at(0, 10, 0, 20)

const app = name => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name.replace(' ', '-')}`, cliSessionId: CLI[name], cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: LAST, lastAssistantUuid: 'u-1',
})
/** The report as data/reports.json kept it (bridge.mjs `noteReport`): the board's own receipt time `at`. */
const keptReport = (more = {}) => new Map([['Worker 4', { state: 'busy', since: LAST - 20_000, background: false, at: LAST, run: RUN, seq: 812, session: CLI['Worker 4'], mod: '0.33.0', ...more }]])
const B1293 = () => parseItem(`Id: B1293\nKind: step\nTitle: Redraw the Bat smaller\nState: in progress\nOwner: Worker 4\nSince: ${stamp(at(0, 25))}\n`)

/** The board's state at `now`, started at `startedAt`, with Worker 4's kept report and the wake record. */
function build({ now, startedAt, reports = keptReport(), record = emptyWakes() }) {
  const work = storeFromText('## Board\n', { now: at(0, 0) })
  work.items.set('B1293', B1293())
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: NAMES.map(app),
    tails: Object.fromEntries(NAMES.map(name => [CLI[name], { text: [typed(at(0, 20), 'Go on.'), step(LAST, 'Build')].join('\n'), isCut: false, modifiedAt: LAST }])),
    planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: APP_STARTED,
  }
  return buildState(raw, {
    lines: [], outbox: [], runs: [], now, config, seen: { shown: {}, other: {} },
    board: { startedAt, offSince: null }, reports, wakes: { record, senderClaims: false, canLaunch: true },
  })
}
const lane = (state, name = 'Worker 4') => state.chats.find(chat => chat.name === name)

/** The launch of 00:42:57 in `spell`, sent at once, failed at 00:45:12 (no report within its time), as wakes.json holds it. */
function failedLaunch(record, spell) {
  newSpell(record, 'Worker 4', spell, LAUNCH)
  const attempt = claim(record, { chat: 'Worker 4', spell, path: 'launch', by: 'board', jobId: `launch:${LAUNCH}:Worker 4`, now: LAUNCH, runBefore: RUN, paths: ['launch'] })
  assert.ok(attempt, 'the launch is claimed')
  sent(record, 'Worker 4', attempt.jobId, LAUNCH)
  pass(record, FAILED)
  assert.equal(statusOf(record, 'Worker 4', spell).state, 'failed')
}

test('F38 the live case: Worker 4\'s sleep is one spell across the starts of 00:36:54 and 00:45:05, its own report\'s time', () => {
  // T13 unchanged: 4 s after the first start the kept report reads Working and runs (no spell); 30 s on, unknown (no spell).
  const first = lane(build({ now: START_1 + 4_000, startedAt: START_1 }))
  assert.deepEqual([first.state, first.isRunning, spellOf(first)], ['working', true, null])
  assert.equal(first.report.at, START_1, 'the lane\'s report is the moved one (T13)')
  assert.equal(first.report.heardAt, LAST, 'its own time rides along')
  assert.deepEqual([lane(build({ now: START_1 + 40_000, startedAt: START_1 })).state, spellOf(lane(build({ now: START_1 + 40_000, startedAt: START_1 })))], ['unknown', null])
  // Past five minutes after the start (the age clock counts from it): asleep and interrupted, since its own report.
  const asleep = lane(build({ now: at(0, 42, 0), startedAt: START_1 }))
  assert.deepEqual([asleep.state, asleep.isRunning, asleep.asleep, asleep.asleepSince], ['interrupted', false, true, LAST])
  assert.equal(spellOf(asleep), LAST, 'the spell is the chat\'s sleep, never the board\'s start of 00:36:54')
  // Four minutes after the start it is not asleep yet: the clock still counts from the start (T13).
  assert.notEqual(lane(build({ now: START_1 + 4 * MIN, startedAt: START_1 })).asleep, true)
  // The second start, after the launch of 00:42:57 failed: the same spell, so the failed launch counts.
  const record = emptyWakes()
  failedLaunch(record, spellOf(asleep))
  const again = lane(build({ now: START_2 + 4_000, startedAt: START_2, record }))
  assert.deepEqual([again.state, again.isRunning, spellOf(again)], ['working', true, null], 'T13\'s first 30 s after a start are unchanged')
  const later = lane(build({ now: at(0, 50, 10), startedAt: START_2, record }))
  assert.equal(later.isRunning, false)
  assert.equal(spellOf(later), LAST, 'one spell across both starts')
  // Its launch was tried in this spell and failed: no second launch, and the wake is final: "could not wake" once.
  assert.equal(nextPath(record, { chat: 'Worker 4', spell: spellOf(later), senderClaims: false, paths: ['launch'] }), null)
  const wake = wakeOf(record, { chat: 'Worker 4', spell: spellOf(later), paths: ['launch'] })
  assert.deepEqual([wake.state, wake.final], ['failed', true])
  assert.equal(newSpell(record, 'Worker 4', spellOf(later), at(0, 50, 10)), false, 'no new spell entry at the second start')
  assert.equal(record.wakes.get('Worker 4').length, 1)
  const notice = noticeOf(record, [{ chat: 'Worker 4', spell: spellOf(later), paths: ['launch'], need: true }], at(0, 50, 10), hm, { senderClaims: true, reports: { 'Worker 4': later.report } })
  assert.equal(notice?.text, 'could not wake Worker 4: the app did not start it (launched 00:42); open its chat')
  // The board's own list: unwakeable (the hand-out starts nothing for it), not waking.
  const facts = { record, senderClaims: false, canLaunch: true }
  const { unwakeable, waking } = wakeableOf([{ ...later, appSession: null }], facts)
  assert.deepEqual([unwakeable.has('Worker 4'), waking.has('Worker 4')], [true, false])
})

test('F38 a board start after the failed wake proves no life: ranSince reads the report\'s own time; a fresh report or a new run does', () => {
  const record = emptyWakes()
  failedLaunch(record, LAST)
  // A start at 00:47 moves the kept report to 00:47:00, after the failure of 00:45:12: before F38 that read "it ran since".
  const moved = lane(build({ now: at(0, 47, 10), startedAt: at(0, 47, 0), record })).report
  assert.deepEqual([moved.at, moved.heardAt], [at(0, 47, 0), LAST])
  assert.equal(ranSince(record, 'Worker 4', LAST, moved, at(0, 47, 10)), false)
  // The chat's own report after the failure (no heardAt: the board heard it) is life; so is a new run.
  assert.equal(ranSince(record, 'Worker 4', LAST, { state: 'busy', at: at(0, 56, 7), run: RUN }, at(0, 56, 10)), true)
  assert.equal(ranSince(record, 'Worker 4', LAST, { ...moved, run: at(0, 55, 50) }, at(0, 56, 10)), true)
  // A fresh report from the chat ends the spell: the lane runs and has none.
  const fresh = keptReport({ at: at(0, 56, 7), since: at(0, 56, 0), run: at(0, 55, 50) })
  const woke = lane(build({ now: at(0, 56, 10), startedAt: START_2, reports: fresh, record }))
  assert.deepEqual([woke.state, woke.isRunning, spellOf(woke)], ['working', true, null])
  // And when it sleeps again later, that is a new spell from its new report.
  const slept = lane(build({ now: at(1, 2, 30), startedAt: START_2, reports: fresh, record }))
  assert.equal(spellOf(slept), at(0, 56, 7))
})

test('F38 a chat off with no sleep of its own (busy on no task, silent) has its spell from the report\'s own time, never the start', () => {
  // Main busy on no task when the board stopped: past five minutes after the start it is off (silent), with no asleepSince.
  const reports = new Map([...keptReport(), ['Main', { state: 'busy', since: LAST - 60_000, background: false, at: LAST - 30_000, run: RUN, seq: 90, session: CLI.Main, mod: '0.33.0' }]])
  const main = lane(build({ now: START_2 + 6 * MIN, startedAt: START_2, reports }), 'Main')
  assert.deepEqual([main.state, main.isRunning, main.asleepSince ?? null], ['off', false, null])
  assert.equal(spellOf(main), LAST - 30_000)
  // A side lane's report as its spell reads it (state.mjs spellReportOf) keeps the own time too.
  assert.equal(spellOf({ isRunning: false, report: null, ownReport: { state: 'idle', at: START_2, heardAt: LAST, run: RUN } }), LAST)
})

test('F38 heardTimeOf: heardAt, else at, else null; asleepSince keeps its age clock on at', () => {
  assert.equal(heardTimeOf({ at: START_2, heardAt: LAST }), LAST)
  assert.equal(heardTimeOf({ at: START_2 }), START_2)
  assert.equal(heardTimeOf({ at: 'x' }), null)
  assert.equal(heardTimeOf(null), null)
  const options = { unknownAfterMs: 30_000, offAfterMs: 5 * MIN, holdsTask: true, hasBlockingAsk: false, appRuns: true }
  const entry = { state: 'busy', since: LAST - 20_000, at: START_2, heardAt: LAST }
  // Past five minutes of the moved time: asleep since the own time.
  assert.equal(laneFromReport(entry, { ...options, now: START_2 + 5 * MIN + 1_000 }).asleepSince, LAST)
  // Within five minutes of the moved time (though 14 past the own one): not asleep yet, unknown.
  assert.equal(laneFromReport(entry, { ...options, now: START_2 + 4 * MIN }).state, 'unknown')
  // The app started after the report: asleep since the app's start, as before.
  assert.equal(laneFromReport({ ...entry, at: LAST, heardAt: undefined }, { ...options, appRuns: false, appStartedAt: at(0, 55, 7), now: at(0, 56) }).asleepSince, at(0, 55, 7))
})

test('F38 a carrier proves its mod lives by its report\'s own time, never by a kept report moved to the board\'s start', () => {
  const main = { name: 'Main', isRunning: true, state: 'free', appSession: 'local_Main', unjoined: null, report: { state: 'idle', at: START_2, heardAt: LAST, background: false } }
  assert.equal(canCarry(main, 'Worker 4', START_2 + 10_000), false, 'the moved report is 10 minutes old by its own time')
  assert.equal(canCarry({ ...main, report: { state: 'idle', at: START_2 + 5_000, background: false } }, 'Worker 4', START_2 + 10_000), true, 'its first ping after the start')
})
