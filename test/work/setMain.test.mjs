// B1160 part 2 (F5; chat 1's decisions 4 and 5, B1164, and the overlap signal of 2026-11-13). Since the app's update of 22:43 the
// Workers mod's code may not set a chat's model or effort, so the owed set goes to a model turn of Main: one word no hand claims,
// asked once per hand-over while the worker is free; the line waits for the worker to run at it, or 5 min, then goes without it.
// Rule 8 leaves such a word out for 10 min. A ready step whose Touches overlap one under way waits and says so, and the Supervisor names
// free workers idling behind overlaps for 30 min. The refusal's words and B1149's overlap are the live ones; the garden is made up.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { clearOwed } from '../../src/clearOwed.mjs'
import { isForHandsYet, isHandWord } from '../../src/hands.mjs'
import { memoryStore } from '../../src/store.mjs'
import { MAIN_MODEL_SET_MS, WATCH_RULES, isUndelivered } from '../../src/supervisor/rules/watch.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { workApi } from '../../src/work/api.mjs'
import { readyList } from '../../src/work/handOut.mjs'
import { MAIN_SET_WAIT_MS, handOut, handOver, handoverPass } from '../../src/work/handoverBoard.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 14, 0, 30).getTime()
const SONNET = 'claude-sonnet-5-5'
const OPUS = 'claude-opus-5-5'
const CONFIG = { handover: 'sequence', models: { sonnet: SONNET, opus: OPUS } }
const KEEP = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN, pause: null }
const ROLES = { Lead: 'main', Digger: 'worker', Mower: 'worker' }
const REFUSAL = 'PreToolUse:mcp__ccd_session_mgmt__set_session_effort hook error: Not run: in auto mode Claude Desktop doesn\'t run this tool when a plugin\'s own code calls it. Have Claude make the call.'
/** The refusal as a hand answered it (a hand took the word), the newest answer: the board's set calls are refused. */
const REFUSED_WORD = { id: 'r0', at: NOW - 30 * MIN, to: 'Lead', command: 'worker-effort', about: 'Mower', effort: 'high', state: 'failed', failedAt: NOW - 29 * MIN, why: REFUSAL, takenBy: 'Lead', takenAt: NOW - 30 * MIN, handTakenAt: NOW - 30 * MIN }

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)), problem: null })
const step = (id, state, more = {}, sections = {}) => item({ Id: id, Kind: 'step', Title: `Task ${id}`, State: state, Activity: 'Garden', Since: stamp(NOW - 60 * MIN), ...(state === 'refined' ? { Refined: 'ready' } : {}), ...more }, { History: [`- ${stamp(NOW - 60 * MIN)} Partner: made`], ...sections })
const opusStep = id => step(id, 'refined', {}, { Model: ['opus: core'], Effort: ['high: core'] })

async function garden(...all) {
  const dir = await mkdtemp(join(tmpdir(), 'set-main-'))
  const items = new Map(all.map(one => [one.head.get('Id'), one]))
  await writeStore(dir, { items, activities: [{ name: 'Garden', isFocus: false, steps: [...items.keys()], notes: [], loose: [] }] }, undefined, { now: NOW - 60 * MIN })
  const ctx = at => ({ dir, now: at, prefix: '', roleOf: chat => ROLES[chat] ?? null, chats: Object.keys(ROLES), overlapsOfStore: true })
  const outbox = memoryStore()
  await outbox.say(REFUSED_WORD)
  let n = 0
  const one = {
    dir, outbox,
    apply: at => body => workApi(body, { ...ctx(at), as: 'server' }),
    newId: () => `m${(n += 1)}`,
    lane: async (name = 'Digger', more = {}) => {
      const base = { name, isMain: false, isLeftover: false, isRunning: true, state: 'free', mod: '0.27.0', model: SONNET, effort: 'low', appSession: `local_${name.toLowerCase()}`, report: { state: 'idle', since: NOW - 5 * MIN, background: false, at: NOW }, held: null, ...more }
      return { ...base, clearOwed: clearOwed({ lane: base, items: (await readStore(dir)).items, afterStep: 'clear' }) }
    },
    state: async lanes => ({ chats: lanes, chatPrefix: '', readyList: { ready: readyList((await readStore(dir)).items, { now: NOW, beyondFocus: true }).ready }, limits: {}, gaps: [], restart: { main: 'Lead' } }),
  }
  one.decide = async (lane, at, event = { kind: 'turn-ended', since: NOW - 10 * MIN }) => handOver({ lane, state: await one.state([lane]), dir, outbox, apply: one.apply(at), config: CONFIG, now: at, newId: one.newId, event })
  one.pass = async (lane, at) => handoverPass({ state: await one.state([lane]), dir, outbox, apply: one.apply(at), config: CONFIG, now: at, newId: one.newId })
  return one
}
const cleanUp = dir => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

