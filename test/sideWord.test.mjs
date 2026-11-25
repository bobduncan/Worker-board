// B1307 (F40; the person's "Yes, build F40", 2026-11-21): a late wait on a side chat goes to that chat first. The live case replayed:
// Worker 1 blocked B1300 at 10:49 with on "chat 1" (its core review and go to land); at 90 min of the board's running time the person
// got a "Waits late" card and carried it to chat 1 by hand. Now: one word to chat 1 at 90 min by a hand's send, no card; the card only
// when the wait still stands 30 min after the word went; a renewed block a new wait with a new clock; a restart says no second word;
// an unknown side chat the card at 90 min with the why; waits on board chats as before. Made-up chats and fake app ids only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { parseConfig } from '../src/config.mjs'
import { handJobs, isForHandsYet, isHandWord } from '../src/hands.mjs'
import { fileStore, foldOutbox, keepMs, outboxKnown } from '../src/store.mjs'
import { isUndelivered } from '../src/supervisor/rules/watch.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { sweepOutbox, whyClosed } from '../src/work/outboxSweep.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { SIDE_WORD, STALE_SIDE_WHY, sideChatsOf, sideClosesOf, sideFullMarkOf, sideKeepOf, sideKeptFor, sideKeptOf, sideKeyOf, sideSessionOf, sideStateOf, sideWordFor, sideWordOf, windowFrom } from '../src/work/sideWord.mjs'
import { hourMinute, waitsOnOf } from '../src/work/waitsOn.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const KEEP = { messageMs: 10 * MIN, answerMs: 24 * 60 * MIN, pause: null }
const at = (h, m, s = 0) => new Date(2026, 10, 21, h, m, s).getTime()
const WAIT_AT = at(10, 49)
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const PREFIX = 'Garden · '
const NAMES = ['Lead', 'Worker 1', 'Worker 2']
const CHAT_1 = 'local_00000000-fake-side-chat-1'
const WHY = 'its core review and go to land, after the gate'
const waitsLine = (who, when) => `${who} · ${WHY} · ${stamp(when).slice(0, 16)}`

function text(head, sections = {}) {
  const lines = Object.entries(head).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => `${key}: ${value}`)
  for (const [name, body] of Object.entries(sections)) lines.push('', `## ${name}`, ...body)
  return `${lines.join('\n')}\n`
}
const b1300 = waits => parseItem(text(
  { Id: 'B1300', Kind: 'step', Title: 'Fix: the test queue', Priority: 'fix', State: 'in progress', Owner: 'Worker 1', Activity: 'Garden', Goal: 'G15', 'Waits on': waits, Since: stamp(at(9, 40)), Branch: 'b1300-test-queue', 'Taken for': '60 min', Refined: 'ready' },
  { History: [`- ${stamp(at(9, 40))} Worker 1: queued → taken`, `- ${stamp(at(9, 40))} Worker 1: taken → in progress`] }))
