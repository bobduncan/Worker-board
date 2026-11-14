// F19 (.claude/plans/2026-11-14-f19-restart-gone-link.md, section 8, and the fix round of both review lenses): the courier restarts a chat
// whose board link is gone. The garden is Worker 4's real unload (its two deltas, 2026-11-13 21:36:27Z, 22:36 on this PC's clock) on a
// made-up board.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { STATUSES, countsOf, statusesOf } from '../src/chatStatus.mjs'
import { parseAppChat } from '../src/appChats.mjs'
import { foldOutbox, isLate, keepMs, memoryStore, outboxKnown } from '../src/store.mjs'
import { isUndelivered } from '../src/supervisor/rules/watch.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { wordJudge } from '../src/supervisor/index.mjs'
import { waitLineOf, waitsOf } from '../src/waitLine.mjs'
import { emptyWakes, textOfWakes, wakesOfFile } from '../src/wake.mjs'
import { COURIER, COURIER_WAIT_MS, carryCloses, isCarryWord } from '../src/wakeCarry.mjs'
import { MOD_GONE_WHY } from '../src/modGone.mjs'
import { sweepOutbox } from '../src/work/outboxSweep.mjs'
import {
  CHAT_RESTART, HELD_WHY, LINK_BACK_WHY, NOT_BACK_WHY, NO_COURIER_WHY, REFUSED_WHY, RESTARTING_WHY, RESTART_QUIET_MS, RESTART_REFUSED_MS, RESTART_TAKEN_MS,
  RESTART_VERDICT_MS, STUCK_WHY, UNARCHIVE_LIST_MS, UNSAID_WHY, alsoUnarchiveOf, archivedLine, archivedOfWord, isArchivedIn, isRestartWord, noteRestartSent, noteRestartTaken,
  noteRestartVerdict, restartArchivedOf, restartCloses, restartNeeds, restartRowOf, restartSpent, restartStandOf, restartTakeable, restartWakeText, restartWord, unarchiveListing,
} from '../src/restartGone.mjs'

const MIN = 60_000
// Worker 4's second unload (F9's real case: retract at 21:36:27.000Z, the instructions removed at 21:36:27.400Z).
const GONE = Date.parse('2026-11-13T21:36:27.000Z')
const NOW = GONE + 40 * MIN
const hm = ms => `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`

/** A board lane: idle by its transcript (ended, background 0, quiet 20 min) unless `more` says otherwise; its last report before the unload. */
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, isRunning: true, state: 'unknown', appSession: `local_${name.toLowerCase().replace(/ /g, '')}`,
  modGone: null, transcriptTurn: 'ended', transcriptAt: NOW - 20 * MIN, background: 0, suspended: null, report: { state: 'busy', at: GONE - MIN }, ...more })
const gone = (name, more = {}) => lane(name, { modGone: { at: GONE }, ...more })
const MAIN = lane('Main', { isMain: true })
const ctxOf = (lanes, more = {}) => ({ lanes, children: [], pause: null, limits: null, outbox: [], record: emptyWakes(), now: NOW, courierAlive: true, ...more })
const child = (id, parent, title, more = {}) => ({ id, parent, title, isArchived: false, ...more })
const wordOf = (id, more = {}) => ({ id, about: 'Worker 4', spell: GONE, takenAt: NOW - 30 * MIN, ...more })

test('the real case: Worker 4 (ended, background 0, quiet 10 min, the courier alive) needs one restart; its word and its wake text', () => {
  const ctx = ctxOf([MAIN, gone('Worker 4', { transcriptAt: GONE + 30_000 })])
  assert.deepEqual(restartNeeds(ctx), [{ chat: 'Worker 4', session: 'local_worker4', spell: GONE }])
  const word = restartWord({ id: 'r1', at: NOW, need: restartNeeds(ctx)[0] })
  assert.deepEqual([word.to, word.command, word.forModel, word.about, word.session, word.spell, word.state], [COURIER, CHAT_RESTART, true, 'Worker 4', 'local_worker4', GONE, 'waiting'])
  assert.equal(word.wakeText, `The worker board restarted this chat: its Workers mod was unloaded at ${hm(GONE)}. Go on where you were; if nothing waits for you, end this turn.`)
  assert.equal(restartWakeText(GONE), word.wakeText)
  // The outbox keeps it (a word without a text is no word for store.mjs `foldOutbox`: lost at the board's restart).
  assert.deepEqual(foldOutbox(`${JSON.stringify(word)}\n`).map(one => one.id), ['r1'])
  // F17's flow never sees it.
  assert.equal(isCarryWord(word), false)
  assert.equal(isRestartWord(word), true)
  // An open word holds a second one off.
  assert.deepEqual(restartNeeds({ ...ctx, outbox: [word] }), [])
})

test('a busy, asking or background chat is never listed; quiet 5 min is not (it waits on the quiet clock); Remote Control on is not', () => {
  for (const more of [{ transcriptTurn: 'running' }, { transcriptTurn: 'asking' }, { background: 1 }, { background: null }, { transcriptTurn: null }, { remoteControl: true }]) {
    const ctx = ctxOf([MAIN, gone('Worker 4', more)])
    assert.deepEqual(restartNeeds(ctx), [], JSON.stringify(more))
    assert.equal(restartStandOf(ctx.lanes[1], ctx).kind, 'no', JSON.stringify(more))
  }
  const remote = ctxOf([MAIN, gone('Worker 4', { remoteControl: true })])
  assert.equal(restartStandOf(remote.lanes[1], remote).reason, 'Remote Control is on')
  assert.deepEqual(restartRowOf(restartStandOf(remote.lanes[1], remote)), { restarting: false, why: MOD_GONE_WHY, quiet: false })
  // The app's file says so (appChats.mjs).
  assert.equal(parseAppChat(JSON.stringify({ title: 'Game - Worker 4', cliSessionId: 'c', sessionId: 'local_w4', remoteControlUserEnabled: true })).remoteControl, true)
  const quiet = ctxOf([MAIN, gone('Worker 4', { transcriptAt: NOW - 5 * MIN })])
  assert.deepEqual(restartNeeds(quiet), [])
  assert.deepEqual(restartStandOf(quiet.lanes[1], quiet), { kind: 'quiet', at: NOW - 5 * MIN + RESTART_QUIET_MS })
  // Exactly the quiet clock: listed.
  assert.equal(restartNeeds(ctxOf([MAIN, gone('Worker 4', { transcriptAt: NOW - RESTART_QUIET_MS })])).length, 1)
})

