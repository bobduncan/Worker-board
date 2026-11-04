// Fix 0.31.0, part 2 (the double give after a lazy clear, 2026-11-04 21:22): strandedGives never takes back a step whose
// hand-over envelope is in flight, and a lane whose mod is unknown (null) is not read as off the sequence. Only a lane with a
// KNOWN mod older than the hand-over's (0.27.0), or the setting "timers", loses a given task at once; the unknown one keeps it
// for the net's time (NET_MS after the give), then it goes back: nothing waits for ever. The real case is
// test/lazyClearReplay.test.mjs. Made-up chats.

import assert from 'node:assert/strict'
import test from 'node:test'

import { ASK_MS, GRACE_MS, IDLE_HOLD_MS } from '../../src/config.mjs'
import { DEFAULT_FLOW } from '../../src/work/flow.mjs'
import { strandedGives } from '../../src/work/handOut.mjs'
import { HANDOVER_COMMAND, NET_MS, onSequence } from '../../src/work/handover.mjs'
import { parseItem } from '../../src/work/item.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { reconcile } from '../../src/work/reconcile.mjs'

const NOW = new Date(2026, 10, 4, 21, 22).getTime()
const MIN = 60_000
const TIMES = { graceMs: GRACE_MS, askMs: ASK_MS, idleMs: IDLE_HOLD_MS }

