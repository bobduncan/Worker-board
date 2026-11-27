// P2.1 (chat 3, 2026-11-27, "Repeating incidents fixed at the root, failed wakes first"): the recorded wakes of 2026-11-25..27, replayed.
// Nine of the ten message failures of those days were the app's send answering "not delivered: that session gave no sign of starting on
// it within 20s", and the lane log shows the chat came up 40-60 s after every one of them: Worker 4 "failed" 14:03:22 and working 14:04:15
// with no launch made; Main "failed" 09:58:00, working 09:58:46; the Advisor "failed" 09:49:21, launched 09:49:42, "woke" 09:49:43, one
// second after a launch, which a launch cannot do. The answer is a sent message, not a verdict; the chat's own report judges it.

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SLOW_START_WHY, VERDICTS, WAKE_VERDICT_MS, claim, emptyWakes, failedToSend, heard, isSlowStart, nextPath, outcomeOf, pass, sent, statusOf, textOfWakes,
  triedWords, wakeJobId, wakeOf, wakesOfFile, wakeWords,
} from '../src/wake.mjs'
import { handWentAt, isHandSend, isSendThatWent, isSilentSend } from '../src/wakeCarry.mjs'

const at = (day, h, m, s = 0) => new Date(2026, 10, day, h, m, s).getTime()
const time = ms => `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`
/** The app's answer as the hands brought it (the session id and the project's name replaced). */
const SLOW_ANSWER = chat => `Message not delivered to session local_00000000-0000-4000-8000-000000000000 ("Project - ${chat}"): "that session gave no sign of starting on it within 20s (it may be waiting for approval there, or still starting)". (delivery: undelivered; message_id: 00000000-0000-4000-8000-000000000001)`
const RUN_OLD = 'run-before'
const RUN_NEW = 'run-after'
const PATHS = ['message', 'launch']

test('isSlowStart: the app\'s 20-second answer, and nothing else (a refusal, "not found", the plain "not sent")', () => {
  assert.equal(isSlowStart(SLOW_ANSWER('Advisor')), true)
  assert.equal(isSlowStart('that session gave no sign of starting on it within 20s'), true)
  assert.equal(isSlowStart('Message not delivered: session local_x not found. (delivery: undelivered)'), false)
  assert.equal(isSlowStart('PreToolUse:mcp__ccd_session_mgmt__send_message hook error: Not run: in auto mode Claude Desktop doesn\'t run this tool when a plugin\'s own code calls it. Have Claude make the call.'), false)
  assert.equal(isSlowStart('not sent'), false)
  assert.equal(isSlowStart(null), false)
})

test('the Advisor, 2026-11-27 09:49: the slow answer is a sent message (pending, no launch), and the report of 09:49:43 is the message\'s wake', () => {
  const record = emptyWakes()
  const spell = at(26, 23, 53, 46)
  const job = wakeJobId(spell, 'Advisor')
  assert.ok(claim(record, { chat: 'Advisor', spell, path: 'message', by: 'Worker 2', jobId: job, now: at(27, 9, 49, 1), runBefore: RUN_OLD }))
  const answered = failedToSend(record, 'Advisor', job, SLOW_ANSWER('Advisor'), at(27, 9, 49, 21))
  assert.equal(answered.verdict, null, 'no verdict from the app\'s answer')
  assert.equal(answered.sentAt, at(27, 9, 49, 21))
  assert.equal(answered.slow, true)
  assert.equal(answered.why, null)
  assert.equal(handWentAt(record), at(27, 9, 49, 21), 'the record reads it as a send that went (the lift of the refusal)')
  const status = statusOf(record, 'Advisor', spell)
  assert.equal(status.state, 'sent')
  assert.equal(status.slow, true)
  assert.equal(wakeWords(status, time).text, `waking · message sent 09:49 by Worker 2 (${SLOW_START_WHY})`)
  // The launch of 09:49:42 is not made: a message is pending.
  assert.equal(nextPath(record, { chat: 'Advisor', spell, senderClaims: true, paths: PATHS }), null)
  assert.equal(claim(record, { chat: 'Advisor', spell, path: 'launch', by: 'board', jobId: `launch:${at(27, 9, 49, 42)}:Advisor`, now: at(27, 9, 49, 42), runBefore: RUN_OLD, paths: ['launch'] }), false)
  assert.deepEqual(pass(record, at(27, 9, 49, 42)), [], 'within the 2 minutes: nothing fails')
  // Its own report from a new process, 22 s after the answer: woke, by the message.
  const woke = heard(record, 'Advisor', { state: 'busy', run: RUN_NEW, at: at(27, 9, 49, 43) }, at(27, 9, 49, 43))
  assert.equal(woke?.verdict, 'woke')
  assert.equal(woke.path, 'message')
  assert.equal(statusOf(record, 'Advisor', spell).state, 'woke')
  assert.equal(wakeOf(record, { chat: 'Advisor', spell, paths: PATHS }, { senderClaims: true }).final, false)
  // The outcome line: arrived after a slow answer, 22 s after the send's answer.
  assert.deepEqual(outcomeOf(record, 'Advisor', woke), {
    at: at(27, 9, 49, 43), chat: 'Advisor', spell, path: 'message', by: 'Worker 2', carry: null, outcome: 'arrived', slow: true, afterMs: 22_000, why: null,
  })
})

