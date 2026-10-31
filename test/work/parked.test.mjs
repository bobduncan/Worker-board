// B567 (X21: a worker filed its ask as not blocking and rested on it, so its step stayed in progress with an idle chat
// and three steps queued behind it; X23: the ask was answered while the worker was on another step, and the step still
// showed in progress; another sat in progress 2 h, unreported, while its worker did other steps). A step its worker
// holds while on another gets a named state and a way back: resting on an open ask it waits on you and the worker takes
// its queue; answered meanwhile it is parked and handed back first once the other step is reported; anything else is
// named in the health summary and to the main chat. Made-up names only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { healthSummary } from '../../src/supervisor/health.mjs'
import { HELD_ELSEWHERE_MS, findStuck } from '../../src/supervisor/rules/repair.mjs'
import { stepState } from '../../src/supervisor/cards.mjs'
import { workApi } from '../../src/work/api.mjs'
import { mayWake } from '../../src/work/deliver.mjs'
import { DEFAULT_FLOW, mayMove } from '../../src/work/flow.mjs'
import { parseItem, valueOf } from '../../src/work/item.mjs'
import { migrateBacklog, stamp } from '../../src/work/migrate.mjs'
import { REST_MS, parkedAfter } from '../../src/work/parked.mjs'
import { reconcile } from '../../src/work/reconcile.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = new Date(2026, 9, 24, 21, 0).getTime()
const TIMES = { graceMs: 10 * MIN, askMs: 60 * MIN, idleMs: 5 * MIN }
const ago = minutes => NOW - minutes * MIN

