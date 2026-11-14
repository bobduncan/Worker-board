// T8.5, step 2 (spec 2026-10-31, part 2 "The worker's states and the one transition per event"): the board side of the
// sequence on a real work store and an outbox: each event carried out (T the turn end, D the outcome, K the take, C the
// check's end, R a ready task, P a pause, M a new mod, B its report gone idle), the net once (mutant: the net retrying),
// the set as the hands' job the envelope waits for, the restart word after a restart envelope. Made-up names only.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { clearOwed } from '../../src/clearOwed.mjs'
import { foldOutbox, memoryStore } from '../../src/store.mjs'
import { workApi } from '../../src/work/api.mjs'
import { readyList } from '../../src/work/handOut.mjs'
import { HANDOVER_COMMAND, NET_MS, NOT_TAKEN_WHY, PAUSED_WHY, STATES, UNANSWERED_WHY } from '../../src/work/handover.mjs'
import { carryable, handOut, handOver, handoverPass, settle } from '../../src/work/handoverBoard.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 31, 10, 0).getTime()
const ROLES = { Lead: 'main', Digger: 'worker', Mower: 'worker', Partner: 'advisor' }
const SONNET = 'claude-sonnet-5-5'
const OPUS = 'claude-opus-5-5'
const CONFIG = { handover: 'sequence', models: { sonnet: SONNET, opus: OPUS } }
const KEEP = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN, pause: null }

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)), problem: null })
const step = (id, state, more = {}, history = [`- ${stamp(NOW - 60 * MIN)} Partner: made`], sections = {}) => item({ Id: id, Kind: 'step', Title: `Task ${id}`, State: state, Activity: 'Garden', Since: stamp(NOW - 60 * MIN), ...(state === 'refined' ? { Refined: 'ready' } : {}), ...more }, { History: history, ...sections })
/** B12, reported by Digger an hour ago and checked: Digger owes its clear. */
const reported = () => step('B12', 'done', { Owner: 'Digger' }, [`- ${stamp(NOW - 90 * MIN)} Digger: queued → taken`, `- ${stamp(NOW - 30 * MIN)} Digger: in progress → review`, `- ${stamp(NOW - 30 * MIN)} server: check passed`])

async function garden(...all) {
  const dir = await mkdtemp(join(tmpdir(), 'handover-board-'))
  const items = new Map(all.map(one => [one.head.get('Id'), one]))
  await writeStore(dir, { items, activities: [{ name: 'Garden', isFocus: false, steps: [...items.keys()], notes: [], loose: [] }] }, undefined, { now: NOW - 60 * MIN })
  const ctx = at => ({ dir, now: at, prefix: '', roleOf: chat => ROLES[chat] ?? null, chats: Object.keys(ROLES), overlapsOfStore: true })
  const outbox = memoryStore()
  let n = 0
  const one = {
    dir, outbox,
    apply: at => body => workApi(body, { ...ctx(at), as: 'server' }),
    as: chat => (body, at) => workApi({ chat, ...body }, ctx(at)),
    read: async id => (await readStore(dir)).items.get(id),
    newId: () => `m${(n += 1)}`,
    /** A lane on the new mod, idle since `since` unless told otherwise. */
    lane: async (name = 'Digger', more = {}) => {
      const base = { name, isMain: false, isLeftover: false, isRunning: true, state: 'free', mod: '0.27.0', model: SONNET, effort: 'medium', appSession: `local_${name.toLowerCase()}`, report: { state: 'idle', since: NOW - 5 * MIN, background: false, at: NOW }, ...more }
      return { ...base, clearOwed: clearOwed({ lane: base, items: (await readStore(dir)).items, afterStep: 'clear' }) }
    },
    /** The board's state as the decision reads it: the lanes, the ready list (beyond the focus), the main chat. */
    state: async (lanes, more = {}) => ({ chats: lanes, chatPrefix: '', readyList: { ready: readyList((await readStore(dir)).items, { now: NOW, beyondFocus: true }).ready }, limits: {}, gaps: [], restart: { main: 'Lead' }, ...more }),
  }
  one.decide = async (lane, at, event = { kind: 'pass' }, more = {}) => handOver({ lane, state: await one.state([lane], more), dir, outbox, apply: one.apply(at), config: CONFIG, now: at, newId: one.newId, event })
  return one
}
const cleanUp = dir => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
const historyOf = async (one, id) => (await one.read(id)).sections.get('History').at(-1)