test('D3\': the chats a target\'s archive takes along are its children as the app\'s files name them; only those must be idle', () => {
  const main = gone('Main', { isMain: true, appSession: 'local_main' })
  const lanes = more => [main, lane('Advisor', { appSession: 'local_adv', ...more }), lane('Worker 1', { appSession: 'local_w1', background: 3 })]
  // Main started the Advisor (its child); Worker 1 is a routine's (no parent): its background work does not hold Main.
  const children = [child('local_adv', 'local_main', 'Game - Advisor'), child('local_other', 'local_side', 'Chat 3')]
  assert.equal(restartNeeds(ctxOf(lanes({}), { children })).length, 1)
  assert.deepEqual(alsoUnarchiveOf(main, children), ['local_adv'])
  // The child busy or with background work: Main waits.
  assert.deepEqual(restartNeeds(ctxOf(lanes({ background: 1 }), { children })), [])
  assert.equal(restartStandOf(main, ctxOf(lanes({ background: 1 }), { children })).reason, 'its chats are not idle')
  // The child on the quiet clock: Main waits for it too.
  const later = ctxOf(lanes({ transcriptAt: NOW - 4 * MIN }), { children })
  assert.deepEqual(restartStandOf(main, later), { kind: 'quiet', at: NOW - 4 * MIN + RESTART_QUIET_MS })
  // A child the board cannot see (no board lane): Main does not qualify.
  const unseen = [...children, child('local_side2', 'local_main', 'Chat 4')]
  assert.deepEqual(restartStandOf(main, ctxOf(lanes({}), { children: unseen })), { kind: 'no', why: MOD_GONE_WHY, reason: 'it started Chat 4, which the board cannot see' })
  // An archived child is not on the list; a chat without children carries an empty one (any target: a worker too).
  assert.deepEqual(alsoUnarchiveOf(main, [child('local_adv', 'local_main', 'A', { isArchived: true })]), [])
  assert.deepEqual(alsoUnarchiveOf(gone('Worker 4'), children), [])
  assert.deepEqual(alsoUnarchiveOf(gone('Worker 4'), [child('local_x', 'local_worker4', 'X')]), ['local_x'])
  // The app's file names the parent (appChats.mjs).
  assert.equal(parseAppChat(JSON.stringify({ title: 'Game - Advisor', cliSessionId: 'c', sessionId: 'local_adv', spawnedFrom: { sessionId: 'local_main' } })).spawnedFrom, 'local_main')
})

test('the same spell after a taken word is not listed, a new spell is; a refused archive spends no try and waits 30 min; three refusals stop it', () => {
  const record = emptyWakes()
  noteRestartTaken(record, { chat: 'Worker 4', spell: GONE, word: 'r1', now: NOW - 30 * MIN })
  noteRestartVerdict(record, wordOf('r1'), 'failed', NOT_BACK_WHY, NOW - 15 * MIN)
  assert.equal(restartSpent(record, 'Worker 4', GONE), true)
  assert.deepEqual(restartNeeds(ctxOf([MAIN, gone('Worker 4')], { record })), [])
  assert.equal(restartStandOf(gone('Worker 4'), ctxOf([], { record })).kind, 'failed')
  // A new unload later is a new spell.
  assert.equal(restartNeeds(ctxOf([MAIN, gone('Worker 4', { modGone: { at: GONE + 20 * MIN } })], { record })).length, 1)
  // Refused: no try spent, no word for 30 min after the refusal.
  const refused = emptyWakes()
  noteRestartTaken(refused, { chat: 'Worker 4', spell: GONE, word: 'r2', now: NOW - 12 * MIN })
  noteRestartVerdict(refused, wordOf('r2'), 'refused', REFUSED_WHY, NOW - 10 * MIN)
  assert.equal(restartSpent(refused, 'Worker 4', GONE), false)
  assert.deepEqual(restartStandOf(gone('Worker 4'), ctxOf([], { record: refused })), { kind: 'refused', why: REFUSED_WHY, until: NOW - 10 * MIN + RESTART_REFUSED_MS })
  assert.deepEqual(restartNeeds(ctxOf([MAIN, gone('Worker 4')], { record: refused })), [])
  assert.equal(restartNeeds(ctxOf([MAIN, gone('Worker 4')], { record: refused, now: NOW + 20 * MIN })).length, 1, '30 min after the refusal')
  for (const n of [3, 4]) {
    noteRestartTaken(refused, { chat: 'Worker 4', spell: GONE, word: `r${n}`, now: NOW - MIN })
    noteRestartVerdict(refused, wordOf(`r${n}`), 'refused', REFUSED_WHY, NOW - 100 * MIN)
  }
  assert.equal(restartStandOf(gone('Worker 4'), ctxOf([], { record: refused, now: NOW + 60 * MIN })).reason, 'the app refused the archive 3 times')
})

