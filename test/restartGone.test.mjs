// F19 (.claude/plans/2026-11-14-f19-restart-gone-link.md, section 8): the courier restarts a chat whose board link is gone. The garden is
// Worker 4's real unload (its two deltas, 2026-11-13 21:36:27Z, 22:36 on this PC's clock) on a made-up board.

import assert from 'node:assert/strict'
import test from 'node:test'

import { isLate, keepMs, outboxKnown } from '../src/store.mjs'
import { isUndelivered } from '../src/supervisor/rules/watch.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { emptyWakes, textOfWakes, wakesOfFile } from '../src/wake.mjs'
import { COURIER, COURIER_WAIT_MS, carryCloses, isCarryWord } from '../src/wakeCarry.mjs'
import { MOD_GONE_WHY } from '../src/modGone.mjs'
import {
  CHAT_RESTART, HELD_WHY, LINK_BACK_WHY, NOT_BACK_WHY, NO_COURIER_WHY, REFUSED_WHY, RESTARTING_WHY, RESTART_QUIET_MS, RESTART_REFUSED_MS, RESTART_TAKEN_MS,
  RESTART_VERDICT_MS, STUCK_WHY, UNSAID_WHY, alsoUnarchiveOf, archivedLine, isArchivedIn, isRestartWord, noteRestartSent, noteRestartTaken, noteRestartVerdict, restartArchivedOf,
  restartCloses, restartNeeds, restartRowOf, restartSpent, restartStandOf, restartTakeable, restartWakeText, restartWord, startersOf,
} from '../src/restartGone.mjs'

const MIN = 60_000
// Worker 4's second unload (F9's real case: retract at 21:36:27.000Z, the instructions removed at 21:36:27.400Z).
const GONE = Date.parse('2026-11-13T21:36:27.000Z')
const NOW = GONE + 40 * MIN
const hm = ms => `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`

/** A board lane: idle by its transcript (ended, background 0, quiet 20 min) unless `more` says otherwise. */
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, isRunning: true, state: 'unknown', appSession: `local_${name.toLowerCase().replace(/ /g, '')}`,
  modGone: null, transcriptTurn: 'ended', transcriptAt: NOW - 20 * MIN, background: 0, suspended: null, ...more })
const gone = (name, more = {}) => lane(name, { modGone: { at: GONE }, ...more })
const MAIN = lane('Main', { isMain: true })
const ctxOf = (lanes, more = {}) => ({ lanes, starters: ['Main', 'Advisor'], pause: null, limits: null, outbox: [], record: emptyWakes(), now: NOW, courierAlive: true, ...more })

test('the real case: Worker 4 (ended, background 0, quiet 10 min, the courier alive) needs one restart; its word and its wake text', () => {
  const ctx = ctxOf([MAIN, gone('Worker 4', { transcriptAt: GONE + 30_000 })])
  assert.deepEqual(restartNeeds(ctx), [{ chat: 'Worker 4', session: 'local_worker4', spell: GONE }])
  const word = restartWord({ id: 'r1', at: NOW, need: restartNeeds(ctx)[0] })
  assert.deepEqual([word.to, word.command, word.forModel, word.about, word.session, word.spell, word.state], [COURIER, CHAT_RESTART, true, 'Worker 4', 'local_worker4', GONE, 'waiting'])
  assert.equal(word.wakeText, `The worker board restarted this chat: its Workers mod was unloaded at ${hm(GONE)}. Go on where you were; if nothing waits for you, end this turn.`)
  assert.equal(restartWakeText(GONE), word.wakeText)
  // F17's flow never sees it.
  assert.equal(isCarryWord(word), false)
  assert.equal(isRestartWord(word), true)
  // An open word holds a second one off.
  assert.deepEqual(restartNeeds({ ...ctx, outbox: [word] }), [])
})

