// The supervisor's Task 1: one component for the board's self-check (spec 2026-10-24). `createSupervisor(ports)` is what
// the server calls: `start()` runs the list every few minutes (one loop per project, its lock), `run({ asked })` runs it
// at once ("Out of sync?"), `view(now)` is what the page draws, `stop()` ends the loop. The checks of the list are its
// repair rules, `{ id, kind, says, check(view, ctx) }`, which find exactly what `findStuck` found. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { REFUSED_MS, createSupervisor, loopGate, loopOwner } from '../../src/supervisor/index.mjs'
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
    // B482, B488: the server's gate of the board's loops, as server.mjs builds it, on a lock file in memory
    owns: loopGate({
      owner: loopOwner({
        read: async () => (held === null ? Promise.reject(Object.assign(new Error('none'), { code: 'ENOENT' })) : JSON.stringify(held)),
        write: async text => { held = JSON.parse(text); done.lockWrites.push(held) },
        alive: () => true,
        pid: 7,
        port: 4310,
        now: () => NOW,
      }),
      now: () => NOW,
    }),
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
  const before = supervisor.view(NOW)
  assert.deepEqual([before.run, before.checkedAt, before.incidents, before.lastSweep], [null, null, [], null])
  assert.ok(before.rules.length > 0 && before.rules.every(rule => rule.state === null), 'every rule, not checked yet')
  const answer = await supervisor.run({ asked: true })
  assert.deepEqual([answer.at, answer.asked, answer.rows.map(row => row.status), answer.fine], [NOW, true, ['Fixed', 'For Main'], CHECKS.length - 1])
  assert.deepEqual(done.applied.map(one => one.action), ['unblock', 'note'])
  // The loops' lock is this process's now (B482, B488: one board process per project runs them).
  assert.deepEqual(done.lockWrites.map(one => [one.pid, one.port]), [[7, 4310]])
  assert.equal(supervisor.view(NOW).run, answer)
  assert.equal(supervisor.view(NOW).checkedAt, NOW)
})

