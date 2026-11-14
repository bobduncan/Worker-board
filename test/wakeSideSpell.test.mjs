// F27 (chat 1, 2026-11-14; found by Worker 4, B1174): the side lanes (Supervisor, Advisor, helper, Product owner) carried no report, so
// wake.mjs spellOf gave a side lane that read off with no asleepSince the spell 0. The live data/wakes.json has held the Supervisor's
// spell 0 since 2026-11-05 with its tries spent: the board reused it, nextPath gave null, and from 00:14 to 12:43 today it never tried to
// wake the Supervisor (and X157, "wake-failed Supervisor 0", came back stale 213 times). A side lane gets a real spell now: its
// session-checked report, else its kept report (the workers' rule, B986), else its off time; a spent spell 0 that is not the newest is revived once. The
// board-level cases are chat 1's review probe (buildState over a made-up project).

import assert from 'node:assert/strict'
import test from 'node:test'

import { parseConfig } from '../src/config.mjs'
import { buildState } from '../src/state.mjs'
import { claim, newSpell, nextPath, pass, spellOf, textOfWakes, wakeOf, wakesOfFile } from '../src/wake.mjs'
import { storeFromText } from '../src/work/read.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 14, 12, 0).getTime()
const SIDES = ['advisor', 'advisorHelper', 'supervisorChat', 'productOwner']
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

/** The board over a made-up project at 12:00: every side chat and Worker 1 last reported 40 min ago (`state`), on `session`. */
function boardState({ state = 'busy', otherSession = false } = {}) {
  const id = name => name.replace(' ', '')
  const app = name => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${id(name)}`, cliSessionId: `cli-${id(name)}`, cwd: 'C:\\game', isArchived: false, createdAt: 1, lastActivityAt: NOW - 50 * MIN, lastAssistantUuid: 'u-1' })
  const report = name => ({ state, since: NOW - 40 * MIN, background: false, run: 1, seq: 4, at: NOW - 40 * MIN + 500, session: otherSession ? `cli-other-${id(name)}` : `cli-${id(name)}`, mod: '0.32.0', busyAt: null })
  const reports = new Map(['Advisor', 'Supervisor', 'Advisor 2', 'Product owner', 'Worker 1'].map(name => [name, report(name)]))
  const work = storeFromText('## Garden\n- [ ] B12 Plant the hedge\n', { now: NOW - 60 * MIN })
  const raw = { listText: '{"prefix":"Game - ","main":"Main","supervisor":"Supervisor","owner":"Product owner","helper":"Advisor 2"}', appChatTexts: ['Main', 'Worker 1', 'Advisor', 'Supervisor', 'Advisor 2', 'Product owner'].map(app), tails: {}, planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work }
  return buildState(raw, { lines: [], outbox: [], runs: [], board: { startedAt: NOW - 60 * MIN, offSince: null }, seen: { shown: { Main: NOW - 1000 }, other: {} }, now: NOW, config: { ...parseConfig('{}', {}), project: 'C:\\game' }, reports })
}

test('F27, review 1, 3: a silent busy or asking side chat, the Advisor among them, gets its report\'s time as its spell, never 0', () => {
  for (const kind of ['busy', 'asking']) {
    const state = boardState({ state: kind })
    for (const side of SIDES) {
      assert.equal(state[side].isRunning, false, `${kind} ${side} reads not running`)
      assert.equal(spellOf(state[side]), NOW - 40 * MIN + 500, `${kind} ${side}`)
    }
  }
})

test('F27, review 2, 4: a side chat whose kept report names another session (a reimport, a clear) gets a spell from that kept report, not 0', () => {
  const state = boardState({ state: 'ended', otherSession: true })
  for (const side of SIDES) assert.equal(spellOf(state[side]), NOW - 40 * MIN, side)
  // As a worker in the same case does (B986).
  assert.equal(spellOf(state.chats.find(lane => lane.name === 'Worker 1')), NOW - 40 * MIN)
})

test('F27: with no report at all, a side lane\'s off time is its spell', () => {
  assert.equal(spellOf({ name: 'Supervisor', isRunning: false, state: 'off', ownReport: null, offSince: NOW - 20 * MIN }), NOW - 20 * MIN)
})

test('F27, the live case: with the spent spell 0 of 2026-11-05 in the record, the Supervisor\'s new spell gets a message try; spell 0 again is re-opened once', () => {
  const record = wakesOfFile(SPENT_ZERO)
  const spell = spellOf(boardState({ state: 'busy' }).supervisorChat)
  assert.notEqual(spell, 0)
  assert.equal(nextPath(record, { chat: 'Supervisor', spell, senderClaims: true, paths: ['message', 'launch'] }), 'message')
  assert.equal(wakeOf(record, { chat: 'Supervisor', spell, paths: ['message', 'launch'] }, { senderClaims: true }).final, false)
  // The real spell becomes the newest entry; if the lane reads spell 0 again, the spent 0 is re-opened once, never a dead end.
  newSpell(record, 'Supervisor', spell, NOW)
  assert.equal(nextPath(record, { chat: 'Supervisor', spell: 0, senderClaims: true, paths: ['message', 'launch'] }), null, 'before it is the newest')
  assert.equal(newSpell(record, 'Supervisor', 0, NOW + MIN), true)
  assert.equal(nextPath(record, { chat: 'Supervisor', spell: 0, senderClaims: true, paths: ['message', 'launch'] }), 'message')
  // Chat 1's re-check 1: a try claimed at the pass's older `now` (30 ms before the revival's stamp) counts: no second launch beside it.
  claim(record, { chat: 'Supervisor', spell: 0, path: 'launch', by: 'board', jobId: 'l1', now: NOW + MIN - 30, paths: ['message', 'launch'] })
  assert.equal(nextPath(record, { chat: 'Supervisor', spell: 0, senderClaims: false, paths: ['launch'] }), null, 'its launch is pending')
  // Re-check 2: the revival leaves G1's mark alone (the start-up check's one wake-again).
  assert.equal(record.wakes.get('Supervisor').at(-1).reopenedAt, undefined)
  // Once, also across a restart: spent again later, it is not revived a second time.
  const reloaded = wakesOfFile(JSON.parse(textOfWakes(record)))
  pass(reloaded, NOW + 30 * MIN)
  newSpell(reloaded, 'Supervisor', spell + 1, NOW + 31 * MIN)
  assert.equal(newSpell(reloaded, 'Supervisor', 0, NOW + 32 * MIN), false)
})
