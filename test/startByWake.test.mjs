// B1279 (X205, 2026-11-19): a start word to an idle Main was never taken, so a free worker never started. The live case, from
// data/wakes.json, data/board.log and data/outbox.jsonl: 20:16:47 the probe lifted the refusal of the hands' sends (written before B1271,
// so no `handSentAt`); Main's hands sent at 20:17 and 20:20 (attempts with `sentAt`, both woke their chats); 20:29:18 Worker 3's hands (a
// chat in auto mode) were refused, and that one refusal was read as the whole board's: no hand got a message, start or wake job after
// 20:29 (board.log has none), carry by model is off and the courier did not call. From 20:35 the hand-out wrote a start word for Worker 4
// to Main every 10 minutes (22 by 23:53), each one superseded, none taken, and the board showed no line about it.

import assert from 'node:assert/strict'
import test from 'node:test'

import { HAND_LINE } from '../src/hands.mjs'
import { BOARD_KEY, carryAfterSilent, carryPlan, claim, emptyWakes, lastLaunchOf, failedToSend, nextPath, noticeOf, pass, sent, wakeNeeds, wakeableOf } from '../src/wake.mjs'
import { handRefused, handWentAt, keepHandWent, noteHandRefused, noteSendLifted, sendsRefusedOf } from '../src/wakeCarry.mjs'
import { workerStart } from '../src/work/handOut.mjs'
import { START_BY_WAKE_WHY, whyClosed } from '../src/work/outboxSweep.mjs'

const at = (h, m, s = 0) => new Date(2026, 10, 19, h, m, s).getTime()
const time = ms => new Date(ms).toTimeString().slice(0, 5)
const REFUSAL = '{"deny":"PreToolUse:mcp__ccd_session_mgmt__send_message hook error: Not run: in auto mode Claude Desktop doesn\'t run this tool when a plugin\'s own code calls it. Have Claude make the call."}'
const PATHS = ['message', 'launch']

/** The live record at 20:29:18: the lift without `handSentAt`, Main's two sends as attempts only, Worker 3's refused one. */
function x205() {
  const record = emptyWakes()
  noteSendLifted(record, at(20, 16, 47))
  // Written before B1271 landed (22:41): the lift kept no `handSentAt`.
  delete record.handSentAt
  const send = (chat, by, sentAt, woke) => {
    const job = `wake:${at(19, 0)}:${chat}`
    claim(record, { chat, spell: at(19, 0), path: 'message', by, jobId: job, now: sentAt - 5000, paths: PATHS })
    sent(record, chat, job, sentAt)
    const attempt = record.wakes.get(chat).at(-1).attempts.at(-1)
    attempt.verdict = woke ? 'woke' : 'failed'
    attempt.verdictAt = sentAt + 30_000
  }
  send('Worker 5', 'Main', at(20, 17, 6), false)
  send('Supervisor', 'Main', at(20, 17, 36), true)
  send('Worker 3', 'Main', at(20, 20, 17), true)
  const job = `wake:${at(13, 7, 59)}:Worker 4`
  claim(record, { chat: 'Worker 4', spell: at(13, 7, 59), path: 'message', by: 'Worker 3', jobId: job, now: at(20, 29, 18), paths: PATHS })
  // As the board wrote it before B1271: the board's refusal, no hand's mark.
  record.sendsRefusedSince = at(20, 29, 18)
  const attempt = record.wakes.get('Worker 4').at(-1).attempts[0]
  Object.assign(attempt, { verdict: 'failed', verdictAt: at(20, 29, 18), why: 'the app no longer lets the board\'s code send to a chat', refused: true })
  return record
}

test('X205: one auto-mode hand refused after Main\'s hands sent is that hand\'s refusal, not the board\'s: the hands may send again', () => {
  const record = x205()
  assert.equal(record.handSentAt, undefined, 'the live record: no handSentAt')
  assert.equal(sendsRefusedOf(record, []), null, 'Main\'s hands sent at 20:17 and 20:20, after the lift of 20:16:47')
  // A later refusal of the same hand marks that hand only (B1271), never the board again.
  noteHandRefused(record, 'Worker 3', at(23, 55))
  assert.equal(handRefused(record, 'Worker 3'), true)
  assert.equal(handRefused(record, 'Main'), false)
  assert.equal(sendsRefusedOf(record, []), null)
})

