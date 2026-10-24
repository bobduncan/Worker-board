// B392: a step whose only open blocking asks went to the partner waits for the partner, not for the person. The
// person, 2026-10-19: "it says worker 6 is waiting for me but i dont see it. fix it and prevent this future problem".
// The step's window, the goal's steps and the Overview say "waits for your partner" in its own colour; it is the
// person's only once the partner hands the ask on; a routed ask open ten minutes wakes the partner once more. Made-up
// names only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

import { parseGoals } from '../../src/goals.mjs'
import { focusState } from '../../src/state.mjs'
import { memoryStore } from '../../src/store.mjs'
import { workApi } from '../../src/work/api.mjs'
import { deliverWork } from '../../src/work/deliver.mjs'
import { storeNeeds, storeWaits } from '../../src/work/lists.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { PARTNER_AGAIN_MS, partnerWaitOf, stepWaitsForPartner } from '../../src/work/partnerAnswers.mjs'
import { flowOfStep } from '../../src/work/read.mjs'
import { reconcile } from '../../src/work/reconcile.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 19, 10, 0).getTime()
const BACKLOG = ['# Backlog', '', '## Fights', '- [ ] B1 Show the damage (for Digger; about 1 h)', ''].join('\n')
const ROLES = { Lead: 'main', Digger: 'worker', Sage: 'advisor' }
const TIMES = { graceMs: 10 * MIN, askMs: 60 * MIN, idleMs: 5 * MIN, partnerMs: 30 * MIN }
const DECIDE = { action: 'ask', of: 'B1', kind: 'decide', text: 'A number or a bar for the damage?', options: ['A number', 'B bar'], advice: 'A', blocking: true }

