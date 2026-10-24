// Incident fixes the board queues itself (2026-10-24, the person's choice B: "B, but ensure that the main knows the board
// can do this so it doesnt try to double assign work to a singler worker if it expect it could be free"). A refined
// board fix an incident waits on goes into a worker's queue by the board, once: a free worker with nothing queued (free
// longest first), else the shortest queue of a worker that waits for nobody. The main chat gets one information line per
// placement, and its own queue for that worker hears of a fresh board fix. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { ASK_MS, GRACE_MS, IDLE_HOLD_MS } from '../../src/config.mjs'
import { memoryStore } from '../../src/store.mjs'
import { incidentCards, stepState } from '../../src/supervisor/cards.mjs'
import { QUEUED_BEHIND_MS, findStuck } from '../../src/supervisor/rules/repair.mjs'
import { workApi } from '../../src/work/api.mjs'
import { deliverWork } from '../../src/work/deliver.mjs'
import { DEFAULT_FLOW } from '../../src/work/flow.mjs'
import { AUTO_QUEUE_MOVE, BOARD_FIX_FRESH_MS, boardLines, boardPlacementOf, flowQueuesFixes, isIncidentFix } from '../../src/work/incidentFix.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { reconcile } from '../../src/work/reconcile.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 24, 21, 40).getTime()
const ago = minutes => NOW - minutes * MIN
const TIMES = { graceMs: GRACE_MS, askMs: ASK_MS, idleMs: IDLE_HOLD_MS }
/** The flow as a project's flow.json says it before the board's own queue of a fix. */
const OLDER_FLOW = { step: { ...DEFAULT_FLOW.step, moves: DEFAULT_FLOW.step.moves.filter(move => move.when !== AUTO_QUEUE_MOVE.when) } }

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)), problem: null })
const step = (id, state, more = {}, history = []) => item({ Id: id, Kind: 'step', Title: `Step ${id}`, State: state, Activity: 'Board', Since: stamp(ago(60)), ...more },
  { History: [`- ${stamp(ago(60))} Advisor: made`, ...history] })
/** A refined board fix, ready, that the incident X4 names as its Fix. */
const fix = (id = 'B20', more = {}, history = []) => step(id, 'refined', { Title: 'Fix of X4: a lane flickers', Priority: 'fix', Refined: 'ready', ...more }, history)
const incident = (id, more = {}) => item({ Id: id, Kind: 'incident', Title: `Something odd ${id}`, State: 'fix', Source: 'old-mod', Subject: 'Worker 1', Key: `odd ${id}`, Since: stamp(ago(30)), 'First seen': stamp(ago(40)), 'Last seen': stamp(ago(30)), Count: '1', ...more })
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, state: 'free', isRunning: true, idle: { since: ago(30) }, ...more })
const MAIN = lane('Main', { isMain: true, state: 'working' })
const plan = (store, lanes, more = {}) => reconcile({ store: { items: store, flow: DEFAULT_FLOW, problems: [], ...more }, lanes, now: NOW, times: TIMES, prefix: '' })
const picks = done => done.autoQueues.map(one => [one.id, one.chat])

test('the default flow lets the board queue a ready incident fix; a flow without that line does not', () => {
  assert.deepEqual(DEFAULT_FLOW.step.moves.find(move => move.when === 'an incident fix is ready'), { from: 'refined', to: 'queued', by: 'server', when: 'an incident fix is ready' })
  assert.deepEqual({ ...AUTO_QUEUE_MOVE }, { from: 'refined', to: 'queued', by: 'server', when: 'an incident fix is ready' })
  assert.equal(flowQueuesFixes(DEFAULT_FLOW), true)
  assert.equal(flowQueuesFixes(OLDER_FLOW), false)
  const store = items(incident('X4', { Fix: 'B20' }), fix())
  assert.deepEqual(picks(plan(store, [MAIN, lane('Worker 2')], { flow: OLDER_FLOW })), [])
  // The flow's general server moves never name it without a worker.
  assert.deepEqual(plan(store, [MAIN, lane('Worker 2')]).moves, [])
})