test('X205: with no hand\'s own send since the lift, the first refusal is still the whole board\'s; a carried send is no hand\'s', () => {
  const record = x205()
  for (const entries of record.wakes.values()) for (const entry of entries) entry.attempts = entry.attempts.filter(one => one.by !== 'Main')
  assert.deepEqual(sendsRefusedOf(record, []), { since: at(20, 29, 18) })
  // A model's carried word (its sentAt is its carrier's turn) does not prove a hand may send.
  const job = 'carry-1'
  claim(record, { chat: 'Worker 1', spell: at(19, 0), path: 'message', by: 'Advisor', jobId: job, now: at(20, 40), paths: PATHS, carry: 'model' })
  sent(record, 'Worker 1', job, at(20, 41))
  assert.deepEqual(sendsRefusedOf(record, []), { since: at(20, 29, 18) })
})

/** Worker lanes as the hand-out reads them. */
const worker = (name, more = {}) => ({ name, state: 'off', isRunning: false, offSince: at(20, 0), report: { state: 'ended', at: at(13, 7, 59) }, ...more })
const ready = [{ id: 'B1279', rank: 2, keptFor: null, keptUntil: null, pinned: null }]
const base = { ready, gives: [], idle: [], maxWorkers: 5, now: at(23, 53), isHeld: false }

test('X205: the hand-out starts a worker through the wake procedure, never one it cannot wake, and counts one being woken as on its way', () => {
  const lanes = [worker('Worker 4', { offSince: at(20, 33) }), worker('Worker 1', { offSince: at(23, 27) }), { name: 'Worker 3', state: 'working', isRunning: true, report: { state: 'busy', at: at(23, 53) } }]
  // Without the wake record: as before, the worker off longest, by a word.
  assert.deepEqual(workerStart({ ...base, lanes }), { start: 'Worker 4' })
  // With it: the same worker, started by the wake procedure.
  assert.deepEqual(workerStart({ ...base, lanes, wakeable: { unwakeable: new Set(), waking: new Set() } }), { start: 'Worker 4', byWake: true })
  // Worker 4 failed every way in its spell: the next off worker that can be woken.
  assert.deepEqual(workerStart({ ...base, lanes, wakeable: { unwakeable: new Set(['Worker 4']), waking: new Set() } }), { start: 'Worker 1', byWake: true })
  // Every off worker failed every way and the last launch started nothing: none (the notice tells the person).
  assert.deepEqual(workerStart({ ...base, lanes, wakeable: { unwakeable: new Set(['Worker 4', 'Worker 1']), waking: new Set(), lastLaunch: 'failed' } }), { passedOver: ['Worker 4', 'Worker 1'] })
  // Worker 4 is being woken for the one ready task: it is on its way, no second worker is asked for.
  assert.equal(workerStart({ ...base, lanes, wakeable: { unwakeable: new Set(), waking: new Set(['Worker 4']) } }), null)
  // Two ready tasks: Worker 4 on its way, Worker 1 for the second.
  assert.deepEqual(workerStart({ ...base, ready: [...ready, { ...ready[0], id: 'B1280' }], lanes, wakeable: { unwakeable: new Set(), waking: new Set(['Worker 4']) } }), { start: 'Worker 1', byWake: true })
})

/** The board's state for wakeNeeds: Main runs, Worker 4 is off with its own app id, the hand-out's start for it. */
const stateWith = start => ({
  chats: [
    { name: 'Main', isMain: true, isRunning: true, state: 'free', appSession: 'local_main' },
    { name: 'Worker 4', isRunning: false, state: 'off', offSince: at(20, 33), report: { state: 'ended', since: at(13, 7, 59), at: at(13, 7, 59) }, appSession: 'local_6a0767ea-0335', session: '88b8fcb5-3d93-4dbf-bf1e-c492cba817b5' },
  ],
  restart: { main: 'Main' },
  reconciled: { start, startsByWake: true },
})

