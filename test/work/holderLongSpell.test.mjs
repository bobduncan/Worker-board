// F26 (B1151, 2026-11-14), chat 1's design after its review of chat 4's fix (.claude/plans/2026-11-14-f26-review.md): the board keeps
// the chat's WORK SPELL on its report entry (bridge.mjs `spellOf`): when it left rest (`workFrom`: busy, or idle with background work) and
// the end of its last spell over LONG_BUSY_MS (`longEndAt`), persisted in data/reports.json and passed to the lane; the timers
// (holderTimers.mjs `busySpellAfter`) take the latest of the last turn's spell and that end, so chained short turns and the background
// work between them count as one spell and a short last turn never wipes a long one. A give-back needs the holder stopped a minute, and
// never comes while the lane is only 'unknown' over a busy or background report. An 'ended' report measures to the turn's own end. The
// real timeline of Worker 2 on B1151 (its transcript bd6db5b7, the review's turn times) and the review's short-last-turn case, with mutants.

import assert from 'node:assert/strict'
import test from 'node:test'

import { noteReport } from '../../src/bridge.mjs'
import { savedEntry } from '../../src/reportsKept.mjs'
import { LONG_BUSY_MS, REST_MIN_MS, holderTimers, resumeMarker } from '../../src/work/holderTimers.mjs'
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
    `- ${stamp(t(9, 33))} server: the board asked Worker 2 to go on (stopped since 09:28)`,
    `- ${stamp(t(10, 10))} Worker 2: checkpoint e14ee5f6 · Atlas and clips committed`,
    `- ${stamp(t(10, 16))} server: the board asked Worker 2 to go on (stopped since 10:11)`,
  ],
})
const envelopes = [
  { id: 'e1', kind: 'resume', resume: resumeMarker('B1151', t(9, 28)), at: t(9, 33, 5), state: 'delivered' },
  { id: 'e2', kind: 'resume', resume: resumeMarker('B1151', t(10, 11)), at: t(10, 16, 5), state: 'delivered' },
]
const checked = { ok: true, chat: 'Worker 2' }
/** A report of Worker 2's session as the mod sends it. */
const said = (state, since, more = {}) => ({ chat: 'Worker 2', session: 's-w2', mod: '0.32.0', report: { state, since, run: 1, ...more } })
/** The lane as state.mjs hands it to the timers: the kept entry's fields, the lane state given. */
const laneOf = (entry, state = 'interrupted') => ({
  name: 'Worker 2', isMain: false, isLeftover: false, isRunning: state !== 'off', state, turnAt: null,
  report: { state: entry.state, since: entry.since, background: entry.background, at: entry.at, ...pick(entry, ['turn', 'busyAt', 'workFrom', 'longEndAt', 'restAt', 'heardAt']) },
})
const pick = (entry, keys) => Object.fromEntries(keys.filter(key => Number.isFinite(entry[key])).map(key => [key, entry[key]]))
const decideAt = (now, worker) => holderTimers({ worker, holding: B1151, items: new Map([['B1151', B1151]]), envelopes, runningMs: from => now - from })

/** Worker 2's day on B1151 as the board heard it: the go-on's typed turn, background work, the turns it began, rest at 13:00:52. */
function worker2Day(reports = new Map()) {
  const note = (body, now) => noteReport(reports, body, checked, now)
  note(said('idle', t(10, 11), { background: false }), t(10, 11, 2))          // at rest since 10:11 (the go-on of 10:16 follows)
  note(said('busy', t(10, 16, 40), { turn: t(10, 16, 40) }), t(10, 16, 41))    // the go-on's typed turn
  note(said('idle', t(10, 17, 30), { background: true }), t(10, 17, 31))      // its turn ended; monitors and helpers run on
  note(said('busy', t(11, 20, 38), { turn: t(11, 20, 38) }), t(11, 20, 39))    // a notification turn, 86 s
  note(said('idle', t(11, 22, 4), { background: true }), t(11, 22, 5))
  note(said('busy', t(12, 36, 36), { turn: t(12, 36, 36) }), t(12, 36, 37))    // 40 s
  note(said('idle', t(12, 37, 16), { background: true }), t(12, 37, 17))
  note(said('busy', t(12, 54, 43), { turn: t(12, 54, 43) }), t(12, 54, 44))    // the six-minute turn
  note(said('idle', t(13, 0, 50), { background: false }), t(13, 0, 52))        // nothing left running: REST, for a few seconds
  return reports
}

