// The wait line through the server's own state (the review of 2026-11-02, findings 1 and 2): the state the board builds
// (state.mjs `buildState`, with the chats' turn reports as server.mjs keeps them), its `waits` as `waitsNow` makes them
// (supervisor/index.mjs `wordJudge`, src/waitLine.mjs `waitsOf` and `splitSeen`), and what the server keeps on a word once
// (`store.update` of the seen fields), then the page drawn from that state. Made-up garden chats.
import assert from 'node:assert/strict'
import test from 'node:test'

import { answer } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { wordJudge } from '../src/supervisor/index.mjs'
import { splitSeen, waitsOf } from '../src/waitLine.mjs'
import { parseItem } from '../src/work/item.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { openPage } from './pageHarness.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 2, 13, 0).getTime()
const at = minutesAgo => NOW - minutesAgo * MIN
const pad = n => String(n).padStart(2, '0')
const hhmm = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
const stamp = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hhmm(ms)}` }
const config = { ...parseConfig('{}', {}), project: 'C:/garden' }
const keep = { messageMs: config.messageKeepMinutes * MIN, answerMs: config.answerKeepHours * 60 * MIN }
const NAMES = ['Lead', 'Digger', 'Advisor']
const app = name => JSON.stringify({ title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:/garden', isArchived: false, createdAt: name.length, lastActivityAt: at(40), lastAssistantUuid: 'u-1' })
const tail = { text: answer(at(40), 'ok'), isCut: false, modifiedAt: at(40) }
/** A turn report as the server keeps it (bridge.mjs `noteReport`), heard a moment ago. */
const report = (name, state, since, more = {}) => [name, { state, since, background: false, run: 1, seq: 1, at: NOW - 2000, session: `cli-${name}`, mod: '0.19.0', busyAt: null, ...more }]
/** Q5, Digger's ask, answered by the person `answeredMin` minutes ago. */
const askQ5 = answeredMin => parseItem(`Id: Q5\nKind: ask\nTitle: Number or bar?\nState: answered\nOwner: Digger\nSince: ${stamp(at(answeredMin))}\nFiled: ${at(90)}\nAsks: decide\nBlocking: no\nOptions: A number | B bar\n\n## Answer\nA\n`)
/** The person's answer to Q5, typed to Digger (`more`: its state as the outbox holds it). */
const answerWord = more => ({ id: 'w5', to: 'Digger', ask: 'work:Q5', step: null, title: 'Number or bar?', version: null, verdict: null, text: 'A', at: at(30), state: 'waiting', ...more })

/** The board's state and its waits, as server.mjs getState makes them; `seen` what `waitsNow` keeps on the words. */
function serverState({ reports, outbox, items = [askQ5(30)], obsolete = null, viaLane = false }) {
  const work = storeFromText('## Garden\n- [ ] B12 Plant the hedge\n', { now: at(120) })
  for (const item of items) work.items.set(item.head.get('Id'), item)
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: NAMES.map(app),
    tails: Object.fromEntries(NAMES.map(name => [`cli-${name}`, tail])), planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work,
  }
  const kept = new Map(reports)
  const state = buildState(raw, { lines: [], outbox, runs: [], now: NOW, config, seen: { shown: {}, other: {} }, board: { startedAt: at(300), offSince: null }, reports: kept })
  const judge = wordJudge({ state, items: work.items, outbox, keep, settings: {}, now: NOW })
  const { waits, seen } = splitSeen(waitsOf({ state, outbox, now: NOW, keep, judge, reports: viaLane ? null : kept, items: work.items, obsolete }))
  return { state: { ...JSON.parse(JSON.stringify(state)), waits, waitAgain: true }, seen }
}
/** What server.mjs `waitsNow` does with `seen`: written on the word once (`store.update`). */
const kept = (outbox, seen) => outbox.map(word => ({ ...word, ...(seen.find(one => one.id === word.id)?.fields ?? {}) }))
const words = node => node.textContent.replace(/\s+/g, ' ').trim()