test('a busy, asking or background chat is never listed; quiet 5 min is not (it waits on the quiet clock)', () => {
  for (const more of [{ transcriptTurn: 'running' }, { transcriptTurn: 'asking' }, { background: 1 }, { background: null }, { transcriptTurn: null }]) {
    const ctx = ctxOf([MAIN, gone('Worker 4', more)])
    assert.deepEqual(restartNeeds(ctx), [], JSON.stringify(more))
    assert.equal(restartStandOf(ctx.lanes[1], ctx).kind, 'no', JSON.stringify(more))
  }
  const quiet = ctxOf([MAIN, gone('Worker 4', { transcriptAt: NOW - 5 * MIN })])
  assert.deepEqual(restartNeeds(quiet), [])
  assert.deepEqual(restartStandOf(quiet.lanes[1], quiet), { kind: 'quiet', at: NOW - 5 * MIN + RESTART_QUIET_MS })
  // Exactly the quiet clock: listed.
  assert.equal(restartNeeds(ctxOf([MAIN, gone('Worker 4', { transcriptAt: NOW - RESTART_QUIET_MS })])).length, 1)
})

test('a starter: Main whose list holds a chat with background work (or not idle) is not listed; with all idle it carries the list', () => {
  const lanes = more => [gone('Main', { isMain: true }), lane('Worker 1', more), lane('Worker 2'), lane('Old', { isLeftover: true }), lane('No id', { appSession: null })]
  assert.deepEqual(restartNeeds(ctxOf(lanes({ background: 2 }))), [])
  assert.equal(restartStandOf(lanes({ background: 2 })[0], ctxOf(lanes({ background: 2 }))).reason, 'its chats are not idle')
  assert.deepEqual(restartNeeds(ctxOf(lanes({ transcriptTurn: 'running' }))), [])
  // A started chat on the quiet clock: Main waits for it too.
  const later = ctxOf(lanes({ transcriptAt: NOW - 4 * MIN }))
  assert.deepEqual(restartStandOf(later.lanes[0], later), { kind: 'quiet', at: NOW - 4 * MIN + RESTART_QUIET_MS })
  const all = ctxOf(lanes({}))
  assert.equal(restartNeeds(all).length, 1)
  // The list: the board's lanes but the target, the leftovers and those without an app id; archived ones left out.
  assert.deepEqual(alsoUnarchiveOf(all.lanes, 'Main', { starters: startersOf({ restart: { main: 'Main' }, advisor: { name: 'Advisor' } }) }), ['local_worker1', 'local_worker2'])
  assert.deepEqual(alsoUnarchiveOf(all.lanes, 'Main', { starters: ['Main'], archived: new Set(['local_worker2']) }), ['local_worker1'])
  // Any other target carries an empty list (chat 1, 2026-11-14), and its own idle test only.
  assert.deepEqual(alsoUnarchiveOf(all.lanes, 'Worker 1', { starters: ['Main', 'Advisor'] }), [])
  assert.equal(restartNeeds(ctxOf([MAIN, gone('Worker 4'), lane('Worker 1', { background: 3 })])).length, 1)
})

test('the same spell after a taken word is not listed, a new spell is; a refused archive spends no try and waits 30 min', () => {
  const record = emptyWakes()
  noteRestartTaken(record, { chat: 'Worker 4', spell: GONE, word: 'r1', now: NOW - 30 * MIN })
  noteRestartVerdict(record, 'Worker 4', 'r1', 'failed', NOT_BACK_WHY, NOW - 15 * MIN)
  assert.equal(restartSpent(record, 'Worker 4', GONE), true)
  assert.deepEqual(restartNeeds(ctxOf([MAIN, gone('Worker 4')], { record })), [])
  assert.deepEqual(restartStandOf(gone('Worker 4'), ctxOf([], { record })), { kind: 'failed', why: NOT_BACK_WHY })
  // A new unload later is a new spell.
  assert.equal(restartNeeds(ctxOf([MAIN, gone('Worker 4', { modGone: { at: GONE + 20 * MIN } })], { record })).length, 1)
  // Refused: no try spent, no word for 30 min after the refusal.
  const refused = emptyWakes()
  noteRestartTaken(refused, { chat: 'Worker 4', spell: GONE, word: 'r2', now: NOW - 12 * MIN })
  noteRestartVerdict(refused, 'Worker 4', 'r2', 'refused', REFUSED_WHY, NOW - 10 * MIN)
  assert.equal(restartSpent(refused, 'Worker 4', GONE), false)
  assert.deepEqual(restartStandOf(gone('Worker 4'), ctxOf([], { record: refused })), { kind: 'refused', why: REFUSED_WHY, until: NOW - 10 * MIN + RESTART_REFUSED_MS })
  assert.deepEqual(restartNeeds(ctxOf([MAIN, gone('Worker 4')], { record: refused })), [])
  assert.equal(restartNeeds(ctxOf([MAIN, gone('Worker 4')], { record: refused, now: NOW + 20 * MIN })).length, 1, '30 min after the refusal')
  // A taken try without its verdict: Restarting.
  const open = emptyWakes()
  noteRestartTaken(open, { chat: 'Worker 4', spell: GONE, word: 'r3', now: NOW - MIN })
  assert.deepEqual(restartStandOf(gone('Worker 4'), ctxOf([], { record: open })), { kind: 'restarting' })
})