test('the work spell: leaving rest starts it, background time belongs to it, coming to rest after over 2 minutes leaves longEndAt; a short spell leaves the earlier end', () => {
  const reports = worker2Day()
  const kept = reports.get('Worker 2')
  // One spell from the typed turn of 10:16:40 (the busy report's own since, F26b) to the rest of 13:00:50: long. The start rides on the
  // resting entry (a short rest may go on with it).
  assert.deepEqual([kept.state, kept.background, kept.workFrom, kept.longEndAt, kept.restAt], ['idle', false, t(10, 16, 40), t(13, 0, 50), t(13, 0, 52)])
  // The hand-back turns of 13:00:57 (1:42) and 13:02:43 (35 s) come after rests of seconds: shorter than REST_MIN_MS, so the spell goes
  // on from 10:16:40 (F26b (c)), and each rest moves the long end.
  const note = (body, now) => noteReport(reports, body, checked, now)
  note(said('busy', t(13, 0, 57), { turn: t(13, 0, 57) }), t(13, 0, 58))
  assert.deepEqual([reports.get('Worker 2').workFrom, reports.get('Worker 2').longEndAt], [t(10, 16, 40), t(13, 0, 50)])
  note(said('idle', t(13, 2, 39), { background: false }), t(13, 2, 40))
  assert.equal(reports.get('Worker 2').longEndAt, t(13, 2, 39))
  note(said('busy', t(13, 2, 43), { turn: t(13, 2, 43) }), t(13, 2, 44))
  note(said('idle', t(13, 3, 18), { background: false }), t(13, 3, 19))
  assert.deepEqual([reports.get('Worker 2').workFrom, reports.get('Worker 2').longEndAt], [t(10, 16, 40), t(13, 3, 18)])
  // A rest of a full minute ends the spell: the next turn begins a new one at its own since; a short one (40 s) after that leaves nothing long.
  note(said('busy', t(13, 5, 0), { turn: t(13, 5, 0) }), t(13, 5, 1))
  assert.deepEqual([reports.get('Worker 2').workFrom, reports.get('Worker 2').longEndAt], [t(13, 5, 0), t(13, 3, 18)])
  note(said('idle', t(13, 5, 40), { background: false }), t(13, 5, 41))
  assert.equal(reports.get('Worker 2').longEndAt, t(13, 3, 18))
  // An asking report in a spell carries it; a session's end closes it (a long one leaves its end).
  const asking = new Map()
  const ask = (body, now) => noteReport(asking, body, checked, now)
  ask(said('busy', t(14, 0), { turn: t(14, 0) }), t(14, 0, 1))
  ask(said('asking', t(14, 1)), t(14, 1, 1))
  assert.equal(asking.get('Worker 2').workFrom, t(14, 0))
  // An asking report from rest begins a spell too (F26b (a)).
  const asks = new Map()
  noteReport(asks, said('idle', t(14, 0), { background: false }), checked, t(14, 0, 1))
  noteReport(asks, said('asking', t(14, 2)), checked, t(14, 2, 1))
  assert.equal(asks.get('Worker 2').workFrom, t(14, 2))
  ask(said('ended', t(14, 5)), t(14, 5, 1))
  assert.deepEqual([asking.get('Worker 2').longEndAt, 'workFrom' in asking.get('Worker 2')], [t(14, 5), false])
  // Another session starts afresh.
  ask({ ...said('busy', t(14, 10), { turn: t(14, 10) }), session: 's-new' }, t(14, 10, 1))
  assert.deepEqual([asking.get('Worker 2').workFrom, asking.get('Worker 2').longEndAt], [t(14, 10), undefined])
  assert.equal(LONG_BUSY_MS, 2 * MIN)
})

test('data/reports.json keeps workFrom and longEndAt (never one from the future)', () => {
  const entry = { ...worker2Day().get('Worker 2') }
  const saved = savedEntry(entry, t(13, 1))
  assert.deepEqual([saved.longEndAt, saved.restAt, saved.workFrom], [t(13, 0, 50), t(13, 0, 52), t(10, 16, 40)])
  const busy = savedEntry({ ...entry, state: 'busy', workFrom: t(12, 54, 44) }, t(13, 1))
  assert.equal(busy.workFrom, t(12, 54, 44))
  assert.equal('longEndAt' in savedEntry({ ...entry, longEndAt: t(13, 2) }, t(13, 1)), false, 'a future end is dropped')
})

