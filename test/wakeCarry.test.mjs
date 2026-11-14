// F17 (chat 1's brief of 2026-11-14, and its review .claude/plans/2026-11-14-f17-review.md): wakes without code sends. The refusal is the live
// one (data/wakes.json and data/outbox.jsonl, 2026-11-14 08:13 on: six of them, each as the hands' result wraps it); the garden is made up.

import assert from 'node:assert/strict'
import test from 'node:test'

import { isHandWord } from '../src/hands.mjs'
import { isUndelivered } from '../src/supervisor/rules/watch.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { emptyWakes, claim, carryPlan, failedToSend, heard, nextPath, pass, personAgain, sent, statusOf, textOfWakes, triedWords, wakeCarriedTake, wakeNeeds, wakeOf, wakesOfFile, wakeWords } from '../src/wake.mjs'
import { CARRY_BY_MODEL, COURIER, carryPaused, closeWay, CARRY_DUE_MS, SEND_REFUSED_WHY, carrierOf, freeChatOf, carryCloses, carryText, carryTurnBegan, courierAlive, dueOf, noteSendLifted, noteSendRefused, probeDue, sendsRefusedOf } from '../src/wakeCarry.mjs'
import { PROBE_MS } from '../src/work/effort.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 14, 9, 0).getTime()
const time = ms => new Date(ms).toTimeString().slice(0, 5)
/** The refusal exactly as the hands' result carried it into data/wakes.json (Worker 4's hand, Worker 2's wake, 08:16). */
const REFUSAL = '{"deny":"PreToolUse:mcp__ccd_session_mgmt__send_message hook error: Not run: in auto mode Claude Desktop doesn\'t run this tool when a plugin\'s own code calls it. Have Claude make the call."}'
const RAW = /PreToolUse|hook error|deny/

const IDLE = { state: 'idle', at: NOW - 5000, background: false }
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, isRunning: true, state: 'free', appSession: `local_${name.toLowerCase().replace(/ /g, '')}`, session: null, unjoined: null, report: IDLE, ...more })
const asleep = (name, since, more = {}) => lane(name, { isRunning: false, state: 'off', asleep: true, asleepSince: since, report: null, ...more })
/** The live case after 08:13: a hand's wake job refused (Worker 2 by Worker 4's hand). */
function refusedRecord(at = NOW - 10 * MIN) {
  const record = emptyWakes()
  claim(record, { chat: 'Old', spell: at - MIN, path: 'message', by: 'Worker 4', jobId: `wake:${at - MIN}:Old`, now: at, paths: ['message'] })
  failedToSend(record, 'Old', `wake:${at - MIN}:Old`, REFUSAL, at + 2000)
  return record
}
/** The garden at 09:00: a step ready for Digger (its envelope waits). */
const envelope = to => ({ id: `env-${to}`, at: NOW - 2 * MIN, to, command: 'handover', step: 'B12', kind: 'task', clear: null, state: 'waiting' })
const stateOf = chats => ({ chats, chatPrefix: '', pause: null, restart: { main: 'Lead' } })
const needsOf = chats => wakeNeeds(stateOf(chats), [envelope('Digger')], { canLaunch: false })

test('the refusal: the live hook text marks the attempt refused, kept in plain words and as the record\'s fact; never shown raw', () => {
  const record = refusedRecord()
  const attempt = record.wakes.get('Old')[0].attempts[0]
  assert.deepEqual([attempt.refused, attempt.why, record.sendsRefusedSince], [true, SEND_REFUSED_WHY, NOW - 10 * MIN + 2000])
  const status = statusOf(record, 'Old')
  assert.doesNotMatch(status.why, RAW)
  assert.doesNotMatch(triedWords(status.attempts, time).join(' '), RAW)
  assert.doesNotMatch(wakeWords({ ...wakeOf(record, { chat: 'Old', spell: NOW - 11 * MIN, paths: ['message'] }), final: true }, time).text, RAW)
  // A record written before F17 holds the raw text: still shown plain.
  const old = emptyWakes()
  old.wakes.set('Old', [{ spell: 1, attempts: [{ path: 'message', at: NOW, by: 'Worker 4', jobId: 'j', sentAt: null, verdict: 'failed', verdictAt: NOW, why: REFUSAL }], turnEndedAt: null, told: {} }])
  assert.equal(statusOf(old, 'Old').why, SEND_REFUSED_WHY)
  assert.doesNotMatch(triedWords(statusOf(old, 'Old').attempts, time).join(' '), RAW)
})

