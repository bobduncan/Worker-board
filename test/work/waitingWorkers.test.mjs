// F74 (the person, 2026-11-26: a worker whose work only waits takes something new, "but after it's finished it should give priority to
// work thats almost completed vs completely new items. so it doesnt stall"; the live case: three ready World 2-4 maps waited from 09:08
// with no worker while Worker 1 held a step blocked by two others for 14 hours and Worker 4 one that waited for its go-live). The spec:
// .claude/plans/2026-11-26-status-by-theme-design.md section 9, points a to h; chat 1's six changes of 2026-11-26. Made-up names only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { DEFAULT_FLOW } from '../../src/work/flow.mjs'
import { NEARLY_RANK, idleWorkers, readyList } from '../../src/work/handOut.mjs'
import { STATES, decide, holdingOf, holdsForGive } from '../../src/work/handover.mjs'
import { factsOf } from '../../src/work/handoverBoard.mjs'
import { HELD_RANK, heldOf, pickHeld } from '../../src/work/held.mjs'
import { parseItem, valueOf } from '../../src/work/item.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { heldReason, onlyWaits, parkWords, parkedAfter, waitOf, waitingIds, waitsFree } from '../../src/work/parked.mjs'
import { reconcile } from '../../src/work/reconcile.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'
import { waitsOnLine } from '../../src/work/waitsOn.mjs'
import { fiveHourStopDue, holdsOpenStep, unblockedDue, weekStopDue } from '../../src/say.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 26, 9, 8).getTime()
const ago = minutes => NOW - minutes * MIN
const TIMES = { graceMs: 10 * MIN, askMs: 60 * MIN, idleMs: 5 * MIN }