test('X205: the hand-out\'s start is a wake need of the worker (the start word\'s own line), only when it goes by the wake procedure', () => {
  const needs = wakeNeeds(stateWith({ start: 'Worker 4', byWake: true }), [])
  assert.equal(needs.length, 1)
  assert.deepEqual({ chat: needs[0].chat, why: needs[0].why, text: needs[0].text, paths: needs[0].paths }, { chat: 'Worker 4', why: 'start', text: HAND_LINE, paths: PATHS })
  assert.deepEqual(wakeNeeds(stateWith({ start: 'Worker 4' }), []), [], 'a start without the wake record stays a word')
  assert.deepEqual(wakeNeeds(stateWith({ start: 'Worker 1', byWake: true }), []), [])
})

test('X205: a worker whose message and launch both failed is unwakeable, the one notice says so, and the next start goes elsewhere', () => {
  const record = emptyWakes()
  const state = stateWith({ start: 'Worker 4', byWake: true })
  const lane = state.chats[1]
  const spell = at(13, 7, 59)
  const facts = { record, senderClaims: true, canLaunch: true }
  // 23:55 a hand's message for the start, 23:55 sent.
  claim(record, { chat: 'Worker 4', spell, path: 'message', by: 'Main', jobId: 'wake:w4', now: at(23, 55), paths: PATHS })
  sent(record, 'Worker 4', 'wake:w4', at(23, 55, 10))
  assert.deepEqual(wakeableOf(state.chats, facts), { unwakeable: new Set(), waking: new Set(['Worker 4']), lastLaunch: null })
  // No report in 2 minutes: failed; the launch is left, so it is not unwakeable yet.
  pass(record, at(23, 58))
  assert.deepEqual(wakeableOf(state.chats, facts), { unwakeable: new Set(), waking: new Set(), lastLaunch: null })
  // The launch, which the app does not start (since the account switch).
  claim(record, { chat: 'Worker 4', spell, path: 'launch', by: 'board', jobId: 'launch:w4', now: at(23, 58), paths: PATHS })
  assert.deepEqual(wakeableOf(state.chats, facts).waking, new Set(['Worker 4']))
  failedToSend(record, 'Worker 4', 'launch:w4', 'the app did not start it', at(0, 1))
  record.wakes.get('Worker 4').at(-1).attempts.at(-1).verdictAt = at(23, 59) + 2 * 60_000
  assert.deepEqual(wakeableOf(state.chats, facts), { unwakeable: new Set(['Worker 4']), waking: new Set(), lastLaunch: 'failed' })
  const need = wakeNeeds(state, [])[0]
  const notice = noticeOf(record, [{ ...need, need: true }], at(0, 5), time, { senderClaims: true })
  assert.equal(notice.tone, 'attention')
  assert.match(notice.text, /^could not wake Worker 4: no report after the message \(sent 23:55 by Main\); the app did not start it.*; open its chat$/)
  // A chat that ran since its failed wake is no longer unwakeable.
  assert.deepEqual(wakeableOf([{ ...lane, report: { state: 'idle', at: at(0, 10), run: at(0, 9) } }], facts).unwakeable, new Set())
  assert.deepEqual(wakeableOf(state.chats, { ...facts, record: null }), { unwakeable: new Set(), waking: new Set(), lastLaunch: null })
})