test('review 10, 16: the refusal is the record\'s own fact: it outlives the pruned spells and any clock; only the probe\'s send lifts it', () => {
  assert.equal(sendsRefusedOf(emptyWakes(), []), null)
  assert.deepEqual(sendsRefusedOf(refusedRecord(), []), { since: NOW - 10 * MIN + 2000 })
  // The live outbox line (a start word, 08:13).
  const word = { id: 'e618a626e984b066', command: 'start', about: 'Worker 5', at: NOW - 20 * MIN, state: 'failed', failedAt: NOW - 20 * MIN, tries: 1, why: REFUSAL }
  assert.deepEqual(sendsRefusedOf(emptyWakes(), [word]), { since: NOW - 20 * MIN })
  assert.equal(sendsRefusedOf(emptyWakes(), [{ ...word, why: 'the app gave no answer' }]), null, 'another failure is no refusal')
  // Its spells pruned (six newer sleeps of the chat): the fact stands, saved and read back.
  const record = refusedRecord()
  record.wakes.delete('Old')
  const back = wakesOfFile(JSON.parse(textOfWakes(record)))
  assert.deepEqual(sendsRefusedOf(back, []), { since: NOW - 10 * MIN + 2000 })
  // A day later it still stands: the probe is due, once; a real wake is never the probe.
  assert.equal(probeDue(back, [], NOW + PROBE_MS - 11 * MIN), false)
  assert.equal(probeDue(back, [], NOW - 10 * MIN + 2000 + PROBE_MS), true)
  back.probeAt = NOW + PROBE_MS
  assert.equal(probeDue(back, [], NOW + PROBE_MS + MIN), false, 'once a day')
  // Refused again: renewed. The probe's send went: lifted, and a refusal after that stands anew.
  noteSendRefused(back, NOW + PROBE_MS + MIN)
  assert.deepEqual(sendsRefusedOf(back, []), { since: NOW + PROBE_MS + MIN })
  noteSendLifted(back, NOW + PROBE_MS + 2 * MIN)
  assert.equal(sendsRefusedOf(back, []), null)
  assert.equal(wakesOfFile(JSON.parse(textOfWakes(back))).sendsLiftedAt, NOW + PROBE_MS + 2 * MIN)
  assert.equal(sendsRefusedOf(back, [{ ...word, failedAt: NOW + PROBE_MS + 3 * MIN }]).since, NOW + PROBE_MS + 3 * MIN)
})

