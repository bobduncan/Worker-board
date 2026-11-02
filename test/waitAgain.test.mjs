// The wait line's Send again (T22; the board-dev chat's condition 2 of 2026-11-02: "Send again re-runs the wake procedure
// through the wake record (one counter per chat and spell), never a bare resend; hidden while a wake is pending"). The person's
// click makes ONE attempt (wake.mjs `personAgain`, change 7); on the message way the record holds it for the next hand that may
// send (`by` AGAIN_BY), which carries it with the job id the hands route gives a claim. Made-up chats.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { claim, emptyWakes, failedToSend, pass, personAgain, sent, statusOf, wakeJobId, wakeOf } from '../src/wake.mjs'
import { AGAIN_BY, waitLineOf } from '../src/waitLine.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 2, 13, 0).getTime()
const at = minutesAgo => NOW - minutesAgo * MIN
const SPELL = at(60)
const pad = n => String(n).padStart(2, '0')
const hhmm = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
/** Rule 8 says nothing here: the chat's wake decides (a chat in a pending or failed wake leaves rule 8, change 4 decision 7). */
const judge = { isUndelivered: () => false, matters: () => true }
const word = { id: 'w1', to: 'Worker 2', ask: 'work:Q5', at: at(20), state: 'waiting' }
const need = { chat: 'Worker 2', spell: SPELL, paths: ['message', 'launch'] }
const lineNow = (record, now) => {
  const wake = wakeOf(record, need, { senderClaims: true })
  return waitLineOf({ word, lane: { name: 'Worker 2', isRunning: false, status: 'Asleep', wake }, wake, now, judge })
}

test('Send again: one attempt through the record, held by the board for the next hand; the line reads it, with no button while it is on its way', () => {
  const record = emptyWakes()
  // Both ways failed in this spell: the line is Late, with Send again.
  claim(record, { chat: 'Worker 2', spell: SPELL, path: 'message', by: 'Advisor', jobId: wakeJobId(SPELL, 'Worker 2'), now: at(18) })
  sent(record, 'Worker 2', wakeJobId(SPELL, 'Worker 2'), at(18))
  pass(record, at(15))
  claim(record, { chat: 'Worker 2', spell: SPELL, path: 'launch', by: 'board', jobId: 'launch:1:Worker 2', now: at(14) })
  failedToSend(record, 'Worker 2', 'launch:1:Worker 2', 'the app did not start it', at(13))
  const late = lineNow(record, NOW)
  assert.deepEqual([late.state, late.canSendAgain], ['late', true])
  // The click: one attempt outside the cap, by the job id the hands route gives a claim, held by the board.
  const again = personAgain(record, { chat: 'Worker 2', spell: SPELL, path: 'message', by: AGAIN_BY, jobId: wakeJobId(SPELL, 'Worker 2'), now: NOW })
  assert.deepEqual([again.again, again.by, again.jobId], ['person', 'the board', 'wake:' + SPELL + ':Worker 2'])
  assert.equal(statusOf(record, 'Worker 2', SPELL).state, 'on-its-way')
  const waking = lineNow(record, NOW)
  assert.deepEqual([waking.state, waking.rest, waking.canSendAgain], ['sent', 'waking Worker 2 (message on its way, held by the board)', false])
  // A second click while it is on its way changes nothing.
  assert.equal(personAgain(record, { chat: 'Worker 2', spell: SPELL, path: 'message', by: AGAIN_BY, jobId: wakeJobId(SPELL, 'Worker 2'), now: NOW + 1000 }), false)
  // A hand takes it and sends it: the line says so; no report in 2 minutes and it failed as any attempt: Late, Send again again.
  again.by = 'Advisor'
  sent(record, 'Worker 2', wakeJobId(SPELL, 'Worker 2'), NOW + 5000)
  assert.equal(lineNow(record, NOW + 10_000).rest, `waking Worker 2 (message sent ${hhmm(NOW + 5000)} by Advisor)`)
  pass(record, NOW + 3 * MIN)
  assert.deepEqual([lineNow(record, NOW + 3 * MIN).state, lineNow(record, NOW + 3 * MIN).canSendAgain], ['late', true])
})

