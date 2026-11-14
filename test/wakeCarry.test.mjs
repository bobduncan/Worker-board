// F17 (chat 1's brief of 2026-11-14): wakes without code sends. The refusal is the live one (data/wakes.json and data/outbox.jsonl,
// 2026-11-14 08:13 on: six of them, each as the hands' result wraps it); the garden is made up.

import assert from 'node:assert/strict'
import test from 'node:test'

import { isHandWord } from '../src/hands.mjs'
import { isUndelivered } from '../src/supervisor/rules/watch.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { emptyWakes, claim, carryPlan, failedToSend, heard, nextPath, pass, sent, statusOf, triedWords, wakeNeeds, wakeOf, wakeWords } from '../src/wake.mjs'
import { COURIER, CARRY_DUE_MS, SEND_REFUSED_WHY, carrierOf, carryCloses, dueOf, sendsRefusedOf } from '../src/wakeCarry.mjs'
import { PROBE_MS } from '../src/work/effort.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 14, 9, 0).getTime()
const time = ms => new Date(ms).toTimeString().slice(0, 5)
/** The refusal exactly as the hands' result carried it into data/wakes.json (Worker 4's hand, Worker 2's wake, 08:16). */
const REFUSAL = '{"deny":"PreToolUse:mcp__ccd_session_mgmt__send_message hook error: Not run: in auto mode Claude Desktop doesn\'t run this tool when a plugin\'s own code calls it. Have Claude make the call."}'
const RAW = /PreToolUse|hook error|deny/

const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, isRunning: true, state: 'free', appSession: `local_${name.toLowerCase().replace(/\s/g, '')}`, session: null, unjoined: null, report: { state: 'idle', at: NOW - 5000 }, ...more })
const asleep = (name, since, more = {}) => lane(name, { isRunning: false, state: 'off', asleep: true, asleepSince: since, ...more })
/** The live case after 08:13: a hand's wake job refused (Worker 2 by Worker 4's hand). */
function refusedRecord(at = NOW - 10 * MIN) {
  const record = emptyWakes()
  claim(record, { chat: 'Old', spell: at - MIN, path: 'message', by: 'Worker 4', jobId: `wake:${at - MIN}:Old`, now: at, paths: ['message'] })
  failedToSend(record, 'Old', `wake:${at - MIN}:Old`, REFUSAL, at + 2000)
  return record
}
/** The garden at 09:00: everyone asleep but the ones given, a step ready for Digger (its envelope waits). */
const envelope = to => ({ id: `env-${to}`, at: NOW - 2 * MIN, to, command: 'handover', step: 'B12', kind: 'task', clear: null, state: 'waiting' })
const stateOf = (chats, more = {}) => ({ chats, chatPrefix: '', pause: null, restart: { main: 'Lead' }, ...more })

