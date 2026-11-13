// B1160 part 1, chat 1's review of c078ea89 (.claude/plans/2026-11-13-handover-set-refused-review.md): a peer wins a step only when it
// could be given it (1-3), family before effort (12), the in-flight resend once (13), the refusal stands until a set is seen to work
// (15, 16), a refused word never retried (5, 7, 10), closed plainly by the sweep (6), quiet for effort-mismatch (8), a step's known gap
// after the refusal (4), the run chip (9) and the free row's plain words (17). The refusal's words are the live ones; names made up.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { statusOf } from '../../src/chatStatus.mjs'
import { memoryStore } from '../../src/store.mjs'
import { switchOf } from '../../src/supervisor/rules/watch.mjs'
import { effortPlan, setsRefusedOf } from '../../src/work/effort.mjs'
import { match } from '../../src/work/handOut.mjs'
import { decide, refusedWords } from '../../src/work/handover.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { whyClosed } from '../../src/work/outboxSweep.mjs'
import { passesBySelf } from '../../src/work/passing.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 13, 10, 0).getTime()
const SONNET = 'claude-sonnet-5-5'
const OPUS = 'claude-opus-5-5'
const MODELS = { sonnet: SONNET, opus: OPUS }
const KEEP = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN, pause: null }
const REFUSAL = 'PreToolUse:mcp__ccd_session_mgmt__set_session_effort hook error: Not run: in auto mode Claude Desktop doesn\'t run this tool when a plugin\'s own code calls it. Have Claude make the call.'
const PLAIN = 'the app refuses the board\'s set calls; it runs on its current model'

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)), problem: null })
const step = (id, state, more = {}, sections = {}) => item({ Id: id, Kind: 'step', Title: `Task ${id}`, State: state, Activity: 'Garden', Since: stamp(NOW - 60 * MIN), ...(state === 'refined' ? { Refined: 'ready' } : {}), ...more }, { History: [`- ${stamp(NOW - 60 * MIN)} Partner: made`], ...sections })
const opusStep = (id, history = null) => step(id, 'refined', {}, { Model: ['opus: core'], Effort: ['high: core'], ...(history === null ? {} : { History: history }) })
const READY = [{ id: 'B1163', keptFor: null, pinned: null, prefers: null }]
const idle = { state: 'idle', since: NOW - MIN, at: NOW }

test('review 1-3 (blocker): a step taken back or given back from the closest peer goes to the deciding worker', () => {
  const digger = { name: 'Digger', model: SONNET, effort: 'low', isRunning: true, report: idle }
  const mower = { name: 'Mower', model: OPUS, effort: 'high', isRunning: true, report: idle, envelopes: [] }
  for (const back of [`- ${stamp(NOW - 5 * MIN)} server: queued → refined (taken back from Mower: did not take it in its turn)`,
    `- ${stamp(NOW - 5 * MIN)} server: in progress → refined (given back by the board: Mower did not resume it)`]) {
    const items = new Map([['B1163', opusStep('B1163', [back])]])
    assert.equal(decide({ worker: digger, peers: [mower], items, ready: READY, now: NOW, event: { kind: 'turn-ended', since: NOW - MIN } }).give, 'B1163', back)
  }
  // A peer whose own ban bars the step's model is no closer worker either.
  const banned = { ...mower, model: SONNET, effort: 'high', setFor: () => ({ model: OPUS, effort: 'high' }),
    envelopes: [{ kind: 'task', step: 'B1', set: { model: OPUS, effort: 'high' }, state: 'failed', at: NOW - 5 * MIN, failedAt: NOW - 5 * MIN, outcome: { set: false, why: 'the app refused the model' } }] }
  const items = new Map([['B1163', opusStep('B1163')]])
  assert.equal(decide({ worker: { ...digger, effort: 'medium' }, peers: [banned], items, ready: READY, now: NOW, event: { kind: 'turn-ended', since: NOW - MIN } }).give, 'B1163')
  // A free peer that may take it and is closer still wins it.
  assert.equal(decide({ worker: digger, peers: [mower], items, ready: READY, now: NOW, event: { kind: 'turn-ended', since: NOW - MIN } }).give, null)
})

test('review 12: the model family weighs more than the effort: Opus · medium beats Sonnet · high for an opus-high step', () => {
  const items = new Map([['B1163', opusStep('B1163')]])
  assert.equal(match({ ready: READY, idle: [{ name: 'Worker 1', model: SONNET, effort: 'high', isRunning: true }, { name: 'Worker 2', model: OPUS, effort: 'medium', isRunning: true }], items })[0].chat, 'Worker 2')
})

test('review 13: the refused task in flight is sent again once: with its resend waiting, the next decision writes nothing', () => {
  const worker = { name: 'Digger', model: SONNET, effort: 'low', isRunning: true, report: idle }
  const queued = step('B1160', 'queued', { Owner: 'Digger' })
  const refused = { id: 'e1', kind: 'task', step: 'B1160', clear: null, set: { model: OPUS, effort: 'high' }, line: 'work: B1160 is yours; run work next', state: 'delivered', at: NOW - MIN, settledAt: NOW - 50_000, outcome: { cleared: null, set: false, typed: false, why: REFUSAL } }
  const resend = { id: 'e2', kind: 'task', step: 'B1160', clear: null, set: null, asked: { model: OPUS, effort: 'high' }, line: 'work: B1160 is yours; run work next', state: 'waiting', at: NOW - 40_000 }
  const decision = decide({ worker, envelopes: [refused, resend], items: new Map([['B1160', queued]]), now: NOW })
  assert.deepEqual([decision.envelope, decision.takeBack], [null, null])
})