test("B1304 (B1279's point 2): when no off worker can be woken, a new one only when the last launch did start a chat, else none", () => {
  const lanes = [worker('Worker 4', { offSince: at(20, 33) }), { name: 'Worker 3', state: 'working', isRunning: true, report: { state: 'busy', at: at(23, 53) } }]
  const gone = { unwakeable: new Set(['Worker 4']), waking: new Set() }
  // Worker 4's chat is gone (every way failed), but launches do start chats: a replacement, and the notice still names Worker 4.
  assert.deepEqual(workerStart({ ...base, lanes, wakeable: { ...gone, lastLaunch: 'started' } }), { spawn: 1, passedOver: ['Worker 4'] })
  // The last launch started nothing (X205: since the account switch): none, only the notice.
  assert.deepEqual(workerStart({ ...base, lanes, wakeable: { ...gone, lastLaunch: 'failed' } }), { passedOver: ['Worker 4'] })
  // No off worker at all: a new one only while launches start chats.
  const busy = [lanes[1]]
  assert.deepEqual(workerStart({ ...base, lanes: busy, wakeable: { unwakeable: new Set(), waking: new Set(), lastLaunch: 'started' } }), { spawn: 1 })
  assert.equal(workerStart({ ...base, lanes: busy, wakeable: { unwakeable: new Set(), waking: new Set(), lastLaunch: 'failed' } }), null)
  // No launch has a verdict yet: nothing says launches fail, so a new one is asked for (as before B1279).
  assert.deepEqual(workerStart({ ...base, lanes: busy, wakeable: { unwakeable: new Set(), waking: new Set(), lastLaunch: null } }), { spawn: 1 })
  // Without the wake record: as before.
  assert.deepEqual(workerStart({ ...base, lanes: busy }), { spawn: 1 })
})

test("B1304: the last launch is the record's newest launch with a verdict, of any chat or the board-wide spell", () => {
  const record = emptyWakes()
  assert.equal(lastLaunchOf(record), null)
  const launch = (chat, spell, now, verdict, verdictAt) => {
    claim(record, { chat, spell, path: 'launch', by: 'board', jobId: `launch:${now}:${chat}`, now, paths: ['launch'] })
    Object.assign(record.wakes.get(chat).at(-1).attempts.at(-1), { verdict, verdictAt })
  }
  launch('Worker 4', at(13, 7), at(22, 18), 'failed', at(22, 21))
  assert.equal(lastLaunchOf(record), 'failed')
  launch('Worker 2', at(20, 0), at(22, 30), 'woke', at(22, 31))
  assert.equal(lastLaunchOf(record), 'started')
  // A pending launch has no verdict yet: the last one with a verdict stands.
  claim(record, { chat: 'Worker 1', spell: at(21, 0), path: 'launch', by: 'board', jobId: 'launch:w1', now: at(22, 40), paths: ['launch'] })
  assert.equal(lastLaunchOf(record), 'started')
  launch(BOARD_KEY, at(22, 45), at(22, 50), 'failed', at(22, 53))
  assert.equal(lastLaunchOf(record), 'failed')
  // Through the hand-out's facts.
  assert.equal(wakeableOf([], { record, senderClaims: true, canLaunch: true }).lastLaunch, 'failed')
})

test('X205: a start word of the hand-out still waiting is closed once the wake procedure starts workers; another start word stays', () => {
  const word = { id: 'c92b92a697deb4ea', command: 'start', to: 'Main', about: 'Worker 4', state: 'waiting', at: at(23, 53), reported: 3 }
  const ctx = extra => ({ all: [word], items: null, runs: new Map(), goals: [], now: at(23, 54), keep: {}, closing: new Set(), prefix: '', ready, main: 'Main', off: new Set(['Worker 4']), handedBack: [], lanes: [], onBoard: new Set(), supervisor: null, ...extra })
  assert.deepEqual(whyClosed(word, ctx({ startsByWake: true })), { state: 'dropped', why: START_BY_WAKE_WHY })
  assert.equal(whyClosed(word, ctx({ startsByWake: false })), null, 'without the wake record it waits as before')
  // The page's start of a chat (no `reported`) is not the hand-out's: it stays the hands'.
  const { reported: _gone, ...pageStart } = word
  assert.equal(whyClosed(pageStart, { ...ctx({ startsByWake: true }), all: [pageStart], ready: [{ ...ready[0], pinned: 'Worker 4' }] }), null)
})

