// B1307 (F40; the person's "Yes, build F40", 2026-11-21): a late wait on a side chat goes to that chat first. The live case replayed:
// Worker 1 blocked B1300 at 10:49 with on "chat 1" (its core review and go to land); at 90 min of the board's running time the person
// got a "Waits late" card and carried it to chat 1 by hand. Now: one word to chat 1 at 90 min by a hand's send, no card; the card only
// when the wait still stands 30 min after the word went; a renewed block a new wait with a new clock; a restart says no second word;
// an unknown side chat the card at 90 min with the why; waits on board chats as before. Made-up chats and fake app ids only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { parseConfig } from '../src/config.mjs'
import { handJobs, isForHandsYet, isHandWord } from '../src/hands.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { SIDE_WORD, sideChatsOf, sideKeyOf, sideSessionOf, sideWordFor, staleSideWords } from '../src/work/sideWord.mjs'
import { waitsOnOf } from '../src/work/waitsOn.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
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
function build({ now, who = 'chat 1', since = WAIT_AT, outbox = [] }) {
  const raw = {
    listText: JSON.stringify({ prefix: PREFIX, main: 'Lead' }), appChatTexts: NAMES.map(app), tails: {}, planLineTexts: {},
    work: storeWith([b1300(waitsLine(who, since))]), adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: at(9, 0),
  }
  const reports = [report('Lead', 'idle', at(10, 0), now - 5_000), report('Worker 1', 'idle', at(10, 50), now - 5_000), report('Worker 2', 'idle', at(10, 0), now - 5_000)]
  return buildState(raw, { lines: [], outbox, words: outbox, runs: [], now, config, seen: { shown: {}, other: {} }, board: { startedAt: at(9, 0), offSince: null }, reports: new Map(reports) })
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
  assert.equal(said.text, `Worker 1 waits for you on B1300 since 10:49 (${WHY}). Give it your answer, or tell it to go on without you; the person is asked at 12:49 if it still waits.`)
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
  assert.deepEqual([staleSideWords([word()], at(12, 28)), staleSideWords([word()], at(12, 29))], [[], ['w1']])
  // Given up (the server's close): the card stays, with the why.
  assert.match(lateCards(build({ now: at(12, 30), outbox: [word({ state: 'dropped', why: 'no hand sent it within 10 min' })] }))[0].text, /Then the board could not ask chat 1: no hand sent it within 10 min\./)
  // A send the app refused: the card at once, with the app's words.
  assert.match(lateCards(build({ now: at(12, 21), outbox: [word({ state: 'failed', why: 'refused' })] }))[0].text, /could not ask chat 1: refused/)
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
  assert.match(cards[0].text, /Then the board could not ask chat 3: chat 3 is not known to the board \(no app id in side-chats\.json\)\./)
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
  assert.match(lateCards(build({ now: at(12, 29) }))[0].text, /Then the board could not ask chat 1\./)
})

test('the hands: a side word is a hand\'s job to its own app id, only for a hand that may send, within 10 min, never Main\'s model turn', () => {
  const waiting = word()
  assert.equal(isHandWord(waiting, { canSend: true, now: at(12, 20) }), true)
  assert.equal(isHandWord(waiting, { canSend: false, now: at(12, 20) }), false)
  assert.equal(isHandWord(waiting, { canSend: true, now: at(12, 29) }), false)
  assert.equal(isHandWord({ ...waiting, session: 'not-an-id' }, { canSend: true, now: at(12, 20) }), false)
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