test('review 15, 16: the refusal stands until a set word is delivered; words that never reached the app say nothing', () => {
  const refusedWord = { id: 'a', command: 'worker-effort', at: NOW, state: 'failed', failedAt: NOW + 5000, why: REFUSAL, retriedAs: 'c' }
  assert.equal(setsRefusedOf([refusedWord, { id: 'c', command: 'worker-effort', at: NOW + 70_000, state: 'expired', retryOf: 'a' }], NOW + 20 * MIN), true)
  assert.equal(setsRefusedOf([refusedWord, { id: 'd', command: 'worker-effort', at: NOW, state: 'dropped', why: 'superseded' }], NOW + 20 * MIN), true)
  assert.equal(setsRefusedOf([refusedWord], NOW + 24 * 60 * MIN), true, 'no timer')
  assert.equal(setsRefusedOf([refusedWord, { id: 'e', command: 'worker-effort', at: NOW + 30 * MIN, state: 'delivered', deliveredAt: NOW + 31 * MIN }], NOW + 40 * MIN), false, 'a set seen to work ends it')
  assert.equal(setsRefusedOf([{ id: 'f', command: 'worker-effort', at: NOW, state: 'dropped', refused: true, why: PLAIN, failedAt: NOW }], NOW + MIN), true, 'the sweep\'s close keeps it')
})

test('review 5, 7, 10: a refused set word is never retried', async () => {
  assert.equal(passesBySelf(REFUSAL), false)
  const outbox = memoryStore()
  await outbox.say({ id: 'w1', at: NOW, to: 'Lead', command: 'worker-effort', about: 'Digger', effort: 'high', state: 'waiting' })
  await outbox.update('w1', { state: 'failed', failedAt: NOW + 1000, why: REFUSAL })
  await outbox.retryFailed(NOW + 2 * MIN, KEEP)
  assert.equal(outbox.outbox().filter(one => one.command === 'worker-effort').length, 1)
})

test('review 6: the sweep closes a refused set word as dropped in plain words, marked refused', () => {
  const word = { id: 'w1', at: NOW - 20 * MIN, to: 'Lead', command: 'worker-effort', about: 'Digger', effort: 'high', model: OPUS, state: 'failed', failedAt: NOW - 19 * MIN, why: REFUSAL }
  assert.deepEqual(whyClosed(word, { all: [word], items: new Map(), now: NOW, keep: KEEP, lanes: [{ name: 'Digger', model: SONNET, effort: 'low' }] }), { state: 'dropped', refused: true, why: PLAIN })
})

test('review 8: a run the refusal left unset is known and quiet: not late for effort-mismatch', () => {
  const b1163 = step('B1163', 'in progress', { Owner: 'Worker 1' }, { Model: ['opus: core'], Effort: ['high: core'], History: [`- ${stamp(NOW - 11 * MIN)} Worker 1: queued → taken`] })
  const lane = { name: 'Worker 1', model: SONNET, effort: 'low', effortRun: { step: 'B1163', model: 'opus', level: 'high', isSet: false, asked: null, refused: true } }
  const found = switchOf(lane, b1163, { now: NOW, settings: { switchMinutes: 10 }, gaps: [], pause: null, limits: {} })
  assert.deepEqual([found.mismatch, found.state, found.late], [true, 'refused', false])
})

test('review 4: a step that went without its set keeps its quiet gap after the refusal ends: no Opus wait, no word', () => {
  const items = new Map([['B1163', step('B1163', 'queued', { Owner: 'Digger' }, { Model: ['opus: core'], Effort: ['high: core'] })]])
  const lanes = [{ name: 'Digger', model: SONNET, effort: 'low', appSession: 'local_digger' }]
  const sent = [{ id: 'e1', command: 'handover', to: 'Digger', step: 'B1163', set: null, asked: { model: OPUS, effort: 'high' }, state: 'waiting', at: NOW - 3 * 60 * MIN },
    { id: 'w9', command: 'worker-effort', about: 'Mower', state: 'delivered', at: NOW - MIN, deliveredAt: NOW - MIN }]
  const plan = effortPlan({ items, lanes, sent, now: NOW, main: 'Lead', models: MODELS })
  assert.deepEqual([plan.runs.get('Digger').refused, plan.runs.get('Digger').waitsFor, plan.words], [true, null, []])
})

test('review 9: the run chip draws the asked setting quietly: no arrow, no pending border', async () => {
  const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'board.js'), 'utf8')
  const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
  const page = {}
  vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('chatstatus')}\n${cut('runchip')}\nObject.assign(this, { runChipOf })`, page)
  const chip = page.runChipOf({ name: 'Worker 1', model: SONNET, effort: 'low', effortRun: { step: 'B1163', model: 'opus', level: 'high', isSet: false, asked: null, refused: true } })
  assert.equal(chip.next, null, 'no switch drawn')
  assert.match(chip.asked, /Opus · High/i)
  assert.match(chip.text, /\(Opus · High asked\)/i)
  assert.doesNotMatch(chip.text, /→/)
  assert.match(script, /if \(\(view\.asked \?\? null\) !== null\) chip\.append\(el\('span', 'run-asked'/)
})

test('review 17: the free row\'s plain words reach the status the page reads', () => {
  const status = statusOf({ lane: { name: 'Worker 3', state: 'free', isRunning: true, report: idle }, handover: { state: 'free', why: refusedWords({ model: SONNET, effort: 'medium' }) }, now: NOW })
  assert.equal(status.why, 'on Sonnet · medium (the app no longer lets the board switch it)')
})
