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
import { fileStore, foldOutbox, outboxKnown } from '../src/store.mjs'
import { isUndelivered } from '../src/supervisor/rules/watch.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { SIDE_WORD, sideChatsOf, sideClosesOf, sideKeepOf, sideKeptFor, sideKeptOf, sideKeyOf, sideSessionOf, sideStateOf, sideWordFor, sideWordOf } from '../src/work/sideWord.mjs'
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
/** The board at `now`: Worker 1 idle since 10:50 on B1300 waiting on `who` since `since`; `outbox` the words. */
function build({ now, who = 'chat 1', since = WAIT_AT, outbox = [], week = 40 }) {
  const raw = {
    listText: JSON.stringify({ prefix: PREFIX, main: 'Lead' }), appChatTexts: NAMES.map(app), tails: {}, planLineTexts: {},
    work: storeWith([b1300(waitsLine(who, since))]), adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: at(9, 0),
  }
  const reports = [report('Lead', 'idle', at(10, 0), now - 5_000), report('Worker 1', 'idle', at(10, 50), now - 5_000), report('Worker 2', 'idle', at(10, 0), now - 5_000)]
  const keptReadings = [{ at: now - MIN, fiveHour: { used: 10, resetsAt: now + 120 * MIN }, week: { used: week, resetsAt: now + 2880 * MIN } }]
  // The words as the server gives them (server.mjs `words`): one that waited too long reads `expired`.
  const known = outboxKnown(outbox, now, KEEP)
  return buildState(raw, { lines: [], outbox: known, words: known, keptReadings, runs: [], now, config, seen: { shown: {}, other: {} }, board: { startedAt: at(9, 0), offSince: null }, reports: new Map(reports) })
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
  const known = outboxKnown([word()], late, KEEP)
  assert.equal(known[0].state, 'expired')
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
 * same files. `{ seen: { 'HH:MM': { cards, due } }, outbox }`.
 */
async function minutes({ from, to, isFullAt, sendAt, restartAt }) {
  const dir = await mkdtemp(join(tmpdir(), 'side-full-'))
  try {
    let store = await fileStore(dir, from)
    const seen = {}
    for (let now = from; now <= to; now += MIN) {
      if (now === restartAt) store = await fileStore(dir, now)
      const state = build({ now, week: isFullAt(now) ? 99 : 40, outbox: store.outbox().map(one => ({ ...one })) })
      seen[hourMinute(now)] = { cards: lateCards(state).map(card => card.text.match(/Then [^.]*\./)?.[0] ?? 'the card'), due: state.sideWordsDue.length }
      await sideLook(store, state, now)
      if (now === sendAt) {
        assert.equal(isFullAt(now), false, 'no hand sends while a limit is full')
        const waiting = store.outbox().filter(one => one.command === SIDE_WORD && one.state === 'waiting')
        assert.equal(waiting.length, 1)
        await store.update(waiting[0].id, { state: 'delivered', deliveredAt: now })
      }
    }
    return { seen, outbox: store.outbox() }
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
