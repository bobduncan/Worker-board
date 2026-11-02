// Signals change 6 (B915, 2026-11-02, the lead's Addendum 2 and 3): an alarm closes itself when its key was not found for 60
// min of the board's running time, counting only runs in which its rule looked (not failed, not skipped for a pause or a full
// limit), the board's off time left out; a sweep's incident never; one in fix waits for its step and is fixed once that step
// is done AND it is not seen for 60 min; the same key again comes back. The real cases first (X104, X117, X93, X119), then
// what the mutants of the build brief would break. Temporary stores, made-up chats; no word names a project.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { GONE_MS, goneOf, gonePlan } from '../../src/supervisor/gone.mjs'
import { runRules, withRun } from '../../src/supervisor/loop.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { createSupervisor } from '../../src/supervisor/index.mjs'
import { recordFindings } from '../../src/supervisor/incidents.mjs'
import { workApi } from '../../src/work/api.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const at = (h, m) => new Date(2026, 10, 1, h, m).getTime()
/** Runs of a rule every `every` minutes over each part `[from, to, status]`, as the loop keeps them (`withRun`). */
const runsOf = (parts, every = 3) => {
  let spans = []
  for (const [from, to, status] of parts) for (let t = from; t <= to; t += every * MIN) spans = withRun(spans, t, status)
  return spans
}

test('X104 (unjudged, seen 19:29-19:35): still open at 20:34, gone at 20:35, its rule looking every minute', () => {
  const incident = { lastSeen: at(19, 35) }
  assert.equal(goneOf({ incident, runs: runsOf([[at(19, 29), at(20, 34), 'complete']], 1), now: at(20, 34) }).gone, false, '59 min')
  const gone = goneOf({ incident, runs: runsOf([[at(19, 29), at(20, 35), 'complete']], 1), now: at(20, 35) })
  assert.deepEqual([gone.gone, gone.counted, gone.notSeenSince], [true, 60 * MIN, at(19, 35)])
})

test('a skipped run (a pause, a full limit) and a failed run add no running time: absent there is not "not seen"', () => {
  const incident = { lastSeen: at(10, 0) }
  for (const status of ['skipped', 'failed']) {
    const runs = runsOf([[at(10, 0), at(10, 0), 'complete'], [at(10, 3), at(11, 30), status], [at(11, 33), at(11, 33), 'complete']])
    const clock = goneOf({ incident, runs, now: at(11, 33) })
    assert.deepEqual([clock.gone, clock.counted], [false, 3 * MIN], status)
  }
  // The rule looked all along: gone after 60 min.
  assert.equal(goneOf({ incident, runs: runsOf([[at(10, 0), at(11, 0), 'complete']]), now: at(11, 0) }).gone, true)
})

test('the board\'s off time (a PC sleep: the history\'s gap lines) is no running time', () => {
  const incident = { lastSeen: at(10, 0) }
  const gaps = [{ from: at(10, 20), to: at(10, 50) }]
  const clock = goneOf({ incident, runs: runsOf([[at(10, 0), at(11, 6), 'complete']]), now: at(11, 6), gaps })
  assert.deepEqual([clock.gone, clock.counted], [false, 36 * MIN])
  assert.equal(goneOf({ incident, runs: runsOf([[at(10, 0), at(11, 30), 'complete']]), now: at(11, 30), gaps }).gone, true)
})

test('principle 3: what the supervisor did not watch counts for nothing (an old incident counts from its rule\'s first kept run)', () => {
  // Last seen days before the change landed; the rule's runs begin at the landing.
  const clock = goneOf({ incident: { lastSeen: at(8, 0) - 3 * 24 * 60 * MIN }, runs: runsOf([[at(10, 0), at(10, 57), 'complete']]), now: at(10, 57) })
  assert.deepEqual([clock.gone, clock.counted], [false, 57 * MIN])
  assert.equal(goneOf({ incident: { lastSeen: Number.NaN }, runs: runsOf([[at(10, 0), at(12, 0), 'complete']]), now: at(12, 0) }), null)
})

test('X93: a 10-min board-slow spell (its look window) is gone 60 min after it was last seen, no case of its own', () => {
  // board-slow found 10:00-10:09 (its window), then not: the finding left the list by itself.
  const runs = now => runsOf([[at(10, 0), now, 'complete']], 1)
  const incident = { lastSeen: at(10, 9) }
  assert.equal(goneOf({ incident, runs: runs(at(11, 8)), now: at(11, 8) }).gone, false)
  assert.equal(goneOf({ incident, runs: runs(at(11, 9)), now: at(11, 9) }).gone, true)
})

