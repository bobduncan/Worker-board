// Signals change 4, B908 (2026-11-02): one wake record per chat and spell (src/wake.mjs). The real cases of the morning
// are the fixtures: the opener launched Worker 2 at 10:32 and 10:35, Worker 3 at 10:42 and 10:45, Worker 4 at 10:53 and
// 10:56, Worker 5 at 11:03 and 11:06, Worker 1 at 11:08; PowerShell said ok each time and nothing started (board.log T13
// lines). At 11:06:50 the Advisor's message reached Worker 5; its process started 11:06:56 and its first take came
// 11:07:03.

import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  BOARD_KEY, WAKE_VERDICT_MS, claim, emptyWakes, failedToSend, givenBack, heard, heardClaim, inFirstTurn, newSpell, nextPath, noticeOf, pass,
  personAgain, readWakes, rowOf, sent, spellOf, statusOf, textOfWakes, turnEnded, wakeJobId, wakeOf, wakesOfFile, wakesSaver,
} from '../src/wake.mjs'
import * as wakeModule from '../src/wake.mjs'

test('X107/X3 (2026-11-02 14:45): a message that carried a step\'s take line is remembered with the step; wakeCarriedTake holds only after "woke", for that step, by message', () => {
  const { wakeCarriedTake } = wakeModule
  const record = emptyWakes()
  const job = wakeJobId(W5_SPELL, 'Worker 5')
  const attempt = claim(record, { chat: 'Worker 5', spell: W5_SPELL, path: 'message', by: 'Main', jobId: job, now: at(14, 45, 45), runBefore: RUN_OLD, step: 'B916' })
  assert.equal(attempt.step, 'B916')
  assert.equal(wakeCarriedTake(record, 'Worker 5', 'B916'), false, 'not before the chat woke')
  sent(record, 'Worker 5', job, at(14, 45, 50))
  heard(record, 'Worker 5', { state: 'busy', run: RUN_NEW, at: at(14, 46, 14) }, at(14, 46, 14))
  assert.equal(wakeCarriedTake(record, 'Worker 5', 'B916'), true)
  assert.equal(wakeCarriedTake(record, 'Worker 5', 'B917'), false, 'another step: its line still goes')
  assert.equal(wakeCarriedTake(record, 'Worker 2', 'B916'), false)
  // A plain-line wake (a clear owed) carries no step; a launch neither.
  const plain = emptyWakes()
  claim(plain, { chat: 'Worker 2', spell: W2_SPELL, path: 'message', by: 'Main', jobId: 'j', now: at(14, 45, 45) })
  heard(plain, 'Worker 2', { state: 'busy', run: RUN_NEW, at: at(14, 46) }, at(14, 46))
  assert.equal(wakeCarriedTake(plain, 'Worker 2', 'B918'), false)
  // The step survives the file; a step that is no step id is not kept.
  const read = wakesOfFile(JSON.parse(textOfWakes(record)))
  assert.equal(read.wakes.get('Worker 5').at(-1).attempts.at(-1).step, 'B916')
  assert.equal(claim(emptyWakes(), { chat: 'X', spell: 1, path: 'launch', by: 'board', jobId: 'l', now: 2, step: 'drop table' }).step, null)
})