test('the carrier: a free chat whose mod reported idle within the minute, the main chat first; never the target, nor a busy, asking, interrupted, stopped or unlinked chat', () => {
  // Landing 1 (chat 1's verifier): no chat carries; A's carrier only with `byModel` (landing 2).
  assert.equal(CARRY_BY_MODEL, false)
  assert.equal(carrierOf([lane('Lead', { isMain: true })], { target: 'Digger', main: 'Lead', now: NOW }), null)
  assert.equal(carrierOf([lane('Lead', { isMain: true })], { target: 'Digger', main: 'Lead', now: NOW, byModel: true }).name, 'Lead')
  const lanes = [lane('Lead', { isMain: true }), lane('Worker 1'), asleep('Digger', NOW - 30 * MIN)]
  assert.equal(freeChatOf(lanes, { target: 'Digger', main: 'Lead', now: NOW }).name, 'Lead')
  assert.equal(freeChatOf(lanes, { target: 'Lead', main: 'Lead', now: NOW }).name, 'Worker 1', 'never the target')
  // Review 1, 2, 14: only now free and idle: a busy, asking or interrupted chat would queue the word behind its turn.
  for (const busy of [{ state: 'working', report: { ...IDLE, state: 'busy' } }, { state: 'waiting', report: { ...IDLE, state: 'asking' } }, { state: 'interrupted' }, { state: 'working' }, { report: { ...IDLE, state: 'busy' } }, { report: { ...IDLE, background: true } }]) {
    assert.equal(freeChatOf([lane('Worker 3', busy), asleep('Digger', NOW - 30 * MIN)], { target: 'Digger', now: NOW }), null, JSON.stringify(busy))
  }
  // Gone links: not running, no live mod (chat 1's point 1), unjoined, a leftover, removed, suspended, no app id.
  for (const gone of [{ isRunning: false }, { isRunning: null }, { report: null }, { report: { ...IDLE, at: NOW - 61_000 } }, { unjoined: { at: NOW, session: 'x' } }, { isLeftover: true }, { removedAt: NOW }, { removal: { isOpen: true } }, { suspended: { until: NOW } }, { appSession: null }]) {
    assert.equal(freeChatOf([lane('Worker 3', gone), asleep('Digger', NOW - 30 * MIN)], { target: 'Digger', now: NOW }), null, JSON.stringify(gone))
  }
  assert.equal(freeChatOf([lane('Worker 3', { report: { ...IDLE, at: NOW - 60_000 } })], { target: 'Digger', now: NOW }).name, 'Worker 3', 'exactly a minute is live')
  // Review 9: a chat whose words a stop holds hands out nothing at its take.
  const stop = { id: 's1', to: 'Worker 3', state: 'waiting', at: NOW - MIN, stoppedAt: NOW - MIN, failedSession: 'x' }
  const stoppedLane = lane('Worker 3', { session: 'x' })
  assert.equal(freeChatOf([stoppedLane], { target: 'Digger', now: NOW, outbox: [stop] }), null)
  // Review 14: the word asks for the one call and ends the turn.
  assert.doesNotMatch(carryText('Digger', 'local_digger', 'x'), /go on/)
  assert.match(carryText('Digger', 'local_digger', 'x'), /Then end this turn; do nothing else\.$/)
})

test('the real case, A: Digger asleep with a step ready: ONE word for a free chat\'s model, claimed once per spell; sent only once the carrier\'s turn on it began', () => {
  const chats = [lane('Lead', { isMain: true, state: 'working', report: { ...IDLE, state: 'busy' } }), asleep('Digger', NOW - 30 * MIN), lane('Worker 3')]
  const record = refusedRecord()
  assert.deepEqual(needsOf(chats).map(one => [one.chat, one.text]), [['Digger', 'take B12 in this turn: run work next']])
  let n = 0
  const plan = (outbox = []) => carryPlan(record, { needs: needsOf(chats), lanes: chats, main: 'Lead', now: NOW, newId: () => `w${(n += 1)}`, outbox, byModel: true })
  const [word, ...more] = plan()
  assert.equal(more.length, 0)
  assert.deepEqual([word.to, word.about, word.command, word.forModel, word.session, word.wakeText], ['Worker 3', 'Digger', 'wake-carry', true, 'local_digger', 'take B12 in this turn: run work next'])
  assert.match(word.text, /send_message with session_id "local_digger" and message "take B12 in this turn: run work next"/)
  assert.equal(isHandWord(word, { canSend: true, canSet: true, canRestart: true, canSpawn: true, workers: ['Worker 3'] }), false, 'no hand takes it')
  // The same wake twice: never; nor beside an open carry word.
  assert.deepEqual(plan(), [])
  assert.deepEqual(plan([word]), [])
  assert.equal(record.wakes.get('Digger').at(-1).attempts.length, 1)
  // Review 8: a carry word open for Digger (a carried start word, no attempt of its own) holds a second one off, also in a fresh record.
  assert.deepEqual(carryPlan(refusedRecord(), { needs: needsOf(chats), lanes: chats, now: NOW, newId: () => 'x', outbox: [{ ...word, id: 'o1', of: 'start1' }], byModel: true }), [])
  assert.equal(wakeWords(wakeOf(record, { chat: 'Digger', spell: NOW - 30 * MIN, paths: ['message'] }, { senderClaims: true }), time).text, 'waking through Worker 3\'s turn')
  // Review 1, 2: taken at 09:00:05 is not sent; the carrier's turn on it is.
  const taken = { ...word, state: 'taken', takenAt: NOW + 5000 }
  assert.equal(carryTurnBegan(taken, { state: 'idle', at: NOW + 6000 }), false)
  assert.equal(carryTurnBegan(taken, { state: 'busy', at: NOW + 6000, word: 'other', turn: NOW }), false, 'a turn from before the take')
  assert.equal(carryTurnBegan(taken, { state: 'busy', at: NOW + 7000, word: word.id }), true)
  assert.equal(carryTurnBegan(taken, { state: 'busy', at: NOW + 7000, word: null, turn: NOW + 6000 }), true)
  sent(record, 'Digger', word.id, NOW + 7000)
  assert.equal(heard(record, 'Digger', { state: 'busy', at: NOW + 40_000, run: NOW + 30_000 }, NOW + 40_000).verdict, 'woke')
  assert.equal(wakeWords(statusOf(record, 'Digger'), time).text, 'woken through Worker 3\'s turn')
  assert.equal(wakeCarriedTake(record, 'Digger', 'B12'), true)
})

