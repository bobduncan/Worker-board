// X107/X3 again (2026-11-02 15:12-15:14, Worker 2): its clear envelope failed ("a new prompt came in before the clear") and
// the next clear envelope ran; the failed one is no undelivered word: the sweep's judgement drops it once a later clear to the
// same chat was delivered. Made-up times and chats.

import assert from 'node:assert/strict'
import test from 'node:test'

import { whyClosed } from '../../src/work/outboxSweep.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 2, 15, 20).getTime()
const keep = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN }
const envelope = (id, minutesAgo, more = {}) => ({ id, at: NOW - minutesAgo * MIN, to: 'Worker 2', command: 'handover', about: 'Worker 2', kind: 'clear', step: null, clear: { step: 'B918', reportedAt: NOW - 20 * MIN }, restart: false, set: null, line: null, state: 'waiting', ...more })
const ctxOf = all => ({ all, items: new Map(), runs: new Map([['Worker 2', true]]), goals: [], now: NOW, keep, closing: new Map(), main: 'Main', prefix: '' })

test('a failed clear that a later envelope\'s clear finished is dropped as done; one whose later clear failed too, or that has none, stays as it was', () => {
  const failed = envelope('c1', 7, { state: 'failed', failedAt: NOW - 7 * MIN, settledAt: NOW - 7 * MIN, outcome: { cleared: false, set: null, typed: null, restarted: null, background: false, why: 'a new prompt came in before the clear' }, why: 'its clear did not run: a new prompt came in before the clear' })
  const ran = envelope('c2', 6, { state: 'delivered', deliveredAt: NOW - 6 * MIN, settledAt: NOW - 6 * MIN, outcome: { cleared: true, set: null, typed: null, restarted: null, background: false, why: null } })
  const judged = whyClosed(failed, ctxOf([failed, ran]))
  assert.equal(judged?.state, 'dropped')
  assert.match(judged.why, /^its clear ran with a later envelope \(/)
  // A later clear that failed too: the failed one is not done.
  const failedAgain = { ...ran, id: 'c3', state: 'failed', outcome: { ...ran.outcome, cleared: false } }
  assert.equal(whyClosed(failed, ctxOf([failed, failedAgain])), null)
  // A later clear of ANOTHER chat does not count; nor an earlier one.
  assert.equal(whyClosed(failed, ctxOf([failed, { ...ran, to: 'Worker 5' }])), null)
  assert.equal(whyClosed(failed, ctxOf([failed, { ...ran, at: NOW - 8 * MIN }])), null)
  // The delivered clear itself is left alone (a word without a task waits until late).
  assert.equal(whyClosed(ran, ctxOf([failed, ran])), null)
})