test('the fix round, item 5: the spell counts spent from the raw outbox too; an open try reads Restarting only while its word is open', () => {
  // The board died a second after the take: the outbox has the word taken, the record has no try.
  const taken = { ...restartWord({ id: 'r1', at: NOW - 20 * MIN, need: { chat: 'Worker 4', session: 'local_worker4', spell: GONE } }), state: 'dropped', takenAt: NOW - 19 * MIN, why: NOT_BACK_WHY }
  assert.equal(restartSpent(emptyWakes(), 'Worker 4', GONE, [taken]), true)
  assert.deepEqual(restartNeeds(ctxOf([MAIN, gone('Worker 4')], { outbox: [taken] })), [])
  // A refused one in the outbox spends nothing.
  assert.equal(restartSpent(emptyWakes(), 'Worker 4', GONE, [{ ...taken, why: REFUSED_WHY }]), false)
  // The record's try without a verdict whose word is closed: failed, never Restarting for good.
  const record = emptyWakes()
  noteRestartTaken(record, { chat: 'Worker 4', spell: GONE, word: 'r1', now: NOW - 19 * MIN })
  assert.equal(restartStandOf(gone('Worker 4'), ctxOf([], { record, outbox: [taken] })).kind, 'failed')
  assert.equal(restartStandOf(gone('Worker 4'), ctxOf([], { record, outbox: [{ ...taken, state: 'taken' }] })).kind, 'restarting')
  // sent and the verdict add the try from the word when the record lacks it.
  const lacking = emptyWakes()
  assert.equal(noteRestartSent(lacking, wordOf('r9'), NOW), true)
  assert.deepEqual(lacking.restartTries.get('Worker 4').map(one => [one.word, one.sentAt]), [['r9', NOW]])
  const lacking2 = emptyWakes()
  assert.equal(noteRestartVerdict(lacking2, wordOf('r8'), 'failed', NOT_BACK_WHY, NOW), true)
  assert.equal(restartSpent(lacking2, 'Worker 4', GONE), true)
})

test('the try survives a pruned outbox view and the board\'s restart (the record\'s file); pruned with the spells', () => {
  const record = emptyWakes()
  noteRestartTaken(record, { chat: 'Worker 4', spell: GONE, word: 'r1', now: NOW - 30 * MIN })
  noteRestartSent(record, wordOf('r1'), NOW - 29 * MIN)
  noteRestartVerdict(record, wordOf('r1'), 'failed', NOT_BACK_WHY, NOW - 19 * MIN)
  const again = wakesOfFile(JSON.parse(textOfWakes(record)))
  assert.deepEqual(again.restartTries.get('Worker 4'), [{ spell: GONE, word: 'r1', takenAt: NOW - 30 * MIN, sentAt: NOW - 29 * MIN, verdict: 'failed', verdictAt: NOW - 19 * MIN, why: NOT_BACK_WHY }])
  // No word in the outbox at all (an old view, pruned): still no second try.
  assert.deepEqual(restartNeeds(ctxOf([MAIN, gone('Worker 4')], { record: again, outbox: [] })), [])
  for (let n = 1; n <= 7; n += 1) noteRestartTaken(record, { chat: 'Worker 4', spell: GONE + n, word: `s${n}`, now: NOW })
  assert.deepEqual([...new Set(record.restartTries.get('Worker 4').map(one => one.spell))], [2, 3, 4, 5, 6, 7].map(n => GONE + n))
  // A record without tries writes none.
  assert.equal(Object.hasOwn(JSON.parse(textOfWakes(emptyWakes())), 'restartTries'), false)
})

test('pause, a full limit, a suspended lane, a stop, a removal, a task stop: not listed; no courier, no word; at most 3 restarts a day', () => {
  const lanes = [MAIN, gone('Worker 4')]
  assert.deepEqual(restartNeeds(ctxOf(lanes, { pause: { state: 'pausing', since: NOW - MIN } })), [])
  assert.deepEqual(restartNeeds(ctxOf(lanes, { limits: { week: { level: 'full' }, fiveHour: { level: 'ok' } } })), [])
  assert.deepEqual(restartNeeds(ctxOf(lanes, { limits: { week: { level: 'warn' }, fiveHour: { level: 'full' } } })), [])
  assert.equal(restartNeeds(ctxOf(lanes, { limits: { week: { level: 'warn' }, fiveHour: { level: 'ok' } } })).length, 1)
  assert.deepEqual(restartNeeds(ctxOf([MAIN, gone('Worker 4', { suspended: { by: 'app', limit: 'week' } })])), [])
  const stopped = { id: 's', at: NOW - MIN, to: 'Worker 4', text: 'Go on.', state: 'waiting', stoppedAt: NOW - MIN, stoppedSession: 'x' }
  assert.equal(restartStandOf(lanes[1], ctxOf(lanes, { outbox: [stopped] })).kind, 'no')
  // The fix round, item 3: being removed, or stopped by the person.
  for (const [more, outbox] of [[{ removedAt: NOW - MIN }, []], [{ removal: { isOpen: true } }, []], [{}, [{ id: 'rm', at: NOW - MIN, to: 'Main', command: 'remove', about: 'Worker 4', text: 'x', state: 'taken' }]],
    [{}, [{ id: 'st', at: NOW - MIN, to: 'Main', command: 'stop', byCode: true, about: 'Worker 4', text: 'x', state: 'waiting' }]]]) {
    const ctx = ctxOf([MAIN, gone('Worker 4', more)], { outbox })
    assert.deepEqual(restartNeeds(ctx), [], JSON.stringify([more, outbox]))
  }
  assert.deepEqual(restartNeeds(ctxOf(lanes, { courierAlive: false })), [])
  assert.deepEqual(restartStandOf(lanes[1], ctxOf(lanes, { courierAlive: false })), { kind: 'no', why: MOD_GONE_WHY, reason: 'no courier' })
  // Resumed: listed again (the same spell gets its one word).
  assert.equal(restartNeeds(ctxOf(lanes, { pause: { state: 'resuming', since: NOW - MIN } })).length, 1)
  // Three restarts in a day (other spells): no fourth.
  const record = emptyWakes()
  for (let n = 1; n <= 3; n += 1) {
    noteRestartTaken(record, { chat: 'Worker 4', spell: GONE - n * MIN, word: `d${n}`, now: NOW - n * 60 * MIN })
    noteRestartVerdict(record, wordOf(`d${n}`, { spell: GONE - n * MIN }), 'back', LINK_BACK_WHY, NOW - n * 50 * MIN)
  }
  assert.equal(restartStandOf(lanes[1], ctxOf(lanes, { record })).reason, 'restarted 3 times in a day')
})