test('decision 4: while refused the owed set goes to Main\'s model: one word no hand claims, the line waits for it', async () => {
  const one = await garden(opusStep('B1163'))
  try {
    const first = await one.decide(await one.lane(), NOW)
    assert.deepEqual([first.envelope.set, first.envelope.asked], [null, { model: OPUS, effort: 'high' }])
    const word = one.outbox.outbox().find(message => message.id === first.envelope.waitsFor)
    assert.deepEqual([word.command, word.to, word.about, word.model, word.effort, word.forModel], ['worker-effort', 'Lead', 'Digger', OPUS, 'high', true])
    assert.match(word.text, /set it yourself/)
    // No hand claims it, also one that may set; Main's own take gets it at once (no HANDS_FIRST_MS wait).
    assert.equal(isHandWord(word, { canSet: true }), false)
    assert.equal(isForHandsYet(word, NOW), false)
    // The line waits for it.
    assert.equal(await handOut(one.outbox, 'Digger', NOW, KEEP), null)
    // Once per hand-over: a second decision writes nothing more.
    const again = await one.decide(await one.lane(), NOW + MIN, { kind: 'pass' })
    assert.equal(again.envelope, null)
    assert.equal(one.outbox.outbox().filter(message => message.command === 'worker-effort' && message.forModel === true).length, 1)
  } finally { await cleanUp(one.dir) }
})

test('decision 4: once the worker runs at it the line goes in, set by Main; after 5 min without it the line goes in anyway, asked kept', async () => {
  const one = await garden(opusStep('B1163'))
  try {
    const first = await one.decide(await one.lane(), NOW)
    await one.outbox.update(first.envelope.waitsFor, { state: 'delivered', takenAt: NOW + 10_000, deliveredAt: NOW + 12_000 })
    // Typed into Main is not done yet: the line still waits.
    await one.pass(await one.lane(), NOW + MIN)
    assert.equal(await handOut(one.outbox, 'Digger', NOW + MIN, KEEP), null)
    // Main's model set it: the worker runs at Opus · high.
    await one.pass(await one.lane('Digger', { model: OPUS, effort: 'high' }), NOW + 2 * MIN)
    const set = one.outbox.outbox().find(message => message.id === first.envelope.id)
    assert.deepEqual([set.waitsFor, set.setByMain, set.asked], [null, true, null])
    // F5 review 14: its words follow.
    assert.doesNotMatch(set.text, /Asked, not set/)
    assert.equal((await handOut(one.outbox, 'Digger', NOW + 2 * MIN, KEEP)).step, 'B1163')
  } finally { await cleanUp(one.dir) }
  const two = await garden(opusStep('B1163'))
  try {
    const first = await two.decide(await two.lane(), NOW)
    const wordId = first.envelope.waitsFor
    await two.pass(await two.lane(), NOW + MAIN_SET_WAIT_MS - 1000)
    assert.equal(await handOut(two.outbox, 'Digger', NOW + MAIN_SET_WAIT_MS - 1000, KEEP), null, 'not before 5 min')
    await two.pass(await two.lane(), NOW + MAIN_SET_WAIT_MS)
    const went = two.outbox.outbox().find(message => message.id === first.envelope.id)
    assert.deepEqual([went.waitsFor, went.asked], [null, { model: OPUS, effort: 'high' }])
    // F5 review 4: the word Main has not taken is closed with the release: never typed later.
    assert.equal(two.outbox.outbox().find(message => message.id === wordId).state, 'dropped')
    assert.equal((await handOut(two.outbox, 'Digger', NOW + MAIN_SET_WAIT_MS, KEEP)).step, 'B1163')
  } finally { await cleanUp(two.dir) }
})