test('the try survives a pruned outbox view and the board\'s restart (the record\'s file); pruned with the spells', () => {
  const record = emptyWakes()
  noteRestartTaken(record, { chat: 'Worker 4', spell: GONE, word: 'r1', now: NOW - 30 * MIN })
  noteRestartSent(record, 'Worker 4', 'r1', NOW - 29 * MIN)
  noteRestartVerdict(record, 'Worker 4', 'r1', 'failed', NOT_BACK_WHY, NOW - 19 * MIN)
  const again = wakesOfFile(JSON.parse(textOfWakes(record)))
  assert.deepEqual(again.restartTries.get('Worker 4'), [{ spell: GONE, word: 'r1', takenAt: NOW - 30 * MIN, sentAt: NOW - 29 * MIN, verdict: 'failed', verdictAt: NOW - 19 * MIN, why: NOT_BACK_WHY }])
  // No word in the outbox at all (an old view, pruned): still no second try.
  assert.deepEqual(restartNeeds(ctxOf([MAIN, gone('Worker 4')], { record: again, outbox: [] })), [])
  for (let n = 1; n <= 7; n += 1) noteRestartTaken(record, { chat: 'Worker 4', spell: GONE + n, word: `s${n}`, now: NOW })
  assert.deepEqual([...new Set(record.restartTries.get('Worker 4').map(one => one.spell))], [2, 3, 4, 5, 6, 7].map(n => GONE + n))
  // A record without tries writes none.
  assert.equal(Object.hasOwn(JSON.parse(textOfWakes(emptyWakes())), 'restartTries'), false)
})

test('pause, a full limit, a suspended lane, a stop: not listed; no courier, no word', () => {
  const lanes = [MAIN, gone('Worker 4')]
  assert.deepEqual(restartNeeds(ctxOf(lanes, { pause: { state: 'pausing', since: NOW - MIN } })), [])
  assert.deepEqual(restartNeeds(ctxOf(lanes, { limits: { week: { level: 'full' }, fiveHour: { level: 'ok' } } })), [])
  assert.deepEqual(restartNeeds(ctxOf(lanes, { limits: { week: { level: 'warn' }, fiveHour: { level: 'full' } } })), [])
  assert.equal(restartNeeds(ctxOf(lanes, { limits: { week: { level: 'warn' }, fiveHour: { level: 'ok' } } })).length, 1)
  assert.deepEqual(restartNeeds(ctxOf([MAIN, gone('Worker 4', { suspended: { by: 'app', limit: 'week' } })])), [])
  const stopped = { id: 's', at: NOW - MIN, to: 'Worker 4', text: 'Go on.', state: 'waiting', stoppedAt: NOW - MIN, stoppedSession: 'x' }
  assert.equal(restartStandOf(lanes[1], ctxOf(lanes, { outbox: [stopped] })).kind, 'no')
  assert.deepEqual(restartNeeds(ctxOf(lanes, { courierAlive: false })), [])
  assert.deepEqual(restartStandOf(lanes[1], ctxOf(lanes, { courierAlive: false })), { kind: 'no', why: MOD_GONE_WHY, reason: 'no courier' })
  // Resumed: listed again (the same spell gets its one word).
  assert.equal(restartNeeds(ctxOf(lanes, { pause: { state: 'resuming', since: NOW - MIN } })).length, 1)
})

