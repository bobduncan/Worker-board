// B577 (X3 came back after its fix B532): a word the app drops because its chat's session was stopped spends no try:
// it waits, held while that session stays stopped, the chat's lane says since when, and the main chat is asked once to
// wake it; a turn begun since, or a new session under the name (the chat replaced), lets the words go, each with its
// age. A word that failed for another reason still goes three times at most; the failed words of a replaced chat's old
// session go to the new one. The undelivered rule names a stopped chat once. Each test fails without its rule.
// Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { checkTyped, messageText } from '../../src/bridge.mjs'
import { memoryStore } from '../../src/store.mjs'
import { wakesStopped } from '../../src/say.mjs'
import { isStillStopped, isStoppedWhy, stoppedOf } from '../../src/stopped.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { sendOnce } from '../../src/work/deliver.mjs'
import { stoppedChats, sweepOutbox, takeFor, whyClosed } from '../../src/work/outboxSweep.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const at = (h, m) => new Date(2026, 9, 24, h, m).getTime()
const keep = { messageMs: 10 * MIN, answerMs: 48 * HOUR }
const clock = ms => { const when = new Date(ms); return `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}` }
const STOPPED = 'a hook dropped it: the session was stopped and nobody has sent input since'

let n = 0
const newId = () => `c${(n += 1)}`
const work = (about, when, kind) => ({ id: `w-${about}-${when}`, at: when, to: 'Worker 5', ask: null, step: null, title: null, version: null, verdict: null,
  command: 'work', about, ...(kind ? { kind } : {}), text: kind ? `work: the board's check of ${about} failed` : `work: ${about} is yours; run work next`, state: 'waiting' })
const lane = (session, turnAt = at(21, 30)) => ({ name: 'Worker 5', isLeftover: false, isMain: false, isRunning: true, state: 'free', session, appSession: `local_${session}`, turnAt })
const main = { name: 'Main', isMain: true, isLeftover: false, isRunning: true, state: 'free', session: 'main-1', turnAt: at(21, 0) }
const stateWith = worker => ({ restart: { main: 'Main' }, chats: [main, worker] })

function outboxOf(words) {
  const store = memoryStore()
  for (const one of words) store.outbox().push({ ...one })
  return store
}

/** The chat takes its words (its session `session`), and the mod reports each as dropped because the session was stopped. */
async function takeAndDrop(store, state, session, now) {
  const taken = await takeFor({ dir: null, outbox: store, state, now, keep, chat: 'Worker 5' })
  const report = checkTyped({ chat: 'Worker 5', session, typed: [], failed: taken.map(one => one.id), why: Object.fromEntries(taken.map(one => [one.id, STOPPED])) }, state)
  await store.settle('Worker 5', report, now, { newId })
  return taken
}

test('X3: four words dropped as stopped at 21:41-21:42 spend no try, wait while the stopped chat stays so, and reach the new Worker 5 that replaced it at its first take', async () => {
  const words = [work('B522', at(21, 41), 'check'), work('B522', at(21, 41) + 20_000, 'check'), work('B567', at(21, 42)), work('B567', at(21, 42) + 10_000)]
  const store = outboxOf(words)
  const old = stateWith(lane('old-5'))
  assert.equal((await takeAndDrop(store, old, 'old-5', at(21, 42) + 30_000)).length, 4)
  const waiting = store.outbox().filter(one => one.state === 'waiting')
  assert.equal(waiting.length, 4, 'each dropped word waits again, as a new word')
  assert.ok(waiting.every(one => (one.tries ?? 0) === 0 && one.stoppedSession === 'old-5'), 'no try is spent')
  assert.deepEqual(store.outbox().filter(one => one.state === 'stopped').map(one => one.retriedAs).sort(), waiting.map(one => one.id).sort())
  // While the old session stays stopped it is handed nothing: every word would be dropped again.
  assert.deepEqual(await takeFor({ dir: null, outbox: store, state: old, now: at(21, 44), keep, chat: 'Worker 5' }), [])
  assert.deepEqual(stoppedOf(store.outbox(), old.chats[1]), { since: at(21, 42) + 30_000, words: 4 })
  // 21:46 the old chat is deleted, 21:47 a new Worker 5 joins with a new session: it takes all four, each with its age.
  const replaced = stateWith(lane('new-5', null))
  assert.equal(stoppedOf(store.outbox(), replaced.chats[1]), null)
  const handed = await takeFor({ dir: null, outbox: store, state: replaced, now: at(21, 47), keep, chat: 'Worker 5' })
  assert.deepEqual(handed.map(one => one.about).sort(), ['B522', 'B522', 'B567', 'B567'])
  assert.ok(handed.every(one => one.lateMs > 0))
  assert.match(messageText(handed.find(one => one.about === 'B567'), clock), /^work: B567 is yours; run work next\n\(this word waited for you: sent 5 min ago, at 21:42\)$/)
})