test('finding 1: an answered ask stays while its word\'s line waits (it turns Late after 10 min); the ten minutes count from its Done, or from the answer when it has no word', async () => {
  // Digger runs and is free, and has not taken the answer typed 30 minutes ago: rule 8 names it, and the card shows it.
  const reports = [report('Lead', 'idle', at(60)), report('Digger', 'idle', at(60)), report('Advisor', 'idle', at(60))]
  const { state } = serverState({ reports, outbox: [answerWord()] })
  assert.equal(state.forYou.find(one => one.workId === 'Q5')?.answer?.id, 'w5', 'the answered ask is still in the list after 30 minutes')
  assert.equal(state.waits.w5.state, 'late')
  const page = await openPage({ state })
  try {
    const slim = page.find('#needs .need.is-slim')
    assert.equal(slim.dataset.id, 'work:Q5')
    assert.equal(words(slim.querySelector('.wait-line .wait-words')), "Not picked up after 30 min · it waits in Digger's queue")
  } finally { await page.close() }
  // Its line is Done (kept 15 minutes ago): it went 5 minutes ago. Done 5 minutes ago: it stays (closed, as an answered card).
  assert.equal(serverState({ reports, outbox: [answerWord({ state: 'delivered', takenAt: at(29), deliveredAt: at(29), answeredAt: at(15) })] }).state.forYou.some(one => one.workId === 'Q5'), false)
  assert.equal(serverState({ reports, outbox: [answerWord({ state: 'delivered', takenAt: at(29), deliveredAt: at(29), answeredAt: at(5) })] }).state.forYou.some(one => one.workId === 'Q5'), true)
  // No word (the board answered it itself): ten minutes from the answer, as before.
  assert.equal(serverState({ reports, outbox: [] }).state.forYou.some(one => one.workId === 'Q5'), false)
  assert.equal(serverState({ reports, outbox: [], items: [askQ5(5)] }).state.forYou.some(one => one.workId === 'Q5'), true)
})

test('finding 2a: a turn seen ended is kept on its word once; a later turn of the chat never makes it "on it" again', () => {
  const delivered = answerWord({ state: 'delivered', takenAt: at(20), deliveredAt: at(20) })
  const first = serverState({ reports: [report('Lead', 'idle', at(60)), report('Digger', 'idle', at(10), { busyAt: at(19) }), report('Advisor', 'idle', at(60))], outbox: [delivered] })
  assert.equal(first.state.waits.w5.lead, `Digger answered ${hhmm(at(10))}`)
  assert.deepEqual(first.seen, [{ id: 'w5', fields: { answeredAt: at(10) } }], 'kept once')
  // Two minutes ago Digger began another turn: Working. The word stays answered, and nothing new is kept.
  const later = serverState({ reports: [report('Lead', 'idle', at(60)), report('Digger', 'busy', at(2)), report('Advisor', 'idle', at(60))], outbox: kept([delivered], first.seen) })
  assert.equal(later.state.chats.find(one => one.name === 'Digger').status, 'Working')
  assert.deepEqual([later.state.waits.w5.state, later.state.waits.w5.lead], ['done', `Digger answered ${hhmm(at(10))}`])
  assert.deepEqual(later.seen, [])
})

test('finding 2b: "on it" needs the lane Working; a session that ended mid-turn did not answer: the line goes back to the wake words', () => {
  const delivered = answerWord({ state: 'delivered', takenAt: at(20), deliveredAt: at(20) })
  const busy = serverState({ reports: [report('Lead', 'idle', at(60)), report('Digger', 'busy', at(19)), report('Advisor', 'idle', at(60))], outbox: [delivered] })
  assert.deepEqual([busy.state.chats.find(one => one.name === 'Digger').status, busy.state.waits.w5.state, busy.state.waits.w5.lead], ['Working', 'picked-up', 'Digger is on it'])
  // Its session ended at 12:45, after the word came: asleep, not answered.
  const ended = serverState({ reports: [report('Lead', 'idle', at(60)), report('Digger', 'ended', at(15)), report('Advisor', 'idle', at(60))], outbox: [delivered] })
  const digger = ended.state.chats.find(one => one.name === 'Digger')
  assert.equal(digger.isRunning, false)
  assert.deepEqual([ended.state.waits.w5.state, ended.state.waits.w5.rest], ['sent', 'Digger is asleep; the board wakes it'])
  assert.deepEqual(ended.seen, [], 'nothing kept: it did not answer')
})

test('finding 2c: an action with its own Done source never says "answered": its turn ended without the result, quietly; its result then is Done', () => {
  const check = { id: 'o1', to: 'Advisor', ask: null, command: 'obsolete-check', about: 'obsolete', text: 'obsolete check: 1 open item', at: at(20), state: 'delivered', takenAt: at(20), deliveredAt: at(20) }
  const record = { state: 'checking', at: at(20) - 1000, answeredAt: null, items: [{ id: 'Q5' }], verdicts: {}, last: null }
  const reports = [report('Lead', 'idle', at(60)), report('Digger', 'idle', at(60)), report('Advisor', 'idle', at(12), { busyAt: at(19) })]
  const ended = serverState({ reports, outbox: [check], obsolete: record })
  assert.deepEqual([ended.state.waits.o1.state, ended.state.waits.o1.lead, ended.state.waits.o1.isTurnEnded], ['sent', `Advisor's turn ended at ${hhmm(at(12))} without it`, true])
  const answered = serverState({ reports, outbox: kept([check], ended.seen), obsolete: { ...record, state: 'done', answeredAt: at(11), verdicts: { Q5: { verdict: 'obsolete', why: '', evidence: '' } } } })
  assert.deepEqual([answered.state.waits.o1.state, answered.state.waits.o1.lead, answered.state.waits.o1.rest], ['done', `Done ${hhmm(at(11))}`, '1 closed as obsolete · 0 stay'])
  assert.deepEqual(answered.seen, [{ id: 'o1', fields: { doneAt: at(11), doneWords: '1 closed as obsolete · 0 stay' } }])
})