test('Main, 2026-11-26 10:04: the same with the launch the board made at 10:05:25: it is refused while the message is pending, and the report of 10:05:33 is the message\'s', () => {
  const record = emptyWakes()
  const spell = at(26, 10, 3, 38)
  const job = wakeJobId(spell, 'Main')
  claim(record, { chat: 'Main', spell, path: 'message', by: 'Worker 3', jobId: job, now: at(26, 10, 4, 10), runBefore: RUN_OLD })
  failedToSend(record, 'Main', job, SLOW_ANSWER('Main'), at(26, 10, 4, 32))
  assert.equal(claim(record, { chat: 'Main', spell, path: 'launch', by: 'board', jobId: 'launch-1', now: at(26, 10, 5, 25), paths: ['launch'] }), false)
  const woke = heard(record, 'Main', { state: 'busy', run: RUN_NEW, at: at(26, 10, 5, 33) }, at(26, 10, 5, 33))
  assert.equal(woke.path, 'message')
  assert.equal(outcomeOf(record, 'Main', woke).afterMs, 61_000)
  assert.equal(record.wakes.get('Main').at(-1).attempts.length, 1, 'no launch in the record')
})

test('Worker 4, 2026-11-26 14:03, altered to never report (chat 1\'s addition 1, its decision 1): after the 2 minutes the message fails as any sent message and the launch follows at once (no carry word: the app said the chat did not start), then the final verdict', () => {
  const record = emptyWakes()
  const spell = at(26, 14, 2, 51)
  const job = wakeJobId(spell, 'Worker 4')
  claim(record, { chat: 'Worker 4', spell, path: 'message', by: 'Worker 1', jobId: job, now: at(26, 14, 3, 2), runBefore: RUN_OLD })
  failedToSend(record, 'Worker 4', job, SLOW_ANSWER('Worker 4'), at(26, 14, 3, 22))
  assert.deepEqual(pass(record, at(26, 14, 3, 22) + WAKE_VERDICT_MS - 1000), [])
  const failed = pass(record, at(26, 14, 3, 22) + WAKE_VERDICT_MS)
  assert.equal(failed.length, 1)
  assert.equal(failed[0].attempt.why, 'no report within 2 minutes of the message')
  assert.deepEqual(triedWords(failed[0].attempt ? record.wakes.get('Worker 4').at(-1).attempts : [], time), ['no report after the message (sent 14:03 by Worker 1)'])
  assert.deepEqual(outcomeOf(record, 'Worker 4', failed[0].attempt), {
    at: at(26, 14, 5, 22), chat: 'Worker 4', spell, path: 'message', by: 'Worker 1', carry: null, outcome: 'failed', slow: true, afterMs: WAKE_VERDICT_MS, why: 'no report within 2 minutes of the message',
  })
  // Chat 1's decision 1: no B1279 carry word after a slow silence (the app itself said the session did not start): the launch, at once.
  assert.equal(nextPath(record, { chat: 'Worker 4', spell, senderClaims: true, paths: PATHS, carry: true }), 'launch')
  assert.equal(isSilentSend(record.wakes.get('Worker 4').at(-1).attempts[0]), false, 'a slow send earns no carry word')
  assert.equal(isSendThatWent(record.wakes.get('Worker 4').at(-1).attempts[0]), true, 'but it went: it lifts the hand\'s refusal mark')
  assert.equal(nextPath(record, { chat: 'Worker 4', spell, senderClaims: true, paths: PATHS }), 'launch')
  assert.equal(nextPath(record, { chat: 'Worker 4', spell, senderClaims: false, paths: PATHS }), 'launch')
  const launch = claim(record, { chat: 'Worker 4', spell, path: 'launch', by: 'board', jobId: 'launch-w4', now: at(26, 14, 5, 30), runBefore: RUN_OLD, paths: ['launch'] })
  assert.ok(launch)
  sent(record, 'Worker 4', 'launch-w4', at(26, 14, 5, 31))
  const launchFailed = pass(record, at(26, 14, 5, 31) + WAKE_VERDICT_MS)
  assert.equal(launchFailed[0]?.attempt.why, 'the app did not start it')
  const final = wakeOf(record, { chat: 'Worker 4', spell, paths: PATHS }, { senderClaims: true })
  assert.equal(final.state, 'failed')
  assert.equal(final.final, true, 'every path spent: could not wake')
  assert.equal(outcomeOf(record, 'Worker 4', launchFailed[0].attempt).outcome, 'failed')
  assert.equal(outcomeOf(record, 'Worker 4', launchFailed[0].attempt).slow, false)
})