test('T, D and B: the turn end gives the task and the envelope at once; a refused clear takes it back at once, held; its report gone idle decides again', async () => {
  const one = await garden(reported(), step('B13', 'refined'))
  try {
    const lane = await one.lane('Digger', { report: { state: 'idle', since: NOW, background: true, at: NOW } })
    // T: one decision, the give and the envelope in one call.
    const first = await one.decide(lane, NOW, { kind: 'turn-ended', since: NOW - 20 * MIN })
    assert.equal(first.decision.state, STATES.HANDING)
    assert.deepEqual([valueOf(await one.read('B13'), 'State'), valueOf(await one.read('B13'), 'Owner')], ['queued', 'Digger'])
    assert.equal(first.envelope.command, HANDOVER_COMMAND)
    assert.deepEqual([first.envelope.clear.step, first.envelope.step, first.envelope.line], ['B12', 'B13', 'work: B13 is yours; run work next'])
    // The answer carries it: taken, its contract.
    const handed = await handOut(one.outbox, 'Digger', NOW, KEEP)
    assert.deepEqual(handed, { id: first.envelope.id, kind: 'task', step: 'B13', clear: { step: 'B12', reportedAt: first.envelope.clear.reportedAt }, restart: false, set: null, line: 'work: B13 is yours; run work next' })
    assert.equal(await handOut(one.outbox, 'Digger', NOW, KEEP), null)
    // A second decision at once (the refresh) changes nothing: one envelope, one task in flight.
    const twice = await one.decide(lane, NOW + 1000)
    assert.deepEqual([twice.decision.state, twice.envelope, twice.decision.give], [STATES.HANDING, null, null])
    // D: the clear refused (background work still runs): settled once, the task back at once, held.
    assert.equal(await settle(one.outbox, 'Digger', first.envelope.id, { cleared: false, set: null, typed: false, restarted: null, background: true, why: 'background work it started still runs' }, NOW + 20_000), true)
    assert.equal(await settle(one.outbox, 'Digger', first.envelope.id, { cleared: true, set: null, typed: true, restarted: null, background: false, why: null }, NOW + 21_000), false)
    const held = await one.decide(lane, NOW + 21_000)
    assert.equal(held.decision.state, STATES.HELD)
    assert.equal(valueOf(await one.read('B13'), 'State'), 'refined')
    assert.equal(await historyOf(one, 'B13'), `- ${stamp(NOW + 21_000)} server: queued → refined (taken back from Digger: its clear did not run: background work it started still runs)`)
    // Held: the refresh gives it nothing, B13 waits for another worker.
    const still = await one.decide({ ...lane, report: { ...lane.report, at: NOW + 60_000 } }, NOW + 60_000)
    assert.deepEqual([still.decision.state, still.envelope], [STATES.HELD, null])
    const other = await one.decide(await one.lane('Mower'), NOW + 61_000)
    assert.equal(other.decision.give, 'B13')
  } finally {
    await cleanUp(one.dir)
  }
})

test('B: a held worker whose report says idle with nothing in the background gets the clear and the next task', async () => {
  const one = await garden(reported(), step('B13', 'refined'), step('B14', 'refined'))
  try {
    const lane = await one.lane('Digger', { report: { state: 'idle', since: NOW, background: true, at: NOW } })
    const first = await one.decide(lane, NOW, { kind: 'turn-ended', since: NOW - 20 * MIN })
    await handOut(one.outbox, 'Digger', NOW, KEEP)
    await settle(one.outbox, 'Digger', first.envelope.id, { cleared: false, background: true, why: 'background work it started still runs' }, NOW + 1000)
    await one.decide(lane, NOW + 2000)
    const freed = await one.decide({ ...lane, report: { state: 'idle', since: NOW, background: false, at: NOW + 3 * MIN } }, NOW + 3 * MIN)
    assert.equal(freed.decision.state, STATES.HANDING)
    assert.equal(freed.envelope.clear.step, 'B12')
    assert.equal(freed.decision.give, 'B13')
  } finally {
    await cleanUp(one.dir)
  }
})

test('K and T: the take ends the hand-over; a turn that ended after the line without a take gives it back at once and the next task in the same call', async () => {
  const one = await garden(step('B13', 'refined'), step('B14', 'refined'))
  try {
    const lane = await one.lane()
    const first = await one.decide(lane, NOW, { kind: 'turn-ended', since: NOW - 10 * MIN })
    await handOut(one.outbox, 'Digger', NOW, KEEP)
    await settle(one.outbox, 'Digger', first.envelope.id, { cleared: null, set: null, typed: true, why: null }, NOW + 5000)
    assert.equal((await one.decide(lane, NOW + 6000)).decision.state, STATES.OFFERED)
    // T after the line, no take: B13 back ("did not take it in its turn"), B14 given in the same call.
    const ended = await one.decide(lane, NOW + MIN, { kind: 'turn-ended', since: NOW + 10_000 })
    assert.equal(ended.decision.takeBack.why, NOT_TAKEN_WHY)
    assert.equal(await historyOf(one, 'B13'), `- ${stamp(NOW + MIN)} server: queued → refined (taken back from Digger: ${NOT_TAKEN_WHY})`)
    assert.equal(ended.decision.give, 'B14')
    assert.equal(ended.envelope.step, 'B14')
    // K: it takes B14: working.
    const taken = await one.as('Digger')({ action: 'take', id: 'B14', branch: 'b14', minutes: 30 }, NOW + 2 * MIN)
    assert.equal(taken.ok, true, taken.why)
    assert.equal((await one.decide(lane, NOW + 2 * MIN)).decision.state, STATES.WORKING)
  } finally {
    await cleanUp(one.dir)
  }
})

