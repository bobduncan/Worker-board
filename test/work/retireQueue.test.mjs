// Redesign Part 2 (plan 2026-10-25, Question 2): the tasks queued before the redesign (by Main, by the person, or kept as
// a wish until their refine) go back on the ready list at the first refresh, once; a placement the person made ("Move
// to") becomes a pin. A task the board gave stays where it is. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { DEFAULT_FLOW } from '../../src/work/flow.mjs'
import { oldQueued } from '../../src/work/handOut.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { reconcile } from '../../src/work/reconcile.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 25, 12, 0).getTime()
const ago = minutes => stamp(NOW - minutes * MIN)
const ROLES = { Main: 'main', 'Worker 1': 'worker', 'Worker 3': 'worker' }

const item = (head, history) => ({ head: new Map(Object.entries(head)), sections: new Map([['History', history]]), problem: null })
const step = (id, state, more = {}, history = []) => item({ Id: id, Kind: 'step', Title: `Task ${id}`, State: state, Activity: 'Board', Since: ago(30), ...more }, [`- ${ago(90)} Partner: made`, ...history])
const ALL = () => [
  // Main queued it.
  step('B1', 'queued', { Owner: 'Worker 1', Refined: 'ready' }, [`- ${ago(60)} Main: refined → queued`, `- ${ago(60)} Main: queued for Worker 1; about 1 h`]),
  // The person moved it to Worker 3 ("Move to").
  step('B2', 'queued', { Owner: 'Worker 3', Refined: 'ready' }, [`- ${ago(60)} Main: refined → queued`, `- ${ago(60)} Main: queued for Worker 1`, `- ${ago(40)} person: requeued for Worker 3 (was Worker 1)`]),
  // Queued, but its refine is not ready (a wish carried out by the backlog): back to new.
  step('B3', 'queued', { Owner: 'Worker 1' }, [`- ${ago(60)} Main: queued for Worker 1`]),
  // A wish kept until its refine: the key goes, it stays refined.
  step('B4', 'refined', { Refined: 'ready', 'Queue when refined': 'for Worker 1; about 1 h' }, [`- ${ago(60)} Main: queue asked before its refine: for Worker 1; about 1 h`]),
  // The board gave it: it stays.
  step('B5', 'queued', { Owner: 'Worker 3', Refined: 'ready', Since: ago(1) }, [`- ${ago(1)} server: refined → queued (given by the board to Worker 3)`]),
  // Under way: nothing to do.
  step('B6', 'in progress', { Owner: 'Worker 1' }, [`- ${ago(60)} Main: queued for Worker 1`]),
]

async function store() {
  const dir = await mkdtemp(join(tmpdir(), 'retire-queue-'))
  const items = new Map(ALL().map(one => [one.head.get('Id'), one]))
  await writeStore(dir, { items, activities: [{ name: 'Board', isFocus: false, steps: [...items.keys()], notes: [], loose: [] }] }, undefined, { now: NOW - 90 * MIN })
  const ctx = { dir, now: NOW, prefix: '', roleOf: chat => ROLES[chat] ?? null }
  return { dir, server: body => workApi(body, { ...ctx, as: 'server' }), main: body => workApi({ chat: 'Main', ...body }, ctx), read: async id => (await readStore(dir)).items.get(id) }
}

test('oldQueued names every task queued before the redesign and every kept wish; never one the board gave', () => {
  const items = new Map(ALL().map(one => [one.head.get('Id'), one]))
  assert.deepEqual(oldQueued(items, { prefix: '' }), [{ id: 'B1' }, { id: 'B2' }, { id: 'B3' }, { id: 'B4' }])
})

test('retire-queue puts each back on the ready list once; a person\'s placement becomes a pin; a second pass changes nothing', async () => {
  const one = await store()
  try {
    for (const id of ['B1', 'B2', 'B3', 'B4']) assert.equal((await one.server({ action: 'retire-queue', id })).ok, true, id)
    const line = 'back on the ready list: the board hands out all tasks now'
    const b1 = await one.read('B1')
    assert.deepEqual(['State', 'Owner', 'Pinned'].map(key => valueOf(b1, key)), ['refined', null, null])
    assert.match(b1.sections.get('History').at(-1), new RegExp(`server: queued → refined \\(${line}\\)$`))
    const b2 = await one.read('B2')
    assert.deepEqual(['State', 'Owner', 'Pinned'].map(key => valueOf(b2, key)), ['refined', null, 'Worker 3'])
    const b3 = await one.read('B3')
    assert.deepEqual(['State', 'Owner'].map(key => valueOf(b3, key)), ['new', null])
    const b4 = await one.read('B4')
    assert.deepEqual(['State', 'Queue when refined'].map(key => valueOf(b4, key)), ['refined', null])
    assert.match(b4.sections.get('History').at(-1), new RegExp(`server: ${line}$`))
    // The board's own give and a task under way: nothing to do.
    for (const id of ['B5', 'B6']) assert.equal((await one.server({ action: 'retire-queue', id })).result.changed, false, id)
    assert.deepEqual([valueOf(await one.read('B5'), 'Owner'), valueOf(await one.read('B6'), 'State')], ['Worker 3', 'in progress'])
    // A second pass: nothing more.
    for (const id of ['B1', 'B2', 'B3', 'B4']) assert.equal((await one.server({ action: 'retire-queue', id })).result.changed, false, id)
    // Only the board does it.
    assert.equal((await one.main({ action: 'retire-queue', id: 'B1' })).status, 403)
  } finally {
    await rm(one.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('the reconciler names them at every refresh until none is left, before anything is given', async () => {
  const items = new Map(ALL().map(one => [one.head.get('Id'), one]))
  const plan = reconcile({ store: { items, flow: DEFAULT_FLOW, problems: [] }, lanes: ['Worker 1', 'Worker 3'].map(name => ({ name, state: 'working', isMain: false, isLeftover: false, isRunning: true })), now: NOW, times: { graceMs: 10 * MIN, askMs: 60 * MIN, idleMs: 30 * MIN }, prefix: '' })
  assert.deepEqual(plan.retired, [{ id: 'B1' }, { id: 'B2' }, { id: 'B3' }, { id: 'B4' }])
  // None of them is taken back as well.
  assert.deepEqual(plan.takeBacks.map(one => one.id), [])
})
