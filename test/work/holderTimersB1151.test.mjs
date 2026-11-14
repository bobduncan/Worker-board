// F26 (chat 1, 2026-11-14): the board gave B1151 back from Worker 2 at 13:00 ("did not resume it (asked 10:16)") although Worker 2
// worked on it turn after turn from 10:16 to 13:03. Its go-ons of 09:33 and 10:16 had spent GO_ON_MOST; after that only a busy spell
// over 2 minutes (or a checkpoint) restarts the 15 minutes, and the spell was read from the transcript's last typed turn only: every
// turn after 10:17 began with the chat's own background work (a task finished, a helper handed back), so none counted. The real
// History, checkpoint and turn times of B1151 and Worker 2 (data/history.jsonl, the step's file, Worker 2's transcript).

import assert from 'node:assert/strict'
import test from 'node:test'

import { holderTimers, resumeMarker } from '../../src/work/holderTimers.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { checkpointLine } from '../../src/work/pause.mjs'

const MIN = 60_000
const t = (h, m, s = 0) => new Date(2026, 10, 14, h, m, s).getTime()
const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)), problem: null })
const B1151 = item({
  Id: 'B1151', Kind: 'step', Title: 'Redraw the Skeleton Warrior to the Knight\'s sheet, with its demo', State: 'in progress', Owner: 'Worker 2', Since: stamp(t(9, 6)),
  Branch: 'b1151-skeleton-warrior', Checkpoint: checkpointLine({ commit: 'e14ee5f6', next: 'Atlas and clips committed', now: t(10, 10, 58) }),
}, {
  History: [
    `- ${stamp(t(9, 6))} Worker 2: queued → taken`,
    `- ${stamp(t(9, 6))} Worker 2: taken → in progress`,
    `- ${stamp(t(9, 11))} Worker 2: checkpoint 5a3aa994 · Waiting for sheets`,
    `- ${stamp(t(9, 33))} server: the board asked Worker 2 to go on (stopped since 09:28)`,
    `- ${stamp(t(10, 10))} Worker 2: checkpoint e14ee5f6 · Atlas and clips committed`,
    `- ${stamp(t(10, 16))} server: the board asked Worker 2 to go on (stopped since 10:11)`,
  ],
})
/** The two resume envelopes of the go-ons. */
const envelopes = [
  { id: 'e1', kind: 'resume', resume: resumeMarker('B1151', t(9, 28)), at: t(9, 33, 5), state: 'delivered' },
  { id: 'e2', kind: 'resume', resume: resumeMarker('B1151', t(10, 11)), at: t(10, 16, 5), state: 'delivered' },
]
/** Worker 2 at 13:00:52: its turn of 12:54:43 (a task-notification began it) ended at 13:00:50; the transcript's typed turn is out of the tail. */
const worker2 = (report = {}) => ({
  name: 'Worker 2', isMain: false, isLeftover: false, isRunning: true, state: 'interrupted', turnAt: null,
  report: { state: 'idle', since: t(13, 0, 50), background: false, at: t(13, 0, 52), turn: t(12, 54, 43), busyAt: t(12, 54, 43), ...report },
})
const decideAt = (now, worker) => holderTimers({ worker, holding: B1151, items: new Map([['B1151', B1151]]), envelopes, runningMs: from => now - from })

test('F26, the real case: Worker 2 worked six minutes in a turn its own background work began: B1151 is not given back at 13:00', () => {
  const now = t(13, 0, 52)
  assert.equal(decideAt(now, worker2()).giveBack, null)
  // The 15 minutes count from that turn's end: given back only if it stays stopped until 13:15:50.
  assert.equal(decideAt(t(13, 15, 40), { ...worker2(), report: { ...worker2().report, at: t(13, 15, 40) } }).giveBack, null)
  assert.deepEqual(decideAt(t(13, 15, 51), { ...worker2(), report: { ...worker2().report, at: t(13, 15, 51) } }).giveBack, { step: 'B1151', chat: 'Worker 2', askedAt: t(10, 16, 5) })
})

test('F26: the board\'s receipt of the turn start alone (a mod that sends no `turn`) counts too; a one-minute turn does not', () => {
  const now = t(13, 0, 52)
  assert.equal(decideAt(now, worker2({ turn: undefined })).giveBack, null)
  // And the mod's own turn start alone (the board's receipt lost, say after its restart).
  assert.equal(decideAt(now, worker2({ busyAt: undefined })).giveBack, null)
  // A short turn (under LONG_BUSY_MS) after the last go-on starts nothing anew: the give-back still goes, once the holder has been stopped
  // for a minute (F26, chat 1's design: never in the seconds between a turn's end and a hand-back turn).
  assert.equal(decideAt(now, worker2({ turn: t(12, 59, 50), busyAt: t(12, 59, 50) })).giveBack, null, 'stopped 2 s ago: not yet')
  const later = t(13, 1, 51)
  assert.notEqual(decideAt(later, worker2({ turn: t(12, 59, 50), busyAt: t(12, 59, 50), at: later })).giveBack, null)
  // No turn at all after the go-on: given back, as before.
  assert.notEqual(decideAt(later, worker2({ turn: undefined, busyAt: undefined, at: later })).giveBack, null)
})

test('F26 (chat 1): a turn still running (its report busy, no end yet) counts from its start: not given back while it works', () => {
  const now = t(13, 0, 52)
  // The report says busy since 12:54:43 (its turn), heard at 13:00:52; the lane read interrupted for a moment.
  assert.equal(decideAt(now, worker2({ state: 'busy', since: t(12, 54, 43), at: now })).giveBack, null)
  // Its start as the turn alone (the report's since from before the go-on).
  assert.equal(decideAt(now, worker2({ state: 'busy', since: t(10, 0), at: now })).giveBack, null)
  // A busy report begun a minute ago only, under LONG_BUSY_MS: the give-back goes once that report is a minute old (F26: the holder
  // stopped for a minute), not while it was just heard.
  assert.equal(decideAt(now, worker2({ state: 'busy', since: t(12, 59, 52), turn: t(12, 59, 52), busyAt: t(12, 59, 52), at: now })).giveBack, null)
  assert.notEqual(decideAt(t(13, 1, 55), worker2({ state: 'busy', since: t(12, 59, 52), turn: t(12, 59, 52), busyAt: t(12, 59, 52), at: now })).giveBack, null)
})