test('the net: 10 minutes of running time with no outcome, take or turn end: the task back once, unknown; it does not retry (mutant: the net retrying)', async () => {
  const one = await garden(step('B13', 'refined'), step('B14', 'refined'))
  try {
    const lane = await one.lane()
    const first = await one.decide(lane, NOW, { kind: 'turn-ended', since: NOW - 10 * MIN })
    await handOut(one.outbox, 'Digger', NOW, KEEP)
    // 9 minutes: nothing.
    assert.equal((await one.decide(lane, NOW + 9 * MIN)).decision.takeBack, null)
    // The board was off 2 of 11 minutes: still within.
    const offTwo = await handOver({ lane, state: await one.state([lane], { gaps: [{ from: NOW + 3 * MIN, to: NOW + 5 * MIN }] }), dir: one.dir, outbox: one.outbox, apply: one.apply(NOW + 11 * MIN), config: CONFIG, now: NOW + 11 * MIN, newId: one.newId, event: { kind: 'pass' } })
    assert.equal(offTwo.decision.takeBack, null)
    const net = await one.decide(lane, NOW + 12 * MIN)
    assert.equal(net.decision.state, STATES.UNKNOWN)
    assert.equal(net.decision.takeBack.why, UNANSWERED_WHY)
    assert.equal(valueOf(await one.read('B13'), 'State'), 'refined')
    assert.equal(one.outbox.outbox().find(message => message.id === first.envelope.id).netAt, NOW + 12 * MIN)
    // Once: the next refreshes take nothing back and send nothing.
    for (const at of [NOW + 13 * MIN, NOW + 30 * MIN, NOW + 90 * MIN]) {
      const after = await one.decide(lane, at)
      assert.deepEqual([after.decision.state, after.decision.takeBack, after.envelope], [STATES.UNKNOWN, null, null])
    }
    assert.equal(one.outbox.outbox().filter(message => message.command === HANDOVER_COMMAND).length, 1)
    // Its next event (a report that changed) decides anew.
    const back = await one.decide(await one.lane('Digger', { report: { state: 'idle', since: NOW + 91 * MIN, background: false, at: NOW + 91 * MIN } }), NOW + 91 * MIN)
    assert.equal(back.decision.state, STATES.HANDING)
  } finally {
    await cleanUp(one.dir)
  }
})

test('P: a pause takes back the task in flight and closes its envelope that still waits; the resume decides anew', async () => {
  const one = await garden(step('B13', 'refined'))
  try {
    const lane = await one.lane('Digger', { isRunning: false, asleep: true, report: { state: 'ended', since: NOW - 5 * MIN, background: false, at: NOW - 5 * MIN } })
    const first = await one.decide(lane, NOW)
    assert.equal(first.decision.give, 'B13')
    await writeFile(join(one.dir, 'pause.json'), JSON.stringify({ state: 'pausing', since: NOW + MIN, by: 'person' }))
    const paused = await one.decide(lane, NOW + 2 * MIN)
    assert.deepEqual([paused.decision.state, paused.decision.why], [STATES.SUSPENDED, PAUSED_WHY])
    assert.equal(valueOf(await one.read('B13'), 'State'), 'refined')
    assert.equal(one.outbox.outbox().find(message => message.id === first.envelope.id).state, 'dropped')
    assert.equal(carryable(one.outbox.outbox(), 'Digger', NOW + 2 * MIN, KEEP), null)
    await writeFile(join(one.dir, 'pause.json'), JSON.stringify({ state: 'running', since: NOW + 20 * MIN, by: 'person' }))
    const resumed = await one.decide(lane, NOW + 21 * MIN)
    assert.equal(resumed.decision.give, 'B13')
  } finally {
    await cleanUp(one.dir)
  }
})

test('C and R: a pending check gives nothing; its end, and a task that becomes ready for a free worker, decide at the refresh', async () => {
  const pending = step('B12', 'review', { Owner: 'Digger' }, [`- ${stamp(NOW - 2 * MIN)} Digger: in progress → review`, `- ${stamp(NOW - 2 * MIN)} server: check pending`])
  const one = await garden(pending, step('B13', 'refined'))
  try {
    const lane = await one.lane()
    assert.equal((await one.decide(lane, NOW, { kind: 'turn-ended', since: NOW - 10 * MIN })).decision.state, STATES.CHECKING)
    // C: the check passed (the board's own line): the refresh decides; the clear and B13.
    const item = await one.read('B12')
    item.sections.get('History').push(`- ${stamp(NOW + MIN)} server: check passed`)
    item.head.set('State', 'done')
    await writeStore(one.dir, { items: new Map([...((await readStore(one.dir)).items), ['B12', item]]), activities: [{ name: 'Garden', isFocus: false, steps: ['B12', 'B13'], notes: [], loose: [] }] }, undefined, { now: NOW + MIN })
    const checked = await one.decide(await one.lane(), NOW + MIN)
    assert.deepEqual([checked.decision.state, checked.decision.give, checked.envelope.clear?.step], [STATES.HANDING, 'B13', 'B12'])
    // R: Mower is free with nothing; a task becomes ready: the refresh gives it with its line, no clear.
    const mower = await one.lane('Mower')
    assert.equal((await one.decide(mower, NOW + 2 * MIN)).decision.state, STATES.FREE)
    // The partner's refine ends: B15 is refined (written as the store writes it).
    const now = (await readStore(one.dir)).items
    await writeStore(one.dir, { items: new Map([...now, ['B15', step('B15', 'refined')]]), activities: [{ name: 'Garden', isFocus: false, steps: [...now.keys(), 'B15'], notes: [], loose: [] }] }, undefined, { now: NOW + 3 * MIN })
    const id = 'B15'
    const given = await one.decide(mower, NOW + 4 * MIN)
    assert.deepEqual([given.decision.give, given.envelope.clear, given.envelope.line], [id, null, `work: ${id} is yours; run work next`])
  } finally {
    await cleanUp(one.dir)
  }
})