test('B1164: rule 8 leaves a set word with Main\'s model out for 10 min, then names it while the worker still does not run at it', () => {
  const lanes = [{ name: 'Lead', isMain: true, isLeftover: false, state: 'working', isRunning: true }, { name: 'Digger', isMain: false, isLeftover: false, state: 'free', isRunning: true, model: SONNET, effort: 'low' }]
  const word = { id: 'w1', at: NOW, to: 'Lead', command: 'worker-effort', about: 'Digger', model: OPUS, effort: 'high', forModel: true, forStep: 'B1163', state: 'delivered', takenAt: NOW + 5000, deliveredAt: NOW + 6000, text: 'set model and effort' }
  const viewAt = (at, chats = lanes) => buildView({ state: { chats, today: [], limits: {}, pause: null, chatPrefix: '', restart: { main: 'Lead' } }, items: new Map([['B1163', step('B1163', 'in progress', { Owner: 'Digger' })]]), outbox: [word], settings: {}, now: at })
  assert.equal(isUndelivered(viewAt(NOW + 5 * MIN), word), false)
  assert.equal(isUndelivered(viewAt(NOW + MAIN_MODEL_SET_MS + MIN), word), true)
  const set = lanes.map(lane => (lane.name === 'Digger' ? { ...lane, model: OPUS, effort: 'high' } : lane))
  assert.equal(isUndelivered(viewAt(NOW + MAIN_MODEL_SET_MS + MIN, set), word), false, 'done by Main: not counted')
})

test('the G95 case: a ready step whose Touches overlap B1149 under way waits and says so; it is not ready for a worker', () => {
  const touches = paths => ({ Touches: paths })
  const items = new Map([
    ['B1149', step('B1149', 'in progress', { Owner: 'Worker 3' }, { Context: ['  Touches: art/source, public/units'] })],
    ['B1150', step('B1150', 'refined', {}, { Context: ['  Touches: public/units/knight'] })],
    ['B1151', step('B1151', 'refined', {}, { Context: ['  Touches: src/ui'] })],
  ])
  void touches
  const list = readyList(items, { now: NOW, beyondFocus: true })
  assert.deepEqual(list.ready.map(one => one.id), ['B1151'])
  assert.deepEqual(list.held.find(one => one.id === 'B1150'), { id: 'B1150', why: 'waits: same files as B1149, under way', overlap: 'B1149' })
})

test('the Supervisor names free workers idling 30 min while every waiting step shares its files with one under way, once for the board', () => {
  const lanes = [{ name: 'Lead', isMain: true, isLeftover: false, state: 'free', isRunning: true }, ...['Worker 1', 'Worker 2'].map(name => ({ name, isMain: false, isLeftover: false, state: 'free', isRunning: true, onSequence: true, handover: { state: 'free', why: null } }))]
  const held = [{ id: 'B1150', why: 'waits: same files as B1149, under way', overlap: 'B1149' }, { id: 'B1152', why: 'waits: same files as B1149, under way', overlap: 'B1149' }]
  const view = buildView({ state: { chats: lanes, today: [], limits: {}, pause: null, chatPrefix: '', readyList: { ready: [], held } }, items: new Map(), outbox: [], settings: {}, now: NOW })
  const rule = WATCH_RULES.find(one => one.id === 'overlap-idle')
  assert.deepEqual(rule.check(view, { seen: new Map([['overlap-idle board', NOW - 20 * MIN]]), observed: [] }), [], 'not before 30 min')
  const found = rule.check(view, { seen: new Map([['overlap-idle board', NOW - 31 * MIN]]), observed: [] })
  assert.equal(found.length, 1)
  assert.equal(found[0].key, 'overlap-idle board')
  assert.match(found[0].text, /^workers free behind Touches overlaps for 31 min \(Worker 1, Worker 2\): every waiting step shares its files with a step given or at work: B1150 \(same files as B1149\), B1152/)
  // A step ready for a worker: no finding (ready-while-free is that rule's).
  const withReady = buildView({ state: { chats: lanes, today: [], limits: {}, pause: null, chatPrefix: '', readyList: { ready: [{ id: 'B1151' }], held } }, items: new Map(), outbox: [], settings: {}, now: NOW })
  assert.deepEqual(rule.check(withReady, { seen: new Map([['overlap-idle board', NOW - 31 * MIN]]), observed: [] }), [])
})

test('verifier 2, 7: the set word for Main and its hand-over are written in one go', async () => {
  const one = await garden(opusStep('B1163'))
  try {
    const batches = []
    const sayAll = one.outbox.sayAll.bind(one.outbox)
    one.outbox.sayAll = async added => { batches.push(added.map(message => message.id)); return sayAll(added) }
    const first = await one.decide(await one.lane(), NOW)
    assert.deepEqual(batches, [[first.envelope.waitsFor, first.envelope.id]])
  } finally { await cleanUp(one.dir) }
})