test('the server: Send again asks personAgain with the claim\'s job id, and the hands route gives the held attempt in the same step as it finds it', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  const route = server.slice(server.indexOf('const wakeAgainNow = async body => {'), server.indexOf('const waitsNow = async'))
  assert.match(route, /personAgain\(wakes, \{ chat, spell, path: 'message', by: AGAIN_BY, jobId: wakeJobId\(spell, chat\), now, runBefore: reports\?\.get\(chat\)\?\.run \?\? null \}\)/)
  assert.match(route, /launchFor\(\{ target: \{ chat, session: lane\.session \}, key: chat, spell, now, again: true \}\)/)
  assert.match(server, /again \? personAgain\(wakes, \{ chat: key, spell, path: 'launch', by: 'board', jobId, now, runBefore \}\)/)
  const hands = server.slice(server.indexOf("// T22: the person's Send again on the message way"), server.indexOf('if (wakeClaimed) wakesChanged()'))
  assert.ok(hands.length > 0)
  assert.ok(hands.indexOf('one.by === AGAIN_BY') < hands.indexOf('attempt.by = checked.chat') && hands.indexOf('attempt.by = checked.chat') < hands.indexOf('jobs.push({ id: attempt.jobId'), 'found, taken, pushed')
  assert.doesNotMatch(hands, /await /, 'no await between finding the attempt and the push: a second hand finds it taken')
  assert.match(hands, /chat === checked\.chat/, 'never to the chat itself')
  assert.match(server, /if \(body\?\.command === 'wake-again'\) return wakeAgainNow\(body\)/)
  assert.match(server, /waitAgain: !isDemo && !isShowOnly && bridgeKey !== null/)
})

test('the review of 2026-11-02 (3, 6): Send again is refused while the board ends, where it does not run the loops, while the person pauses, and into a spell that is not the record\'s newest', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  const route = server.slice(server.indexOf('const wakeAgainNow = async body => {'), server.indexOf('const waitsNow = async'))
  const before = what => route.indexOf(what)
  const acts = Math.min(before('personAgain('), before('launchFor('))
  for (const guard of ['if (isClosing) return', 'if (!(await ownsLoops())) return', "if (isHolding(state.pause) || state.pause?.state === 'resuming') return", 'if (newest !== null && newest.spell !== spell) return']) {
    assert.ok(before(guard) > 0 && before(guard) < acts, `${guard}, before any attempt`)
  }
  assert.match(route, /const newest = wakes\.wakes\.get\(chat\)\?\.at\(-1\) \?\? null/, 'the newest entry, as the hands route reads it')
  // Why it matters (6): an attempt into an older kept entry is one the hands route never finds (it reads the newest entry).
  const record = emptyWakes()
  const A = SPELL
  const B = SPELL + MIN
  personAgain(record, { chat: 'Worker 2', spell: A, path: 'launch', by: 'board', jobId: 'l1', now: at(30) })
  failedToSend(record, 'Worker 2', 'l1', 'the app did not start it', at(29))
  personAgain(record, { chat: 'Worker 2', spell: B, path: 'launch', by: 'board', jobId: 'l2', now: at(20) })
  failedToSend(record, 'Worker 2', 'l2', 'the app did not start it', at(19))
  const older = personAgain(record, { chat: 'Worker 2', spell: A, path: 'message', by: AGAIN_BY, jobId: wakeJobId(A, 'Worker 2'), now: NOW })
  // The building chat's guard on main (after this review's finding 6): personAgain itself refuses a spell that is not the newest.
  assert.equal(older, false, 'personAgain itself refuses the older spell')
  assert.equal(record.wakes.get('Worker 2').at(-1).attempts.some(one => one.jobId === wakeJobId(A, 'Worker 2')), false, 'and the newest entry holds no attempt for it')
})