test('T22 personAgain: the person\'s "Send again" makes one attempt outside the cap, never while one is pending; it gets the usual verdict and is saved with its mark', () => {
  const record = emptyWakes()
  const job = wakeJobId(W2_SPELL, 'Worker 2')
  assert.ok(claim(record, { chat: 'Worker 2', spell: W2_SPELL, path: 'message', by: 'Advisor', jobId: job, now: at(10, 31), runBefore: RUN_OLD }))
  // A click while the message is pending changes nothing.
  assert.equal(personAgain(record, { chat: 'Worker 2', spell: W2_SPELL, path: 'message', by: 'Advisor', jobId: 'again-1', now: at(10, 31, 30) }), false)
  sent(record, 'Worker 2', job, at(10, 31, 5))
  pass(record, at(10, 34))
  assert.equal(statusOf(record, 'Worker 2', W2_SPELL).state, 'failed')
  // The cap of decision 8 gives the message path no second try; the person's word does, once.
  assert.equal(nextPath(record, { chat: 'Worker 2', spell: W2_SPELL, senderClaims: true, paths: ['message'] }), null)
  const again = personAgain(record, { chat: 'Worker 2', spell: W2_SPELL, path: 'message', by: 'Advisor', jobId: 'again-1', now: at(10, 40), runBefore: RUN_OLD })
  assert.equal(again.again, 'person')
  assert.equal(statusOf(record, 'Worker 2', W2_SPELL).state, 'on-its-way')
  // A second click while that one is pending changes nothing either.
  assert.equal(personAgain(record, { chat: 'Worker 2', spell: W2_SPELL, path: 'message', by: 'Advisor', jobId: 'again-2', now: at(10, 40, 10) }), false)
  sent(record, 'Worker 2', 'again-1', at(10, 40, 5))
  // The same verdict rules: the chat's own report from a new process is "woke".
  assert.equal(heard(record, 'Worker 2', { state: 'busy', run: RUN_NEW, at: at(10, 40, 20) }, at(10, 40, 20))?.verdict, 'woke')
  assert.equal(statusOf(record, 'Worker 2', W2_SPELL).state, 'woke')
  // The mark survives the file.
  const read = wakesOfFile(JSON.parse(textOfWakes(record)))
  assert.equal(read.wakes.get('Worker 2').at(-1).attempts.at(-1).again, 'person')
  // Only the newest spell (the goal chat's wait-line test: spells A, B, then A again): an older kept entry takes no attempt,
  // since the hands route reads the newest entry alone and the message would never go.
  const spells = emptyWakes()
  newSpell(spells, 'Worker 2', 100)
  newSpell(spells, 'Worker 2', 200)
  assert.equal(personAgain(spells, { chat: 'Worker 2', spell: 100, path: 'message', by: 'Main', jobId: 'old', now: 300 }), false)
  assert.equal(spells.wakes.get('Worker 2')[0].attempts.length, 0)
  assert.ok(personAgain(spells, { chat: 'Worker 2', spell: 200, path: 'message', by: 'Main', jobId: 'new', now: 300 }))
})

const at = (h, m, s = 0) => new Date(2026, 10, 2, h, m, s).getTime()
const timeOf = ms => `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`
/** Worker 2 asleep since 14:16 the day before. */
const W2_SPELL = new Date(2026, 10, 1, 14, 16).getTime()
const W5_SPELL = new Date(2026, 10, 1, 16, 5).getTime()
const RUN_OLD = 1_761_900_000_000
const RUN_NEW = at(11, 6, 56)

test('spellOf: a lane that runs or is unknown has none; asleep its asleepSince; off its ended since, else its report time, else 0', () => {
  assert.equal(spellOf({ isRunning: true, asleepSince: 5 }), null)
  assert.equal(spellOf({ isRunning: null }), null)
  assert.equal(spellOf({ isRunning: false, asleep: true, asleepSince: W2_SPELL }), W2_SPELL)
  assert.equal(spellOf({ isRunning: false, report: { state: 'ended', since: 100, at: 200 } }), 100)
  assert.equal(spellOf({ isRunning: false, report: { state: 'idle', since: 100, at: 200 } }), 200)
  assert.equal(spellOf({ isRunning: false }), 0)
})

test('the 10:32 case: a launch is claimed, sent at its exit, and failed 2 minutes after the send, never "woke" by itself', () => {
  const record = emptyWakes()
  const attempt = claim(record, { chat: 'Worker 2', spell: W2_SPELL, path: 'launch', by: 'board', jobId: 'launch:1', now: at(10, 32), runBefore: RUN_OLD })
  assert.equal(attempt.path, 'launch')
  assert.equal(statusOf(record, 'Worker 2', W2_SPELL).state, 'launched')
  // The launch's PowerShell ended well 20 s later: the 2 minutes count from there, not from the claim.
  sent(record, 'Worker 2', 'launch:1', at(10, 32, 20))
  assert.deepEqual(pass(record, at(10, 34, 10)), [], 'not yet: 1:50 after the send')
  const failed = pass(record, at(10, 34, 20))
  assert.equal(failed.length, 1)
  assert.equal(failed[0].attempt.why, 'the app did not start it')
  const status = statusOf(record, 'Worker 2', W2_SPELL)
  assert.equal(status.state, 'failed')
  // One launch per spell: the 10:35 launch is not claimed again.
  assert.equal(claim(record, { chat: 'Worker 2', spell: W2_SPELL, path: 'launch', by: 'board', jobId: 'launch:2', now: at(10, 35) }), false)
})