test('finding 7: the answered card follows the word to the chat that asked, not one to the owner of the step it frees', () => {
  const toAsker = answerWord({ state: 'delivered', takenAt: at(20), deliveredAt: at(20) })
  const toOwner = { ...answerWord({ id: 'w6', to: 'Lead', at: at(19) }) }
  const { state } = serverState({ reports: [report('Lead', 'idle', at(60)), report('Digger', 'idle', at(60)), report('Advisor', 'idle', at(60))], outbox: [toAsker, toOwner] })
  assert.equal(state.forYou.find(one => one.workId === 'Q5').answer.id, 'w5')
})

test("the turn rule through the board's state (the signals lead's decision of 2026-11-02): the mod's word and turn reach the lane and the line; a later turn on another word is \"answered by\", kept once", () => {
  const delivered = answerWord({ state: 'delivered', takenAt: at(20), deliveredAt: at(20) + 10_000 })
  const idle = name => report(name, 'idle', at(60))
  const digger = (state, since, more) => report('Digger', state, since, { busyAt: since, ...more })
  // Its own turn runs, a question opened and closed inside it (a fresh since): still "on it", since the turn's own start.
  const own = serverState({ reports: [idle('Lead'), digger('busy', at(2), { word: 'w5', turn: at(18) }), idle('Advisor')], outbox: [delivered] })
  assert.deepEqual([own.state.waits.w5.state, own.state.waits.w5.lead, own.state.waits.w5.rest], ['picked-up', 'Digger is on it', `since ${hhmm(at(18))}`])
  assert.deepEqual(own.state.chats.find(one => one.name === 'Digger').report.word, 'w5', 'the lane carries what the mod said')
  // The live case: the chat is busy on another task in a later turn. The word was answered before: "by", not "on it".
  const live = serverState({ reports: [idle('Lead'), digger('busy', at(3), { word: 'b920-word', turn: at(3) }), idle('Advisor')], outbox: [delivered] })
  assert.equal(live.state.chats.find(one => one.name === 'Digger').status, 'Working')
  assert.deepEqual([live.state.waits.w5.state, live.state.waits.w5.lead], ['done', `Digger answered by ${hhmm(at(3))}`])
  assert.deepEqual(live.seen, [{ id: 'w5', fields: { answeredAt: at(3), answeredBound: true } }], 'kept once, as bound')
  // The lane's own copy of the report says the same where the server has no kept entry to give.
  const viaLane = serverState({ reports: [idle('Lead'), digger('busy', at(3), { word: 'b920-word', turn: at(3) }), idle('Advisor')], outbox: [delivered], viaLane: true })
  assert.deepEqual([viaLane.state.waits.w5.lead, viaLane.seen], [live.state.waits.w5.lead, live.seen])
  // Kept: another turn later changes nothing, and nothing new is kept.
  const later = serverState({ reports: [idle('Lead'), digger('busy', at(1), { word: 'c-word', turn: at(1) }), idle('Advisor')], outbox: kept([delivered], live.seen) })
  assert.deepEqual([later.state.waits.w5.lead, later.seen], [`Digger answered by ${hhmm(at(3))}`, []])
  // A word typed into a busy chat: the end of the turn that was running (begun before the word came) does not answer it.
  const waiting = serverState({ reports: [idle('Lead'), report('Digger', 'idle', at(4), { busyAt: at(40), word: null, turn: at(40) }), idle('Advisor')], outbox: [delivered] })
  assert.deepEqual([waiting.state.waits.w5.state, waiting.seen], ['sent', []])
  // An older mod (no word): the same end of that turn, with the board's receipt of its start before the word: no answer either.
  const older = serverState({ reports: [idle('Lead'), report('Digger', 'idle', at(4), { busyAt: at(40) }), idle('Advisor')], outbox: [delivered] })
  assert.deepEqual([older.state.waits.w5.state, older.seen], ['sent', []])
})
