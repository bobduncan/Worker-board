// B547 (X13, X14): every reported step ends in a cleared chat. The board keeps the account (src/clearOwed.mjs): a worker
// whose last report is newer than its last clear owes one; while it does, its next step's line waits and, once it is
// idle, its Workers mod is named the clear. Made-up chats and steps only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { CLEAR_GRACE_MS, clearAtTake, clearOwed, isStepLine, lastReportOf, modAtLeast, takenSince, takeRefusal } from '../src/clearOwed.mjs'
import { parseList } from '../src/appChats.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { workWords } from '../src/say.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 24, 19, 0).getTime()
const ago = minutes => NOW - minutes * MIN
const item = (head, history) => ({ head: new Map(Object.entries({ Kind: 'step', ...head })), sections: new Map([['History', history]]) })
const line = (minutes, who, what) => `- ${stamp(ago(minutes))} ${who}: ${what}`
const items = new Map([
  ['B10', item({ Id: 'B10', State: 'done', Owner: 'Painter' }, [line(120, 'Painter', 'in progress → review'), line(110, 'server', 'review → done')])],
  ['B12', item({ Id: 'B12', State: 'done', Owner: 'Painter' }, [line(60, 'Painter', 'queued → taken'), line(30, 'Painter', 'in progress → review')])],
  // Reported by another chat, then handed to Painter: Painter's report is the line that counts, not its Owner.
  ['B14', item({ Id: 'B14', State: 'queued', Owner: 'Painter' }, [line(10, 'Weeder', 'in progress → review'), line(5, 'Lead', 'queued for Painter')])],
  ['N3', item({ Id: 'N3', Kind: 'note' }, [line(1, 'Painter', 'in progress → review')])],
])
const lane = (compaction, more = {}) => ({ name: 'Painter', isMain: false, isLeftover: false, state: 'free', compaction, ...more })

test('the list of chats says whether a worker is cleared after each step', () => {
  assert.equal(parseList('{"prefix":"Game - ","main":"Main","afterStep":"clear"}').afterStep, 'clear')
  assert.equal(parseList('{"prefix":"Game - ","main":"Main"}').afterStep, undefined)
  assert.equal(parseList('{"prefix":"Game - ","main":"Main","afterStep":"compact"}').afterStep, undefined)
})

test('a chat\'s last report is the newest move to review it wrote itself, to the minute; a "reported again" counts', () => {
  assert.deepEqual(lastReportOf(items, 'Painter'), { id: 'B12', at: ago(30) })
  assert.deepEqual(lastReportOf(items, 'Game - Painter', 'Game - '), { id: 'B12', at: ago(30) })
  assert.deepEqual(lastReportOf(items, 'Weeder'), { id: 'B14', at: ago(10) })
  assert.equal(lastReportOf(items, 'Lead'), null)
  const again = new Map([...items, ['B15', item({ Id: 'B15', State: 'review' }, [line(2, 'Painter', 'reported again')])]])
  assert.deepEqual(lastReportOf(again, 'Painter'), { id: 'B15', at: ago(2) })
  assert.deepEqual(takenSince(items, 'Painter', ago(90)), [{ id: 'B12', at: ago(60) }])
  assert.deepEqual(takenSince(items, 'Painter', ago(30)), [])
})