const incident = (id, more = {}) => ({ id, state: 'open', source: 'working-not-running', lastSeen: at(10, 0), fix: null, ...more })
const stepIn = state => ({ head: new Map([['Kind', 'step'], ['State', state]]) })
const RULES = new Set(WATCH_RULES.map(rule => rule.id))

test('gonePlan: open, came back and with the supervisor go; a sweep\'s never; one in fix never while its step stands (X119-X121)', () => {
  const runs = { 'working-not-running': runsOf([[at(10, 0), at(11, 0), 'complete']]) }
  const steps = new Map([['B12', stepIn('in progress')], ['B13', stepIn('done')]])
  const plan = gonePlan({
    incidents: [incident('X1'), incident('X2', { state: 'came back' }), incident('X3', { state: 'with the supervisor' }), incident('X4', { source: 'sweep' }),
      incident('X5', { state: 'fix', fix: 'B12' }), incident('X6', { state: 'closed' }), incident('X7', { state: 'gone' })],
    steps, runs, rules: RULES, now: at(11, 0),
  })
  assert.deepEqual(plan.gone.map(one => one.id), ['X1', 'X2', 'X3'])
  assert.deepEqual(plan.fixed, [])
})

test('X117: fixed only once its step is done AND it was not seen for 60 min (B883 done 14:00, last seen 13:47: fixed at 14:47, not 14:00)', () => {
  const steps = new Map([['B883', stepIn('done')]])
  const x117 = incident('X117', { state: 'fix', fix: 'B883', lastSeen: at(13, 47), source: 'dropped-fix' })
  const runs = now => ({ 'dropped-fix': runsOf([[at(13, 47), now, 'complete']], 1) })
  assert.deepEqual(gonePlan({ incidents: [x117], steps, runs: runs(at(14, 0)), rules: RULES, now: at(14, 0) }).fixed, [])
  assert.deepEqual(gonePlan({ incidents: [x117], steps, runs: runs(at(14, 46)), rules: RULES, now: at(14, 46) }).fixed, [])
  assert.deepEqual(gonePlan({ incidents: [x117], steps, runs: runs(at(14, 47)), rules: RULES, now: at(14, 47) }).fixed, [{ id: 'X117', fix: 'B883', notSeenSince: at(13, 47) }])
  // Never gone (the step stands for it), never fixed on a step not done.
  assert.deepEqual(gonePlan({ incidents: [x117], steps: new Map([['B883', stepIn('review')]]), runs: runs(at(16, 0)), rules: RULES, now: at(16, 0) }), { gone: [], fixed: [] })
})

test('the loop records each rule\'s run: looked, skipped for a pause (the rule says so) or failed', () => {
  const view = { pause: { state: 'pausing', since: '2026-11-01 10:00' }, limits: {}, lanes: [], items: new Map(), now: at(10, 0) }
  const rules = [WATCH_RULES.find(rule => rule.id === 'working-not-running'), { id: 'boom', check: () => { throw new Error('bad data') } }, { id: 'quiet', check: () => [] }]
  const { states } = runRules(rules, view, { seen: new Map(), observed: [] })
  assert.deepEqual(states.map(one => [one.rule.id, one.skipped, one.failed === null]), [['working-not-running', 'the person pauses', true], ['boom', null, false], ['quiet', null, true]])
  // Run-length spans, the newest lengthened while it stands the same.
  assert.deepEqual(withRun(withRun(withRun([], 1, 'complete'), 2, 'complete'), 3, 'skipped'), [{ from: 1, to: 2, status: 'complete' }, { from: 3, to: 3, status: 'skipped' }])
})

// The whole loop on a real store: Digger's card says it works while its chat makes no call (working-not-running), then its chat
// runs again: the rule stops finding it; 60 min of runs later X1 is gone by itself, with its line; the same key again comes back.
const ROLES = { Lead: 'main', Digger: 'worker', Watcher: 'supervisor' }
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, state: 'free', isRunning: true, session: `s-${name}`, ...more })