const waiting = (more = {}) => ({ ...restartWord({ id: 'r1', at: NOW - MIN, need: { chat: 'Worker 4', session: 'local_worker4', spell: GONE } }), ...more })
const back = (name, more = {}) => lane(name, { report: { state: 'idle', at: NOW - 30_000 }, ...more })

test('the closes: a hold drops a waiting word without a try; COURIER_WAIT_MS drops it "the courier did not come"; link back; the windows', () => {
  const lanes = [MAIN, gone('Worker 4')]
  assert.deepEqual(restartCloses({ outbox: [waiting()], lanes, now: NOW, pause: { state: 'pausing' } }), [{ id: 'r1', state: 'dropped', why: HELD_WHY, verdict: null }])
  assert.deepEqual(restartCloses({ outbox: [waiting()], lanes, now: NOW, limits: { week: { level: 'full' } } }), [{ id: 'r1', state: 'dropped', why: HELD_WHY, verdict: null }])
  assert.deepEqual(restartCloses({ outbox: [waiting()], lanes: [MAIN, gone('Worker 4', { suspended: { by: 'app' } })], now: NOW }), [{ id: 'r1', state: 'dropped', why: HELD_WHY, verdict: null }])
  // The fix round, item 3: a removal or a task stop drops it too.
  assert.equal(restartCloses({ outbox: [waiting()], lanes: [MAIN, gone('Worker 4', { removedAt: NOW - MIN })], now: NOW })[0]?.why, HELD_WHY)
  assert.equal(restartCloses({ outbox: [waiting(), { id: 'st', at: NOW - MIN, to: 'Main', command: 'stop', byCode: true, about: 'Worker 4', text: 'x', state: 'waiting' }], lanes, now: NOW })[0]?.why, HELD_WHY)
  assert.deepEqual(restartCloses({ outbox: [waiting()], lanes, now: NOW }), [])
  assert.deepEqual(restartCloses({ outbox: [waiting()], lanes, now: NOW - MIN + COURIER_WAIT_MS }), [{ id: 'r1', state: 'dropped', why: NO_COURIER_WHY, verdict: null }])
  // Link back: its chat on the board with a report heard after the unload, or the app started after it.
  assert.deepEqual(restartCloses({ outbox: [waiting()], lanes: [MAIN, back('Worker 4')], now: NOW }), [{ id: 'r1', state: 'dropped', why: LINK_BACK_WHY, verdict: null }])
  assert.equal(restartCloses({ outbox: [waiting()], lanes: [MAIN, lane('Worker 4')], now: NOW, appStartedAt: GONE + MIN })[0]?.why, LINK_BACK_WHY)
  const sent = waiting({ state: 'taken', takenBy: COURIER, takenAt: NOW - 3 * MIN, sentAt: NOW - 2 * MIN })
  assert.deepEqual(restartCloses({ outbox: [sent], lanes: [MAIN, back('Worker 4')], now: NOW }), [{ id: 'r1', state: 'delivered', why: LINK_BACK_WHY, verdict: 'back', archived: [] }])
  // Off the board (archived mid-run): no "link is back".
  assert.deepEqual(restartCloses({ outbox: [sent], lanes: [MAIN], now: NOW }), [])
  // Sent, no report 10 min after: failed.
  assert.deepEqual(restartCloses({ outbox: [sent], lanes, now: NOW - 2 * MIN + RESTART_VERDICT_MS }), [{ id: 'r1', state: 'dropped', why: NOT_BACK_WHY, verdict: 'failed', failed: true, archived: [] }])
  assert.deepEqual(restartCloses({ outbox: [sent], lanes, now: NOW - 2 * MIN + RESTART_VERDICT_MS - 1 }), [])
  // A taken word without wakes-sent: failed at 15 min, not before.
  const taken = waiting({ state: 'taken', takenBy: COURIER, takenAt: NOW - RESTART_TAKEN_MS })
  assert.deepEqual(restartCloses({ outbox: [taken], lanes, now: NOW }), [{ id: 'r1', state: 'dropped', why: UNSAID_WHY, verdict: 'failed', failed: true, unarchive: false, archived: [] }])
  assert.deepEqual(restartCloses({ outbox: [taken], lanes, now: NOW - 1 }), [])
  // A held taken word is not dropped by the hold (the courier has it).
  assert.deepEqual(restartCloses({ outbox: [taken], lanes, now: NOW - 1, pause: { state: 'pausing' } }), [])
})

test('the fix round, item 4: a gone link that reads null alone (an unreadable transcript) is no link back', () => {
  const sent = waiting({ state: 'taken', takenBy: COURIER, takenAt: NOW - 3 * MIN, sentAt: NOW - 2 * MIN })
  // modGone null, its last report from before the unload, the app not started since: no close.
  assert.deepEqual(restartCloses({ outbox: [sent], lanes: [MAIN, lane('Worker 4')], now: NOW }), [])
  // A report kept from before the board's start reads as heard then; its own time (`heardAt`) counts.
  assert.deepEqual(restartCloses({ outbox: [sent], lanes: [MAIN, lane('Worker 4', { report: { state: 'idle', at: NOW - MIN, heardAt: GONE - MIN } })], now: NOW }), [])
})

