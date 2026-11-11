// B1160 (chat 1's decisions 2 and 3, 2026-11-11): since the app's update of 22:43 (5.1231.2) Claude Desktop refuses in auto mode every
// set_session_model / set_session_effort call the Workers mod's own code makes. 70 refusals by 23:37; B1160 and B1163 bounced
// between refined and queued every minute, owed clears never ran and free workers sat idle. A refused set never stops a hand-over
// (the clear and the line go in, the worker runs on its current model), the board writes no more set words while it stands, and a
// step goes to the free worker closest to its run first. The refusal's words and the B1160/B1163 case are the live ones; the
// garden (Digger, Mower, Lead) is made up.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { clearOwed } from '../../src/clearOwed.mjs'
import { memoryStore } from '../../src/store.mjs'
import { workApi } from '../../src/work/api.mjs'
import { effortPlan, isSetRefused, setsRefusedOf } from '../../src/work/effort.mjs'
import { match, readyList } from '../../src/work/handOut.mjs'
import { STATES, bansOf, decide, failedOf, laneWords } from '../../src/work/handover.mjs'
import { handOut, handOver, handoverPass } from '../../src/work/handoverBoard.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 11, 23, 37).getTime()
const SONNET = 'claude-sonnet-5-5'
const OPUS = 'claude-opus-5-5'
const CONFIG = { handover: 'sequence', models: { sonnet: SONNET, opus: OPUS } }
const KEEP = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN, pause: null }
const ROLES = { Lead: 'main', Digger: 'worker', Mower: 'worker' }
/** The app's refusal, word for word as the outbox held it at 23:37 (fec11766ce1be469, B1160 for Worker 5). */
const REFUSAL = 'PreToolUse:mcp__ccd_session_mgmt__set_session_effort hook error: Not run: in auto mode Claude Desktop doesn\'t run this tool when a plugin\'s own code calls it. Have Claude make the call.'

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)), problem: null })
const step = (id, state, more = {}, sections = {}) => item({ Id: id, Kind: 'step', Title: `Task ${id}`, State: state, Activity: 'Garden', Since: stamp(NOW - 60 * MIN), ...(state === 'refined' ? { Refined: 'ready' } : {}), ...more }, { History: [`- ${stamp(NOW - 60 * MIN)} Partner: made`], ...sections })
/** B1163 as refined: opus, high (the board's hand-over core). */
const opusStep = id => step(id, 'refined', {}, { Model: ['opus: the board\'s hand-over core'], Effort: ['high: the set, clear and line order'] })

async function garden(...all) {
  const dir = await mkdtemp(join(tmpdir(), 'set-refused-'))
  const items = new Map(all.map(one => [one.head.get('Id'), one]))
  await writeStore(dir, { items, activities: [{ name: 'Garden', isFocus: false, steps: [...items.keys()], notes: [], loose: [] }] }, undefined, { now: NOW - 60 * MIN })
  const ctx = at => ({ dir, now: at, prefix: '', roleOf: chat => ROLES[chat] ?? null, chats: Object.keys(ROLES), overlapsOfStore: true })
  const outbox = memoryStore()
  let n = 0
  const one = {
    dir, outbox,
    apply: at => body => workApi(body, { ...ctx(at), as: 'server' }),
    read: async id => (await readStore(dir)).items.get(id),
    newId: () => `m${(n += 1)}`,
    lane: async (name = 'Digger', more = {}) => {
      const base = { name, isMain: false, isLeftover: false, isRunning: true, state: 'free', mod: '0.27.0', model: SONNET, effort: 'low', appSession: `local_${name.toLowerCase()}`, report: { state: 'idle', since: NOW - 5 * MIN, background: false, at: NOW }, held: null, ...more }
      return { ...base, clearOwed: clearOwed({ lane: base, items: (await readStore(dir)).items, afterStep: 'clear' }) }
    },
    state: async (lanes, more = {}) => ({ chats: lanes, chatPrefix: '', readyList: { ready: readyList((await readStore(dir)).items, { now: NOW, beyondFocus: true }).ready }, limits: {}, gaps: [], restart: { main: 'Lead' }, ...more }),
  }
  one.decide = async (lane, at, event = { kind: 'pass' }, lanes = [lane]) => handOver({ lane, state: await one.state(lanes), dir, outbox, apply: one.apply(at), config: CONFIG, now: at, newId: one.newId, event })
  return one
}
const cleanUp = dir => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