test('a launch that works is recorded as the wake it was (chat 1: "today nobody knows if launches work at all"), and an attempt without a verdict has no outcome line', () => {
  const record = emptyWakes()
  const spell = at(25, 13, 48, 3)
  const launch = claim(record, { chat: 'Worker 3', spell, path: 'launch', by: 'board', jobId: 'l', now: at(25, 13, 51, 44), runBefore: RUN_OLD, paths: ['launch'] })
  assert.equal(outcomeOf(record, 'Worker 3', launch), null)
  sent(record, 'Worker 3', 'l', at(25, 13, 51, 45))
  const woke = heard(record, 'Worker 3', { state: 'busy', run: RUN_NEW, at: at(25, 13, 52, 10) }, at(25, 13, 52, 10))
  assert.deepEqual(outcomeOf(record, 'Worker 3', woke), {
    at: at(25, 13, 52, 10), chat: 'Worker 3', spell, path: 'launch', by: 'board', carry: null, outcome: 'arrived', slow: false, afterMs: 25_000, why: null,
  })
  assert.equal(outcomeOf(record, 'Worker 3', null), null)
})

test('the other recorded shapes keep their verdicts: a refusal (X191) and "not found" (X154) are failed at once, a plain "not sent" too', () => {
  const record = emptyWakes()
  const spell = at(14, 8, 40)
  claim(record, { chat: 'Worker 2', spell, path: 'message', by: 'Worker 4', jobId: 'r', now: at(14, 8, 43), runBefore: RUN_OLD })
  const refused = failedToSend(record, 'Worker 2', 'r', '{"deny":"PreToolUse:mcp__ccd_session_mgmt__send_message hook error: Not run: in auto mode Claude Desktop doesn\'t run this tool when a plugin\'s own code calls it. Have Claude make the call."}', at(14, 8, 43, 5))
  assert.equal(refused.verdict, 'failed')
  assert.equal(refused.refused, true)
  assert.equal(refused.slow, undefined)
  claim(record, { chat: 'Worker 5', spell, path: 'message', by: 'Main', jobId: 'n', now: at(5, 20, 33), runBefore: RUN_OLD })
  const unlisted = failedToSend(record, 'Worker 5', 'n', 'Message not delivered: session local_88208666-fd8c-43e5-8f6a-b0b847115ba7 not found. (delivery: undelivered; message_id: x)', at(5, 20, 33, 5))
  assert.equal(unlisted.verdict, 'failed')
  assert.equal(unlisted.unlisted, true)
  assert.equal(nextPath(record, { chat: 'Worker 5', spell, senderClaims: true, paths: PATHS }), null, 'B986: nothing more in this spell')
  claim(record, { chat: 'Worker 1', spell, path: 'message', by: 'Main', jobId: 'p', now: at(5, 20, 33), runBefore: RUN_OLD })
  assert.equal(failedToSend(record, 'Worker 1', 'p', 'the tool failed', at(5, 20, 33, 5)).verdict, 'failed')
  // A slow answer to a message already sent (the hand said ok, then the app's late words) changes nothing of it.
  claim(record, { chat: 'Worker 3', spell, path: 'message', by: 'Main', jobId: 's', now: at(5, 20, 40), runBefore: RUN_OLD })
  sent(record, 'Worker 3', 's', at(5, 20, 40, 2))
  const late = failedToSend(record, 'Worker 3', 's', SLOW_ANSWER('Worker 3'), at(5, 20, 40, 22))
  assert.equal(late.verdict, 'failed', 'a second answer after the hand\'s ok is the hand\'s failure, as before')
  assert.equal(late.slow, undefined)
})

