// B739 (X91): Worker 1 reported B720 at 21:39 and ended its turn with background work still running; its clear was refused
// (409) and its next step held, and nothing told the worker at the moment it counts. The board now types it one line, once
// per report: `B720 is reported; your background work still runs: stop it or wait for it, then end your turn`
// (src/say.mjs `reportedBackgroundDue`). Made-up chats only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { messageText } from '../src/bridge.mjs'
import { clearOwed } from '../src/clearOwed.mjs'
import { reportedBackgroundDue, reportedBackgroundWords, waitsLong } from '../src/say.mjs'
import { parseItem } from '../src/work/item.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 27, 21, 45).getTime()
const REPORTED_AT = new Date(2026, 9, 27, 21, 39).getTime()

/** A worker lane as the state gives it, with a clear owed for B720 (its Workers mod can clear) and background work running. */
const lane = (more = {}) => ({
  name: 'Worker 1', isMain: false, isLeftover: false, state: 'free', isRunning: true, isTurnOpen: false, background: 1,
  clearOwed: { step: 'B720', reportedAt: REPORTED_AT, clearedAt: null, why: null, isDropped: false, canClear: true }, ...more,
})
const board = (workers, more = {}) => ({ restart: { main: 'Main' }, chats: [{ name: 'Main', isMain: true }, ...workers], pause: { state: 'running', since: NOW - 5 * 60 * MIN }, ...more })
const LINE = 'B720 is reported; your background work still runs: stop it or wait for it, then end your turn'

test('Worker 1\'s case: the turn ended after the report of B720 with background work running → one line to Worker 1', () => {
  const [one, ...more] = reportedBackgroundDue(board([lane()]), [])
  assert.deepEqual(more, [])
  assert.equal(one.to, 'Worker 1')
  assert.equal(one.command, 'report-background')
  assert.equal(one.about, 'B720')
  assert.equal(one.reportedAt, REPORTED_AT)
  assert.equal(one.text, LINE)
  // Typed as the board's own word, not the person's.
  assert.equal(messageText(one, () => '21:45'), LINE)
  // It goes to a running worker whose turn has ended; it is no partner word and does not wait for ever.
  assert.equal(waitsLong(one.command), false)
})

test('no line without background work, with the turn still open, with nothing owed, for a dropped step or an old mod', () => {
  assert.deepEqual(reportedBackgroundDue(board([lane({ background: 0 })]), []), [])
  assert.deepEqual(reportedBackgroundDue(board([lane({ isTurnOpen: true })]), []), [])
  assert.deepEqual(reportedBackgroundDue(board([lane({ clearOwed: null })]), []), [])
  assert.deepEqual(reportedBackgroundDue(board([lane({ clearOwed: { ...lane().clearOwed, isDropped: true } })]), []), [])
  assert.deepEqual(reportedBackgroundDue(board([lane({ clearOwed: { ...lane().clearOwed, canClear: false } })]), []), [])
  assert.deepEqual(reportedBackgroundDue(board([lane({ isRunning: false })]), []), [])
  assert.deepEqual(reportedBackgroundDue(board([{ ...lane(), isMain: true }, { ...lane({ name: 'Old fork' }), isLeftover: true }]), []), [])
})

test('a second idle tick with the same report gives no second line; a report again does', () => {
  const [first] = reportedBackgroundDue(board([lane()]), [])
  // Whatever became of the first word (waiting, taken, expired): it was told.
  for (const state of ['waiting', 'taken', 'expired']) assert.deepEqual(reportedBackgroundDue(board([lane()]), [{ ...first, state }]), [])
  const again = lane({ clearOwed: { ...lane().clearOwed, reportedAt: NOW - MIN } })
  assert.equal(reportedBackgroundDue(board([again]), [first]).length, 1)
  // Another step of the same worker is another report.
  const other = lane({ clearOwed: { ...lane().clearOwed, step: 'B721' } })
  assert.equal(reportedBackgroundDue(board([other]), [first])[0].text, LINE.replace('B720', 'B721'))
})

test('the person\'s pause holds the line', () => {
  assert.deepEqual(reportedBackgroundDue(board([lane()], { pause: { state: 'pausing', since: NOW - MIN } }), []), [])
})

test('the state\'s clear owed names a dropped step; a failed report is none', () => {
  const step = (id, state, history) => parseItem(['Id: ' + id, 'Kind: step', 'Title: Fix', 'State: ' + state, 'Owner: Worker 1', 'Activity: Board', '', '## History', ...history, ''].join('\n'))
  const stamp = ms => { const d = new Date(ms); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}` }
  const history = [`- ${stamp(REPORTED_AT)} Worker 1: in progress → review`]
  const owed = state => clearOwed({ lane: { name: 'Worker 1', compaction: null }, items: [step('B720', state, history)], afterStep: 'clear' })
  assert.notEqual(owed('review').isDropped, true)
  assert.equal(owed('dropped').isDropped, true)
  assert.equal(owed('review').step, 'B720')
})

test('the words are the same for the same report', () => {
  assert.deepEqual(reportedBackgroundWords('Worker 1', 'B720', REPORTED_AT), reportedBackgroundWords('Worker 1', 'B720', REPORTED_AT))
})