test('the set is the hands\' job: the envelope waits for the set word\'s done; a set word that failed fails the envelope, the task back, held', async () => {
  const opusStep = step('B13', 'refined', {}, undefined, { Model: ['opus: the core'], Effort: ['high: the core'] })
  const one = await garden(opusStep, step('B14', 'refined'))
  try {
    const lane = await one.lane()
    const first = await one.decide(lane, NOW, { kind: 'turn-ended', since: NOW - 10 * MIN })
    assert.deepEqual(first.envelope.set, { model: OPUS, effort: 'high' })
    const word = one.outbox.outbox().find(message => message.id === first.envelope.waitsFor)
    assert.deepEqual([word.command, word.to, word.about, word.model, word.effort, word.envelope], ['worker-effort', 'Lead', 'Digger', OPUS, 'high', first.envelope.id])
    // Not carried while the set word waits.
    assert.equal(await handOut(one.outbox, 'Digger', NOW, KEEP), null)
    // Its done: carried.
    await one.outbox.update(word.id, { state: 'delivered', deliveredAt: NOW + 30_000 })
    assert.equal((await handOut(one.outbox, 'Digger', NOW + 30_000, KEEP)).id, first.envelope.id)
    // Another one whose set word failed: the refresh fails the envelope, the task back, held.
    const two = await garden(opusStep)
    try {
      const firstTwo = await two.decide(await two.lane(), NOW, { kind: 'turn-ended', since: NOW - 10 * MIN })
      await two.outbox.update(firstTwo.envelope.waitsFor, { state: 'failed', failedAt: NOW + MIN, why: 'the app refused the model' })
      const passed = await handoverPass({ state: await two.state([await two.lane()]), dir: two.dir, outbox: two.outbox, apply: two.apply(NOW + MIN), config: CONFIG, now: NOW + MIN, newId: two.newId })
      assert.deepEqual(passed.decided, [{ chat: 'Digger', state: STATES.HELD }])
      assert.equal(valueOf(await two.read('B13'), 'State'), 'refined')
      assert.match(await historyOf(two, 'B13'), /its model and effort could not be set: the app refused the model/)
    } finally {
      await cleanUp(two.dir)
    }
  } finally {
    await cleanUp(one.dir)
  }
})

test('M: a worker on an older mod than the installed one gets one restart envelope; once carried out, the hands\' restart word once; on the new mod its task', async () => {
  const one = await garden(step('B13', 'refined'))
  try {
    const lane = await one.lane('Digger', { mod: '0.27.0' })
    const restart = await handOver({ lane, state: await one.state([lane]), dir: one.dir, outbox: one.outbox, apply: one.apply(NOW), config: CONFIG, installed: '0.27.1', now: NOW, newId: one.newId, event: { kind: 'turn-ended', since: NOW - MIN } })
    assert.deepEqual([restart.decision.state, restart.envelope.restart, restart.envelope.version, restart.decision.give], [STATES.RESTARTING, true, '0.27.1', null])
    const handed = await handOut(one.outbox, 'Digger', NOW, KEEP)
    assert.deepEqual([handed.restart, handed.version], [true, '0.27.1'])
    await settle(one.outbox, 'Digger', handed.id, { restarted: true }, NOW + 5000)
    const awaited = await one.state([lane])
    const pass = () => handoverPass({ state: awaited, dir: one.dir, outbox: one.outbox, apply: one.apply(NOW + 10_000), config: CONFIG, installed: '0.27.1', now: NOW + 10_000, newId: one.newId })
    await pass()
    await pass()
    const words = one.outbox.outbox().filter(message => message.command === 'mod-restart')
    assert.deepEqual(words.map(message => [message.to, message.about, message.version]), [['Lead', 'Digger', '0.27.1']])
    // M: its first call on the new mod: decided, its task.
    const fresh = await handOver({ lane: { ...lane, mod: '0.27.1' }, state: await one.state([lane]), dir: one.dir, outbox: one.outbox, apply: one.apply(NOW + MIN), config: CONFIG, installed: '0.27.1', now: NOW + MIN, newId: one.newId, event: { kind: 'pass' } })
    assert.equal(fresh.decision.give, 'B13')
  } finally {
    await cleanUp(one.dir)
  }
})

test('the predicate at the refresh: a worker on the timers or on an older mod is not decided by the sequence', async () => {
  const one = await garden(step('B13', 'refined'))
  try {
    const old = await one.lane('Digger', { mod: '0.26.10' })
    const passed = await handoverPass({ state: await one.state([old]), dir: one.dir, outbox: one.outbox, apply: one.apply(NOW), config: CONFIG, now: NOW, newId: one.newId })
    assert.deepEqual(passed.decided, [])
    const timers = await handoverPass({ state: await one.state([await one.lane()]), dir: one.dir, outbox: one.outbox, apply: one.apply(NOW), config: { ...CONFIG, handover: 'timers' }, now: NOW, newId: one.newId })
    assert.deepEqual(timers.decided, [])
    assert.equal(valueOf(await one.read('B13'), 'State'), 'refined')
    assert.deepEqual(one.outbox.outbox(), [])
  } finally {
    await cleanUp(one.dir)
  }
})