test('a plain hand\'s send that went silent still gets its one carry word (B1279 stands for the sends the app did not judge); the two concepts live in wakeCarry.mjs', () => {
  const record = emptyWakes()
  const spell = at(26, 14, 2, 51)
  claim(record, { chat: 'Worker 4', spell, path: 'message', by: 'Worker 1', jobId: 'p', now: at(26, 14, 3, 2), runBefore: RUN_OLD })
  const [attempt] = record.wakes.get('Worker 4').at(-1).attempts
  assert.deepEqual([isHandSend(attempt), isSendThatWent(attempt), isSilentSend(attempt)], [true, false, false], 'claimed, not sent')
  sent(record, 'Worker 4', 'p', at(26, 14, 3, 5))
  assert.deepEqual([isSendThatWent(attempt), isSilentSend(attempt)], [true, false], 'went, no verdict yet')
  pass(record, at(26, 14, 3, 5) + WAKE_VERDICT_MS)
  assert.equal(isSilentSend(attempt), true, 'went silent: it earns the carry word')
  assert.equal(nextPath(record, { chat: 'Worker 4', spell, senderClaims: true, paths: PATHS, carry: true }), 'message')
  assert.equal(nextPath(record, { chat: 'Worker 4', spell, senderClaims: true, paths: PATHS }), 'launch')
  // Not a hand's send: a carried word, a refused send, a launch. A slow answer went, but is no silent send.
  for (const other of [{ ...attempt, carry: 'courier' }, { ...attempt, refused: true }, { ...attempt, path: 'launch' }]) assert.deepEqual([isHandSend(other), isSendThatWent(other), isSilentSend(other)], [false, false, false])
  assert.deepEqual([isSendThatWent({ ...attempt, slow: true }), isSilentSend({ ...attempt, slow: true })], [true, false])
  assert.deepEqual(VERDICTS, ['woke', 'failed'])
})

test('chat 1\'s review 4 and a: a chat that woke by itself (a carried word nobody held yet) is its own outcome; a hand\'s message whose ok is still on the way, or a word a carrier holds, is an arrival', () => {
  const record = emptyWakes()
  const spell = at(25, 20, 22, 42)
  // A courier word not taken yet when the chat's own report comes (`heard` marks it `self`).
  claim(record, { chat: 'Worker 2', spell, path: 'message', by: 'the courier', jobId: 'c', now: at(25, 21, 0), runBefore: RUN_OLD, carry: 'courier' })
  const selfWoke = heard(record, 'Worker 2', { state: 'busy', run: RUN_NEW, at: at(25, 21, 1) }, at(25, 21, 1))
  assert.equal(selfWoke.self, true)
  assert.equal(outcomeOf(record, 'Worker 2', selfWoke).outcome, 'self')
  // A courier word the courier already holds (`heldAt`): on its way, an arrival.
  const held = claim(record, { chat: 'Worker 4', spell, path: 'message', by: 'the courier', jobId: 'k', now: at(25, 21, 0), runBefore: RUN_OLD, carry: 'courier' })
  held.heldAt = at(25, 21, 0, 20)
  const heldWoke = heard(record, 'Worker 4', { state: 'busy', run: RUN_NEW, at: at(25, 21, 0, 50) }, at(25, 21, 0, 50))
  assert.deepEqual([heldWoke.self, heldWoke.carry, outcomeOf(record, 'Worker 4', heldWoke).outcome], [undefined, 'courier', 'arrived'])
  // A hand's message claimed, its ok still on the way when the report comes (the mod posts its results after its round): an arrival.
  claim(record, { chat: 'Worker 3', spell, path: 'message', by: 'Worker 1', jobId: 'h', now: at(25, 21, 0), runBefore: RUN_OLD })
  const early = heard(record, 'Worker 3', { state: 'busy', run: RUN_NEW, at: at(25, 21, 0, 30) }, at(25, 21, 0, 30))
  assert.equal(early.verdict, 'woke')
  assert.equal(outcomeOf(record, 'Worker 3', early).outcome, 'arrived')
  // A sent message's report: arrived.
  claim(record, { chat: 'Worker 5', spell, path: 'message', by: 'Worker 1', jobId: 's', now: at(25, 21, 0), runBefore: RUN_OLD })
  sent(record, 'Worker 5', 's', at(25, 21, 0, 5))
  assert.equal(outcomeOf(record, 'Worker 5', heard(record, 'Worker 5', { state: 'busy', run: RUN_NEW, at: at(25, 21, 0, 40) }, at(25, 21, 0, 40))).outcome, 'arrived')
})

test('the file keeps the slow mark', () => {
  const record = emptyWakes()
  const spell = at(27, 11, 56, 38)
  claim(record, { chat: 'Advisor', spell, path: 'message', by: 'Worker 2', jobId: 'f', now: at(27, 13, 12, 45), runBefore: RUN_OLD })
  failedToSend(record, 'Advisor', 'f', SLOW_ANSWER('Advisor'), at(27, 13, 13, 3))
  const read = wakesOfFile(JSON.parse(textOfWakes(record)))
  const kept = read.wakes.get('Advisor').at(-1).attempts.at(-1)
  assert.equal(kept.slow, true)
  assert.equal(kept.sentAt, at(27, 13, 13, 3))
  assert.equal(kept.verdict, null)
  assert.equal(statusOf(read, 'Advisor', spell).slow, true)
  // An attempt without the mark reads without it.
  const plain = wakesOfFile(JSON.parse(textOfWakes(record).replace('"slow":true,', '').replace(',"slow":true', '')))
  assert.equal(plain.wakes.get('Advisor').at(-1).attempts.at(-1).slow, undefined)
})