test('one attempt per path per spell, never two pending at once; a given-back attempt is erased and may be claimed again', () => {
  const record = emptyWakes()
  const job = wakeJobId(W5_SPELL, 'Worker 5')
  assert.ok(claim(record, { chat: 'Worker 5', spell: W5_SPELL, path: 'message', by: 'Advisor', jobId: job, now: at(11, 6, 40) }))
  // A second carrier in the same window finds the claim.
  assert.equal(claim(record, { chat: 'Worker 5', spell: W5_SPELL, path: 'message', by: 'Main', jobId: job, now: at(11, 6, 41) }), false)
  // Never two pending: no launch while the message is on its way.
  assert.equal(claim(record, { chat: 'Worker 5', spell: W5_SPELL, path: 'launch', by: 'board', jobId: 'l', now: at(11, 6, 42) }), false)
  assert.equal(statusOf(record, 'Worker 5', W5_SPELL).state, 'on-its-way')
  // B880: the hand gave it back unsent: no try spent.
  assert.equal(givenBack(record, 'Worker 5', job), true)
  assert.equal(statusOf(record, 'Worker 5', W5_SPELL).state, 'none')
  assert.ok(claim(record, { chat: 'Worker 5', spell: W5_SPELL, path: 'message', by: 'Main', jobId: job, now: at(11, 6, 45) }))
})

test('the 11:06:50 case: the message sent, Worker 5\'s first take with a new run is the verdict "woke"; a report of the old run is not', () => {
  const record = emptyWakes()
  const job = wakeJobId(W5_SPELL, 'Worker 5')
  claim(record, { chat: 'Worker 5', spell: W5_SPELL, path: 'message', by: 'Advisor', jobId: job, now: at(11, 6, 45), runBefore: RUN_OLD })
  sent(record, 'Worker 5', job, at(11, 6, 50))
  assert.equal(statusOf(record, 'Worker 5', W5_SPELL).state, 'sent')
  // Its old report, read again: no verdict.
  assert.equal(heard(record, 'Worker 5', { state: 'ended', run: RUN_OLD, at: at(11, 6, 52) }, at(11, 6, 52)), null)
  // A report from before the attempt: no verdict either.
  assert.equal(heard(record, 'Worker 5', { state: 'idle', run: RUN_NEW, at: at(11, 6, 40) }, at(11, 6, 53)), null)
  const woke = heard(record, 'Worker 5', { state: 'busy', run: RUN_NEW, at: at(11, 7, 3) }, at(11, 7, 3))
  assert.equal(woke.verdict, 'woke')
  const status = statusOf(record, 'Worker 5', W5_SPELL)
  assert.equal(status.state, 'woke')
  assert.equal(status.wokeAt, at(11, 7, 3))
  // A woken spell takes no more attempts, and the clock fails nothing.
  assert.equal(nextPath(record, { chat: 'Worker 5', spell: W5_SPELL, senderClaims: true }), null)
  assert.deepEqual(pass(record, at(11, 20)), [])
  // B.2: its first turn runs until its first turn end is seen.
  assert.equal(inFirstTurn(record, 'Worker 5'), true)
  assert.equal(turnEnded(record, 'Worker 5', at(11, 7, 21)), true)
  assert.equal(inFirstTurn(record, 'Worker 5'), false)
  assert.equal(turnEnded(record, 'Worker 5', at(11, 9)), false, 'once')
})

