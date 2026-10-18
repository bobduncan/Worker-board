// B143: the person removes a worker from its lane. The board only asks: it types "remove worker" into the main
// chat, with the worker's name, what it is doing and why. A worker that is not free is asked for only once the person
// confirmed the warning; the main chat is never removed this way. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { answer, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { checkSay, workerState } from '../src/say.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = Date.UTC(2026, 9, 14, 9, 52)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const LIST = '{"prefix":"Studio · ","main":"Lead"}'

const app = name => JSON.stringify({
  title: `Studio · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: NOW - 2 * HOUR, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
const rested = { text: [typed(NOW - 30 * MIN, 'Zebracorn'), answer(NOW - 29 * MIN, 'Done.')].join('\n'), isCut: false, modifiedAt: NOW }

/** The board with these chats, all at rest, and what was sent. */
function build({ chats = ['Lead', 'Worker 1'], outbox = [], now = NOW } = {}) {
  const raw = {
    listText: LIST,
    appChatTexts: chats.map(app),
    tails: Object.fromEntries(chats.map(name => [`cli-${name}`, rested])),
    planLineTexts: {}, backlogText: '', adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  const seen = { shown: Object.fromEntries(chats.map(name => [name, now - 5000])), other: {} }
  return buildState(raw, { lines: [], outbox, runs: [], board: { startedAt: now - 10 * MIN, offSince: null }, seen, now, config })
}

const WORDS = { to: 'Lead', ask: null, step: null, title: null, version: null, verdict: null, command: 'remove' }
const sent = (at, about, more = {}) => ({ id: `m${at}`, at, ...WORDS, about, text: `remove worker\nName: ${about}`, state: 'delivered', deliveredAt: at + 5000, ...more })

// What a worker is doing, in the main chat's words

const lane = more => ({ name: 'Worker 1', isMain: false, isLeftover: false, state: 'free', task: null, queue: [], suspended: null, ...more })
const task = { text: 'Sheet and two views', step: 2, steps: 4, stepId: 'B140' }

test('a worker is free when its lane is free and nothing is queued for it', () => {
  assert.deepEqual(workerState(lane()), { words: 'free', isFree: true })
  assert.deepEqual(workerState(lane({ queue: [{ id: 'B141', title: 'Portraits' }] })), { words: 'free; 1 step queued for it: B141', isFree: false })
  assert.deepEqual(workerState(lane({ queue: [{ id: 'B141', title: 'Portraits' }, { id: null, title: 'An "old" step' }] })).words, 'free; 2 steps queued for it: B141, "An old step"')
})

test('the state line names the task and its step, and every state that is not free', () => {
  assert.deepEqual(workerState(lane({ state: 'working', task })), { words: 'working on B140 "Sheet and two views", step 2 of 4', isFree: false })
  assert.equal(workerState(lane({ state: 'working', task: { text: 'Tidy up', step: null, steps: null, stepId: null } })).words, 'working on "Tidy up"')
  assert.equal(workerState(lane({ state: 'working' })).words, 'working')
  assert.equal(workerState(lane({ state: 'waiting', task })).words, 'waiting for you, on B140 "Sheet and two views", step 2 of 4')
  const until = new Date(2026, 9, 14, 11, 0).getTime()
  assert.equal(workerState(lane({ state: 'suspended', suspended: { until } })).words, 'suspended for the limit until 11:00')
  assert.equal(workerState(lane({ state: 'interrupted', task })).words, 'cut off in the middle of its turn, on B140 "Sheet and two views", step 2 of 4')
  assert.deepEqual(workerState(lane({ state: 'unknown' })), { words: 'unknown to the board', isFree: false })
})

// The word the board types into the main chat

test('a free worker is asked for at once, in the board\'s own words', () => {
  const state = build()
  assert.deepEqual(checkSay({ to: 'Lead', command: 'remove', chat: 'Worker 1' }, state, 2000), {
    ok: true,
    message: { ...WORDS, about: 'Worker 1', text: 'remove worker\nName: Worker 1\nState: free\nWhy: removed with the button' },
  })
})

test('a worker that is not free is asked for only once the warning was confirmed', () => {
  const state = build()
  const busy = { ...state, chats: state.chats.map(chat => (chat.name === 'Worker 1' ? { ...chat, state: 'working', task } : chat)) }
  const refused = checkSay({ to: 'Lead', command: 'remove', chat: 'Worker 1' }, busy, 2000)
  assert.deepEqual([refused.ok, refused.status], [false, 409])
  assert.match(refused.why, /not free \(working on B140 "Sheet and two views", step 2 of 4\)/)
  const sure = checkSay({ to: 'Lead', command: 'remove', chat: 'Worker 1', sure: true }, busy, 2000)
  assert.equal(sure.message.text, 'remove worker\nName: Worker 1\nState: working on B140 "Sheet and two views", step 2 of 4\nWhy: removed with the button')
})

test('the main chat, a chat that is not on the board and a leftover are not removed; the word goes to the main chat only', () => {
  const state = build({ chats: ['Lead', 'Worker 1', 'Worker 1 (fork)'] })
  const refused = body => checkSay({ to: 'Lead', command: 'remove', sure: true, ...body }, state, 2000)
  assert.equal(refused({ chat: 'Lead' }).status, 409)
  assert.equal(refused({ chat: 'Nobody' }).status, 409)
  assert.equal(refused({ chat: 'Worker 1 (fork)' }).status, 409)
  assert.equal(refused({ to: 'Worker 1', chat: 'Worker 1' }).status, 400)
  assert.equal(refused({ chat: 'Worker 1', text: 'and more' }).status, 400)
})

test('one ask at a time per worker: a second waits until the first is no longer open', () => {
  const open = build({ outbox: [sent(NOW - 2 * MIN, 'Worker 1', { state: 'waiting', deliveredAt: undefined })] })
  assert.deepEqual(checkSay({ to: 'Lead', command: 'remove', chat: 'Worker 1' }, open, 2000), { ok: false, status: 409, why: 'An earlier ask to remove this worker is still open.' })
  const old = build({ outbox: [sent(NOW - 20 * MIN, 'Worker 1')] })
  assert.equal(checkSay({ to: 'Lead', command: 'remove', chat: 'Worker 1' }, old, 2000).ok, true)
})

// What the state says about an ask

test('an ask is open while it is on its way, and after it arrived for 15 minutes while the worker is still there', () => {
  const removal = (outbox, name = 'Worker 1') => build({ chats: ['Lead', 'Worker 1', 'Worker 2'], outbox }).chats.find(chat => chat.name === name).removal
  assert.equal(removal([]), null)
  assert.deepEqual(removal([sent(NOW - MIN, 'Worker 1', { state: 'waiting', deliveredAt: undefined })]), { at: NOW - MIN, state: 'waiting', isOpen: true })
  assert.equal(removal([sent(NOW - MIN, 'Worker 1', { state: 'taken', deliveredAt: undefined })]).isOpen, true)
  assert.deepEqual(removal([sent(NOW - 5 * MIN, 'Worker 1')]), { at: NOW - 5 * MIN, state: 'delivered', isOpen: true })
  assert.equal(removal([sent(NOW - 20 * MIN, 'Worker 1')]).isOpen, false)
  // Another worker's ask is not this one's; the main chat has none.
  assert.equal(removal([sent(NOW - MIN, 'Worker 2')]), null)
  assert.equal(removal([], 'Lead'), null)
})