test('the unarchive entry only on its conditions: seen archived within the run window, still off the board, no removal since the take', () => {
  const taken = more => waiting({ state: 'taken', takenBy: COURIER, takenAt: NOW - RESTART_TAKEN_MS, alsoUnarchive: ['local_worker1'], ...more })
  const closeOf = (word, lanes = [MAIN], outbox = [word]) => restartCloses({ outbox, lanes, now: NOW })[0]
  assert.equal(closeOf(taken({ archivedAt: NOW - 10 * MIN })).unarchive, true)
  assert.equal(closeOf(taken({})).unarchive, false, 'never seen archived')
  assert.equal(closeOf(taken({ archivedAt: NOW - RESTART_TAKEN_MS - MIN })).unarchive, false, 'before the take')
  assert.equal(closeOf(taken({ archivedAt: NOW - 10 * MIN }), [MAIN, gone('Worker 4')]).unarchive, false, 'back on the board')
  // The fix round, item 3: a remove word made after the take, in any state (also one already settled).
  const remove = state => ({ id: 'rm', at: NOW - 5 * MIN, to: 'Main', command: 'remove', about: 'Worker 4', text: 'x', state })
  for (const state of ['waiting', 'delivered']) assert.equal(closeOf(taken({ archivedAt: NOW - 10 * MIN }), [MAIN], [taken({ archivedAt: NOW - 10 * MIN }), remove(state)]).unarchive, false, state)
  // The app's own file says archived.
  const folders = [{ at: 2, chats: new Map([['local_worker4', { isArchived: true }]]) }, { at: 1, chats: new Map([['local_worker4', { isArchived: false }]]) }]
  assert.equal(isArchivedIn('local_worker4', folders), true)
  assert.equal(isArchivedIn('local_worker4', [folders[1]]), false)
  assert.equal(isArchivedIn('local_other', folders), false)
})

test('the fix round, items 6, 7: a taken word\'s chats archived at its close are kept and named; the unarchive entry lists only those, once, within 30 min', () => {
  const archived = new Set(['local_worker4', 'local_adv'])
  const isArchived = id => archived.has(id)
  const taken = waiting({ state: 'taken', takenBy: COURIER, takenAt: NOW - RESTART_TAKEN_MS, archivedAt: NOW - 10 * MIN, alsoUnarchive: ['local_adv', 'local_w1'], alsoChats: { local_adv: 'Advisor', local_w1: 'Worker 1' } })
  assert.deepEqual(archivedOfWord(taken, isArchived), [{ id: 'local_worker4', chat: 'Worker 4' }, { id: 'local_adv', chat: 'Advisor' }])
  assert.deepEqual(archivedOfWord(taken, null), [], 'no read of the files, no fact')
  const close = restartCloses({ outbox: [taken], lanes: [MAIN], now: NOW, isArchived })[0]
  assert.deepEqual([close.unarchive, close.archived], [true, [{ id: 'local_worker4', chat: 'Worker 4' }, { id: 'local_adv', chat: 'Advisor' }]])
  // A starter's verdict too: its link back with a child still archived.
  const sent = waiting({ state: 'taken', takenAt: NOW - 3 * MIN, sentAt: NOW - 2 * MIN, alsoUnarchive: ['local_adv'], alsoChats: { local_adv: 'Advisor' } })
  assert.deepEqual(restartCloses({ outbox: [sent], lanes: [MAIN, back('Worker 4')], now: NOW, isArchived })[0].archived, [{ id: 'local_worker4', chat: 'Worker 4' }, { id: 'local_adv', chat: 'Advisor' }])
  // The Overview names what the files showed archived, while it is off the board; never "off the board" alone.
  const closed = { ...taken, state: 'dropped', why: UNSAID_WHY, failed: true, closedAt: NOW, archived: close.archived, unarchive: 'due' }
  assert.deepEqual(restartArchivedOf([closed], [MAIN], NOW), ['Worker 4', 'Advisor'])
  assert.deepEqual(restartArchivedOf([closed], [MAIN, lane('Advisor')], NOW), ['Worker 4'])
  assert.deepEqual(restartArchivedOf([{ ...closed, archived: [] }], [MAIN], NOW), [], 'off the board alone names nothing')
  // The listing: the take's list that is archived now, the target still archived, within 30 min, no removal since the take.
  assert.deepEqual(unarchiveListing(closed, { now: NOW + MIN, outbox: [closed], lanes: [MAIN], isArchived }), { entry: { id: 'r1', chat: 'Worker 4', session: 'local_worker4', unarchive: true, alsoUnarchive: ['local_adv'] } })
  assert.deepEqual(unarchiveListing(closed, { now: NOW + UNARCHIVE_LIST_MS + 1, outbox: [closed], lanes: [MAIN], isArchived }), { clear: 'listed too late' })
  assert.deepEqual(unarchiveListing(closed, { now: NOW + MIN, outbox: [closed, { id: 'rm', at: NOW, to: 'Main', command: 'remove', about: 'Worker 4', text: 'x', state: 'delivered' }], lanes: [MAIN], isArchived }), { clear: 'its chat is being removed' })
  assert.deepEqual(unarchiveListing(closed, { now: NOW + MIN, outbox: [closed], lanes: [MAIN], isArchived: () => false }), { clear: 'it is no longer archived' })
  assert.equal(archivedLine('Worker 4'), 'Worker 4 is archived: unarchive it')
})

test('a carry word is untouched by these closes, and a restart word by F17\'s', () => {
  const carry = { id: 'c1', at: NOW - 30 * MIN, to: COURIER, command: 'wake-carry', about: 'Worker 4', forModel: true, spell: GONE, session: 'local_worker4', wakeText: 'x', text: 'x', state: 'waiting' }
  assert.deepEqual(restartCloses({ outbox: [carry], lanes: [MAIN, back('Worker 4')], now: NOW, pause: { state: 'pausing' } }), [])
  assert.deepEqual(carryCloses({ outbox: [waiting()], lanes: [MAIN], attemptOf: () => null, now: NOW, paused: true }), [])
})