test('review 5: a target that woke by itself before its carry word went: no carrier\'s credit, its take line not waived, the word dropped', () => {
  const chats = [asleep('Digger', NOW - 30 * MIN), lane('Worker 3')]
  const record = refusedRecord()
  const [word] = carryPlan(record, { needs: needsOf(chats), lanes: chats, now: NOW, newId: () => 'w1', byModel: true })
  heard(record, 'Digger', { state: 'busy', at: NOW + MIN, run: NOW + 50_000 }, NOW + MIN)
  assert.equal(statusOf(record, 'Digger').state, 'woke')
  assert.equal(wakeWords(statusOf(record, 'Digger'), time), null)
  assert.equal(wakeCarriedTake(record, 'Digger', 'B12'), false)
  const attempt = record.wakes.get('Digger').at(-1).attempts[0]
  const [close] = carryCloses({ outbox: [word], lanes: [asleep('Digger', NOW - 30 * MIN), lane('Worker 3')], attemptOf: () => attempt, now: NOW + MIN })
  assert.deepEqual([close.state, close.why], ['dropped', 'Digger woke by itself'])
})

test('a carried wake\'s windows: a carrier\'s 10 min; the courier\'s 15 min untaken, 10 from its take; then 5 for the report; then the launch', () => {
  const record = emptyWakes()
  claim(record, { chat: 'Digger', spell: 1, path: 'message', by: 'Lead', jobId: 'c', now: NOW, paths: ['message', 'launch'], carry: 'model' })
  assert.deepEqual(pass(record, NOW + 9 * MIN), [])
  assert.equal(pass(record, NOW + 10 * MIN)[0].attempt.why, 'Lead\'s turn did not carry the message within 10 minutes')
  // Review 3, 11: the courier's window starts at its take.
  const two = emptyWakes()
  claim(two, { chat: 'Digger', spell: 1, path: 'message', by: COURIER, jobId: 'c', now: NOW, paths: ['message', 'launch'], carry: 'courier' })
  assert.deepEqual(pass(two, NOW + 14 * MIN), [], 'its run comes every 10 minutes')
  two.wakes.get('Digger')[0].attempts[0].heldAt = NOW + 14 * MIN
  assert.deepEqual(pass(two, NOW + 23 * MIN), [], 'held at 14 min: no launch while it carries it')
  sent(two, 'Digger', 'c', NOW + 15 * MIN)
  assert.deepEqual(pass(two, NOW + 19 * MIN), [])
  const [failed] = pass(two, NOW + 20 * MIN)
  assert.match(triedWords([failed.attempt], time).join(), /through the scheduled courier/)
  assert.equal(nextPath(two, { chat: 'Digger', spell: 1, senderClaims: true, paths: ['message', 'launch'] }), 'launch')
  const untaken = emptyWakes()
  claim(untaken, { chat: 'Digger', spell: 1, path: 'message', by: COURIER, jobId: 'c', now: NOW, paths: ['message'], carry: 'courier' })
  assert.equal(pass(untaken, NOW + 15 * MIN).length, 1)
  // A hand's attempt keeps its own 3 minutes.
  const hand = emptyWakes()
  claim(hand, { chat: 'Digger', spell: 1, path: 'message', by: 'Worker 1', jobId: 'h', now: NOW, paths: ['message'] })
  assert.equal(pass(hand, NOW + 3 * MIN).length, 1)
})

