// T8.5, step 2 (spec 2026-10-31, part 2 "The worker's states and the one transition per event"): the board side of the
// sequence on a real work store and an outbox: each event carried out (T the turn end, D the outcome, K the take, C the
// check's end, R a ready task, P a pause, M a new mod, B its report gone idle), the net once (mutant: the net retrying),
// the set as the hands' job the envelope waits for, the restart word after a restart envelope. Made-up names only.

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { clearOwed } from '../../src/clearOwed.mjs'
import { memoryStore } from '../../src/store.mjs'
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