test('a waiting word is never expired by the sweep (its own keep), and rule 8 never names it', () => {
  const keep = { messageMs: 10 * MIN, answerMs: 3 * 60 * MIN }
  const old = waiting({ at: NOW - 10 * 24 * 60 * MIN })
  assert.equal(keepMs(old, keep), Infinity)
  assert.equal(isLate(old, NOW, keep), false)
  assert.equal(outboxKnown([old], NOW, keep)[0].state, 'waiting')
  const view = buildView({ state: { chats: [gone('Worker 4')], today: [], limits: {}, pause: null, chatPrefix: '', restart: { main: 'Main' } }, items: new Map(), outbox: [old], settings: {}, now: NOW })
  assert.equal(isUndelivered(view, old), false)
})

test('the fix round, item 8: while the courier restarts a chat (its archive takes it off the board), F23 releases none of its held words', async () => {
  const KEEP = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN, pause: null }
  const held = { id: 'h1', at: NOW - 40 * MIN, to: 'Worker 4', ask: null, command: 'round', text: 'the round', state: 'waiting', linkHeldAt: NOW - 30 * MIN }
  const stateOf = chats => ({ chats, chatPrefix: '', restart: { main: 'Main' }, pause: null, today: [], limits: {} })
  for (const word of [waiting({ state: 'taken', takenAt: NOW - MIN }), waiting({ state: 'dropped', unarchive: 'due', closedAt: NOW - MIN })]) {
    const outbox = memoryStore()
    for (const one of [held, word]) await outbox.say({ ...one })
    // Worker 4 off the board (archived): its held word stays held.
    await sweepOutbox({ dir: null, outbox, state: stateOf([MAIN]), now: NOW, keep: KEEP })
    assert.equal(outbox.outbox().find(one => one.id === 'h1').linkHeldAt, NOW - 30 * MIN, word.state)
  }
  // Without the restart word, as F23: released.
  const outbox = memoryStore()
  await outbox.say({ ...held })
  await sweepOutbox({ dir: null, outbox, state: stateOf([MAIN]), now: NOW, keep: KEEP })
  assert.equal(outbox.outbox().find(one => one.id === 'h1').linkHeldAt, null)
})

test('the courier\'s take re-checks: busy now, another spell or session, an open carry word, a child\'s restart taken: not takeable', () => {
  const ctx = ctxOf([MAIN, gone('Worker 4')])
  assert.equal(restartTakeable(waiting(), ctx), true)
  assert.equal(restartTakeable(waiting(), ctxOf([MAIN, gone('Worker 4', { transcriptTurn: 'running' })])), false)
  assert.equal(restartTakeable(waiting({ spell: GONE - MIN }), ctx), false)
  assert.equal(restartTakeable(waiting({ session: 'local_other' }), ctx), false)
  assert.equal(restartTakeable(waiting({ state: 'taken' }), ctx), false)
  assert.equal(restartTakeable(waiting(), ctxOf([MAIN])), false, 'off the board')
  const carry = { id: 'c1', at: NOW - MIN, to: COURIER, command: 'wake-carry', about: 'Worker 4', text: 'x', state: 'waiting' }
  assert.equal(restartTakeable(waiting(), { ...ctx, outbox: [carry] }), false)
  const main = gone('Main', { isMain: true, appSession: 'local_main' })
  const kids = { lanes: [main, gone('Worker 4')], children: [child('local_worker4', 'local_main', 'Game - Worker 4')] }
  const mainWord = { ...waiting(), id: 'm1', about: 'Main', session: 'local_main' }
  assert.equal(restartTakeable(mainWord, ctxOf(kids.lanes, { children: kids.children, outbox: [waiting({ state: 'taken', takenAt: NOW })] })), false)
})

test('the page: quiet "restarts by itself at the courier\'s next run (about HH:MM)", Restarting once taken, attention otherwise', () => {
  const quiet = ctxOf([MAIN, gone('Worker 4', { transcriptAt: NOW - 5 * MIN })])
  assert.deepEqual(restartRowOf(restartStandOf(quiet.lanes[1], quiet)), { restarting: false, why: `restarts by itself at the courier's next run (about ${hm(NOW + 5 * MIN)})`, quiet: true })
  // The fix round, item 11: the courier's next run when it is later than the quiet clock's end.
  const ready = ctxOf([MAIN, gone('Worker 4')])
  assert.equal(restartRowOf(restartStandOf(ready.lanes[1], ready), { courierAt: NOW - 2 * MIN }).why, `restarts by itself at the courier's next run (about ${hm(NOW + 8 * MIN)})`)
  assert.equal(restartRowOf(restartStandOf(quiet.lanes[1], quiet), { courierAt: NOW - 8 * MIN }).why, `restarts by itself at the courier's next run (about ${hm(NOW + 5 * MIN)})`)
  const taken = ctxOf([MAIN, gone('Worker 4')], { outbox: [waiting({ state: 'taken', takenBy: COURIER, takenAt: NOW })] })
  assert.deepEqual(restartRowOf(restartStandOf(taken.lanes[1], taken)), { restarting: true, why: RESTARTING_WHY, quiet: true })
  for (const ctx of [ctxOf([MAIN, gone('Worker 4', { background: 1 })]), ctxOf([MAIN, gone('Worker 4')], { courierAlive: false }), ctxOf([MAIN, gone('Worker 4', { appSession: null })])]) {
    assert.deepEqual(restartRowOf(restartStandOf(ctx.lanes[1], ctx)), { restarting: false, why: MOD_GONE_WHY, quiet: false })
  }
  // The fix round, item 13: a failed or stuck try shows F9's way out (the try's why is the log's).
  const record = emptyWakes()
  noteRestartTaken(record, { chat: 'Worker 4', spell: GONE, word: 'r1', now: NOW - 20 * MIN })
  noteRestartVerdict(record, wordOf('r1'), 'stuck', STUCK_WHY, NOW - 19 * MIN)
  assert.deepEqual(restartRowOf(restartStandOf(gone('Worker 4'), ctxOf([], { record }))), { restarting: false, why: MOD_GONE_WHY, quiet: false })
  assert.equal(restartRowOf(null), null)
})

