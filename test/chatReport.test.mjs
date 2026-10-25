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
  assert.deepEqual(REPORT_STATES, ['busy', 'idle', 'asking'])
  assert.equal(REPORT_MOD, '0.19.0')
})

test('parseReport reads the mod\'s report, and nothing else', () => {
  assert.deepEqual(parseReport({ state: 'busy', since: 100 }, 200), { state: 'busy', since: 100, background: false })
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
  assert.deepEqual(laneFromReport(fresh('idle', { background: true }), facts()), { state: 'working', isRunning: true })
  // The app's record does not count while the reports come.
  assert.deepEqual(laneFromReport(fresh('busy'), facts({ appRuns: false })), { state: 'working', isRunning: true })
})

test('a report older than the setting is unknown, or off when the app says the chat does not run', () => {
  assert.deepEqual(laneFromReport(stale('busy'), facts({ appRuns: false })), { state: 'off', isRunning: false })
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