const file = (head, sections = {}) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${Object.entries(sections).map(([name, lines]) => `\n## ${name}\n${lines.join('\n')}\n`).join('')}`)
const step = (id, state, more = {}, sections = {}) => file({ Id: id, Kind: 'step', Title: `Step ${id}`, State: state, Owner: 'Digger', Since: stamp(ago(90)), ...more }, sections)
const ask = (id, of, more = {}) => file({ Id: id, Kind: 'ask', Title: `Ask ${id}`, State: 'open', Owner: 'Digger', Since: stamp(ago(80)), Asks: 'decide', Blocking: 'no', Of: of, ...more })
const store = items => ({ items: new Map(items.map(item => [item.head.get('Id'), item])), flow: DEFAULT_FLOW, problems: [] })
/** A worker whose turn ended `rested` minutes ago with nothing running (state.mjs `resting`). */
const lane = (name, more = {}) => ({ name, state: 'working', isMain: false, isLeftover: false, isRunning: true, lastActivityAt: ago(20), task: null, resting: { since: ago(20), at: ago(20), words: '' }, ...more })
const run = (items, lanes, more = {}) => reconcile({ store: { ...store(items), pause: more.pause ?? null }, flow: more.flow ?? DEFAULT_FLOW, lanes, now: more.now ?? NOW, times: TIMES, prefix: 'Garden · ' })

// X21's case: B547 (here B47) in progress, its ask Q38 not blocking, its worker resting; B34 queued behind it.
const X21 = () => [step('B47', 'in progress'), ask('Q38', 'B47'), step('B34', 'queued', { Since: stamp(ago(60)) })]

test('X21: a step whose worker rests over 15 min on an open ask waits on you, and the worker counts free', () => {
  assert.equal(REST_MS, 15 * MIN)
  const done = run(X21(), [lane('Digger')])
  assert.deepEqual(done.moves, [{ id: 'B47', to: 'waiting on you', ask: 'Q38', why: 'in progress → waiting on you (rests for Q38)' }])
  assert.deepEqual(done.restFree, ['Digger'])
  // T8.5 step 6: no line from this pass; its next step is its hand-over's.
  assert.deepEqual(done.deliveries, [])
  // The board's line may go to it, as to a free chat.
  assert.equal(mayWake({ chats: [lane('Digger')], reconciled: { restFree: done.restFree } }, 'Digger'), true)
  assert.equal(mayWake({ chats: [lane('Digger')], reconciled: { restFree: [] } }, 'Digger'), false)
})

test('nothing moves in a turn, under 15 min, while suspended, not running, paused, or with no ask open', () => {
  const quiet = (items, lanes, more) => {
    const done = run(items, lanes, more)
    return [done.moves, done.deliveries, done.restFree]
  }
  const none = [[], [], []]
  assert.deepEqual(quiet(X21(), [lane('Digger', { resting: null })]), none)
  assert.deepEqual(quiet(X21(), [lane('Digger', { resting: { since: ago(14), at: ago(14), words: '' } })]), none)
  assert.deepEqual(quiet(X21(), [lane('Digger', { state: 'suspended' })]), none)
  assert.deepEqual(quiet(X21(), [lane('Digger', { isRunning: false })]), none)
  assert.deepEqual(quiet(X21(), [lane('Digger')], { pause: { state: 'pausing', since: ago(5) } }), none)
  assert.deepEqual(quiet([step('B47', 'in progress'), ask('Q38', 'B47', { State: 'answered' }), step('B34', 'queued')], [lane('Digger')]), none)
  // A step taken anew counts from then: rested 20 min, but on this step only 10.
  assert.deepEqual(quiet([step('B47', 'in progress', { Since: stamp(ago(10)) }), ask('Q38', 'B47'), step('B34', 'queued')], [lane('Digger')]), none)
  // A project whose own flow.json has no such move: nothing.
  const flow = { step: { ...DEFAULT_FLOW.step, moves: DEFAULT_FLOW.step.moves.filter(move => move.when !== 'its worker rests on an open ask') } }
  assert.deepEqual(quiet(X21(), [lane('Digger')], { flow }), none)
})

test('a worker whose steps already wait on you, resting, counts free; one with a step in progress does not', () => {
  const waiting = [step('B47', 'waiting on you'), ask('Q38', 'B47', { Blocking: 'yes' }), step('B34', 'queued')]
  assert.deepEqual(run(waiting, [lane('Digger', { state: 'waiting' })]).restFree, ['Digger'])
  assert.deepEqual(run([...waiting, step('B50', 'in progress')], [lane('Digger', { state: 'waiting' })]).restFree, [])
  // Not resting (its turn runs): not free.
  assert.deepEqual(run(waiting, [lane('Digger', { state: 'waiting', resting: null })]).restFree, [])
})

/** A garden: Digger holds B1 in progress with a not-blocking ask Q1 open, and has B2 queued. */
async function garden() {
  const dir = await mkdtemp(join(tmpdir(), 'parked-'))
  const backlog = ['# Backlog', '', '## Garden', '- [ ] B1 Plant the hedge (for Digger; about 1 h)', '- [ ] B2 Water the beds (for Digger; about 1 h)', ''].join('\n')
  await writeStore(dir, migrateBacklog(backlog, { now: ago(120) }), undefined, { now: ago(120) })
  const ctx = (now = NOW) => ({ dir, now, prefix: 'Garden · ', roleOf: chat => ({ Lead: 'main', Digger: 'worker' })[chat] ?? null, chats: ['Lead', 'Digger'], freeChats: new Set(['Digger']), hasGoal: () => false })
  const digger = (body, now) => workApi({ chat: 'Digger', ...body }, ctx(now))
  const server = (body, now) => workApi(body, { ...ctx(now), as: 'server' })
  const person = (body, now) => workApi(body, { ...ctx(now), as: 'person' })
  await digger({ action: 'take', minutes: 30, id: 'B1', branch: 'b1' }, ago(100))
  await digger({ action: 'ask', of: 'B1', kind: 'decide', text: 'Box or yew for the hedge?', options: ['A box', 'B yew'], advice: 'A', blocking: false }, ago(90))
  const read = async () => (await readStore(dir)).items
  return { dir, digger, server, person, read }
}
const historyOf = item => item.sections.get('History') ?? []

test('X23: answered while its worker is on another step, the step stays parked and is handed back first once that one is reported', async () => {
  const { dir, digger, server, person, read } = await garden()
  try {
    // The board moves B1 once Digger rested on Q1; Digger then gets B2, not B1, from its pull.
    assert.equal((await server({ action: 'advance', id: 'B1', to: 'waiting on you', ask: 'Q1' })).ok, true)
    let items = await read()
    assert.equal(valueOf(items.get('B1'), 'State'), 'waiting on you')
    assert.match(historyOf(items.get('B1')).at(-1), /server: in progress → waiting on you \(rests for Q1\)$/)
    assert.equal((await digger({ action: 'pull' })).result.id, 'B2')
    // Its next lists B2 before B1, and says what B1 waits for.
    const before = (await digger({ action: 'next' })).result
    assert.deepEqual(before.items, ['B2', 'B1'])
    assert.match(before.text, /- B1 waiting on you \(waits for Q1; take your next queued step meanwhile\)/)
    assert.equal((await digger({ action: 'take', minutes: 30, id: 'B2', branch: 'b2' })).ok, true)
    // The person answers Q1 while Digger is on B2: B1 does not jump back to in progress.
    const answered = await person({ action: 'answer', id: 'Q1', text: 'A box' })
    assert.equal(answered.ok, true)
    assert.match(answered.result.wake.text, /B1 is parked: it resumes after B2 is reported; go on with B2\./)
    items = await read()
    assert.equal(valueOf(items.get('B1'), 'State'), 'waiting on you')
    assert.match(historyOf(items.get('B1')).at(-1), /server: parked \(resumes after B2\)$/)
    assert.equal(parkedAfter(items.get('B1'), items), 'B2')
    // The reconciler leaves it parked too.
    const lanes = [lane('Digger', { resting: null })]
    assert.deepEqual(reconcile({ store: { items, flow: DEFAULT_FLOW, problems: [] }, lanes, now: NOW, times: TIMES, prefix: 'Garden · ' }).moves, [])
    const parked = (await digger({ action: 'next' })).result
    assert.deepEqual(parked.items, ['B2', 'B1'])
    assert.match(parked.text, /- B1 waiting on you \(parked: its answers came; it resumes after B2 is reported\)/)
    // B2 reported: B1 goes on, first.
    const reported = await digger({ action: 'report', id: 'B2', result: 'The beds are watered.', merged: 'abc1234' })
    assert.deepEqual(reported.result.resumed, ['B1'])
    items = await read()
    assert.equal(valueOf(items.get('B1'), 'State'), 'in progress')
    assert.match(historyOf(items.get('B1')).at(-1), /server: waiting on you → in progress \(resumes after B2\)$/)
    assert.equal(parkedAfter(items.get('B1'), items), null)
    assert.equal((await digger({ action: 'next' })).result.id, 'B1')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('answered while its worker is on no other step, the step goes on at once', async () => {
  const { dir, server, person, read } = await garden()
  try {
    await server({ action: 'advance', id: 'B1', to: 'waiting on you', ask: 'Q1' })
    const answered = await person({ action: 'answer', id: 'Q1', text: 'A box' })
    assert.doesNotMatch(answered.result.wake.text, /parked/)
    const items = await read()
    assert.equal(valueOf(items.get('B1'), 'State'), 'in progress')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the flow\'s guard: its asks answered holds only while its worker is on no other step', () => {
  const waits = step('B1', 'waiting on you')
  const ctx = others => ({ store: { items: new Map([waits, ask('Q1', 'B1', { State: 'answered' }), ...others].map(one => [valueOf(one, 'Id'), one])) } })
  assert.equal(mayMove(DEFAULT_FLOW, waits, 'in progress', 'server', ctx([])).ok, true)
  assert.equal(mayMove(DEFAULT_FLOW, waits, 'in progress', 'server', ctx([step('B2', 'in progress')])).ok, false)
  assert.equal(mayMove(DEFAULT_FLOW, waits, 'in progress', 'server', ctx([step('B2', 'queued'), step('B3', 'review')])).ok, true)
  assert.equal(mayMove(DEFAULT_FLOW, waits, 'in progress', 'server', ctx([step('B2', 'in progress', { Owner: 'Raker' })])).ok, true)
})

/** The health summary's view (view.mjs) from items and lanes. */
const view = (items, lanes) => ({
  items: new Map(items.map(one => [valueOf(one, 'Id'), one])), lanes, partner: null, helper: null, prefix: 'Garden · ', now: NOW,
  since: new Map(), outbox: [], repairs: [], limits: {}, pause: null, timeline: [], settings: { reviewMinutes: 60, undeliveredMinutes: 10, reportMinutes: 30, checkpointMinutes: 120 },
})

test('the health summary names a step its worker holds while on another, with the reason; none named is odd', () => {
  const card = { stepId: 'B68', source: 'plan', text: 'B68 picture' }
  const lines = items => healthSummary(view(items, [lane('Digger', { task: card })])).split('\n')
  // X23's B522: in progress 2 h while its worker's card says another step, nothing naming why.
  const unnamed = lines([step('B22', 'in progress', { Since: stamp(ago(120)) }), step('B68', 'in progress')]).find(one => one.includes('B22'))
  assert.match(unnamed, /^- ! B22 in progress for 2 h, Digger \(parked: Digger is on B68; nothing names why it waits\)/)
  // Resting on an ask, or parked: named, not odd for that.
  const rests = lines([step('B47', 'waiting on you', { Since: stamp(ago(20)) }), ask('Q38', 'B47'), step('B68', 'in progress')]).find(one => one.includes('B47'))
  assert.match(rests, /^- B47 waiting on you for 20 min, Digger \(parked: Digger is on B68; rests for Q38\)/)
  const parkedStep = step('B47', 'waiting on you', { Since: stamp(ago(20)) }, { History: [`- ${stamp(ago(20))} server: in progress → waiting on you (rests for Q38)`, `- ${stamp(ago(5))} server: parked (resumes after B68)`] })
  const parked = lines([parkedStep, ask('Q38', 'B47', { State: 'answered' }), step('B68', 'in progress')]).find(one => one.includes('B47'))
  assert.match(parked, /\(parked: Digger is on B68; resumes after B68\)/)
  // The step it is on is no parked step.
  assert.doesNotMatch(lines([step('B68', 'in progress')]).find(one => one.includes('B68 in progress')), /parked/)
  // Its card on the supervisor's page says so too.
  assert.equal(stepState(parkedStep, { lanes: [], steps: new Map([['B47', parkedStep]]) }).text, 'Digger · parked until B68 is reported')
})

test('held-elsewhere: a step in progress over an hour while its worker is on another, nothing naming why, is named to Main once an hour', () => {
  assert.equal(HELD_ELSEWHERE_MS, HOUR)
  const card = { stepId: 'B68', source: 'plan', text: 'B68' }
  const base = (items, more = {}) => ({ items: new Map(items.map(one => [valueOf(one, 'Id'), one])), lanes: [lane('Digger', { task: card })], partner: null, helper: null, prefix: 'Garden · ', now: NOW, outbox: [], limits: {}, pause: null, refused: [], ...more })
  const of = found => found.filter(one => one.check === 'held-elsewhere')
  const B22 = step('B22', 'in progress', { Since: stamp(ago(120)) })
  const observed = []
  const first = of(findStuck({ ...base([B22, step('B68', 'in progress')]), observed }))
  assert.deepEqual(first.map(one => [one.key, one.subject, one.fix.do]), [['held-elsewhere B22 0', 'B22', 'send']])
  assert.equal(first[0].fix.text, 'B22 in progress 2 h 0 min for Digger, whose card says B68: nothing names why it waits; have Digger report it, ask under it or hand it on')
  assert.deepEqual(observed, ['held-elsewhere B22 digger'])
  // Seen an hour and more ago: the next hour's key, so the main chat hears it once more.
  const later = of(findStuck({ ...base([B22, step('B68', 'in progress')]), seen: new Map([['held-elsewhere B22 digger', ago(70)]]) }))
  assert.deepEqual(later.map(one => one.key), ['held-elsewhere B22 1'])
  // Quiet: under an hour, with an open ask, blocked, parked or waiting, on the step itself, paused, suspended.
  assert.deepEqual(of(findStuck(base([step('B22', 'in progress', { Since: stamp(ago(50)) })]))), [])
  assert.deepEqual(of(findStuck(base([B22, ask('Q1', 'B22')]))), [])
  assert.deepEqual(of(findStuck(base([step('B22', 'in progress', { Since: stamp(ago(120)), 'Blocked by': 'B9' }), step('B9', 'review')]))), [])
  assert.deepEqual(of(findStuck(base([step('B22', 'waiting on you', { Since: stamp(ago(120)) })]))), [])
  assert.deepEqual(of(findStuck({ ...base([B22]), lanes: [lane('Digger', { task: { ...card, stepId: 'B22' } })] })), [])
  assert.deepEqual(of(findStuck({ ...base([B22]), pause: { state: 'pausing', since: ago(5) } })), [])
  assert.deepEqual(of(findStuck({ ...base([B22]), lanes: [lane('Digger', { task: card, state: 'suspended' })] })), [])
})