// ---- Signals change 4, B908, D.4 (decision 12, 2026-11-02 11:07: Worker 5's envelope with a clear was carried while the
// turn its wake message started still ran; a clear then fails "a turn is running"). Made-up times.

test('X107/X3 (2026-11-02 14:45, Worker 5): the envelope\'s line is waived at the hand-out when the wake message carried that step\'s take line; another step\'s, or no wake, keeps it', async () => {
  const { claim, emptyWakes, heard, sent, wakeCarriedTake } = await import('../../src/wake.mjs')
  const record = emptyWakes()
  const T = new Date(2026, 10, 2, 14, 45, 45).getTime()
  claim(record, { chat: 'Worker 5', spell: T - 900_000, path: 'message', by: 'Main', jobId: 'wake:1:Worker 5', now: T, runBefore: 1, step: 'B916' })
  sent(record, 'Worker 5', 'wake:1:Worker 5', T + 5_000)
  heard(record, 'Worker 5', { state: 'busy', run: 2, at: T + 29_000 }, T + 29_000)
  const keep = { messageMs: 60 * 60_000, answerMs: 24 * 60 * 60_000 }
  const envelope = step => ({ id: `e-${step}`, at: T - 22_000, to: 'Worker 5', ask: null, title: null, version: null, verdict: null, command: HANDOVER_COMMAND, about: 'Worker 5', text: 'hand-over', kind: 'task', step, clear: null, restart: false, set: null, line: `work: ${step} is yours; run work next`, state: 'waiting' })
  const waive = step => wakeCarriedTake(record, 'Worker 5', step)
  // The step the wake message named: the contract carries no line; the outbox says why; the clear and set would still go.
  const one = memoryStore()
  await one.say(envelope('B916'))
  const contract = await handOut(one, 'Worker 5', T + 38_000, keep, { waiveLine: waive })
  assert.deepEqual([contract.id, contract.step, contract.line], ['e-B916', 'B916', null])
  assert.equal(one.outbox().find(message => message.id === 'e-B916').lineWaived, 'the wake message carried its take line')
  // Another step: its line goes as before; and without the waiver, B916's too.
  const two = memoryStore()
  await two.say(envelope('B917'))
  assert.equal((await handOut(two, 'Worker 5', T + 38_000, keep, { waiveLine: waive })).line, 'work: B917 is yours; run work next')
  const three = memoryStore()
  await three.say(envelope('B916'))
  assert.equal((await handOut(three, 'Worker 5', T + 38_000, keep)).line, 'work: B916 is yours; run work next')
})

test('change 4, D.4: carryable holds back an envelope with a clear while the woken chat\'s first turn runs; after its end it goes', async () => {
  const { claim, emptyWakes, heard, inFirstTurn, sent, turnEnded } = await import('../../src/wake.mjs')
  const record = emptyWakes()
  const T = new Date(2026, 10, 2, 11, 6, 50).getTime()
  claim(record, { chat: 'Worker 5', spell: T - 3_600_000, path: 'message', by: 'Advisor', jobId: 'wake:1:Worker 5', now: T - 5_000, runBefore: 1 })
  sent(record, 'Worker 5', 'wake:1:Worker 5', T)
  heard(record, 'Worker 5', { state: 'busy', run: 2, at: T + 13_000 }, T + 13_000)
  const withClear = { id: 'e1', at: T - 293_000, to: 'Worker 5', command: HANDOVER_COMMAND, kind: 'task', step: 'B855', clear: { step: 'B821', reportedAt: T - 9_000_000 }, line: 'work: B855 is yours; run work next', state: 'waiting' }
  const plain = { ...withClear, id: 'e2', clear: null }
  const keep = { messageMs: 60 * 60_000, answerMs: 24 * 60 * 60_000 }
  assert.equal(inFirstTurn(record, 'Worker 5'), true)
  assert.equal(carryable([withClear], 'Worker 5', T + 14_000, keep, { holdClear: inFirstTurn(record, 'Worker 5') }), null)
  // An envelope without a clear goes at once; and the clear one without the hold, as before.
  assert.equal(carryable([plain], 'Worker 5', T + 14_000, keep, { holdClear: true })?.id, 'e2')
  assert.equal(carryable([withClear], 'Worker 5', T + 14_000, keep)?.id, 'e1')
  // The first turn end was seen: the chat's next take gets it.
  turnEnded(record, 'Worker 5', T + 31_000)
  assert.equal(carryable([withClear], 'Worker 5', T + 36_000, keep, { holdClear: inFirstTurn(record, 'Worker 5') })?.id, 'e1')
})