function storeWith(items) {
  const work = storeFromText('## Garden\n', { now: at(9, 0) })
  for (const item of items) {
    work.items.set(item.head.get('Id'), item)
    work.activities[0].steps.push(item.head.get('Id'))
  }
  return work
}
const app = name => JSON.stringify({ title: `${PREFIX}${name}`, sessionId: `local_${name.replace(' ', '-')}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: at(10, 50), lastAssistantUuid: 'u-1' })
const report = (name, state, since, heard) => [name, { state, since, background: false, run: 1, seq: 1, at: heard, session: `cli-${name}`, mod: '0.31.0', busyAt: null }]
/** The board at `now`: Worker 1 idle since 10:50 on B1300 waiting on `who` since `since`; `outbox` the words; `lines` the history (F63: an off gap). */
function build({ now, who = 'chat 1', since = WAIT_AT, outbox = [], week = 40, lines = [] }) {
  const raw = {
    listText: JSON.stringify({ prefix: PREFIX, main: 'Lead' }), appChatTexts: NAMES.map(app), tails: {}, planLineTexts: {},
    work: storeWith([b1300(waitsLine(who, since))]), adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: at(9, 0),
  }
  const reports = [report('Lead', 'idle', at(10, 0), now - 5_000), report('Worker 1', 'idle', at(10, 50), now - 5_000), report('Worker 2', 'idle', at(10, 0), now - 5_000)]
  const keptReadings = [{ at: now - MIN, fiveHour: { used: 10, resetsAt: now + 120 * MIN }, week: { used: week, resetsAt: now + 2880 * MIN } }]
  // The words as the server gives them (server.mjs `words`): one that waited too long reads `expired`.
  const known = outboxKnown(outbox, now, KEEP)
  return buildState(raw, { lines, outbox: known, words: known, keptReadings, runs: [], now, config, seen: { shown: {}, other: {} }, board: { startedAt: at(9, 0), offSince: null }, reports: new Map(reports) })
}
const lateCards = state => state.forYou.filter(one => one.kind === 'wait late')
const laneOf = (state, name) => state.chats.find(one => one.name === name)
const KEY = sideKeyOf('B1300', { at: '2026-11-21 10:49' })
/** The word as the board says it at 12:19, then as the hand's result leaves it. */
const word = (more = {}) => ({ id: 'w1', at: at(12, 19), to: 'chat 1', about: 'chat 1', command: SIDE_WORD, key: KEY, step: 'B1300', worker: 'Worker 1', session: CHAT_1, text: 'Worker 1 waits for you on B1300 ...', state: 'waiting', ...more })

test('B1300 at 12:19 (90 min): no card, one word due for chat 1; the word says who waits, on what, since when, and when the person is asked', () => {
  const state = build({ now: at(12, 19) })
  assert.deepEqual(lateCards(state), [])
  assert.deepEqual(state.sideWordsDue.map(one => [one.id, one.who, one.chat, one.wait.at]), [['B1300', 'chat 1', 'Worker 1', '2026-11-21 10:49']])
  const wait = state.sideWordsDue[0].wait
  const said = sideWordFor({ late: state.sideWordsDue[0], worker: 'Worker 1', wait, found: sideSessionOf('chat 1', sideChatsOf(JSON.stringify({ 'chat 1': [CHAT_1] }))), now: at(12, 19) })
  assert.deepEqual([said.state, said.to, said.session, said.key, said.command], ['waiting', 'chat 1', CHAT_1, KEY, SIDE_WORD])
  assert.equal(said.text, `The worker board: Worker 1 waits for you on B1300 since 10:49 (${WHY}). Give it your answer, or tell it to go on without you; the person is asked in 30 minutes if it still waits.`)
  // Under the limit: nothing due, no card.
  const before = build({ now: at(12, 18) })
  assert.deepEqual([before.sideWordsDue, lateCards(before)], [[], []])
})

test('the word went at 12:20: no card until 30 min of running time after it, the lane says "asked chat 1 at 12:20"; at 12:50 the card, naming it', () => {
  const sent = [word({ state: 'delivered', deliveredAt: at(12, 20) })]
  for (const now of [at(12, 20), at(12, 49, 59)]) {
    const state = build({ now, outbox: sent })
    assert.deepEqual(lateCards(state), [], new Date(now).toTimeString().slice(0, 8))
    assert.deepEqual(state.sideWordsDue, [])
  }
  const lane = laneOf(build({ now: at(12, 30), outbox: sent }), 'Worker 1')
  assert.equal(lane.why, `waits for chat 1 (${WHY}) since 10:49; asked chat 1 at 12:20`)
  const cards = lateCards(build({ now: at(12, 50), outbox: sent }))
  assert.equal(cards.length, 1)
  assert.equal(cards[0].title, `Worker 1 waits for chat 1 (${WHY}) since 10:49 (121 min) on B1300`)
  assert.match(cards[0].text, /Then the board asked chat 1 at 12:20; no answer in 30 min\. The board holds its step/)
})

test('while the word waits for a hand (10 min at most) no card; past it the card says no hand sent it, and the board gives the word up', () => {
  assert.deepEqual(lateCards(build({ now: at(12, 28), outbox: [word()] })), [])
  assert.deepEqual(lateCards(build({ now: at(12, 28), outbox: [word({ state: 'taken', takenBy: 'Worker 2', takenAt: at(12, 20) })] })), [])
  const late = lateCards(build({ now: at(12, 29), outbox: [word()] }))
  assert.equal(late.length, 1)
  assert.match(late[0].text, /Then no hand sent the board's word to chat 1 within 10 min\./)
  const live = new Set([KEY])
  const running = now => from => now - from
  assert.deepEqual(sideClosesOf({ words: [word()], liveKeys: live, runningMs: running(at(12, 28)) }), [])
  assert.deepEqual(sideClosesOf({ words: [word()], liveKeys: live, runningMs: running(at(12, 29)) }), [{ id: 'w1', why: 'no hand sent it within 10 min' }])
  // The window is running time: 20 wall minutes with the board off for 15 are 5.
  assert.deepEqual(sideClosesOf({ words: [word()], liveKeys: live, runningMs: from => at(12, 39) - from - 15 * MIN }), [])
  // Chat 1's minor: a word still to go is withdrawn when its wait ended; one that went is left alone.
  assert.deepEqual(sideClosesOf({ words: [word()], liveKeys: new Set(), runningMs: running(at(12, 20)) }), [{ id: 'w1', why: 'its wait ended' }])
  assert.deepEqual(sideClosesOf({ words: [word({ state: 'delivered', deliveredAt: at(12, 20) })], liveKeys: new Set(), runningMs: running(at(12, 21)) }), [])
  // Given up (the server's close): the card stays, with the why.
  assert.match(lateCards(build({ now: at(12, 30), outbox: [word({ state: 'dropped', why: 'no hand sent it within 10 min' })] }))[0].text, /Then the board could not ask chat 1: no hand sent it within 10 min\./)
  // Chat 1's review 3: a refusal the store tries again holds the card; the card then says it in plain words, never the hook's text.
  const HOOK = '{"deny":"PreToolUse:mcp__ccd_session_mgmt__send_message hook error: Not run: in auto mode Claude Desktop doesn\'t run this tool when a plugin\'s own code calls it. Have Claude make the call."}'
  const refused = more => word({ state: 'failed', why: HOOK, failedAt: at(12, 20), tries: 1, ...more })
  assert.deepEqual(lateCards(build({ now: at(12, 21), outbox: [refused()] })), [])
  const spent = lateCards(build({ now: at(12, 25), outbox: [refused({ tries: 3 })] }))
  assert.equal(spent.length, 1)
  assert.match(spent[0].text, /could not ask chat 1: the app no longer lets the board's code send to a chat\./)
  assert.doesNotMatch(spent[0].text, /hook error/)
  // A reason that never passes: no retry, the card at once.
  assert.match(lateCards(build({ now: at(12, 21), outbox: [word({ state: 'failed', why: 'session not found', tries: 1 })] }))[0].text, /could not ask chat 1: session not found/)
})

test('renewed at 13:06 (chat 1 began its review): the old word counts no more, a new clock: no card and nothing due until 14:36', () => {
  const sent = [word({ state: 'delivered', deliveredAt: at(12, 20) })]
  const renewed = build({ now: at(13, 10), since: at(13, 6), outbox: sent })
  assert.deepEqual([lateCards(renewed), renewed.sideWordsDue], [[], []])
  assert.equal(laneOf(renewed, 'Worker 1').why, `waits for chat 1 (${WHY}) since 13:06`)
  const due = build({ now: at(14, 36), since: at(13, 6), outbox: sent })
  assert.deepEqual([lateCards(due), due.sideWordsDue.map(one => one.wait.at)], [[], ['2026-11-21 13:06']])
})

test('a board restart between the word and the 30 min: the outbox keeps the word, so none is due again and the clock goes on', () => {
  const kept = [word({ state: 'delivered', deliveredAt: at(12, 20) })]
  const after = build({ now: at(12, 40), outbox: kept })
  assert.deepEqual([after.sideWordsDue, lateCards(after)], [[], []])
  assert.equal(lateCards(build({ now: at(12, 50), outbox: kept })).length, 1)
})

test('an unknown side chat: the record says why and the card comes at 90 min with it; an id only of another account the same', () => {
  const unknown = sideSessionOf('chat 3', sideChatsOf(JSON.stringify({ 'chat 1': [CHAT_1] })))
  assert.deepEqual(unknown, { why: 'chat 3 is not known to the board (no app id in side-chats.json)' })
  const late = build({ now: at(12, 19), who: 'chat 3' }).sideWordsDue[0]
  const record = sideWordFor({ late, worker: 'Worker 1', wait: late.wait, found: unknown, now: at(12, 19) })
  assert.deepEqual([record.state, record.why, record.session], ['dropped', unknown.why, undefined])
  const cards = lateCards(build({ now: at(12, 19), who: 'chat 3', outbox: [{ id: 'w3', ...record }] }))
  assert.equal(cards.length, 1)
  // B1394 (principle 16): the card names no file.
  assert.match(cards[0].text, /Then the board could not ask chat 3: chat 3 is not known to the board\./)
  assert.doesNotMatch(cards[0].text, /side-chats/)
  // Two ids, one per account: the one the app lists under the board's account; only another account's: no word, with why.
  const two = sideChatsOf(JSON.stringify({ 'Chat 1': ['local_fake-work', CHAT_1], 'chat 9': [CHAT_1], 'chat 2': 'not-an-id' }))
  assert.deepEqual(two, { 'chat 1': ['local_fake-work', CHAT_1] })
  assert.deepEqual(sideSessionOf('chat 1', two, id => (id === CHAT_1 ? 'here' : 'elsewhere')), { session: CHAT_1 })
  assert.deepEqual(sideSessionOf('chat 1', two, () => 'elsewhere'), { why: 'chat 1\'s app id is of another account than the board\'s' })
  assert.deepEqual(sideSessionOf('chat 1', two, () => 'nowhere'), { why: 'chat 1 is not in the app\'s chat list' })
  assert.deepEqual(sideChatsOf('not json'), {})
})

test('a wait on a board chat (Main) is as before: the card at 90 min, no word', () => {
  const state = build({ now: at(12, 19), who: 'Lead' })
  assert.deepEqual(state.sideWordsDue, [])
  assert.equal(lateCards(state).length, 1)
  assert.doesNotMatch(lateCards(state)[0].text, /Then /)
})

test('a board that says no word (a copy that only shows) holds the card 10 min past the limit at most', () => {
  assert.deepEqual(lateCards(build({ now: at(12, 28) })), [])
  const shown = lateCards(build({ now: at(12, 29) }))
  assert.equal(shown.length, 1)
  assert.doesNotMatch(shown[0].text, /Then /, 'no false reason')
})

test('the hands: a side word is a hand\'s job to its own app id, only for a hand that may send, within 10 min, never Main\'s model turn', () => {
  const waiting = word()
  assert.equal(isHandWord(waiting, { canSend: true }), true)
  assert.equal(isHandWord(waiting, { canSend: false }), false)
  assert.equal(isHandWord({ ...waiting, session: 'not-an-id' }, { canSend: true }), false)
  // Chat 1's review 2: given back in doubt (its call gave no answer, it may have landed): never a hand's job again; given back plainly: yes.
  assert.equal(isHandWord({ ...waiting, doubtAt: at(12, 20) }, { canSend: true }), false)
  assert.equal(isHandWord({ ...waiting, doubtAt: null }, { canSend: true }), true)
  assert.deepEqual(handJobs({ caller: 'Worker 2', taken: [{ ...waiting, doubtAt: at(12, 20) }], lanes: [], now: at(12, 30) }), { jobs: [], back: ['w1'] })
  assert.equal(isForHandsYet(waiting, at(13, 0)), true)
  const lanes = [{ name: 'Worker 2', appSession: 'local_Worker-2' }]
  assert.deepEqual(handJobs({ caller: 'Worker 2', taken: [waiting], lanes, now: at(12, 20) }), { jobs: [{ id: 'w1', to: CHAT_1, chat: 'chat 1', text: waiting.text }], back: [] })
  assert.deepEqual(handJobs({ caller: 'Worker 2', taken: [waiting], lanes, now: at(12, 20), canSend: false }), { jobs: [], back: ['w1'] })
  // The record keeps the wait's own minute, so the key is the step and that minute.
  assert.equal(sideKeyOf('B1300', waitsOnOf(b1300(waitsLine('chat 1', WAIT_AT)))), 'B1300:2026-11-21 10:49')
})

test('chat 1\'s crossing 2: a refused side send marks that hand alone, never the board-wide refusal; the route counts it before any wake', async () => {
  const { noteHandRefused, noteHandRefusedAlone } = await import('../src/wakeCarry.mjs')
  const record = {}
  assert.equal(noteHandRefusedAlone(record, 'Worker 2', at(12, 21)), true)
  assert.deepEqual(record, { refusedHands: { 'Worker 2': at(12, 21) } })
  // The control: the wake path's mark would also set the board-wide refusal on a record where no hand went since the lift.
  const wake = {}
  noteHandRefused(wake, 'Worker 2', at(12, 21))
  assert.equal(wake.sendsRefusedSince, at(12, 21))
  const { readFile } = await import('node:fs/promises')
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  const done = server.slice(server.indexOf('handsDone: counted('))
  const side = done.indexOf('one.command === SIDE_WORD')
  assert.ok(side > 0 && side < done.indexOf('const chat = wakeChatOf(id)'), 'the side word branch comes before the wake path')
  assert.match(done.slice(side, side + 500), /noteHandRefusedAlone\(wakes, checked\.chat, clock\(\)\)[\s\S]*continue/)
})

test('B1394: while a limit is full a waiting side word is no hand\'s; every other hand word stays one', () => {
  assert.equal(isHandWord(word()), true)
  assert.equal(isHandWord(word(), { isFull: true }), false)
  assert.equal(isHandWord({ id: 'w2', command: 'wake', about: 'Worker 1' }, { isFull: true }), true)
})

test('chat 1\'s blocker: while a limit is full no word is due and the card comes as before, saying so; after the reset one word goes and the card stays', () => {
  const full = build({ now: at(12, 19), week: 99 })
  assert.equal(full.limitFull, true)
  assert.deepEqual(full.sideWordsDue, [])
  const cards = lateCards(full)
  assert.equal(cards.length, 1)
  assert.match(cards[0].text, /Then the board did not ask chat 1: a limit is full\./)
  // A word that still waited for a hand when the limit filled up: the same card.
  assert.match(lateCards(build({ now: at(12, 21), week: 99, outbox: [word()] }))[0].text, /did not ask chat 1: a limit is full/)
  // Back under the limit, the card has shown: one word goes, and the card stays with what the board did.
  const after = build({ now: at(13, 0), week: 40 })
  assert.deepEqual(after.sideWordsDue.map(one => [one.id, one.overdue]), [['B1300', true]])
  assert.equal(lateCards(after).length, 1)
  assert.doesNotMatch(lateCards(after)[0].text, /Then /)
})

test('chat 1\'s minor: a wait late before its word keeps its card (no false reason, nothing vanishes), then names the word', () => {
  const late = { id: 'B1300', who: 'chat 1', since: WAIT_AT, limitMs: 90 * MIN }
  const wait = waitsOnOf(b1300(waitsLine('chat 1', WAIT_AT)))
  const said = sideWordFor({ late, worker: 'Worker 1', wait, found: { session: CHAT_1 }, now: at(13, 0), overdue: true })
  assert.equal(said.keepCard, true)
  const waiting = lateCards(build({ now: at(13, 1), outbox: [{ id: 'w2', ...said }] }))
  assert.equal(waiting.length, 1)
  assert.match(waiting[0].text, /Then the board is asking chat 1\./)
  const went = lateCards(build({ now: at(13, 5), outbox: [{ id: 'w2', ...said, state: 'delivered', deliveredAt: at(13, 2) }] }))
  assert.equal(went.length, 1)
  assert.match(went[0].text, /Then the board asked chat 1 at 13:02\./)
  // The word of a wait that was not overdue carries no keepCard.
  assert.equal(sideWordFor({ late, worker: 'Worker 1', wait, found: { session: CHAT_1 }, now: at(12, 19) }).keepCard, undefined)
  assert.equal(sideStateOf({ late, word: { ...said, keepCard: undefined }, runningMs: () => 0 }).hold, true)
})

test('chat 1\'s review 6: the record of a word that could not go has a text, so the outbox log keeps it over a restart', () => {
  const late = { id: 'B1300', who: 'chat 3', since: WAIT_AT, limitMs: 90 * MIN }
  const record = { id: 'w3', ...sideWordFor({ late, worker: 'Worker 1', wait: waitsOnOf(b1300(waitsLine('chat 3', WAIT_AT))), found: { why: 'chat 3 is not known' }, now: at(12, 19) }) }
  assert.deepEqual(foldOutbox(`${JSON.stringify(record)}\n`).map(one => [one.id, one.state, one.text]), [['w3', 'dropped', '']])
})

test('chat 1\'s review 4: a failed side word is no case for rule 8', () => {
  const failed = word({ state: 'waiting', at: at(10, 0) })
  assert.equal(isUndelivered({ now: at(12, 0), pause: null, chats: [], items: new Map(), prefix: '' }, failed, { stillWaits: () => true, waking: new Set(), gone: new Set(), limit: MIN }), false)
  assert.equal(isUndelivered({ now: at(12, 0), pause: null, chats: [], items: new Map(), prefix: '' }, { ...failed, command: 'line' }, { stillWaits: () => true, waking: new Set(), gone: new Set(), limit: MIN }), true, 'the control: another word that waits is one')
})

test('chat 1\'s re-check c: a word that waited too long reads as the end of its hand window, never "expired" on the card, and is closed', () => {
  const late = at(12, 31)
  // F63: a side word waits as long as an answer (store.mjs `keepMs`): at 12:31 it still reads waiting, and the card says the same through
  // the running-time window; the outbox reads it `expired` only past answerMs, which the rest of this test replays.
  assert.equal(outboxKnown([word()], late, KEEP)[0].state, 'waiting')
  const known = outboxKnown([word()], at(12, 19) + KEEP.answerMs + MIN, KEEP)
  assert.equal(known[0].state, 'expired')
  const lateWait = { id: 'B1300', who: 'chat 1', since: WAIT_AT, limitMs: 90 * MIN }
  assert.equal(sideStateOf({ late: lateWait, word: known[0], runningMs: () => 0 }).note, 'no hand sent the board\'s word to chat 1 within 10 min')
  assert.equal(sideStateOf({ late: lateWait, word: known[0], runningMs: () => 0, isFull: true }).note, 'the board did not ask chat 1: a limit is full')
  const cards = lateCards(build({ now: late, outbox: [word()] }))
  assert.equal(cards.length, 1)
  assert.match(cards[0].text, /Then no hand sent the board's word to chat 1 within 10 min\./)
  assert.doesNotMatch(cards[0].text, /expired/)
  const full = lateCards(build({ now: late, week: 99, outbox: [word()] }))
  assert.match(full[0].text, /Then the board did not ask chat 1: a limit is full\./)
  assert.doesNotMatch(full[0].text, /expired/)
  // The store still holds it waiting: the board closes it with the plain why; its wait ended: that why.
  assert.deepEqual(sideClosesOf({ words: known, liveKeys: new Set([KEY]), runningMs: () => 0 }), [{ id: 'w1', why: 'no hand sent it within 10 min' }])
  assert.deepEqual(sideClosesOf({ words: known, liveKeys: new Set([KEY]), runningMs: () => 0, isFull: true }), [{ id: 'w1', why: 'a limit is full' }])
  assert.deepEqual(sideClosesOf({ words: known, liveKeys: new Set(), runningMs: () => 0 }), [{ id: 'w1', why: 'its wait ended' }])
  // One the board closed as expired before is not closed again.
  assert.deepEqual(sideClosesOf({ words: [word({ state: 'expired', closedAt: at(12, 30) })], liveKeys: new Set([KEY]), runningMs: () => 0 }), [])
})

// F53 (chat 1's core review of B1394, both on main before): a full limit leaves no wait without its word, and no card that shows and
// vanishes. The looks below are the delivering board's (server.mjs: the closes, the cards kept, then the words due, each checked against
// the outbox) over a store on files, so a board restart reads the outbox back from its log.

/** One look of the delivering board's side part, as server.mjs makes it. */
async function sideLook(store, state, now) {
  for (const { id, why } of state.sideWordsClose) await store.close(id, 'dropped', why, now)
  // F63: the full/back stamps, each checked against the outbox right before the write.
  for (const { id, mark } of state.sideFullMarks) {
    const fresh = sideFullMarkOf({ word: store.outbox().find(one => one.id === id), isFull: Number.isFinite(mark?.fullAt), now })
    if (fresh !== null) await store.update(id, fresh)
  }
  for (const one of state.sideCardsKept) {
    const key = sideKeyOf(one.id, one.wait)
    const keep = sideKeepOf({ side: { full: true }, word: sideWordOf(store.outbox(), key), kept: sideKeptOf(store.outbox(), key) })
    if (keep === null) continue
    if (keep.word === null) await store.say({ id: `k${store.outbox().length + 1}`, ...sideKeptFor({ late: one, worker: one.chat, wait: one.wait, now }) })
    else await store.update(keep.word, { keepCard: true })
  }
  for (const one of state.sideWordsDue) {
    if (sideWordOf(store.outbox(), sideKeyOf(one.id, one.wait)) !== null) continue
    await store.say({ id: `w${store.outbox().length + 1}`, ...sideWordFor({ late: one, worker: one.chat, wait: one.wait, found: { session: CHAT_1 }, now, overdue: one.overdue === true }) })
  }
}

/**
 * The board minute by minute from `from` to `to`: `isFullAt(now)` a limit is full then; each minute the state (its late cards and the
 * words due), then the look; a hand sends the waiting word at `sendAt` (never while full); at `restartAt` the board starts anew on the
 * same files; `after(store, now)` what else happens after the look (a hand's take). `{ seen: { 'HH:MM': { cards, due } }, outbox }`.
 * F63: `restartAt` may be a list; `every` the time between looks (`looks` each look's `{ at, cards, due }`); `sweep` the outbox sweep
 * runs before each look (as deliver.mjs at a refresh); `off: { from, to }` the PC sleeps then: no look, and the history's gap line
 * (`lines`) tells the state, as the board writes it at its wake. `before(store, now)` what happens before the look (a hand's claim,
 * every ~20 s on a fresh state, may come before the look of the same minute).
 */
async function minutes({ from, to, isFullAt, sendAt = null, restartAt = null, after = async () => {}, before = async () => {}, every = MIN, sweep = false, off = null }) {
  const dir = await mkdtemp(join(tmpdir(), 'side-full-'))
  try {
    let store = await fileStore(dir, from)
    const seen = {}
    const looks = []
    const restarts = [restartAt].flat()
    for (let now = from; now <= to; now += every) {
      if (off !== null && now >= off.from && now < off.to) continue
      if (restarts.includes(now)) store = await fileStore(dir, now)
      await before(store, now)
      const lines = off !== null && now >= off.to ? [{ at: off.from, gap: true }, { at: off.to, chat: 'Worker 2', state: 'idle', task: null }] : []
      if (sweep) await sweepOutbox({ dir: null, outbox: store, state: build({ now, week: isFullAt(now) ? 99 : 40, outbox: store.outbox().map(one => ({ ...one })), lines }), now, keep: KEEP })
      const state = build({ now, week: isFullAt(now) ? 99 : 40, outbox: store.outbox().map(one => ({ ...one })), lines })
      seen[hourMinute(now)] = { cards: lateCards(state).map(card => card.text.match(/Then [^.]*\./)?.[0] ?? 'the card'), due: state.sideWordsDue.length }
      looks.push({ at: now, ...seen[hourMinute(now)] })
      await sideLook(store, state, now)
      await after(store, now)
      if (now === sendAt) {
        assert.equal(isFullAt(now), false, 'no hand sends while a limit is full')
        const waiting = store.outbox().filter(one => one.command === SIDE_WORD && one.state === 'waiting')
        assert.equal(waiting.length, 1)
        await store.update(waiting[0].id, { state: 'delivered', deliveredAt: now })
      }
    }
    return { seen, looks, outbox: store.outbox() }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
const ASKING = 'Then the board is asking chat 1.'
const NOT_ASKED = 'Then the board did not ask chat 1: a limit is full.'
const said = outbox => outbox.filter(one => one.command === SIDE_WORD && one.text !== '')

test('F53 (a): a word given up while a limit is full is no word: still full, the "did not ask" card and no word; back, one new word that keeps the card', async () => {
  const { seen, outbox } = await minutes({ from: at(12, 19), to: at(12, 38), isFullAt: now => now >= at(12, 20) && now < at(12, 36), sendAt: at(12, 37), restartAt: at(12, 36) })
  assert.deepEqual(seen['12:19'], { cards: [], due: 1 })
  // The word waited for a hand when the limit filled; its window ended at 12:29 while full: closed so. Still full: the same card, no word.
  for (const minute of ['12:20', '12:28', '12:29', '12:30', '12:35']) assert.deepEqual(seen[minute], { cards: [NOT_ASKED], due: 0 }, minute)
  assert.deepEqual(outbox.filter(one => one.id === 'w1').map(one => [one.state, one.why]), [['dropped', 'a limit is full']])
  // Back (and the board started anew): due again, the card stays; then it names the one new word.
  assert.deepEqual(seen['12:36'], { cards: ['the card'], due: 1 })
  assert.deepEqual(seen['12:37'], { cards: [ASKING], due: 0 })
  assert.deepEqual(seen['12:38'], { cards: ['Then the board asked chat 1 at 12:37.'], due: 0 })
  assert.deepEqual(said(outbox).map(one => [one.id, one.state, one.keepCard]), [['w1', 'dropped', true], ['w2', 'delivered', true]])
  // A word closed so on main before F53 (no keepCard): the same.
  const before = [word({ state: 'dropped', why: 'a limit is full', closedAt: at(12, 29) })]
  const full = build({ now: at(12, 35), week: 99, outbox: before })
  assert.deepEqual([full.sideWordsDue, full.sideCardsKept, lateCards(full).map(card => card.text.match(/Then [^.]*\./)?.[0])], [[], [], [NOT_ASKED]])
  const back = build({ now: at(12, 40), week: 40, outbox: before })
  assert.deepEqual(back.sideWordsDue.map(one => [one.id, one.overdue]), [['B1300', true]])
  assert.equal(lateCards(back).length, 1)
  // Any other give-up stays the word of its wait: no second word.
  assert.deepEqual(build({ now: at(12, 40), outbox: [word({ state: 'dropped', why: 'no hand sent it within 10 min' })] }).sideWordsDue, [])
})

test('F53 (b): full for 3 minutes, back inside the hand window, a word waiting: the card never vanishes until the one word went (a restart too)', async () => {
  const { seen, outbox } = await minutes({ from: at(12, 19), to: at(12, 26), isFullAt: now => now >= at(12, 20) && now < at(12, 23), sendAt: at(12, 24), restartAt: at(12, 23) })
  assert.deepEqual(seen['12:19'], { cards: [], due: 1 })
  for (const minute of ['12:20', '12:21', '12:22']) assert.deepEqual(seen[minute], { cards: [NOT_ASKED], due: 0 }, minute)
  for (const minute of ['12:23', '12:24']) assert.deepEqual(seen[minute], { cards: [ASKING], due: 0 }, minute)
  for (const minute of ['12:25', '12:26']) assert.deepEqual(seen[minute], { cards: ['Then the board asked chat 1 at 12:24.'], due: 0 }, minute)
  assert.deepEqual(said(outbox).map(one => [one.id, one.state, one.keepCard]), [['w1', 'delivered', true]])
  assert.equal(outbox.filter(one => one.command === SIDE_WORD).length, 1, 'kept on the word itself, no record beside it')
})

test('F53 (b): full when the wait turns late, back 3 minutes later inside the hand window: the card stays, exactly one word goes (a restart too)', async () => {
  const { seen, outbox } = await minutes({ from: at(12, 19), to: at(12, 25), isFullAt: now => now < at(12, 22), sendAt: at(12, 24), restartAt: at(12, 22) })
  for (const minute of ['12:19', '12:20', '12:21']) assert.deepEqual(seen[minute], { cards: [NOT_ASKED], due: 0 }, minute)
  assert.deepEqual(seen['12:22'], { cards: ['the card'], due: 1 })
  for (const minute of ['12:23', '12:24']) assert.deepEqual(seen[minute], { cards: [ASKING], due: 0 }, minute)
  assert.deepEqual(seen['12:25'], { cards: ['Then the board asked chat 1 at 12:24.'], due: 0 })
  assert.deepEqual(said(outbox).map(one => [one.state, one.keepCard, one.at]), [['delivered', true, at(12, 22)]])
  // The card's record: once, closed at once, no text (the log keeps it), no word of its wait.
  assert.deepEqual(outbox.filter(one => one.text === '').map(one => [one.state, one.why, one.keepCard, one.at]), [['dropped', 'a limit is full', true, at(12, 19)]])
  assert.equal(foldOutbox(`${JSON.stringify(outbox.find(one => one.text === ''))}\n`).length, 1)
})

test('F53: what the board writes down, and when not: only a card shown because a limit is full that the outbox does not keep yet', () => {
  const full = { full: true }
  assert.deepEqual(sideKeepOf({ side: full, word: null }), { word: null })
  assert.equal(sideKeepOf({ side: full, word: null, kept: true }), null)
  assert.deepEqual(sideKeepOf({ side: full, word: word() }), { word: 'w1' })
  assert.equal(sideKeepOf({ side: full, word: word({ keepCard: true }) }), null)
  assert.equal(sideKeepOf({ side: { full: false }, word: null }), null)
  const late = { id: 'B1300', who: 'chat 1', since: WAIT_AT, limitMs: 90 * MIN }
  assert.equal(sideStateOf({ late, word: null, runningMs: () => 0, isFull: true }).full, true)
  assert.equal(sideStateOf({ late, word: word({ state: 'taken' }), runningMs: () => 0, isFull: true }).full, false, 'a hand has it: no card')
  assert.equal(sideStateOf({ late, word: word({ state: 'dropped', why: 'session not found' }), runningMs: () => 0, isFull: true }).full, false, 'its own why')
  // The state names what to write (the delivering board writes it, server.mjs): only while the card shows because a limit is full.
  assert.deepEqual(build({ now: at(12, 19), week: 99 }).sideCardsKept.map(one => [one.id, one.who, one.chat, one.wait.at]), [['B1300', 'chat 1', 'Worker 1', '2026-11-21 10:49']])
  assert.deepEqual(build({ now: at(12, 19), week: 40 }).sideCardsKept, [])
  assert.deepEqual(build({ now: at(12, 19), week: 99, outbox: [word({ keepCard: true })] }).sideCardsKept, [])
})

test('chat 1\'s review of F53, 1: a word given back in doubt and closed while full stays the word: back, no second word; a plain give-back is none: back, exactly one new word', async () => {
  // 12:19: a hand took the word and gave it back, in doubt (its call gave no answer) or plain (it called nothing). Full from 12:20.
  const run = doubt => minutes({
    from: at(12, 19), to: at(12, 38), isFullAt: now => now >= at(12, 20) && now < at(12, 36), restartAt: at(12, 36), sendAt: doubt ? null : at(12, 37),
    after: async (store, now) => {
      if (now !== at(12, 19)) return
      const taken = await store.takeHands('Worker 2', now, KEEP, one => one.command === SIDE_WORD)
      assert.deepEqual(taken.map(one => one.id), ['w1'])
      await store.back(['w1'], 'Worker 2', now, doubt ? ['w1'] : [])
    },
  })
  {
    const { seen, outbox } = await run(true)
    assert.deepEqual(said(outbox).map(one => one.id), ['w1'], 'no second word to chat 1')
    assert.equal(sideWordOf(outbox, KEY)?.id, 'w1')
    const first = outbox.find(one => one.id === 'w1')
    assert.deepEqual([first.state, first.why, first.backFrom, Number.isFinite(first.doubtAt)], ['dropped', 'no hand sent it within 10 min', 'Worker 2', true])
    for (const minute of ['12:36', '12:37', '12:38']) assert.deepEqual(seen[minute], { cards: ['Then the board could not ask chat 1: no hand sent it within 10 min.'], due: 0 }, minute)
  }
  {
    const { seen, outbox } = await run(false)
    const first = outbox.find(one => one.id === 'w1')
    assert.deepEqual([first.state, first.why, first.backFrom, Number.isFinite(first.doubtAt)], ['dropped', 'a limit is full', 'Worker 2', false])
    const fresh = said(outbox).filter(one => one.id !== 'w1')
    assert.deepEqual(fresh.map(one => [one.state, one.keepCard]), [['delivered', true]], 'exactly one new word, keeping the card')
    assert.equal(sideWordOf(outbox, KEY)?.id, fresh[0].id)
    assert.deepEqual(seen['12:38'], { cards: ['Then the board asked chat 1 at 12:37.'], due: 0 })
  }
  // Closed so before this review (in the log already): in doubt, the word all the same; a plain give-back, none (due again, overdue).
  const inDoubt = [word({ state: 'dropped', why: 'a limit is full', closedAt: at(12, 29), doubtAt: at(12, 20) })]
  assert.equal(sideWordOf(inDoubt, KEY)?.id, 'w1')
  assert.deepEqual(build({ now: at(12, 40), outbox: inDoubt }).sideWordsDue, [])
  const plainBack = [word({ state: 'dropped', why: 'a limit is full', closedAt: at(12, 29), backFrom: 'Worker 2', doubtAt: null })]
  assert.equal(sideWordOf(plainBack, KEY), null)
  assert.deepEqual(build({ now: at(12, 40), outbox: plainBack }).sideWordsDue.map(one => [one.id, one.overdue]), [['B1300', true]])
  // The close: "a limit is full" for every word but one given back in doubt.
  const closes = sideClosesOf({ words: [word({ doubtAt: at(12, 20) }), word({ id: 'w2', backFrom: 'Worker 2', doubtAt: null }), word({ id: 'w3' })], liveKeys: new Set([KEY]), runningMs: () => 10 * MIN, isFull: true })
  assert.deepEqual(closes.map(one => [one.id, one.why]), [['w1', 'no hand sent it within 10 min'], ['w2', 'a limit is full'], ['w3', 'a limit is full']])
})

test('chat 1\'s review of F53, 2: a word tried again whose copy was closed while full: the chain is no word; back, due and overdue', () => {
  for (const first of [{ state: 'failed', why: 'session not found', failedAt: at(12, 20), tries: 1 }, { state: 'stopped', why: 'the session was stopped', failedAt: at(12, 20), tries: 0 }]) {
    const chain = [word({ ...first, retriedAs: 'w2' }), word({ id: 'w2', retryOf: 'w1', state: 'dropped', why: 'a limit is full', closedAt: at(12, 29) })]
    assert.equal(sideWordOf(chain, KEY), null, first.state)
    const full = build({ now: at(12, 35), week: 99, outbox: chain })
    assert.deepEqual([full.sideWordsDue, lateCards(full).map(card => card.text.match(/Then [^.]*\./)?.[0])], [[], [NOT_ASKED]], first.state)
    const back = build({ now: at(12, 40), outbox: chain })
    assert.deepEqual(back.sideWordsDue.map(one => [one.id, one.overdue]), [['B1300', true]], first.state)
    assert.equal(lateCards(back).length, 1)
  }
  // A copy still to go stands for its chain, as before: no second word.
  const going = [word({ state: 'failed', why: 'session not found', failedAt: at(12, 20), tries: 1, retriedAs: 'w2' }), word({ id: 'w2', retryOf: 'w1' })]
  assert.equal(sideWordOf(going, KEY)?.id, 'w2')
  assert.deepEqual(build({ now: at(12, 40), outbox: going }).sideWordsDue, [])
})

// F63 (chat 1 and the person, 2026-11-25): a word that waited through a full limit gets its whole hand window once the limit is back. The
// live hole: a word at 12:19, a limit full 12:20-12:28; at 12:29 its window, still from 12:19, was over: closed "no hand sent it within 10
// min" a minute after the limit came back, and the card named the wrong cause. A second path: the outbox sweep expired a side word at 10
// min of wall time ("waited longer than 10 min"), before the window and always after a PC sleep. The looks below run the sweep too.

const NO_HAND = 'Then no hand sent the board\'s word to chat 1 within 10 min.'
const GAVE_UP = 'Then the board could not ask chat 1: no hand sent it within 10 min.'
const ASKED_AT = time => `Then the board asked chat 1 at ${time}.`
const clockOf = ms => new Date(ms).toTimeString().slice(0, 8)

/** A hand sends the waiting side word at `sendAt` as hands.mjs takes it: through the store's `takeHands`, which leaves a late word alone. */
const handSends = sendAt => async (store, now) => {
  if (now !== sendAt) return
  const taken = await store.takeHands('Worker 2', now, KEEP, one => one.command === SIDE_WORD)
  assert.equal(taken.length, 1, `a hand takes the side word at ${clockOf(now)}`)
  await store.update(taken[0].id, { state: 'delivered', deliveredAt: now })
}

test('F63: the stamps: fullAt the first look a limit is full, backAt the first look it is back, again on a new spell; the window from backAt', () => {
  const now = at(12, 20)
  assert.deepEqual(sideFullMarkOf({ word: word(), isFull: true, now }), { fullAt: now })
  assert.equal(sideFullMarkOf({ word: word(), isFull: false, now }), null, 'never full: nothing to stamp')
  const full = word({ fullAt: at(12, 20) })
  assert.equal(sideFullMarkOf({ word: full, isFull: true, now: at(12, 21) }), null, 'once per spell')
  assert.deepEqual(sideFullMarkOf({ word: full, isFull: false, now: at(12, 28) }), { backAt: at(12, 28) })
  const back = word({ fullAt: at(12, 20), backAt: at(12, 28) })
  assert.equal(sideFullMarkOf({ word: back, isFull: false, now: at(12, 29) }), null, 'once per return')
  assert.deepEqual(sideFullMarkOf({ word: back, isFull: true, now: at(12, 31) }), { fullAt: at(12, 31) }, 'a new spell')
  assert.deepEqual(sideFullMarkOf({ word: word({ fullAt: at(12, 31), backAt: at(12, 28) }), isFull: false, now: at(12, 33) }), { backAt: at(12, 33) })
  // Only a word still to go: a failed one due for a retry too; never one a hand has, one given back in doubt, one that went or was closed.
  assert.deepEqual(sideFullMarkOf({ word: word({ state: 'failed', why: 'the app gave no answer', failedAt: at(12, 19), tries: 1 }), isFull: true, now }), { fullAt: now })
  for (const other of [word({ state: 'taken', takenBy: 'Worker 2' }), word({ doubtAt: at(12, 19), backFrom: 'Worker 2' }), word({ state: 'delivered', deliveredAt: at(12, 19) }), word({ state: 'dropped', why: 'a limit is full' }), word({ state: 'failed', why: 'session not found', tries: 1 }), { ...word(), command: 'line' }]) {
    assert.equal(sideFullMarkOf({ word: other, isFull: true, now }), null, JSON.stringify([other.state, other.command, other.doubtAt]))
  }
  // Chat 1's review of 40da0260, 1: the return is stamped on every word a hand may still settle (taken, given back in doubt, read late),
  // never on one that went, was closed or failed for good; fullAt stays only for a word still to go and not in doubt.
  for (const open of [word({ state: 'taken', takenBy: 'Worker 2' }), word({ doubtAt: at(12, 19), backFrom: 'Worker 2' }), word({ state: 'expired' }), word({ state: 'failed', why: 'the app gave no answer', failedAt: at(12, 19), tries: 1 })]) {
    assert.deepEqual(sideFullMarkOf({ word: { ...open, fullAt: at(12, 20) }, isFull: false, now: at(12, 28) }), { backAt: at(12, 28) }, JSON.stringify([open.state, open.doubtAt]))
  }
  for (const done of [word({ state: 'delivered', deliveredAt: at(12, 25) }), word({ state: 'dropped', why: 'a limit is full', closedAt: at(12, 25) }), word({ state: 'expired', closedAt: at(12, 25) }), word({ state: 'failed', why: 'session not found', tries: 1 })]) {
    assert.equal(sideFullMarkOf({ word: { ...done, fullAt: at(12, 20) }, isFull: false, now: at(12, 28) }), null, JSON.stringify([done.state, done.why]))
  }
  // The window counts from the return; while a later spell holds it (its fullAt newer), from the word's own time.
  assert.equal(windowFrom(word()), at(12, 19))
  assert.equal(windowFrom(full), at(12, 19))
  assert.equal(windowFrom(back), at(12, 28))
  assert.equal(windowFrom(word({ fullAt: at(12, 31), backAt: at(12, 28) })), at(12, 19))
  const late = { id: 'B1300', who: 'chat 1', since: WAIT_AT, limitMs: 90 * MIN }
  const running = now => from => now - from
  assert.equal(sideStateOf({ late, word: { ...back, keepCard: true }, runningMs: running(at(12, 37, 59)) }).note, 'the board is asking chat 1')
  assert.equal(sideStateOf({ late, word: { ...back, keepCard: true }, runningMs: running(at(12, 38)) }).note, 'no hand sent the board\'s word to chat 1 within 10 min')
  assert.deepEqual(sideClosesOf({ words: [back], liveKeys: new Set([KEY]), runningMs: running(at(12, 37, 59)) }), [])
  assert.deepEqual(sideClosesOf({ words: [back], liveKeys: new Set([KEY]), runningMs: running(at(12, 38)) }), [{ id: 'w1', why: STALE_SIDE_WHY }])
  // F53's close while full stays: a window that ends while full is "a limit is full", in doubt the plain why.
  assert.deepEqual(sideClosesOf({ words: [full, word({ id: 'w2', doubtAt: at(12, 20) })], liveKeys: new Set([KEY]), runningMs: running(at(12, 29)), isFull: true }), [{ id: 'w1', why: 'a limit is full' }, { id: 'w2', why: STALE_SIDE_WHY }])
  // The state reads the words as the look leaves them, and names the stamps to write.
  const fullNow = build({ now: at(12, 20), week: 99, outbox: [word()] })
  assert.deepEqual(fullNow.sideFullMarks, [{ id: 'w1', mark: { fullAt: at(12, 20) } }])
  const backNow = build({ now: at(12, 29), outbox: [word({ fullAt: at(12, 20), keepCard: true })] })
  assert.deepEqual([backNow.sideFullMarks, backNow.sideWordsClose], [[{ id: 'w1', mark: { backAt: at(12, 29) } }], []])
  assert.match(lateCards(backNow)[0].text, /Then the board is asking chat 1\./)
  assert.deepEqual(build({ now: at(12, 29), outbox: [word({ fullAt: at(12, 20), backAt: at(12, 28) })] }).sideFullMarks, [])
})

test('F63, the real case: a word at 12:19, a limit full 12:20-12:27, back from 12:28, no hand: "is asking chat 1" until 12:38, then the right card; one word, fullAt 12:20, backAt 12:28', async () => {
  const isFullAt = now => now >= at(12, 20) && now < at(12, 28)
  const { seen, outbox } = await minutes({ from: at(12, 19), to: at(12, 39), isFullAt, sweep: true })
  assert.deepEqual(seen['12:19'], { cards: [], due: 1 })
  for (let minute = 20; minute <= 27; minute += 1) assert.deepEqual(seen[`12:${minute}`], { cards: [NOT_ASKED], due: 0 }, `12:${minute}`)
  for (let minute = 28; minute <= 37; minute += 1) assert.deepEqual(seen[`12:${minute}`], { cards: [ASKING], due: 0 }, `12:${minute}`)
  assert.deepEqual(seen['12:38'], { cards: [NO_HAND], due: 0 })
  assert.deepEqual(seen['12:39'], { cards: [GAVE_UP], due: 0 })
  const words = outbox.filter(one => one.command === SIDE_WORD)
  assert.deepEqual(words.map(one => [one.id, one.state, one.why, one.closedAt, one.fullAt, one.backAt]), [['w1', 'dropped', STALE_SIDE_WHY, at(12, 38), at(12, 20), at(12, 28)]])
  // A hand sends it at 12:33 (the store lets it take the word, 14 min of wall time after it was made): delivered, one word, the card says so.
  const sent = await minutes({ from: at(12, 19), to: at(12, 40), isFullAt, sweep: true, after: handSends(at(12, 33)) })
  for (let minute = 28; minute <= 33; minute += 1) assert.deepEqual(sent.seen[`12:${minute}`], { cards: [ASKING], due: 0 }, `12:${minute}`)
  for (const minute of ['12:34', '12:40']) assert.deepEqual(sent.seen[minute], { cards: [ASKED_AT('12:33')], due: 0 }, minute)
  assert.deepEqual(said(sent.outbox).map(one => [one.id, one.state, one.deliveredAt, one.keepCard]), [['w1', 'delivered', at(12, 33), true]])
})

test('F63, chat 1\'s case: back with under a minute of the old window left (full 12:20 until 12:28:30, a look every 30 s, then every minute): no close at 12:29, one word a hand sends in the new window, the card right at every look', async () => {
  const isFullAt = now => now >= at(12, 20) && now < at(12, 28, 30)
  // Every 30 s: back at the look of 12:28:30, 30 s of the old window left.
  const { looks, outbox } = await minutes({ from: at(12, 19), to: at(12, 36), every: 30_000, isFullAt, sweep: true, after: handSends(at(12, 33)) })
  assert.equal(looks.length, 35)
  for (const look of looks) {
    const expected = look.at < at(12, 20) ? [] : look.at < at(12, 28, 30) ? [NOT_ASKED] : look.at <= at(12, 33) ? [ASKING] : [ASKED_AT('12:33')]
    assert.deepEqual(look.cards, expected, clockOf(look.at))
    assert.equal(look.cards.some(card => /no hand sent/.test(card)), false, clockOf(look.at))
  }
  assert.deepEqual(said(outbox).map(one => [one.id, one.state, one.deliveredAt, one.fullAt, one.backAt]), [['w1', 'delivered', at(12, 33), at(12, 20), at(12, 28, 30)]])
  assert.equal(outbox.filter(one => one.command === SIDE_WORD).length, 1)
  // Every minute: the first look that sees the limit back is 12:29, when the old window is over: it reads the word as it leaves it.
  const minute = await minutes({ from: at(12, 19), to: at(12, 36), isFullAt, sweep: true, after: handSends(at(12, 33)) })
  for (const look of minute.looks) {
    const expected = look.at < at(12, 20) ? [] : look.at < at(12, 29) ? [NOT_ASKED] : look.at <= at(12, 33) ? [ASKING] : [ASKED_AT('12:33')]
    assert.deepEqual(look.cards, expected, clockOf(look.at))
  }
  assert.deepEqual(said(minute.outbox).map(one => [one.id, one.state, one.deliveredAt, one.fullAt, one.backAt]), [['w1', 'delivered', at(12, 33), at(12, 20), at(12, 29)]])
  assert.equal(minute.outbox.filter(one => one.command === SIDE_WORD).length, 1)
})

test('F63: two full spells in one window, the second until past the window from the first return: F53\'s "a limit is full", then one new word once back; restarts between the stamps keep them', async () => {
  const isFullAt = now => (now >= at(12, 20) && now < at(12, 25)) || (now >= at(12, 27) && now < at(12, 37))
  const { seen, outbox } = await minutes({ from: at(12, 19), to: at(12, 39), isFullAt, sweep: true, restartAt: [at(12, 23), at(12, 26), at(12, 30)], after: handSends(at(12, 38)) })
  assert.deepEqual(seen['12:19'], { cards: [], due: 1 })
  for (const minute of ['12:20', '12:24', '12:27', '12:29', '12:36']) assert.deepEqual(seen[minute], { cards: [NOT_ASKED], due: 0 }, minute)
  for (const minute of ['12:25', '12:26']) assert.deepEqual(seen[minute], { cards: [ASKING], due: 0 }, minute)
  assert.deepEqual(seen['12:37'], { cards: ['the card'], due: 1 })
  assert.deepEqual(seen['12:38'], { cards: [ASKING], due: 0 })
  assert.deepEqual(seen['12:39'], { cards: [ASKED_AT('12:38')], due: 0 })
  // The first word: stamped full 12:20, back 12:25 (over the restart at 12:23), full again 12:27 (over the one at 12:26), closed while full.
  const first = outbox.find(one => one.id === 'w1')
  assert.deepEqual([first.state, first.why, first.fullAt, first.backAt], ['dropped', 'a limit is full', at(12, 27), at(12, 25)])
  assert.deepEqual(said(outbox).filter(one => one.id !== 'w1').map(one => [one.state, one.keepCard, one.at, one.deliveredAt]), [['delivered', true, at(12, 37), at(12, 38)]])
})

test('F63: a second spell that ends inside the window from the first return: the word is closed while full, and the new one gets its whole window (never "no hand sent it" early)', async () => {
  const isFullAt = now => (now >= at(12, 20) && now < at(12, 25)) || (now >= at(12, 27) && now < at(12, 31))
  const { seen, outbox } = await minutes({ from: at(12, 19), to: at(12, 42), isFullAt, sweep: true })
  for (const minute of ['12:20', '12:27', '12:30']) assert.deepEqual(seen[minute], { cards: [NOT_ASKED], due: 0 }, minute)
  assert.deepEqual(seen['12:31'], { cards: ['the card'], due: 1 })
  for (let minute = 32; minute <= 40; minute += 1) assert.deepEqual(seen[`12:${minute}`], { cards: [ASKING], due: 0 }, `12:${minute}`)
  assert.deepEqual(seen['12:41'], { cards: [NO_HAND], due: 0 })
  assert.deepEqual(seen['12:42'], { cards: [GAVE_UP], due: 0 })
  assert.deepEqual(outbox.filter(one => one.command === SIDE_WORD).map(one => [one.state, one.why, one.at]), [['dropped', 'a limit is full', at(12, 19)], ['dropped', STALE_SIDE_WHY, at(12, 31)]])
})

test('F63: the outbox sweep leaves a side word alone at 11 min of wall time (it expired it at 10); a word kept for minutes still expires', async () => {
  const side = word()
  const line = { id: 'l1', at: at(12, 19), to: 'Worker 1', about: 'Worker 1', command: 'line', text: 'Look at this.', state: 'waiting' }
  assert.deepEqual([keepMs(side, KEEP), keepMs(line, KEEP)], [KEEP.answerMs, KEEP.messageMs])
  const now = at(12, 30)
  const ctx = { all: [side, line], items: null, now, keep: KEEP, closing: new Map(), runs: new Map(), gone: new Set(), lanes: [], onBoard: new Set(), stopped: new Map() }
  assert.equal(whyClosed(side, ctx), null)
  assert.deepEqual(whyClosed(line, ctx), { state: 'expired', why: 'waited longer than 10 min' })
  const dir = await mkdtemp(join(tmpdir(), 'side-sweep-'))
  try {
    const store = await fileStore(dir, at(12, 19))
    await store.say({ ...side })
    await store.say({ ...line })
    const closed = await sweepOutbox({ dir: null, outbox: store, state: build({ now, outbox: store.outbox().map(one => ({ ...one })) }), now, keep: KEEP })
    assert.deepEqual(closed.map(one => [one.id, one.state]), [['l1', 'expired']])
    assert.deepEqual(store.outbox().map(one => [one.id, one.state]), [['w1', 'waiting'], ['l1', 'expired']])
    // A hand may still take it (the store leaves only a late word alone).
    assert.deepEqual((await store.takeHands('Worker 2', now, KEEP, one => one.command === SIDE_WORD)).map(one => one.id), ['w1'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('F63: a PC sleep of 30 min, 3 min into the word\'s window: at the wake neither the sweep nor the board closes it; 7 min more of running time, then the right card', async () => {
  const off = { from: at(12, 22), to: at(12, 52) }
  const { seen, looks, outbox } = await minutes({ from: at(12, 19), to: at(13, 0), isFullAt: () => false, sweep: true, off })
  assert.deepEqual(looks.filter(look => look.at > at(12, 21) && look.at < at(12, 52)), [], 'no look while the PC sleeps')
  assert.deepEqual(seen['12:19'], { cards: [], due: 1 })
  for (const minute of ['12:20', '12:21', '12:52', '12:55', '12:58']) assert.deepEqual(seen[minute], { cards: [], due: 0 }, minute)
  assert.deepEqual(seen['12:59'], { cards: [NO_HAND], due: 0 })
  assert.deepEqual(seen['13:00'], { cards: [GAVE_UP], due: 0 })
  assert.deepEqual(said(outbox).map(one => [one.id, one.state, one.why, one.closedAt]), [['w1', 'dropped', STALE_SIDE_WHY, at(12, 59)]])
  // The state reads the off gap from the history: 3 min of running time at the wake.
  const woke = build({ now: at(12, 52), outbox: [word()], lines: [{ at: off.from, gap: true }, { at: off.to, chat: 'Worker 2', state: 'idle', task: null }] })
  assert.deepEqual([woke.sideWordsClose, lateCards(woke)], [[], []])
})

// Chat 1's review of 40da0260. 1: a hand's claim (every ~20 s, on a fresh state) may take the word once the limit is back before the look
// (every 60 s) stamps the return, and give it back in doubt: the return must be stamped on it all the same. 2: no hand takes a word the
// state closes (its window over), in the time until the look closes it.

/** A hand's claim as the server's hands route makes it: on a fresh state, the side words `isHandWord` gives it (server.mjs `isHand`). */
async function handClaims(store, now, isFull = false) {
  const state = build({ now, week: isFull ? 99 : 40, outbox: store.outbox().map(one => ({ ...one })) })
  return store.takeHands('Worker 2', now, KEEP, one => isHandWord(one, { canSend: true, isFull: state.limitFull === true, sideCloses: state.sideWordsClose }))
}

test('F63, chat 1\'s review 1: a hand takes the word when the limit is back, before the look stamps it, and gives it back in doubt: no close before 10 min from the return, its late answer counts, the card right at every look', async () => {
  const isFullAt = now => now >= at(12, 20) && now < at(12, 28)
  // At 12:28, before the look: the hand's claim takes the word; it holds it over two looks and gives it back in doubt at 12:30.
  const hand = lateAnswerAt => async (store, now) => {
    if (now === at(12, 28)) assert.deepEqual((await handClaims(store, now)).map(one => one.id), ['w1'])
    if (now === at(12, 30)) assert.equal(await store.back(['w1'], 'Worker 2', now, ['w1']), 1)
    if (now === lateAnswerAt) assert.equal(await store.deliveredLate(['w1'], 'Worker 2', now), 1)
  }
  // Its late answer at 12:31: the word went; the card says so; no second word.
  const answered = await minutes({ from: at(12, 19), to: at(12, 40), isFullAt, sweep: true, before: hand(at(12, 31)) })
  assert.deepEqual(answered.seen['12:19'], { cards: [], due: 1 })
  for (let minute = 20; minute <= 27; minute += 1) assert.deepEqual(answered.seen[`12:${minute}`], { cards: [NOT_ASKED], due: 0 }, `12:${minute}`)
  for (const minute of ['12:28', '12:29', '12:30']) assert.deepEqual(answered.seen[minute], { cards: [ASKING], due: 0 }, minute)
  for (let minute = 31; minute <= 40; minute += 1) assert.deepEqual(answered.seen[`12:${minute}`], { cards: [ASKED_AT('12:31')], due: 0 }, `12:${minute}`)
  assert.deepEqual(said(answered.outbox).map(one => [one.id, one.state, one.deliveredAt, one.fullAt, one.backAt, one.backFrom]), [['w1', 'delivered', at(12, 31), at(12, 20), at(12, 28), 'Worker 2']])
  // No late answer: the word in doubt waits its whole window from the return (12:38), stays the word, and no second word goes.
  const silent = await minutes({ from: at(12, 19), to: at(12, 39), isFullAt, sweep: true, before: hand(null) })
  for (let minute = 28; minute <= 37; minute += 1) assert.deepEqual(silent.seen[`12:${minute}`], { cards: [ASKING], due: 0 }, `12:${minute}`)
  assert.deepEqual(silent.seen['12:38'], { cards: [NO_HAND], due: 0 })
  assert.deepEqual(silent.seen['12:39'], { cards: [GAVE_UP], due: 0 })
  const words = silent.outbox.filter(one => one.command === SIDE_WORD)
  assert.deepEqual(words.map(one => [one.id, one.state, one.why, one.closedAt, one.backAt, Number.isFinite(one.doubtAt)]), [['w1', 'dropped', STALE_SIDE_WHY, at(12, 38), at(12, 28), true]])
})

test('F63, chat 1\'s review 2: no hand takes a side word whose window is over, before the look closes it; one inside its window, or just back, it takes; the server passes the closes', async () => {
  const closes = [{ id: 'w1', why: STALE_SIDE_WHY }]
  assert.equal(isHandWord(word(), { canSend: true }), true)
  assert.equal(isHandWord(word(), { canSend: true, sideCloses: closes }), false)
  assert.equal(isHandWord(word({ id: 'w2' }), { canSend: true, sideCloses: closes }), true, 'another word\'s close')
  assert.equal(isHandWord({ id: 'w1', command: 'wake', about: 'Worker 1' }, { canSend: true, sideCloses: closes }), true, 'only a side word')
  const claimOn = async (words, now, isFull = false) => {
    const dir = await mkdtemp(join(tmpdir(), 'side-take-'))
    try {
      const store = await fileStore(dir, at(12, 19))
      for (const one of words) await store.say({ ...one })
      return (await handClaims(store, now, isFull)).map(one => one.id)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
  // Made at 12:19, no limit full: inside its window at 12:28:59, over at 12:29 (the card says "no hand sent it"; the look closes it next).
  assert.deepEqual(await claimOn([word()], at(12, 28, 59)), ['w1'])
  assert.deepEqual(build({ now: at(12, 29), outbox: [word()] }).sideWordsClose, closes)
  assert.deepEqual(await claimOn([word()], at(12, 29)), [])
  // Its wait ended (renewed): not taken either.
  assert.deepEqual(await claimOn([word({ key: sideKeyOf('B1300', { at: '2026-11-21 10:00' }) })], at(12, 20)), [])
  // Full 12:20-12:28, back at 12:29 before any look stamped it: the hand's fresh state reads it back, so it takes it.
  assert.deepEqual(await claimOn([word({ fullAt: at(12, 20), keepCard: true })], at(12, 29)), ['w1'])
  // The server's hands route passes the state's closes to isHandWord.
  const { readFile } = await import('node:fs/promises')
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  const isHand = server.split('\n').find(line => line.includes('const isHand = message =>'))
  assert.match(isHand ?? '', /isHandWord\(message, \{[^}]*sideCloses: state\.sideWordsClose[^}]*\}\)/)
})