test('a clear is owed when the last report is newer than the last clear, with the mod\'s why when it came after the report', () => {
  const owed = compaction => clearOwed({ lane: lane(compaction), items, afterStep: 'clear' })
  // Cleared after B10 only: B12 is owed; no word why.
  assert.deepEqual(owed({ kind: 'cleared', at: ago(100), step: 'B10', lastCleared: { at: ago(100), step: 'B10' } }), { step: 'B12', reportedAt: ago(30), clearedAt: ago(100), why: null })
  // Never cleared: owed, with no clear known.
  assert.deepEqual(owed(null), { step: 'B12', reportedAt: ago(30), clearedAt: null, why: null })
  // The mod said why it did not clear after the report (Worker 2's 409); an older word is not this report's.
  const refused = { at: ago(29), why: 'its conversation could not be saved as a log (HTTP 409)' }
  assert.equal(owed({ kind: 'not-cleared', ...refused, notCleared: refused, lastCleared: { at: ago(100), step: 'B10' } }).why, refused.why)
  assert.equal(owed({ kind: 'not-cleared', at: ago(31), why: 'older', notCleared: { at: ago(31), why: 'older' } }).why, null)
  // Cleared after the report: nothing owed; a compaction is no clear.
  assert.equal(owed({ kind: 'cleared', at: ago(29), step: 'B12', lastCleared: { at: ago(29), step: 'B12' } }), null)
  assert.notEqual(owed({ kind: 'compacted', at: ago(29), before: 1, after: 2 }), null)
  // Not without "afterStep": "clear", nor for the main chat, a leftover, or a chat that never reported.
  assert.equal(clearOwed({ lane: lane(null), items, afterStep: null }), null)
  assert.equal(clearOwed({ lane: lane(null, { isMain: true }), items, afterStep: 'clear' }), null)
  assert.equal(clearOwed({ lane: lane(null, { isLeftover: true }), items, afterStep: 'clear' }), null)
  assert.equal(clearOwed({ lane: lane(null, { name: 'Lead' }), items, afterStep: 'clear' }), null)
})

test('at a take: the next step\'s line waits while a clear is owed; the clear is named once the chat is idle, after the grace', () => {
  const owed = { step: 'B12', reportedAt: ago(30), clearedAt: ago(100), why: null }
  const at = more => clearAtTake({ owed, mod: '0.17.0', now: NOW, isIdle: true, ...more })
  assert.deepEqual(at({}), { hold: true, clear: { step: 'B12', reportedAt: ago(30) }, why: 'not cleared after B12 yet: its Workers mod clears it now' })
  assert.deepEqual(at({ background: 1 }), { hold: true, clear: null, why: 'not cleared after B12 yet: background work it started still runs' })
  assert.deepEqual(at({ isIdle: false }).clear, null)
  assert.deepEqual(at({ isPaused: true }).clear, null)
  // Right after the report the mod's own clear goes first: held, not named.
  assert.deepEqual(clearAtTake({ owed: { ...owed, reportedAt: NOW - CLEAR_GRACE_MS + 1000 }, mod: '0.17.0', now: NOW, isIdle: true }).clear, null)
  // Nothing owed, or a mod older than 0.17.0 (it could not clear): nothing held, nothing named.
  assert.deepEqual(clearAtTake({ owed: null, mod: '0.17.0', now: NOW, isIdle: true }), { hold: false, clear: null, why: null })
  for (const mod of ['0.16.1', null, 'x']) assert.deepEqual(clearAtTake({ owed, mod, now: NOW, isIdle: true }), { hold: false, clear: null, why: null })
  assert.equal(modAtLeast('0.17.0'), true)
  assert.equal(modAtLeast('0.17.1'), true)
  assert.equal(modAtLeast('1.0'), true)
  assert.equal(modAtLeast('0.16.9'), false)
  assert.match(takeRefusal(owed), /^Not yet: this chat is cleared after B12 first/)
})

test('only the line that a step is the chat\'s waits for the clear: no note line, no answer of the person\'s', () => {
  assert.equal(isStepLine({ ...workWords('Painter', 'B13'), id: 'm1' }), true)
  assert.equal(isStepLine({ ...workWords('Lead', 'N4', 'work: note N4 for you; run work next'), id: 'm2' }), false)
  assert.equal(isStepLine({ to: 'Painter', command: null, ask: 'Q3', text: 'yes' }), false)
  assert.equal(isStepLine({ ...workWords('Painter', 'B13', 'work: B13 is yours to answer for the person; run work next'), id: 'm3' }), false)
})