test('a ready incident fix goes to the free worker with an empty queue, the one free longest', () => {
  const store = items(
    incident('X4', { Fix: 'B20' }), fix(),
    step('B10', 'in progress', { Owner: 'Worker 1' }),
    step('B11', 'queued', { Owner: 'Worker 3', Since: stamp(ago(5)) }),
  )
  const done = plan(store, [
    MAIN,
    lane('Worker 1', { state: 'working' }),
    lane('Worker 2', { idle: { since: ago(20) } }),
    // Free longer, but something waits in its queue.
    lane('Worker 3', { idle: { since: ago(40) } }),
    lane('Worker 4', { idle: { since: ago(10) } }),
    // Free longest, but not running: a running one first.
    lane('Worker 5', { idle: { since: ago(90) }, isRunning: false }),
  ])
  assert.deepEqual(done.autoQueues, [{ id: 'B20', chat: 'Worker 2', tier: 1, main: 'Main', incidents: ['X4'], why: 'queue B20 for Worker 2 (incident fix of X4)' }])
})

test('with no worker free and empty: the shortest queue, never a worker waiting on the person or paused for the limit', () => {
  const store = items(
    incident('X4', { Fix: 'B20' }), fix(),
    step('B10', 'in progress', { Owner: 'Worker 1' }), step('B11', 'queued', { Owner: 'Worker 1' }), step('B12', 'queued', { Owner: 'Worker 1' }),
    step('B13', 'in progress', { Owner: 'Worker 2' }), step('B14', 'queued', { Owner: 'Worker 2' }),
    step('B15', 'waiting on you', { Owner: 'Worker 3' }),
    step('B16', 'in progress', { Owner: 'Worker 4' }),
    // Free, but its queue is not empty: it counts by its queue.
    step('B17', 'queued', { Owner: 'Worker 6' }), step('B18', 'queued', { Owner: 'Worker 6' }),
  )
  const lanes = [
    MAIN,
    lane('Worker 1', { state: 'working' }),
    lane('Worker 2', { state: 'working' }),
    lane('Worker 3', { state: 'free' }),
    lane('Worker 4', { state: 'waiting' }),
    lane('Worker 5', { state: 'suspended' }),
    lane('Worker 6'),
  ]
  assert.deepEqual(picks(plan(store, lanes)), [['B20', 'Worker 2']])
  assert.equal(plan(store, lanes).autoQueues[0].tier, 2)
  // Nobody to take it: it waits, refined.
  assert.deepEqual(picks(plan(store, [MAIN, lane('Worker 3', { state: 'free' }), lane('Worker 4', { state: 'waiting' })])), [])
})

test('two fixes ready at once go to two workers; a title "Fix of X<n>" counts as the incident\'s fix too', () => {
  const store = items(incident('X4', { Fix: 'B20' }), incident('X7', { State: 'with the advisor' }), fix('B20'), fix('B21', { Title: 'Fix of X7: a word is lost' }))
  const done = plan(store, [MAIN, lane('Worker 2', { idle: { since: ago(20) } }), lane('Worker 4', { idle: { since: ago(50) } })])
  assert.deepEqual(picks(done), [['B20', 'Worker 4'], ['B21', 'Worker 2']])
  assert.deepEqual(done.autoQueues.map(one => one.incidents), [['X4'], ['X7']])
  // A third goes to the shortest queue then.
  const three = items(...store.values(), incident('X8', { Fix: 'B22' }), fix('B22', { Title: 'Fix of X8: one more' }))
  assert.deepEqual(picks(plan(three, [MAIN, lane('Worker 2', { idle: { since: ago(20) } }), lane('Worker 4', { idle: { since: ago(50) } })])), [['B20', 'Worker 4'], ['B21', 'Worker 2'], ['B22', 'Worker 2']])
})