test('the real case, the whole day: B1151 is not given back at 13:00, nor after the short hand-back turns of 13:00:57 and 13:02:43; it goes back at 13:15:51 if the chat stays stopped', () => {
  const reports = worker2Day()
  const note = (body, now) => noteReport(reports, body, checked, now)
  // 13:00:52: rest for a few seconds (the old board gave B1151 back here).
  assert.equal(decideAt(t(13, 0, 52), laneOf(reports.get('Worker 2'))).giveBack, null)
  // The hand-back turns, then rest at 13:03:18; at 13:03:20 (the review's replay) nothing goes back: the long spell ended at 13:00:50,
  // and the chat has not been stopped a minute.
  note(said('busy', t(13, 0, 57), { turn: t(13, 0, 57) }), t(13, 0, 58))
  note(said('idle', t(13, 2, 39), { background: false }), t(13, 2, 40))
  note(said('busy', t(13, 2, 43), { turn: t(13, 2, 43) }), t(13, 2, 44))
  note(said('idle', t(13, 3, 18), { background: false }), t(13, 3, 19))
  const rested = reports.get('Worker 2')
  assert.equal(decideAt(t(13, 3, 20), laneOf({ ...rested, at: t(13, 3, 20) })).giveBack, null)
  assert.equal(decideAt(t(13, 10), laneOf({ ...rested, at: t(13, 10) })).giveBack, null)
  // The rests of seconds did not end the spell (F26b (c)): it ran from 10:16:40 to 13:03:18, so the 15 minutes count from there.
  assert.equal(decideAt(t(13, 18, 17), laneOf({ ...rested, at: t(13, 18, 17) })).giveBack, null)
  assert.deepEqual(decideAt(t(13, 18, 19), laneOf({ ...rested, at: t(13, 18, 19) })).giveBack, { step: 'B1151', chat: 'Worker 2', askedAt: t(10, 16, 5) })
  // The mutant: chat 4's reading alone (no longEndAt): the short last turn gives it back at 13:04:20.
  const { longEndAt: _gone, ...mutant } = rested
  assert.notEqual(decideAt(t(13, 4, 20), laneOf({ ...mutant, at: t(13, 4, 20) })).giveBack, null, 'without longEndAt the short last turn gives the step back')
  assert.equal(decideAt(t(13, 4, 20), laneOf({ ...rested, at: t(13, 4, 20) })).giveBack, null)
})

test('the review\'s short-last-turn case: a notification turn of 86 s after an hour of work (11:20:38-11:22:04) gives nothing back; the 15 minutes count from the rest', () => {
  const reports = new Map()
  const note = (body, now) => noteReport(reports, body, checked, now)
  note(said('idle', t(10, 11), { background: false }), t(10, 11, 2))
  note(said('busy', t(10, 16, 40), { turn: t(10, 16, 40) }), t(10, 16, 41))
  note(said('idle', t(10, 17, 30), { background: true }), t(10, 17, 31))
  note(said('busy', t(11, 20, 38), { turn: t(11, 20, 38) }), t(11, 20, 39))
  note(said('idle', t(11, 22, 4), { background: false }), t(11, 22, 5))
  const entry = reports.get('Worker 2')
  assert.equal(entry.longEndAt, t(11, 22, 4))
  assert.equal(decideAt(t(11, 23, 10), laneOf({ ...entry, at: t(11, 23, 10) })).giveBack, null)
  assert.equal(decideAt(t(11, 36, 50), laneOf({ ...entry, at: t(11, 36, 50) })).giveBack, null)
  assert.notEqual(decideAt(t(11, 37, 5), laneOf({ ...entry, at: t(11, 37, 5) })).giveBack, null)
  // The same lane read without the spell (the mutant): given back at 11:23:10, where the old code kept it.
  const { longEndAt: _gone, ...mutant } = entry
  assert.notEqual(decideAt(t(11, 23, 10), laneOf({ ...mutant, at: t(11, 23, 10) })).giveBack, null)
})

