// F59 (chat 1's spec, 2026-11-24): a wake with no hands goes to the courier; the launch is the last try. The real case: at 10:23 the app
// relaunched itself for an update and every board chat's process ended; no hand claimed, the board launched Workers 5, 1, 4, Main and 2
// (10:24-10:44, all "the app did not start it") and nothing followed, while the courier, calling at 10:28, 10:34, 10:48 and 10:58, got an
// empty list (it got carry words only while the hands' sends were refused). The garden is that morning's five chats.

import assert from 'node:assert/strict'
import test from 'node:test'

import { handsGone } from '../src/opener.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { WATCH_RULES } from '../src/supervisor/rules/watch.mjs'
import { carryPlan, claim, emptyWakes, givenBack, handMayTakeOver, launchPlan, nextPath, noticeOf, pass, sent, textOfWakes, wakeJobId, wakeNeeds, wakeOf, wakesOfFile, wakeWords } from '../src/wake.mjs'
import { CARRY_VERDICT_MS, COURIER, COURIER_ALIVE_MS, COURIER_WAIT_MS, HAND_BACK_WHY, NO_HANDS_MS, carryCloses, carryPaused, carryingOf, courierSends, dueOf, isCarriedWord } from '../src/wakeCarry.mjs'

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
  // A hand comes back while the words wait: until its claim gives the words back (review 1, below) the record's claim holds the spell's one try.
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

// ---- Chat 1's core review of F59 (.claude/plans/2026-11-24-f59-review.md), points 1-6 and the unverified one.

const attemptOfIn = record => word => record.wakes.get(word.about)?.at(-1)?.attempts.find(one => one.jobId === word.id) ?? null

test('F59 review 1: a hand that may send comes back while the courier\'s words wait: those not taken go back unspent and the hand takes the message; a word the courier holds stays its own', () => {
  const record = emptyWakes()
  const needs = needsNow()
  const words = planOf(record)
  // The courier took Main's word at 10:25 (held and sent); the four others wait.
  const mainWord = words.find(one => one.about === 'Main')
  Object.assign(attemptOfIn(record)(mainWord), { heldAt: AT + MIN })
  sent(record, 'Main', mainWord.id, AT + MIN)
  const outbox = words.map(one => (one === mainWord ? { ...one, state: 'taken', takenBy: COURIER, takenAt: AT + MIN } : one))
  // No hand: nothing goes back.
  assert.deepEqual(carryCloses({ outbox, lanes: CHATS, attemptOf: attemptOfIn(record), now: AT + 2 * MIN }), [])
  // 10:26 Worker 3's hands claim and may send: the four untaken words go back, their attempts given back (no try spent).
  const handTakes = word => handMayTakeOver(record, word.about, word.id)
  const closes = carryCloses({ outbox, lanes: CHATS, attemptOf: attemptOfIn(record), now: AT + 2 * MIN, handSends: true, handTakes })
  const aboutOf = id => words.find(one => one.id === id).about
  assert.deepEqual(closes.map(one => [aboutOf(one.id), one.state, one.giveBack, one.why]), NAMES.slice(1).map(name => [name, 'dropped', true, HAND_BACK_WHY]))
  for (const close of closes) assert.equal(givenBack(record, aboutOf(close.id), close.id), true)
  // The hand's claim (server.mjs hands route) takes each of them now; Main's stays the courier's.
  for (const need of needs) assert.equal(nextPath(record, { chat: need.chat, spell: need.spell, senderClaims: true, paths: need.paths }), need.chat === 'Main' ? null : 'message', need.chat)
  // A start or wake word's carry for the courier goes back too: the hand takes that word.
  const of = { id: 'o1', at: AT, to: COURIER, command: 'wake-carry', about: 'Worker 2', forModel: true, spell: null, state: 'waiting', of: 'start1' }
  const start = { id: 'start1', at: AT, to: 'Main', command: 'start', about: 'Worker 2', state: 'waiting' }
  assert.deepEqual(carryCloses({ outbox: [of, start], lanes: CHATS, attemptOf: () => null, now: AT + 2 * MIN, handSends: true }).map(one => [one.id, one.state, one.giveBack]), [['o1', 'dropped', false]])
  assert.deepEqual(carryCloses({ outbox: [of, start], lanes: CHATS, attemptOf: () => null, now: AT + 2 * MIN }), [])
  // Never B1279's word: a hand's send that went and brought no report is followed by its carry word, never by a hand's send again, so
  // giving that word back would only have the next pass make it anew at every claim (a word the courier never gets, and no launch).
  const silent = emptyWakes()
  const need = needs.find(one => one.chat === 'Worker 2')
  claim(silent, { chat: 'Worker 2', spell: ENDED, path: 'message', by: 'Main', jobId: wakeJobId(ENDED, 'Worker 2'), now: AT, paths: need.paths })
  sent(silent, 'Worker 2', wakeJobId(ENDED, 'Worker 2'), AT)
  pass(silent, AT + 2 * MIN)
  const [word] = planOf(silent, { now: AT + 3 * MIN, needs: [need] })
  assert.equal(word.to, COURIER)
  assert.equal(handMayTakeOver(silent, 'Worker 2', word.id), false)
  assert.deepEqual(carryCloses({ outbox: [word], lanes: CHATS, attemptOf: attemptOfIn(silent), now: AT + 4 * MIN, handSends: true, handTakes: one => handMayTakeOver(silent, one.about, one.id) }), [])
  assert.equal(handMayTakeOver(record, 'Worker 2', words.find(one => one.about === 'Worker 2').id), false, 'given back already: no such try')
})

