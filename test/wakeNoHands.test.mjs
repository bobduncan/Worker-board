// F59 (chat 1's spec, 2026-11-24): a wake with no hands goes to the courier; the launch is the last try. The real case: at 10:23 the app
// relaunched itself for an update and every board chat's process ended; no hand claimed, the board launched Workers 5, 1, 4, Main and 2
// (10:24-10:44, all "the app did not start it") and nothing followed, while the courier, calling at 10:28, 10:34, 10:48 and 10:58, got an
// empty list (it got carry words only while the hands' sends were refused). The garden is that morning's five chats.

import assert from 'node:assert/strict'
import test from 'node:test'

import { carryPlan, claim, emptyWakes, launchPlan, nextPath, noticeOf, pass, sent, wakeJobId, wakeNeeds, wakeOf, wakeWords } from '../src/wake.mjs'
import { CARRY_VERDICT_MS, COURIER, COURIER_WAIT_MS, carryCloses, carryPaused, carryingOf, courierSends, dueOf } from '../src/wakeCarry.mjs'

const MIN = 60_000
/** 10:23: the app's relaunch ended every board chat's process (their spells). */
const ENDED = new Date(2026, 10, 24, 10, 23).getTime()
/** 10:24: the hands' window passed without a claim (opener.mjs HANDS_GONE_MS). */
const AT = ENDED + MIN
const time = ms => new Date(ms).toTimeString().slice(0, 5)
const NAMES = ['Main', 'Worker 1', 'Worker 2', 'Worker 4', 'Worker 5']
const uuid = index => `${index}${index}${index}${index}${index}${index}${index}${index}-aaaa-4bbb-8ccc-dddddddddddd`
const closed = (name, index) => ({
  name, isMain: name === 'Main', isLeftover: false, isRunning: false, asleep: false, state: 'off', appSession: `local_${name.toLowerCase().replace(/ /g, '')}`,
  session: uuid(index + 1), removedAt: null, queue: [], storeSteps: [], report: { state: 'ended', since: ENDED, at: ENDED, run: 1 },
})
const CHATS = NAMES.map(closed)
const stateOf = (pause = null) => ({ chats: CHATS, restart: { main: 'Main' }, chatPrefix: '', pause })
/** A word waits for each chat (the person's answers): five wakes due. */
const OUTBOX = NAMES.map((name, index) => ({ id: `answer00000000${index}`, at: ENDED - 5 * MIN, to: name, ask: `chat:${name}`, text: 'Yes, go on.', state: 'waiting' }))
const needsNow = (pause = null) => wakeNeeds(stateOf(pause), OUTBOX, { canLaunch: true })
const planOf = (record, { now = AT, outbox = [], needs = needsNow() } = {}) => {
  let n = 0
  return carryPlan(record, { needs, lanes: CHATS, main: 'Main', now, newId: () => `k${(n += 1)}-${now}`, outbox, courierAlive: true })
}

test('F59: no hand at all while the courier calls is carried as the refusal is; without a courier that calls, or with a hand, nothing changes', () => {
  // The refusal and B1271's every-hand-refused come first, as before.
  assert.deepEqual(carryingOf({ refused: { since: 5 }, gone: true, courierAt: AT, now: AT }), { since: 5 })
  assert.deepEqual(carryingOf({ allRefused: true, now: AT }), { since: AT })
  // No hand, the courier called 6 minutes ago (10:18): its words.
  assert.deepEqual(carryingOf({ gone: true, courierAt: AT - 6 * MIN, now: AT }), { since: AT, noHands: true })
  assert.equal(courierSends({ gone: true, courierAt: AT - 6 * MIN, now: AT }), true)
  // No courier that calls (never, or not within 25 minutes): the launch goes as today.
  assert.equal(carryingOf({ gone: true, courierAt: null, now: AT }), null)
  assert.equal(carryingOf({ gone: true, courierAt: AT - 26 * MIN, now: AT }), null)
  assert.equal(courierSends({ gone: true, courierAt: null, now: AT }), false)
  // A hand that may send claims: the hands send (no carry word).
  assert.equal(carryingOf({ gone: false, courierAt: AT, now: AT }), null)
  assert.equal(courierSends({ gone: false, courierAt: AT, now: AT }), false)
})