test('the refusal: the live hook text marks the attempt refused, kept in plain words; the record, the line and the notice never show it raw', () => {
  const record = refusedRecord()
  const attempt = record.wakes.get('Old')[0].attempts[0]
  assert.deepEqual([attempt.refused, attempt.why], [true, SEND_REFUSED_WHY])
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

test('sends refused: from the record or a start word that failed on it; a hand\'s later send ends it, a model\'s does not; 24 h later the next wake is the probe', () => {
  assert.equal(sendsRefusedOf(emptyWakes(), [], NOW), null)
  assert.deepEqual(sendsRefusedOf(refusedRecord(), [], NOW), { since: NOW - 10 * MIN + 2000 })
  // The live outbox line (a start word, 08:13).
  const word = { id: 'e618a626e984b066', command: 'start', about: 'Worker 5', at: NOW - 20 * MIN, state: 'failed', failedAt: NOW - 20 * MIN, tries: 1, why: REFUSAL }
  assert.deepEqual(sendsRefusedOf(emptyWakes(), [word], NOW), { since: NOW - 20 * MIN })
  assert.equal(sendsRefusedOf(emptyWakes(), [{ ...word, why: 'the app gave no answer' }], NOW), null, 'another failure is no refusal')
  // A model carried a wake after it: the hands' calls are still refused.
  const carried = refusedRecord()
  claim(carried, { chat: 'Digger', spell: NOW - 5 * MIN, path: 'message', by: 'Lead', jobId: 'c1', now: NOW - 4 * MIN, paths: ['message'], carry: 'model' })
  sent(carried, 'Digger', 'c1', NOW - 3 * MIN)
  assert.notEqual(sendsRefusedOf(carried, [], NOW), null)
  // A hand's send went after it (the app runs the call again).
  const back = refusedRecord()
  claim(back, { chat: 'Digger', spell: NOW - 5 * MIN, path: 'message', by: 'Worker 1', jobId: 'h1', now: NOW - 4 * MIN, paths: ['message'] })
  sent(back, 'Digger', 'h1', NOW - 3 * MIN)
  assert.equal(sendsRefusedOf(back, [], NOW), null)
  assert.equal(sendsRefusedOf(refusedRecord(), [], NOW - 10 * MIN + 2000 + PROBE_MS), null, 'after PROBE_MS the hands try once more')
})

test('the carrier: an idle board chat first, then the main chat, then any running one; never the target, never a chat whose board link is gone', () => {
  const lanes = [lane('Lead', { isMain: true, state: 'working' }), lane('Worker 1', { state: 'working' }), lane('Worker 3'), asleep('Digger', NOW - 30 * MIN)]
  assert.equal(carrierOf(lanes, { target: 'Digger', main: 'Lead', now: NOW }).name, 'Worker 3')
  assert.equal(carrierOf(lanes, { target: 'Worker 3', main: 'Lead', now: NOW }).name, 'Lead', 'never the target; Main before any busy one')
  assert.equal(carrierOf(lanes.filter(one => one.name !== 'Lead'), { target: 'Worker 3', main: 'Lead', now: NOW }).name, 'Worker 1', 'then any running one')
  // Gone links: not running, unjoined (the board does not follow its session), a leftover, removed, suspended, no app id.
  for (const gone of [{ isRunning: false }, { isRunning: null }, { report: null }, { report: { state: 'idle', at: NOW - 61_000 } }, { unjoined: { at: NOW, session: 'x' } }, { isLeftover: true }, { removedAt: NOW }, { removal: { isOpen: true } }, { state: 'suspended' }, { appSession: null }]) {
    assert.equal(carrierOf([lane('Worker 3', gone), asleep('Digger', NOW - 30 * MIN)], { target: 'Digger', now: NOW }), null, JSON.stringify(gone))
  }
  assert.equal(carrierOf([lane('Digger')], { target: 'Digger', now: NOW }), null)
  // Chat 1's point 1: a mod that reported within the minute; one the CLI unloaded keeps its process and stops reporting.
  assert.equal(carrierOf([lane('Worker 3', { report: { state: 'idle', at: NOW - 60_000 } }), asleep('Digger', NOW - 30 * MIN)], { target: 'Digger', now: NOW }).name, 'Worker 3')
  // A carrier whose mod went quiet before it took the word gives the attempt back.
  const word = { id: 'w9', to: 'Worker 3', command: 'wake-carry', about: 'Digger', forModel: true, state: 'waiting', at: NOW }
  assert.equal(carryCloses({ outbox: [word], lanes: [lane('Worker 3', { report: { state: 'idle', at: NOW - 2 * MIN } }), asleep('Digger', NOW - 30 * MIN)], attemptOf: () => ({ verdict: null }), now: NOW })[0]?.giveBack, true)
})

test('the real case, A: all asleep but one, a step ready: one word for an awake chat\'s model, claimed once per spell; its own report is the verdict', () => {
  const chats = [lane('Lead', { isMain: true, state: 'working' }), asleep('Digger', NOW - 30 * MIN), lane('Worker 3')]
  const state = stateOf(chats)
  const record = refusedRecord()
  const needs = wakeNeeds(state, [envelope('Digger')], { canLaunch: false })
  assert.deepEqual(needs.map(one => [one.chat, one.text]), [['Digger', 'take B12 in this turn: run work next']])
  let n = 0
  const plan = () => carryPlan(record, { needs: wakeNeeds(state, [envelope('Digger')], { canLaunch: false }), lanes: chats, main: 'Lead', now: NOW, newId: () => `w${(n += 1)}` })
  const [word, ...more] = plan()
  assert.equal(more.length, 0)
  assert.deepEqual([word.to, word.about, word.command, word.forModel, word.session, word.wakeText], ['Worker 3', 'Digger', 'wake-carry', true, 'local_digger', 'take B12 in this turn: run work next'])
  assert.match(word.text, /send_message with session_id "local_digger" and message "take B12 in this turn: run work next"/)
  // No hand takes it, also one that may send.
  assert.equal(isHandWord(word, { canSend: true, canSet: true, canRestart: true, canSpawn: true, workers: ['Worker 3'] }), false)
  // The same wake twice: never; the next passes plan nothing for the spell.
  assert.deepEqual(plan(), [])
  assert.deepEqual(plan(), [])
  assert.equal(record.wakes.get('Digger').at(-1).attempts.length, 1)
  // The line says through whom.
  assert.equal(wakeWords(wakeOf(record, { chat: 'Digger', spell: NOW - 30 * MIN, paths: ['message'] }, { senderClaims: true }), time).text, 'waking through Worker 3\'s turn')
  // Typed into Worker 3 (the take): sent; Digger's own report with a new run: woke, "woken through Worker 3's turn".
  sent(record, 'Digger', word.id, NOW + 10_000)
  assert.equal(heard(record, 'Digger', { state: 'busy', at: NOW + 40_000, run: NOW + 30_000 }, NOW + 40_000).verdict, 'woke')
  assert.equal(wakeWords(statusOf(record, 'Digger'), time).text, 'woken through Worker 3\'s turn')
})

test('a carried wake\'s windows: 10 min to be typed or carried, then 5 min for the chat\'s report; then the launch may follow', () => {
  const record = emptyWakes()
  claim(record, { chat: 'Digger', spell: 1, path: 'message', by: 'Lead', jobId: 'c', now: NOW, paths: ['message', 'launch'], carry: 'model' })
  assert.deepEqual(pass(record, NOW + 4 * MIN), [], 'a busy carrier takes it at its next turn')
  assert.equal(pass(record, NOW + 10 * MIN)[0].attempt.why, 'Lead\'s turn did not carry the message within 10 minutes')
  const two = emptyWakes()
  claim(two, { chat: 'Digger', spell: 1, path: 'message', by: COURIER, jobId: 'c', now: NOW, paths: ['message'], carry: 'courier' })
  sent(two, 'Digger', 'c', NOW + MIN)
  assert.deepEqual(pass(two, NOW + 4 * MIN), [])
  const [failed] = pass(two, NOW + 6 * MIN)
  assert.match(triedWords([failed.attempt], time).join(), /through the scheduled courier/)
  assert.equal(nextPath(two, { chat: 'Digger', spell: 1, senderClaims: true, paths: ['message', 'launch'] }), 'launch')
  // A hand's attempt keeps its own 3 minutes.
  const hand = emptyWakes()
  claim(hand, { chat: 'Digger', spell: 1, path: 'message', by: 'Worker 1', jobId: 'h', now: NOW, paths: ['message'] })
  assert.equal(pass(hand, NOW + 3 * MIN).length, 1)
})

test('the real case, B: nobody awake: the word is the courier\'s; wakes-due lists it until the courier says sent; never a word a carrier took', () => {
  const chats = [asleep('Lead', NOW - 40 * MIN, { isMain: true }), asleep('Digger', NOW - 30 * MIN)]
  const record = refusedRecord()
  const [word] = carryPlan(record, { needs: wakeNeeds(stateOf(chats), [envelope('Digger')], { canLaunch: false }), lanes: chats, main: 'Lead', now: NOW, newId: () => 'k1' })
  assert.equal(word.to, COURIER)
  assert.equal(record.wakes.get('Digger').at(-1).attempts[0].carry, 'courier')
  assert.deepEqual(dueOf([word], NOW, { anyRuns: false }), [{ id: 'k1', chat: 'Digger', session: 'local_digger', text: 'take B12 in this turn: run work next' }])
  // Held by the courier (the route marks it taken): listed again until it says sent (idempotent), then never.
  const held = { ...word, state: 'taken', takenBy: COURIER, takenAt: NOW }
  assert.equal(dueOf([held], NOW + MIN).length, 1)
  assert.deepEqual(dueOf([{ ...held, state: 'delivered' }], NOW + MIN), [])
  // A carrier's word: the courier's only once no carrier took it in CARRY_DUE_MS, or nobody runs; never once a carrier took it.
  const forWorker = { ...word, id: 'k2', to: 'Worker 3' }
  assert.deepEqual(dueOf([forWorker], NOW + CARRY_DUE_MS - 1000), [])
  assert.equal(dueOf([forWorker], NOW + CARRY_DUE_MS).length, 1)
  assert.equal(dueOf([forWorker], NOW, { anyRuns: false }).length, 1)
  assert.deepEqual(dueOf([{ ...forWorker, state: 'taken', takenBy: 'Worker 3', takenAt: NOW }], NOW + 30 * MIN, { anyRuns: false }), [])
  // Nothing due: an empty list.
  assert.deepEqual(dueOf([], NOW, { anyRuns: false }), [])
})

test('the carry words close with their purpose: woke, runs again, the attempt ended; a carrier that can no longer carry gives the attempt back', () => {
  const word = { id: 'w1', to: 'Worker 3', command: 'wake-carry', about: 'Digger', forModel: true, state: 'waiting', at: NOW }
  const lanes = [lane('Worker 3'), asleep('Digger', NOW - 30 * MIN)]
  const pending = { verdict: null }
  assert.deepEqual(carryCloses({ outbox: [word], lanes, attemptOf: () => pending, now: NOW }), [])
  assert.equal(carryCloses({ outbox: [word], lanes, attemptOf: () => ({ verdict: 'woke' }), now: NOW })[0].state, 'delivered')
  assert.match(carryCloses({ outbox: [word], lanes: [lane('Worker 3'), lane('Digger')], attemptOf: () => pending, now: NOW })[0].why, /Digger runs again/)
  assert.equal(carryCloses({ outbox: [word], lanes, attemptOf: () => ({ verdict: 'failed' }), now: NOW })[0].state, 'dropped')
  const gone = carryCloses({ outbox: [word], lanes: [lane('Worker 3', { isRunning: false }), asleep('Digger', NOW - 30 * MIN)], attemptOf: () => pending, now: NOW })[0]
  assert.deepEqual([gone.state, gone.giveBack], ['dropped', true])
  // A word its carrier already took is its carrier's turn: not taken back.
  assert.deepEqual(carryCloses({ outbox: [{ ...word, state: 'taken' }], lanes: [lane('Worker 3', { isRunning: false }), asleep('Digger', NOW - 30 * MIN)], attemptOf: () => pending, now: NOW }), [])
})

test('rule 8 leaves a carry word to the wake record', () => {
  const view = buildView({ state: { chats: [lane('Worker 3')], today: [], limits: {}, pause: null, chatPrefix: '', restart: { main: 'Lead' } }, items: new Map(), outbox: [], settings: {}, now: NOW })
  const word = { id: 'w1', to: COURIER, command: 'wake-carry', about: 'Digger', forModel: true, state: 'waiting', at: NOW - 30 * MIN }
  assert.equal(isUndelivered(view, word), false)
  assert.equal(isUndelivered(view, { ...word, state: 'expired' }), false)
})

test('the wake file keeps a carried attempt and a refused send across the board\'s restart', async () => {
  const { textOfWakes, wakesOfFile } = await import('../src/wake.mjs')
  const record = refusedRecord()
  claim(record, { chat: 'Digger', spell: 1, path: 'message', by: COURIER, jobId: 'k1', now: NOW, paths: ['message'], carry: 'courier' })
  const back = wakesOfFile(JSON.parse(textOfWakes(record)))
  assert.equal(back.wakes.get('Old')[0].attempts[0].refused, true)
  assert.equal(back.wakes.get('Digger')[0].attempts[0].carry, 'courier')
  assert.notEqual(sendsRefusedOf(back, [], NOW), null)
})