test('nextPath, decision 8: message first while a sender claims, launch only without one or after the message failed, then nothing; a new sender once', () => {
  const record = emptyWakes()
  const chat = 'Worker 3'
  const spell = 1000
  assert.equal(nextPath(record, { chat, spell, senderClaims: true }), 'message')
  assert.equal(nextPath(record, { chat, spell, senderClaims: false }), 'launch')
  assert.equal(nextPath(record, { chat, spell, senderClaims: false, paths: ['message'] }), null, 'no launch without a session id')
  claim(record, { chat, spell, path: 'message', by: 'Advisor', jobId: 'j1', now: at(10, 40) })
  sent(record, chat, 'j1', at(10, 40, 5))
  assert.equal(nextPath(record, { chat, spell, senderClaims: true }), null, 'pending')
  pass(record, at(10, 42, 5))
  // After a failed message: the launch, carriers or not.
  assert.equal(nextPath(record, { chat, spell, senderClaims: true }), 'launch')
  claim(record, { chat, spell, path: 'launch', by: 'board', jobId: 'l1', now: at(10, 43) })
  failedToSend(record, chat, 'l1', 'PowerShell ended with 1', at(10, 43, 2))
  assert.equal(nextPath(record, { chat, spell, senderClaims: true }), null, 'both spent')
  assert.equal(nextPath(record, { chat, spell, senderClaims: true, senderSince: at(10, 41) }), null, 'a sender from before the failure is no new one')
  assert.equal(nextPath(record, { chat, spell, senderClaims: true, senderSince: at(10, 50) }), 'message', 'a new sender: the message once more')
  claim(record, { chat, spell, path: 'message', by: 'Worker 1', jobId: 'j2', now: at(10, 50), senderSince: at(10, 50) })
  failedToSend(record, chat, 'j2', 'no answer', at(10, 51))
  assert.equal(nextPath(record, { chat, spell, senderClaims: true, senderSince: at(10, 55) }), null, 'then nothing until life or the person')
  // Life: a new spell starts the count anew.
  assert.equal(newSpell(record, chat, 2000), true)
  assert.equal(nextPath(record, { chat, spell: 2000, senderClaims: true }), 'message')
})

test('the 2 minutes count from sentAt, not from the claim; a message never sent is failed after 3 minutes, held by its hand', () => {
  const record = emptyWakes()
  claim(record, { chat: 'Main', spell: 1, path: 'message', by: 'Advisor', jobId: 'j', now: at(9, 0) })
  sent(record, 'Main', 'j', at(9, 1, 30))
  assert.deepEqual(pass(record, at(9, 3, 0)), [], '2 min after the claim but 1:30 after the send')
  assert.equal(pass(record, at(9, 3, 30))[0].attempt.why, 'no report within 2 minutes of the message')
  claim(record, { chat: 'Worker 1', spell: 1, path: 'message', by: 'Worker 4', jobId: 'k', now: at(9, 0) })
  assert.deepEqual(pass(record, at(9, 2, 59)), [])
  assert.match(pass(record, at(9, 3, 0))[0].attempt.why, /not sent within 3 minutes \(held by Worker 4\)/)
})

test('the board-wide spell: its launch woke by any hand claim after it; without one it fails as a launch', () => {
  const record = emptyWakes()
  claim(record, { chat: BOARD_KEY, spell: at(10, 0), path: 'launch', by: 'board', jobId: 'b', now: at(10, 1) })
  sent(record, BOARD_KEY, 'b', at(10, 1, 3))
  assert.equal(heardClaim(record, at(10, 0, 50), at(10, 1, 20)), null, 'a claim from before the launch')
  assert.equal(heardClaim(record, at(10, 1, 30), at(10, 1, 30)).verdict, 'woke')
})