const file = (head, sections = {}) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${Object.entries(sections).map(([name, lines]) => `\n## ${name}\n${lines.join('\n')}\n`).join('')}`)
const mapOf = items => new Map(items.map(item => [item.head.get('Id'), item]))
/** A step the board gave to `owner` `ago` ms before NOW (its History says so, as api.mjs `give` writes it). */
const given = (id, owner, ago = 10_000) => file({ Id: id, Kind: 'step', Title: `Step ${id}`, State: 'queued', Owner: owner, Since: stamp(NOW - ago), Refined: 'ready' }, { History: [`- ${stamp(NOW - ago)} server: refined → queued (given by the board to ${owner})`] })
/** A lane as the state builds it: its mod, and whether the setting and the mod put it on the sequence. */
const lane = (name, mod, handover = 'sequence', more = {}) => {
  const base = { name, state: 'free', isMain: false, isLeftover: false, isRunning: true, lastActivityAt: NOW - 30 * MIN, task: null, mod, report: null, ...more }
  return { ...base, onSequence: onSequence(base, { handover }) }
}
/** An envelope of the outbox as handoverBoard.mjs writes it. */
const envelope = (to, step, more = {}) => ({ id: `e-${to}-${step}`, at: NOW - 12_000, to, step, command: HANDOVER_COMMAND, kind: 'task', state: 'taken', takenAt: NOW - 11_000, clear: null, line: `work: ${step} is yours; run work next`, ...more })
const backs = (items, lanes, sent = [], now = NOW) => strandedGives({ items: mapOf(items), lanes, now, waitMs: NET_MS, sent }).map(one => [one.id, one.chat, one.why])

test('an envelope in flight (waiting, or taken with no outcome) keeps the step, also for a lane with a KNOWN mod that is off the sequence', () => {
  const items = [given('B1', 'Old'), given('B2', 'Timers')]
  const lanes = [lane('Old', '0.20.0'), lane('Timers', '0.31.0', 'timers')]
  assert.deepEqual(lanes.map(one => one.onSequence), [false, false])
  // Without an envelope both go back at once (the old rule).
  assert.deepEqual(backs(items, lanes), [['B1', 'Old', 'Old is not on the hand-over'], ['B2', 'Timers', 'Timers is not on the hand-over']])
  for (const state of ['waiting', 'taken']) {
    const sent = [envelope('Old', 'B1', { state }), envelope('Timers', 'B2', { state })]
    assert.deepEqual(backs(items, lanes, sent), [], `an envelope ${state} with no outcome`)
  }
})

test('mutant "strandedGives ignoring the in-flight envelope": one with an outcome, one the net fired for, one for another step or worker, or an old one, holds nothing', () => {
  const items = [given('B1', 'Old')]
  const lanes = [lane('Old', '0.20.0')]
  const gone = [['B1', 'Old', 'Old is not on the hand-over']]
  // An outcome ends the hand-over (delivered, or failed): the old rule.
  assert.deepEqual(backs(items, lanes, [envelope('Old', 'B1', { state: 'delivered', outcome: { cleared: true, typed: true } })]), gone)
  assert.deepEqual(backs(items, lanes, [envelope('Old', 'B1', { state: 'failed', outcome: { cleared: false, typed: false } })]), gone)
  // The net fired for it (netAt): its task is taken back by the decision, the envelope holds nothing.
  assert.deepEqual(backs(items, lanes, [envelope('Old', 'B1', { netAt: NOW - 1000 })]), gone)
  // Another step, another worker, no task (a restart or a lone clear), not a hand-over.
  assert.deepEqual(backs(items, lanes, [envelope('Old', 'B2'), envelope('Other', 'B1'), envelope('Old', null, { kind: 'clear' }), envelope('Old', 'B1', { command: 'work' })]), gone)
  // The same step, the same worker, the prefix of the list ignored (the outbox says "Game - Old").
  assert.deepEqual(strandedGives({ items: mapOf([given('B1', 'Old')]), lanes, now: NOW, waitMs: NET_MS, prefix: 'Game - ', sent: [envelope('Game - Old', 'B1')] }), [])
  // It holds for the net's time only, counted from the give: ten minutes on, the step goes back (nothing waits for ever).
  const old = [given('B1', 'Old', 11 * MIN)]
  assert.deepEqual(backs(old, lanes, [envelope('Old', 'B1', { at: NOW - 11 * MIN })]), gone)
  assert.deepEqual(backs([given('B1', 'Old', 9 * MIN)], lanes, [envelope('Old', 'B1', { at: NOW - 9 * MIN })]), [])
})

test('mutant "null mod read as off": a lane whose mod is unknown keeps the given step for the net\'s time, then it goes back; a known old mod goes at once', () => {
  const unknown = lane('Fresh', null)
  assert.equal(unknown.onSequence, false)
  assert.deepEqual(backs([given('B1', 'Fresh')], [unknown]), [], 'a worker just after its clear: its mod not heard yet')
  assert.deepEqual(backs([given('B1', 'Fresh', 9 * MIN)], [unknown]), [])
  assert.deepEqual(backs([given('B1', 'Fresh', 10 * MIN)], [unknown]), [['B1', 'Fresh', 'Fresh is not on the hand-over']], 'still unknown after the net\'s time')
  // Anything that is no version is unknown too.
  for (const odd of [undefined, '', 'none', 31]) assert.deepEqual(backs([given('B1', 'Fresh')], [lane('Fresh', odd)]), [], String(odd))
  // A known old mod: at once. A known new one on the sequence: never.
  assert.deepEqual(backs([given('B1', 'Old')], [lane('Old', '0.20.0')]), [['B1', 'Old', 'Old is not on the hand-over']])
  assert.deepEqual(backs([given('B1', 'Old', 60 * MIN)], [lane('Old', '0.26.10')]), [['B1', 'Old', 'Old is not on the hand-over']])
  assert.deepEqual(backs([given('B1', 'Seq', 60 * MIN)], [lane('Seq', '0.31.0')]), [])
})

test('the owner gone from the list: back after waitMs, with or without an envelope (the old rule); a board that reads no worker takes nothing back', () => {
  const sent = [envelope('Gone', 'B1', { at: NOW - 12 * MIN })]
  assert.deepEqual(backs([given('B1', 'Gone', 9 * MIN)], [lane('Seq', '0.31.0')], sent), [])
  assert.deepEqual(backs([given('B1', 'Gone', 10 * MIN)], [lane('Seq', '0.31.0')], sent), [['B1', 'Gone', 'Gone is no worker of the list']])
  assert.deepEqual(backs([given('B1', 'Gone', 10 * MIN)], [lane('Seq', '0.31.0')]), [['B1', 'Gone', 'Gone is no worker of the list']])
  assert.deepEqual(backs([given('B1', 'Gone', 60 * MIN)], [], sent), [])
  // A step the board did not give (the person's queue) is left alone, as before.
  const placed = file({ Id: 'B2', Kind: 'step', Title: 'Step B2', State: 'queued', Owner: 'Old', Since: stamp(NOW - 5 * MIN) }, { History: [`- ${stamp(NOW - 5 * MIN)} person: queued for Old`] })
  assert.deepEqual(backs([placed], [lane('Old', '0.20.0')]), [])
})

test('the reconciler passes the outbox on: an envelope in flight keeps a given step off the take-back list, a known old mod without one is on it', () => {
  const run = (items, lanes, sent) => reconcile({ store: { items: mapOf(items), flow: DEFAULT_FLOW, problems: [] }, flow: DEFAULT_FLOW, lanes, now: NOW, times: TIMES, prefix: '', sent, settings: { handOutBeyondFocus: true } })
  const lanes = [lane('Old', '0.20.0'), lane('Fresh', null)]
  assert.deepEqual(run([given('B1', 'Old')], lanes, []).stranded.map(one => one.id), ['B1'])
  assert.deepEqual(run([given('B1', 'Old')], lanes, [envelope('Old', 'B1')]).stranded, [])
  assert.deepEqual(run([given('B2', 'Fresh')], lanes, []).stranded, [])
  assert.deepEqual(run([given('B2', 'Fresh', 11 * MIN)], lanes, []).stranded.map(one => one.id), ['B2'])
})