const file = (head, sections = {}) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${Object.entries(sections).map(([name, lines]) => `\n## ${name}\n${lines.join('\n')}\n`).join('')}`)
const step = (id, state, more = {}, sections = {}) => file({ Id: id, Kind: 'step', Title: `Step ${id}`, State: state, Since: stamp(ago(90)), ...(state === 'refined' ? { Refined: 'ready' } : {}), ...more }, sections)
const mapOf = items => new Map(items.map(item => [item.head.get('Id'), item]))
const said = (minutesAgo, who, words) => `- ${stamp(ago(minutesAgo))} ${who}: ${words}`
const worker = (name, more = {}) => ({ name, state: 'free', isMain: false, isLeftover: false, isRunning: true, mod: '0.34.0', report: { state: 'idle', since: ago(30), at: ago(1) }, resting: null, ...more })
const readyOf = (...ids) => ids.map(id => ({ id, rank: 1, keptFor: null, keptUntil: null, pinned: null }))

// The live case's shapes: Worker 1 holds B1442 in progress, blocked by B1440 (in review, its landing not run); B1500 is a ready focus step.
const blocked = (more = {}) => step('B1442', 'in progress', { Owner: 'Worker 1', 'Blocked by': 'B1440', Branch: 'b1442-sandbox', Goal: 'G108', ...more }, { History: [said(600, 'Worker 1', 'queued → taken'), said(590, 'Worker 1', 'taken → in progress')] })
const blocker = (state = 'review') => step('B1440', state, { Owner: 'Worker 3', Branch: 'b1440-isle', Goal: 'G108' })
const focusStep = (id = 'B1500') => step(id, 'refined', { Goal: 'G108' })

test('a: the record a held step waits on: a blocker not done, a Waits on record, its branch in the landing slot; a checkpoint\'s words, a done blocker and a blocker the store lacks are none', () => {
  const items = mapOf([blocked(), blocker()])
  assert.deepEqual(waitOf(items.get('B1442'), items), { kind: 'blocked', on: ['B1440'], words: 'blocked by B1440' })
  assert.equal(onlyWaits(items.get('B1442'), items), true)
  // the blocker done, or dropped, or gone from the store: no wait
  for (const state of ['done', 'dropped']) assert.equal(waitOf(items.get('B1442'), mapOf([blocked(), blocker(state)])), null, state)
  assert.equal(waitOf(items.get('B1442'), mapOf([blocked()])), null, 'a blocker the store lacks is gone')
  // a Waits on record, whoever it names
  const waits = step('B1081', 'in progress', { Owner: 'Worker 4', 'Waits on': waitsOnLine('chat 1', 'its go to land', ago(40)), Branch: 'b1081-x' })
  assert.deepEqual(waitOf(waits, mapOf([waits])), { kind: 'chat', who: 'chat 1', what: 'its go to land', since: ago(40), words: 'waits on chat 1 (its go to land)' })
  // its branch is the one a landing runs for now (as the gate log names branches)
  const landing = step('B1442', 'in progress', { Owner: 'Worker 1', Branch: 'qa/b1442-x' })
  assert.deepEqual(waitOf(landing, mapOf([landing]), { landing: 'qa-b1442-x' }), { kind: 'landing', branch: 'qa/b1442-x', words: 'its landing runs' })
  assert.equal(waitOf(landing, mapOf([landing]), { landing: 'another-branch' }), null)
  assert.equal(waitOf(landing, mapOf([landing]), { landing: null }), null)
  // a wait that stands only in a checkpoint's words (B417's case) is none; a step in review or done is nobody's wait
  const words = step('B417', 'in progress', { Owner: 'Worker 2', Checkpoint: 'abc1234 · waits for chat 1\'s go to land · 2026-11-26 08:00:00' })
  assert.equal(waitOf(words, mapOf([words])), null)
  assert.equal(waitOf(step('B9', 'review', { Owner: 'Worker 2', 'Blocked by': 'B1440' }), mapOf([blocker()])), null)
  assert.equal(waitOf(null, items), null)
  // the order of the records: a blocker first, then the chat wait, then the landing
  const all = step('B7', 'taken', { Owner: 'Worker 2', 'Blocked by': 'B1440', 'Waits on': waitsOnLine('chat 1', 'a review', ago(5)), Branch: 'b7' })
  assert.equal(waitOf(all, mapOf([all, blocker()]), { landing: 'b7' }).kind, 'blocked')
  assert.equal(waitOf(all, mapOf([all, blocker('done')]), { landing: 'b7' }).kind, 'chat')
  assert.deepEqual([...waitingIds(mapOf([blocked(), blocker(), focusStep(), waits]))], ['B1442', 'B1081'])
  assert.equal(heldReason(items.get('B1442'), items), 'blocked by B1440')
  assert.equal(heldReason(landing, mapOf([landing]), { landing: 'qa-b1442-x' }), 'its landing runs')
})

test('a, d: a worker whose ONE held step only waits counts free (waitsFree, idleWorkers, holdingOf, holdsForGive); one that holds two steps, whatever their states, does not; a suspended or stopped lane does not', () => {
  const items = mapOf([blocked(), blocker(), focusStep()])
  const waiting = waitingIds(items)
  const lane = worker('Worker 1')
  assert.equal(waitsFree(lane, items), true)
  assert.deepEqual(idleWorkers([lane], { items, waiting, restFree: ['Worker 1'] }).map(one => one.name), ['Worker 1'])
  assert.equal(holdingOf(items, 'Worker 1', '', waiting), undefined, 'the hand-over sees no held step')
  assert.equal(holdsForGive(items, 'Worker 1', '', waiting), false)
  // without the pass's set, today's reading stands (the waiting step holds its worker)
  assert.equal(holdsForGive(items, 'Worker 1'), true)
  assert.deepEqual(idleWorkers([lane], { items, restFree: ['Worker 1'] }), [])
  // two steps: a waiting one and a given one; a waiting one and an active one; two waiting ones: never a third
  for (const second of [step('B1500', 'queued', { Owner: 'Worker 1' }), step('B1500', 'in progress', { Owner: 'Worker 1' }), step('B1500', 'waiting on you', { Owner: 'Worker 1' }), step('B1441', 'taken', { Owner: 'Worker 1', 'Blocked by': 'B1440' })]) {
    const two = mapOf([blocked(), blocker(), second])
    const set = waitingIds(two)
    assert.equal(waitsFree(lane, two), false, `${valueOf(second, 'Id')} ${valueOf(second, 'State')}`)
    assert.deepEqual(idleWorkers([lane], { items: two, waiting: set, restFree: ['Worker 1'] }), [], `${valueOf(second, 'Id')} ${valueOf(second, 'State')}`)
    assert.equal(holdsForGive(two, 'Worker 1', '', set), true)
  }
  // a lane that does not run, is suspended (a pause, a limit), is the main chat or a leftover: not free by this
  for (const off of [{ isRunning: false }, { state: 'suspended' }, { isMain: true }, { isLeftover: true }]) assert.equal(waitsFree(worker('Worker 1', off), items), false, JSON.stringify(off))
  // a worker holding an active step is not free, as before
  assert.equal(waitsFree(worker('Worker 3'), items), false)
})

test('e: every one-step reader follows the active step: a waiting step is left out of the held pick, a parked one ranks last; with only a waiting step the worker holds none for the row', () => {
  const items = mapOf([blocked(), blocker(), step('B1500', 'taken', { Owner: 'Worker 1' }, { History: [said(3, 'Worker 1', 'queued → taken')] })])
  const waiting = waitingIds(items)
  const mine = [items.get('B1442'), items.get('B1500')]
  assert.equal(valueOf(pickHeld(mine, 'Worker 1', '', null, waiting, items), 'Id'), 'B1500', 'the active one, although B1442 is in progress and ranks first by state')
  assert.equal(valueOf(pickHeld(mine, 'Worker 1'), 'Id'), 'B1442', 'without the set, today\'s rank by state')
  assert.equal(pickHeld([items.get('B1442')], 'Worker 1', '', null, waiting, items), undefined, 'a worker whose every held step waits holds none for the row')
  assert.equal(heldOf(items, 'Worker 1', '', { waiting }).id, 'B1500')
  assert.equal(heldOf(mapOf([blocked(), blocker()]), 'Worker 1', '', { waiting }), null)
  // parked behind the active one (its wait ended while the worker was on B1500): last, so the row follows B1500
  const parked = step('B1442', 'in progress', { Owner: 'Worker 1', Branch: 'b1442-sandbox' }, { History: [said(590, 'Worker 1', 'taken → in progress'), said(2, 'server', parkWords('B1500'))] })
  const withParked = mapOf([parked, blocker('done'), items.get('B1500')])
  assert.equal(parkedAfter(parked, withParked), 'B1500')
  assert.equal(valueOf(pickHeld([parked, items.get('B1500')], 'Worker 1', '', null, waitingIds(withParked), withParked), 'Id'), 'B1500')
  assert.equal(heldReason(parked, withParked), 'resumes after B1500', 'held-elsewhere stays quiet')
  // a move after the park cancels it (the resume writes one)
  const resumed = step('B1442', 'in progress', { Owner: 'Worker 1' }, { History: [said(2, 'server', parkWords('B1500')), said(1, 'server', 'waiting on you → in progress (resumes after B1500)')] })
  assert.equal(parkedAfter(resumed, mapOf([resumed])), null)
  assert.deepEqual(HELD_RANK, ['in progress', 'waiting on you', 'taken'])
})

test('c: the order of the ready list: checks of finished work, then nearly finished work (a fix of a built step), then board repairs, the focus goal, the backup goal, the rest', () => {
  const items = mapOf([
    step('B1', 'refined', { Goal: 'G1' }), step('B2', 'refined', { Priority: 'fix' }), step('B3', 'refined', { Goal: 'G108' }),
    step('B4', 'refined', { 'Fix of': 'B40' }, { History: [said(20, 'Partner', 'made by the result check of B40')] }), step('B40', 'review', { Owner: 'Worker 2' }),
    step('B5', 'refined', { Goal: 'G2' }),
  ])
  const list = readyList(items, { now: NOW, focus: 'G108', backup: 'G2', followUpMs: 0, beyondFocus: true })
  assert.deepEqual(list.ready.map(one => [one.id, one.rank]), [['B4', NEARLY_RANK], ['B2', 0], ['B3', 1], ['B5', 1.5], ['B1', 2]])
  assert.equal(NEARLY_RANK, -0.5, 'after the checks (-1), before the repairs (0)')
})

test('the hand-over: a worker holding only a waiting step is given the next ready step; with an active step beside it, the decision is about the active one; two held steps get nothing', () => {
  const items = mapOf([blocked(), blocker(), focusStep()])
  const lane = worker('Worker 1')
  const waiting = waitingIds(items)
  const handing = decide({ worker: lane, items, ready: readyOf('B1500'), now: NOW, event: { kind: 'turn-ended', since: ago(5) }, waiting })
  assert.equal(handing.state, STATES.HANDING)
  assert.equal(handing.give, 'B1500')
  // without the set the worker is the holder of B1442, as today
  assert.equal(decide({ worker: lane, items, ready: readyOf('B1500'), now: NOW, event: { kind: 'turn-ended', since: ago(5) } }).give, null)
  // the facts carry the set, read from the items and the landing
  const facts = factsOf({ lane, state: { chatPrefix: '' }, items, pause: null, sent: [], config: {}, now: NOW, event: { kind: 'pass' }, landing: null })
  assert.deepEqual([...facts.waiting], ['B1442'])
  // given B1500 and taken: the decision is about B1500; B1442 stays its waiting step
  const working = mapOf([blocked(), blocker(), step('B1500', 'in progress', { Owner: 'Worker 1' }, { History: [said(3, 'Worker 1', 'queued → taken'), said(2, 'Worker 1', 'taken → in progress')] })])
  const busy = decide({ worker: { ...lane, state: 'working', report: { state: 'working', since: ago(2), at: ago(1) } }, items: working, ready: readyOf('B1501'), now: NOW, waiting: waitingIds(working) })
  assert.deepEqual([busy.state, busy.step, busy.give], [STATES.WORKING, 'B1500', null])
  // B1500 reported and B1442 still waiting: free again for a new step; two waiting steps: nothing
  const twoWaiting = mapOf([blocked(), blocker(), step('B1441', 'taken', { Owner: 'Worker 1', 'Blocked by': 'B1440' }), focusStep('B1501')])
  assert.equal(decide({ worker: lane, items: twoWaiting, ready: readyOf('B1501'), now: NOW, event: { kind: 'turn-ended', since: ago(5) }, waiting: waitingIds(twoWaiting) }).give, null, 'the cap of two')
})

test('h, chat 1\'s 5: a worker whose only held step waits gets no stop word of the limits (it has no active step to bring to a safe point); one with an active step does', () => {
  const full = { limits: { fiveHour: { level: 'full', used: 96, stopAt: 95, resetsAt: NOW + 60 * MIN }, week: { level: 'full', used: 99, stopAt: 98, resetsAt: NOW + 5 * 24 * 60 * MIN } }, pause: null }
  const waitsOnly = { name: 'Worker 1', isMain: false, isLeftover: false, state: 'working', isRunning: true, storeSteps: [{ id: 'B1442', title: 'x', state: 'in progress', waits: true }] }
  const active = { ...waitsOnly, name: 'Worker 2', storeSteps: [{ id: 'B1442', title: 'x', state: 'in progress', waits: true }, { id: 'B1500', title: 'y', state: 'taken', waits: false }] }
  assert.equal(holdsOpenStep({ reconciled: null }, waitsOnly), false)
  assert.equal(holdsOpenStep({ reconciled: null }, active), true)
  assert.deepEqual(fiveHourStopDue({ ...full, chats: [waitsOnly, active] }, []).map(one => one.to), ['Worker 2'])
  assert.deepEqual(weekStopDue({ ...full, chats: [waitsOnly, active] }, []).map(one => one.to), ['Worker 2'])
})

test('b: the board\'s one word when the blocker is done: "it resumes when you report B<new>" with another step active, "go on with it" with none; once per unblock, never while the person pauses', () => {
  const unblocked = { id: 'B1442', title: 'x', state: 'in progress', waits: false, unblocked: { by: 'B1440', at: ago(2) } }
  const withActive = { name: 'Worker 1', isMain: false, isLeftover: false, state: 'working', isRunning: true, storeSteps: [unblocked, { id: 'B1500', title: 'y', state: 'in progress', waits: false, unblocked: null }] }
  const alone = { ...withActive, name: 'Worker 2', storeSteps: [unblocked] }
  const words = unblockedDue({ pause: null, chats: [withActive, alone] }, [])
  assert.deepEqual(words.map(one => [one.to, one.command, one.about, one.text]), [
    ['Worker 1', 'unblocked', 'B1442', 'B1442 is no longer blocked by B1440: it resumes when you report B1500.'],
    ['Worker 2', 'unblocked', 'B1442', 'B1442 is no longer blocked by B1440: go on with it.'],
  ])
  assert.deepEqual(unblockedDue({ pause: null, chats: [withActive, alone] }, [{ command: 'unblocked', to: 'Worker 1', about: 'B1442', at: ago(1) }]).map(one => one.to), ['Worker 2'], 'told once')
  assert.deepEqual(unblockedDue({ pause: null, chats: [withActive] }, [{ command: 'unblocked', to: 'Worker 1', about: 'B1442', at: ago(10) }]).map(one => one.to), ['Worker 1'], 'a word from before this unblock does not count')
  assert.deepEqual(unblockedDue({ pause: { state: 'pausing', since: ago(1) }, chats: [withActive] }, []), [])
  assert.deepEqual(unblockedDue({ pause: null, chats: [{ ...alone, isRunning: false }] }, []), [], 'a worker that does not run gets its wake with its step')
})

// ---- the live case replayed through the work API and the reconciler (b, d, g, the resume first)
const ROLES = { Lead: 'main', 'Worker 1': 'worker', 'Worker 3': 'worker', Partner: 'advisor' }
async function garden(items, { landing = null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'f74-'))
  const byId = mapOf(items)
  await writeStore(dir, { items: byId, activities: [{ name: 'Maps', isFocus: true, steps: [...byId.keys()], notes: [], loose: [] }] }, undefined, { now: ago(600) })
  const ctx = (at = NOW) => ({ dir, now: at, prefix: '', roleOf: chat => ROLES[chat] ?? null, chats: Object.keys(ROLES), overlapsOfStore: true, landingNow: () => landing })
  return {
    dir,
    server: (body, at) => workApi(body, { ...ctx(at), as: 'server' }),
    person: (body, at) => workApi(body, { ...ctx(at), as: 'person' }),
    as: chat => (body, at) => workApi({ chat, ...body }, ctx(at)),
    read: async () => (await readStore(dir)).items,
  }
}
const historyOf = item => (item.sections.get('History') ?? []).map(String)

test('the live case replayed: Worker 1 holds B1442 blocked by the unlanded B1440; it gets the ready focus step B1500 (B1442 parked behind it); a third is refused; B1440 done frees B1442 (its word comes once); B1500 reported hands B1442 back first', async () => {
  const { dir, server, person, as, read } = await garden([blocked(), blocker(), focusStep(), focusStep('B1501')])
  try {
    const w1 = as('Worker 1')
    // The reconciler counts Worker 1 free (its one held step only waits).
    const pass = reconcile({ store: { items: await read(), flow: DEFAULT_FLOW, problems: [], pause: null }, lanes: [worker('Worker 1'), worker('Worker 3', { state: 'working', report: { state: 'working', since: ago(30), at: ago(1) } })], now: NOW, times: TIMES, prefix: '', focus: 'G108', settings: { maxWorkers: 5, handover: 'sequence' } })
    assert.deepEqual([pass.waitFree, pass.waiting], [['Worker 1'], ['B1442']])
    // The give: B1500 to Worker 1, and B1442 parked behind it.
    const given = await server({ action: 'advance', to: 'queued', id: 'B1500', for: 'Worker 1' })
    assert.equal(given.ok, true, JSON.stringify(given))
    assert.equal(given.result.parked, 'B1442')
    let items = await read()
    assert.match(historyOf(items.get('B1442')).at(-1), /server: parked \(resumes after B1500\)$/)
    assert.equal(parkedAfter(items.get('B1442'), items), 'B1500')
    assert.equal(valueOf(items.get('B1442'), 'State'), 'in progress', 'its state is untouched')
    // No third: the cap of two.
    const third = await server({ action: 'advance', to: 'queued', id: 'B1501', for: 'Worker 1' })
    assert.equal(third.ok, false)
    assert.match(third.why, /holds B1442 and B1500: no third task/)
    // Its next list says what B1442 does.
    assert.equal((await w1({ action: 'take', minutes: 60, id: 'B1500', branch: 'b1500-isle' })).ok, true)
    const next = (await w1({ action: 'next' })).result
    assert.match(next.text, /- B1442 in progress \(.*parked: blocked by B1440; it resumes after B1500 is reported\)/)
    // B1440 goes done: B1442 is no longer blocked, and still parked (Worker 1 is on B1500).
    const landed = await person({ action: 'tick', id: 'B1440' })
    assert.equal(landed.ok, true, JSON.stringify(landed))
    items = await read()
    assert.equal(valueOf(items.get('B1440'), 'State'), 'done')
    assert.equal(valueOf(items.get('B1442'), 'Blocked by'), null)
    assert.match(historyOf(items.get('B1442')).at(-1), /server: no longer blocked by B1440: done$/)
    assert.equal(parkedAfter(items.get('B1442'), items), 'B1500', 'still parked behind B1500')
    assert.equal(waitOf(items.get('B1442'), items), null, 'its wait ended')
    assert.match((await w1({ action: 'next' })).result.text, /- B1442 in progress \(.*parked: its wait ended; it resumes after B1500 is reported\)/)
    // The reconciler: Worker 1 is not free (two held steps, B1500 active).
    const busy = reconcile({ store: { items, flow: DEFAULT_FLOW, problems: [], pause: null }, lanes: [worker('Worker 1', { state: 'working', report: { state: 'working', since: ago(2), at: ago(1) } })], now: NOW, times: TIMES, prefix: '', focus: 'G108', settings: { maxWorkers: 5, handover: 'sequence' } })
    assert.deepEqual([busy.waitFree, busy.waiting], [[], []])
    // B1500 reported: B1442 is handed back first (no new give), with its History line.
    const reported = await w1({ action: 'report', id: 'B1500', result: 'Twin Isles is painted.', merged: 'def5678' })
    assert.equal(reported.ok, true, reported.why)
    assert.deepEqual(reported.result.resumed, ['B1442'])
    items = await read()
    assert.match(historyOf(items.get('B1442')).at(-1), /server: resumes after B1500$/)
    assert.equal(parkedAfter(items.get('B1442'), items), null)
    assert.equal(valueOf(items.get('B1442'), 'State'), 'in progress')
    const again = await server({ action: 'advance', to: 'queued', id: 'B1501', for: 'Worker 1' })
    assert.equal(again.ok, false, 'B1442 is active again: no new task')
    assert.match(again.why, /holds B1442 \(in progress\): no second task/)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('the wait still standing at the report: the parked step stays parked and the worker is free again; a landed waiting step can be reported while another step is active (chat 1\'s 1)', async () => {
  const { dir, server, person, as, read } = await garden([blocked(), blocker(), focusStep(), focusStep('B1501')])
  try {
    const w1 = as('Worker 1')
    const first = await server({ action: 'advance', to: 'queued', id: 'B1500', for: 'Worker 1' })
    assert.equal(first.ok, true, JSON.stringify(first))
    assert.equal((await w1({ action: 'take', minutes: 60, id: 'B1500', branch: 'b1500-isle' })).ok, true)
    const reported = await w1({ action: 'report', id: 'B1500', result: 'Done.', merged: 'def5678' })
    assert.deepEqual(reported.result.resumed ?? [], [], 'B1442 still waits for B1440: not handed back')
    let items = await read()
    assert.equal(parkedAfter(items.get('B1442'), items), 'B1500')
    assert.equal((await server({ action: 'advance', to: 'queued', id: 'B1501', for: 'Worker 1' })).ok, true, 'free again: the next ready step')
    items = await read()
    assert.match(historyOf(items.get('B1442')).at(-1), /server: parked \(resumes after B1501\)$/, 'parked behind the newer step now')
    // A waiting step whose landing landed needs only its report: it goes through while B1501 is active.
    assert.equal((await w1({ action: 'take', minutes: 60, id: 'B1501', branch: 'b1501-x' })).ok, true)
    const landed = await person({ action: 'tick', id: 'B1440' })
    assert.equal(landed.ok, true, JSON.stringify(landed))
    const back = await w1({ action: 'report', id: 'B1442', result: 'The sandbox is in.', merged: '0123abc' })
    assert.equal(back.ok, true, JSON.stringify(back))
    items = await read()
    assert.equal(valueOf(items.get('B1442'), 'State'), 'review')
    assert.equal(valueOf(items.get('B1501'), 'State'), 'in progress', 'the active step is untouched')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('e: the page draws the waiting step as one muted line under the worker\'s task, and the state carries it as `waiting` beside the store steps\' `waits` flag', async () => {
  const { readFile } = await import('node:fs/promises')
  const page = await readFile(new URL('../../public/board.js', import.meta.url), 'utf8')
  assert.match(page, /if \(isHeldRow\(lane\) && lane\.waiting !== null && lane\.waiting !== undefined\) list\.append\(el\('li', 'muted', `also holds \$\{lane\.waiting\.id\} \$\{lane\.waiting\.title\} · \$\{lane\.waiting\.on\}/)
  const state = await readFile(new URL('../../src/state.mjs', import.meta.url), 'utf8')
  assert.match(state, /waiting: lane\.isLeftover \|\| lane\.isMain \? null : waitingLineOf\(lane\.name\),/)
  assert.match(state, /waits: waiting\.has\(one\.head\.get\('Id'\)\), unblocked: unblockedOf\(one, waiting\)/)
  // the parked lane suspension for a blocked step or a chat wait is gone (chat 1's call): only the recap and asset waits park a lane
  assert.doesNotMatch(state, /step\?\.blockedBy\?\.length > 0 \? \{ by: 'parked'/)
  assert.doesNotMatch(state, /waitSuspension\(step\?\.waitsOn \?\? null\) \?\?/)
})
