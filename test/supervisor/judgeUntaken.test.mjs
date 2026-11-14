// B1174 (X43, the real case of 2026-11-14): the judge word of 00:14:40 to the Supervisor (X73 X157 X176 X180) waited 12 h 28 min
// and was taken only at 12:43:01, when the Supervisor's chat ran again. A judge word waits as long as a step's (48 h), and while it
// waited it counted as in flight, so no later judgment could go all night. Now a judge word its chat did not take within 30 min
// (JUDGE_UNTAKEN_MS, the person's pause not counted) stops holding later judgments: the outbox sweep closes it expired with its
// reason (the Supervisor did not take it, and how its chat stands), its incidents wait again, and the next judge word goes only once
// the chat took a word after it (it runs again), listing them all: never one each 30 min. Made-up chats; no word names a project.

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildView } from '../../src/supervisor/view.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { JUDGE_UNTAKEN_MS, judgeHeldBack, judgeInFlight, untakenWhy } from '../../src/work/judgeWord.mjs'
import { whyClosed } from '../../src/work/outboxSweep.mjs'

const MIN = 60_000
const SENT = new Date(2026, 10, 14, 0, 14, 40).getTime()
const at = minutes => SENT + minutes * MIN
const KEEP = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN }
const INCIDENTS = ['X73', 'X157', 'X176', 'X180']
/** The real word, as the outbox held it at 00:14:40. */
const realWord = (more = {}) => ({ id: '17d31767d1eb552a', to: 'Supervisor', ask: null, step: null, command: 'judge', kind: 'judge', about: INCIDENTS.join(' '), incidents: INCIDENTS, text: 'judge: 4 incidents wait for your judgment', at: SENT, state: 'waiting', ...more })
const open = new Map(INCIDENTS.map(id => [id, { head: new Map([['Id', id], ['Kind', 'incident'], ['State', 'open']]) }]))
/** The Supervisor's lane that night: not running, its wake failed on every path (the spent spell of 2026-11-05). */
const NIGHT_WAKE = { state: 'failed', final: true, spell: 0, why: 'no report within 2 minutes of the message', attempts: [] }
const nightLane = (more = {}) => ({ name: 'Supervisor', isLeftover: false, state: 'off', isRunning: false, session: 's-Supervisor', wake: NIGHT_WAKE, ...more })
const ctxOf = (now, supervisor = nightLane(), all = [realWord()]) => ({ all, items: open, now, keep: KEEP, runs: new Map(), closing: new Map(), supervisor })

test('B1174: a judge word not taken within 30 min stops being in flight; a taken one, a long judging turn and the person\'s pause stay as they were', () => {
  assert.equal(JUDGE_UNTAKEN_MS, 30 * MIN)
  assert.equal(judgeInFlight([realWord()], 'Supervisor', at(29), KEEP), true, 'on its way within 30 min')
  assert.equal(judgeInFlight([realWord()], 'Supervisor', at(31), KEEP), false, 'not taken in 30 min: it no longer holds the next judgment')
  // 12:10, the moment X43 named it after 698 min: long out of flight.
  assert.equal(judgeInFlight([realWord()], 'Supervisor', at(11 * 60 + 56), KEEP), false)
  // A word taken in time is on its way as before, then arrived, and its judging turn counts 30 min from its arrival.
  const taken = realWord({ state: 'taken', takenAt: at(5) })
  assert.equal(judgeInFlight([taken], 'Supervisor', at(14), KEEP), true)
  assert.equal(judgeInFlight([taken], 'Supervisor', at(34), KEEP), true, 'a long judging turn: still in flight 34 min after it was sent')
  assert.equal(judgeInFlight([realWord({ state: 'delivered', deliveredAt: at(2) })], 'Supervisor', at(31), KEEP), true)
  // The person paused for 20 min of it: that time does not count.
  const pause = { state: 'running', since: at(25), pausedSince: at(5), resumedSince: at(25) }
  assert.equal(judgeInFlight([realWord()], 'Supervisor', at(45), { ...KEEP, pause }), true, '45 min sent, 20 of them paused: 25 min of waiting')
  assert.equal(judgeInFlight([realWord()], 'Supervisor', at(51), { ...KEEP, pause }), false)
})

