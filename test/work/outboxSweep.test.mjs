// B532: words the board sends to a chat that is busy or not running reach it when it comes free, with their age;
// words that no longer matter are closed with their reason; a word the chat could not type goes again, three times at
// most, unless the Workers mod refused it for good; a person's answer is never closed. Each test fails without its rule.
// Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { checkTyped, fitsMod, messageText } from '../../src/bridge.mjs'
import { memoryStore, outboxNow } from '../../src/store.mjs'
import { sweepOutbox, whyClosed } from '../../src/work/outboxSweep.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = new Date(2026, 9, 24, 18, 0).getTime()
const keep = { messageMs: 10 * MIN, answerMs: 48 * HOUR }
const clock = ms => { const at = new Date(ms); return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` }

let next = 0
const word = (fields) => ({ id: `w${(next += 1)}`, at: NOW - 5 * MIN, to: 'Partner', ask: null, step: null, title: null, version: null, verdict: null, state: 'waiting', text: 'a word', ...fields })
const item = (id, state) => [id, { head: new Map([['Id', id], ['State', state]]) }]

/** A store in memory that holds `words`, as the board's file would after a start. */
function outboxOf(words) {
  const store = memoryStore()
  for (const one of words) store.outbox().push({ ...one })
  return store
}
const stateOf = (store, id) => store.outbox().find(one => one.id === id)
const ctxOf = (all, more = {}) => ({ all, items: new Map(), runs: new Map(), goals: [], now: NOW, keep, closing: new Map(), ...more })

test('cause: a partner word hours old is still handed out, with its age; B548: so is a line typed to a chat; an order is not', async () => {
  const late = word({ command: 'refine', about: 'B1', at: NOW - 3 * HOUR, text: 'refine step\nStep: B1 Plant the hedge' })
  const typed = word({ command: null, at: NOW - 30 * MIN, text: 'look at the hedge' })
  const fresh = word({ command: 'result-check', about: 'B2', at: NOW - 2 * MIN })
  const order = word({ command: 'clear', at: NOW - 30 * MIN, text: '/clear' })
  const store = outboxOf([late, typed, fresh, order])
  const taken = await store.take('Partner', NOW, keep)
  assert.deepEqual(taken.map(one => one.id).sort(), [late.id, typed.id, fresh.id].sort())
  assert.equal(taken.find(one => one.id === typed.id).lateMs, 30 * MIN)
  const handed = taken.find(one => one.id === late.id)
  assert.equal(handed.lateMs, 3 * HOUR)
  assert.equal(taken.find(one => one.id === fresh.id).lateMs, undefined, 'a word of minutes goes as it is')
  // Its first line stays the board's own (a chat reads its command there); the age goes under it.
  const text = messageText(handed, clock)
  assert.equal(text.split('\n')[0], 'refine step')
  assert.match(text, /this word waited for you: sent 3 hours ago, at 15:00/)
  assert.equal(stateOf(store, order.id).state, 'waiting')
})

test('a round of the board\'s clock waits for a busy partner too, and a newer round of the same kind replaces it', async () => {
  const weekly = word({ command: 'round', round: 'weekly', at: NOW - 20 * HOUR, text: 'Round from the board\'s clock: weekly\nYour job: x' })
  const morning = word({ command: 'round', round: 'morning', at: NOW - 30 * HOUR, text: 'Round from the board\'s clock: morning\nYour job: x' })
  const morning2 = word({ command: 'round', round: 'morning', at: NOW - 6 * HOUR, text: 'Round from the board\'s clock: morning\nYour job: x', state: 'delivered' })
  const all = [weekly, morning, morning2]
  assert.equal(whyClosed(weekly, ctxOf(all)), null, 'the weekly round still matters')
  assert.deepEqual(whyClosed(morning, ctxOf(all)), { state: 'dropped', why: `superseded by a newer word of the same kind (2026-10-24 12:00)` })
  const store = outboxOf([weekly])
  assert.deepEqual((await store.take('Partner', NOW, keep)).map(one => one.id), [weekly.id])
})

test('superseded: of three refine words for one step the newest stays; another step\'s word is not touched', async () => {
  const words = [word({ command: 'refine', about: 'B7', at: NOW - 40 * MIN }), word({ command: 'refine', about: 'B7', at: NOW - 20 * MIN }),
    word({ command: 'refine', about: 'B7', at: NOW - 5 * MIN }), word({ command: 'refine', about: 'B8', at: NOW - 40 * MIN })]
  const store = outboxOf(words)
  const closed = await sweepOutbox({ dir: null, outbox: store, state: {}, now: NOW, keep })
  assert.deepEqual(closed.map(one => one.id), [words[0].id, words[1].id])
  assert.ok(closed.every(one => one.state === 'dropped' && one.why.startsWith('superseded')))
  assert.equal(stateOf(store, words[0].id).why, closed[0].why, 'the reason is written down with the word')
  assert.equal(stateOf(store, words[0].id).closedAt, NOW)
  assert.deepEqual([words[2], words[3]].map(one => stateOf(store, one.id).state), ['waiting', 'waiting'])
})

test('a refine word for a step no longer new, and a check word for a step out of review, are closed with the step\'s state', () => {
  const items = new Map([item('B1', 'queued'), item('B2', 'new'), item('B3', 'refined'), item('B4', 'review'), item('B5', 'done')])
  const words = [word({ command: 'refine', about: 'B1' }), word({ command: 'refine', about: 'B2' }), word({ command: 'refine', about: 'B3', round: 2 }),
    word({ command: 'refine', about: 'B3', round: 1, at: NOW - 6 * MIN }), word({ command: 'result-check', about: 'B4' }), word({ command: 'result-check', about: 'B5' }),
    word({ command: 'result-check', about: 'B9' })]
  const said = words.map(one => whyClosed(one, ctxOf(words.filter(other => other === one), { items }))?.why ?? null)
  assert.deepEqual(said, ['the step is queued now, not new', null, null, 'the step is refined now, not new', null, 'the step is done now, not in review', 'the step is gone'])
  // Without a work store the board cannot judge a step: the word waits.
  assert.equal(whyClosed(words[0], ctxOf([words[0]], { items: null })), null)
})

test('an evaluate word is closed once its goal was evaluated after it, or is done; before that it waits', () => {
  const ask = word({ command: 'evaluate', about: 'G15', at: new Date(2026, 9, 24, 14, 31).getTime() })
  const goals = when => [{ id: 'G15', state: 'open', evaluatedAt: when }]
  assert.equal(whyClosed(ask, ctxOf([ask], { goals: goals(['2026-10-20 10:00']) })), null, 'an evaluation of before does not count')
  assert.deepEqual(whyClosed(ask, ctxOf([ask], { goals: goals(['2026-10-20 10:00', '2026-10-24 16:05']) })), { state: 'dropped', why: 'G15 was evaluated (2026-10-24 16:05)' })
  assert.deepEqual(whyClosed(ask, ctxOf([ask], { goals: [{ id: 'G15', state: 'done', evaluatedAt: [] }] })), { state: 'dropped', why: 'G15 is done' })
})

test('the main chat\'s start of a closed chat: closed once that chat runs or nothing waits for it, else it waits', async () => {
  const start = word({ to: 'Lead', command: 'start', about: 'Partner', at: NOW - 3 * HOUR })
  const stale = word({ command: 'refine', about: 'B1', at: NOW - 3 * HOUR })
  const newer = word({ command: 'refine', about: 'B1', at: NOW - 1 * HOUR, state: 'delivered' })
  // Its only word is superseded in the same sweep: nothing waits for the partner any more.
  const store = outboxOf([start, stale, newer])
  const closed = await sweepOutbox({ dir: null, outbox: store, state: { chats: [{ name: 'Partner', isRunning: false }] }, now: NOW, keep })
  assert.deepEqual(closed.map(one => [one.id, one.why]), [[stale.id, 'superseded by a newer word of the same kind (2026-10-24 17:00)'], [start.id, 'nothing waits for Partner any more']])
  const waits = word({ command: 'result-check', about: 'B2' })
  const all = [start, waits]
  assert.equal(whyClosed(start, ctxOf(all, { runs: new Map([['Partner', false]]) })), null)
  assert.deepEqual(whyClosed(start, ctxOf(all, { runs: new Map([['Partner', true]]) })), { state: 'dropped', why: 'Partner runs now' })
})

test('expired: a partner word and B548 a resume after 48 hours, each with its why; a person\'s answer never', async () => {
  const old = word({ command: 'plan-tradeoffs', about: 'plan', at: NOW - 50 * HOUR })
  const resume = word({ to: 'Lead', command: 'resume', at: NOW - 49 * HOUR })
  const fresh = word({ to: 'Lead', command: 'resume', at: NOW - 15 * MIN })
  const typed = word({ to: 'Lead', command: null, at: NOW - 47 * HOUR })
  const answer = word({ to: 'Digger', ask: 'work:Q3', step: 'Q3', title: 'Merge it?', at: NOW - 5 * 24 * HOUR })
  const workLine = word({ to: 'Digger', command: 'work', about: 'B3', at: NOW - 5 * 24 * HOUR })
  const store = outboxOf([old, resume, fresh, typed, answer, workLine])
  const closed = await sweepOutbox({ dir: null, outbox: store, state: { chats: [{ name: 'Digger', isRunning: false }] }, now: NOW, keep })
  assert.deepEqual(closed.map(one => [one.id, one.state, one.why]), [[old.id, 'expired', 'waited longer than 48 hours'], [resume.id, 'expired', 'waited longer than 48 hours']])
  assert.deepEqual([fresh, typed].map(one => stateOf(store, one.id).state), ['waiting', 'waiting'], 'a resume of 15 minutes and a line of 47 hours still wait')
  assert.equal(stateOf(store, answer.id).state, 'waiting', 'an answer waits for its chat, also one that is off')
  assert.equal(stateOf(store, workLine.id).state, 'waiting', 'a work line is the work store\'s to judge')
  // The page lists what was closed, with its why, for 12 hours after it was closed.
  const shown = outboxNow(store.outbox(), NOW + HOUR, keep).map(one => one.id)
  assert.ok(shown.includes(old.id) && shown.includes(resume.id))
  assert.ok(!outboxNow(store.outbox(), NOW + 13 * HOUR, keep).some(one => one.id === old.id))
})

test('a word the chat could not type goes again after a minute as a new word, three tries in all; a refused one never', async () => {
  const store = memoryStore()
  let id = 0
  const newId = () => `again${(id += 1)}`
  const failing = word({ command: 'refine', about: 'B1', at: NOW - 3 * MIN, state: 'taken' })
  const tooLong = word({ command: 'evaluate', about: 'G1', at: NOW - 3 * MIN, state: 'taken' })
  const workLine = word({ command: 'work', about: 'B2', at: NOW - 3 * MIN, state: 'taken' })
  store.outbox().push(failing, tooLong, workLine)
  await store.settle('Partner', { failed: [failing.id, workLine.id], refused: [tooLong.id], why: { [failing.id]: 'a hook dropped it', [tooLong.id]: 'too long: 9459 > 3000 characters' } }, NOW - 2 * MIN)
  assert.deepEqual([failing, tooLong].map(one => [one.state, one.why, one.final ?? false]), [['failed', 'a hook dropped it', false], ['failed', 'too long: 9459 > 3000 characters', true]])
  assert.deepEqual(await store.retryFailed(NOW - 90_000, keep, { newId }), [], 'not within the minute')
  assert.deepEqual(await store.retryFailed(NOW, keep, { newId }), ['again1'])
  const copy = stateOf(store, 'again1')
  assert.deepEqual([copy.state, copy.retryOf, copy.at, copy.tries, failing.retriedAs], ['waiting', failing.id, failing.at, 1, 'again1'])
  assert.deepEqual(await store.retryFailed(NOW + 5 * MIN, keep, { newId }), [], 'the failed one goes again once')
  // Twice more it fails: then it stays failed.
  for (const at of [NOW + 10 * MIN, NOW + 20 * MIN]) {
    const now = stateOf(store, `again${id}`)
    await store.take('Partner', at, keep)
    await store.settle('Partner', { failed: [now.id] }, at)
    await store.retryFailed(at + 2 * MIN, keep, { newId })
  }
  assert.equal(id, 2, 'three tries in all')
  assert.equal(stateOf(store, 'again2').state, 'failed')
})

test('the mod\'s report is read with its why and what it refused; a word over the mod\'s limit is never handed out', () => {
  const state = { chats: [{ name: 'Partner', session: 's1' }] }
  const body = { chat: 'Partner', session: 's1', typed: ['a'], failed: ['b'], refused: ['c'], why: { b: ' a hook\n dropped it ', c: 'too long', d: 'not reported' } }
  const checked = checkTyped(body, state)
  assert.equal(checked.ok, true)
  assert.deepEqual([checked.failed, checked.refused, checked.why], [['b'], ['c'], { b: 'a hook dropped it', c: 'too long' }])
  const fit = fitsMod([{ id: 'a', text: 'short' }, { id: 'b', text: 'x'.repeat(3001) }])
  assert.deepEqual(fit, { messages: [{ id: 'a', text: 'short' }], refused: ['b'], why: { b: 'too long: 3001 > 3000 characters' } })
})