test('a turn begun after the stop (the main chat woke it by its session id) lets the words go to the same session', async () => {
  const store = outboxOf([work('B567', at(21, 42))])
  await takeAndDrop(store, stateWith(lane('w5')), 'w5', at(21, 42))
  assert.deepEqual(await takeFor({ dir: null, outbox: store, state: stateWith(lane('w5', at(21, 40))), now: at(21, 45), keep, chat: 'Worker 5' }), [])
  const woken = stateWith(lane('w5', at(21, 50)))
  assert.deepEqual((await takeFor({ dir: null, outbox: store, state: woken, now: at(21, 50), keep, chat: 'Worker 5' })).map(one => one.about), ['B567'])
})

test('another drop reason still spends its tries: three in all, then the word stays failed', async () => {
  const store = outboxOf([{ ...work('B9', at(20, 0)), command: 'refine', to: 'Worker 5' }])
  const state = stateWith(lane('w5'))
  for (let round = 0; round < 3; round += 1) {
    const now = at(20, 1 + 2 * round)
    await store.retryFailed(now, keep)
    const taken = await store.take('Worker 5', now, keep)
    assert.equal(taken.length, 1, `try ${round + 1} is handed out`)
    await store.settle('Worker 5', checkTyped({ chat: 'Worker 5', session: 'w5', typed: [], failed: [taken[0].id], why: { [taken[0].id]: 'the chat did not take it' } }, state), now + 1000)
  }
  await store.retryFailed(at(20, 10), keep)
  assert.deepEqual(store.outbox().map(one => [one.state, one.tries]), [['failed', 1], ['failed', 2], ['failed', 3]])
  assert.ok(store.outbox().every(one => one.stoppedAt === undefined && one.failedSession === 'w5'))
  assert.equal(isStoppedWhy('the chat did not take it'), false)
})

test('a replaced chat: the words that failed for its old session in the last day go to the new one at a refresh, with their age; one older than a day, a final one and one already retried do not', async () => {
  const failed = (id, when, more = {}) => ({ ...work(id, when), id, command: 'refine', state: 'failed', failedAt: when + MIN, tries: 3, why: 'the chat did not take it', failedSession: 'old-5', ...more })
  const store = outboxOf([failed('B1', at(21, 0)), failed('B2', at(21, 0) - 25 * HOUR), failed('B3', at(21, 0), { final: true }), failed('B4', at(21, 0), { retriedAs: 'x' }),
    failed('B5', at(21, 0), { failedSession: 'new-5' })])
  // The same session sees nothing come back.
  const same = outboxOf([failed('B1', at(21, 0))])
  await sweepOutbox({ dir: null, outbox: same, state: stateWith(lane('old-5')), now: at(21, 47), keep })
  assert.equal(same.outbox().filter(one => one.state === 'waiting').length, 0)
  await sweepOutbox({ dir: null, outbox: store, state: stateWith(lane('new-5')), now: at(21, 47), keep })
  const back = store.outbox().filter(one => one.state === 'waiting')
  assert.deepEqual(back.map(one => one.about), ['B1'])
  assert.equal(back[0].revivedFor, 'new-5')
  assert.equal(store.outbox().find(one => one.id === 'B1').retriedAs, back[0].id)
  const handed = await takeFor({ dir: null, outbox: store, state: stateWith(lane('new-5')), now: at(21, 48), keep, chat: 'Worker 5' })
  assert.equal(handed[0].lateMs, 48 * MIN)
  // A word whose purpose is gone is closed as any waiting word: a newer one of the same kind stands.
  const superseded = outboxOf([failed('B7', at(21, 0)), { ...work('B7', at(21, 30)), command: 'refine', id: 'newer', state: 'delivered' }])
  const closed = await sweepOutbox({ dir: null, outbox: superseded, state: stateWith(lane('new-5')), now: at(21, 47), keep })
  assert.equal(closed.length, 1)
  assert.match(closed[0].why, /^superseded/)
})