test('landing 1: A is off: a free chat carries nothing; the need goes to a live courier, else its message try stays unspent', () => {
  const chats = [lane('Lead', { isMain: true }), asleep('Digger', NOW - 30 * MIN), lane('Worker 3')]
  const record = refusedRecord()
  assert.deepEqual(carryPlan(record, { needs: needsOf(chats), lanes: chats, main: 'Lead', now: NOW, newId: () => 'n1' }), [])
  assert.equal(nextPath(record, { chat: 'Digger', spell: NOW - 30 * MIN, senderClaims: false, paths: ['message', 'launch'] }), 'launch')
  const [word] = carryPlan(record, { needs: needsOf(chats), lanes: chats, main: 'Lead', now: NOW, newId: () => 'n2', courierAlive: true })
  assert.equal(word.to, COURIER)
})

test('verifier 3, 4: a wake handed to the courier counts as sent at the hand-off: the target\'s report before wakes-sent credits it, its take line waived', () => {
  const chats = [asleep('Lead', NOW - 40 * MIN, { isMain: true }), asleep('Digger', NOW - 30 * MIN)]
  const record = refusedRecord()
  const [word] = carryPlan(record, { needs: needsOf(chats), lanes: chats, main: 'Lead', now: NOW, newId: () => 'k9', courierAlive: true })
  // The hand-off (server.mjs wakesDue): held and sent.
  Object.assign(record.wakes.get('Digger').at(-1).attempts[0], { heldAt: NOW + MIN })
  sent(record, 'Digger', word.id, NOW + MIN)
  heard(record, 'Digger', { state: 'busy', at: NOW + 2 * MIN, run: NOW + 100_000 }, NOW + 2 * MIN)
  const attempt = record.wakes.get('Digger').at(-1).attempts[0]
  assert.deepEqual([attempt.verdict, attempt.self, attempt.step, attempt.carry], ['woke', undefined, 'B12', 'courier'])
  assert.equal(wakeCarriedTake(record, 'Digger', 'B12'), true)
  assert.equal(wakeWords(statusOf(record, 'Digger'), time).text, 'woken through the scheduled courier')
  assert.equal(carryCloses({ outbox: [{ ...word, state: 'taken', takenBy: COURIER }], lanes: chats, attemptOf: () => attempt, now: NOW + 2 * MIN })[0].state, 'delivered')
})

test('verifier 6, 10: while the person pauses, a waiting carry word goes back with its attempt (no try spent); a taken one stays', () => {
  const word = { id: 'w1', to: COURIER, command: 'wake-carry', about: 'Digger', forModel: true, state: 'waiting', at: NOW }
  const lanes = [asleep('Digger', NOW - 30 * MIN)]
  const [close] = carryCloses({ outbox: [word], lanes, attemptOf: () => ({ verdict: null, sentAt: null }), now: NOW, paused: true })
  assert.deepEqual([close.state, close.giveBack, close.why], ['dropped', true, 'held back while you pause the chats'])
  assert.deepEqual(carryCloses({ outbox: [{ ...word, state: 'taken', takenBy: COURIER }], lanes, attemptOf: () => ({ verdict: null, sentAt: NOW }), now: NOW, paused: true }), [])
  assert.deepEqual(carryCloses({ outbox: [word], lanes, attemptOf: () => ({ verdict: null, sentAt: null }), now: NOW }), [], 'no pause: it waits')
  const of = { ...word, id: 'w2', of: 'start1' }
  assert.equal(carryCloses({ outbox: [of, { id: 'start1', command: 'start', state: 'waiting' }], lanes, attemptOf: () => null, now: NOW, paused: true })[0].giveBack, false)
})

