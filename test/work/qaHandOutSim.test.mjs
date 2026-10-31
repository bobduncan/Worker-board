// T9.1.1 (the person, 2026-10-27: workers do the checks, ahead of new steps, never the builder): a Quality Assurance task through
// the board's whole path with simulated chats: the state from the chats' reports, the reconciler's hand-out, the server's
// delivery, the work API's take and `checked`. The builder is idle longest and still gets no check of its own step; the other
// worker gets it before a plain task; when only the builder is idle the task waits and the builder goes on to the next task.
// Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { parseConfig } from '../../src/config.mjs'
import { memoryStore } from '../../src/store.mjs'
import { buildState } from '../../src/state.mjs'
import { workApi } from '../../src/work/api.mjs'
import { deliverWork, givesRefused } from '../../src/work/deliver.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const SEC = 1000
const MIN = 60 * SEC
const T0 = new Date(2026, 9, 27, 10, 0).getTime()
const PROJECT = 'C:\\garden'
const ROLES = { Lead: 'main', W1: 'worker', W2: 'worker' }

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)), problem: null })
const plainTask = id => item({ Id: id, Kind: 'step', Title: `Task ${id}`, State: 'refined', Activity: 'Garden', Since: stamp(T0 - 60 * MIN), Refined: 'ready' }, { History: [`- ${stamp(T0 - 60 * MIN)} Partner: made`] })
/** B1 built by W1 and waiting in review for its check; B2 its Quality Assurance task, ready, not for W1. */
const built = () => item({ Id: 'B1', Kind: 'step', Title: 'Light the lamps', State: 'review', Owner: 'W1', Activity: 'Garden', Since: stamp(T0 - 30 * MIN) }, {
  'What we build': ['- a lamp at every bench'],
  History: [`- ${stamp(T0 - 50 * MIN)} server: refined → queued (given by the board to W1)`, `- ${stamp(T0 - 49 * MIN)} W1: queued → taken`, `- ${stamp(T0 - 49 * MIN)} W1: taken → in progress`, `- ${stamp(T0 - 31 * MIN)} W1: in progress → review`, `- ${stamp(T0 - 30 * MIN)} server: check passed: merged`],
})
const qaTask = () => item({ Id: 'B2', Kind: 'step', Title: 'Quality Assurance: B1 Light the lamps', State: 'refined', Activity: 'Garden', Since: stamp(T0 - 29 * MIN), Checks: 'B1', 'Not by': 'W1', Refined: 'ready' }, {
  'What we build': ['- Check B1 against its agreed points and its standard'], History: [`- ${stamp(T0 - 29 * MIN)} server: made for the result check of B1`],
})
const app = name => JSON.stringify({ title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: T0 - 5 * MIN, lastAssistantUuid: 'u-1' })