test('wakeOf and noticeOf, decision 6: one text, what was tried with times; "nobody answers" when every chat failed and no sender claims', () => {
  const record = emptyWakes()
  const need = chat => ({ chat, spell: W2_SPELL, paths: ['message', 'launch'] })
  claim(record, { chat: 'Worker 2', spell: W2_SPELL, path: 'launch', by: 'board', jobId: 'l', now: at(10, 32) })
  sent(record, 'Worker 2', 'l', at(10, 32))
  pass(record, at(10, 34, 1))
  // No sender: the launch failed, the message cannot go: final.
  assert.equal(wakeOf(record, need('Worker 2'), { senderClaims: false }).final, true)
  // A sender: the message is next, not final.
  const open = wakeOf(record, need('Worker 2'), { senderClaims: true })
  assert.equal(open.final, false)
  assert.equal(open.next, 'message')
  claim(record, { chat: 'Worker 2', spell: W2_SPELL, path: 'message', by: 'Advisor', jobId: 'm', now: at(10, 35) })
  sent(record, 'Worker 2', 'm', at(10, 35))
  pass(record, at(10, 37, 1))
  const notice = noticeOf(record, [need('Worker 2')], at(10, 38), timeOf, { senderClaims: true })
  assert.deepEqual(notice, { tone: 'attention', text: 'could not wake Worker 2: the app did not start it (launched 10:32); no report after the message (sent 10:35 by Advisor); open its chat' })
  // Every chat that needs a wake failed and nobody claims: the board-wide line first.
  const nobody = noticeOf(record, [need('Worker 2')], at(10, 38), timeOf, { senderClaims: false })
  assert.match(nobody.text, /^nobody answers the board's wake-ups: open any chat · could not wake Worker 2: /)
  // A chat without ids failed at once (decision 12).
  const none = noticeOf(emptyWakes(), [{ chat: 'Worker 9', spell: 0, paths: [] }], at(10, 38), timeOf, { senderClaims: true })
  assert.equal(none.text, 'could not wake Worker 9: the board has no id to reach it; open its chat')
  // Nothing tried yet, or on its way: no notice.
  assert.equal(noticeOf(emptyWakes(), [need('Worker 3')], at(10, 38), timeOf, { senderClaims: true }), null)
  // No sender and no launch possible: waits for a chat that can send.
  assert.equal(wakeOf(emptyWakes(), { chat: 'Worker 3', spell: 1, paths: ['message'] }, { senderClaims: false }).state, 'waiting-sender')
})

test('rowOf: blocked, the newest launch failed, else by itself', () => {
  const record = emptyWakes()
  assert.deepEqual(rowOf(record, {}), { key: 'launch', title: 'Wake a chat that has work', byCode: true, why: null })
  assert.equal(rowOf(record, { blocked: 'only on Windows' }).byCode, false)
  claim(record, { chat: 'Worker 4', spell: 7, path: 'launch', by: 'board', jobId: 'l', now: at(10, 53) })
  sent(record, 'Worker 4', 'l', at(10, 53))
  pass(record, at(10, 56))
  assert.equal(rowOf(record, { timeOf }).why, 'the last launch failed: the app did not start Worker 4 (launched 10:53)')
})

test('at most six spells are kept per chat', () => {
  const record = emptyWakes()
  for (let spell = 1; spell <= 8; spell += 1) newSpell(record, 'Worker 1', spell)
  assert.deepEqual(record.wakes.get('Worker 1').map(one => one.spell), [3, 4, 5, 6, 7, 8])
})

test('the file: written and read back equal; a torn or wrong file is set aside; an entry that is no spell is left out', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'wakes-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const file = join(dir, 'wakes.json')
  const record = emptyWakes()
  claim(record, { chat: 'Worker 2', spell: W2_SPELL, path: 'launch', by: 'board', jobId: 'l', now: at(10, 32), runBefore: RUN_OLD })
  sent(record, 'Worker 2', 'l', at(10, 32, 5))
  const timers = []
  const saver = wakesSaver({ file, record, setTimer: run => timers.push(run) || 1, clearTimer: () => {} })
  saver.changed()
  saver.changed()
  assert.equal(timers.length, 1, 'one write for the changes of a second')
  timers[0]()
  await saver.flush()
  const back = await readWakes(file, at(11, 0))
  assert.equal(back.setAside, null)
  assert.equal(textOfWakes(back.record), textOfWakes(record))
  // An entry that is no spell, and an attempt that is no attempt, are left out.
  await writeFile(file, JSON.stringify({ wakes: { 'Worker 2': [{ spell: 'x' }, { spell: 5, attempts: [{ path: 'fly' }], turnEndedAt: null }], '': [] } }))
  const odd = await readWakes(file, at(11, 0))
  assert.deepEqual(odd.record.wakes.get('Worker 2'), [{ spell: 5, attempts: [], turnEndedAt: null, told: { failed: false, nobody: false } }])
  await writeFile(file, '{"wakes": {"Wor')
  const torn = await readWakes(file, at(11, 0))
  assert.equal(torn.record.wakes.size, 0)
  assert.match(torn.setAside, /wakes\.json\.broken-/)
  assert.ok((await readdir(dir)).some(name => name.startsWith('wakes.json.broken-')))
  await writeFile(file, '[1, 2]')
  const wrong = await readWakes(file, at(11, 0))
  assert.equal(wrong.record.wakes.size, 0)
  assert.notEqual(wrong.setAside, null)
  assert.equal(JSON.parse(await readFile(wrong.setAside, 'utf8')).length, 2)
})

