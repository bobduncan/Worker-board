// F74 rework (chat 1's core review of 68187307, 2026-11-27: two blockers, nine should-fixes). The cases the review asked for: a parked step
// whose wait ended beside an active step, through decide, heldOf and pickHeld; two waits and their words; nearly finished work as a fix
// round of a built step only; the landing end to end; a real lane state; Resume all; the nudge's wait words. Made-up names only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { parseConfig } from '../../src/config.mjs'
import { workApi } from '../../src/work/api.mjs'
import { DEFAULT_FLOW } from '../../src/work/flow.mjs'
import { CHOICE_WHY, NEARLY_RANK, idleWorkers, readyList } from '../../src/work/handOut.mjs'
import { STATES, decide, holdingOf, holdsForGive } from '../../src/work/handover.mjs'
import { factsOf } from '../../src/work/handoverBoard.mjs'
import { heldOf, pickHeld } from '../../src/work/held.mjs'
import { goOnLine, waitRecordWords } from '../../src/work/holderTimers.mjs'
import { parseItem, valueOf } from '../../src/work/item.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { HELD_FOR_CAP, HOLDS, HOLD_CAP, activeStepOf, heldForCap, isCapped, isLandingOf, parkedAfter, waitOf, waitingIds, waitsFree } from '../../src/work/parked.mjs'
import { pauseAnswer } from '../../src/work/pause.mjs'
import { storeFromText } from '../../src/work/read.mjs'
import { reconcile } from '../../src/work/reconcile.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'
import { waitsOnLine } from '../../src/work/waitsOn.mjs'
import { unblockedDue } from '../../src/say.mjs'
import { healthSummary } from '../../src/supervisor/health.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { buildState } from '../withStore.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 27, 15, 0).getTime()
const ago = minutes => NOW - minutes * MIN
const TIMES = { graceMs: 10 * MIN, askMs: 60 * MIN, idleMs: 5 * MIN }