test("X205: a hand's send that went and brought no report is followed by ONE carry word before the launch; never a hand's again", () => {
  const record = emptyWakes()
  const spell = at(20, 44)
  const need = { chat: 'Worker 4', spell, paths: PATHS, appSession: 'local_00000000-0000-4000-8000-000000000004', text: HAND_LINE }
  // 22:15 Main's hand sends the wake; it goes, and no report comes.
  claim(record, { chat: 'Worker 4', spell, path: 'message', by: 'Main', jobId: 'wake:w4', now: at(22, 15), paths: PATHS })
  sent(record, 'Worker 4', 'wake:w4', at(22, 15, 5))
  assert.equal(carryAfterSilent(record, need), false) // still waiting for its report
  pass(record, at(22, 18))
  assert.equal(record.wakes.get('Worker 4').at(-1).attempts[0].verdict, 'failed')
  assert.equal(carryAfterSilent(record, need), true)
  assert.equal(nextPath(record, { ...need, senderClaims: true, carry: true }), 'message')
  assert.equal(nextPath(record, { ...need, senderClaims: true }), 'launch') // what a hand or the launch plan reads
  // No hand gets the same message again in the spell.
  assert.equal(claim(record, { chat: 'Worker 4', spell, path: 'message', by: 'Worker 2', jobId: 'wake:w4b', now: at(22, 18), paths: PATHS }), false)
  // The carry pass: the courier calls, no free chat: one word, claimed in the record; the launch waits for its verdict.
  const words = carryPlan(record, { needs: [need], lanes: [], now: at(22, 18), newId: () => 'c1', courierAlive: true })
  assert.equal(words.length, 1)
  assert.equal(words[0].about, 'Worker 4')
  assert.equal(record.wakes.get('Worker 4').at(-1).attempts.at(-1).carry, 'courier')
  assert.equal(nextPath(record, { ...need, senderClaims: true }), null)
  assert.equal(carryPlan(record, { needs: [need], lanes: [], now: at(22, 19), newId: () => 'c2', courierAlive: true }).length, 0)
  // Nobody to carry it: the try stays unspent and the launch goes as before.
  const lone = emptyWakes()
  claim(lone, { chat: 'Worker 4', spell, path: 'message', by: 'Main', jobId: 'wake:w4', now: at(22, 15), paths: PATHS })
  sent(lone, 'Worker 4', 'wake:w4', at(22, 15, 5))
  pass(lone, at(22, 18))
  assert.deepEqual(carryPlan(lone, { needs: [need], lanes: [], now: at(22, 18), newId: () => 'c3', courierAlive: false }), [])
  assert.equal(nextPath(lone, { ...need, senderClaims: true }), 'launch')
  // The carried word brought no report either: the launch is next, never a third message.
  const carried = record.wakes.get('Worker 4').at(-1).attempts.at(-1)
  Object.assign(carried, { sentAt: at(22, 20), verdict: 'failed', verdictAt: at(22, 26) })
  assert.equal(carryAfterSilent(record, need), false)
  assert.equal(nextPath(record, { ...need, senderClaims: true, carry: true }), 'launch')
  // A refused hand's try is no silent send: B1271's way (another hand, or a carry word while every hand is refused) stays.
  const refused = emptyWakes()
  claim(refused, { chat: 'Worker 4', spell, path: 'message', by: 'Worker 3', jobId: 'wake:r', now: at(22, 15), paths: PATHS })
  Object.assign(refused.wakes.get('Worker 4').at(-1).attempts[0], { verdict: 'failed', verdictAt: at(22, 15), refused: true })
  assert.equal(carryAfterSilent(refused, need), false)
})

test("X205 (review, minor): the hand's send the attempts prove is kept as handSentAt, so pruning the attempts never revives the board's refusal", () => {
  const record = x205()
  assert.equal(record.handSentAt, undefined)
  assert.equal(handWentAt(record), at(20, 20, 17))
  assert.equal(keepHandWent(record), true)
  assert.equal(record.handSentAt, at(20, 20, 17))
  assert.equal(keepHandWent(record), false, 'once is enough')
  // The record pruned the spells that proved it: the refusal is still one hand's.
  record.wakes.clear()
  assert.equal(sendsRefusedOf(record), null)
})