test('a report gap: while the lane reads unknown over a busy report or an idle one with background work, nothing is given back; once it resolves, the rules apply', () => {
  const busy = { state: 'busy', since: t(12, 59), background: false, at: t(13, 0, 20), turn: t(12, 59), busyAt: t(12, 59), workFrom: t(12, 59) }
  assert.equal(decideAt(t(13, 6), laneOf(busy, 'unknown')).giveBack, null)
  assert.equal(decideAt(t(13, 30), laneOf(busy, 'unknown')).giveBack, null, 'however long the gap')
  const background = { state: 'idle', since: t(12, 54), background: true, at: t(13, 0, 20), turn: t(12, 54), busyAt: t(12, 54), workFrom: t(12, 54) }
  assert.equal(decideAt(t(13, 6), laneOf(background, 'unknown')).giveBack, null)
  // Resolved to interrupted (the process died) with a short spell: back (stopped over a minute since the last report).
  assert.notEqual(decideAt(t(13, 6), laneOf(busy, 'interrupted')).giveBack, null)
  // Unknown over a resting idle report (no background): the gap holds nothing.
  const rest = { state: 'idle', since: t(12, 30), background: false, at: t(12, 30, 2) }
  assert.notEqual(decideAt(t(12, 40), laneOf(rest, 'unknown')).giveBack, null)
})

test('a give-back needs the holder stopped for a minute since its report said so; an ended report measures a turn to its own end, not the session\'s', () => {
  assert.equal(REST_MIN_MS, MIN)
  // Everything else due (the go-ons spent, no spell): stopped 30 s ago: nothing; 61 s ago: back.
  const fresh = { state: 'idle', since: t(12, 59, 30), background: false, at: t(12, 59, 31) }
  assert.equal(decideAt(t(13, 0), laneOf(fresh)).giveBack, null)
  assert.notEqual(decideAt(t(13, 0, 31), laneOf(fresh)).giveBack, null)
  // The review's finding 5: a 30 s turn at 10:20, rest at 10:20:30, the session ended at 10:30: the spell is the turn's (30 s), not 10 min:
  // back at 10:31:10, not held to 10:45.
  const ended = { state: 'ended', since: t(10, 30), background: false, at: t(10, 30), turn: t(10, 20), busyAt: t(10, 20), restAt: t(10, 20, 31) }
  assert.notEqual(decideAt(t(10, 31, 10), laneOf(ended)).giveBack, null)
  // The mutant: the turn measured to the session's end (no restAt, the old reading): held to 10:45.
  const { restAt: _gone, ...stretched } = ended
  assert.equal(decideAt(t(10, 31, 10), laneOf({ ...stretched, since: t(10, 30) })).giveBack === null, decideAt(t(10, 31, 10), laneOf(stretched)).giveBack === null)
  // A session that ended while the chat worked (busy, then ended): the spell runs to the session's end, that is the turn's end.
  const reports = new Map()
  const note = (body, now) => noteReport(reports, body, checked, now)
  note(said('busy', t(10, 20), { turn: t(10, 20) }), t(10, 20, 1))
  note(said('ended', t(10, 30)), t(10, 30, 1))
  assert.equal(reports.get('Worker 2').longEndAt, t(10, 30))
})

test('F26b: an asking report is work: the unknown gate holds it, and its spell counts; without workFrom the EARLIEST start after the go-on counts (the stretch is continuous)', () => {
  const asking = { state: 'asking', since: t(12, 50), background: false, at: t(13, 0, 20), turn: t(12, 50), busyAt: t(12, 50), workFrom: t(12, 50) }
  assert.equal(decideAt(t(13, 6), laneOf(asking, 'unknown')).giveBack, null, 'unknown over asking: nothing back')
  // Resolved to interrupted at 13:06: the asking spell 12:50-13:00:20 (10 min) is long: the 15 minutes count from 13:00:20.
  assert.equal(decideAt(t(13, 15, 10), laneOf(asking)).giveBack, null)
  assert.notEqual(decideAt(t(13, 15, 30), laneOf(asking)).giveBack, null)
  // No workFrom (a report from before F26): a busy report since 12:50 whose turn moved to 12:59:30 is one stretch from 12:50 (the review's
  // finding 2), not a 50-second one.
  const chained = { state: 'busy', since: t(12, 50), background: false, at: t(13, 0, 20), turn: t(12, 59, 30), busyAt: t(12, 50) }
  assert.equal(decideAt(t(13, 6), laneOf(chained)).giveBack, null)
  assert.equal(decideAt(t(13, 15, 10), laneOf(chained)).giveBack, null)
  assert.notEqual(decideAt(t(13, 15, 30), laneOf(chained)).giveBack, null)
})

