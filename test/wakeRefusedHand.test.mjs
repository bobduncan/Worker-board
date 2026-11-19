// B1271 (X203, 2026-11-19): a wake the app refuses is retried another way, never the same way again. The live case, from data/wakes.json
// and data/board.log: Worker 4 asleep since 13:07:59; 20:16:47 the probe through the Advisor's hands lifted the refusal; Main's hands sent
// at 20:17 and 20:20; 20:29:18 Worker 3's hands (a chat in auto mode) were refused; 20:30 the launch, failed 20:33 ("the app did not start
// it"); 20:35 the start word to an idle Main waited untaken.

import assert from 'node:assert/strict'
import test from 'node:test'

import { claim, emptyWakes, failedToSend, handTried, launchPlan, nextPath, sent, textOfWakes, wakeOf, wakesOfFile, carryPlan, triedWords } from '../src/wake.mjs'
import { SEND_REFUSED_WHY, handRefused, noteHandRefused, noteHandSent, noteSendLifted, probeDue, sendsRefusedOf } from '../src/wakeCarry.mjs'
import { WATCH_RULES } from '../src/supervisor/rules/watch.mjs'
import { PROBE_MS } from '../src/work/effort.mjs'

const MIN = 60_000
const at = (h, m, s = 0) => new Date(2026, 10, 19, h, m, s).getTime()
const time = ms => new Date(ms).toTimeString().slice(0, 5)
/** The refusal exactly as Worker 3's hands carried it into board.log at 20:29. */
const REFUSAL = '{"deny":"PreToolUse:mcp__ccd_session_mgmt__send_message hook error: Not run: in auto mode Claude Desktop doesn\'t run this tool when a plugin\'s own code calls it. Have Claude make the call."}'
const SPELL = at(13, 7, 59)
const PATHS = ['message', 'launch']
const W4 = { chat: 'Worker 4', spell: SPELL, paths: PATHS }

/** The record at 20:29:18, right after Worker 3's hands were refused. */
function x203() {
  const record = emptyWakes()
  // 20:16:47: the probe's send went (the Advisor's hands): the refusal lifted.
  noteSendLifted(record, at(20, 16, 47))
  // 20:17 and 20:20: Main's hands sent (Supervisor, Worker 3 woke).
  noteHandSent(record, 'Main', at(20, 17))
  noteHandSent(record, 'Main', at(20, 20))
  // 20:29:18: Worker 3's hands take Worker 4's wake; the app refuses the call.
  const job = `wake:${SPELL}:Worker 4`
  assert.ok(claim(record, { chat: 'Worker 4', spell: SPELL, path: 'message', by: 'Worker 3', jobId: job, now: at(20, 29, 18), paths: PATHS }))
  failedToSend(record, 'Worker 4', job, REFUSAL, at(20, 29, 18))
  return record
}