test('wakeFact (D.1) and wakeWords (E): what the hand-over and the lane read of a chat\'s wake', async () => {
  const { wakeFact, wakeWords } = await import('../src/wake.mjs')
  const record = emptyWakes()
  const lane = { name: 'Worker 5', isRunning: false, asleep: true, asleepSince: W5_SPELL, appSession: 'local_w5', session: '01234567-89ab-cdef-0123-456789abcdef' }
  const facts = { record, senderClaims: true, canLaunch: true }
  assert.equal(wakeFact(null, lane), null)
  assert.equal(wakeFact(facts, lane).state, 'none')
  const job = wakeJobId(W5_SPELL, 'Worker 5')
  claim(record, { chat: 'Worker 5', spell: W5_SPELL, path: 'message', by: 'Advisor', jobId: job, now: at(11, 6, 45), runBefore: RUN_OLD })
  assert.deepEqual(wakeWords(wakeFact(facts, lane), timeOf), { tone: 'quiet', text: 'waking · message on its way (held by Advisor)' })
  sent(record, 'Worker 5', job, at(11, 6, 50))
  assert.deepEqual(wakeWords(wakeFact(facts, lane), timeOf), { tone: 'quiet', text: 'waking · message sent 11:06 by Advisor' })
  heard(record, 'Worker 5', { state: 'busy', run: RUN_NEW, at: at(11, 7, 3) }, at(11, 7, 3))
  // It runs now: the newest spell's verdict and its first turn.
  const running = { ...lane, isRunning: true, asleep: false, asleepSince: null }
  const fact = wakeFact(facts, running, { kind: 'turn-ended', since: at(11, 6, 56) })
  assert.deepEqual([fact.state, fact.wokeAt, fact.firstTurnEnd, fact.final], ['woke', at(11, 7, 3), true, false])
  assert.equal(wakeFact(facts, running, { kind: 'pass' }).firstTurnEnd, false)
  assert.equal(wakeWords(fact, timeOf), null)
  // Failed on every path: the attention words.
  const other = emptyWakes()
  claim(other, { chat: 'Worker 2', spell: W2_SPELL, path: 'launch', by: 'board', jobId: 'l', now: at(10, 32) })
  sent(other, 'Worker 2', 'l', at(10, 32))
  pass(other, at(10, 35))
  const w2 = { ...lane, name: 'Worker 2', asleepSince: W2_SPELL }
  assert.deepEqual(wakeWords(wakeFact({ record: other, senderClaims: false, canLaunch: true }, w2), timeOf), { tone: 'attention', text: 'could not wake: the app did not start it' })
  assert.deepEqual(wakeWords(wakeFact({ record: other, senderClaims: true, canLaunch: true }, w2), timeOf), { tone: 'quiet', text: 'waking · the app did not start it; trying the other way' })
})

// ---- The review of 2026-11-02: the fixes before landing.