test('the fix round, item 9: a quiet Link gone counts under Restarting and goes to the Workers pane quiet', () => {
  const chats = [{ name: 'Worker 4', status: STATUSES.LINK_GONE, quiet: true, why: 'x' }, { name: 'Worker 5', status: STATUSES.LINK_GONE, why: MOD_GONE_WHY }]
  const counts = countsOf(chats)
  assert.deepEqual([counts.restarting, counts.linkgone], [1, 1])
  assert.deepEqual(statusesOf({ chats }).map(one => one.tone), ['quiet', 'attention'])
})

test('the fix round, item 10: a word held for a chat the courier restarts says that way, quietly; else F9\'s way out, as F23', () => {
  const quietLane = gone('Worker 4', { isRunning: false, status: 'Link gone', quiet: true, why: 'restarts by itself at the courier\'s next run (about 14:10)' })
  const word = { id: 'w1', at: NOW - 20 * MIN, to: 'Worker 4', ask: 'Q12', command: null, text: 'Yes, B', state: 'waiting', linkHeldAt: NOW - 19 * MIN }
  const KEEP = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN, pause: null }
  const judge = wordJudge({ state: { chats: [quietLane], pause: null, chatPrefix: '' }, outbox: [word], settings: {}, now: NOW })
  const line = waitLineOf({ word, lane: quietLane, now: NOW, keep: KEEP, judge })
  assert.deepEqual([line.state, line.lead, line.rest], ['sent', 'Held for Worker 4\'s restart', 'its board link is gone · restarts by itself at the courier\'s next run (about 14:10)'])
  const restarting = waitLineOf({ word, lane: { ...quietLane, quiet: undefined, status: 'Restarting', why: RESTARTING_WHY }, now: NOW, keep: KEEP, judge })
  assert.equal(restarting.rest, `its board link is gone · ${RESTARTING_WHY}`)
  const attention = waitLineOf({ word, lane: { ...quietLane, quiet: undefined, why: MOD_GONE_WHY }, now: NOW, keep: KEEP, judge })
  assert.deepEqual([attention.state, attention.rest], ['late', `its board link is gone · ${MOD_GONE_WHY}`])
})