test('a fix that is blocked, not ready, not a board fix, of no open incident, asked for before its refine, or queued before waits', () => {
  const lanes = [MAIN, lane('Worker 2')]
  const with20 = (...more) => items(incident('X4', { Fix: 'B20' }), ...more)
  assert.deepEqual(picks(plan(with20(fix('B20', { 'Blocked by': 'B30' }), step('B30', 'in progress', { Owner: 'Worker 1' })), lanes)), [])
  assert.deepEqual(picks(plan(with20(fix('B20', { 'Waits for': 'the person says which' })), lanes)), [])
  // Its blocker done: it goes.
  assert.deepEqual(picks(plan(with20(fix('B20', { 'Blocked by': 'B30' }), step('B30', 'done')), lanes)), [['B20', 'Worker 2']])
  assert.deepEqual(picks(plan(with20(fix('B20', { Refined: '-' })), lanes)), [])
  assert.deepEqual(picks(plan(with20(fix('B20', { Priority: '-' })), lanes)), [])
  assert.deepEqual(picks(plan(items(incident('X4', { Fix: 'B20', State: 'fixed' }), fix('B20')), lanes)), [])
  assert.deepEqual(picks(plan(items(fix('B20')), lanes)), [], 'no incident in the store')
  assert.deepEqual(picks(plan(with20(fix('B20', { 'Queue when refined': 'for Worker 3' })), lanes)), [])
  const unqueued = [`- ${stamp(ago(30))} Main: refined → queued`, `- ${stamp(ago(30))} Main: queued for Worker 3`, `- ${stamp(ago(20))} Main: queued → refined (unqueued; was Worker 3)`]
  assert.deepEqual(picks(plan(with20(fix('B20', {}, unqueued)), lanes)), [], 'the main chat took it out of a queue: it stays out')
  // An open ask under it holds it.
  const asked = item({ Id: 'Q5', Kind: 'ask', Title: 'Which lane?', State: 'open', Of: 'B20', Since: stamp(ago(5)), Blocking: 'no' })
  assert.deepEqual(picks(plan(with20(fix('B20'), asked), lanes)), [])
  // Not while the person pauses.
  assert.deepEqual(picks(plan(with20(fix('B20')), lanes, { pause: { state: 'pausing', since: stamp(ago(1)) } })), [])
})

/** A store on disk with the incident X4, its ready fix B20, a plain refined step B30 and the chats' roles. */
async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'auto-queue-'))
  const all = items(incident('X4', { Fix: 'B20' }), fix('B20'), step('B30', 'refined', { Refined: 'ready' }), step('B31', 'refined', { Refined: 'ready' }))
  await writeStore(dir, { items: all, activities: [{ name: 'Board', isFocus: false, steps: ['B20', 'B30', 'B31'], notes: [], loose: [] }] }, undefined, { now: ago(60) })
  const roles = { Main: 'main', 'Worker 2': 'worker', 'Worker 3': 'worker' }
  const ctx = at => ({ dir, now: at, prefix: '', roleOf: chat => roles[chat] ?? null, freeChats: new Set(['Worker 2', 'Worker 3']), chats: Object.keys(roles) })
  const server = (body, at = NOW) => workApi(body, { ...ctx(at), as: 'server' })
  const main = (body, at = NOW) => workApi({ chat: 'Main', ...body }, ctx(at))
  const read = async () => (await readStore(dir)).items
  const free = [MAIN, lane('Worker 2', { idle: { since: ago(20) } }), lane('Worker 3', { idle: { since: ago(10) } })]
  const planNow = async (lanes = free) => reconcile({ store: { ...(await readStore(dir)) }, lanes, now: NOW, times: TIMES, prefix: '' })
  return { dir, server, main, read, planNow }
}
const cleanUp = dir => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

