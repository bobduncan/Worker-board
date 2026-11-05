// B1051 (X153): a worker whose set once "failed" got no step of that model for ever. The real case: Worker 4's envelope
// 588ffb49e818579d (2026-11-02 21:17) waited on a set word that the sweep dropped as "runs at sonnet · medium already" (a
// success); the pass read the drop as a failure, the ban never lifted, and all four incidents of 2026-11-04 were Sonnet steps
// (B1050 the last). Worker 3's ban (B984, "Session ... not found") was a real failure that a delivered B977 should lift.
// Envelopes trimmed from the live outbox (text left out); no live data is read here.

import assert from 'node:assert/strict'
import test from 'node:test'

import { HANDOVER_COMMAND, HANDOVER_MOD, STATES, decide, laneWords } from '../../src/work/handover.mjs'
import { carryable, handoverPass, setterFor } from '../../src/work/handoverBoard.mjs'
import { parseItem } from '../../src/work/item.mjs'
import { whyClosed } from '../../src/work/outboxSweep.mjs'

const MIN = 60_000
const T = (day, h, m, s = 0) => new Date(2026, 10, day, h, m, s).getTime()
const NOW = T(4, 23, 31)
const SONNET = { model: 'claude-sonnet-5-5', effort: 'medium' }
const SOON = T(2, 21, 50)
const CONFIG = { models: { sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' }, usualModel: 'sonnet', usualEffort: 'medium' }

const itemOf = (head, sections = {}) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${Object.entries(sections).map(([name, lines]) => `\n## ${name}\n${lines.join('\n')}\n`).join('')}`)
const items = new Map([
  ['B1050', itemOf({ Id: 'B1050', Kind: 'step', Title: 'Quality Assurance: B1021', State: 'refined', Since: '2026-11-04 23:15', Checks: 'B1021', 'Not by': 'Worker 2, Worker 1', Refined: 'ready' }, { Model: ['sonnet · a check of routine work'], Effort: ['medium · a check of routine work'] })],
  ['B1021', itemOf({ Id: 'B1021', Kind: 'step', Title: 'Built', State: 'review', Owner: 'Worker 2', Since: '2026-11-04 20:00' })],
])
const ready = [{ id: 'B1050', rank: -1, keptFor: null, keptUntil: null, pinned: null, prefers: null, notBy: ['Worker 2', 'Worker 1'] }]
const lane = (name, more = {}) => ({ name, mod: HANDOVER_MOD, model: 'claude-opus-5-5', effort: 'high', report: { state: 'idle', since: NOW - 20 * MIN, at: NOW - MIN }, isRunning: true, asleep: false, isMain: false, isLeftover: false, state: 'free', ...more })
const laneAt = (name, at) => lane(name, { report: { state: 'idle', since: at - 20 * MIN, at: at - MIN } })
const decideFor = (worker, envelopes, now = NOW) => decide({ worker, items, ready, envelopes, setFor: setterFor(worker, items, CONFIG), now, installed: HANDOVER_MOD })

// Worker 4, as the live outbox holds it (the first envelope is closed "no longer given" later by the sweep, its outcome stays).
const failedByDrop = { id: '588ffb49e818579d', at: T(2, 21, 17, 4), to: 'Worker 4', command: HANDOVER_COMMAND, state: 'dropped', kind: 'task', step: 'B935', clear: { step: 'B933', reportedAt: T(2, 21, 16) }, restart: false, set: SONNET, line: 'work: B935 is yours; run work next', waitsFor: '6dd87b0bb28c1818', failedAt: T(2, 21, 20, 26), settledAt: T(2, 21, 20, 26), outcome: { cleared: null, set: false, typed: false, restarted: null, background: false, why: 'Worker 4 runs at sonnet · medium already' } }
const delivered = (id, at, step, set) => ({ id, at, to: 'Worker 4', command: HANDOVER_COMMAND, state: 'delivered', kind: 'task', step, clear: null, restart: false, set, line: `work: ${step} is yours; run work next`, deliveredAt: at + 10_000, settledAt: at + 10_000, outcome: { cleared: null, set: null, typed: true, restarted: null, background: false, why: null } })
const worker4 = [
  failedByDrop,
  delivered('c9cbf90157d69f4c', T(2, 21, 21, 33), 'B938', { model: 'claude-opus-5-5', effort: 'high' }),
  delivered('118c1c1115277bdd', T(4, 21, 40, 19), 'B1024', { model: null, effort: 'high' }),
  delivered('3c2442ac78060145', T(4, 22, 21, 31), 'B1040', null),
  delivered('def7062776f85d6c', T(4, 22, 42, 8), 'B1044', null),
]

test('real case, Worker 4: a delivered envelope after the dropped set lifts the ban, so B1050 (Sonnet) is handed with its set', () => {
  const found = decideFor(lane('Worker 4'), worker4)
  assert.equal(found.state, STATES.HANDING)
  assert.equal(found.give, 'B1050')
  assert.deepEqual(found.envelope.set, SONNET)
  // 11-02 21:25, 4 min after the failure: only the delivered B938 explains it (the age-out is 2 h away).
  const early = T(2, 21, 25)
  assert.equal(decideFor(laneAt('Worker 4', early), worker4.slice(0, 2), early).give, 'B1050')
  assert.equal(decideFor(laneAt('Worker 4', early), worker4.slice(0, 1), early).give, null)
})

test('real case, Worker 3: a real failed set (session not found) is lifted by the delivered B977 after it, so a Sonnet step is offered', () => {
  const failed = { id: '86df460b912ad540', at: T(4, 11, 30, 58), to: 'Worker 3', command: HANDOVER_COMMAND, state: 'dropped', kind: 'task', step: 'B984', clear: null, restart: false, set: SONNET, line: 'work: B984 is yours; run work next', waitsFor: 'c88c7324646d6bdc', failedAt: T(4, 11, 31, 8), settledAt: T(4, 11, 31, 8), outcome: { cleared: null, set: false, typed: false, restarted: null, background: false, why: 'Session local_82c0c4cd-20cd-4a13-bedd-cbea9d32285f not found.' } }
  const b977 = { ...delivered('1f3c1e81fbc4c1c9', T(4, 11, 31, 27), 'B977', null), to: 'Worker 3' }
  assert.equal(decideFor(lane('Worker 3'), [failed, b977]).give, 'B1050')
  // 11:45, 14 min after the failure: only the delivered B977 explains it.
  const early = T(4, 11, 45)
  assert.equal(decideFor(laneAt('Worker 3', early), [failed, b977], early).give, 'B1050')
  assert.equal(decideFor(laneAt('Worker 3', early), [failed], early).give, null)
})

test('guard: a real failed set with nothing delivered after it stays banned (no Sonnet step); after a delivery it is tried once, and a second failure bans again', () => {
  const failed = { ...failedByDrop, outcome: { ...failedByDrop.outcome, why: 'no main chat whose hands could set it' } }
  const found = decideFor(lane('Worker 4'), [failed], SOON)
  assert.equal(found.state, STATES.FREE)
  assert.equal(found.give, null)
  assert.equal(decideFor(lane('Worker 4'), [failed, delivered('d1', T(2, 21, 30), 'B938', null)], SOON).give, 'B1050')
  const again = [failed, delivered('d1', T(2, 21, 30), 'B938', null), { ...failedByDrop, id: 'f2', at: T(2, 21, 40), failedAt: T(2, 21, 41), outcome: { ...failedByDrop.outcome, why: 'the app refused' } }]
  assert.equal(decideFor(lane('Worker 4'), again, SOON).give, null)
})

test('visibility: a banned lane\'s why names the model, the time and the reason; the state\'s own reading (no ready list) shows it too', () => {
  const failed = { ...failedByDrop, outcome: { ...failedByDrop.outcome, why: 'Session x not found.' } }
  const found = decideFor(lane('Worker 4'), [failed], SOON)
  assert.equal(found.why, 'free; gets no sonnet steps: its set failed at 21:20 (Session x not found.) until 23:20')
  assert.equal(laneWords(found), found.why)
  const worker = lane('Worker 4')
  const noReady = decide({ worker, items, ready: [], envelopes: [failed], setFor: setterFor(worker, items, CONFIG), now: SOON, installed: HANDOVER_MOD })
  assert.equal(noReady.state, STATES.FREE)
  assert.match(noReady.why, /gets no sonnet steps/)
  // Not banned: no words, and a free lane without a ban says nothing (the ready-while-free rule keeps its key and count).
  assert.deepEqual([decideFor(worker, []).give, laneWords({ state: STATES.FREE, why: null })], ['B1050', null])
})

test('age-out: a real failure, only Sonnet steps ready, nothing delivered: banned at 1 h 59, the step offered at 2 h 01, banned again by a new failure', () => {
  const failed = { ...failedByDrop, outcome: { ...failedByDrop.outcome, why: 'Session x not found.' } }
  const at = failedByDrop.failedAt
  assert.equal(decideFor(lane('Worker 4'), [failed], at + 119 * MIN).give, null)
  assert.equal(decideFor(lane('Worker 4'), [failed], at + 121 * MIN).give, 'B1050')
  const again = { ...failed, id: 'f3', at: at + 121 * MIN, failedAt: at + 122 * MIN, settledAt: at + 122 * MIN }
  assert.equal(decideFor(lane('Worker 4'), [failed, again], at + 150 * MIN).give, null)
})

const outboxOf = sent => {
  const messages = sent.map(one => ({ ...one }))
  return {
    outbox: () => messages,
    update: async (id, fields) => { Object.assign(messages.find(one => one.id === id), fields); return true },
    say: async message => { messages.push(message) },
  }
}
const pending = (why, met) => [
  { ...failedByDrop, state: 'waiting', outcome: undefined, failedAt: undefined, settledAt: undefined },
  { id: '6dd87b0bb28c1818', at: T(2, 21, 17, 4), to: 'Main', command: 'worker-effort', about: 'Worker 4', state: 'dropped', why, ...(met ? { met: true } : {}) },
]
const passOver = async sent => {
  const outbox = outboxOf(sent)
  const state = { chats: [lane('Worker 4', { state: 'working' })], chatPrefix: '', readyList: { ready: [] }, limits: {}, gaps: [], restart: { main: 'Main' } }
  await handoverPass({ state, dir: '/none', outbox, apply: async () => ({}), config: { handover: 'sequence' }, now: NOW, newId: () => 'n1', fs: undefined, log: () => {} }).catch(() => null)
  return outbox.outbox().find(one => one.id === '588ffb49e818579d')
}

test('pass: a set word dropped as "runs at ... already" is met: its envelope stays carryable and is not failed; one dropped as superseded still fails', async () => {
  assert.equal(carryable(pending('Worker 4 runs at sonnet · medium already', true), 'Worker 4', NOW, 60 * MIN)?.id, '588ffb49e818579d')
  assert.equal(carryable(pending('superseded by a newer word', false), 'Worker 4', NOW, 60 * MIN), null)
  assert.equal((await passOver(pending('Worker 4 runs at sonnet · medium already', true))).state, 'waiting')
  const lost = await passOver(pending('superseded by a newer word for Worker 4\'s setting', false))
  assert.equal(lost.state, 'failed')
  assert.equal(lost.outcome.set, false)
})

test('sweep: a word whose chat runs at the setting already is dropped with met; a superseded one is not met', () => {
  const word = { id: 'w1', at: T(4, 10, 0), to: 'Main', command: 'worker-effort', about: 'Worker 4', effort: 'medium', model: 'claude-sonnet-5-5', state: 'waiting' }
  const ctx = (lanes, all) => ({ all, items: new Map(), now: T(4, 10, 1), keep: 60 * MIN, prefix: '', lanes, ready: [], onBoard: new Set() })
  const met = whyClosed(word, ctx([lane('Worker 4', { model: 'claude-sonnet-5-5', effort: 'medium' })], [word]))
  assert.deepEqual([met.state, met.met], ['dropped', true])
  const newer = { ...word, id: 'w2', at: T(4, 10, 0, 30) }
  const superseded = whyClosed(word, ctx([lane('Worker 4')], [word, newer]))
  assert.equal(superseded.state, 'dropped')
  assert.notEqual(superseded.met, true)
})

test('the met mark is stored: a sweep over a file store keeps `met` on the closed word (also read back from the file), and the envelope is carryable', async () => {
  const { mkdtemp, rm, readFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { fileStore, foldOutbox } = await import('../../src/store.mjs')
  const { sweepOutbox } = await import('../../src/work/outboxSweep.mjs')
  const EARLY = T(2, 21, 18)
  const dir = await mkdtemp(join(tmpdir(), 'model-ban-'))
  try {
    const outbox = await fileStore(dir, EARLY)
    const [envelope, word] = pending('x', false)
    const set = { id: word.id, at: word.at, to: 'Main', command: 'worker-effort', about: 'Worker 4', effort: 'medium', model: 'claude-sonnet-5-5', state: 'waiting', envelope: envelope.id, text: 'set' }
    await outbox.say(set)
    await outbox.say({ ...envelope, text: 'hand-over' })
    const state = { chats: [lane('Worker 4', { model: 'claude-sonnet-5-5', effort: 'medium' })], chatPrefix: '' }
    await sweepOutbox({ dir: null, outbox, state, now: EARLY, keep: { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN } })
    assert.equal(outbox.outbox().find(one => one.id === set.id).met, true)
    const back = foldOutbox(await readFile(join(dir, 'outbox.jsonl'), 'utf8')).find(one => one.id === set.id)
    assert.deepEqual([back.state, back.met], ['dropped', true])
    assert.equal(carryable(foldOutbox(await readFile(join(dir, 'outbox.jsonl'), 'utf8')), 'Worker 4', EARLY, 60 * MIN)?.id, envelope.id)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