async function board(t, { paused = () => false } = {}) {
  const START = at(14, 0)
  const dir = await mkdtemp(join(tmpdir(), 'gone-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, migrateBacklog('# Backlog\n\n## Work\n- [ ] B12 Wake an unknown worker (for Digger; about 1 h)\n', { now: START }), undefined, { now: START })
  let now = START
  const stuck = { value: true }
  let memory = null
  const ctx = () => ({ dir, now, prefix: '', roleOf: chat => ROLES[chat] ?? null })
  const supervisor = createSupervisor({
    state: async () => ({
      chats: [lane('Lead', { isMain: true }), lane('Digger', stuck.value ? { state: 'working', isRunning: false, offSince: START - 20 * MIN } : { state: 'free' })], chatPrefix: '',
      pause: paused(now) ? { state: 'pausing', since: '2026-11-01 14:00' } : null,
    }),
    items: async () => (await readStore(dir)).items,
    outbox: () => [],
    refused: () => [],
    apply: body => workApi(body, { ...ctx(), as: 'server' }),
    wake: async () => null,
    noted: { load: async () => ({ noted: [], seen: {} }), save: async () => {} },
    memory: { load: async () => memory, save: async value => { memory = value } },
    now: () => now,
    loops: { run: async (name, fn) => fn(), failed: () => {} },
  })
  return {
    stuck, dir,
    at: minutes => { now = START + minutes * MIN },
    run: () => supervisor.run(),
    incident: async id => (await readStore(dir)).items.get(id),
  }
}

test('the loop: X1 not found for 59 min stays open, at 60 it is gone by itself with its line; the same key again comes back', async t => {
  const b = await board(t)
  await b.run()
  assert.equal((await b.incident('X1')).head.get('State'), 'open')
  b.stuck.value = false
  for (let minute = 3; minute <= 57; minute += 3) {
    b.at(minute)
    await b.run()
  }
  b.at(59)
  await b.run()
  assert.equal((await b.incident('X1')).head.get('State'), 'open', '59 min not seen')
  b.at(60)
  await b.run()
  const gone = await b.incident('X1')
  assert.equal(gone.head.get('State'), 'gone')
  assert.match(gone.sections.get('History').at(-1), /server: gone by itself: not seen since 14:00 \(60 min of running time\)$/)
  b.stuck.value = true
  b.at(63)
  await b.run()
  const back = await b.incident('X1')
  assert.equal(back.head.get('State'), 'came back')
  assert.match(back.sections.get('History').at(-1), /server: came back \(seen 2 times\)$/)
})

test('the loop: while the person pauses, the rule does not look and the clock stands (no gone after 60 min of pause)', async t => {
  const b = await board(t, { paused: now => now > at(14, 1) && now < at(15, 40) })
  await b.run()
  b.stuck.value = false
  for (let minute = 3; minute <= 99; minute += 3) {
    b.at(minute)
    await b.run()
  }
  assert.equal((await b.incident('X1')).head.get('State'), 'open', 'skipped runs are no "not seen"')
})

test('incident-gone: only the board; only a standing incident not in fix goes gone; only one in fix with a done step goes fixed', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'gone-api-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const NOW = at(9, 0)
  await writeStore(dir, migrateBacklog('# Backlog\n\n## Work\n- [ ] B12 A fix (for Digger; about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  const ctx = { dir, now: NOW, prefix: '', roleOf: chat => ({ ...ROLES, Partner: 'advisor' })[chat] ?? null }
  const board = body => workApi(body, { ...ctx, as: 'server' })
  await recordFindings([{ rule: 'working-not-running', key: 'k1', subject: 'Digger', text: 'one' }, { rule: 'working-not-running', key: 'k2', subject: 'Digger', text: 'two' }], { work: board })
  for (const chat of ['Lead', 'Digger', 'Watcher', 'Partner']) assert.equal((await workApi({ chat, action: 'incident-gone', gone: [{ id: 'X1' }] }, ctx)).status, 403, chat)
  // A fixed list for an incident not in fix changes nothing.
  assert.deepEqual((await board({ action: 'incident-gone', fixed: [{ id: 'X1', notSeenSince: NOW }] })).result.fixed, [])
  const done = await board({ action: 'incident-gone', gone: [{ id: 'X1', notSeenSince: NOW - 60 * MIN }, { id: 'X9' }], minutes: 60 })
  assert.deepEqual([done.ok, done.result.gone], [true, ['X1']])
  assert.equal((await readStore(dir)).items.get('X1').head.get('State'), 'gone')
  assert.equal((await board({ action: 'incident-gone', gone: [{ id: 'X1', notSeenSince: NOW }] })).result.changed, false, 'gone once')
  assert.equal(GONE_MS, 60 * MIN)
})