test('the board queues it once: History says so, a second try and a restart do nothing, a step taken out stays out', async () => {
  const { dir, server, main, read, planNow } = await fresh()
  try {
    assert.deepEqual(picks(await planNow()), [['B20', 'Worker 2']])
    const done = await server({ action: 'advance', id: 'B20', to: 'queued', for: 'Worker 2' })
    assert.equal(done.ok, true, done.why)
    assert.equal(done.result.text, 'B20: queued by the board for Worker 2 (incident fix of X4).')
    assert.deepEqual(done.result.boardQueued, {
      id: 'B20', chat: 'Worker 2', since: '2026-10-24 21:40', text: 'The board queued B20 (incident fix of X4) for Worker 2, first in its queue. Information only: nothing to do.',
    })
    const twenty = (await read()).get('B20')
    assert.deepEqual(['State', 'Owner', 'Priority'].map(key => valueOf(twenty, key)), ['queued', 'Worker 2', 'fix'])
    assert.deepEqual(twenty.sections.get('History').slice(-2), [
      '- 2026-10-24 21:40 server: refined → queued',
      '- 2026-10-24 21:40 server: queued by the board for Worker 2 (incident fix of X4)',
    ])
    // Again, and after a restart (the store read anew): nothing more.
    const again = await server({ action: 'advance', id: 'B20', to: 'queued', for: 'Worker 3' })
    assert.equal(again.ok, false)
    assert.equal(again.status, 409)
    assert.equal(valueOf((await read()).get('B20'), 'Owner'), 'Worker 2')
    assert.deepEqual(picks(await planNow()), [])
    // The main chat takes it out of the queue: refined again, but the board never queues it again.
    assert.equal((await main({ action: 'unqueue', id: 'B20' })).ok, true)
    assert.equal(valueOf((await read()).get('B20'), 'State'), 'refined')
    assert.deepEqual(picks(await planNow()), [])
    assert.equal((await server({ action: 'advance', id: 'B20', to: 'queued', for: 'Worker 2' }, NOW + MIN)).ok, false)
    // Only the board does it.
    assert.equal((await main({ action: 'advance', id: 'B31', to: 'queued', for: 'Worker 2' })).status, 403)
  } finally {
    await cleanUp(dir)
  }
})

test('a step the main chat queued in the meantime is left alone, and the main chat hears nothing of it', async () => {
  const { dir, main, read, planNow, server } = await fresh()
  try {
    const before = await planNow()
    assert.deepEqual(picks(before), [['B20', 'Worker 2']])
    assert.equal((await main({ action: 'queue', id: 'B20', for: 'Worker 3' })).ok, true)
    const outbox = memoryStore()
    const state = { reconciled: { moves: [], deliveries: [], autoQueues: before.autoQueues, boardLines: [] }, chats: [MAIN, lane('Worker 2'), lane('Worker 3')], chatPrefix: '' }
    const done = await deliverWork({ state, dir, outbox, apply: body => server(body), now: NOW, maxChars: 2000, newId: () => 'm1' })
    assert.deepEqual(done.moved, [])
    assert.equal(valueOf((await read()).get('B20'), 'Owner'), 'Worker 3')
    assert.equal(outbox.outbox().length, 0)
    assert.equal(boardPlacementOf((await read()).get('B20')), null)
  } finally {
    await cleanUp(dir)
  }
})

test('the flow without the board\'s line: the board does not queue it, and says which line is missing', async () => {
  const { dir, server, read } = await fresh()
  try {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'flow.json'), JSON.stringify(OLDER_FLOW))
    const done = await server({ action: 'advance', id: 'B20', to: 'queued', for: 'Worker 2' })
    assert.equal(done.status, 409)
    assert.match(done.why, /flow\.json lacks \{"from":"refined","to":"queued","by":"server","when":"an incident fix is ready"\}/)
    assert.equal(valueOf((await read()).get('B20'), 'State'), 'refined')
  } finally {
    await cleanUp(dir)
  }
})