test('review (2): a launch-woken chat with a clear envelope gets it at its first take (no turn holds it)', async () => {
  const { claim, emptyWakes, heard, inFirstTurn, sent } = await import('../../src/wake.mjs')
  const record = emptyWakes()
  const T = new Date(2026, 10, 2, 10, 32).getTime()
  claim(record, { chat: 'Worker 2', spell: T - 3_600_000, path: 'launch', by: 'board', jobId: 'l', now: T, runBefore: 1 })
  sent(record, 'Worker 2', 'l', T + 5_000)
  const report = { state: 'idle', run: 2, at: T + 40_000 }
  heard(record, 'Worker 2', report, T + 40_000)
  const withClear = { id: 'e1', at: T - 60_000, to: 'Worker 2', command: HANDOVER_COMMAND, kind: 'task', step: 'B855', clear: { step: 'B821', reportedAt: T - 9_000_000 }, line: 'work: B855 is yours; run work next', state: 'waiting' }
  const keep = { messageMs: 60 * 60_000, answerMs: 24 * 60 * 60_000 }
  assert.equal(carryable([withClear], 'Worker 2', T + 40_000, keep, { holdClear: inFirstTurn(record, 'Worker 2', report) })?.id, 'e1')
})

// ---- The lazy clear (Workers mod 0.31.0, brief Task 1 with D1, D4, D8) on a real work store and an outbox.

test('the lazy clear, the real case of 2026-11-02 21:25 on the board: a free worker that owes a clear gets no envelope at its turn end nor at the passes; its next task carries the clear (mutant: a clear-only envelope written)', async () => {
  const one = await garden(reported())
  try {
    const lane = await one.lane()
    assert.equal(lane.clearOwed.step, 'B12')
    const ended = await one.decide(lane, NOW, { kind: 'turn-ended', since: NOW - 20 * MIN })
    assert.deepEqual([ended.decision.state, ended.envelope], [STATES.FREE, null])
    const passed = await handoverPass({ state: await one.state([lane]), dir: one.dir, outbox: one.outbox, apply: one.apply(NOW + MIN), config: CONFIG, now: NOW + MIN, newId: one.newId })
    assert.deepEqual(passed, { decided: [{ chat: 'Digger', state: STATES.FREE }], wrote: 0 })
    assert.deepEqual(one.outbox.outbox(), [])
    // B13 becomes ready: the next pass gives it with the owed clear in one envelope.
    const now = (await readStore(one.dir)).items
    await writeStore(one.dir, { items: new Map([...now, ['B13', step('B13', 'refined')]]), activities: [{ name: 'Garden', isFocus: false, steps: [...now.keys(), 'B13'], notes: [], loose: [] }] }, undefined, { now: NOW + 2 * MIN })
    const given = await one.decide(await one.lane(), NOW + 3 * MIN)
    assert.deepEqual([given.envelope.kind, given.envelope.clear?.step, given.envelope.step], ['task', 'B12', 'B13'])
    assert.deepEqual(one.outbox.outbox().map(message => message.kind), ['task'])
  } finally {
    await cleanUp(one.dir)
  }
})

test('the lazy clear, D4 at the settle: cleared:false with the line typed is delivered, not failed; no take-back, no hold; settled once (mutants: HELD on cleared:false; takeBack on a clear failure; settle twice)', async () => {
  const one = await garden(reported(), step('B13', 'refined'))
  try {
    const lane = await one.lane()
    const first = await one.decide(lane, NOW, { kind: 'turn-ended', since: NOW - 20 * MIN })
    await handOut(one.outbox, 'Digger', NOW, KEEP)
    const outcome = { cleared: false, set: null, typed: true, restarted: null, background: false, why: null, clearWhy: 'the board did not answer in 5 s', typedAt: NOW + 6_000, enteredAt: NOW + 6_500 }
    assert.equal(await settle(one.outbox, 'Digger', first.envelope.id, outcome, NOW + 7_000), true)
    const message = one.outbox.outbox().find(one => one.id === first.envelope.id)
    assert.deepEqual([message.state, message.deliveredAt, message.failedAt, message.outcome.clearWhy], ['delivered', NOW + 7_000, undefined, 'the board did not answer in 5 s'])
    // Settled once: a second outcome changes nothing.
    assert.equal(await settle(one.outbox, 'Digger', first.envelope.id, { ...outcome, cleared: true }, NOW + 8_000), false)
    assert.equal(one.outbox.outbox().find(one => one.id === first.envelope.id).outcome.cleared, false)
    const after = await one.decide(await one.lane(), NOW + 8_000)
    assert.deepEqual([after.decision.state, after.decision.takeBack, after.envelope], [STATES.OFFERED, null, null])
    assert.deepEqual([valueOf(await one.read('B13'), 'State'), valueOf(await one.read('B13'), 'Owner')], ['queued', 'Digger'])
    assert.doesNotMatch(await historyOf(one, 'B13'), /taken back/)
    // The clear is still owed: no clear ran.
    assert.equal((await one.lane()).clearOwed.step, 'B12')
    // The set still fails an envelope (D4): failed, its why.
    const two = await garden(reported(), step('B14', 'refined'))
    try {
      const firstTwo = await two.decide(await two.lane(), NOW, { kind: 'turn-ended', since: NOW - 20 * MIN })
      await settle(two.outbox, 'Digger', firstTwo.envelope.id, { ...outcome, set: false, why: 'the app refused the model' }, NOW + 7_000)
      assert.equal(two.outbox.outbox().find(one => one.id === firstTwo.envelope.id).state, 'failed')
      assert.equal((await two.decide(await two.lane(), NOW + 8_000)).decision.state, STATES.HELD)
    } finally {
      await cleanUp(two.dir)
    }
  } finally {
    await cleanUp(one.dir)
  }
})

