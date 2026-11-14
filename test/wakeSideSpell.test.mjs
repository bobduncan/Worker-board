// F27 (chat 1, 2026-11-14; found by Worker 4, B1174): the side lanes (Supervisor, Advisor, helper, Product owner) carried no report, so
// wake.mjs spellOf gave a side lane that read off with no asleepSince the spell 0. The live data/wakes.json has held the Supervisor's
// spell 0 since 2026-11-05 with its tries spent: the board reused it, nextPath gave null, and from 00:14 to 12:43 today it never tried to
// wake the Supervisor (and X157, "wake-failed Supervisor 0", came back stale 213 times). A side lane gets a real spell now.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { nextPath, spellOf, wakeOf, wakesOfFile } from '../src/wake.mjs'

const MIN = 60_000
const t = (h, m) => new Date(2026, 10, 14, h, m).getTime()
/** The live spent spell 0 of the Supervisor (data/wakes.json, 2026-11-05): a message and a launch, both failed. */
const SPENT_ZERO = {
  wakes: {
    Supervisor: [{
      spell: 0, turnEndedAt: null, told: { failed: true, nobody: false },
      attempts: [
        { path: 'message', at: 1793907070759, by: 'Main', jobId: 'wake:0:Supervisor', sentAt: 1793907088668, runBefore: 1793831678075, verdict: 'failed', verdictAt: 1793907252020, why: 'no report within 2 minutes of the message', step: null },
        { path: 'launch', at: 1793907252020, by: 'board', jobId: 'launch:1793907252020:Supervisor', sentAt: 1793907260000, runBefore: null, verdict: 'failed', verdictAt: 1793907380000, why: 'the app did not start it', step: null },
      ],
    }],
  },
}
/** The Supervisor's side lane as the state now gives it: off, no asleepSince, its kept report (it ended its session at 00:14). */
const supervisor = more => ({ name: 'Supervisor', isLeftover: false, isRunning: false, state: 'off', appSession: 'local_supervisor', session: '11111111-2222-3333-4444-555555555555', asleepSince: null, sleepSince: null, ownReport: { state: 'idle', since: t(0, 10), at: t(0, 14), run: 7 }, offSince: null, ...more })

test('F27: a side lane off with no asleepSince gets a real spell from its kept report, never 0', () => {
  assert.equal(spellOf(supervisor()), t(0, 14))
  assert.equal(spellOf(supervisor({ ownReport: { state: 'ended', since: t(0, 12), at: t(0, 14), run: 7 } })), t(0, 12), 'an ended session: its since')
  assert.equal(spellOf(supervisor({ ownReport: null, offSince: t(0, 20) })), t(0, 20), 'no kept report: when it went off')
})

test('F27, the live case: with the spent spell 0 in the record, the Supervisor\'s new spell gets a message try again', () => {
  const record = wakesOfFile(SPENT_ZERO)
  const lane = supervisor()
  const spell = spellOf(lane)
  assert.notEqual(spell, 0)
  assert.equal(nextPath(record, { chat: 'Supervisor', spell, senderClaims: true, paths: ['message', 'launch'] }), 'message')
  assert.equal(wakeOf(record, { chat: 'Supervisor', spell, paths: ['message', 'launch'] }, { senderClaims: true }).final, false)
  // The old spent spell 0 was the dead end: nothing more to try.
  assert.equal(nextPath(record, { chat: 'Supervisor', spell: 0, senderClaims: true, paths: ['message', 'launch'] }), null)
})

test('F27: the state gives every side lane its kept report and its off time, for its spell', async () => {
  const state = await readFile(new URL('../src/state.mjs', import.meta.url), 'utf8')
  for (const side of ['supervisorChat', 'advisorHelper', 'productOwner']) {
    const at = state.indexOf(`    ${side}: `)
    assert.ok(at > 0, side)
    const block = state.slice(at, state.indexOf('\n    },', at))
    assert.match(block, /ownReport: spellReportOf\(/, `${side} carries ownReport`)
    assert.match(block, /offSince: /, `${side} carries offSince`)
  }
})
