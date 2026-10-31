// Signals change 2: the state carries one word per chat (src/chatWord.mjs through src/state.mjs). The real cases through
// `buildState`: what each kind of chat reads, that the head counts are the words, and that the word is display only (it feeds
// no decision: `state`, `isRunning`, `asleep` stay, and the hand-out reads nothing of the word). Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { WORDS, WORD_LIST, countsOf } from '../src/chatWord.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState } from '../src/state.mjs'
import { HANDOVER_COMMAND } from '../src/work/handover.mjs'
import { idleWorkers } from '../src/work/handOut.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { storeFromText } from '../src/work/read.mjs'

const MIN = 60_000
const SEC = 1000
const NOW = new Date(2026, 9, 31, 12, 0).getTime()
const NAMES = ['Lead', 'Worker 1', 'Worker 2', 'Worker 3', 'Advisor']
const app = name => JSON.stringify({
  title: `Studio · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\game', isArchived: false, createdAt: name.length, lastActivityAt: NOW - 2 * MIN, lastAssistantUuid: 'u-1',
})
/** A report as the server keeps it: from the session the board shows, on the hand-over's mod, `agoMs` old. */
const report = (name, state, agoMs = 2 * SEC, more = {}) => [name, { state, since: NOW - 3 * MIN, background: false, at: NOW - agoMs, session: `cli-${name}`, mod: '0.27.0', ...more }]
const config = { ...parseConfig('{"advisor":"Advisor"}', {}), project: 'C:\\game' }
const failed = { id: 'e1', at: NOW - 2 * MIN, to: 'Worker 2', command: HANDOVER_COMMAND, text: 'hand-over', state: 'failed', kind: 'clear', step: null, clear: { step: 'B12', reportedAt: NOW - 3 * MIN, reason: 'x' }, outcome: { cleared: false, set: null, typed: null, restarted: null, background: false, why: 'the clear did not run' }, why: 'its clear did not run: the clear did not run', failedAt: NOW - 2 * MIN, settledAt: NOW - 2 * MIN }

function build({ reports = [], names = NAMES, outbox = [], appStartedAt = NOW - 5 * 60 * MIN, mods = {}, startedAt = NOW - 30 * MIN, pause = null } = {}) {
  const work = storeFromText('## Work\n', { now: NOW - 60 * MIN })
  if (pause !== null) work.pause = pause
  const raw = {
    listText: '{"prefix":"Studio · ","main":"Lead"}', appChatTexts: names.map(app), tails: {}, planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {},
    appStartedAt,
  }
  return buildState(raw, {
    lines: [], outbox, runs: [], now: NOW, config, seen: { shown: Object.fromEntries(names.map(name => [name, NOW - 5 * SEC])), other: {} }, board: { startedAt, offSince: null },
    reports: new Map(reports), mods: { Lead: '0.27.0', ...mods },
  })
}
const lane = (state, name) => state.chats.find(chat => chat.name === name)
const words = state => Object.fromEntries(state.chats.map(chat => [chat.name, chat.word]))

test('every chat carries its word, why, since, reportAt and age; the word is one of the list', () => {
  const state = build({ reports: [report('Lead', 'idle'), report('Worker 1', 'busy', 25 * SEC), report('Worker 3', 'asking')] })
  for (const chat of state.chats) {
    assert.ok(WORD_LIST.includes(chat.word), `${chat.name}: ${chat.word}`)
    for (const key of ['why', 'since', 'reportAt', 'age']) assert.ok(Object.hasOwn(chat, key), `${chat.name} has ${key}`)
  }
  const working = lane(state, 'Worker 1')
  assert.deepEqual([working.word, working.age, working.reportAt], [WORDS.WORKING, 25 * SEC, NOW - 25 * SEC])
  assert.equal(lane(state, 'Worker 3').word, WORDS.WAITING)
  // The state's old fields stay exactly as the decisions read them.
  assert.deepEqual([working.state, working.isRunning], ['working', true])
  assert.equal(lane(state, 'Worker 3').state, 'waiting')
})

test('the partner and its card carry a word too', () => {
  const state = build({ reports: [report('Advisor', 'busy', 3 * SEC)] })
  assert.equal(state.advisor.word, WORDS.WORKING)
  assert.deepEqual([state.advisor.age, state.advisor.state], [3 * SEC, 'working'])
})

test('a chat that reported idle and runs is Free: a worker on the hand-over by its hand-over FREE, the main chat by its idle', () => {
  const state = build({ reports: [report('Lead', 'idle'), report('Worker 1', 'idle')], mods: { 'Worker 1': '0.27.0' } })
  assert.deepEqual([lane(state, 'Worker 1').onSequence, lane(state, 'Worker 1').handover?.state], [true, 'free'])
  assert.equal(lane(state, 'Worker 1').word, WORDS.FREE)
  assert.equal(lane(state, 'Lead').word, WORDS.FREE)
})

test('a worker the hand-out skips (its envelope failed: HELD) is Held, never Free, and its why is the board\'s', () => {
  const state = build({ reports: [report('Worker 2', 'idle')], mods: { 'Worker 2': '0.27.0' }, outbox: [failed] })
  const held = lane(state, 'Worker 2')
  assert.equal(held.handover.state, 'held')
  assert.deepEqual([held.word, held.why], [WORDS.HELD, 'its clear did not run: the clear did not run'])
})

test('the person pauses: a worker that has stopped (idle) reads Paused with the hand-over\'s why; one that runs a turn stays Working', () => {
  const state = build({ reports: [report('Worker 1', 'idle'), report('Worker 2', 'busy')], mods: { 'Worker 1': '0.27.0', 'Worker 2': '0.27.0' }, pause: { state: 'pausing', since: NOW - MIN } })
  assert.equal(lane(state, 'Worker 1').word, WORDS.PAUSED)
  assert.equal(lane(state, 'Worker 2').word, WORDS.WORKING, 'a fresh busy report beats the pause until the turn ends')
  assert.equal(lane(state, 'Worker 1').state, 'free', 'the decision field is not touched')
})

test('the app started after the reports: an idle chat is Asleep, a busy one with a step Stopped (resumes by itself), neither counted busy', () => {
  const work = storeFromText('## Work\n', { now: NOW - 60 * MIN })
  work.items.set('B12', parseItem(`Id: B12\nKind: step\nTitle: Paint\nState: in progress\nOwner: Worker 3\nSince: ${stamp(NOW - 40 * MIN)}\n`))
  const raw = { listText: '{"prefix":"Studio · ","main":"Lead"}', appChatTexts: NAMES.map(app), tails: {}, planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: NOW - 20 * SEC }
  const state = buildState(raw, {
    lines: [], outbox: [], runs: [], now: NOW, config, seen: { shown: { Lead: NOW - SEC }, other: {} }, board: { startedAt: NOW - 30 * MIN, offSince: null },
    reports: new Map([report('Worker 1', 'idle', 2 * MIN), report('Worker 3', 'busy', 2 * MIN)]), mods: { 'Worker 1': '0.27.0', 'Worker 3': '0.27.0' },
  })
  assert.equal(lane(state, 'Worker 1').word, WORDS.ASLEEP)
  assert.deepEqual([lane(state, 'Worker 3').word, lane(state, 'Worker 3').why], [WORDS.STOPPED, 'resumes by itself'])
  assert.equal(state.counts.working, 0, 'today\'s "N of M busy" does not grow')
})

test('a stale report: Unknown, with the age (no report for 40 s)', () => {
  const stale = build({ reports: [report('Worker 1', 'busy', 40 * SEC)] })
  const unknown = lane(stale, 'Worker 1')
  assert.deepEqual([unknown.word, unknown.state, unknown.age], [WORDS.UNKNOWN, 'unknown', 40 * SEC])
})

test('after a clear: the new session has not reported yet: Restarting for two minutes from the moved card cleared.at, then Unknown with the age', () => {
  const card = at => JSON.stringify({ name: 'Worker 1', role: 'worker', state: 'waiting', task: null, at: NOW - 5 * SEC, mod: '0.27.0', cleared: { at, step: 'B12', log: '.claude/chat-logs/worker-1/b12.txt' } })
  const run = clearedAt => {
    const work = storeFromText('## Work\n', { now: NOW - 60 * MIN })
    const raw = { listText: '{"prefix":"Studio · ","main":"Lead"}', appChatTexts: NAMES.map(app), tails: {}, planLineTexts: { 'cli-Worker 1': card(clearedAt) }, planLineAt: { 'cli-Worker 1': clearedAt }, work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: NOW - 5 * 60 * MIN }
    return buildState(raw, { lines: [], outbox: [], runs: [], now: NOW, config, seen: { shown: { Lead: NOW - SEC }, other: {} }, board: { startedAt: NOW - 30 * MIN, offSince: null }, reports: new Map([report('Lead', 'idle')]), mods: { Lead: '0.27.0', 'Worker 1': '0.27.0' } })
  }
  const fresh = lane(run(NOW - 20 * SEC), 'Worker 1')
  assert.deepEqual([fresh.word, fresh.since], [WORDS.RESTARTING, NOW - 20 * SEC])
  assert.equal(fresh.state, 'unknown', 'the decision field still reads what it read')
  const late = lane(run(NOW - 3 * MIN), 'Worker 1')
  assert.deepEqual([late.word, late.age], [WORDS.UNKNOWN, 3 * MIN])
})

test('the head counts are one number per word: counts.working is the number of Working words, the sum is the chats', () => {
  const state = build({ reports: [report('Lead', 'idle'), report('Worker 1', 'busy'), report('Worker 2', 'busy'), report('Worker 3', 'asking')] })
  const all = state.chats.filter(chat => !chat.isLeftover)
  assert.equal(state.counts.working, all.filter(chat => chat.word === WORDS.WORKING).length)
  assert.equal(state.counts.working, 2)
  assert.equal(Object.values(state.counts).reduce((a, b) => a + b, 0), all.length)
  assert.deepEqual(state.counts, countsOf(state.chats))
})

test('display only: the word feeds no decision (idleWorkers returns the same chats whatever the word says), and no decision module reads the word', async () => {
  const state = build({ reports: [report('Lead', 'idle'), report('Worker 1', 'idle'), report('Worker 2', 'idle')], mods: { 'Worker 1': '0.27.0', 'Worker 2': '0.27.0' } })
  const items = new Map()
  const chats = state.chats
  const same = idleWorkers(chats, { items }).map(one => one.name)
  assert.ok(same.length > 0)
  for (const word of WORD_LIST) assert.deepEqual(idleWorkers(chats.map(one => ({ ...one, word })), { items }).map(one => one.name), same, word)
  assert.deepEqual(idleWorkers(chats.map(({ word, why, since, reportAt, age, ...rest }) => rest), { items }).map(one => one.name), same)
  for (const file of ['work/handOut.mjs', 'work/handover.mjs', 'work/reconcile.mjs', 'work/deliver.mjs', 'work/handoverBoard.mjs', 'work/modRollout.mjs', 'work/pause.mjs', 'chatReport.mjs', 'say.mjs']) {
    const source = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')
    assert.ok(!/chatWord|\b(?:lane|worker|chat)\.word\b/.test(source), `${file} reads no word`)
  }
})