test('F59 review 2: "no hands" for the courier only after NO_HANDS_MS of quiet; between the hands\' window and it the launch waits (the courier counts as the sender), no word yet', () => {
  assert.equal(NO_HANDS_MS, 3 * MIN)
  const startedAt = AT - 60 * MIN
  // The only live hand paused 61 seconds (a call it holds): gone for the minute's window, not quiet.
  const claims = new Map([['Worker 3', { at: AT - 61_000, can: ['send'], mod: '0.27.1' }]])
  const gone = handsGone({ claims, now: AT, startedAt })
  const quiet = handsGone({ claims, now: AT, startedAt, quietMs: NO_HANDS_MS })
  assert.deepEqual([gone, quiet], [true, false])
  assert.equal(carryingOf({ gone: quiet, courierAt: AT - 6 * MIN, now: AT }), null, 'no courier word yet')
  assert.equal(courierSends({ gone, courierAt: AT - 6 * MIN, now: AT }), true, 'the launch waits')
  // Three minutes of quiet: no hands.
  assert.equal(handsGone({ claims, now: AT - 61_000 + NO_HANDS_MS, startedAt, quietMs: NO_HANDS_MS }), true)
  // A board younger than the quiet whose chats called since its start: not quiet yet.
  assert.equal(handsGone({ claims: new Map(), now: AT, startedAt: AT - 2 * MIN, calls: { Main: AT - 2 * MIN + 1000 }, quietMs: NO_HANDS_MS }), false)
})

test('F59 review 3: a start or wake word in doubt (B891) is never carried until its doubt ended', () => {
  const word = { id: 'wakeword0000001', at: AT - MIN, to: 'Main', command: 'wake', about: 'Worker 2', text: 'The worker board holds words for you: run work next', state: 'waiting' }
  assert.equal(isCarriedWord(word, AT), true)
  assert.equal(isCarriedWord({ ...word, command: 'start' }, AT), true)
  assert.equal(isCarriedWord({ ...word, doubtAt: AT - MIN }, AT), false, 'its hand\'s call may have sent it')
  assert.equal(isCarriedWord({ ...word, doubtAt: AT - 6 * MIN }, AT), true, 'its doubt (5 minutes) ended')
  assert.equal(isCarriedWord({ ...word, state: 'taken' }, AT), false)
  assert.equal(isCarriedWord({ ...word, command: 'set' }, AT), false)
})

/** Worker 4's spell with both ways failed (the launch at 10:24, the courier's word handed at 10:28 and no report). */
function bothFailed() {
  const record = emptyWakes()
  const jobId = `launch:${AT}:Worker 4`
  claim(record, { chat: 'Worker 4', spell: ENDED, path: 'launch', by: 'board', jobId, now: AT, paths: ['launch'] })
  sent(record, 'Worker 4', jobId, AT)
  pass(record, AT + 2 * MIN)
  const need = needsNow().find(one => one.chat === 'Worker 4')
  const [word] = planOf(record, { now: AT + 4 * MIN, needs: [need] })
  Object.assign(attemptOfIn(record)(word), { heldAt: AT + 4 * MIN })
  sent(record, 'Worker 4', word.id, AT + 4 * MIN)
  pass(record, AT + 4 * MIN + CARRY_VERDICT_MS)
  return { record, need }
}

