// The supervisor's Task 1: one component for the board's self-check (spec 2026-10-24). `createSupervisor(ports)` is what
// the server calls: `start()` runs the list every few minutes (one loop per project, its lock), `run({ asked })` runs it
// at once ("Out of sync?"), `view(now)` is what the page draws, `stop()` ends the loop. The checks of the list are its
// repair rules, `{ id, kind, says, check(view, ctx) }`, which find exactly what `findStuck` found. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { REFUSED_MS, createSupervisor } from '../../src/supervisor/index.mjs'
import { SYNC_EVERY_MS } from '../../src/supervisor/loop.mjs'
import { CHECKS, REPAIR_RULES, findStuck } from '../../src/supervisor/rules/repair.mjs'
import { stamp } from '../../src/work/migrate.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 24, 9, 0).getTime()
const ago = minutes => NOW - minutes * MIN

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const step = (id, state, more = {}, sections = {}) => item({ Id: id, Kind: 'step', Title: `Step ${id}`, State: state, Since: stamp(ago(60)), ...more }, sections)
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, state: 'free', isRunning: true, session: `s-${name}`, ...more })
const LEAD = lane('Lead', { isMain: true, state: 'working' })
const checkedPass = { History: [`- ${stamp(ago(30))} server: check passed: merged`] }

/** A board of made-up chats and steps: a step blocked by one in review (fixed by the board), one by a step not there. */
function board({ lock = null, fail = null } = {}) {
  const done = { applied: [], failed: [], lockWrites: [], ran: 0 }
  let saved = { noted: [], seen: {} }
  let held = lock
  const ports = {
    state: async () => {
      done.ran += 1
      if (fail !== null) throw fail
      return { chats: [LEAD, lane('Painter', { state: 'working' })], chatPrefix: '', limits: {}, pause: null }
    },
    items: async () => items(step('B1', 'review', {}, checkedPass), step('B2', 'queued', { Owner: 'Painter', 'Blocked by': 'B1' }), step('B4', 'refined', { 'Blocked by': 'B77' })),
    outbox: () => [],
    refused: () => [],
    apply: async body => (done.applied.push(body), { ok: true }),
    wake: async () => ({ id: 'w' }),
    noted: { load: async () => saved, save: async value => { saved = value } },
    now: () => NOW,
    loopLock: {
      read: async () => (held === null ? Promise.reject(Object.assign(new Error('none'), { code: 'ENOENT' })) : JSON.stringify(held)),
      write: async text => { held = JSON.parse(text); done.lockWrites.push(held) },
      alive: () => true,
      pid: 7,
      port: 4310,
    },
    loops: {
      run: async (name, fn) => { try { return await fn() } catch (error) { done.failed.push([name, error.message]) } },
      failed: (name, error) => done.failed.push([name, error.message]),
    },
    closing: () => false,
    settings: {},
  }
  return { ports, done }
}

test('the repair rules: one per check of the list, in its order, each with what it says', () => {
  assert.deepEqual(REPAIR_RULES.map(rule => rule.id), CHECKS.map(one => one.key))
  assert.deepEqual(REPAIR_RULES.map(rule => rule.says), CHECKS.map(one => one.words))
  assert.ok(REPAIR_RULES.every(rule => rule.kind === 'repair' && typeof rule.check === 'function'))
})

test('a repair rule\'s finding names its rule, its subject and its evidence, beside today\'s check, key, text and fix', () => {
  const found = findStuck({
    items: items(step('B1', 'review', {}, checkedPass), step('B2', 'queued', { Owner: 'Painter', 'Blocked by': 'B1' })),
    lanes: [LEAD, lane('Painter', { state: 'working' })], now: NOW,
  })
  assert.equal(found.length, 1)
  assert.deepEqual([found[0].rule, found[0].check, found[0].subject, found[0].key, found[0].fix.do], ['blocked', 'blocked', 'B2', 'blocked B2 B1', 'unblock'])
  assert.equal(typeof found[0].evidence, 'string')
  assert.ok(found[0].evidence.length > 0)
})

test('run: the list at once, as "Out of sync?" ran it; its answer is today\'s, and the view shows it', async () => {
  const { ports, done } = board()
  const supervisor = createSupervisor(ports)
  assert.deepEqual(supervisor.view(NOW), { run: null, rules: [], incidents: [], lastSweep: null })
  const answer = await supervisor.run({ asked: true })
  assert.deepEqual([answer.at, answer.asked, answer.rows.map(row => row.status), answer.fine], [NOW, true, ['Fixed', 'For Main'], CHECKS.length - 1])
  assert.deepEqual(done.applied.map(one => one.action), ['unblock', 'note'])
  // The loop's lock is this process's now (B482: one loop per project).
  assert.deepEqual(done.lockWrites.map(one => [one.pid, one.port]), [[7, 4310]])
  assert.equal(supervisor.view(NOW).run, answer)
})

test('run: another board process that holds the project\'s loop runs it; this one runs nothing and answers null', async () => {
  const { ports, done } = board({ lock: { pid: 8, port: 4311, at: NOW - MIN } })
  const supervisor = createSupervisor(ports)
  assert.equal(await supervisor.run({ asked: true }), null)
  assert.equal(done.ran, 0)
  assert.deepEqual(done.applied, [])
})

test('run: a list that throws is recorded as the loop "sync" and answers null', async () => {
  const { ports, done } = board({ fail: new Error('the store could not be read') })
  const supervisor = createSupervisor(ports)
  assert.equal(await supervisor.run({ asked: true }), null)
  assert.deepEqual(done.failed, [['sync', 'the store could not be read']])
})

test('start: the list every SYNC_EVERY_MS through the loop "sync", not while the board closes; stop ends it', async () => {
  const { ports, done } = board()
  const timers = []
  let closing = false
  const supervisor = createSupervisor({
    ...ports,
    closing: () => closing,
    timers: { setInterval: (fn, ms) => (timers.push({ fn, ms, on: true }), timers.length - 1), clearInterval: index => { timers[index].on = false } },
  })
  supervisor.start()
  supervisor.start()
  assert.deepEqual(timers.map(one => one.ms), [SYNC_EVERY_MS], 'one loop, however often it is started')
  assert.equal(SYNC_EVERY_MS, 3 * MIN)
  await timers[0].fn()
  assert.equal(done.ran, 1)
  assert.equal(supervisor.view(NOW).run.asked, false, 'a run of the loop that found something is shown')
  closing = true
  assert.equal(timers[0].fn(), null)
  assert.equal(done.ran, 1)
  supervisor.stop()
  assert.equal(timers[0].on, false)
})

test('the server\'s note of refused names keeps them as long as the old-name rule looks', () => {
  assert.equal(REFUSED_MS, 10 * MIN)
})
