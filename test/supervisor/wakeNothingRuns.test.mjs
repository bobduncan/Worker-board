// P2.1 (chat 3, 2026-11-27): one incident for one fact. The recorded case of 2026-11-25 13:25-14:13: every lane went interrupted and off
// (the app closing around the account switch), no hand claimed, no courier ran on the signed-in account yet (its task was made at 14:25),
// and the board launched Workers 5, 3 and 2 at 13:50-13:53, "the app did not start it" each time: five "could not wake" (X252-X256) and
// "nobody answers the board's wake-ups" (X257), as on 11-24 (X242-X249). Now ONE finding a day names the fact and the fix the person can do.

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildView } from '../../src/supervisor/view.mjs'
import { NOTHING_RUNS_DO, NOTHING_RUNS_GRACE_MS, WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { COURIER_ALIVE_MS } from '../../src/wakeCarry.mjs'
import { parseConfig } from '../../src/config.mjs'
import { emptyWakes } from '../../src/wake.mjs'
import { storeFromText } from '../../src/work/read.mjs'
import { buildState } from '../withStore.mjs'

const MIN = 60_000
const at = (h, m, s = 0) => new Date(2026, 10, 25, h, m, s).getTime()
const NOW = at(14, 0)
const NAMES = ['Worker 1', 'Worker 5', 'Worker 3', 'Worker 4', 'Worker 2']
const rule = id => WATCH_RULES.find(one => one.id === id)
const launchFailed = launchedAt => ({ path: 'launch', at: launchedAt, by: 'board', jobId: `launch:${launchedAt}`, sentAt: launchedAt, runBefore: null, verdict: 'failed', verdictAt: launchedAt + 3 * MIN, why: 'the app did not start it' })
const messageFailed = sentAt => ({ path: 'message', at: sentAt - 1000, by: 'Worker 1', jobId: 'm', sentAt, runBefore: null, verdict: 'failed', verdictAt: sentAt + 2 * MIN, why: 'no report within 2 minutes of the message' })
const courierFailed = sentAt => ({ ...messageFailed(sentAt), by: 'the courier', carry: 'courier' })
const lane = (name, attempts) => ({
  name, isLeftover: false, isMain: false, isRunning: false, state: 'off',
  wake: { state: 'failed', final: true, need: true, spell: at(13, 26), path: attempts.at(-1).path, at: attempts.at(-1).at, by: attempts.at(-1).by, why: attempts.at(-1).why, attempts },
})
const fiveLaunches = NAMES.map((name, index) => lane(name, [launchFailed(at(13, 49 + index))]))
/** The board started 40 minutes ago (beyond the grace), unless said otherwise. */
const viewOf = ({ lanes = fiveLaunches, noHands = true, courierAt = null, now = NOW, check = null, startedAt = NOW - 40 * MIN } = {}) => buildView({
  state: { chats: lanes, chatPrefix: '', check, wakes: {}, wakeBoardSince: null, wakeNoHands: noHands, wakeCourierAt: courierAt }, now, live: { startedAt },
})
const ctx = { seen: new Map(), observed: [] }

test('11-25 13:49-13:53: five launch-only failures while no hand runs and no courier called: ONE finding, naming the chats and the fix; the per-chat rule and "nobody answers" file nothing', () => {
  const view = viewOf()
  const found = rule('wake-nothing-runs').check(view, ctx)
  assert.equal(found.length, 1)
  assert.equal(found[0].key, 'wake-nothing-runs 2026-11-25')
  assert.equal(found[0].subject, 'board')
  // Chat 1's review 2a, 2d: the Do first (a title is cut at 300 characters), both causes named; 3: the evidence one line.
  assert.equal(found[0].text, `Do: ${NOTHING_RUNS_DO}. Nothing runs that can wake a chat: no chat's hands run and the courier has not called on this account; Worker 1, Worker 5, Worker 3, Worker 4, Worker 2 wait`)
  assert.equal(NOTHING_RUNS_DO, 'open the Claude app; if it is open, turn on the courier task of the signed-in account in the Scheduled section')
  assert.equal(typeof found[0].evidence, 'string')
  assert.ok(found[0].evidence.startsWith('the courier has not called on this account · Worker 1: the app did not start it (launched 13:49) · Worker 5: '), found[0].evidence)
  assert.deepEqual(rule('wake-failed').check(view, ctx), [])
  assert.deepEqual(rule('nobody-answers-wakes').check(view, ctx), [])
  // The same day, an hour later: the same key (counted, not filed again).
  assert.equal(rule('wake-nothing-runs').check(viewOf({ now: NOW + 60 * MIN }), ctx)[0].key, 'wake-nothing-runs 2026-11-25')
})

test('the courier called lately: nothing of this; the per-chat rule files as before (F59: the courier is the wake then)', () => {
  const view = viewOf({ courierAt: NOW - 10 * MIN })
  assert.deepEqual(rule('wake-nothing-runs').check(view, ctx), [])
  assert.equal(rule('wake-failed').check(view, ctx).length, 5)
  // Chat 1's review 2b: no finding on one snapshot: the courier must be silent for its window and the grace, by its own call time.
  assert.deepEqual(rule('wake-nothing-runs').check(viewOf({ courierAt: NOW - COURIER_ALIVE_MS }), ctx), [])
  assert.deepEqual(rule('wake-nothing-runs').check(viewOf({ courierAt: NOW - COURIER_ALIVE_MS - 1000 }), ctx), [], 'just outside the window: not yet')
  assert.deepEqual(rule('wake-nothing-runs').check(viewOf({ courierAt: NOW - NOTHING_RUNS_GRACE_MS + 1000 }), ctx), [], 'inside the grace: not yet')
  const stale = rule('wake-nothing-runs').check(viewOf({ courierAt: NOW - NOTHING_RUNS_GRACE_MS }), ctx)
  assert.equal(stale.length, 1)
  assert.match(stale[0].text, /\. Nothing runs that can wake a chat: no chat's hands run and the courier last called 13:25; /)
  assert.equal(NOTHING_RUNS_GRACE_MS, COURIER_ALIVE_MS + 10 * MIN)
  // A courier that never called this board: the board's own start is the clock, never a guess; a young board files nothing.
  assert.deepEqual(rule('wake-nothing-runs').check(viewOf({ startedAt: NOW - 10 * MIN }), ctx), [])
  assert.deepEqual(rule('wake-nothing-runs').check(viewOf({ startedAt: null }), ctx), [], 'no start known: nothing')
  assert.equal(rule('wake-nothing-runs').check(viewOf({ startedAt: NOW - NOTHING_RUNS_GRACE_MS }), ctx).length, 1)
  // Review b: the courier's last call was before the board went down: the quiet counts from the board's start, and the words give the day.
  const DAY = 24 * 60 * MIN
  assert.deepEqual(rule('wake-nothing-runs').check(viewOf({ courierAt: NOW - 2 * DAY, startedAt: NOW - 10 * MIN }), ctx), [], 'a young board files nothing on an old call')
  const old = rule('wake-nothing-runs').check(viewOf({ courierAt: NOW - 2 * DAY, startedAt: NOW - NOTHING_RUNS_GRACE_MS }), ctx)
  assert.equal(old.length, 1)
  assert.match(old[0].text, /the courier last called 2026-11-23 14:00; /)
})

test('a hand runs (no "no hands"), or no chat needs a wake: nothing of this', () => {
  assert.deepEqual(rule('wake-nothing-runs').check(viewOf({ noHands: false }), ctx), [])
  assert.deepEqual(rule('wake-nothing-runs').check(viewOf({ noHands: null }), ctx), [])
  const noNeed = fiveLaunches.map(one => ({ ...one, wake: { ...one.wake, need: false } }))
  assert.deepEqual(rule('wake-nothing-runs').check(viewOf({ lanes: noNeed }), ctx), [])
  // The courier's own carried word that failed is no hand's send: still the one fact.
  const carried = [lane('Worker 4', [courierFailed(at(13, 40)), launchFailed(at(13, 52))])]
  assert.equal(rule('wake-nothing-runs').check(viewOf({ lanes: carried }), ctx).length, 1)
  assert.deepEqual(rule('wake-failed').check(viewOf({ lanes: carried }), ctx), [])
  // Chat 1's review 2c: a chat that could not be reached at all (no attempt: no id) is no launch-only failure: its own finding stands.
  const unreachable = { ...lane('Worker 4', [launchFailed(at(13, 52))]), wake: { state: 'failed', final: true, need: true, spell: at(13, 26), path: null, at: null, by: null, why: 'no id', attempts: [] } }
  const both = viewOf({ lanes: [...fiveLaunches.slice(0, 2), unreachable] })
  assert.equal(rule('wake-nothing-runs').check(both, ctx).length, 1)
  assert.deepEqual(rule('wake-failed').check(both, ctx).map(one => one.subject), ['Worker 4'])
})

test('a chat whose wake failed on a hand\'s own message too is its own finding beside the one fact (its hands ran when it was sent)', () => {
  const lanes = [...fiveLaunches.slice(0, 2), lane('Worker 3', [messageFailed(at(13, 20)), launchFailed(at(13, 51))])]
  const view = viewOf({ lanes })
  assert.equal(rule('wake-nothing-runs').check(view, ctx).length, 1)
  assert.deepEqual(rule('wake-failed').check(view, ctx).map(one => one.subject), ['Worker 3'])
  assert.deepEqual(rule('nobody-answers-wakes').check(view, ctx), [])
})

test('the start-up check\'s own incident covers the chats it lists: they are not named here', () => {
  const check = { at: NOW - 1000, trigger: 'start', running: false, total: 5, reachable: 0, line: 'x', tone: 'attention', fixed: [], elsewhere: ['Worker 1', 'Worker 5', 'Worker 3', 'Worker 4', 'Worker 2'], restartNeeded: [], notJoined: [], nowhere: [], tooSlow: false }
  assert.deepEqual(rule('wake-nothing-runs').check(viewOf({ check }), ctx), [])
  const some = { ...check, elsewhere: ['Worker 1'] }
  assert.match(rule('wake-nothing-runs').check(viewOf({ check: some }), ctx)[0].text, /; Worker 5, Worker 3, Worker 4, Worker 2 wait$/)
})

test('the rules table names it, between wake-failed and start-untaken', () => {
  const ids = WATCH_RULES.map(one => one.id)
  assert.equal(ids[ids.indexOf('wake-failed') + 1], 'wake-nothing-runs')
  assert.match(rule('wake-nothing-runs').says, /once a day, with the fix the person can do/)
})

test('the wiring (chat 1\'s review 5): the record\'s courierAt reaches the state as wakeCourierAt and the Supervisor\'s view, and the rule judges by it', () => {
  const PROJECT = 'C:\\garden'
  const config = { ...parseConfig('{}', {}), project: PROJECT }
  const CLI = { Main: '0e928772-ccfd-4c85-874b-c3e9f4f866ea', 'Worker 4': '06e9b6da-78d4-4268-a9ec-e6904e9689a7' }
  const app = name => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name.replace(' ', '-')}`, cliSessionId: CLI[name], cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: NOW - 60 * MIN, lastAssistantUuid: 'u-1' })
  const build = courierAt => {
    const work = storeFromText('## Board\n', { now: NOW - 120 * MIN })
    const raw = {
      listText: '{"prefix":"Game - ","main":"Main"}', appChatTexts: Object.keys(CLI).map(app), tails: Object.fromEntries(Object.values(CLI).map(id => [id, { text: '', isCut: false, modifiedAt: NOW - 60 * MIN }])),
      planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: NOW - 120 * MIN,
    }
    // Worker 4's session ended 50 minutes ago (asleep); an answer word waits for it: a wake need. No hand claims; the courier as given.
    const reports = new Map([['Worker 4', { state: 'ended', since: NOW - 50 * MIN, background: false, at: NOW - 50 * MIN, run: 1, seq: 3, session: CLI['Worker 4'], mod: '0.33.0' }]])
    const outbox = [{ id: 'answer0000000001', at: NOW - 30 * MIN, to: 'Worker 4', ask: 'chat:Worker 4', text: 'Yes, go on.', state: 'waiting' }]
    return buildState(raw, { lines: [], outbox, runs: [], now: NOW, config, seen: { shown: {}, other: {} }, board: { startedAt: NOW - 100 * MIN, offSince: null }, reports, wakes: { record: emptyWakes(), senderClaims: false, handsClaim: false, noHands: true, canLaunch: true, courierAt } })
  }
  const live = { startedAt: NOW - 100 * MIN }
  const stale = build(NOW - NOTHING_RUNS_GRACE_MS)
  assert.equal(stale.wakeCourierAt, NOW - NOTHING_RUNS_GRACE_MS)
  assert.equal(stale.wakeNoHands, true)
  const view = buildView({ state: stale, items: new Map(), now: NOW, live })
  assert.equal(view.wakeCourierAt, NOW - NOTHING_RUNS_GRACE_MS)
  const found = rule('wake-nothing-runs').check(view, ctx)
  assert.equal(found.length, 1, JSON.stringify(stale.chats.map(one => [one.name, one.state, one.isRunning, one.wake?.need, one.wake?.state])))
  assert.match(found[0].text, /; Worker 4 wait$/)
  const fresh = build(NOW - 5 * MIN)
  assert.equal(buildView({ state: fresh, items: new Map(), now: NOW, live }).wakeCourierAt, NOW - 5 * MIN)
  assert.deepEqual(rule('wake-nothing-runs').check(buildView({ state: fresh, items: new Map(), now: NOW, live }), ctx), [])
  assert.equal(build(null).wakeCourierAt, null)
})