test('F59 review 4: "nobody answers the board\'s wake-ups" reads the hands\' own claim: it stands while the courier calls and no hand runs, once courier and launch both failed; and so does the Supervisor\'s rule', () => {
  const { record, need } = bothFailed()
  const now = AT + 10 * MIN
  const line = 'nobody answers the board\'s wake-ups: open any chat'
  // The courier counts as a sender (senderClaims), no hand claims (handsClaim false): the line stands.
  assert.ok(noticeOf(record, [{ ...need, need: true }], now, time, { senderClaims: true, handsClaim: false }).text.startsWith(line))
  // A hand that may send claims: no such line (as before); without the hands' fact, senderClaims as before.
  assert.equal(noticeOf(record, [{ ...need, need: true }], now, time, { senderClaims: true, handsClaim: true }).text.startsWith(line), false)
  assert.equal(noticeOf(record, [{ ...need, need: true }], now, time, { senderClaims: true }).text.startsWith(line), false)
  // The Supervisor's rule: every chat with a need could not be woken, no board-wide launch (none goes while the courier calls), no hand.
  const lane = { ...closed('Worker 4', 3), onSequence: true, wake: { state: 'failed', final: true, need: true, spell: ENDED, why: 'no report within 2 minutes of the message', attempts: record.wakes.get('Worker 4').at(-1).attempts } }
  const viewOf = handsClaim => buildView({ state: { chats: [lane], today: [], limits: {}, pause: null, chatPrefix: '', readyList: null, gaps: [], wakes: {}, wakeHandsClaim: handsClaim }, items: new Map(), outbox: [], settings: {}, now })
  const rule = WATCH_RULES.find(one => one.id === 'nobody-answers-wakes')
  assert.deepEqual(rule.check(viewOf(false), { seen: new Map(), observed: [] }).map(one => one.text), ['nobody answers the board\'s wake-ups: Worker 4 could not be woken, and no chat\'s hands run'])
  assert.deepEqual(rule.check(viewOf(true), { seen: new Map(), observed: [] }), [], 'a hand claims: none')
})

test('F59, the unverified point: a chat nothing needs a wake for whose launch failed keeps "could not wake" when the courier starts counting (no courier word is made for it)', () => {
  const record = emptyWakes()
  const jobId = `launch:${AT}:Worker 5`
  claim(record, { chat: 'Worker 5', spell: ENDED, path: 'launch', by: 'board', jobId, now: AT, paths: ['launch'] })
  sent(record, 'Worker 5', jobId, AT)
  pass(record, AT + 2 * MIN)
  const target = { chat: 'Worker 5', spell: ENDED, paths: ['message', 'launch'], need: false }
  const notice = noticeOf(record, [target], AT + 5 * MIN, time, { senderClaims: true, handsClaim: false })
  assert.equal(notice.text, `could not wake Worker 5: the app did not start it (launched ${time(AT)}); open its chat`)
})

test('F59 review 5: the courier\'s last call is kept in data/wakes.json across a board restart', () => {
  const record = emptyWakes()
  record.courierAt = AT - 6 * MIN
  const back = wakesOfFile(JSON.parse(textOfWakes(record)))
  assert.equal(back.courierAt, AT - 6 * MIN)
  assert.deepEqual(carryingOf({ gone: true, courierAt: back.courierAt, now: AT }), { since: AT, noHands: true })
})

test('F59 review 6: the courier\'s untaken word waits as long as the board counts on it (25 minutes): one missed run spends no try; its why says the window', () => {
  assert.equal(COURIER_WAIT_MS, COURIER_ALIVE_MS)
  const record = emptyWakes()
  planOf(record, { needs: needsNow().filter(one => one.chat === 'Worker 2') })
  // The courier missed its 10:28 and 10:38 runs: at 10:48 the word still waits.
  assert.deepEqual(pass(record, AT + 24 * MIN), [])
  const [failed] = pass(record, AT + 25 * MIN)
  assert.equal(failed.attempt.why, 'the scheduled courier did not carry the message within 25 minutes')
  // Once the courier holds it: 10 minutes to send it, said so.
  const held = emptyWakes()
  const [word] = planOf(held, { needs: needsNow().filter(one => one.chat === 'Worker 2') })
  Object.assign(attemptOfIn(held)(word), { heldAt: AT + 5 * MIN })
  assert.deepEqual(pass(held, AT + 14 * MIN), [])
  assert.equal(pass(held, AT + 15 * MIN)[0].attempt.why, 'the scheduled courier did not carry the message within 10 minutes')
})