const waiting = (more = {}) => ({ ...restartWord({ id: 'r1', at: NOW - MIN, need: { chat: 'Worker 4', session: 'local_worker4', spell: GONE } }), ...more })

test('the closes: a hold drops a waiting word without a try; COURIER_WAIT_MS drops it "the courier did not come"; link back; the windows', () => {
  const lanes = [MAIN, gone('Worker 4')]
  const held = () => true
  assert.deepEqual(restartCloses({ outbox: [waiting()], lanes, now: NOW, isHeld: held }), [{ id: 'r1', state: 'dropped', why: HELD_WHY, verdict: null }])
  assert.deepEqual(restartCloses({ outbox: [waiting()], lanes, now: NOW }), [])
  assert.deepEqual(restartCloses({ outbox: [waiting()], lanes, now: NOW - MIN + COURIER_WAIT_MS }), [{ id: 'r1', state: 'dropped', why: NO_COURIER_WHY, verdict: null }])
  // Link back: any open word (its chat on the board without the gone link, or another spell's).
  assert.deepEqual(restartCloses({ outbox: [waiting()], lanes: [MAIN, lane('Worker 4')], now: NOW }), [{ id: 'r1', state: 'dropped', why: LINK_BACK_WHY, verdict: null }])
  const sent = waiting({ state: 'taken', takenBy: COURIER, takenAt: NOW - 3 * MIN, sentAt: NOW - 2 * MIN })
  assert.deepEqual(restartCloses({ outbox: [sent], lanes: [MAIN, lane('Worker 4')], now: NOW }), [{ id: 'r1', state: 'delivered', why: LINK_BACK_WHY, verdict: 'back' }])
  // Off the board (archived mid-run): no "link is back".
  assert.deepEqual(restartCloses({ outbox: [sent], lanes: [MAIN], now: NOW }), [])
  // Sent, no report 10 min after: failed.
  assert.deepEqual(restartCloses({ outbox: [sent], lanes, now: NOW - 2 * MIN + RESTART_VERDICT_MS }), [{ id: 'r1', state: 'dropped', why: NOT_BACK_WHY, verdict: 'failed', failed: true }])
  assert.deepEqual(restartCloses({ outbox: [sent], lanes, now: NOW - 2 * MIN + RESTART_VERDICT_MS - 1 }), [])
  // A taken word without wakes-sent: failed at 15 min, not before.
  const taken = waiting({ state: 'taken', takenBy: COURIER, takenAt: NOW - RESTART_TAKEN_MS })
  assert.deepEqual(restartCloses({ outbox: [taken], lanes, now: NOW }), [{ id: 'r1', state: 'dropped', why: UNSAID_WHY, verdict: 'failed', failed: true, unarchive: false }])
  assert.deepEqual(restartCloses({ outbox: [taken], lanes, now: NOW - 1 }), [])
  // A held taken word is not dropped by the hold (the courier has it).
  assert.deepEqual(restartCloses({ outbox: [taken], lanes, now: NOW - 1, isHeld: held }), [])
})

test('the unarchive entry only on its conditions: seen archived within the run window, still off the board, no removal open', () => {
  const taken = more => waiting({ state: 'taken', takenBy: COURIER, takenAt: NOW - RESTART_TAKEN_MS, alsoUnarchive: ['local_worker1'], ...more })
  const closeOf = (word, lanes = [MAIN], outbox = [word]) => restartCloses({ outbox, lanes, now: NOW })[0]
  assert.equal(closeOf(taken({ archivedAt: NOW - 10 * MIN })).unarchive, true)
  assert.equal(closeOf(taken({})).unarchive, false, 'never seen archived')
  assert.equal(closeOf(taken({ archivedAt: NOW - RESTART_TAKEN_MS - MIN })).unarchive, false, 'before the take')
  assert.equal(closeOf(taken({ archivedAt: NOW - 10 * MIN }), [MAIN, gone('Worker 4')]).unarchive, false, 'back on the board')
  const remove = { id: 'rm', at: NOW - 20 * MIN, to: 'Main', command: 'remove', about: 'Worker 4', state: 'waiting' }
  assert.equal(closeOf(taken({ archivedAt: NOW - 10 * MIN }), [MAIN], [taken({ archivedAt: NOW - 10 * MIN }), remove]).unarchive, false, 'a removal is open')
  // The app's own file says archived.
  const folders = [{ at: 2, chats: new Map([['local_worker4', { isArchived: true }]]) }, { at: 1, chats: new Map([['local_worker4', { isArchived: false }]]) }]
  assert.equal(isArchivedIn('local_worker4', folders), true)
  assert.equal(isArchivedIn('local_worker4', [folders[1]]), false)
  assert.equal(isArchivedIn('local_other', folders), false)
})

