// P2.1 (chat 3, 2026-11-27): one incident for one fact. The recorded case of 2026-11-25 13:25-14:13: every lane went interrupted and off
// (the app closing around the account switch), no hand claimed, no courier ran on the signed-in account yet (its task was made at 14:25),
// and the board launched Workers 5, 3 and 2 at 13:50-13:53, "the app did not start it" each time: five "could not wake" (X252-X256) and
// "nobody answers the board's wake-ups" (X257), as on 11-24 (X242-X249). Now ONE finding a day names the fact and the fix the person can do.

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildView } from '../../src/supervisor/view.mjs'
import { NOTHING_RUNS_DO, WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { COURIER_ALIVE_MS } from '../../src/wakeCarry.mjs'

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
const viewOf = ({ lanes = fiveLaunches, noHands = true, courierAt = null, now = NOW, check = null } = {}) => buildView({
  state: { chats: lanes, chatPrefix: '', check, wakes: {}, wakeBoardSince: null, wakeNoHands: noHands, wakeCourierAt: courierAt }, now,
})
const ctx = { seen: new Map(), observed: [] }

test('11-25 13:49-13:53: five launch-only failures while no hand runs and no courier called: ONE finding, naming the chats and the fix; the per-chat rule and "nobody answers" file nothing', () => {
  const view = viewOf()
  const found = rule('wake-nothing-runs').check(view, ctx)
  assert.equal(found.length, 1)
  assert.equal(found[0].key, 'wake-nothing-runs 2026-11-25')
  assert.equal(found[0].subject, 'board')
  assert.equal(found[0].text, `nothing runs that can wake a chat: no chat's hands run and the courier has not called on this account; Worker 1, Worker 5, Worker 3, Worker 4, Worker 2 wait. Do: ${NOTHING_RUNS_DO}`)
  assert.equal(NOTHING_RUNS_DO, 'open the Scheduled section in the Claude app and turn on the courier task of the signed-in account')
  assert.deepEqual(found[0].evidence.slice(0, 2), ['the courier has not called on this account', 'Worker 1: the app did not start it (launched 13:49)'])
  assert.deepEqual(rule('wake-failed').check(view, ctx), [])
  assert.deepEqual(rule('nobody-answers-wakes').check(view, ctx), [])
  // The same day, an hour later: the same key (counted, not filed again).
  assert.equal(rule('wake-nothing-runs').check(viewOf({ now: NOW + 60 * MIN }), ctx)[0].key, 'wake-nothing-runs 2026-11-25')
})

test('the courier called lately: nothing of this; the per-chat rule files as before (F59: the courier is the wake then)', () => {
  const view = viewOf({ courierAt: NOW - 10 * MIN })
  assert.deepEqual(rule('wake-nothing-runs').check(view, ctx), [])
  assert.equal(rule('wake-failed').check(view, ctx).length, 5)
  // Just inside the window still counts as alive; just outside not.
  assert.deepEqual(rule('wake-nothing-runs').check(viewOf({ courierAt: NOW - COURIER_ALIVE_MS }), ctx), [])
  const stale = rule('wake-nothing-runs').check(viewOf({ courierAt: NOW - COURIER_ALIVE_MS - 1000 }), ctx)
  assert.equal(stale.length, 1)
  assert.match(stale[0].text, /^nothing runs that can wake a chat: no chat's hands run and the courier last called 13:34; /)
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
  assert.match(rule('wake-nothing-runs').check(viewOf({ check: some }), ctx)[0].text, /; Worker 5, Worker 3, Worker 4, Worker 2 wait\./)
})

test('the rules table names it, between wake-failed and start-untaken', () => {
  const ids = WATCH_RULES.map(one => one.id)
  assert.equal(ids[ids.indexOf('wake-failed') + 1], 'wake-nothing-runs')
  assert.match(rule('wake-nothing-runs').says, /once a day, with the fix the person can do/)
})