test('the refusal is recognised by its real words; a set word that failed for another reason is not it', () => {
  assert.equal(isSetRefused({ state: 'failed', why: REFUSAL }), true)
  assert.equal(isSetRefused({ state: 'failed', outcome: { set: false, why: REFUSAL } }), true)
  assert.equal(isSetRefused({ state: 'failed', why: 'the app refused the model' }), false)
  assert.equal(isSetRefused({ state: 'delivered' }), false)
  // A refused envelope is no failure and bans nothing; one that failed otherwise still does both.
  const refused = { set: { model: OPUS, effort: 'high' }, state: 'failed', outcome: { cleared: null, set: false, typed: false, why: REFUSAL } }
  const other = { set: { model: OPUS, effort: 'high' }, state: 'failed', outcome: { cleared: null, set: false, typed: false, why: 'the app refused the model' } }
  assert.equal(failedOf(refused), false)
  assert.equal(failedOf(other), true)
  assert.deepEqual([...bansOf([refused], NOW).keys()], [])
  assert.deepEqual([...bansOf([other], NOW).keys()], [OPUS])
})

test('decision 2: an envelope whose set word the app refused goes again at once without its set: no take-back, no bounce', async () => {
  const one = await garden(opusStep('B1160'))
  try {
    const lane = await one.lane()
    const first = await one.decide(lane, NOW, { kind: 'turn-ended', since: NOW - 10 * MIN })
    assert.deepEqual(first.envelope.set, { model: OPUS, effort: 'high' })
    // The hands refuse the set word as the app did at 23:37: the next pass keeps the envelope, without its set, and carries it.
    await one.outbox.update(first.envelope.waitsFor, { state: 'failed', failedAt: NOW + 10_000, why: REFUSAL })
    const passed = await handoverPass({ state: await one.state([lane]), dir: one.dir, outbox: one.outbox, apply: one.apply(NOW + 20_000), config: CONFIG, now: NOW + 20_000, newId: one.newId })
    assert.notEqual(passed.decided[0].state, STATES.HELD)
    const kept = one.outbox.outbox().find(message => message.id === first.envelope.id)
    assert.deepEqual([kept.state, kept.set, kept.asked, kept.waitsFor], ['waiting', null, { model: OPUS, effort: 'high' }, null])
    assert.deepEqual([valueOf(await one.read('B1160'), 'State'), valueOf(await one.read('B1160'), 'Owner')], ['queued', 'Digger'])
    const handed = await handOut(one.outbox, 'Digger', NOW + 20_000, KEEP)
    assert.deepEqual([handed.step, handed.set, handed.line, handed.clear], ['B1160', null, 'work: B1160 is yours; run work next', null])
    assert.ok(!(await one.read('B1160')).sections.get('History').some(line => /taken back/.test(line)), 'never taken back')
  } finally {
    await cleanUp(one.dir)
  }
})