test('run: another board process that holds the project\'s loops (the server\'s gate) runs it; this one runs nothing and answers null', async () => {
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

// Task 2: the watch rules in the loop.

test('the watch rules run after the repairs: what they find is the run\'s findings, every rule says how it stood and how often it tripped', async () => {
  const { ports } = board()
  const supervisor = createSupervisor({
    ...ports,
    state: async () => ({
      chats: [LEAD, lane('Painter', { state: 'working' }), lane('Mason', { state: 'unknown' })], chatPrefix: '', limits: {}, pause: null,
      today: [{ chat: 'Mason', spans: [{ from: ago(30), to: NOW, state: 'unknown', task: null }] }],
    }),
    settings: { supervisor: { unknownMinutes: 10 } },
  })
  const answer = await supervisor.run()
  assert.deepEqual(answer.findings.map(one => [one.rule, one.key, one.text]), [['unknown-lane', 'unknown-lane Mason', 'Mason unknown for 30 min']])
  assert.equal(answer.findings[0].fix, undefined, 'report only: nothing repairs it')
  const rules = new Map(supervisor.view(NOW).rules.map(rule => [rule.id, rule]))
  assert.deepEqual([rules.get('blocked').state, rules.get('blocked').trips], ['tripped', 1])
  assert.deepEqual([rules.get('unknown-lane').state, rules.get('unknown-lane').kind, rules.get('unknown-lane').trips], ['tripped', 'watch', 1])
  assert.deepEqual([rules.get('old-mod').state, rules.get('old-mod').trips], ['fine', 0])
  assert.equal(rules.size, REPAIR_RULES.length + 10)
})

test('the supervisor\'s memory: its repairs of the day, its own watch and the rules\' trips are kept over a restart, apart from sync.json', async () => {
  let clock = NOW
  let file = null
  const saved = []
  const make = () => {
    const { ports } = board()
    let noted = { noted: [], seen: {} }
    return createSupervisor({
      ...ports,
      now: () => clock,
      state: async () => ({ chats: [LEAD, lane('Painter', { state: 'working' }), lane('Mason', { state: 'unknown' })], chatPrefix: '', limits: {}, pause: null }),
      noted: { load: async () => noted, save: async value => { noted = value; saved.push(['sync', value]) } },
      memory: { load: async () => file, save: async value => { file = value; saved.push(['memory', value]) } },
    })
  }
  // First seen unknown now (no timeline): watched, nothing yet; the unblock of B2 is a repair of the day.
  assert.deepEqual((await make().run()).findings, [])
  assert.deepEqual(Object.keys(file.seen), ['unknown-lane Mason'])
  assert.deepEqual(file.repairs.map(one => [one.rule, one.subject, one.key]), [['blocked', 'B2', 'blocked B2 B1']])
  assert.ok(saved.filter(([what]) => what === 'sync').every(([, value]) => Object.keys(value).sort().join() === 'noted,seen'), 'sync.json keeps its own form')
  // A restart 11 minutes later: the watch goes on from the file, and the same repair is counted again.
  clock += 11 * MIN
  const later = await make().run()
  assert.deepEqual(later.findings.map(one => one.key), ['unknown-lane Mason'])
  assert.equal(file.repairs.length, 2)
  assert.equal(file.trips['unknown-lane'].length, 1)
  // A third time: the repair that repeats is reported.
  clock += MIN
  const third = await make().run()
  assert.deepEqual(third.findings.map(one => one.rule), ['unknown-lane', 'repair-repeats'])
  assert.equal(third.findings[1].text, 'The board repaired the same 3 times in a day: blocked for B2')
})

test('Review Focus 1 in the loop: a repair rule that throws is a finding, the other rules and the loop go on, and the rule shows "failed"', async () => {
  const { ports, done } = board()
  const supervisor = createSupervisor({ ...ports, outbox: () => { throw new Error('never read') } })
  // The outbox port throws while the view is built: the run fails as a whole, recorded as "sync" (as before).
  assert.equal(await supervisor.run({ asked: true }), null)
  assert.deepEqual(done.failed.map(([name]) => name), ['sync'])
  // A repair rule that throws on the data it is given (old-name, on a list of refused names it cannot read): only that
  // rule fails; the other repairs are carried out and the watch rules run.
  const odd = createSupervisor({ ...board().ports, refused: () => ({ filter: () => { throw new Error('a torn list') } }) })
  const answer = await odd.run({ asked: true })
  assert.deepEqual(answer.findings.map(one => [one.key, one.text]), [['rule-failed old-name', 'rule old-name failed: a torn list']])
  assert.deepEqual(answer.rows.map(row => row.status), ['Fixed', 'For Main'], 'the other repairs still ran')
  const rules = odd.view(NOW).rules
  assert.deepEqual(rules.filter(one => one.state === 'failed').map(one => [one.id, one.why]), [['old-name', 'rule old-name failed: a torn list']])
  assert.ok(rules.filter(one => one.kind === 'watch').every(one => one.state === 'fine'))
})

// Task 3: the loop files its findings as incidents in the work store.

test('each run files its findings as incidents: opened once, then counted; the view shows them; a filing that fails is the loop "incidents"', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { workApi } = await import('../../src/work/api.mjs')
  const { migrateBacklog } = await import('../../src/work/migrate.mjs')
  const { readStore, writeStore } = await import('../../src/work/store.mjs')
  const dir = await mkdtemp(join(tmpdir(), 'supervisor-incidents-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, migrateBacklog('# Backlog\n\n## Work\n- [ ] B5 Paint the strip (for Mason; about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  let clock = NOW
  const { ports, done } = board()
  const supervisor = createSupervisor({
    ...ports,
    now: () => clock,
    items: async () => (await readStore(dir)).items,
    apply: body => workApi(body, { dir, now: clock, prefix: '', as: 'server' }),
    state: async () => ({
      chats: [LEAD, lane('Mason', { state: 'unknown' })], chatPrefix: '', limits: {}, pause: null,
      today: [{ chat: 'Mason', spans: [{ from: ago(30), to: NOW, state: 'unknown', task: null }] }],
    }),
  })
  await supervisor.run()
  clock += 3 * MIN
  await supervisor.run()
  const incidents = supervisor.view(clock).incidents
  assert.deepEqual(incidents.map(one => [one.id, one.state, one.source, one.subject, one.count]), [['X1', 'open', 'unknown-lane', 'Mason', 2]])
  assert.match(incidents[0].title, /^Mason unknown for 33 min/)
  assert.deepEqual(done.failed, [])
  // Task 4: one line to the person for the incident that opened, none for the run that only counted it.
  const notes = [...(await readStore(dir)).items.values()].filter(one => one.head.get('Kind') === 'note' && one.head.get('Via') === 'supervisor')
  assert.deepEqual(notes.map(one => [one.head.get('To'), one.head.get('From'), one.head.get('Text'), one.sections.get('About')?.[0]]), [['you', 'server', 'Supervisor: Mason unknown for 30 min, B5 waits', 'X1']])
  // The store refuses (a file changed meanwhile): nothing is lost, the loop says so, and the next run files it.
  const refusing = createSupervisor({ ...ports, apply: async () => ({ ok: false, status: 409, why: 'X1.md changed in the meantime' }), state: async () => ({ chats: [LEAD, lane('Mason', { state: 'unknown' })], chatPrefix: '', limits: {}, pause: null, today: [{ chat: 'Mason', spans: [{ from: ago(30), to: NOW, state: 'unknown', task: null }] }] }) })
  await refusing.run()
  assert.deepEqual(done.failed.map(([name, why]) => [name, why]), [['incidents', '1 not filed (unknown-lane Mason: X1.md changed in the meantime)']])
})

test('Task 4: "Check now" from a worker\'s menu runs the list about that worker; the answer names it', async () => {
  const { ports } = board()
  const supervisor = createSupervisor(ports)
  assert.equal((await supervisor.run({ asked: true, subject: 'Painter' })).subject, 'Painter')
  assert.equal(supervisor.view(NOW).run.subject, 'Painter')
  assert.equal((await supervisor.run({ asked: true })).subject, null)
})
