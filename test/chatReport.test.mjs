// Redesign Part 1 (2026-10-24): a chat's Workers mod reports its own turn state (busy, idle, asking), and the board
// shows that report instead of guessing. The pure part: reading a report, and turning one into a lane's state.

import assert from 'node:assert/strict'
import test from 'node:test'

import { REPORT_MOD, REPORT_STATES, laneFromReport, modReports, parseReport } from '../src/chatReport.mjs'

const NOW = 1_000_000
const facts = (more = {}) => ({ now: NOW, unknownAfterMs: 30_000, holdsTask: false, hasBlockingAsk: false, appRuns: null, ...more })
const fresh = (state, more = {}) => ({ state, since: NOW - 60_000, background: false, at: NOW - 5_000, ...more })
const stale = (state, more = {}) => fresh(state, { at: NOW - 31_000, ...more })

test('the states and the first mod that reports', () => {
  assert.deepEqual(REPORT_STATES, ['busy', 'idle', 'asking', 'ended'])
  assert.equal(REPORT_MOD, '0.19.0')
})

test('parseReport reads the mod\'s report, and nothing else', () => {
  assert.deepEqual(parseReport({ state: 'busy', since: 100 }, 200), { state: 'busy', since: 100, background: false, run: null, seq: null })
  assert.deepEqual([parseReport({ state: 'idle', run: 7, seq: 3 }, 200).run, parseReport({ state: 'idle', run: 7, seq: 3 }, 200).seq], [7, 3])
  assert.deepEqual([parseReport({ state: 'idle', run: {}, seq: -1 }, 200).run, parseReport({ state: 'idle', seq: 1.5 }, 200).seq], [null, null])
  assert.equal(parseReport({ state: 'sleeping' }, 200), null)
  // A time after now, or none, is now.
  assert.equal(parseReport({ state: 'idle', since: 999 }, 200).since, 200)
  assert.equal(parseReport({ state: 'idle' }, 200).since, 200)
  assert.equal(parseReport({ state: 'idle', since: 'soon' }, 200).since, 200)
  assert.equal(parseReport({ state: 'idle', background: true }, 200).background, true)
  assert.equal(parseReport({ state: 'idle', background: 'yes' }, 200).background, false)
  for (const wrong of [null, undefined, 'busy', 7, [], { state: 'BUSY' }, { since: 100 }]) assert.equal(parseReport(wrong, 200), null)
})

test('a fresh report is the lane\'s state, and the chat runs', () => {
  assert.deepEqual(laneFromReport(fresh('busy'), facts()), { state: 'working', isRunning: true })
  assert.deepEqual(laneFromReport(fresh('asking'), facts()), { state: 'waiting', isRunning: true })
  assert.deepEqual(laneFromReport(fresh('idle'), facts()), { state: 'free', isRunning: true })
  // Review Focus 5: idle while it holds a task in progress is interrupted, never free; with a blocking ask, it waits.
  assert.deepEqual(laneFromReport(fresh('idle'), facts({ holdsTask: true })), { state: 'interrupted', isRunning: true })
  assert.deepEqual(laneFromReport(fresh('idle'), facts({ holdsTask: true, hasBlockingAsk: true })), { state: 'waiting', isRunning: true })
  // Background work (an agent, a shell) still runs after the turn: it works.
  assert.deepEqual(laneFromReport(fresh('idle', { background: true }), facts()), { state: 'working', isRunning: true, why: 'background' })
  // The app's record does not count while the reports come.
  assert.deepEqual(laneFromReport(fresh('busy'), facts({ appRuns: false })), { state: 'working', isRunning: true })
})

test('a report older than the setting is unknown, or asleep when the app says the chat does not run (T13 part 3, no longer off)', () => {
  assert.deepEqual(laneFromReport(stale('busy'), facts({ appRuns: false })), { state: 'interrupted', isRunning: false, asleep: true, asleepSince: NOW - 31_000 })
  assert.deepEqual(laneFromReport(stale('busy'), facts({ appRuns: false, appStartedAt: NOW - 20_000 })).asleepSince, NOW - 20_000)
  assert.deepEqual(laneFromReport(stale('busy'), facts({ appRuns: null })), { state: 'unknown', isRunning: null })
  assert.deepEqual(laneFromReport(stale('idle'), facts({ appRuns: true })), { state: 'unknown', isRunning: null })
  // Exactly at the setting it is still fresh.
  assert.equal(laneFromReport(fresh('busy', { at: NOW - 30_000 }), facts()).state, 'working')
})

test('no report: the caller keeps today\'s inference', () => {
  assert.equal(laneFromReport(null, facts()), null)
  assert.equal(laneFromReport(undefined, facts()), null)
})

test('modReports: a mod at least 0.19.0 reports', () => {
  assert.equal(modReports('0.19.0'), true)
  assert.equal(modReports('0.18.1'), false)
  assert.equal(modReports('0.20.0'), true)
  assert.equal(modReports('1.0.0'), true)
  assert.equal(modReports('0.19.10'), true)
  assert.equal(modReports(null), false)
  assert.equal(modReports('new'), false)
})

// The review of chat-reports (2026-10-25).
const later = (state, more = {}) => fresh(state, more)
const full = (more = {}) => facts({ offAfterMs: 5 * 60_000, waitsForPartner: false, isTaskReported: false, ...more })

test('review 2: idle with a blocking ask routed to the partner works between two turns, waiting for the partner; one on the person still waits', () => {
  assert.deepEqual(laneFromReport(later('idle'), full({ holdsTask: true, waitsForPartner: true })), { state: 'working', isRunning: true, why: 'partner' })
  assert.deepEqual(laneFromReport(later('idle'), full({ holdsTask: true, waitsForPartner: true, hasBlockingAsk: true })), { state: 'waiting', isRunning: true })
})

test('review 3: a session that ended is off at once; a report silent past offAfterMs is off; under it unknown', () => {
  assert.equal(REPORT_STATES.includes('ended'), true)
  assert.deepEqual(laneFromReport(later('ended'), full()), { state: 'off', isRunning: false, why: 'ended' })
  assert.deepEqual(laneFromReport(fresh('busy', { at: NOW - 5 * 60_000 - 1 }), full()), { state: 'off', isRunning: false, why: 'silent' })
  assert.deepEqual(laneFromReport(fresh('busy', { at: NOW - 4 * 60_000 }), full()), { state: 'unknown', isRunning: null })
  // T13 part 3: asleep, no longer off: after the app's start, and silent past offAfterMs after an idle report or busy on a task.
  assert.deepEqual(laneFromReport(stale('idle'), full({ appRuns: false })), { state: 'free', isRunning: false, asleep: true, asleepSince: NOW - 31_000 })
  assert.deepEqual(laneFromReport(fresh('idle', { at: NOW - 5 * 60_000 - 1 }), full()), { state: 'free', isRunning: false, asleep: true, asleepSince: NOW - 5 * 60_000 - 1 })
  assert.equal(laneFromReport(fresh('busy', { at: NOW - 5 * 60_000 - 1 }), full({ holdsTask: true })).state, 'interrupted')
  assert.deepEqual(laneFromReport(fresh('asking', { at: NOW - 5 * 60_000 - 1 }), full()), { state: 'off', isRunning: false, why: 'silent' })
})

test('review 5b: background work does not hold a chat whose task is reported (B148)', () => {
  assert.deepEqual(laneFromReport(later('idle', { background: true }), full({ isTaskReported: true })), { state: 'free', isRunning: true })
  assert.deepEqual(laneFromReport(later('idle', { background: true }), full()), { state: 'working', isRunning: true, why: 'background' })
})