test('the fix round, item 2: the prompt says the handshake, sends only to an entry with a text that step 3 did not mark, loads the three tools by name', async () => {
  const prompt = await readFile(new URL('../tools/wake-courier.md', import.meta.url), 'utf8')
  assert.match(prompt, /-Body '\{"restarts":true\}'/)
  assert.match(prompt, /For each entry that has a `text` and that step 3 did not mark refused or stuck, call `send_message` once/)
  assert.match(prompt, /Else send it in step 4\./)
  assert.match(prompt, /It gets nothing in step 4\./)
  assert.match(prompt, /select:mcp__ccd_session_mgmt__send_message,mcp__ccd_session_mgmt__archive_session,mcp__ccd_session_mgmt__unarchive_session/)
  // The verifier's F2: both tools take `session_id` (their `session` is a label the app adds).
  assert.match(prompt, /call `archive_session` with `session_id` set to its `session`\./)
  assert.match(prompt, /call `unarchive_session` with `session_id` set to each id in `alsoUnarchive` \(ignore an error on one\), then set to the entry's `session`\./)
  assert.match(prompt, /call only `unarchive_session`, with `session_id` set to each id in `alsoUnarchive` \(ignore errors\), then set to its `session`\./)
  assert.match(prompt, /Load that tool first with one ToolSearch call if it is deferred/)
  assert.match(prompt, /<project folder>/)
  assert.doesNotMatch(prompt, /For each entry in `wakes`, call `send_message`/)
})

test('the fix round, item 10: the "No ask filed" card of a chat the courier restarts names that way, never the person\'s archive', async () => {
  const { answer, typed } = await import('../fixtures/lines.mjs')
  const { buildState } = await import('./withStore.mjs')
  const { parseConfig } = await import('../src/config.mjs')
  const at = NOW - 30 * MIN
  const words = ['**Task:** dig the beds', '', '> **For you**', '> 1. **Answer:** Deep enough? I advise yes.', '', '---', '', '```diff', '  Prompt: dig the beds', '  Who:    Garden · Digger', '- Done:   partly, waiting for your answer', '```'].join('\n')
  const app = (name, lastActivityAt) => JSON.stringify({ title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\garden', isArchived: false, createdAt: name.length, lastActivityAt })
  const retract = when => JSON.stringify({ attachment: { type: 'deferred_tools_delta', retractedTools: [{ name: 'mcp__workers__work', cause: 'not_configured' }] }, type: 'attachment', timestamp: when })
  const removed = when => JSON.stringify({ attachment: { type: 'mcp_instructions_delta', addedNames: [], removedNames: ['workers'] }, type: 'attachment', timestamp: when })
  const lost = new Date(at - 5 * MIN).toISOString()
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [app('Lead', NOW - 5 * MIN), app('Digger', at)],
    tails: { 'cli-Lead': { text: [typed(NOW - 20 * MIN, 'Report'), answer(NOW - 10 * MIN, 'All quiet.')].join('\n'), isCut: false, modifiedAt: NOW },
      'cli-Digger': { text: [typed(at - 10 * MIN, 'Dig the beds'), answer(at, words)].join('\n'), isCut: false, modifiedAt: at, mods: [retract(lost), removed(lost)].join('\n') } },
    planLineTexts: {}, backlogText: '', adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  const cardWith = courierAt => buildState(raw, { lines: [], outbox: [], runs: [], board: null, seen: null, now: NOW, config: { ...parseConfig('{}', {}), project: 'C:\garden' },
    wakes: { record: emptyWakes(), senderClaims: true, canLaunch: false, courierAt } })
  const quiet = cardWith(NOW - MIN)
  assert.equal(quiet.chats.find(one => one.name === 'Digger').quiet, true)
  const card = quiet.forYou.find(need => need.kind === 'unfiled')
  assert.match(card.text, /so its board link is gone\. Restarts by itself at the courier's next run \(about \d\d:\d\d\)\. Answer its questions in its chat\./)
  assert.doesNotMatch(card.text, /archive it, then unarchive it/)
  // No courier on the restart prompt: F9's way out, as before.
  assert.match(cardWith(null).forYou.find(need => need.kind === 'unfiled').text, /Restart this chat: archive it, then unarchive it\./)
})

test('group D: a held Link gone row says why the courier does not restart it now', () => {
  const ctx = ctxOf([MAIN, gone('Worker 4')], { pause: { state: 'pausing', since: NOW - MIN } })
  assert.equal(restartRowOf(restartStandOf(ctx.lanes[1], ctx)).why, `${MOD_GONE_WHY} (not by itself while you pause the chats)`)
})

test('the verifier\'s FF1: a side lane\'s link back reads its ownReport (with heardAt): the Advisor\'s restart closes "its link is back"', () => {
  const sent = waiting({ about: 'Advisor', session: 'local_advisor', state: 'taken', takenBy: COURIER, takenAt: NOW - 3 * MIN, sentAt: NOW - 2 * MIN })
  const advisor = more => ({ name: 'Advisor', isLeftover: false, appSession: 'local_advisor', modGone: null, ...more })
  assert.equal(restartCloses({ outbox: [sent], lanes: [MAIN, advisor({ ownReport: { state: 'idle', at: NOW - 30_000 } })], now: NOW })[0]?.why, LINK_BACK_WHY)
  // A report kept from before the board's start reads `at` = the start; its real time is before the unload: no link back.
  assert.deepEqual(restartCloses({ outbox: [sent], lanes: [MAIN, advisor({ ownReport: { state: 'idle', at: NOW - MIN, heardAt: GONE - MIN } })], now: NOW }), [])
})

test('the verifier\'s F1: a child with Remote Control on, being removed or stopped by the person keeps its parent from qualifying', () => {
  const main = gone('Main', { isMain: true, appSession: 'local_main' })
  const children = [child('local_adv', 'local_main', 'Game - Advisor')]
  const adv = more => lane('Advisor', { appSession: 'local_adv', ...more })
  const stop = { id: 'st', at: NOW - MIN, to: 'Main', command: 'stop', byCode: true, about: 'Advisor', text: 'x', state: 'waiting' }
  assert.equal(restartStandOf(main, ctxOf([main, adv({})], { children })).kind, 'ready')
  assert.equal(restartStandOf(main, ctxOf([main, adv({ remoteControl: true })], { children })).reason, 'Advisor: Remote Control is on')
  assert.equal(restartStandOf(main, ctxOf([main, adv({ removedAt: NOW - MIN })], { children })).reason, 'Advisor: it is being removed')
  assert.equal(restartStandOf(main, ctxOf([main, adv({})], { children, outbox: [stop] })).reason, 'Advisor: you stopped it')
})

test('the verifier\'s N1, N5, N6, N8: a failed read keeps the unarchive due; refusals and restarts count from the raw outbox; the rows say why', () => {
  const closed = { ...waiting(), state: 'dropped', why: UNSAID_WHY, failed: true, takenAt: NOW - 20 * MIN, closedAt: NOW - 5 * MIN, unarchive: 'due', alsoUnarchive: [] }
  assert.deepEqual(unarchiveListing(closed, { now: NOW, outbox: [closed], lanes: [MAIN], isArchived: null }), { wait: 'the app\'s files could not be read' })
  // N5: a refused word in the raw outbox, a record that lacks it (a loop takeover): still the 30-min wait.
  const refused = { ...waiting(), state: 'dropped', why: REFUSED_WHY, takenAt: NOW - 12 * MIN, closedAt: NOW - 10 * MIN }
  const stand = restartStandOf(gone('Worker 4'), ctxOf([], { outbox: [refused] }))
  assert.deepEqual(stand, { kind: 'refused', why: REFUSED_WHY, until: NOW - 10 * MIN + RESTART_REFUSED_MS })
  // N6: its row says when the courier tries again.
  assert.deepEqual(restartRowOf(stand), { restarting: false, why: `${REFUSED_WHY} · tries again about ${hm(NOW + 20 * MIN)}`, quiet: false })
  // N8: a chat being removed gets no restart advice.
  const removing = ctxOf([MAIN, gone('Worker 4', { removedAt: NOW - MIN })])
  assert.deepEqual(restartRowOf(restartStandOf(removing.lanes[1], removing)), { restarting: false, why: 'it is being removed', quiet: false })
})

test('the verifier\'s N3: a word held for a chat the courier\'s run has archived right now reads the quiet Restarting line', () => {
  const KEEP = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN, pause: null }
  const word = { id: 'w1', at: NOW - 20 * MIN, to: 'Worker 4', ask: 'Q12', command: null, text: 'Yes, B', state: 'waiting', linkHeldAt: NOW - 19 * MIN }
  const taken = waiting({ state: 'taken', takenBy: COURIER, takenAt: NOW - MIN })
  const state = { chats: [MAIN], pause: null, chatPrefix: '', restart: { main: 'Main' } }
  const judge = wordJudge({ state, outbox: [word, taken], settings: {}, now: NOW })
  const line = waitsOf({ state, outbox: [word, taken], now: NOW, keep: KEEP, judge }).w1
  assert.deepEqual([line?.state, line?.rest], ['sent', `its board link is gone · ${RESTARTING_WHY}`])
  // Rule 8 names it no undelivered word meanwhile.
  assert.equal(judge.isUndelivered(word), false)
  // Without the taken restart word: as before (late).
  assert.equal(waitsOf({ state, outbox: [word], now: NOW, keep: KEEP, judge: wordJudge({ state, outbox: [word], settings: {}, now: NOW }) }).w1?.state, 'late')
})