test('decision 2: while the refusal stands no set word is written: the envelope goes without its set and keeps it as asked', async () => {
  const one = await garden(opusStep('B1163'))
  try {
    await one.outbox.say({ id: 'w0', at: NOW - 2 * MIN, to: 'Lead', command: 'worker-effort', about: 'Mower', effort: 'high', state: 'failed', failedAt: NOW - 2 * MIN, why: REFUSAL })
    assert.equal(setsRefusedOf(one.outbox.outbox(), NOW), true)
    assert.equal(setsRefusedOf(one.outbox.outbox(), NOW + 3 * 60 * MIN), false, 'one try again after 2 h')
    const lane = await one.lane()
    const first = await one.decide(lane, NOW, { kind: 'turn-ended', since: NOW - 10 * MIN })
    assert.deepEqual([first.envelope.set, first.envelope.asked, first.envelope.waitsFor], [null, { model: OPUS, effort: 'high' }, undefined])
    assert.equal(one.outbox.outbox().filter(message => message.command === 'worker-effort').length, 1, 'no new set word')
    assert.match(first.envelope.text, /Asked, not set \(the app refuses the board's set\): claude-opus-5-5 · high/)
    assert.equal((await handOut(one.outbox, 'Digger', NOW, KEEP)).step, 'B1163')
  } finally {
    await cleanUp(one.dir)
  }
})

test('decision 2: an envelope that already failed on the refusal before this fix holds nothing: the worker gets its next task', async () => {
  const one = await garden(opusStep('B1160'), step('B1161', 'refined'))
  try {
    const lane = await one.lane()
    // The live state at 23:39: B1160 taken back, the envelope failed on the refusal.
    await one.outbox.say({ id: 'e0', at: NOW - MIN, to: 'Digger', command: 'handover', kind: 'task', step: 'B1160', clear: null, restart: false, set: { model: OPUS, effort: 'high' }, line: 'work: B1160 is yours; run work next', state: 'failed', failedAt: NOW - MIN, settledAt: NOW - MIN, outcome: { cleared: null, set: false, typed: false, restarted: null, background: false, why: REFUSAL } })
    const next = await one.decide(lane, NOW)
    assert.equal(next.decision.state, STATES.HANDING)
    assert.ok(['B1160', 'B1161'].includes(next.decision.give))
  } finally {
    await cleanUp(one.dir)
  }
})

test('decision 2: the effort plan asks no set word while the refusal stands, and its run says so', () => {
  const items = new Map([['B1163', step('B1163', 'queued', { Owner: 'Digger' }, { Model: ['opus: core'], Effort: ['high: core'] })]])
  const lanes = [{ name: 'Digger', model: SONNET, effort: 'low', appSession: 'local_digger' }]
  const sent = [{ id: 'w0', at: NOW - MIN, command: 'worker-effort', about: 'Mower', state: 'failed', failedAt: NOW - MIN, why: REFUSAL }]
  const plan = effortPlan({ items, lanes, sent, now: NOW, main: 'Lead', models: CONFIG.models })
  assert.deepEqual(plan.words, [])
  assert.equal(plan.runs.get('Digger').refused, true)
  assert.equal(plan.runs.get('Digger').waitsFor, null, 'no wait for Opus that cannot come')
  const asked = effortPlan({ items, lanes, sent: [], now: NOW, main: 'Lead', models: CONFIG.models })
  assert.equal(asked.words.length, 1, 'without the refusal the word goes as before')
})

test('decision 3: B1163 (opus, high) goes to the free worker already on Opus at high, not the first free one on Sonnet', async () => {
  const items = new Map([['B1163', opusStep('B1163')]])
  const ready = [{ id: 'B1163', keptFor: null, pinned: null, prefers: null }]
  const sonnetLow = { name: 'Worker 1', model: SONNET, effort: 'low', isRunning: true }
  const opusMedium = { name: 'Worker 2', model: OPUS, effort: 'medium', isRunning: true }
  const opusHigh = { name: 'Worker 3', model: OPUS, effort: 'high', isRunning: true }
  assert.equal(match({ ready, idle: [sonnetLow, opusMedium, opusHigh], items })[0].chat, 'Worker 3')
  assert.equal(match({ ready, idle: [sonnetLow, opusMedium], items })[0].chat, 'Worker 2', 'then the closest: on its model')
  // The hand-over itself: Digger (Sonnet, low) is idle first, Mower (Opus, high) beside it: Digger gets nothing, Mower gets B1163 with no set.
  const one = await garden(opusStep('B1163'))
  try {
    const digger = await one.lane('Digger')
    const mower = await one.lane('Mower', { model: OPUS, effort: 'high' })
    const first = await one.decide(digger, NOW, { kind: 'pass' }, [digger, mower])
    assert.equal(first.decision.give, null)
    const second = await one.decide(mower, NOW, { kind: 'pass' }, [digger, mower])
    assert.equal(second.decision.give, 'B1163')
    assert.equal(second.envelope.set, null, 'no set needed')
  } finally {
    await cleanUp(one.dir)
  }
})

test('decision 3: with no closer worker free, the step still goes to the one there is (it never waits for a better one)', () => {
  const free = { name: 'Worker 1', model: SONNET, effort: 'low', isRunning: true, report: { state: 'idle' } }
  const decision = decide({ worker: free, peers: [], items: new Map([['B1163', opusStep('B1163')]]), ready: [{ id: 'B1163', keptFor: null, pinned: null, prefers: null }], now: NOW, event: { kind: 'turn-ended', since: NOW - MIN } })
  assert.equal(decision.give, 'B1163')
})

test('the screenshot of 2026-11-12: Workers on Sonnet · medium are never kept off sonnet steps after a refused set, and the row says it plainly', () => {
  const refusedSonnet = { kind: 'task', step: 'B1161', set: { model: SONNET, effort: 'medium' }, state: 'failed', at: NOW - 3 * MIN, failedAt: NOW - 3 * MIN, outcome: { cleared: null, set: false, typed: false, why: REFUSAL.replace('set_session_effort', 'set_session_model') } }
  const worker = { name: 'Worker 3', model: SONNET, effort: 'medium', isRunning: true, report: { state: 'idle', since: NOW - MIN, at: NOW } }
  const sonnetStep = step('B1161', 'refined')
  const given = decide({ worker, envelopes: [refusedSonnet], items: new Map([['B1161', sonnetStep]]), ready: [{ id: 'B1161', keptFor: null, pinned: null, prefers: null }], now: NOW, event: { kind: 'turn-ended', since: NOW - MIN } })
  assert.equal(given.give, 'B1161', 'no 2-hour exclusion')
  const free = decide({ worker, setsRefused: true, envelopes: [refusedSonnet], items: new Map(), ready: [], now: NOW, event: { kind: 'turn-ended', since: NOW - MIN } })
  assert.equal(free.state, STATES.FREE)
  assert.equal(laneWords(free), 'free · on Sonnet · medium (the app no longer lets the board switch it)')
  assert.doesNotMatch(laneWords(free), /PreToolUse|hook error|gets no/)
})

test('decision 2: a task in flight whose outcome says the set was refused goes again without its set, still queued for its worker', () => {
  const worker = { name: 'Digger', model: SONNET, effort: 'low', isRunning: true, report: { state: 'idle', since: NOW - MIN, at: NOW } }
  const queued = step('B1160', 'queued', { Owner: 'Digger' })
  const envelope = { id: 'e1', kind: 'task', step: 'B1160', clear: { step: 'B1147', reportedAt: NOW - 60 * MIN }, set: { model: OPUS, effort: 'high' }, line: 'work: B1160 is yours; run work next', state: 'delivered', at: NOW - MIN, settledAt: NOW - 30_000, outcome: { cleared: null, set: false, typed: false, why: REFUSAL } }
  const decision = decide({ worker, envelopes: [envelope], items: new Map([['B1160', queued]]), now: NOW })
  assert.equal(decision.takeBack, null)
  assert.deepEqual([decision.state, decision.envelope.step, decision.envelope.set, decision.envelope.asked, decision.envelope.clear.step], [STATES.HANDING, 'B1160', null, { model: OPUS, effort: 'high' }, 'B1147'])
})
