import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { DEFAULT_FLOW, mayMove, nextMoves, parseFlow, statesOf } from '../../src/work/flow.mjs'
import { GUARDS } from '../../src/work/guards.mjs'
import { parseItem } from '../../src/work/item.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const item = text => parseItem(text)
const step = (state, extra = '') => item(`Id: B285\nKind: step\nTitle: Draw the strip\nState: ${state}\nSince: -\n${extra}`)
const storeOf = (...items) => ({ items: new Map(items.map(one => [one.head.get('Id'), one])) })

test('parseFlow of examples/work/flow.json equals DEFAULT_FLOW', () => {
  const read = parseFlow(readFileSync(join(ROOT, 'examples', 'work', 'flow.json'), 'utf8'))
  assert.equal(read.problem, null)
  assert.deepEqual(read.flow, DEFAULT_FLOW)
  assert.deepEqual(statesOf(DEFAULT_FLOW, 'step').slice(0, 3), ['new', 'refined', 'queued'])
})

test('mayMove: a worker may not queue; the line names who may', () => {
  const refined = step('refined', 'Refined: ready\n')
  assert.deepEqual(mayMove(DEFAULT_FLOW, refined, 'queued', 'worker', { store: storeOf(refined), overlaps: () => null }), { ok: false, why: 'B285: only main queues a step (flow.json)' })
  assert.deepEqual(mayMove(DEFAULT_FLOW, refined, 'queued', 'main', { store: storeOf(refined), overlaps: () => null }), { ok: true, why: null })
  assert.deepEqual(mayMove(DEFAULT_FLOW, refined, 'queued', 'main', { store: storeOf(refined), overlaps: () => 'B12' }).ok, false)
})

test('mayMove: queued → taken by the server needs Blocked by done and the Owner free', () => {
  const before = item('Id: B281\nKind: step\nState: in progress\nSince: -\n')
  const queued = step('queued', 'Owner: Support\nBlocked by: B281\n')
  const free = new Set(['Support'])
  const notYet = mayMove(DEFAULT_FLOW, queued, 'taken', 'server', { store: storeOf(before, queued), freeChats: free })
  assert.deepEqual(notYet, { ok: false, why: 'B285: "Blocked by all done and Owner free" does not hold (flow.json)' })
  const done = item('Id: B281\nKind: step\nState: done\nSince: -\n')
  assert.equal(mayMove(DEFAULT_FLOW, queued, 'taken', 'server', { store: storeOf(done, queued), freeChats: free }).ok, true)
  assert.equal(mayMove(DEFAULT_FLOW, queued, 'taken', 'server', { store: storeOf(done, queued), freeChats: new Set() }).ok, false)
})

test('a flow naming an unknown guard is refused with its name', () => {
  const text = JSON.stringify({ step: { states: ['new', 'done'], moves: [{ from: 'new', to: 'done', by: 'main', when: 'the moon is full' }] } })
  assert.equal(parseFlow(text).problem, 'flow.json: no guard is called "the moon is full"')
  assert.match(parseFlow('{ nope').problem, /^flow.json is no JSON/)
  assert.equal(parseFlow(JSON.stringify({ step: { states: ['new'], moves: [{ from: 'new', to: 'gone', by: 'main' }] } })).problem, 'flow.json: the step state "gone" is not in its states')
  assert.equal(parseFlow(JSON.stringify({ step: { states: ['new', 'done'], moves: [{ from: 'new', to: 'done', by: 'main', then: 'dance' }] } })).problem, 'flow.json: no action is called "dance"')
  assert.ok(Object.keys(GUARDS).length >= 6)
})

test('a move from "*" is allowed from every state', () => {
  for (const state of ['new', 'queued', 'in progress', 'review']) {
    assert.equal(mayMove(DEFAULT_FLOW, step(state), 'dropped', 'main', { store: storeOf() }).ok, true, state)
    assert.equal(mayMove(DEFAULT_FLOW, step(state), 'dropped', 'person', { store: storeOf() }).ok, true, state)
  }
  assert.equal(mayMove(DEFAULT_FLOW, step('new'), 'dropped', 'worker', { store: storeOf() }).why, 'B285: only person or main drops a step (flow.json)')
  // B297, review 5: the person closes a step from any state; nobody else does.
  assert.equal(mayMove(DEFAULT_FLOW, step('new'), 'done', 'main', { store: storeOf() }).why, 'B285: only person closes a step (flow.json)')
  assert.equal(mayMove(DEFAULT_FLOW, step('in progress'), 'done', 'person', { store: storeOf() }).ok, true)
})

test('nextMoves lists the moves out of the item\'s state, who makes them and when', () => {
  assert.deepEqual(nextMoves(DEFAULT_FLOW, step('queued')), [
    { to: 'taken', by: ['server'], when: 'Blocked by all done and Owner free' },
    // B301, the review: out of its queue (unqueue), back to refined or new.
    { to: 'refined', by: ['main', 'person'], when: null },
    { to: 'new', by: ['main', 'person'], when: null },
    { to: 'done', by: ['person'], when: null },
    { to: 'dropped', by: ['person', 'main'], when: null },
  ])
  assert.deepEqual(nextMoves(DEFAULT_FLOW, item('Id: Q1\nKind: ask\nState: open\nSince: -\n')), [])
})

test('the guards read the store: an open blocking ask, answered asks, the check', () => {
  const s = step('in progress')
  const ask = item('Id: Q7\nKind: ask\nState: open\nSince: -\nOf: B285\nBlocking: yes\nAsks: look\n')
  const ctx = { store: storeOf(s, ask) }
  assert.equal(GUARDS['an ask with Blocking yes is open'](s, ctx), true)
  assert.equal(GUARDS['its asks are answered'](s, ctx), false)
  const review = step('review', '\n## History\n- 2026-10-17 10:00 server: check passed\n')
  assert.equal(GUARDS['the check passed and no ask of kind look is open'](review, { store: storeOf(review, ask) }), false)
  assert.equal(GUARDS['the check passed and no ask of kind look is open'](review, { store: storeOf(review) }), true)
  assert.equal(GUARDS['refined is ready'](step('new', 'Refined: open\n'), ctx), false)
})