test('the real case, B: nobody free: the courier\'s word only while the courier calls; else the message try stays unspent for the launch', () => {
  const chats = [asleep('Lead', NOW - 40 * MIN, { isMain: true }), asleep('Digger', NOW - 30 * MIN)]
  // Review 7, 18: no courier ever called: no word, the try unspent.
  const none = refusedRecord()
  assert.deepEqual(carryPlan(none, { needs: needsOf(chats), lanes: chats, main: 'Lead', now: NOW, newId: () => 'k0', courierAlive: courierAlive(null, NOW) }), [])
  assert.equal(nextPath(none, { chat: 'Digger', spell: NOW - 30 * MIN, senderClaims: false, paths: ['message', 'launch'] }), 'launch')
  assert.equal(courierAlive(NOW - 26 * MIN, NOW), false)
  const record = refusedRecord()
  const [word] = carryPlan(record, { needs: needsOf(chats), lanes: chats, main: 'Lead', now: NOW, newId: () => 'k1', courierAlive: courierAlive(NOW - 9 * MIN, NOW) })
  assert.equal(word.to, COURIER)
  assert.equal(record.wakes.get('Digger').at(-1).attempts[0].carry, 'courier')
  assert.deepEqual(dueOf([word], NOW, { anyRuns: false }).map(one => one.id), ['k1'])
  // Review 17: once taken by the courier, never listed again; a carrier's taken word neither.
  assert.deepEqual(dueOf([{ ...word, state: 'taken', takenBy: COURIER, takenAt: NOW }], NOW + MIN), [])
  const forWorker = { ...word, id: 'k2', to: 'Worker 3' }
  assert.deepEqual(dueOf([forWorker], NOW + CARRY_DUE_MS - 1000), [])
  assert.equal(dueOf([forWorker], NOW + CARRY_DUE_MS).length, 1)
  assert.equal(dueOf([forWorker], NOW, { anyRuns: false }).length, 1)
  assert.deepEqual(dueOf([{ ...forWorker, state: 'taken', takenAt: NOW }], NOW + 30 * MIN, { anyRuns: false }), [])
  assert.deepEqual(dueOf([], NOW, { anyRuns: false }), [])
})

test('the carry words close with their purpose; a carrier that can no longer carry gives the attempt back; a carried start word closes with its word', () => {
  const word = { id: 'w1', to: 'Worker 3', command: 'wake-carry', about: 'Digger', forModel: true, state: 'waiting', at: NOW }
  const lanes = [lane('Worker 3'), asleep('Digger', NOW - 30 * MIN)]
  const pending = { verdict: null, sentAt: null }
  const closes = (outbox, at = lanes, attempt = pending) => carryCloses({ outbox, lanes: at, attemptOf: () => attempt, now: NOW })
  assert.deepEqual(closes([word]), [])
  assert.equal(closes([word], lanes, { verdict: 'woke', sentAt: NOW })[0].state, 'delivered')
  assert.match(closes([word], [lane('Worker 3'), lane('Digger')])[0].why, /Digger runs again/)
  assert.equal(closes([word], lanes, { verdict: 'failed' })[0].state, 'dropped')
  for (const quiet of [{ isRunning: false }, { report: { ...IDLE, at: NOW - 2 * MIN } }, { state: 'working', report: { ...IDLE, state: 'busy' } }]) {
    const gone = closes([word], [lane('Worker 3', quiet), asleep('Digger', NOW - 30 * MIN)])[0]
    assert.deepEqual([gone?.state, gone?.giveBack], ['dropped', true], JSON.stringify(quiet))
  }
  assert.deepEqual(closes([{ ...word, state: 'taken' }], [lane('Worker 3', { isRunning: false }), asleep('Digger', NOW - 30 * MIN)]), [], 'taken: its carrier\'s turn')
  // Review 8: a word that carries B577's wake word of a running, stopped chat.
  const wakeWord = { id: 'b577', command: 'wake', about: 'Digger', to: 'Lead', state: 'waiting', at: NOW }
  const of = { ...word, id: 'w2', of: 'b577' }
  const running = [lane('Worker 3'), lane('Digger', { state: 'working' })]
  assert.deepEqual(carryCloses({ outbox: [of, wakeWord], lanes: running, attemptOf: () => null, now: NOW }), [])
  assert.match(carryCloses({ outbox: [of, { ...wakeWord, state: 'delivered' }], lanes: running, attemptOf: () => null, now: NOW })[0].why, /the word it carried is closed/)
})