test('B1174: the outbox sweep closes an untaken judge word expired, naming why: the Supervisor did not take it, and how its chat stands', () => {
  assert.equal(whyClosed(realWord(), ctxOf(at(29))), null, 'within 30 min it waits')
  const night = whyClosed(realWord(), ctxOf(at(31)))
  assert.deepEqual(night, { state: 'expired', untaken: true, why: 'Supervisor did not take it within 30 min: its chat does not run and the board could not wake it (no report within 2 minutes of the message)' })
  assert.match(whyClosed(realWord(), ctxOf(at(31), nightLane({ wake: { state: 'none', final: false } }))).why, /: its chat does not run \(no wake tried yet\)$/)
  assert.match(whyClosed(realWord(), ctxOf(at(31), nightLane({ isRunning: null, state: 'unknown', wake: { state: 'none' } }))).why, /: the board cannot tell whether its chat runs$/)
  assert.match(whyClosed(realWord(), ctxOf(at(31), nightLane({ isRunning: true, state: 'free', wake: { state: 'none' } }))).why, /: its chat runs, but its Workers mod did not take it$/)
  assert.match(whyClosed(realWord(), ctxOf(at(31), null)).why, /: its chat is not on the board$/)
  // A word whose incidents no longer wait is dropped first, as before.
  const gone = new Map(INCIDENTS.map(id => [id, { head: new Map([['State', 'gone']]) }]))
  assert.equal(whyClosed(realWord(), { ...ctxOf(at(31)), items: gone }).state, 'dropped')
  assert.equal(untakenWhy('Supervisor', nightLane()), night.why)
})

test('B1174: after an untaken judge word the next goes only once the chat took a word after it: never one each 30 min', () => {
  const expired = realWord({ state: 'expired', untaken: true, closedAt: at(31) })
  for (const outbox of [[realWord()], [expired]]) {
    for (const minutes of [31, 61, 120, 11 * 60 + 56]) assert.equal(judgeHeldBack(outbox, 'Supervisor', at(minutes), KEEP), true, `held at +${minutes} min`)
    // The chat ran again: it took a word (its sweep's) after the judge word went untaken: the next judge word may go.
    const sweep = { id: 'sw', to: 'Supervisor', command: 'sweep', at: at(12 * 60 + 28), state: 'delivered', takenAt: at(12 * 60 + 28), deliveredAt: at(12 * 60 + 28) }
    assert.equal(judgeHeldBack([...outbox, sweep], 'Supervisor', at(12 * 60 + 29), KEEP), false)
    // A word it took BEFORE the judge word went untaken proves nothing about later.
    assert.equal(judgeHeldBack([...outbox, { ...sweep, takenAt: at(10), deliveredAt: at(10) }], 'Supervisor', at(60), KEEP), true)
    // Another chat's take is not this chat's.
    assert.equal(judgeHeldBack([...outbox, { ...sweep, to: 'Lead' }], 'Supervisor', at(12 * 60 + 29), KEEP), true)
  }
  // A judge word taken in time, or one that ended, holds nothing back.
  assert.equal(judgeHeldBack([realWord({ state: 'delivered', deliveredAt: at(1), endedAt: at(9) })], 'Supervisor', at(60), KEEP), false)
  assert.equal(judgeHeldBack([realWord()], 'Supervisor', at(20), KEEP), false, 'still on its way: in flight, not held back')
  assert.equal(judgeHeldBack([], 'Supervisor', at(20), KEEP), false)
})

test('B1174, the night of 2026-11-14: one finding names the cause (the Supervisor could not be woken), never a 698 min wait', () => {
  const rule = id => WATCH_RULES.find(one => one.id === id).check
  const viewAt = (now, supervisor, outbox) => buildView({
    state: { chats: [{ name: 'Lead', isMain: true, isLeftover: false, state: 'working', isRunning: true, session: 's-Lead' }], supervisorChat: supervisor, today: [], limits: {}, pause: null, chatPrefix: '', readyList: null, wakeFailed: [], nobodyRuns: null },
    items: open, outbox, repairs: [], mods: null, settings: {}, now,
  })
  const closed = realWord({ state: 'expired', untaken: true, closedAt: at(31), why: untakenWhy('Supervisor', nightLane()) })
  // All night: the Supervisor could not be woken. The wake rule names that; the undelivered rule leaves the word to it.
  const night = viewAt(at(60), nightLane(), [closed])
  assert.deepEqual(rule('wake-failed')(night, { seen: new Map(), observed: [] }).map(one => one.key), ['wake-failed Supervisor 0'])
  assert.deepEqual(rule('undelivered')(night, { seen: new Map(), observed: [] }), [])
  // 12:10: the Supervisor's lane read unknown (no wake under way): the word closed at 00:45 is past the rule's two hours: no "698 min".
  const morning = viewAt(at(11 * 60 + 56), nightLane({ isRunning: null, state: 'unknown', wake: { state: 'none', final: false, spell: null, attempts: [] } }), [closed])
  assert.deepEqual(rule('undelivered')(morning, { seen: new Map(), observed: [] }), [])
  // Within the two hours with no wake under way, the finding names the word's own reason.
  const early = viewAt(at(45), nightLane({ isRunning: null, state: 'unknown', wake: { state: 'none', final: false, spell: null, attempts: [] } }), [closed])
  const [found] = rule('undelivered')(early, { seen: new Map(), observed: [] })
  assert.equal(found.key, 'undelivered Supervisor')
  assert.match(found.evidence, /judge X73 X157 X176 X180 \(expired: Supervisor did not take it within 30 min: its chat does not run and the board could not wake it/)
})