const file = (head, sections = {}) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${Object.entries(sections).map(([name, lines]) => `\n## ${name}\n${lines.join('\n')}\n`).join('')}`)
const step = (id, state, more = {}, sections = {}) => file({ Id: id, Kind: 'step', Title: `Step ${id}`, State: state, Since: stamp(ago(90)), ...(state === 'refined' ? { Refined: 'ready' } : {}), ...more }, sections)
const mapOf = items => new Map(items.map(item => [item.head.get('Id'), item]))
const said = (minutesAgo, who, words) => `- ${stamp(ago(minutesAgo))} ${who}: ${words}`
const worker = (name, more = {}) => ({ name, state: 'free', isMain: false, isLeftover: false, isRunning: true, mod: '0.34.0', report: { state: 'idle', since: ago(30), at: ago(1) }, resting: null, ...more })
const busy = (name = 'Worker 1') => worker(name, { state: 'working', report: { state: 'working', since: ago(2), at: ago(1) } })
const idOf = item => (item === null || item === undefined ? null : valueOf(item, 'Id'))

/** The live shapes: B1442 held by Worker 1 since long, parked behind B1500 (given 4 min ago, in progress 2 min ago); B1440 its blocker. */
const taken = (id, minutesAgo, more = {}) => step(id, 'in progress', { Owner: 'Worker 1', Since: stamp(ago(minutesAgo)), Goal: 'G108', ...more }, { History: [said(minutesAgo + 1, 'Worker 1', 'queued → taken'), said(minutesAgo, 'Worker 1', 'taken → in progress')] })
const parkedOld = (more = {}) => step('B1442', 'in progress', { Owner: 'Worker 1', Since: stamp(ago(600)), Branch: 'b1442-sandbox', Goal: 'G108', ...more }, {
  History: [said(601, 'Worker 1', 'queued → taken'), said(600, 'Worker 1', 'taken → in progress'), said(4, 'server', 'parked (resumes after B1500)')],
})
const newStep = (more = {}) => taken('B1500', 2, { Branch: 'b1500-isle', ...more })
const blocker = (id, state) => step(id, state, { Owner: 'Worker 3', Goal: 'G108' })

test('blocker 1: once the parked step\'s wait ends while its worker is on the new step, decide, holdingOf, heldOf and pickHeld stay on the new step; reported, the parked one is the worker\'s own again', () => {
  const items = mapOf([parkedOld(), newStep(), blocker('B1440', 'done')])
  const waiting = waitingIds(items)
  assert.deepEqual([...waiting], [], 'B1440 done: B1442 waits on nothing any more')
  assert.equal(parkedAfter(items.get('B1442'), items), 'B1500', 'and is still parked behind the active step')
  // The hand-over's decision and every reader of the lane's step: the active one, whatever the store's order (B1442 sorts first).
  const decision = decide({ worker: busy(), items, ready: [], now: NOW, waiting })
  assert.deepEqual([decision.state, decision.step], [STATES.WORKING, 'B1500'])
  assert.equal(idOf(holdingOf(items, 'Worker 1', '', waiting)), 'B1500')
  assert.equal(idOf(activeStepOf(items, 'Worker 1', '', { waiting })), 'B1500')
  assert.equal(heldOf(items, 'Worker 1', '', { handoverStep: 'B1442', waiting })?.id, 'B1500', 'a hand-over step that is parked never bypasses the pick')
  assert.equal(heldOf(items, 'Worker 1', '', { handoverStep: 'B1500', waiting })?.id, 'B1500')
  const mine = [items.get('B1442'), items.get('B1500')]
  assert.equal(idOf(pickHeld(mine, 'Worker 1', '', 'B1442', waiting, items)), 'B1500')
  assert.equal(idOf(pickHeld(mine, 'Worker 1', '', null, waiting, items)), 'B1500')
  // The parked step outranks the new one by state (in progress over taken) and is the older: still the new one, because the park says so.
  const takenNew = mapOf([parkedOld(), step('B1500', 'taken', { Owner: 'Worker 1', Since: stamp(ago(2)), Goal: 'G108' }, { History: [said(2, 'Worker 1', 'queued → taken')] }), blocker('B1440', 'done')])
  assert.equal(idOf(activeStepOf(takenNew, 'Worker 1', '', { waiting: waitingIds(takenNew) })), 'B1500')
  assert.equal(idOf(holdingOf(takenNew, 'Worker 1', '', waitingIds(takenNew))), 'B1500')
  assert.equal(heldOf(takenNew, 'Worker 1', '', { handoverStep: 'B1442', waiting: waitingIds(takenNew) })?.id, 'B1500')
  // A stopped worker: the go-on line (and the give-back) are about the active step, never a switch mid-step.
  const stopped = decide({ worker: worker('Worker 1', { state: 'interrupted', report: { state: 'idle', since: ago(20), at: ago(1) } }), items, ready: [], now: NOW, event: { kind: 'turn-ended', since: ago(20) }, waiting, timers: { resumeMs: 10 * MIN, giveBackMs: 60 * MIN } })
  assert.equal(stopped.step, 'B1500', JSON.stringify(stopped))
  if (stopped.envelope !== null && stopped.envelope !== undefined) assert.match(stopped.envelope.line ?? '', /^go on with B1500 /)
  // B1500 reported: the park is void; B1442 is the worker's own again (the report's own reading of the park stays, `loose`).
  const reported = mapOf([parkedOld(), step('B1500', 'review', { Owner: 'Worker 1', Since: stamp(ago(1)) }), blocker('B1440', 'done')])
  assert.equal(parkedAfter(reported.get('B1442'), reported), null)
  assert.equal(parkedAfter(reported.get('B1442'), reported, { loose: true }), 'B1500')
  assert.equal(idOf(activeStepOf(reported, 'Worker 1', '')), 'B1442')
  assert.equal(heldOf(reported, 'Worker 1', '', { handoverStep: 'B1500', waiting: waitingIds(reported) })?.id, 'B1442')
})

test('two waits: a park behind a step that itself only waits is void, so the unblock words, work next and the active pick name the same step', async () => {
  // B1442 parked behind B1500; B1500 blocked by B1490 (in review); B1440 done.
  const items = mapOf([parkedOld(), newStep({ 'Blocked by': 'B1490' }), blocker('B1440', 'done'), blocker('B1490', 'review')])
  const waiting = waitingIds(items)
  assert.deepEqual([...waiting], ['B1500'])
  assert.equal(parkedAfter(items.get('B1442'), items), null, 'the step it is parked behind waits itself: the park is void')
  assert.equal(idOf(activeStepOf(items, 'Worker 1', '', { waiting })), 'B1442')
  assert.deepEqual([decide({ worker: busy(), items, ready: [], now: NOW, waiting }).step, idOf(holdingOf(items, 'Worker 1', '', waiting))], ['B1442', 'B1442'])
  // The state's flags as say.mjs reads them: B1442 neither waits nor is parked, B1500 waits: "go on with it", never "it resumes when you report B1500".
  const lane = { name: 'Worker 1', isMain: false, isLeftover: false, state: 'working', isRunning: true, storeSteps: [
    { id: 'B1442', title: 'x', state: 'in progress', waits: false, parked: false, unblocked: { by: 'B1440', at: ago(2) } },
    { id: 'B1500', title: 'y', state: 'in progress', waits: true, parked: false, unblocked: null },
  ] }
  assert.deepEqual(unblockedDue({ pause: null, chats: [lane] }, []).map(one => one.text), ['B1442 is no longer blocked by B1440: go on with it.'])
  // A parked step beside an active one that does not wait: it resumes at that step's report, as before.
  const parkedLane = { ...lane, storeSteps: [{ ...lane.storeSteps[0], parked: true }, { ...lane.storeSteps[1], waits: false }] }
  assert.deepEqual(unblockedDue({ pause: null, chats: [parkedLane] }, []).map(one => one.text), ['B1442 is no longer blocked by B1440: it resumes when you report B1500.'])
  // The other step parked (behind this one): it is no active step, so: go on with it.
  const otherParked = { ...lane, storeSteps: [{ ...lane.storeSteps[0] }, { ...lane.storeSteps[1], waits: false, parked: true }] }
  assert.deepEqual(unblockedDue({ pause: null, chats: [otherParked] }, []).map(one => one.text), ['B1442 is no longer blocked by B1440: go on with it.'])
  // work next: B1442 is shown in full (the active one); B1500's line says it waits; no "parked" on B1442.
  const dir = await mkdtemp(join(tmpdir(), 'f74r-'))
  try {
    await writeStore(dir, { items, activities: [{ name: 'Maps', isFocus: true, steps: [...items.keys()], notes: [], loose: [] }] }, undefined, { now: ago(600) })
    const next = (await workApi({ chat: 'Worker 1', action: 'next' }, { dir, now: NOW, prefix: '', roleOf: () => 'worker', chats: ['Worker 1', 'Worker 3'], overlapsOfStore: true, landingNow: () => null })).result
    assert.equal(next.id, 'B1442', next.text)
    assert.doesNotMatch(next.text, /B1442 in progress \([^)]*parked/)
    assert.match(next.text, /- B1500 in progress \([^)]*blocked by B1490; the board gives you new work meanwhile\)/)
    // The lower id waits, the higher is active: the active one is still the step shown in full (the waiting one ranks after the queued).
    const other = mapOf([parkedOld({ 'Blocked by': 'B1440' }), newStep(), blocker('B1440', 'review')])
    await writeStore(dir, { items: other, activities: [{ name: 'Maps', isFocus: true, steps: [...other.keys()], notes: [], loose: [] }] }, undefined, { now: ago(600) })
    const next2 = (await workApi({ chat: 'Worker 1', action: 'next' }, { dir, now: NOW, prefix: '', roleOf: () => 'worker', chats: ['Worker 1', 'Worker 3'], overlapsOfStore: true, landingNow: () => null })).result
    assert.equal(next2.id, 'B1500', next2.text)
    assert.deepEqual(next2.items, ['B1500', 'B1442'])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('blocker 2: nearly finished work is a fix round of a BUILT step (a failed result check, a send-back); a next try of an unbuilt or dropped root ranks as its chain; the person\'s pick rule stands', () => {
  const checked = (root, fix, state = 'review', goal = 'G108') => step(root, state, { Owner: 'Worker 2', Goal: goal }, { History: [said(40, 'Worker 2', 'in progress → review'), said(20, 'Partner', `result check failed: one point; fix ${fix} for Worker 2`)] })
  const items = mapOf([
    step('B1', 'refined', { Goal: 'G108' }),
    // a fix round of a built focus step: nearly finished
    step('B4', 'refined', { Goal: 'G108', 'Fix of': 'B40' }), checked('B40', 'B4'),
    // the person's send-back of a done step: nearly finished too
    step('B6', 'refined', { Goal: 'G108', 'Fix of': 'B60' }), step('B60', 'done', { Owner: 'Worker 2', Goal: 'G108' }, { History: [said(30, 'Partner', 'sent back by the person: the next try is B6')] }),
    // a next try of a step never built (refined, no check): new work at its chain's rank
    step('B5', 'refined', { Goal: 'G108', 'Fix of': 'B50' }), step('B50', 'refined', { Goal: 'G108' }),
    // a fix of a dropped root: not nearly finished
    step('B7', 'refined', { Goal: 'G108', 'Fix of': 'B70' }), step('B70', 'dropped', { Goal: 'G108' }, { History: [said(20, 'Partner', 'result check failed: x; fix B7 for Worker 2')] }),
    // a fix round of a built step outside the focus that nobody picked: it waits for the pick, as any unpicked step
    step('B8', 'refined', { Goal: 'G2', 'Fix of': 'B80' }), checked('B80', 'B8', 'review', 'G2'),
    // a fix of a step in review whose History names no failed check and no send-back (a next try made by hand): new work
    step('B9', 'refined', { Goal: 'G108', 'Fix of': 'B90' }), step('B90', 'review', { Owner: 'Worker 2', Goal: 'G108' }, { History: [said(40, 'Worker 2', 'in progress → review')] }),
  ])
  const list = readyList(items, { now: NOW, focus: 'G108', backup: null, followUpMs: 0, beyondFocus: false })
  const rankOf = id => list.ready.find(one => one.id === id)?.rank ?? null
  assert.equal(rankOf('B4'), NEARLY_RANK)
  assert.equal(rankOf('B6'), NEARLY_RANK)
  assert.equal(rankOf('B5'), 1, 'a next try of an unbuilt step is new focus work')
  assert.equal(rankOf('B7'), 1, 'a fix of a dropped root: its chain\'s rank, no band of its own')
  assert.equal(rankOf('B1'), 1)
  assert.equal(rankOf('B9'), 1, 'a root in review whose History names no failed check and no send-back: no fix round')
  assert.deepEqual(list.held.filter(one => one.id === 'B8').map(one => one.why), [CHOICE_WHY], 'the pick rule first')
  assert.deepEqual(list.ready.map(one => one.id).slice(0, 2).sort(), ['B4', 'B6'])
  // Picked (the root pinned): the fix round of an outside step goes out, nearly finished.
  const picked = new Map(items)
  picked.set('B80', step('B80', 'review', { Owner: 'Worker 2', Goal: 'G2', Pinned: 'Worker 2' }, { History: [said(20, 'Partner', 'result check failed: one point; fix B8 for Worker 2')] }))
  assert.equal(readyList(picked, { now: NOW, focus: 'G108', backup: null, followUpMs: 0, beyondFocus: false }).ready.find(one => one.id === 'B8')?.rank, NEARLY_RANK)
})

test('the landing end to end: the give and the decision read the step whose branch lands with the same landing; without a landing it is the worker\'s active step', async () => {
  const landing = 'b1442-sandbox'
  const held = step('B1442', 'in progress', { Owner: 'Worker 1', Branch: 'b1442-sandbox', Goal: 'G108', Since: stamp(ago(600)) }, { History: [said(601, 'Worker 1', 'queued → taken'), said(600, 'Worker 1', 'taken → in progress')] })
  const items = mapOf([held, step('B1500', 'refined', { Goal: 'G108' })])
  assert.deepEqual(waitOf(held, items, { landing }), { kind: 'landing', branch: 'b1442-sandbox', words: 'its landing runs' })
  assert.equal(isLandingOf('qa/b1442-sandbox', 'qa-b1442-sandbox'), true)
  assert.equal(isLandingOf('b1442-sandbox', null), false)
  // The facts carry the landing into the waiting set; the decision gives new work and holds nothing.
  const facts = factsOf({ lane: worker('Worker 1'), state: { chatPrefix: '' }, items, pause: null, sent: [], config: {}, now: NOW, event: { kind: 'turn-ended', since: ago(5) }, landing })
  assert.deepEqual([...facts.waiting], ['B1442'])
  const given = decide({ ...facts, ready: [{ id: 'B1500', rank: 1, keptFor: null, keptUntil: null, pinned: null }] })
  assert.deepEqual([given.state, given.give], [STATES.HANDING, 'B1500'])
  assert.equal(holdingOf(items, 'Worker 1', '', null, landing), undefined)
  assert.equal(idOf(holdingOf(items, 'Worker 1', '', null, null)), 'B1442', 'no landing: its active step')
  assert.equal(decide({ ...factsOf({ lane: busy(), state: { chatPrefix: '' }, items, pause: null, sent: [], config: {}, now: NOW, event: { kind: 'pass' }, landing: null }), ready: [] }).step, 'B1442')
  // Through the work API with the landing in its context: the give parks B1442; the reconciler counts Worker 1 free with the same landing.
  const dir = await mkdtemp(join(tmpdir(), 'f74l-'))
  try {
    await writeStore(dir, { items, activities: [{ name: 'Maps', isFocus: true, steps: [...items.keys()], notes: [], loose: [] }] }, undefined, { now: ago(600) })
    const ctx = { dir, now: NOW, prefix: '', roleOf: chat => (chat === 'Lead' ? 'main' : 'worker'), chats: ['Lead', 'Worker 1'], overlapsOfStore: true, landingNow: () => landing }
    const pass = reconcile({ store: { items: (await readStore(dir)).items, flow: DEFAULT_FLOW, problems: [], pause: null }, lanes: [worker('Worker 1')], now: NOW, times: TIMES, prefix: '', focus: 'G108', settings: { maxWorkers: 5 }, landing })
    assert.deepEqual([pass.waitFree, pass.waiting], [['Worker 1'], ['B1442']])
    const given2 = await workApi({ action: 'advance', to: 'queued', id: 'B1500', for: 'Worker 1' }, { ...ctx, as: 'server' })
    assert.equal(given2.ok, true, JSON.stringify(given2))
    assert.equal(given2.result.parked, 'B1442')
    const after = (await readStore(dir)).items
    assert.match((after.get('B1442').sections.get('History') ?? []).at(-1), /parked \(resumes after B1500\)$/)
    // Without the landing the same give is refused: B1442 is the worker's active step.
    const dir2 = await mkdtemp(join(tmpdir(), 'f74l2-'))
    try {
      await writeStore(dir2, { items, activities: [{ name: 'Maps', isFocus: true, steps: [...items.keys()], notes: [], loose: [] }] }, undefined, { now: ago(600) })
      const refused = await workApi({ action: 'advance', to: 'queued', id: 'B1500', for: 'Worker 1' }, { ...ctx, dir: dir2, landingNow: () => null, as: 'server' })
      assert.equal(refused.ok, false)
      assert.match(refused.why, /holds B1442 \(in progress\): no second task/)
    } finally {
      await rm(dir2, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('one rule, one place: the cap, its state list and the HOLDS list come from parked.mjs; the give, the hand-out and the decision agree', () => {
  assert.deepEqual(HELD_FOR_CAP, ['queued', 'taken', 'in progress', 'waiting on you'])
  assert.deepEqual(HOLDS, ['taken', 'in progress', 'waiting on you'])
  assert.equal(HOLD_CAP, 2)
  const items = mapOf([parkedOld(), newStep(), blocker('B1440', 'review'), step('B1501', 'refined', { Goal: 'G108' })])
  assert.deepEqual(heldForCap(items, 'Worker 1').map(idOf), ['B1442', 'B1500'])
  assert.equal(isCapped(items, 'Worker 1'), true)
  assert.equal(isCapped(items, 'Worker 1', '', { except: 'B1500' }), false, 'a step this decision takes back is not held')
  assert.equal(holdsForGive(items, 'Worker 1'), true)
  const waiting = waitingIds(items)
  assert.equal(decide({ worker: worker('Worker 1'), items, ready: [{ id: 'B1501', rank: 1, keptFor: null, keptUntil: null, pinned: null }], now: NOW, event: { kind: 'turn-ended', since: ago(5) }, waiting }).give, null)
  assert.deepEqual(idleWorkers([worker('Worker 1')], { items, prefix: '', waiting }), [])
  // One held step that only waits: free for the hand-out, the give and the decision alike; asleep too (chat 1's review).
  const one = mapOf([step('B1442', 'in progress', { Owner: 'Worker 1', 'Blocked by': 'B1440' }), blocker('B1440', 'review'), step('B1501', 'refined', { Goal: 'G108' })])
  const oneWaiting = waitingIds(one)
  assert.equal(holdsForGive(one, 'Worker 1', '', oneWaiting), false)
  assert.equal(idleWorkers([worker('Worker 1')], { items: one, prefix: '', waiting: oneWaiting }).length, 1)
  const asleep = worker('Worker 1', { state: 'interrupted', isRunning: false, asleep: true, report: { state: 'ended', since: ago(30), at: ago(1) } })
  assert.equal(waitsFree(asleep, one, ''), true, 'an asleep worker whose only step waits is free')
  assert.equal(waitsFree({ ...asleep, asleep: false }, one, ''), false, 'off is not')
  const pass = reconcile({ store: { items: one, flow: DEFAULT_FLOW, problems: [], pause: null }, lanes: [asleep], now: NOW, times: TIMES, prefix: '', focus: 'G108', settings: { maxWorkers: 5 }, landing: null })
  assert.deepEqual(pass.waitFree, ['Worker 1'])
  assert.deepEqual(idleWorkers([asleep], { items: one, prefix: '', restFree: pass.waitFree, waiting: oneWaiting }).map(lane => lane.name), ['Worker 1'], 'the reconciler counts it idle: no extra worker is asked for')
})

test('Resume all names the active step only: a blocked step, a parked step and a step whose landing runs are not resumed', () => {
  const items = mapOf([parkedOld({ 'Blocked by': 'B1440' }), newStep(), blocker('B1440', 'review'), step('B1081', 'in progress', { Owner: 'Worker 4', Branch: 'b1081-x', Since: stamp(ago(100)) })])
  const lanes = [{ name: 'Worker 1', appSession: 'local_w1', session: 'cli-w1' }, { name: 'Worker 4', appSession: 'local_w4', session: 'cli-w4' }]
  const pause = { state: 'resuming', since: ago(1), pausedSince: ago(30), by: 'person' }
  const listOf = landing => pauseAnswer({ pause, items, lanes, prefix: '', chat: 'Lead', role: 'main', landing }).resumeList.map(one => [one.chat, one.step])
  assert.deepEqual(listOf(null), [['Worker 4', 'B1081'], ['Worker 1', 'B1500']])
  assert.deepEqual(listOf('b1081-x'), [['Worker 1', 'B1500']], 'a step whose landing runs waits for it')
  // B1440 done: B1442 is parked behind B1500 (no wait of its own): still only the active step.
  const done = new Map(items)
  done.set('B1440', blocker('B1440', 'done'))
  done.set('B1442', parkedOld())
  assert.deepEqual(pauseAnswer({ pause, items: done, lanes, prefix: '', chat: 'Lead', role: 'main' }).resumeList.map(one => one.step), ['B1081', 'B1500'])
})

test('spec a: the go-on line (the hand-over\'s and the limit\'s word) names the wait record to write', () => {
  const item = step('B12', 'in progress', { Owner: 'Worker 1', Branch: 'b12-gate' })
  const line = goOnLine(item)
  assert.ok(line.endsWith(waitRecordWords('B12')), line)
  assert.match(line, /a wait on a step or a chat is a record, not a checkpoint: work block B12 on <B<n> or the chat> why <one line>$/)
})

// ---- a real lane state (chat 1's review: "the tests never build a real lane state")
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const NAMES = ['Lead', 'Worker 4', 'Worker 5']
const PREFIX = 'Garden · '
const at = (h, m, s = 0) => new Date(2026, 10, 27, h, m, s).getTime()
const app = name => JSON.stringify({ title: `${PREFIX}${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: at(11, 19), lastAssistantUuid: 'u-1' })
const typedLine = (when, words) => JSON.stringify({ type: 'user', timestamp: new Date(when).toISOString(), message: { role: 'user', content: words } })
const answerLine = (when, words) => JSON.stringify({ type: 'assistant', timestamp: new Date(when).toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: words }] } })
const tail = { text: [typedLine(at(10, 58), 'Take B1081.'), answerLine(at(11, 19), 'Gate green, branch pushed; waiting for chat 1\'s go.')].join('\n'), isCut: false, modifiedAt: at(11, 19) }
const report = (name, state, since, heard) => [name, { state, since, background: false, run: 1, seq: 1, at: heard, session: `cli-${name}`, mod: '0.31.0', busyAt: null }]
function storeWith(items) {
  const work = storeFromText('## Garden\n', { now: at(9, 0) })
  for (const item of items) {
    work.items.set(item.head.get('Id'), item)
    work.activities[0].steps.push(item.head.get('Id'))
  }
  return work
}
const b1081 = (more = {}) => parseItem(`Id: B1081\nKind: step\nTitle: Fix the check task\nState: in progress\nOwner: Worker 4\nActivity: Garden\nSince: ${stamp(at(10, 58))}\nBranch: b1081-open-fix-check\n${Object.entries(more).map(([key, value]) => `${key}: ${value}`).join('\n')}\n\n## History\n- ${stamp(at(10, 58))} Worker 4: queued → taken\n- ${stamp(at(10, 59))} Worker 4: taken → in progress\n`)
const b5 = () => parseItem(`Id: B5\nKind: step\nTitle: Step B5\nState: in progress\nOwner: Worker 5\nActivity: Garden\nSince: ${stamp(at(10, 30))}\n`)
function build({ now, items, landing = null }) {
  const work = storeWith(items)
  const raw = {
    listText: JSON.stringify({ prefix: PREFIX, main: 'Lead' }), appChatTexts: NAMES.map(app), tails: Object.fromEntries(NAMES.map(name => [`cli-${name}`, tail])), planLineTexts: {},
    work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: at(9, 0), landing,
  }
  const reports = [report('Lead', 'idle', at(11, 0), now - 5_000), report('Worker 4', 'idle', at(11, 19, 11), now - 5_000), report('Worker 5', 'idle', at(11, 10), now - 5_000)]
  const state = buildState(raw, { lines: [], outbox: [], runs: [], now, config, seen: { shown: {}, other: {} }, board: { startedAt: at(9, 0), offSince: null }, reports: new Map(reports) })
  return { state, work }
}
const laneOf = (state, name) => state.chats.find(one => one.name === name)