test('review 4, 15: Send again while refused is its own carried attempt, outside the per-path cap', () => {
  const record = refusedRecord()
  claim(record, { chat: 'Digger', spell: 1, path: 'message', by: 'Worker 3', jobId: 'w1', now: NOW - 20 * MIN, paths: ['message'], carry: 'model' })
  pass(record, NOW)
  const again = personAgain(record, { chat: 'Digger', spell: 1, path: 'message', by: 'Worker 3', jobId: 'w2', now: NOW, carry: 'model' })
  assert.deepEqual([again.carry, again.again], ['model', 'person'])
  assert.equal(wakeWords(statusOf(record, 'Digger'), time).text, 'waking through Worker 3\'s turn')
})

test('the wake file keeps a carried attempt, its courier take and a refused send across the board\'s restart', () => {
  const record = refusedRecord()
  claim(record, { chat: 'Digger', spell: 1, path: 'message', by: COURIER, jobId: 'k1', now: NOW, paths: ['message'], carry: 'courier' })
  record.wakes.get('Digger')[0].attempts[0].heldAt = NOW + MIN
  const back = wakesOfFile(JSON.parse(textOfWakes(record)))
  assert.equal(back.wakes.get('Old')[0].attempts[0].refused, true)
  assert.deepEqual([back.wakes.get('Digger')[0].attempts[0].carry, back.wakes.get('Digger')[0].attempts[0].heldAt], ['courier', NOW + MIN])
  assert.notEqual(sendsRefusedOf(back, []), null)
})

test('rule 8 leaves a carry word to the wake record', () => {
  const view = buildView({ state: { chats: [lane('Worker 3')], today: [], limits: {}, pause: null, chatPrefix: '', restart: { main: 'Lead' } }, items: new Map(), outbox: [], settings: {}, now: NOW })
  const word = { id: 'w1', to: COURIER, command: 'wake-carry', about: 'Digger', forModel: true, state: 'waiting', at: NOW - 30 * MIN }
  assert.equal(isUndelivered(view, word), false)
  assert.equal(isUndelivered(view, { ...word, state: 'expired' }), false)
})

test('verifier 6, 8, 10: the pause the carry words read; how a close applies against the word\'s state right before it', () => {
  assert.equal(carryPaused(null), false)
  assert.equal(carryPaused({ state: 'resuming', since: NOW }), true)
  assert.equal(carryPaused({ state: 'pausing', since: NOW }), true)
  const back = { state: 'dropped', giveBack: true }
  assert.equal(closeWay(back, 'waiting'), 'close')
  assert.equal(closeWay(back, 'taken'), null, 'a take made it its carrier\'s meanwhile: nothing closed, nothing given back')
  assert.equal(closeWay({ state: 'delivered', giveBack: false }, 'taken'), 'update')
  assert.equal(closeWay({ state: 'dropped', giveBack: false }, 'taken'), 'closeTaken')
  assert.equal(closeWay({ state: 'dropped', giveBack: false }, 'delivered'), null)
})