async function garden(tasks) {
  const dir = await mkdtemp(join(tmpdir(), 'qa-hand-out-'))
  const items = new Map(tasks.map(one => [one.head.get('Id'), one]))
  await writeStore(dir, { items, activities: [{ name: 'Garden', isFocus: false, steps: [...items.keys()], notes: [], loose: [] }] }, undefined, { now: T0 - 60 * MIN })
  const config = { ...parseConfig(JSON.stringify({ handOutBeyondFocus: true }), {}), project: PROJECT }
  const reports = new Map()
  const report = (name, state, since, at) => reports.set(name, { state, since, background: false, at, session: `cli-${name}`, mod: '0.19.0' })
  const outbox = memoryStore()
  const build = async now => buildState({
    listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: ['Lead', 'W1', 'W2'].map(app), tails: {}, planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {},
    work: { ok: true, dir, ...(await readStore(dir)) },
  }, { lines: [], outbox: outbox.outbox(), runs: [], board: { startedAt: T0 - 60 * MIN, offSince: null }, seen: { shown: { Lead: now }, other: {} }, reports, now, config, handOutHeldAt: null, refusedGives: givesRefused(dir, now) })
  let n = 0
  const call = (now, chat) => body => workApi(chat === undefined ? body : { chat, ...body }, { dir, now, prefix: 'Garden · ', roleOf: name => ROLES[name] ?? null, ...(chat === undefined ? { as: 'server' } : {}) })
  const deliver = (state, now) => deliverWork({ state, dir, outbox, apply: call(now), now, maxChars: 2000, newId: () => `m${(n += 1)}` })
  const read = async id => (await readStore(dir)).items.get(id)
  return { dir, report, build, deliver, call, read, close: () => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
}

test('the check goes to the other idle worker before a plain task, though the builder has been idle longest; it takes it, files the check, is free again', async () => {
  const one = await garden([built(), qaTask(), plainTask('B3')])
  try {
    one.report('W1', 'idle', T0 - 30 * SEC, T0 - 2 * SEC)
    one.report('W2', 'idle', T0 - 10 * SEC, T0 - 2 * SEC)
    const state = await one.build(T0)
    assert.deepEqual(state.readyList.ready.map(row => [row.id, row.rank]), [['B2', -1], ['B3', 2]])
    assert.deepEqual(state.readyList.ready[0].notBy, ['W1'])
    assert.deepEqual(state.reconciled.gives.map(({ id, chat }) => [id, chat]), [['B2', 'W2'], ['B3', 'W1']])
    assert.deepEqual((await one.deliver(state, T0)).given, ['B2', 'B3'])
    assert.equal(valueOf(await one.read('B2'), 'Owner'), 'W2')
    // The step in review reads where its check stands.
    const step = (await one.build(T0 + 5 * SEC)).backlog.flatMap(activity => activity.steps).find(row => row.id === 'B1')
    assert.deepEqual([step.reviewStand.kind, step.reviewStand.qa], ['queued', 'B2'])
    // W2 takes it and files the check; the builder cannot, W2 can.
    const at = T0 + 30 * SEC
    assert.equal((await one.call(at, 'W2')({ action: 'take', minutes: 30, id: 'B2' })).ok, true)
    assert.equal((await one.call(at, 'W1')({ action: 'checked', size: '30 min', id: 'B1', evidence: 'none (x)', points: ['pass: a lamp at every bench'] })).status, 403)
    const filed = await one.call(at, 'W2')({ action: 'checked', size: '30 min', id: 'B1', evidence: 'none (x)', points: ['pass: a lamp at every bench'] })
    assert.equal(filed.ok, true, filed.why)
    assert.deepEqual([valueOf(await one.read('B1'), 'State'), valueOf(await one.read('B2'), 'State')], ['done', 'done'])
    // W2 holds nothing now: it is free for the next task.
    assert.match((await one.call(at, 'W2')({ action: 'next' })).result.text, /^Nothing is yours, W2/)
  } finally {
    await one.close()
  }
})

test('only the builder is idle: the check waits, the builder gets the next plain task; the other worker, once idle, gets the check', async () => {
  const one = await garden([built(), qaTask(), plainTask('B3')])
  try {
    one.report('W1', 'idle', T0 - 30 * SEC, T0 - 2 * SEC)
    one.report('W2', 'busy', T0 - 30 * SEC, T0 - 2 * SEC)
    const first = await one.build(T0)
    assert.deepEqual(first.reconciled.gives.map(({ id, chat }) => [id, chat]), [['B3', 'W1']])
    await one.deliver(first, T0)
    assert.equal(valueOf(await one.read('B2'), 'State'), 'refined')
    // W2 goes idle; W1 still holds B3: the check goes to W2.
    one.report('W2', 'idle', T0 + 10 * SEC, T0 + 12 * SEC)
    const later = await one.build(T0 + 15 * SEC)
    assert.deepEqual(later.reconciled.gives.map(({ id, chat }) => [id, chat]), [['B2', 'W2']])
  } finally {
    await one.close()
  }
})

test('the step left review while its task waited: the task is held, not given (the repair unchecked drops it, see qaRepair.test.mjs)', async () => {
  const done = built()
  done.head.set('State', 'done')
  const one = await garden([done, qaTask()])
  try {
    one.report('W2', 'idle', T0 - 10 * SEC, T0 - 2 * SEC)
    const state = await one.build(T0)
    assert.deepEqual(state.reconciled.gives, [])
    assert.deepEqual(state.readyList.held.map(row => [row.id, row.why]), [['B2', 'B1 is done, not in review: nothing to check']])
  } finally {
    await one.close()
  }
})