test('a carry word is untouched by these closes, and a restart word by F17\'s', () => {
  const carry = { id: 'c1', at: NOW - 30 * MIN, to: COURIER, command: 'wake-carry', about: 'Worker 4', forModel: true, spell: GONE, session: 'local_worker4', wakeText: 'x', text: 'x', state: 'waiting' }
  assert.deepEqual(restartCloses({ outbox: [carry], lanes: [MAIN, lane('Worker 4')], now: NOW, isHeld: () => true }), [])
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

test('the courier\'s take re-checks: a word whose chat is busy now, or of another spell, is not takeable', () => {
  const ctx = ctxOf([MAIN, gone('Worker 4')])
  assert.equal(restartTakeable(waiting(), ctx), true)
  assert.equal(restartTakeable(waiting(), ctxOf([MAIN, gone('Worker 4', { transcriptTurn: 'running' })])), false)
  assert.equal(restartTakeable(waiting({ spell: GONE - MIN }), ctx), false)
  assert.equal(restartTakeable(waiting({ state: 'taken' }), ctx), false)
  assert.equal(restartTakeable(waiting(), ctxOf([MAIN])), false, 'off the board')
})

test('the page: quiet "restarts by itself at HH:MM", Restarting once taken, attention otherwise; the Overview names an archived chat', () => {
  const quiet = ctxOf([MAIN, gone('Worker 4', { transcriptAt: NOW - 5 * MIN })])
  assert.deepEqual(restartRowOf(restartStandOf(quiet.lanes[1], quiet)), { restarting: false, why: `restarts by itself at ${hm(NOW + 5 * MIN)}`, quiet: true })
  const ready = ctxOf([MAIN, gone('Worker 4')])
  assert.deepEqual(restartRowOf(restartStandOf(ready.lanes[1], ready)), { restarting: false, why: `restarts by itself at ${hm(NOW - 10 * MIN)}`, quiet: true })
  const taken = ctxOf([MAIN, gone('Worker 4')], { outbox: [waiting({ state: 'taken', takenBy: COURIER, takenAt: NOW })] })
  assert.deepEqual(restartRowOf(restartStandOf(taken.lanes[1], taken)), { restarting: true, why: RESTARTING_WHY, quiet: true })
  for (const ctx of [ctxOf([MAIN, gone('Worker 4', { background: 1 })]), ctxOf([MAIN, gone('Worker 4')], { courierAlive: false }), ctxOf([MAIN, gone('Worker 4', { appSession: null })])]) {
    assert.deepEqual(restartRowOf(restartStandOf(ctx.lanes[1], ctx)), { restarting: false, why: MOD_GONE_WHY, quiet: false })
  }
  const record = emptyWakes()
  noteRestartTaken(record, { chat: 'Worker 4', spell: GONE, word: 'r1', now: NOW - 20 * MIN })
  noteRestartVerdict(record, 'Worker 4', 'r1', 'stuck', STUCK_WHY, NOW - 19 * MIN)
  assert.deepEqual(restartRowOf(restartStandOf(gone('Worker 4'), ctxOf([], { record }))), { restarting: false, why: STUCK_WHY, quiet: false })
  assert.equal(restartRowOf(null), null)
  // Stuck, and off the board: the Overview's line.
  const closed = waiting({ state: 'dropped', why: STUCK_WHY, failed: true, closedAt: NOW - 19 * MIN })
  assert.deepEqual(restartArchivedOf([closed], [MAIN], NOW), ['Worker 4'])
  assert.deepEqual(restartArchivedOf([closed], [MAIN, gone('Worker 4')], NOW), [], 'back on the board')
  assert.equal(archivedLine('Worker 4'), 'Worker 4 is archived: unarchive it')
})