test('a real lane state: a worker whose only step waits (a Waits on record, a blocker, its landing) reads free, not "Stopped · task open", is in no cut-off list, holds none for the row, and its store steps say what waits', () => {
  const now = at(11, 30)
  const cases = [
    ['a Waits on record', b1081({ 'Waits on': waitsOnLine('chat 1', 'its go to land', at(11, 18)) }), null, 'waits on chat 1 (its go to land)'],
    ['a blocker in review', b1081({ 'Blocked by': 'B5' }), null, 'blocked by B5'],
    ['its landing runs', b1081(), 'b1081-open-fix-check', 'its landing runs'],
  ]
  for (const [name, item, landing, words] of cases) {
    const built = build({ now, items: [item, b5()], landing })
    const lane = laneOf(built.state, 'Worker 4')
    assert.equal(lane.state, 'free', `${name}: ${lane.state}`)
    assert.equal(lane.held?.id, 'B1081', `${name}: the row shows the waiting step with its status (P7, one status)`)
    assert.deepEqual([lane.waiting?.id, lane.waiting?.on], ['B1081', words], name)
    assert.deepEqual(lane.storeSteps.map(one => [one.id, one.waits, one.parked]), [['B1081', true, false]], name)
    assert.equal(built.state.restart.interrupted.includes('Worker 4'), false, `${name}: not cut off`)
    assert.doesNotMatch(JSON.stringify(lane.flags ?? []), /Stopped/, name)
    // The hand-over's decision on the built state, with the state's own landing: not working on the waiting step.
    const decision = decide({ ...factsOf({ lane, state: { chatPrefix: PREFIX, readyList: null, limits: built.state.limits, gaps: built.state.gaps ?? [] }, items: built.work.items, pause: null, sent: [], config, now, event: { kind: 'pass' }, landing }), ready: [] })
    assert.notEqual(decision.state, STATES.WORKING, `${name}: ${JSON.stringify(decision)}`)
    assert.equal(decision.step ?? null, null, name)
    // The Supervisor's view reads the same landing: the health line says free and what waits.
    const view = buildView({ state: built.state, items: built.work.items, now })
    assert.equal(view.landing, landing, name)
    const line = healthSummary(view, now).split('\n').find(one => one.includes('Worker 4 (')) ?? ''
    assert.match(line, /^- Worker 4 \(worker\): free\b/, `${name}: ${line}`)
    assert.match(line, new RegExp(words.replace(/[()]/g, '\\$&')), `${name}: ${line}`)
  }
  // Worker 5's step waits on nothing: it holds it, as before.
  const built = build({ now, items: [b1081(), b5()] })
  assert.equal(laneOf(built.state, 'Worker 5').held?.id, 'B5')
  assert.equal(laneOf(built.state, 'Worker 4').held?.id, 'B1081')
})
