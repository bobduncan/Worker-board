// T9.1.1 (the person, 2026-10-27: "checks go before new steps", "as long as its a worker who didnt build the task"): a
// Quality Assurance task is first on the ready list, before a fix and the focus goal's tasks; it is never held for the
// person's pick, and the board never gives it to a chat that built the step it checks. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { CHOICE_WHY, idleWorkers, match, readyList, workerStart } from '../../src/work/handOut.mjs'
import { parseItem, valueOf } from '../../src/work/item.mjs'
import { fresh, item, qaOf, remove, reported } from '../qaKit.mjs'

const NOW = new Date(2026, 9, 27, 12, 0).getTime()
const MIN = 60_000
const T = (h, m) => new Date(2026, 9, 27, h, m).getTime()

const file = (head, sections = {}) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${Object.entries(sections).map(([name, lines]) => `\n## ${name}\n${lines.join('\n')}\n`).join('')}`)
const step = (id, state, more = {}, sections = {}) => file({ Id: id, Kind: 'step', Title: `Task ${id}`, State: state, Since: '2026-10-27 10:00', ...(state === 'refined' ? { Refined: 'ready' } : {}), ...more }, sections)
const qa = (id, checks, notBy, more = {}) => step(id, 'refined', { Title: `Quality Assurance: ${checks} Task ${checks}`, Checks: checks, ...(notBy === null ? {} : { 'Not by': notBy }), ...more })
const mapOf = items => new Map(items.map(item => [item.head.get('Id'), item]))
const list = (items, more = {}) => readyList(mapOf(items), { now: NOW, focus: 'G3', followUpMs: 10 * MIN, standardHold: () => null, routingHeld: new Set(), prefix: 'Team - ', ...more })
const lane = (name, since = T(11, 0), more = {}) => ({
  name, state: 'free', isMain: false, isLeftover: false, isRunning: true, model: 'claude-sonnet-5-5',
  report: { state: 'idle', since, background: false, at: NOW - 2000 }, ...more,
})
const gives = done => done.map(({ id, chat }) => ({ id, chat }))

test('a QA task comes before a fix and the focus goal\'s tasks, whatever its id; each rank by id', () => {
  const done = list([
    step('B5', 'refined', { Goal: 'G3' }), step('B9', 'refined', { Priority: 'fix' }), step('B2', 'refined'),
    step('B6', 'review'), step('B7', 'review'), qa('B40', 'B7', 'Worker 1'), qa('B31', 'B6', 'Worker 2'),
  ])
  assert.deepEqual(done.ready.map(one => [one.id, one.rank]), [['B31', -1], ['B40', -1], ['B9', 0], ['B5', 1], ['B2', 2]])
})

test('a QA task\'s entry names whom it is never given to, and is kept for nobody; others carry no such field', () => {
  const done = list([step('B6', 'review'), qa('B31', 'B6', 'Worker 1, Worker 2'), step('B2', 'refined')])
  assert.deepEqual(done.ready[0], { id: 'B31', rank: -1, keptFor: null, keptUntil: null, pinned: null, prefers: null, notBy: ['Worker 1', 'Worker 2'] })
  assert.equal(Object.hasOwn(done.ready[1], 'notBy'), false)
})

test('a QA task is ready though its goal is not the focus and nobody added it; a plain task of that goal waits for the person\'s pick', () => {
  const done = list([step('B6', 'review'), qa('B31', 'B6', 'Worker 1', { Goal: 'G9' }), step('B2', 'refined', { Goal: 'G9' })], { beyondFocus: false })
  assert.deepEqual(done.ready.map(one => one.id), ['B31'])
  assert.deepEqual(done.held, [{ id: 'B2', why: CHOICE_WHY, choice: true }])
})

test('a QA task is no follow-up of anyone: not kept for the builder that finished the step it checks, nor preferred', () => {
  const done = step('B5', 'done', { Owner: 'Worker 1' }, { History: ['- 2026-10-27 11:55 Worker 1: in progress → review', '- 2026-10-27 11:56 server: review → done'] })
  const task = qa('B31', 'B6', 'Worker 1', { 'Waits for': 'B5' })
  for (const followUpMs of [0, 10 * MIN]) {
    const found = list([done, step('B6', 'review'), task], { followUpMs })
    assert.deepEqual([found.ready[0].keptFor, found.ready[0].keptUntil, found.ready[0].prefers], [null, null, null], `follow-up ${followUpMs}`)
  }
})

test('a QA task whose step is not in review is held, saying so: no worker is given a closed step to check', () => {
  const task = qa('B31', 'B6', 'Worker 1')
  for (const state of ['done', 'dropped', 'in progress']) {
    const found = list([step('B6', state), task])
    assert.deepEqual([found.ready.map(one => one.id), found.held], [[], [{ id: 'B31', why: `B6 is ${state}, not in review: nothing to check` }]], state)
  }
  assert.deepEqual(list([task]).held, [{ id: 'B31', why: 'B6 is not in the store: nothing to check' }])
  assert.deepEqual(list([step('B6', 'review'), task]).held, [])
})

test('match: a QA task goes to an idle worker that did not build the step, never to one in its Not by, with or without the list\'s prefix', () => {
  const items = mapOf([qa('B31', 'B6', 'Worker 1')])
  const entries = [{ id: 'B31', rank: -1, keptFor: null, keptUntil: null, pinned: null, prefers: null, notBy: ['Worker 1'] }]
  // The builder is idle longest, yet the task goes to the other worker.
  const idle = idleWorkers([lane('Worker 1', T(10, 0)), lane('Worker 2', T(11, 0))], { items })
  assert.deepEqual(gives(match({ ready: entries, idle, items })), [{ id: 'B31', chat: 'Worker 2' }])
  // The task names the chat as the list writes it, the lane carries the prefix, and the other way round.
  const prefixed = [lane('Team - Worker 1', T(10, 0)), lane('Team - Worker 2', T(11, 0))]
  assert.deepEqual(gives(match({ ready: entries, idle: prefixed, items, prefix: 'Team - ' })), [{ id: 'B31', chat: 'Team - Worker 2' }])
  const named = [{ ...entries[0], notBy: ['Team - Worker 1'] }]
  assert.deepEqual(gives(match({ ready: named, idle: [lane('Worker 1', T(10, 0)), lane('Worker 2', T(11, 0))], items, prefix: 'Team - ' })), [{ id: 'B31', chat: 'Worker 2' }])
  // In another case: the same name in any letters.
  assert.deepEqual(gives(match({ ready: [{ ...entries[0], notBy: ['worker 1'] }], idle: [lane('Worker 1', T(10, 0))], items })), [])
})

test('match: when only a builder is idle the QA task waits, and the builder still gets the next task of the list', () => {
  const items = mapOf([qa('B31', 'B6', 'Worker 1'), step('B2', 'refined')])
  const ready = [
    { id: 'B31', rank: -1, keptFor: null, keptUntil: null, pinned: null, prefers: null, notBy: ['Worker 1'] },
    { id: 'B2', rank: 2, keptFor: null, keptUntil: null, pinned: null, prefers: null },
  ]
  assert.deepEqual(gives(match({ ready, idle: [lane('Worker 1')], items })), [{ id: 'B2', chat: 'Worker 1' }])
  assert.deepEqual(gives(match({ ready: ready.slice(0, 1), idle: [lane('Worker 1')], items })), [])
})

test('match: a QA task pinned to a builder (the person\'s pin) is still never given to that builder', () => {
  const items = mapOf([qa('B31', 'B6', 'Worker 1', { Pinned: 'Worker 1' })])
  const found = list([step('B6', 'review'), qa('B31', 'B6', 'Worker 1', { Pinned: 'Worker 1' })])
  assert.equal(found.ready[0].keptFor, 'Worker 1')
  assert.deepEqual(match({ ready: found.ready, idle: [lane('Worker 1'), lane('Worker 2')], items }), [])
})

test('match: a QA task on Opus goes to a worker already on Opus, as any task does', () => {
  const items = mapOf([qa('B31', 'B6', 'Worker 1', {}), step('B2', 'refined')])
  items.set('B31', qa('B31', 'B6', 'Worker 1'))
  const opus = parseItem('Id: B31\nKind: step\nTitle: Quality Assurance: B6 Task B6\nState: refined\nSince: 2026-10-27 10:00\nChecks: B6\nNot by: Worker 1\nRefined: ready\n\n## Model\nopus · judges art against its reference\n')
  items.set('B31', opus)
  const ready = [{ id: 'B31', rank: -1, keptFor: null, keptUntil: null, pinned: null, prefers: null, notBy: ['Worker 1'] }]
  const idle = [lane('Worker 2', T(10, 0), { model: 'claude-sonnet-5-5' }), lane('Worker 3', T(11, 0), { model: 'claude-opus-5-5' })]
  assert.deepEqual(gives(match({ ready, idle, items })), [{ id: 'B31', chat: 'Worker 3' }])
})

test('workerStart: an idle builder holds back no start for the QA task it may not take; an idle worker that may does', () => {
  const items = mapOf([qa('B31', 'B6', 'Worker 1')])
  const ready = [{ id: 'B31', rank: -1, keptFor: null, keptUntil: null, pinned: null, prefers: null, notBy: ['Worker 1'] }]
  const lanes = [lane('Worker 1'), lane('Worker 2', T(9, 0), { state: 'off', isRunning: false, report: null })]
  const only = workerStart({ ready, gives: [], idle: [lanes[0]], lanes, maxWorkers: 2, items, now: NOW })
  assert.deepEqual(only, { start: 'Worker 2' })
  // A second idle worker that may take it: it takes it, no worker is asked for.
  const two = [lane('Worker 1'), lane('Worker 3')]
  assert.equal(workerStart({ ready, gives: [], idle: two, lanes: two, maxWorkers: 3, items, now: NOW }), null)
})

test('the work API\'s give refuses a QA task for a chat that built the step it checks, and gives it to another', async () => {
  const store = await fresh()
  try {
    const { id } = await reported(store)
    const qaId = await qaOf(store, id)
    const builder = await store.server({ action: 'advance', id: qaId, to: 'queued', for: 'Lamplighter' })
    assert.deepEqual([builder.ok, builder.status], [false, 409])
    assert.match(builder.why, new RegExp(`${qaId}.*Lamplighter built ${id}`))
    assert.equal(valueOf(await item(store.dir, qaId), 'State'), 'refined')
    const other = await store.server({ action: 'advance', id: qaId, to: 'queued', for: 'Checker' })
    assert.equal(other.ok, true, other.why)
    assert.equal(valueOf(await item(store.dir, qaId), 'Owner'), 'Checker')
  } finally {
    await remove(store.dir)
  }
})