test('F59, the 10:23 case: five wakes due, no hand, the courier calling: ONE courier word each at once, no launch inside its window, none for a hand that comes back; the window passes untaken: the launch goes, never a second word', () => {
  const record = emptyWakes()
  const needs = needsNow()
  assert.deepEqual(needs.map(one => [one.chat, one.spell, one.paths.join('+')]), NAMES.map(name => [name, ENDED, 'message+launch']))
  const words = planOf(record)
  assert.deepEqual(words.map(one => [one.about, one.to, one.forModel]), NAMES.map(name => [name, COURIER, true]))
  assert.deepEqual(dueOf(words, AT + 4 * MIN, { anyRuns: false }).map(one => one.about), NAMES, 'the courier\'s next run lists each once')
  for (const name of NAMES) assert.deepEqual(record.wakes.get(name).at(-1).attempts.map(one => [one.path, one.by, one.carry, one.verdict]), [['message', COURIER, 'courier', null]], name)
  // One word per chat per spell: the next pass, or beside the open words, makes none.
  assert.deepEqual(planOf(record, { now: AT + MIN }), [])
  assert.deepEqual(planOf(record, { now: AT + MIN, outbox: words }), [])
  // A hand comes back while the words wait: it gets no message for any of them (the claim in the record holds the spell's one try).
  for (const need of needs) {
    assert.equal(nextPath(record, { chat: need.chat, spell: need.spell, senderClaims: true, paths: need.paths }), null, need.chat)
    assert.equal(claim(record, { chat: need.chat, spell: need.spell, path: 'message', by: 'Worker 3', jobId: wakeJobId(need.spell, need.chat), now: AT + 2 * MIN, paths: need.paths }), false, need.chat)
  }
  // The courier is the sender (server.mjs wakePass): no launch while its words wait, the board-wide one neither (nobody: null).
  assert.equal(launchPlan(record, { needs, nobody: null, senderClaims: true, target: { chat: 'Main', session: uuid(1) } }), null)
  const wake = wakeOf(record, needs[3], { senderClaims: true })
  assert.deepEqual([wake.state, wake.final], ['on-its-way', false])
  assert.equal(wakeWords(wake, time).text, 'waking through the scheduled courier')
  // Its window: nothing fails a second before COURIER_WAIT_MS; then each untaken word failed.
  assert.deepEqual(pass(record, AT + COURIER_WAIT_MS - 1000), [])
  assert.equal(launchPlan(record, { needs, nobody: null, senderClaims: true }), null, 'no launch before the courier\'s window')
  assert.deepEqual(pass(record, AT + COURIER_WAIT_MS).map(one => one.chat), NAMES)
  // The launch is the last try: one per check, the main chat first; the courier word is never made twice.
  assert.deepEqual(launchPlan(record, { needs, nobody: null, senderClaims: true }), { key: 'Main', chat: 'Main', session: uuid(1), spell: ENDED })
  assert.deepEqual(planOf(record, { now: AT + COURIER_WAIT_MS + MIN }), [])
  for (const need of needs) assert.equal(nextPath(record, { chat: need.chat, spell: need.spell, senderClaims: true, paths: need.paths, carry: true }), 'launch', need.chat)
})

test('F59 point 3: a launch that failed while the courier did not call leaves the message way untried: at the courier\'s call ONE word for it; courier and launch both failed: "could not wake" once', () => {
  const record = emptyWakes()
  const need = needsNow().find(one => one.chat === 'Worker 4')
  // 10:24 the launch (no courier then), PowerShell ended well; 10:26 no report: the app did not start it.
  const jobId = `launch:${AT}:Worker 4`
  assert.ok(claim(record, { chat: 'Worker 4', spell: ENDED, path: 'launch', by: 'board', jobId, now: AT, paths: ['launch'] }))
  sent(record, 'Worker 4', jobId, AT)
  assert.deepEqual(pass(record, AT + 2 * MIN).map(one => one.attempt.why), ['the app did not start it'])
  // Without a courier that calls the spell ends there, as before F59.
  assert.equal(wakeOf(record, need, { senderClaims: false }).final, true)
  // 10:28 the courier calls (it is the sender now): the message way is still untried.
  assert.equal(nextPath(record, { chat: 'Worker 4', spell: ENDED, senderClaims: true, paths: need.paths, carry: true }), 'message')
  assert.equal(wakeOf(record, need, { senderClaims: true }).final, false, 'no "could not wake" while the courier may still carry it')
  const CALL = AT + 4 * MIN
  const [word, ...more] = planOf(record, { now: CALL, needs: [need] })
  assert.deepEqual([more.length, word.about, word.to], [0, 'Worker 4', COURIER])
  assert.deepEqual(planOf(record, { now: CALL, needs: [need] }), [], 'never a second word')
  // The courier takes it in that call (wakesDue: held and sent); no report within 5 minutes: failed. Both ways tried: final, one notice.
  const attempt = record.wakes.get('Worker 4').at(-1).attempts.find(one => one.jobId === word.id)
  Object.assign(attempt, { heldAt: CALL })
  sent(record, 'Worker 4', word.id, CALL)
  assert.deepEqual(pass(record, CALL + CARRY_VERDICT_MS).map(one => one.chat), ['Worker 4'])
  assert.equal(nextPath(record, { chat: 'Worker 4', spell: ENDED, senderClaims: true, paths: need.paths, carry: true }), null)
  assert.equal(wakeOf(record, need, { senderClaims: true }).final, true)
  const notice = noticeOf(record, [{ ...need, need: true }], CALL + CARRY_VERDICT_MS, time, { senderClaims: true })
  assert.equal(notice.text, `could not wake Worker 4: the app did not start it (launched ${time(AT)}); no report after the message (sent ${time(CALL)} through the scheduled courier); open its chat`)
  assert.deepEqual(planOf(record, { now: CALL + CARRY_VERDICT_MS + MIN, needs: [need] }), [])
})

test('F59: the person\'s pause holds it: no wake due, nothing for the courier; a courier word still waiting goes back with its attempt (no try spent)', () => {
  const pause = { state: 'pausing', since: AT - MIN, by: 'person' }
  assert.equal(carryPaused(pause), true)
  assert.deepEqual(needsNow(pause), [])
  const record = emptyWakes()
  const [word] = planOf(record, { needs: needsNow().filter(one => one.chat === 'Worker 5') })
  const attempt = record.wakes.get('Worker 5').at(-1).attempts[0]
  const [close] = carryCloses({ outbox: [word], lanes: CHATS, attemptOf: () => attempt, now: AT + MIN, paused: true })
  assert.deepEqual([close.state, close.giveBack, close.why], ['dropped', true, 'held back while you pause the chats'])
})