test('review (2): only a message begins a first turn; a launch-woken chat, or one whose own report says idle after the verdict, has none', async () => {
  const { inFirstTurn } = await import('../src/wake.mjs')
  const launched = emptyWakes()
  claim(launched, { chat: 'Worker 2', spell: W2_SPELL, path: 'launch', by: 'board', jobId: 'l', now: at(10, 32), runBefore: RUN_OLD })
  sent(launched, 'Worker 2', 'l', at(10, 32, 5))
  heard(launched, 'Worker 2', { state: 'idle', run: RUN_NEW, at: at(10, 32, 40) }, at(10, 32, 40))
  assert.equal(inFirstTurn(launched, 'Worker 2', { state: 'idle', at: at(10, 32, 40) }), false)
  const messaged = emptyWakes()
  claim(messaged, { chat: 'Worker 5', spell: W5_SPELL, path: 'message', by: 'Advisor', jobId: 'm', now: at(11, 6, 45), runBefore: RUN_OLD })
  sent(messaged, 'Worker 5', 'm', at(11, 6, 50))
  heard(messaged, 'Worker 5', { state: 'busy', run: RUN_NEW, at: at(11, 7, 3) }, at(11, 7, 3))
  assert.equal(inFirstTurn(messaged, 'Worker 5', { state: 'busy', at: at(11, 7, 8) }), true)
  // The person opened it instead: its report says idle after the verdict, no turn runs.
  assert.equal(inFirstTurn(messaged, 'Worker 5', { state: 'idle', at: at(11, 7, 8) }), false)
})

test('review (3, 4b): the notice holds for the whole spell, need or not; "nobody answers" when no sender claims and every need waits for one', () => {
  const record = emptyWakes()
  claim(record, { chat: 'Worker 2', spell: W2_SPELL, path: 'launch', by: 'board', jobId: 'l', now: at(10, 32) })
  sent(record, 'Worker 2', 'l', at(10, 32))
  pass(record, at(10, 35))
  // The take-back ended its need: the chat is a target without a need, its spell's tries stand.
  const target = { chat: 'Worker 2', spell: W2_SPELL, paths: ['launch'], need: false }
  // P5 (2026-11-09): the line stays (it is news that the chat does not run) but quiet: nothing waits for it now (src/stillTrue.mjs).
  assert.deepEqual(noticeOf(record, [target], at(10, 41), timeOf, { senderClaims: false }), { tone: 'quiet', text: 'could not wake Worker 2 at 10:35; nothing waits for it now' })
  assert.match(noticeOf(record, [{ ...target, need: true }], at(10, 41), timeOf, { senderClaims: true }).text, /^could not wake Worker 2: the app did not start it \(launched 10:32\); open its chat$/)
  // Every need waits for a chat that can send (no sender, no launch): the board-wide line.
  const waiting = noticeOf(emptyWakes(), [{ chat: 'Worker 3', spell: 1, paths: ['message'], need: true }], at(10, 41), timeOf, { senderClaims: false })
  assert.equal(waiting.text, 'nobody answers the board\'s wake-ups: open any chat')
  assert.equal(noticeOf(emptyWakes(), [{ chat: 'Worker 3', spell: 1, paths: ['message'], need: true }], at(10, 41), timeOf, { senderClaims: true }), null)
})

test('review (5, 6): a wake on its way or done holds back a start word; a spell value already kept is never a new entry (A, B, A)', async () => {
  const { isWakeOnItsWay } = await import('../src/wake.mjs')
  const record = emptyWakes()
  assert.equal(isWakeOnItsWay(record, 'Worker 2', 7), false)
  claim(record, { chat: 'Worker 2', spell: 7, path: 'message', by: 'Advisor', jobId: 'm', now: at(10, 31) })
  assert.equal(isWakeOnItsWay(record, 'Worker 2', 7), true)
  failedToSend(record, 'Worker 2', 'm', 'no', at(10, 31, 5))
  assert.equal(isWakeOnItsWay(record, 'Worker 2', 7), false, 'a failed one holds nothing back')
  assert.equal(newSpell(record, 'Worker 2', 8), true)
  assert.equal(newSpell(record, 'Worker 2', 7), false, 'A again is the kept entry')
  assert.equal(nextPath(record, { chat: 'Worker 2', spell: 7, senderClaims: true }), 'launch', 'its message stays spent')
  // A chat that never reported has spell 0, not its last activity.
  assert.equal(spellOf({ isRunning: false, lastActivityAt: 12345 }), 0)
})