test('X203: one hand refused after the probe lifted it: only that hand is marked; the board still sends by code', () => {
  const record = x203()
  assert.equal(handRefused(record, 'Worker 3'), true)
  assert.equal(handRefused(record, 'Main'), false)
  assert.equal(sendsRefusedOf(record, []), null, 'Main\'s hands sent at 20:20: one auto-mode hand is not the whole board')
  // The attempt keeps the refusal plainly, in the record and in what was tried.
  const attempt = record.wakes.get('Worker 4').at(-1).attempts[0]
  assert.deepEqual([attempt.refused, attempt.why], [true, SEND_REFUSED_WHY])
  assert.match(triedWords([attempt], time).join(), /20:29 by Worker 3: the app no longer lets the board's code send to a chat/)
})

test('X203: the refused send spends no message try: the message goes again (by another hand), not the launch', () => {
  const record = x203()
  assert.equal(nextPath(record, { ...W4, senderClaims: true }), 'message', 'Main\'s hands may send: the message, not the launch')
  assert.equal(launchPlan(record, { needs: [{ ...W4, session: 'cli-w4' }], senderClaims: true }), null, 'no launch while a hand that may send claims')
  // Never the same way twice: Worker 3's hands tried it; Main's did not.
  assert.equal(handTried(record, { chat: 'Worker 4', spell: SPELL, hand: 'Worker 3' }), true)
  assert.equal(handTried(record, { chat: 'Worker 4', spell: SPELL, hand: 'Main' }), false)
  // Main's hands take it at the next claim, and it goes.
  const job = `wake:${SPELL}:Worker 4`
  const second = claim(record, { chat: 'Worker 4', spell: SPELL, path: 'message', by: 'Main', jobId: job, now: at(20, 29, 30), paths: PATHS })
  assert.equal(second.by, 'Main')
  sent(record, 'Worker 4', job, at(20, 29, 31))
  assert.equal(wakeOf(record, W4, { senderClaims: true }).state, 'sent')
})

test('X203: no hand that may send claims (only the refused one): the launch goes, and after it failed the wake is final, said once', () => {
  const record = x203()
  assert.equal(nextPath(record, { ...W4, senderClaims: false }), 'launch')
  const plan = launchPlan(record, { needs: [{ ...W4, session: 'cli-w4' }], senderClaims: false })
  assert.deepEqual([plan.chat, plan.spell], ['Worker 4', SPELL])
  claim(record, { chat: 'Worker 4', spell: SPELL, path: 'launch', by: 'board', jobId: 'launch:1', now: at(20, 30, 14), paths: PATHS })
  failedToSend(record, 'Worker 4', 'launch:1', 'the app did not start it', at(20, 33, 14))
  // The launch is not tried again in the spell; the message waits for a hand that may send (or a carry word).
  assert.equal(nextPath(record, { ...W4, senderClaims: false }), null)
  const wake = wakeOf(record, W4, { senderClaims: false })
  assert.equal(wake.final, true)
  assert.equal(wakeOf(record, W4, { senderClaims: true }).next, 'message', 'a hand that may send still takes the message')
})

test('X203: every hand that claims is refused: the message goes as ONE carry word (a free chat\'s model, else the courier), before any launch', () => {
  const record = x203()
  const lanes = [{ name: 'Main', isMain: true, isLeftover: false, isRunning: true, state: 'free', appSession: 'local_main', unjoined: null, report: { state: 'idle', at: at(20, 29, 40), background: false } }]
  const needs = [{ ...W4, appSession: 'local_6a0767ea-0335-43cf-9a6b-988904461d3a', text: 'The worker board holds words for you: run work next', why: 'envelope', step: null }]
  let n = 0
  const words = carryPlan(record, { needs, lanes, main: 'Main', now: at(20, 29, 45), newId: () => `c${(n += 1)}`, courierAlive: false, byModel: true })
  assert.equal(words.length, 1)
  assert.deepEqual([words[0].to, words[0].about, words[0].session], ['Main', 'Worker 4', 'local_6a0767ea-0335-43cf-9a6b-988904461d3a'])
  assert.equal(carryPlan(record, { needs, lanes, main: 'Main', now: at(20, 30), newId: () => 'again', courierAlive: true, byModel: true }).length, 0, 'never a second word in the spell')
})

test('the first refusal after an update (no hand sent since the lift) is still the whole board\'s; a probe of the refused hand lifts its mark', () => {
  const record = emptyWakes()
  noteSendLifted(record, at(8, 0))
  assert.equal(noteHandRefused(record, 'Worker 4', at(8, 0)), true)
  // The probe's own send counts as a hand's send at the lift: a refusal at that very moment by another hand is that hand's.
  assert.equal(sendsRefusedOf(record, []), null)
  const fresh = emptyWakes()
  noteHandRefused(fresh, 'Worker 4', at(8, 13))
  assert.deepEqual(sendsRefusedOf(fresh, []), { since: at(8, 13) }, 'never lifted: the board\'s refusal, as F17')
  // A refused hand alone: its own probe once a day.
  const record2 = x203()
  assert.equal(probeDue(record2, [], at(20, 40), 'Worker 3'), false)
  assert.equal(probeDue(record2, [], at(20, 29, 18) + PROBE_MS, 'Worker 3'), true)
  assert.equal(probeDue(record2, [], at(20, 29, 18) + PROBE_MS, 'Main'), false, 'Main is not refused')
  record2.probeBy = { 'Worker 3': at(20, 29, 18) + PROBE_MS }
  assert.equal(probeDue(record2, [], at(20, 29, 18) + PROBE_MS + MIN, 'Worker 3'), false, 'once a day')
  noteHandSent(record2, 'Worker 3', at(20, 29, 18) + PROBE_MS + 2 * MIN)
  assert.equal(handRefused(record2, 'Worker 3'), false)
})

test('the hands\' marks survive the board\'s restart', () => {
  const record = x203()
  record.probeBy = { 'Worker 3': at(20, 40) }
  const back = wakesOfFile(JSON.parse(textOfWakes(record)))
  assert.equal(handRefused(back, 'Worker 3'), true)
  assert.equal(back.handSentAt, at(20, 20))
  assert.deepEqual(back.probeBy, { 'Worker 3': at(20, 40) })
  assert.equal(sendsRefusedOf(back, []), null)
  assert.equal(nextPath(back, { ...W4, senderClaims: true }), 'message')
})

test('rule start-untaken: a start word the idle main chat has not taken for 10 minutes is one finding per word', () => {
  const rule = WATCH_RULES.find(one => one.id === 'start-untaken')
  assert.ok(rule)
  const now = at(20, 46)
  const word = { id: 'a2714cbdf10a7a5b', command: 'start', to: 'Main', about: 'Worker 4', state: 'waiting', at: at(20, 35, 21) }
  const main = { name: 'Main', isMain: true, isLeftover: false, isRunning: true, state: 'free', report: { state: 'idle', at: now - 5000 } }
  const view = { now, lanes: [main], outbox: [word], pause: null, items: new Map(), restart: { main: 'Main' } }
  const found = rule.check(view, { observed: [], seen: new Map() })
  assert.equal(found.length, 1)
  assert.equal(found[0].key, 'start-untaken Worker 4 a2714cbdf10a7a5b')
  assert.match(found[0].text, /Worker 4/)
  assert.match(found[0].evidence, /20:35/)
  // Not yet 10 minutes, a busy main chat, or a word taken: nothing.
  assert.equal(rule.check({ ...view, now: at(20, 44) }, { observed: [], seen: new Map() }).length, 0)
  assert.equal(rule.check({ ...view, lanes: [{ ...main, report: { state: 'busy', at: now } }] }, { observed: [], seen: new Map() }).length, 0)
  assert.equal(rule.check({ ...view, outbox: [{ ...word, state: 'taken' }] }, { observed: [], seen: new Map() }).length, 0)
})