test('F26b: an ended report measures the last turn to the chat\'s last rest, which rides into the ended entry', () => {
  const reports = new Map()
  const note = (body, now) => noteReport(reports, body, checked, now)
  note(said('busy', t(10, 20), { turn: t(10, 20) }), t(10, 20, 1))
  note(said('idle', t(10, 20, 30), { background: false }), t(10, 20, 31))
  note(said('ended', t(10, 30)), t(10, 30, 1))
  const ended = reports.get('Worker 2')
  assert.deepEqual([ended.state, ended.restAt, ended.longEndAt], ['ended', t(10, 20, 31), undefined])
  // The turn of 10:20 is 31 s, not 10 minutes: back at 10:31:10 (the review's finding 5), with restAt carried; without it (the mutant,
  // the old entry shape) the ended report has no end for the turn and nothing is counted either: back as well.
  assert.notEqual(decideAt(t(10, 31, 10), laneOf({ ...ended, busyAt: t(10, 20) })).giveBack, null)
  // A long turn that ended before the session did: its spell holds the step from its own end.
  const long = new Map()
  const say = (body, now) => noteReport(long, body, checked, now)
  say(said('busy', t(10, 20), { turn: t(10, 20) }), t(10, 20, 1))
  say(said('idle', t(10, 25), { background: false }), t(10, 25, 1))
  say(said('ended', t(10, 38)), t(10, 38, 1))
  const entry = { ...long.get('Worker 2'), busyAt: t(10, 20) }
  assert.equal(decideAt(t(10, 39, 50), laneOf(entry)).giveBack, null, 'held until 10:40:01 (15 min after 10:25:01)')
  assert.notEqual(decideAt(t(10, 40, 10), laneOf(entry)).giveBack, null)
  const { restAt: _gone, longEndAt: _gone2, ...mutant } = entry
  assert.notEqual(decideAt(t(10, 39, 50), laneOf(mutant)).giveBack, null, 'without restAt and the long end the turn counts for nothing')
})

test('F26b: a board restart is no proof of work: a kept report whose `at` moved to the board\'s start keeps its real `heardAt`, and the spell ends there', () => {
  // The holder's last report: idle with background, workFrom 10:20, really heard 10:30; then its process is gone without an ended report.
  // The board restarts at 10:44 and 10:58 (two landings): without the fix each restart made a fresh long spell ending at the restart.
  const dead = { state: 'idle', since: t(10, 20), background: true, turn: t(10, 20), busyAt: t(10, 20), workFrom: t(10, 20) }
  const restarted = at => laneOf({ ...dead, at, heardAt: t(10, 30) })
  assert.equal(decideAt(t(10, 44, 50), restarted(t(10, 44))).giveBack, null)
  assert.notEqual(decideAt(t(10, 45, 10), restarted(t(10, 44))).giveBack, null, 'back 15 min after the last real report, whatever the restart')
  assert.notEqual(decideAt(t(10, 58, 30), restarted(t(10, 58))).giveBack, null)
  // The mutant: `at` alone (no heardAt): the restart counts as work and the step is held again.
  assert.equal(decideAt(t(10, 58, 30), laneOf({ ...dead, at: t(10, 58) })).giveBack, null)
  // The first go-on path too (one line sent at 09:33, not yet the cap): the holder's last real report came at 09:30 (busy since 09:25), the
  // board restarted at 09:50 and moved the report's `at` there. At 09:51 the step goes back (15 min after the line, nothing heard since);
  // the mutant (`at` alone) reads the restart as work after the line and keeps it.
  const early = item({ ...Object.fromEntries(B1151.head), Checkpoint: checkpointLine({ commit: '5a3aa994', next: 'Waiting for sheets', now: t(9, 11) }) }, {
    History: B1151.sections.get('History').slice(0, 4),
  })
  const once = (now, worker) => holderTimers({ worker, holding: early, items: new Map([['B1151', early]]), envelopes: [envelopes[0]], runningMs: from => now - from })
  const busyDead = { state: 'busy', since: t(9, 25), background: false, turn: t(9, 25), busyAt: t(9, 25), workFrom: t(9, 25) }
  assert.notEqual(once(t(9, 51), laneOf({ ...busyDead, at: t(9, 50), heardAt: t(9, 30) })).giveBack, null, 'back 15 min after the 09:33 line: the restart is no work')
  assert.equal(once(t(9, 51), laneOf({ ...busyDead, at: t(9, 50) })).giveBack, null, 'the mutant reads the restart as work')
})
