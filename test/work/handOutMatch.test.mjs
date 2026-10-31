// Redesign Part 2 (spec 2026-10-24, "Matching, the moment a worker reports idle"): an idle worker that holds no task gets
// the first suitable task of the list; a kept task waits for its worker (T8.5 step 6: the hand-over's decision calls
// `match` for one worker; the take-back and stuck clocks are gone); the board asks for a worker only when ready tasks
// wait and none is idle. Only a chat whose own report says free gets a task (principle 3). Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { idleWorkers, match, workerStart } from '../../src/work/handOut.mjs'
import { parseItem } from '../../src/work/item.mjs'

const T = (h, m, s = 0) => new Date(2026, 9, 25, h, m, s).getTime()
const NOW = T(10, 10)
const MIN = 60_000
const SONNET = 'claude-sonnet-5-5'
const OPUS = 'claude-opus-5-5'

const file = (head, sections = {}) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${Object.entries(sections).map(([name, lines]) => `\n## ${name}\n${lines.join('\n')}\n`).join('')}`)
const step = (id, state, more = {}, sections = {}) => file({ Id: id, Kind: 'step', Title: `Task ${id}`, State: state, Since: '2026-10-25 09:00', ...(state === 'refined' ? { Refined: 'ready' } : {}), ...more }, sections)
const mapOf = items => new Map(items.map(item => [item.head.get('Id'), item]))
/** A worker lane whose chat reports: idle since `since` unless told otherwise. */
const lane = (name, since = T(10, 0), more = {}) => ({
  name, state: 'free', isMain: false, isLeftover: false, isRunning: true, model: SONNET,
  report: { state: 'idle', since, background: false, at: NOW - 2000 }, ...more,
})
const ready = (...ids) => ids.map(id => (typeof id === 'string' ? { id, rank: 2, keptFor: null, keptUntil: null, pinned: null } : { rank: 2, keptFor: null, keptUntil: null, pinned: null, ...id }))
const gives = done => done.map(({ id, chat }) => ({ id, chat }))

test('two workers idle at once: the oldest idle gets the first task, the next the second; the same input, the same answer', () => {
  const items = mapOf([step('B1', 'refined'), step('B2', 'refined'), step('B3', 'refined')])
  const idle = idleWorkers([lane('W2', T(10, 1)), lane('W1', T(10, 0))], { items })
  assert.deepEqual(idle.map(one => one.name), ['W1', 'W2'])
  const first = match({ ready: ready('B1', 'B2', 'B3'), idle, items })
  assert.deepEqual(gives(first), [{ id: 'B1', chat: 'W1' }, { id: 'B2', chat: 'W2' }])
  assert.ok(first.every(one => typeof one.why === 'string' && one.why !== ''))
  assert.deepEqual(match({ ready: ready('B1', 'B2', 'B3'), idle, items }), first)
})

test('a worker already on the task\'s model is preferred', () => {
  const items = mapOf([step('B1', 'refined', {}, { Model: ['opus: the board\'s core'] }), step('B2', 'refined')])
  const idle = idleWorkers([lane('W1', T(10, 0), { model: SONNET }), lane('W2', T(10, 1), { model: OPUS })], { items })
  assert.deepEqual(gives(match({ ready: ready('B1', 'B2'), idle, items })), [{ id: 'B1', chat: 'W2' }, { id: 'B2', chat: 'W1' }])
})

test('a task whose Touches overlap one under way, or one given in this pass, is skipped', () => {
  const touches = path => ({ Context: [`Touches: ${path}`] })
  const steps = [step('B1', 'refined', {}, touches('src/a.mjs')), step('B2', 'refined', {}, touches('src/a.mjs')), step('B3', 'refined', {}, touches('docs/x.md'))]
  const idle = [lane('W1', T(10, 0)), lane('W2', T(10, 1))]
  assert.deepEqual(gives(match({ ready: ready('B1', 'B2', 'B3'), idle, items: mapOf(steps) })), [{ id: 'B1', chat: 'W1' }, { id: 'B3', chat: 'W2' }])
  const busy = mapOf([...steps, step('B9', 'in progress', { Owner: 'W5' }, touches('src'))])
  assert.deepEqual(gives(match({ ready: ready('B1', 'B2', 'B3'), idle, items: busy })), [{ id: 'B3', chat: 'W1' }])
  // A task given and not taken yet counts too.
  const given = mapOf([...steps, step('B8', 'queued', { Owner: 'W6' }, touches('src/a.mjs'))])
  assert.deepEqual(gives(match({ ready: ready('B1', 'B2', 'B3'), idle, items: given })), [{ id: 'B3', chat: 'W1' }])
})

test('a kept task goes to its worker before the list\'s order, and waits while that worker is busy', () => {
  const items = mapOf([step('B4', 'refined'), step('B5', 'refined'), step('B6', 'refined'), step('B7', 'refined')])
  // B5 kept for W2, which is busy: not given; W1 gets the next task that is not kept.
  assert.deepEqual(gives(match({ ready: ready({ id: 'B5', keptFor: 'W2' }, 'B7'), idle: [lane('W1')], items })), [{ id: 'B7', chat: 'W1' }])
  // B6 pinned to W3: only W3 gets it, before the list's first task.
  const idle = [lane('W1', T(10, 0)), lane('W3', T(10, 1))]
  assert.deepEqual(gives(match({ ready: ready('B4', { id: 'B6', keptFor: 'W3', pinned: 'W3' }), idle, items })), [{ id: 'B6', chat: 'W3' }, { id: 'B4', chat: 'W1' }])
  // Its follow-up beats a fix for that worker.
  assert.deepEqual(gives(match({ ready: ready({ id: 'B4', rank: 0 }, { id: 'B7', keptFor: 'W1' }), idle: [lane('W1')], items })), [{ id: 'B7', chat: 'W1' }])
})

test('only a worker whose own report says free gets a task: never by inference, unknown, stuck, suspended or off', () => {
  const items = mapOf([step('B1', 'queued', { Owner: 'W7' }), step('B2', 'in progress', { Owner: 'W8' }), step('B3', 'waiting on you', { Owner: 'W9' })])
  const lanes = [
    lane('W1'),
    lane('W2', T(10, 0), { report: null }),
    lane('W3', T(10, 0), { state: 'unknown', isRunning: null }),
    lane('W4'),
    lane('W5', T(10, 0), { state: 'suspended' }),
    lane('W6', T(10, 0), { state: 'off', isRunning: false }),
    lane('W7'), lane('W8'),
    lane('Main', T(9, 0), { isMain: true }),
    lane('Old', T(9, 0), { isLeftover: true }),
    lane('W9', T(10, 0), { state: 'waiting' }),
    lane('W10', T(10, 0), { report: { state: 'busy', since: T(10, 0), background: false, at: NOW } }),
  ]
  assert.deepEqual(idleWorkers(lanes, { items, stuck: new Set(['W4']) }).map(one => one.name), ['W1'])
  // B567: a worker resting while its task waits on the person counts free.
  assert.deepEqual(idleWorkers(lanes, { items, stuck: new Set(['W4']), restFree: ['W9'] }).map(one => one.name), ['W1', 'W9'])
})

test('the review: a follow-up is a preference: to its worker when idle at the give, else to anyone at once', () => {
  const items = mapOf([step('B1', 'refined'), step('B2', 'refined')])
  const idle = [lane('W1', T(10, 0)), lane('W2', T(10, 1))]
  assert.deepEqual(gives(match({ ready: ready({ id: 'B1', prefers: 'W2' }, 'B2'), idle, items })), [{ id: 'B1', chat: 'W2' }, { id: 'B2', chat: 'W1' }])
  assert.deepEqual(gives(match({ ready: ready({ id: 'B1', prefers: 'W3' }), idle: [lane('W1')], items })), [{ id: 'B1', chat: 'W1' }])
})

test('workerStart: a worker is asked for only when ready tasks wait, none is idle, and fewer run than the setting allows', () => {
  const busy = name => lane(name, T(10, 0), { state: 'working' })
  const off = (name, since) => lane(name, T(9, 0), { state: 'off', isRunning: false, offSince: since })
  const base = { ready: ready('B1'), gives: [], idle: [], isHeld: false }
  assert.equal(workerStart({ ...base, lanes: [busy('W1'), busy('W2')], maxWorkers: null }), null)
  assert.equal(workerStart({ ...base, lanes: [busy('W1'), busy('W2')], maxWorkers: 2 }), null)
  assert.deepEqual(workerStart({ ...base, lanes: [busy('W1'), busy('W2'), off('W3', T(9, 30)), off('W4', T(9, 10))], maxWorkers: 3 }), { start: 'W4' })
  assert.deepEqual(workerStart({ ...base, lanes: [busy('W1'), busy('W2')], maxWorkers: 3 }), { spawn: 1 })
  // The only ready task is pinned to busy W1 (Review Focus 5); the person pauses; an idle worker is left.
  assert.equal(workerStart({ ...base, ready: ready({ id: 'B1', keptFor: 'W1', pinned: 'W1' }), lanes: [busy('W1')], maxWorkers: 3 }), null)
  assert.equal(workerStart({ ...base, lanes: [busy('W1')], maxWorkers: 3, isHeld: true }), null)
  assert.equal(workerStart({ ...base, idle: [lane('W2')], lanes: [busy('W1'), lane('W2')], maxWorkers: 3 }), null)
  // Every ready task given this pass: nothing to start for.
  assert.equal(workerStart({ ...base, gives: [{ id: 'B1', chat: 'W2' }], idle: [lane('W2')], lanes: [busy('W1'), lane('W2')], maxWorkers: 3 }), null)
  // No ready task at all.
  assert.equal(workerStart({ ...base, ready: [], lanes: [busy('W1')], maxWorkers: 3 }), null)
})

test('B-max (the person: "default is 5"): maxWorkers left out is 5 workers at most; given as no number, none', () => {
  const busy = name => lane(name, T(10, 0), { state: 'working' })
  const base = { ready: ready('B1'), gives: [], idle: [], isHeld: false }
  const four = ['W1', 'W2', 'W3', 'W4'].map(busy)
  assert.deepEqual(workerStart({ ...base, lanes: four }), { spawn: 1 })
  assert.equal(workerStart({ ...base, lanes: [...four, busy('W5')] }), null)
  assert.equal(workerStart({ ...base, lanes: four, maxWorkers: null }), null)
})

test('the person: the board never asks for more workers than maxWorkers, the ones on their way included', () => {
  const busy = name => lane(name, T(10, 0), { state: 'working', report: { state: 'busy', since: T(10, 0), at: NOW - 1000 } })
  const nine = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9'].map(busy)
  const base = { ready: ready('B1', 'B2', 'B3'), gives: [], idle: [], isHeld: false, maxWorkers: 10, now: NOW }
  assert.deepEqual(workerStart({ ...base, lanes: nine }), { spawn: 1 })
  // The tenth is on its way and not yet a lane: three tasks wait, but no eleventh.
  const spawned = { id: 's1', at: NOW - MIN, to: 'Lead', command: 'spawn', count: 1, why: 'board', reported: 9, state: 'delivered' }
  assert.equal(workerStart({ ...base, lanes: nine, sent: [spawned] }), null)
  // Ten running: none, however many tasks wait.
  assert.equal(workerStart({ ...base, lanes: [...nine, busy('W10')] }), null)
})

test('the review: a worker on its way counts; a task whose Touches overlap running work asks for none', () => {
  const busy = name => lane(name, T(10, 0), { state: 'working', report: { state: 'busy', since: T(10, 0), at: NOW - 1000 } })
  const three = [busy('W1'), busy('W2'), busy('W3')]
  const base = { ready: ready('B1'), gives: [], idle: [], isHeld: false, maxWorkers: 5, now: NOW }
  assert.deepEqual(workerStart({ ...base, lanes: three }), { spawn: 1 })
  // Asked for one a minute ago (three had reported then); its chat is there, not reported yet: no second ask.
  const spawned = { id: 's1', at: NOW - MIN, to: 'Lead', command: 'spawn', count: 1, why: 'board', reported: 3, state: 'delivered' }
  const starting = lane('W4', T(10, 0), { state: 'unknown', isRunning: null, report: null })
  assert.equal(workerStart({ ...base, lanes: [...three, starting], sent: [spawned] }), null)
  // Two tasks, one worker on its way: one more.
  assert.deepEqual(workerStart({ ...base, ready: ready('B1', 'B2'), lanes: [...three, starting], sent: [spawned] }), { spawn: 1 })
  // Ten minutes on, or once it reported, it is no longer on its way.
  assert.deepEqual(workerStart({ ...base, lanes: three, sent: [{ ...spawned, at: NOW - 11 * MIN }] }), { spawn: 1 })
  // A start of an off worker that has not reported since counts too.
  const off = lane('W4', T(9, 0), { state: 'off', isRunning: false, report: { state: 'ended', since: T(9, 0), at: T(9, 0) } })
  const started = { id: 's2', at: NOW - MIN, to: 'Lead', command: 'start', about: 'W4', state: 'delivered' }
  assert.equal(workerStart({ ...base, lanes: [...three, off], sent: [started] }), null)
  // The recheck: a task the work API refused lately counts for no worker.
  assert.equal(workerStart({ ...base, lanes: three, refused: [{ id: 'B1', chat: 'W9', why: 'x', at: NOW }] }), null)
  // The only ready task overlaps running work: no worker could take it.
  const touches = path => ({ Context: [`Touches: ${path}`] })
  const items = mapOf([step('B1', 'refined', {}, touches('src/a.mjs')), step('B9', 'in progress', { Owner: 'W1' }, touches('src'))])
  assert.equal(workerStart({ ...base, lanes: three, items }), null)
})

test('gap 2: a ready task pinned to a worker whose chat is off has the main chat start that worker, once per start window', () => {
  const busy = name => lane(name, T(10, 0), { state: 'working', report: { state: 'busy', since: T(10, 0), at: NOW - 1000 } })
  const off = name => lane(name, T(9, 0), { state: 'off', isRunning: false, report: null, offSince: null })
  const items = mapOf([step('B590', 'refined', { Pinned: 'W1', Priority: 'fix' })])
  const base = { ready: ready({ id: 'B590', rank: 0, keptFor: 'W1', pinned: 'W1' }), gives: [], idle: [], isHeld: false, maxWorkers: 5, now: NOW, items }
  assert.deepEqual(workerStart({ ...base, lanes: [off('W1'), busy('W2')] }), { start: 'W1', pinned: 'B590' })
  // Also while another worker is idle: a pinned task waits for its own worker only.
  assert.deepEqual(workerStart({ ...base, idle: [lane('W3')], lanes: [off('W1'), busy('W2'), lane('W3')] }), { start: 'W1', pinned: 'B590' })
  // Unknown for longer than offAfterMinutes counts as off; for less, not yet.
  const unknown = at => lane('W1', T(9, 0), { state: 'unknown', isRunning: null, report: { state: 'busy', since: T(9, 0), background: false, at } })
  assert.deepEqual(workerStart({ ...base, lanes: [unknown(NOW - 6 * MIN), busy('W2')], offAfterMs: 5 * MIN }), { start: 'W1', pinned: 'B590' })
  assert.equal(workerStart({ ...base, lanes: [unknown(NOW - 2 * MIN), busy('W2')], offAfterMs: 5 * MIN }), null)
  // Once per start window: no second word within it, whatever came of the first.
  const started = (at, state = 'delivered') => ({ id: 's1', at, to: 'Main', command: 'start', about: 'W1', state })
  assert.equal(workerStart({ ...base, lanes: [off('W1'), busy('W2')], sent: [started(NOW - 9 * MIN)] }), null)
  assert.equal(workerStart({ ...base, lanes: [off('W1'), busy('W2')], sent: [started(NOW - 9 * MIN, 'failed')] }), null)
  assert.deepEqual(workerStart({ ...base, lanes: [off('W1'), busy('W2')], sent: [started(NOW - 11 * MIN)] }), { start: 'W1', pinned: 'B590' })
  // It counts toward maxWorkers; nothing while held (a pause, a full limit) or without maxWorkers.
  assert.equal(workerStart({ ...base, lanes: [off('W1'), busy('W2'), busy('W3')], maxWorkers: 2 }), null)
  assert.equal(workerStart({ ...base, lanes: [off('W1'), busy('W2')], isHeld: true }), null)
  assert.equal(workerStart({ ...base, lanes: [off('W1'), busy('W2')], maxWorkers: null }), null)
  // Its worker runs (busy), is no lane of the list, or the task was refused lately: no start, and never a spawn.
  assert.equal(workerStart({ ...base, lanes: [busy('W1'), busy('W2')] }), null)
  assert.equal(workerStart({ ...base, lanes: [busy('W2')] }), null)
  assert.equal(workerStart({ ...base, lanes: [off('W1'), busy('W2')], refused: [{ id: 'B590', chat: 'W1', why: 'x', at: NOW }] }), null)
})