test('the main chat gets one information line per placement: at once, never twice, also after a restart', async () => {
  const { dir, server, planNow } = await fresh()
  try {
    let n = 0
    const deliver = async (outbox, at = NOW) => {
      const done = await planNow()
      const state = { reconciled: { moves: [], deliveries: [], autoQueues: done.autoQueues, boardLines: done.boardLines }, chats: [MAIN, lane('Worker 2'), lane('Worker 3')], chatPrefix: '' }
      return deliverWork({ state, dir, outbox, apply: body => server(body, at), now: at, maxChars: 2000, newId: () => `m${(n += 1)}` })
    }
    const outbox = memoryStore()
    const first = await deliver(outbox)
    assert.deepEqual(first.moved, ['B20'])
    const lines = outbox.outbox().filter(one => one.to === 'Main')
    assert.deepEqual(lines.map(one => [one.command, one.kind, one.about, one.state, one.text]), [
      ['work', 'board-queued', 'B20', 'waiting', 'The board queued B20 (incident fix of X4) for Worker 2, first in its queue. Information only: nothing to do.'],
    ])
    // The next refreshes name it again from the store (boardLines) under the same key: nothing new, and the line holds.
    assert.equal((await planNow()).boardLines.length, 1)
    await deliver(outbox, NOW + MIN)
    await deliver(outbox, NOW + 2 * MIN)
    assert.equal(outbox.outbox().filter(one => one.to === 'Main').length, 1)
    assert.equal(outbox.outbox().find(one => one.to === 'Main').state, 'waiting')
    // A board started anew, with an empty outbox: the key stands in delivered.json.
    const anew = memoryStore()
    await deliver(anew, NOW + 3 * MIN)
    assert.equal(anew.outbox().filter(one => one.to === 'Main').length, 0)
  } finally {
    await cleanUp(dir)
  }
})

test('the main chat\'s queue for a worker that just got a board fix says so in one line; it is not refused', async () => {
  const { dir, server, main } = await fresh()
  try {
    assert.equal((await server({ action: 'advance', id: 'B20', to: 'queued', for: 'Worker 2' })).ok, true)
    const queued = await main({ action: 'queue', id: 'B30', for: 'Worker 2' }, NOW + 3 * MIN)
    assert.equal(queued.ok, true, queued.why)
    assert.equal(queued.result.boardFix, 'Worker 2 got B20, a board fix, at 21:40; your step goes after it.')
    assert.match(queued.result.text, /^Worker 2 got B20, a board fix, at 21:40; your step goes after it\.\n/)
    // Another worker: nothing said. A requeue to the worker with the fix: said too.
    const other = await main({ action: 'queue', id: 'B31', for: 'Worker 3' }, NOW + 3 * MIN)
    assert.equal(other.ok, true, other.why)
    assert.equal(other.result.boardFix, undefined)
    const moved = await main({ action: 'requeue', id: 'B31', for: 'Worker 2' }, NOW + 4 * MIN)
    assert.equal(moved.result.boardFix, 'Worker 2 got B20, a board fix, at 21:40; your step goes after it.')
    // Long enough after it, nothing is said.
    const later = await main({ action: 'requeue', id: 'B30', for: 'Worker 3' }, NOW + BOARD_FIX_FRESH_MS + MIN)
    assert.equal(later.ok, true)
    const back = await main({ action: 'requeue', id: 'B30', for: 'Worker 2' }, NOW + BOARD_FIX_FRESH_MS + 2 * MIN)
    assert.equal(back.ok, true)
    assert.equal(back.result.boardFix, undefined)
  } finally {
    await cleanUp(dir)
  }
})

