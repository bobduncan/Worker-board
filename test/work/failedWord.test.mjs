// B571 (the fix of X1): a word that failed and is not tried again was never judged by the outbox sweep (it judged only
// the words that waited), and the health summary marked every failed word of the day "!" while rule 8 looked back two
// hours, so the supervisor's sweep reopened X1 again and again. A failed word whose purpose is gone is closed now with
// its why, and the summary and rule 8 name the same words. Made-up samples in the shape of the board's outbox.

import assert from 'node:assert/strict'
import test from 'node:test'

import { memoryStore } from '../../src/store.mjs'
import { healthSummary } from '../../src/supervisor/health.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { sweepOutbox } from '../../src/work/outboxSweep.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = new Date(2026, 9, 24, 21, 15).getTime()
const at = (h, m) => new Date(2026, 9, 24, h, m).getTime()
const keep = { messageMs: 10 * MIN, answerMs: 48 * HOUR }

const LANES = [
  { name: 'Lead', isMain: true, isLeftover: false, state: 'working', isRunning: true, queue: [] },
  { name: 'Advisor', isMain: false, isLeftover: false, state: 'free', isRunning: true, queue: [] },
]
const G15 = { id: 'G15', state: 'open', evaluatedAt: ['2026-10-24 16:06', '2026-10-24 19:50'] }

// X1's word: sent at 14:31, failed before B532 kept a failure's time or why, so it was never tried again.
const x1 = () => ({ id: 'e426', at: at(14, 31), to: 'Advisor', ask: null, command: 'evaluate', about: 'G15', text: 'evaluate G15 Board easier day to day', state: 'failed' })
// A word that still matters: a refine of a step that is new, failed three times 30 minutes ago.
const refine = () => ({ id: 'r7', at: NOW - 40 * MIN, to: 'Advisor', ask: null, command: 'refine', about: 'B7', text: 'refine step\nStep: B7', state: 'failed', failedAt: NOW - 30 * MIN, tries: 3, why: 'the chat was busy' })

const outboxOf = words => {
  const store = memoryStore()
  for (const one of words) store.outbox().push({ ...one })
  return store
}
const steps = new Map([['B7', { head: new Map([['Id', 'B7'], ['Kind', 'step'], ['State', 'new'], ['Title', 'Step B7']]), sections: new Map() }]])
const viewOf = (outbox, now = NOW) => buildView({ state: { chats: LANES, chatPrefix: '', goals: { nodes: [G15] } }, items: steps, outbox, keep, now })
const undelivered = view => WATCH_RULES.find(one => one.id === 'undelivered').check(view, { seen: new Map(), observed: [] })
const wordsPart = text => text.slice(text.indexOf('Words not delivered:'), text.indexOf('Limits and pause:'))

test('X1: the failed evaluate G15 word of 14:31 is closed dropped by the sweep, named by the first evaluation after it', async () => {
  const store = outboxOf([x1()])
  const closed = await sweepOutbox({ dir: null, outbox: store, state: { chats: LANES, goals: { nodes: [G15] } }, now: NOW, keep })
  assert.deepEqual(closed, [{ id: 'e426', state: 'dropped', why: 'G15 was evaluated (2026-10-24 16:06)' }])
  const word = store.outbox().find(one => one.id === 'e426')
  assert.equal(word.state, 'dropped')
  assert.equal(word.why, 'G15 was evaluated (2026-10-24 16:06)')
})

test('X1: before the sweep closes it, the health summary does not list the word and rule 8 is silent', () => {
  const view = viewOf([x1()])
  assert.deepEqual(undelivered(view), [])
  assert.doesNotMatch(wordsPart(healthSummary(view, NOW)), /evaluate G15/)
  // Once G15 was not evaluated since, the same word is the summary's (without "!": it is over two hours old) and not
  // the rule's: neither says "!" on it.
  const open = buildView({ state: { chats: LANES, chatPrefix: '', goals: { nodes: [{ ...G15, evaluatedAt: [] }] } }, items: steps, outbox: [x1()], keep, now: NOW })
  assert.match(wordsPart(healthSummary(open, NOW)), /^- 14:31 evaluate G15 to Advisor: failed for 6 h 44 min$/m)
  assert.deepEqual(undelivered(open), [])
  // Within rule 8's two hours too: at 16:20 the word failed under two hours ago, but G15 was evaluated at 16:06.
  const soon = viewOf([x1()], at(16, 20))
  assert.deepEqual(undelivered(soon), [])
  assert.doesNotMatch(wordsPart(healthSummary(soon, at(16, 20))), /evaluate G15/)
})

test('a failed word that still matters, under two hours: the sweep keeps it, the summary marks it "!" and rule 8 names it', async () => {
  const store = outboxOf([refine()])
  const closed = await sweepOutbox({ dir: null, outbox: store, state: { chats: LANES }, now: NOW, keep })
  assert.deepEqual(closed, [])
  assert.equal(store.outbox().find(one => one.id === 'r7').state, 'failed')
  const view = viewOf([refine()])
  assert.match(wordsPart(healthSummary(view, NOW)), /^- ! 20:35 refine B7 to Advisor: failed for 40 min$/m)
  const found = undelivered(view)
  assert.deepEqual(found.map(one => [one.key, one.evidence]), [['undelivered Advisor', '20:35 refine B7 (failed: the chat was busy)']])
  // Three hours later the rule no longer names it, and the summary drops its "!" with it.
  const later = viewOf([refine()], NOW + 3 * HOUR)
  assert.deepEqual(undelivered(later), [])
  assert.match(wordsPart(healthSummary(later, NOW + 3 * HOUR)), /^- 2026-10-24 20:35 refine B7 to Advisor: failed for 3 h 40 min$/m)
})

test('a failed word tried again is listed by the word that stands for it, not twice', () => {
  const first = { ...refine(), retriedAs: 'r8' }
  const again = { ...refine(), id: 'r8', state: 'waiting', retryOf: 'r7', at: NOW - 40 * MIN }
  const text = wordsPart(healthSummary(viewOf([first, again]), NOW))
  assert.equal(text.match(/refine B7/g)?.length, 1)
  assert.match(text, /refine B7 to Advisor: waiting/)
})

test('the sweep never closes a failed person\'s answer or a failed word whose purpose holds; a word tried again is left to its retry', async () => {
  const answer = { id: 'a1', at: at(14, 0), to: 'Advisor', ask: 'Q9', step: 'B7', text: 'A', state: 'failed' }
  const tried = { ...x1(), id: 'e427', retriedAs: 'e428' }
  const store = outboxOf([answer, tried, refine()])
  const closed = await sweepOutbox({ dir: null, outbox: store, state: { chats: LANES, goals: { nodes: [G15] } }, now: NOW, keep })
  assert.deepEqual(closed, [])
  assert.deepEqual(['a1', 'e427', 'r7'].map(id => store.outbox().find(one => one.id === id).state), ['failed', 'failed', 'failed'])
})

test('roles/supervisor.md: an incident listed fixed comes back only on a line marked "!"', async () => {
  const { readFile } = await import('node:fs/promises')
  const role = await readFile(new URL('../../roles/supervisor.md', import.meta.url), 'utf8')
  assert.match(role.replace(/\s+/g, ' '), /An incident the summary lists as fixed comes back only on a line marked `!`/)
})