test('the lazy clear, D1: the stages on the envelope, merged in the turn: two quick posts both kept, a repeat ignored, taken in any state and after the outcome; another chat\'s or no envelope: not taken (mutant: a stage lost between two quick posts)', async () => {
  const { addStages, inTurn } = await import('../../src/work/handoverBoard.mjs')
  const one = await garden(reported(), step('B13', 'refined'))
  try {
    const first = await one.decide(await one.lane(), NOW, { kind: 'turn-ended', since: NOW - 20 * MIN })
    const id = first.envelope.id
    await handOut(one.outbox, 'Digger', NOW, KEEP)
    const stagesNow = () => one.outbox.outbox().find(message => message.id === id).stages.map(stage => stage.stage)
    // Two posts at once, each in the one turn per store (as the server's typed route runs them).
    const [a, b] = await Promise.all([
      inTurn(one.dir, () => addStages(one.outbox, 'Digger', id, [{ stage: 'log-saved', at: NOW + 1_000, log: 'logs/B12.md' }])),
      inTurn(one.dir, () => addStages(one.outbox, 'Digger', id, [{ stage: 'clear-queued', at: NOW + 1_100, ticket: 'clear-1-1' }])),
    ])
    assert.deepEqual([a, b], [true, true])
    assert.deepEqual(stagesNow(), ['log-saved', 'clear-queued'])
    // The mod's retry of the same stage: taken (true), not written twice; the first entry stays.
    assert.equal(await addStages(one.outbox, 'Digger', id, [{ stage: 'log-saved', at: NOW + 9_000, log: 'other.md' }]), true)
    assert.deepEqual(one.outbox.outbox().find(message => message.id === id).stages[0], { stage: 'log-saved', at: NOW + 1_000, log: 'logs/B12.md' })
    // The final outcome; then a late stage is still taken; the settle never touches the stages.
    await addStages(one.outbox, 'Digger', id, [{ stage: 'clear-refused', at: NOW + 21_000, why: 'not run in 20 s' }])
    assert.equal(await settle(one.outbox, 'Digger', id, { cleared: false, typed: true, clearWhy: 'not run in 20 s' }, NOW + 22_000), true)
    assert.equal(await addStages(one.outbox, 'Digger', id, [{ stage: 'cleared', at: NOW + 30_000, session: 'new-id' }]), true)
    assert.deepEqual(stagesNow(), ['log-saved', 'clear-queued', 'clear-refused', 'cleared'])
    // In any state: also a closed one.
    await one.outbox.update(id, { state: 'dropped' })
    assert.equal(await addStages(one.outbox, 'Digger', id, [{ stage: 'cleared', at: NOW + 40_000 }]), true)
    // Another chat's envelope, or none: not taken.
    assert.equal(await addStages(one.outbox, 'Mower', id, [{ stage: 'cleared', at: NOW + 40_000 }]), false)
    assert.equal(await addStages(one.outbox, 'Digger', 'nope', [{ stage: 'cleared', at: NOW + 40_000 }]), false)
  } finally {
    await cleanUp(one.dir)
  }
})

test('the lazy clear, D8: the landing sweep closes every clear-only envelope still waiting, with its reason; a task\'s and a restart stay', async () => {
  const { CLEAR_ONLY_CLOSED_WHY, closeClearOnly } = await import('../../src/work/handoverBoard.mjs')
  const outbox = memoryStore()
  const base = { to: 'Digger', command: HANDOVER_COMMAND, restart: false, set: null, back: null }
  await outbox.say({ ...base, id: 'c1', at: NOW - 5 * MIN, kind: 'clear', step: null, clear: { step: 'B12', reportedAt: NOW - 6 * MIN }, line: null, state: 'waiting' })
  await outbox.say({ ...base, id: 't1', at: NOW - 4 * MIN, kind: 'task', step: 'B13', clear: { step: 'B12', reportedAt: NOW - 6 * MIN }, line: 'work: B13 is yours; run work next', state: 'waiting' })
  await outbox.say({ ...base, id: 'r1', at: NOW - 4 * MIN, kind: 'restart', step: null, clear: null, restart: true, line: null, version: '0.31.0', state: 'waiting' })
  assert.equal(await closeClearOnly(outbox, NOW), 1)
  const of = id => outbox.outbox().find(message => message.id === id)
  assert.deepEqual([of('c1').state, of('c1').why, of('c1').closedAt], ['dropped', CLEAR_ONLY_CLOSED_WHY, NOW])
  assert.deepEqual([of('t1').state, of('r1').state], ['waiting', 'waiting'])
  // Again (every start): nothing more.
  assert.equal(await closeClearOnly(outbox, NOW + MIN), 0)
})

