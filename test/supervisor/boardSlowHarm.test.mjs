// B1011 (Q645, the person's pick C): harm is the bar for a slow answer, not the 5 s the board aims at. A work call answered
// after 2 to 10 s is in the stall log and opens no finding; the rule board-slow sounds for calls answered after the chat's mod
// gave up (10 s) twice within 2 min, and cites the stall log. A clean-up that does not run has its own rule (clear-owed-repeat).

import assert from 'node:assert/strict'
import test from 'node:test'

import { hearingLog, LATE_CALL_MS } from '../../src/hearing.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { buildView } from '../../src/supervisor/view.mjs'

const NOW = Date.UTC(2026, 10, 4, 17, 30, 0)
const SECOND = 1000
const rule = WATCH_RULES.find(one => one.id === 'board-slow')
const stall = (ago, ms, jobs, requests = []) => ({ at: NOW - ago * SECOND, ms: ms * SECOND, kind: 'loop', requests, jobs })

/** What the board's hearing log makes of calls answered `took` seconds after their mod sent them (each `ago` seconds before now). */
function answered(calls) {
  const log = hearingLog({ startedAt: NOW - 60 * 60_000, quietMs: 10 * 60_000 })
  for (const [ago, took] of calls) {
    const at = NOW - ago * SECOND
    log.answered(`digger-id-${at - took * SECOND}-1`, at)
  }
  return log.view(NOW).lateCalls
}

const check = (calls, stalls) => rule.check(buildView({ state: { lateCalls: answered(calls), stalls }, items: new Map(), now: NOW }), { seen: new Map(), observed: [] })

test('a work call answered after 7.5 s and stalls of 2 to 10 s open no finding: the chat did not give up', () => {
  assert.equal(LATE_CALL_MS, 10_000)
  const tail = [stall(300, 2.1, ['state rebuild']), stall(240, 4.4, ['state rebuild', 'autopilot']), stall(120, 7.5, ['state rebuild', 'hand-over Worker 5'], ['work turn-ended by Worker 3']), stall(60, 9.9, ['state rebuild'])]
  assert.deepEqual(check([[120, 7.5], [100, 5.3], [80, 9.9], [60, 2.5]], tail), [])
})

test('one answer after the chat gave up is no finding; two within 2 min are, and cite the stall log', () => {
  const tail = [stall(200, 7.5, ['state rebuild'], ['work turn-ended by Worker 3']), stall(100, 11.2, ['state rebuild', 'hand-over Worker 5'], ['work turn-ended by Worker 3'])]
  assert.deepEqual(check([[100, 11.2]], tail), [])
  assert.deepEqual(check([[200, 11.5], [20, 11.2]], tail), [], 'the two are more than 2 min apart')
  const found = check([[110, 11.5], [100, 11.2]], tail)
  assert.deepEqual(found.map(one => one.key), ['board-slow board'])
  assert.match(found[0].text, /answered after the chat gave up/)
  assert.match(found[0].evidence, /stalls: .*7\.5 s the loop blocked.*11\.2 s the loop blocked \([^)]*jobs: state rebuild, hand-over Worker 5/)
})
