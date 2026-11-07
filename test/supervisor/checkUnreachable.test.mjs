// The start-up check and the Supervisor (2026-11-05, plan task 6): ONE incident per cause, naming the chats the last check could
// not reach, instead of one "could not wake" per chat; the per-chat wake rules stand down for a chat the newest check lists
// under a cause; the incident goes when the cause is gone (the finding is absent). The evening's real case: Workers 1 and 5 in
// the other account, Worker 2 to restart, Worker 3 a genuine wake failure.

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildView } from '../../src/supervisor/view.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'

const NOW = new Date(2026, 10, 5, 21, 30).getTime()
const failedWake = { state: 'failed', final: true, need: true, spell: 1, path: 'message', at: NOW - 60_000, by: 'Main', why: 'x', attempts: [{ path: 'message', at: NOW - 70_000, by: 'Main', verdict: 'failed', verdictAt: NOW - 60_000, why: 'no report', sentAt: NOW - 69_000 }] }
const lane = (name, extra = {}) => ({ name, isLeftover: false, isMain: false, isRunning: false, state: 'off', wake: failedWake, ...extra })
const check = (extra = {}) => ({ at: NOW - 1000, trigger: 'start', running: false, total: 4, reachable: 1, line: 'x', tone: 'attention', fixed: [], elsewhere: [], restartNeeded: [], nowhere: [], tooSlow: false, ...extra })
const viewOf = (checkNow, lanes = [lane('Worker 1'), lane('Worker 5'), lane('Worker 2'), lane('Worker 3')]) => buildView({
  state: { chats: lanes, chatPrefix: 'Team - ', check: checkNow, wakes: {}, wakeBoardSince: null }, now: NOW,
})
const rule = id => WATCH_RULES.find(one => one.id === id)

test('one incident per cause, naming the chats: two chats in the other account are ONE finding, not one per chat', () => {
  const view = viewOf(check({ elsewhere: ['Worker 1', 'Worker 5'], restartNeeded: ['Worker 2'] }))
  const found = rule('check-unreachable').check(view, {})
  assert.deepEqual(found.map(one => one.key).sort(), ['check-unreachable account-switch', 'check-unreachable restart-needed'])
  const account = found.find(one => one.key === 'check-unreachable account-switch')
  assert.equal(account.subject, 'board')
  assert.equal(account.text, 'your chats are in your other Claude account: run /reimport-chats, then restart the app: Worker 1, Worker 5')
  assert.match(found.find(one => one.key === 'check-unreachable restart-needed').text, /^restart the app so it reads the reimported chats: Worker 2$/)
})

test('the per-chat wake rule stands down for the chats the newest check lists, and still files the others; nobody-answers-wakes too', () => {
  const view = viewOf(check({ elsewhere: ['Worker 1', 'Worker 5'], restartNeeded: ['Worker 2'] }))
  assert.deepEqual(rule('wake-failed').check(view, {}).map(one => one.subject), ['Worker 3'], 'only the genuine one')
  const all = viewOf(check({ elsewhere: ['Worker 1', 'Worker 5', 'Worker 2', 'Worker 3'] }))
  assert.deepEqual(rule('wake-failed').check(all, {}), [])
  // Without a check, or with one that read too slowly, the per-chat rule files as before.
  for (const none of [null, check({ tooSlow: true, elsewhere: ['Worker 1'] })]) {
    assert.equal(rule('wake-failed').check(viewOf(none), {}).length, 4, JSON.stringify(none))
    assert.deepEqual(rule('check-unreachable').check(viewOf(none), {}), [])
  }
  // Review 2 (4): while a check runs, the last finished result still stands (the runner's view keeps its lists): no filing in those seconds.
  const running = viewOf(check({ running: true, elsewhere: ['Worker 1'] }))
  assert.equal(rule('wake-failed').check(running, {}).length, 3)
  assert.deepEqual(rule('check-unreachable').check(running, {}).map(one => one.key), ['check-unreachable account-switch'])
})

test('the cause is gone: the next check lists nobody and the finding is absent (the gone clock closes the incident); a slow read files nothing', () => {
  assert.deepEqual(rule('check-unreachable').check(viewOf(check()), {}), [])
  assert.deepEqual(rule('check-unreachable').check(viewOf(check({ tooSlow: true })), {}), [])
})

test('no close/re-file loop: the cause\'s key is the same every run (the board counts it), and a check that lists a chat under no cause files nothing', () => {
  const a = rule('check-unreachable').check(viewOf(check({ nowhere: ['Worker 3'] })), {})
  const b = rule('check-unreachable').check(viewOf(check({ nowhere: ['Worker 3'], at: NOW })), {})
  assert.deepEqual(a.map(one => one.key), ['check-unreachable no-chat'])
  assert.deepEqual(b.map(one => one.key), a.map(one => one.key))
})

test('nobody-answers-wakes: not filed while the check names every chat that could not be woken; filed as before without it', () => {
  const lanes = [lane('Worker 1'), lane('Worker 5')]
  const boardWake = { state: 'failed', spell: 5, attempts: [{ path: 'launch', at: NOW - 120_000, by: 'board', verdict: 'failed', verdictAt: NOW - 60_000, why: 'the app did not start it', sentAt: NOW - 119_000 }] }
  const viewWith = checkNow => buildView({ state: { chats: lanes, chatPrefix: 'Team - ', check: checkNow, wakes: { '*': boardWake }, wakeBoardSince: 5 }, now: NOW })
  assert.equal(rule('nobody-answers-wakes').check(viewWith(null), {}).length, 1, 'the rule files without the check')
  assert.deepEqual(rule('nobody-answers-wakes').check(viewWith(check({ elsewhere: ['Worker 1', 'Worker 5'] })), {}), [])
})