test('Fix 0.31.0, part 4: a lone clear from before 0.31.0 that was TAKEN and never answered is settled dropped at the start too: the real envelope ba1272913fdc729f (Worker 3, the clear after B981, X141)', async () => {
  const { CLEAR_ONLY_TAKEN_WHY, closeClearOnly } = await import('../../src/work/handoverBoard.mjs')
  const fixture = JSON.parse(await readFile(new URL('../fixtures/lazy-clear-2026-11-04.json', import.meta.url), 'utf8'))
  const outbox = memoryStore()
  // The real records of the live outbox: written 12:24:36.877, taken 12:24:36.921, the net fired at 16:22:56 (`netAt`), never settled.
  outbox.outbox().push(...foldOutbox(fixture.outbox.filter(line => line.id === 'ba1272913fdc729f').map(line => JSON.stringify(line)).join('\n')))
  const real = outbox.outbox().find(message => message.id === 'ba1272913fdc729f')
  assert.deepEqual([real.state, real.kind, real.step, real.line, real.outcome ?? null, Number.isFinite(real.netAt)], ['taken', 'clear', null, null, null, true])
  assert.equal(CLEAR_ONLY_TAKEN_WHY, 'a lone clear from before 0.31.0, never answered')
  // Beside it, what stays: a task's envelope taken, a restart taken, a lone clear the mod answered (delivered, failed), another chat's word.
  const base = { to: 'Digger', command: HANDOVER_COMMAND, restart: false, set: null, back: null }
  const later = NOW - 5 * MIN
  await outbox.say({ ...base, id: 't1', at: later, kind: 'task', step: 'B13', clear: { step: 'B12', reportedAt: later }, line: 'work: B13 is yours; run work next', state: 'taken' })
  await outbox.say({ ...base, id: 'r1', at: later, kind: 'restart', step: null, clear: null, restart: true, line: null, version: '0.31.0', state: 'taken' })
  await outbox.say({ ...base, id: 'd1', at: later, kind: 'clear', step: null, clear: { step: 'B12', reportedAt: later }, line: null, state: 'delivered', outcome: { cleared: true } })
  await outbox.say({ ...base, id: 'f1', at: later, kind: 'clear', step: null, clear: { step: 'B12', reportedAt: later }, line: null, state: 'failed', outcome: { cleared: false } })
  await outbox.say({ ...base, id: 'x1', at: later, command: 'work', kind: 'clear', step: null, clear: { step: 'B12', reportedAt: later }, line: null, state: 'taken' })
  assert.equal(await closeClearOnly(outbox, NOW), 1)
  const of = id => outbox.outbox().find(message => message.id === id)
  assert.deepEqual([of('ba1272913fdc729f').state, of('ba1272913fdc729f').why, of('ba1272913fdc729f').closedAt], ['dropped', CLEAR_ONLY_TAKEN_WHY, NOW])
  assert.deepEqual(['t1', 'r1', 'd1', 'f1', 'x1'].map(id => of(id).state), ['taken', 'taken', 'delivered', 'failed', 'taken'])
  // Again (every start): nothing more.
  assert.equal(await closeClearOnly(outbox, NOW + MIN), 0)
})

test('mutant "taken left out": the start sweep counts a taken lone clear with no outcome, a waiting one with its own reason, and both in one number', async () => {
  const { CLEAR_ONLY_CLOSED_WHY, CLEAR_ONLY_TAKEN_WHY, closeClearOnly } = await import('../../src/work/handoverBoard.mjs')
  const outbox = memoryStore()
  const base = { to: 'Digger', command: HANDOVER_COMMAND, restart: false, set: null, back: null, kind: 'clear', step: null, line: null, clear: { step: 'B12', reportedAt: NOW - 6 * MIN } }
  await outbox.say({ ...base, id: 'w', at: NOW - 5 * MIN, state: 'waiting' })
  await outbox.say({ ...base, id: 'k', at: NOW - 5 * MIN, to: 'Mower', state: 'taken' })
  assert.equal(await closeClearOnly(outbox, NOW), 2)
  const of = id => outbox.outbox().find(message => message.id === id)
  assert.deepEqual([of('w').why, of('k').why], [CLEAR_ONLY_CLOSED_WHY, CLEAR_ONLY_TAKEN_WHY])
  assert.deepEqual([of('w').state, of('k').state], ['dropped', 'dropped'])
})

test('B1207 (X26 back): the envelope keeps the step\'s whole setting at its hand-over (`wants`), also when it needs no set; the mod\'s contract leaves it out', async () => {
  const one = await garden(step('B13', 'refined', {}, undefined, { Model: ['sonnet · a small fix'], Effort: ['high · a board fix'] }))
  try {
    const lane = await one.lane('Digger', { effort: 'high' })
    const first = await one.decide(lane, NOW)
    assert.deepEqual([first.envelope.set, first.envelope.wants], [null, { model: SONNET, effort: 'high' }])
    assert.equal(Object.hasOwn(await handOut(one.outbox, 'Digger', NOW, KEEP), 'wants'), false)
  } finally {
    await cleanUp(one.dir)
  }
  const two = await garden(step('B14', 'refined', {}, undefined, { Model: ['opus · core'], Effort: ['high · core'] }))
  try {
    const handed = await two.decide(await two.lane('Mower'), NOW)
    assert.deepEqual([handed.envelope.set, handed.envelope.wants], [{ model: OPUS, effort: 'high' }, { model: OPUS, effort: 'high' }])
  } finally {
    await cleanUp(two.dir)
  }
})