async function garden() {
  const dir = await mkdtemp(join(tmpdir(), 'partner-wait-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW - 60 * MIN }), undefined, { now: NOW - 60 * MIN })
  const ctx = (now = NOW) => ({ dir, now, prefix: 'Garden · ', roleOf: chat => ROLES[chat] ?? null, chats: Object.keys(ROLES), freeChats: new Set(), hasGoal: () => false })
  const as = chat => (body, now) => workApi({ chat, ...body }, ctx(now))
  await as('Digger')({ action: 'take', id: 'B1', branch: 'b1' })
  return { dir, digger: as('Digger'), sage: as('Sage'), server: (body, now) => workApi(body, { ...ctx(now), as: 'server' }) }
}

test('a step whose only open blocking asks went to the partner waits for the partner; handed on, it waits for the person', async () => {
  const { dir, digger, sage } = await garden()
  try {
    await digger(DECIDE)
    let work = { ok: true, ...(await readStore(dir)) }
    // The step stands where the flow puts it, and says whom it waits for.
    assert.equal(flowOfStep(work, 'B1').state, 'waiting on you')
    assert.deepEqual(flowOfStep(work, 'B1').waitsForPartner, ['Q1'])
    assert.deepEqual(partnerWaitOf('B1', work.items.values()), ['Q1'])
    // Not under Needs your attention, and its chat waits for the partner, not for the person.
    assert.deepEqual(storeNeeds(work, { now: NOW }).map(need => need.workId), [])
    const waits = storeWaits(work, 'Garden · ')
    assert.equal(waits.blocking.has('digger'), false)
    assert.deepEqual(waits.partner.get('digger'), ['Q1'])
    // The partner hands it on: now it is the person's, at once.
    assert.equal((await sage({ action: 'escalate', id: 'Q1', why: 'a rule of the game is yours' })).ok, true)
    work = { ok: true, ...(await readStore(dir)) }
    assert.equal(flowOfStep(work, 'B1').waitsForPartner, null)
    assert.deepEqual(storeNeeds(work, { now: NOW }).map(need => need.workId), ['Q1'])
    assert.equal(storeWaits(work, 'Garden · ').blocking.has('digger'), true)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('a step that also waits on an ask of the person\'s own waits for the person', async () => {
  const { dir, digger } = await garden()
  try {
    await digger(DECIDE)
    // A provide without options or advice is not routed: it is the person's.
    await digger({ action: 'ask', of: 'B1', kind: 'provide', text: 'The damage numbers of the old build, please.', blocking: true })
    const work = { ok: true, ...(await readStore(dir)) }
    assert.equal(flowOfStep(work, 'B1').waitsForPartner, null)
    assert.equal(partnerWaitOf('B1', work.items.values()), null)
    // A step with no open blocking ask waits for nobody.
    assert.equal(partnerWaitOf('B9', work.items.values()), null)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('the review: only a step still at work waits for the partner, not one queued, in review or done', async () => {
  const { dir, digger } = await garden()
  try {
    await digger(DECIDE)
    const work = { ok: true, ...(await readStore(dir)) }
    const step = work.items.get('B1')
    assert.deepEqual(stepWaitsForPartner(step, work.items.values()), ['Q1'])
    for (const state of ['taken', 'in progress']) assert.deepEqual(stepWaitsForPartner({ ...step, head: new Map([...step.head, ['State', state]]) }, work.items.values()), ['Q1'], state)
    for (const state of ['queued', 'review', 'done']) assert.equal(stepWaitsForPartner({ ...step, head: new Map([...step.head, ['State', state]]) }, work.items.values()), null, state)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('the focus goal\'s steps say so too', async () => {
  const { dir, digger } = await garden()
  try {
    await digger(DECIDE)
    const work = { ok: true, ...(await readStore(dir)) }
    const map = parseGoals(['Last id: G1', 'Focus: G1', '', '- [~] G1 A clear fight', '    Part: The damage · about 1 h · steps B1', '    How agreed: 2026-10-18 11:00', ''].join('\n'))
    const focus = focusState(map, [...work.items.values()], [], 'Garden · ')
    assert.deepEqual(focus?.steps?.map(step => [step.id, step.state, step.waitsForPartner]), [['B1', 'now', ['Q1']]])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

const partnerLane = (state, idleSince = null) => ({ name: 'Sage', state, isRunning: true, idle: idleSince === null ? null : { since: idleSince } })
const plan = async (dir, partner, now) => reconcile({ store: await readStore(dir), lanes: [{ name: 'Lead', isMain: true, state: 'free', isRunning: true }], partner, now, times: TIMES, prefix: 'Garden · ' })

test('a routed ask open ten minutes wakes the partner once more, never while its first line still waits', async () => {
  const { dir, digger, server } = await garden()
  try {
    await digger(DECIDE, NOW)
    assert.equal(PARTNER_AGAIN_MS, 10 * MIN)
    const free = partnerLane('free', NOW - 60 * MIN)
    assert.deepEqual((await plan(dir, free, NOW + 9 * MIN)).partnerAsks, [{ id: 'Q1', chat: 'Sage', since: '2026-10-19 10:00' }])
    assert.deepEqual((await plan(dir, free, NOW + 11 * MIN)).partnerAsks, [{ id: 'Q1', chat: 'Sage', since: '2026-10-19 10:00', again: true }])
    // Busy: not now; it comes when the partner is free again.
    assert.deepEqual((await plan(dir, partnerLane('working'), NOW + 11 * MIN)).partnerAsks, [])

    const outbox = memoryStore()
    let n = 0
    const deliver = async (reconciled, now) => deliverWork({ state: { reconciled, chats: [] }, dir, outbox, apply: body => server(body, now), now, maxChars: 2000, newId: () => `m${(n += 1)}` })
    await deliver(await plan(dir, free, NOW + MIN), NOW + MIN)
    assert.equal(outbox.outbox().length, 1)
    // Ten minutes on, the first line still waits for the partner to take it: no second line beside it.
    await deliver(await plan(dir, free, NOW + 11 * MIN), NOW + 11 * MIN)
    assert.equal(outbox.outbox().filter(one => one.state === 'waiting').length, 1)
    // Taken, and still open: the partner is woken once more, once.
    await outbox.update(outbox.outbox()[0].id, { state: 'taken', takenAt: NOW + 2 * MIN })
    await deliver(await plan(dir, free, NOW + 12 * MIN), NOW + 12 * MIN)
    await deliver(await plan(dir, free, NOW + 13 * MIN), NOW + 13 * MIN)
    assert.deepEqual(outbox.outbox().map(one => [one.to, one.kind, one.about]), [['Sage', 'partner-ask', 'Q1'], ['Sage', 'partner-ask', 'Q1']])
    // Taken too: never a third.
    await outbox.update(outbox.outbox()[1].id, { state: 'taken', takenAt: NOW + 14 * MIN })
    await deliver(await plan(dir, free, NOW + 25 * MIN), NOW + 25 * MIN)
    assert.equal(outbox.outbox().length, 2)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('the review: a partner woken just before ten minutes is not woken again at once', async () => {
  const { dir, digger, server } = await garden()
  try {
    await digger(DECIDE, NOW)
    const free = partnerLane('free', NOW - 60 * MIN)
    const outbox = memoryStore()
    let n = 0
    const deliver = async (reconciled, now) => deliverWork({ state: { reconciled, chats: [] }, dir, outbox, apply: body => server(body, now), now, maxChars: 2000, newId: () => `m${(n += 1)}` })
    // Busy until 9 minutes 50: its first line goes then and is taken at once.
    await deliver(await plan(dir, free, NOW + 9 * MIN + 50_000), NOW + 9 * MIN + 50_000)
    await outbox.update(outbox.outbox()[0].id, { state: 'taken', takenAt: NOW + 9 * MIN + 55_000 })
    await deliver(await plan(dir, free, NOW + 10 * MIN + 10_000), NOW + 10 * MIN + 10_000)
    assert.equal(outbox.outbox().length, 1)
    // Ten minutes after that line, once more.
    await deliver(await plan(dir, free, NOW + 20 * MIN), NOW + 20 * MIN)
    assert.equal(outbox.outbox().length, 2)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('the page: "waits for your partner" in its own colour on the Overview\'s workers and focus steps, the goal\'s steps and the step\'s window', () => {
  const script = readFileSync(new URL('../../public/board.js', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../../public/board.css', import.meta.url), 'utf8')
  const page = { MIN, Date, Math, Number, Object, String, Array, Set, Map, JSON, el: () => null }
  const region = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
  vm.runInNewContext(`${region('goalsteps')}\nthis.goalStepBadge = goalStepBadge`, page)
  assert.deepEqual([...page.goalStepBadge({ flow: { state: 'waiting on you', waitsForPartner: ['Q1'] } })], ['Waits for your partner', 'partner'])
  assert.deepEqual([...page.goalStepBadge({ flow: { state: 'waiting on you', waitsForPartner: null } })], ['Needs you', 'you'])
  // The step's window: its strip names whom it waits for.
  vm.runInNewContext(`${script.slice(script.indexOf('function flowStripOf(flow) {'), script.indexOf('// item:start'))}\nthis.flowStripOf = flowStripOf`, page)
  const strip = page.flowStripOf({ states: ['in progress', 'waiting on you', 'review'], state: 'waiting on you', next: [], waitsForPartner: ['Q1'] })
  assert.deepEqual(JSON.parse(JSON.stringify(strip.states)), [{ name: 'in progress', tone: 'past' }, { name: 'waits for your partner (Q1)', tone: 'partner' }, { name: 'review', tone: 'later' }])
  // The Overview: the focus goal's steps and the workers.
  vm.runInNewContext(`${region('runchip')}\n${region('simpleoverview')}\nthis.simpleSteps = simpleSteps; this.simpleWorkers = simpleWorkers`, page)
  const steps = page.simpleSteps({ id: 'G1', stage: 'run', steps: [{ id: 'B1', title: 'Show the damage', state: 'now', owner: 'Digger', waitsForPartner: ['Q1'] }] }, [])
  assert.deepEqual(JSON.parse(JSON.stringify(steps.rows)), [{ id: 'B1', title: 'Show the damage', chip: 'Waits for your partner', tone: 'partner', who: 'Digger' }])
  const lane = { name: 'Digger', state: 'working', eta: { at: 0, minutes: 30 }, task: null, waitsForPartner: ['Q1'] }
  const workers = page.simpleWorkers([lane], { working: 1 }, 0)
  assert.deepEqual([workers.rows[0].left, workers.rows[0].tone], ['waits for your partner (Q1)', 'partner'])
  for (const rule of ['.goal-step-badge.tone-partner', '.flow-state.is-partner', '.simple-worker.is-partner', '.pill.is-partner']) assert.ok(css.includes(rule), rule)
})