test('the main chat is asked once per stop to wake the chat, by its session id; the word is dropped once the chat is no longer stopped', async () => {
  const store = outboxOf([work('B567', at(21, 42))])
  const state = stateWith(lane('w5'))
  await takeAndDrop(store, state, 'w5', at(21, 42))
  const stopped = stoppedChats(store.outbox(), state)
  const wakes = wakesStopped(state, stopped, store.outbox(), clock)
  assert.equal(wakes.length, 1)
  assert.equal(wakes[0].to, 'Main')
  assert.equal(wakes[0].command, 'wake')
  assert.match(wakes[0].text, /^wake "Worker 5"\nIts turn was stopped at 21:42 .*1 word from the worker board waits?/)
  assert.match(wakes[0].text, /Its session id: local_w5\.$/)
  await store.say({ id: 'wake-1', at: at(21, 43), ...wakes[0], state: 'waiting' })
  assert.deepEqual(wakesStopped(state, stoppedChats(store.outbox(), state), store.outbox(), clock), [], 'once per stop')
  const ctx = more => ({ all: store.outbox(), items: null, runs: new Map(), goals: [], now: at(21, 50), keep, closing: new Map(), ...more })
  const wake = store.outbox().find(one => one.id === 'wake-1')
  assert.equal(whyClosed(wake, ctx({ stopped: stoppedChats(store.outbox(), state) })), null)
  const woken = stateWith(lane('w5', at(21, 49)))
  assert.deepEqual(whyClosed(wake, ctx({ stopped: stoppedChats(store.outbox(), woken) })), { state: 'dropped', why: 'Worker 5 is no longer stopped' })
  assert.equal(isStillStopped(store.outbox().find(one => one.state === 'waiting' && one.command === 'work'), woken.chats[1]), false)
})

test('the undelivered rule names a stopped chat once, with the main chat\'s wake, and not the dropped words that went again', async () => {
  const store = outboxOf([work('B522', at(21, 41), 'check'), work('B567', at(21, 42))])
  const state = stateWith(lane('w5'))
  await takeAndDrop(store, state, 'w5', at(21, 42))
  await store.say({ id: 'wake-1', at: at(21, 43), ...wakesStopped(state, stoppedChats(store.outbox(), state), store.outbox(), clock)[0], state: 'waiting' })
  const rule = WATCH_RULES.find(one => one.id === 'undelivered')
  // B589: the steps are still Worker 5's and open, so their lines still matter (workLines.mjs).
  const items = new Map([['B522', 'review'], ['B567', 'in progress']].map(([id, state]) => [id, { head: new Map([['Id', id], ['Kind', 'step'], ['State', state], ['Owner', 'Worker 5']]) }]))
  const view = { lanes: state.chats, partner: null, helper: null, supervisor: null, outbox: store.outbox(), items, goals: [], now: at(22, 0), keep, pause: null, settings: { undeliveredMinutes: 10 } }
  const found = rule.check(view)
  assert.equal(found.length, 2, 'Worker 5 once, and the main chat\'s wake word that waits')
  const mine = found.find(one => one.subject === 'Worker 5')
  assert.equal(mine.text, 'Worker 5 was stopped at 21:42: 2 words wait for it, the oldest for 19 min')
  assert.equal(mine.evidence, 'the main chat was asked to wake it at 21:43 (waiting)')
  assert.equal(mine.key, `undelivered Worker 5 stopped ${at(21, 42)}`)
})

test('a work line whose word was dropped as stopped is not sent a second time: the word that went again stands for it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'work-stopped-'))
  try {
    const store = memoryStore()
    const state = stateWith(lane('w5'))
    const send = now => sendOnce({ dir, key: 'B567 Worker 5 x', words: { to: 'Worker 5', ask: null, step: null, title: null, version: null, verdict: null, command: 'work', about: 'B567', text: 'work: B567 is yours; run work next' },
      outbox: store, state, now, maxChars: 2000, newId, keep })
    assert.notEqual(await send(at(21, 42)), null)
    await takeAndDrop(store, state, 'w5', at(21, 42))
    assert.equal(await send(at(21, 43)), null)
    assert.equal(store.outbox().filter(one => one.command === 'work').length, 2, 'the line and the word it went again as')
    // That word is what the line's "once more" goes by: once it fails for another reason, the line goes once more.
    const woken = stateWith(lane('w5', at(21, 50)))
    const [copy] = await takeFor({ dir: null, outbox: store, state: woken, now: at(21, 50), keep, chat: 'Worker 5' })
    await store.settle('Worker 5', checkTyped({ chat: 'Worker 5', session: 'w5', typed: [], failed: [copy.id], why: { [copy.id]: 'the chat did not take it' } }, woken), at(21, 50))
    assert.notEqual(await send(at(21, 51)), null)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
