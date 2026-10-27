// T9.1.1: at go-live the Advisor may still hold the board's old words for a result check ("check step", and the sync check's
// "unchecked" wake). A result check is a Quality Assurance task now: once the step has one, or left review, the sweep closes
// the word with that why, so the Advisor does not check what a worker checks, and the Advisor's own `work checked` on the step
// is refused with a line naming the task. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { whyClosed } from '../../src/work/outboxSweep.mjs'
import { workLineWhy } from '../../src/work/workLines.mjs'
import { fresh, qaOf, remove, reported } from '../qaKit.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 27, 18, 0).getTime()
const keep = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN }
const item = (id, head, extra = {}) => [id, { head: new Map(Object.entries({ Id: id, Kind: 'step', ...head })), sections: new Map(), ...extra }]
const word = fields => ({ id: 'w1', at: NOW - 5 * MIN, to: 'Partner', ask: null, step: null, title: null, version: null, verdict: null, state: 'waiting', text: 'check step', command: 'result-check', about: 'B701', ...fields })
const ctxOf = items => ({ all: [], items: new Map(items), runs: new Map(), goals: [], now: NOW, keep, closing: new Map() })

test('an old "check step" word is closed once its step has an open QA task, or is no longer in review; else it still waits', () => {
  const review = item('B701', { State: 'review' })
  const task = state => item('B730', { State: state, Checks: 'B701', Title: 'Quality Assurance: B701 x' })
  // No task yet (the repair makes it within the minute): the word still stands.
  assert.equal(whyClosed(word(), ctxOf([review])), null)
  for (const state of ['refined', 'queued', 'taken', 'in progress']) {
    assert.deepEqual(whyClosed(word(), ctxOf([review, task(state)])), { state: 'dropped', why: 'B701 has its QA task B730: a worker checks it, not the Advisor' }, state)
  }
  // A done or dropped task is no open one.
  assert.equal(whyClosed(word(), ctxOf([review, task('done')])), null)
  // The step left review: as before.
  assert.deepEqual(whyClosed(word(), ctxOf([item('B701', { State: 'done' })])), { state: 'dropped', why: 'the step is done now, not in review' })
  assert.deepEqual(whyClosed(word(), ctxOf([])), { state: 'dropped', why: 'the step is gone' })
})

test('the sync check\'s old "unchecked" wake is closed the same way: its step has an open QA task, or left review', () => {
  const sync = { id: 's1', at: NOW - 5 * MIN, to: 'Partner', kind: 'sync', syncKey: 'unchecked B701 1', command: 'work', about: 'B701', state: 'waiting', text: 'check step B701' }
  const items = (...all) => new Map(all)
  const review = item('B701', { State: 'review' })
  assert.equal(workLineWhy(sync, items(review), { now: NOW }), null)
  assert.equal(workLineWhy(sync, items(review, item('B730', { State: 'queued', Checks: 'B701' })), { now: NOW }), 'B701 has its QA task B730')
  assert.equal(workLineWhy(sync, items(item('B701', { State: 'in progress' })), { now: NOW }), 'B701 left review')
  assert.equal(workLineWhy(sync, items(item('B701', { State: 'done' })), { now: NOW }), 'B701 is done')
  // Another sync word about a step in review is not touched by the QA task.
  assert.equal(workLineWhy({ ...sync, syncKey: 'not-taken B701 1' }, items(review, item('B730', { State: 'queued', Checks: 'B701' })), { now: NOW }), "B701 is no longer Partner's")
})

test('the Advisor\'s own work checked on a step is refused, naming the QA task and its worker', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    const qa = await qaOf(store, id)
    const refused = await store.partner({ action: 'checked', id, evidence: 'x.png', points: ['pass: a lamp at every bench', 'pass: warm yellow light, never white'] })
    assert.deepEqual([refused.ok, refused.status], [false, 403])
    assert.equal(refused.why, `${id} is checked by its QA task ${qa} (not given yet): only its worker files the check.`)
  } finally {
    await remove(store.dir)
  }
})