test('a board fix queued behind a busy worker goes to a worker that came free: the board moves it, not the main chat', () => {
  const placedAt = ago(25)
  const history = [`- ${stamp(placedAt)} server: refined → queued`, `- ${stamp(placedAt)} server: queued by the board for Worker 1 (incident fix of X4)`]
  const board = fix('B20', { State: 'queued', Owner: 'Worker 1', Since: stamp(placedAt) }, history)
  const mains = step('B21', 'queued', { Owner: 'Worker 1', Since: stamp(ago(24)) }, [`- ${stamp(ago(24))} Main: refined → queued`, `- ${stamp(ago(24))} Main: queued for Worker 1`])
  const view = {
    items: items(incident('X4', { Fix: 'B20' }), board, mains, step('B10', 'in progress', { Owner: 'Worker 1' })),
    lanes: [MAIN, lane('Worker 1', { state: 'working' }), lane('Worker 2', { idle: { since: ago(40) } }), lane('Worker 3', { idle: { since: ago(30) } })],
    prefix: '', now: NOW, outbox: [], limits: {}, pause: null, refused: [],
  }
  assert.ok(NOW - placedAt > QUEUED_BEHIND_MS)
  const found = findStuck(view).filter(one => one.check === 'queued-behind')
  assert.deepEqual(found.map(one => [one.subject, one.fix.do, one.fix.to ?? null]), [['B20', 'requeue', 'Worker 2'], ['B21', 'send', null]])
  assert.match(found[0].text, /^B20, an incident fix the board queued, waited 25 min behind Worker 1 while Worker 2 is free$/)
  // Once the board moved it, the main chat's line says so.
  const moved = fix('B20', { State: 'queued', Owner: 'Worker 2', Since: stamp(NOW) }, [...history, `- ${stamp(NOW)} server: requeued for Worker 2 (was Worker 1) (the board's sync check: ${found[0].text})`])
  assert.deepEqual(boardPlacementOf(moved), { chat: 'Worker 2', at: NOW, stamp: stamp(NOW), moved: true, incidents: ['X4'] })
  assert.deepEqual(boardLines({ steps: [moved], main: 'Main', prefix: '', now: NOW }).map(one => one.text), ['The board moved B20 (incident fix of X4) to Worker 2, first in its queue. Information only: nothing to do.'])
  // The main chat moved it on: no longer the board's placement.
  const byMain = fix('B20', { State: 'queued', Owner: 'Worker 3', Since: stamp(NOW) }, [...history, `- ${stamp(NOW)} Main: requeued for Worker 3 (was Worker 1)`])
  assert.equal(boardPlacementOf(byMain), null)
})

test('focus-ready leaves a fix the board queues now to the board', () => {
  const view = (autoQueued = []) => ({
    items: items(incident('X4', { Fix: 'B20' }), fix('B20')), lanes: [MAIN, lane('Worker 2', { idle: { since: ago(40) } })],
    prefix: '', now: NOW, outbox: [], limits: {}, pause: null, refused: [], ...(autoQueued.length > 0 ? { autoQueued } : {}),
  })
  const focusReady = REPAIRS => REPAIRS.find(rule => rule.id === 'focus-ready')
  return import('../../src/supervisor/rules/repair.mjs').then(({ REPAIR_RULES }) => {
    const rule = focusReady(REPAIR_RULES)
    assert.equal(rule.check(view(), {}).length, 1, 'the flow without the board\'s line: named to the main chat as before')
    assert.equal(rule.check(view(['B20']), {}).length, 0)
  })
})

test('the Supervisor section\'s card says the board queues a ready fix, and for whom it queued it', () => {
  const store = items(incident('X4', { Fix: 'B20' }), fix('B20'))
  assert.equal(isIncidentFix(store.get('B20'), store), true)
  assert.equal(stepState(store.get('B20'), { items: store, boardQueues: true }).text, 'refined · the board queues it')
  assert.equal(stepState(store.get('B20'), { items: store }).text, 'refined · waits for Main')
  const history = [`- ${stamp(NOW)} server: refined → queued`, `- ${stamp(NOW)} server: queued by the board for Worker 2 (incident fix of X4)`]
  const queued = fix('B20', { State: 'queued', Owner: 'Worker 2' }, history)
  assert.equal(stepState(queued, {}).text, 'queued by the board for Worker 2')
  assert.equal(stepState(step('B21', 'queued', { Owner: 'Worker 2' }), {}).text, 'queued for Worker 2')
  const cards = incidentCards({ incidents: [{ id: 'X4', state: 'fix', fix: 'B20', since: NOW }], items: items(incident('X4', { Fix: 'B20' }), fix('B20')), boardQueues: true })
  assert.deepEqual(cards.map(card => [card.step, card.state.text]), [['B20', 'refined · the board queues it']])
})
