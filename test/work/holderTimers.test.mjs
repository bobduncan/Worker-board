// Signals change 3 (the build brief .claude/plans/2026-11-01-change-3-build-brief.md, the lead's brief and the Addendum of
// its code check): a worker that holds a task and stopped gets one "go on" line after 5 minutes of the board's running
// time, and 15 minutes after that line, with no progress, the decision says give-back (the seam: the store's move waits
// for the person's yes on flow.json, so the board changes nothing yet). The real cases first, on the pure decision; then
// the board, the outbox sweep, the opener, the old senders, the API's refusals, the continuation, the page. Made-up names
// and times only.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

import { statusOf } from '../../src/chatStatus.mjs'
import { parseConfig } from '../../src/config.mjs'
import { wakeNeeds } from '../../src/wake.mjs'
import { resumesDue } from '../../src/say.mjs'
import { memoryStore } from '../../src/store.mjs'
import { findStuck } from '../../src/supervisor/rules/repair.mjs'
import { workApi } from '../../src/work/api.mjs'
import { forgetTold } from '../../src/work/giveBack.mjs'
import { clearOwed } from '../../src/clearOwed.mjs'
import { healthSummary } from '../../src/supervisor/health.mjs'
import { applySync } from '../../src/supervisor/loop.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { DEFAULT_FLOW, GIVE_BACK_GUARD } from '../../src/work/flow.mjs'
import { readyList } from '../../src/work/handOut.mjs'
import { reconcile } from '../../src/work/reconcile.mjs'
import { HANDOVER_COMMAND, HANDOVER_MOD, STATES, contractOf, decide, lineFor, notOfferedAgain } from '../../src/work/handover.mjs'
import { carryable, handOver } from '../../src/work/handoverBoard.mjs'
import {
  GIVEN_BACK, RESUME_KIND, continuationLine, goneWords, continuationOf, giveBackWords, givenBackFrom, givenBackRefusal, goOnLine, goOnWords, hourMinute, resumeMarker,
} from '../../src/work/holderTimers.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { whyClosed } from '../../src/work/outboxSweep.mjs'
import { checkpointLine } from '../../src/work/pause.mjs'
import { planOf, planText } from '../../src/work/stepPlan.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
/** The spell's start: Worker 1 went idle on B12 at 10:00. */
const T0 = new Date(2026, 10, 1, 10, 0).getTime()
const at = minutes => T0 + minutes * MIN

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)), problem: null })
/** B12 in progress for Worker 1 since 09:30, on b12-gate, its checkpoint at 09:50 (before the spell). */
const held = (more = {}, history = [`- ${stamp(at(-30))} Worker 1: queued → taken`, `- ${stamp(at(-30))} Worker 1: taken → in progress`]) => item({
  Id: 'B12', Kind: 'step', Title: 'Hang the gate', State: 'in progress', Owner: 'Worker 1', Since: stamp(at(-30)), Branch: 'b12-gate',
  Checkpoint: checkpointLine({ commit: 'abc1234', next: 'write the tests', now: at(-10) }), ...more,
}, { History: history })
const mapOf = (...all) => new Map(all.map(one => [valueOf(one, 'Id'), one]))
/** Worker 1's lane: Stopped (idle since 10:00 with its step), heard now. */
const stopped = (now, more = {}) => ({
  name: 'Worker 1', isMain: false, isLeftover: false, isRunning: true, state: 'interrupted', mod: HANDOVER_MOD, onSequence: true,
  report: { state: 'idle', since: T0, background: false, at: now }, ...more,
})
const LINE = 'go on with B12 from your checkpoint: branch b12-gate, commit abc1234, next: write the tests'
/** One decision at minute `minutes`. */
const decideAt = (minutes, { items = mapOf(held()), envelopes = [], worker = stopped(at(minutes)), ...more } = {}) => decide({ worker, items, envelopes, now: at(minutes), ...more })
/** The resume envelope as the board writes it (handoverBoard.mjs): the decision's envelope with id, time, state. */
const written = (decision, id, when, more = {}) => ({ id, at: when, to: 'Worker 1', command: HANDOVER_COMMAND, state: 'waiting', ...decision.envelope, ...more })

// ---- The real cases, on the pure decision.

test('a holder idle for 4 min: nothing; at 5 min one "go on" line, built from its checkpoint and branch, as a back-like envelope', () => {
  const early = decideAt(4)
  assert.deepEqual([early.state, early.step, early.envelope, early.asked, early.giveBack, early.goOn], [STATES.WORKING, 'B12', null, null, null, null])
  const due = decideAt(5)
  assert.equal(due.state, STATES.WORKING)
  assert.deepEqual(due.envelope, { kind: RESUME_KIND, step: null, clear: null, restart: false, set: null, line: LINE, back: null, resume: resumeMarker('B12', T0) })
  assert.deepEqual(due.goOn, { step: 'B12', chat: 'Worker 1', since: T0 })
  assert.equal(due.envelope.line, goOnLine(held()))
})

test('the "go on" line goes once per stopped spell: not again at 6, 10 or 19 min (mutant: the line every minute)', () => {
  const sent = written(decideAt(5), 'e1', at(5))
  for (const minutes of [6, 10, 19]) {
    const later = decideAt(minutes, { envelopes: [sent] })
    assert.equal(later.envelope, null, `minute ${minutes}`)
    assert.equal(later.asked, at(5), 'the lane says when it was asked')
    assert.equal(later.giveBack, null)
  }
  // A failed or taken line is still this spell's line: no second one.
  assert.equal(decideAt(8, { envelopes: [{ ...sent, state: 'failed', outcome: { typed: false } }] }).envelope, null)
  assert.equal(decideAt(8, { envelopes: [{ ...sent, state: 'taken' }] }).envelope, null)
})

test('idle through minute 20: the decision says give-back (15 min after the line was written, not delivered) and closes the waiting line', () => {
  const sent = written(decideAt(5), 'e1', at(5))
  assert.equal(decideAt(19.9, { envelopes: [sent] }).giveBack, null)
  const due = decideAt(20, { envelopes: [sent] })
  assert.equal(due.state, STATES.WORKING, 'until the store moves the step, it is still the worker\'s')
  assert.deepEqual(due.giveBack, { step: 'B12', chat: 'Worker 1', askedAt: at(5) })
  assert.equal(due.close, 'e1')
  assert.equal(due.envelope, null)
  // A line the mod took (or that failed) is not closed: nothing waits; the give-back is due all the same.
  const taken = decideAt(20, { envelopes: [{ ...sent, state: 'taken' }] })
  assert.deepEqual([taken.giveBack?.step, taken.close], ['B12', null])
})

test('a checkpoint at minute 10 resets both timers: no give-back at 20, a new spell whose line is due at 15', () => {
  const sent = written(decideAt(5), 'e1', at(5))
  const items = mapOf(held({ Checkpoint: checkpointLine({ commit: 'def5678', next: 'paint it', now: at(10) }) }))
  const twenty = decideAt(20, { items, envelopes: [sent] })
  assert.deepEqual([twenty.giveBack, twenty.asked, twenty.close], [null, null, null])
  assert.equal(decideAt(14, { items, envelopes: [sent] }).envelope, null)
  const again = decideAt(15, { items, envelopes: [sent] })
  assert.equal(again.envelope.resume, resumeMarker('B12', at(10)))
  assert.equal(again.envelope.line, 'go on with B12 from your checkpoint: branch b12-gate, commit def5678, next: paint it')
})

test('a busy report at minute 8: it works, nothing happens; idle again at 9 is a new spell (no give-back at 20)', () => {
  const sent = written(decideAt(5), 'e1', at(5))
  const busy = decideAt(8, { envelopes: [sent], worker: stopped(at(8), { state: 'working', report: { state: 'busy', since: at(8), background: false, at: at(8) } }) })
  assert.deepEqual([busy.state, busy.envelope, busy.asked, busy.giveBack, busy.close], [STATES.WORKING, null, null, null, null])
  const idleAgain = stopped(at(20), { report: { state: 'idle', since: at(9), background: false, at: at(20) } })
  const twenty = decideAt(20, { envelopes: [sent], worker: idleAgain })
  assert.deepEqual([twenty.giveBack, twenty.asked], [null, null])
  assert.equal(decideAt(14, { envelopes: [sent], worker: idleAgain }).envelope.resume, resumeMarker('B12', at(9)))
  // Background work, or a wait for the partner, is working too.
  for (const why of ['background', 'partner']) assert.equal(decideAt(30, { worker: stopped(at(30), { state: 'working', why }) }).envelope, null, why)
})

test('an asleep holder: its line waits in the outbox, and that waiting line is what has the board wake it (wakeNeeds names it)', () => {
  const asleep = stopped(at(5), { isRunning: false, asleep: true, asleepSince: T0, session: 'local_worker1', report: { state: 'ended', since: T0, background: false, at: T0 } })
  const due = decideAt(5, { worker: asleep })
  assert.equal(due.envelope.kind, RESUME_KIND)
  const sent = written(due, 'e1', at(5))
  // The lane as the state gives it: its store steps name the step it holds.
  const state = { chats: [{ ...asleep, session: '0123abcd-0123-4567-89ab-0123456789ab', storeSteps: [{ id: 'B12', state: 'in progress' }] }] }
  assert.deepEqual(wakeNeeds(state, [sent]).map(one => [one.chat, one.why]), [['Worker 1', 'envelope']])
  assert.deepEqual(wakeNeeds(state, []), [], 'without the line nothing waits for it')
  // An off holder (woken and silent, or no app session) and an unknown one count as stopped too.
  for (const lane of [{ state: 'off', isRunning: false }, { state: 'unknown', isRunning: null }]) {
    assert.equal(decideAt(5, { worker: stopped(at(5), { ...lane, report: { state: 'busy', since: at(-5), background: false, at: T0 } }) }).envelope?.kind, RESUME_KIND, lane.state)
  }
})

test('the person\'s pause and the time the board was off are not counted (mutant: the pause counted)', () => {
  // The board was off from 10:02 to 10:12: at 10:12 two minutes ran, at 10:15 five.
  const off = now => from => now - from - Math.max(0, Math.min(at(12), now) - Math.max(at(2), from))
  assert.equal(decideAt(12, { runningMs: off(at(12)) }).envelope, null)
  assert.equal(decideAt(15, { runningMs: off(at(15)) }).envelope?.kind, RESUME_KIND)
  // The person paused until 10:03: the spell counts from then, so 10:07 is too early and 10:08 is due.
  const pause = { state: 'running', since: at(3) }
  assert.equal(decideAt(7, { pause }).envelope, null)
  assert.equal(decideAt(8, { pause }).envelope?.kind, RESUME_KIND)
  // While the person pauses: suspended, nothing; while the resume runs, nothing either (it wakes the holders itself).
  assert.equal(decideAt(30, { paused: true, pause: { state: 'pausing', since: at(1) } }).state, STATES.SUSPENDED)
  assert.equal(decideAt(30, { pause: { state: 'resuming', since: at(20) } }).envelope, null)
  // The give-back's 15 minutes leave the pause out too.
  const sent = written(decideAt(5), 'e1', at(5))
  assert.equal(decideAt(20, { envelopes: [sent], pause: { state: 'running', since: at(10) } }).giveBack, null)
  assert.equal(decideAt(25, { envelopes: [sent], pause: { state: 'running', since: at(10) } }).giveBack?.step, 'B12')
})

test('never for a step with an open ask (B308: any of that worker, or under the step), nor after the person\'s Stop since the take, a worker being removed or paused for a limit', () => {
  const ask = (more = {}) => item({ Id: 'Q1', Kind: 'ask', Title: 'Which hinge?', State: 'open', Owner: 'Worker 1', Since: stamp(at(-5)), ...more })
  assert.equal(decideAt(30, { items: mapOf(held(), ask()) }).envelope, null)
  assert.equal(decideAt(30, { items: mapOf(held(), ask({ Owner: 'Worker 2', Of: 'B12' })) }).envelope, null)
  assert.equal(decideAt(30, { items: mapOf(held(), ask({ Owner: 'Worker 2', Of: 'B7' })) }).envelope?.kind, RESUME_KIND, 'another chat\'s ask on another step is no bar')
  // 2026-11-02 (the person's "A"): a look the partner handed over that Autopilot keeps for the recap holds no worker, so it is no bar
  // (its own, or under the step); the same ask without the kept line is.
  const KEPT = 'Your partner hands this to you; Autopilot keeps it for the goal\'s recap'
  const keptAsk = (more = {}, route = [KEPT]) => item({ Id: 'Q1', Kind: 'ask', Title: 'Which hinge?', State: 'open', Owner: 'Worker 1', Since: stamp(at(-5)), Asks: 'look', Blocking: 'no', Route: 'recap', ...more }, route.length === 0 ? {} : { Route: route })
  assert.equal(decideAt(30, { items: mapOf(held(), keptAsk()) }).envelope?.kind, RESUME_KIND)
  assert.equal(decideAt(30, { items: mapOf(held(), keptAsk({ Owner: 'Worker 2', Of: 'B12' })) }).envelope?.kind, RESUME_KIND)
  assert.equal(decideAt(30, { items: mapOf(held(), keptAsk({}, [])) }).envelope, null, 'a recap wait of the old routes still bars it')
  // The person's answer at 10:10 starts the clock anew (the answer is on its way to it).
  const answered = mapOf(held(), ask({ State: 'answered', Since: stamp(at(10)) }))
  assert.equal(decideAt(15, { items: answered }).envelope, null)
  assert.equal(decideAt(16, { items: answered }).envelope?.kind, RESUME_KIND)
  // B769: the person's Stop (or Remove) of the worker since its take: it stands on purpose.
  const stop = { id: 's1', command: 'stop', byCode: true, about: 'Worker 1', to: 'Lead', at: at(1), state: 'delivered' }
  assert.equal(decideAt(30, { stops: [stop] }).envelope, null)
  assert.equal(decideAt(30, { stops: [{ ...stop, command: 'remove' }] }).envelope, null)
  assert.equal(decideAt(30, { stops: [{ ...stop, at: at(-60) }] }).envelope?.kind, RESUME_KIND, 'a stop before the take is over')
  assert.equal(decideAt(30, { worker: stopped(at(30), { removedAt: at(20) }) }).envelope, null)
  assert.equal(decideAt(30, { worker: stopped(at(30), { removal: { isOpen: true } }) }).envelope, null)
  assert.equal(decideAt(30, { worker: stopped(at(30), { state: 'suspended', suspended: { by: 'note', limit: 'fiveHour' } }) }).state, STATES.SUSPENDED)
  assert.equal(decideAt(30, { limitFull: true }).state, STATES.SUSPENDED)
})

test('never for a step in review or checking, nor one waiting on you; a Quality Assurance task held by a stopped worker counts like any step', () => {
  const review = decideAt(30, { items: mapOf(held({ State: 'review' }, [`- ${stamp(at(-30))} Worker 1: queued → taken`, `- ${stamp(at(-1))} Worker 1: in progress → review`])) })
  assert.deepEqual([review.state, review.envelope, review.goOn, review.giveBack], [STATES.CHECKING, null, null, null])
  const waiting = decideAt(30, { items: mapOf(held({ State: 'waiting on you' })) })
  assert.deepEqual([waiting.state, waiting.envelope], [STATES.WORKING, null])
  const qa = decideAt(5, { items: mapOf(held({ Checks: 'B5', Branch: '-' })) })
  assert.equal(qa.envelope.line, 'go on with B12 from your checkpoint: branch none, commit abc1234, next: write the tests')
})

test('the line names "none" for what the step lacks: no branch, no commit, no checkpoint at all', () => {
  assert.equal(goOnLine(held({ Branch: '-', Checkpoint: checkpointLine({ commit: 'none', next: 'start over', now: at(-1) }) })), 'go on with B12 from your checkpoint: branch none, commit none, next: start over')
  assert.equal(goOnLine(held({ Checkpoint: '' })), 'go on with B12 from your checkpoint: branch b12-gate, commit none, next: none')
})

// ---- The board: the envelope, the History line, the give-back (the second half: the store's move).

async function garden(t, items) {
  const dir = await mkdtemp(join(tmpdir(), 'holder-timers-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, { items, activities: [{ name: 'Garden', isFocus: false, steps: [...items.keys()], notes: [], loose: [] }] }, undefined, { now: at(-60) })
  const roles = { Lead: 'main', 'Worker 1': 'worker', 'Worker 2': 'worker' }
  const ctx = now => ({ dir, now, prefix: '', roleOf: chat => roles[chat] ?? null, chats: Object.keys(roles) })
  const outbox = memoryStore()
  let n = 0
  const logged = []
  const pass = (lane, now, { ready = [], isPushed = null } = {}) => handOver({
    lane, state: { chats: [lane], chatPrefix: '', readyList: { ready }, limits: {}, gaps: [], restart: { main: 'Lead' } }, dir, outbox,
    apply: body => workApi(body, { ...ctx(now), as: 'server' }), config: { handover: 'sequence' }, now, newId: () => `e${(n += 1)}`, event: { kind: 'pass' }, log: line => logged.push(line), isPushed,
  })
  return { dir, outbox, pass, logged, as: (chat, body, now) => workApi({ chat, ...body }, ctx(now)), read: async id => (await readStore(dir)).items.get(id) }
}

test('the live shape, end to end: the line at 5, at 20 the step goes back on the list with its checkpoint, the next free worker continues it, the dropped worker is refused and owes a clear', async t => {
  forgetTold()
  const plan = planText({ names: ['frame', 'hinges', 'paint'], on: 2, steps: 3, until: null, stepUntil: null, writtenAt: at(-10) })
  const one = await garden(t, mapOf(held({ Plan: plan, Pinned: 'Worker 1', Refined: 'ready' })))
  const first = await one.pass(stopped(at(5)), at(5))
  assert.equal(first.envelope.kind, RESUME_KIND)
  assert.deepEqual([first.envelope.to, first.envelope.step, first.envelope.state, first.envelope.resume, first.envelope.line], ['Worker 1', null, 'waiting', resumeMarker('B12', T0), LINE])
  assert.deepEqual(contractOf(first.envelope), { id: 'e1', kind: RESUME_KIND, step: null, clear: null, restart: false, set: null, line: LINE })
  assert.equal(carryable(one.outbox.outbox(), 'Worker 1', at(6), { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN, pause: null })?.id, 'e1', 'its next take brings it')
  assert.equal((await one.read('B12')).sections.get('History').at(-1).endsWith(`server: ${goOnWords('Worker 1', T0)}`), true)
  assert.equal(goOnWords('Worker 1', T0), 'the board asked Worker 1 to go on (stopped since 10:00)')
  // Later passes write no second line.
  assert.equal((await one.pass(stopped(at(6)), at(6))).envelope, null)
  assert.equal((await one.pass(stopped(at(12)), at(12))).envelope, null)
  assert.equal(one.outbox.outbox().length, 1)
  // At 20 the decision says give-back, and the work API moves it: refined, Owner cleared, Checkpoint, Branch and Plan
  // kept, the pin to Worker 1 taken off with its own line, the History line; the waiting line closed.
  const before = await one.read('B12')
  const due = await one.pass(stopped(at(20)), at(20))
  assert.deepEqual(due.decision.giveBack, { step: 'B12', chat: 'Worker 1', askedAt: at(5) })
  assert.equal(due.decision.givenBack, true)
  const back = await one.read('B12')
  assert.deepEqual(['State', 'Owner', 'Pinned', 'Checkpoint', 'Branch', 'Plan'].map(key => valueOf(back, key)), ['refined', null, null, valueOf(before, 'Checkpoint'), 'b12-gate', plan])
  const lines = back.sections.get('History')
  assert.match(lines.at(-2), /server: in progress → refined \(given back by the board: Worker 1 did not resume it \(asked 10:05\)\)$/)
  assert.match(lines.at(-1), /server: unpinned from Worker 1: given back by the board$/)
  assert.deepEqual([one.outbox.outbox()[0].state, one.logged], ['dropped', []])
  assert.deepEqual(continuationOf(back), { at: at(20), chat: 'Worker 1' })
  const items = (await readStore(one.dir)).items
  assert.deepEqual(givenBackFrom(items, 'Worker 1'), [{ id: 'B12', at: at(20) }])
  // The dropped worker: its later step, report and take are refused with the board's words, and it owes a clear as of the give-back.
  const words = 'B12 was given back by the board at 10:20: stop that work and run work next'
  for (const body of [{ action: 'step', id: 'B12', commit: 'abc1234', next: 'paint' }, { action: 'report', id: 'B12', result: 'The gate hangs.' }, { action: 'take', id: 'B12', minutes: 30 }]) {
    assert.deepEqual([(await one.as('Worker 1', body, at(21))).why], [words], body.action)
  }
  const dropped = { ...stopped(at(22)), state: 'free', report: { state: 'idle', since: at(21), background: false, at: at(22) } }
  const owed = clearOwed({ lane: dropped, items, afterStep: 'clear' })
  assert.deepEqual([owed?.step, owed?.reportedAt], ['B12', at(20)])
  // The dropped worker, free, is not given B12 again (it gets its clear alone); the next free worker gets the continuation.
  const ready = readyList(items, { now: at(22), beyondFocus: true }).ready
  assert.deepEqual(ready.map(entry => entry.id), ['B12'])
  const again = await one.pass({ ...dropped, clearOwed: owed }, at(22), { ready })
  assert.deepEqual([again.decision.give, again.envelope?.kind, again.envelope?.clear], [null, 'clear', { step: 'B12', reportedAt: at(20) }])
  const next = { ...dropped, name: 'Worker 2', report: { state: 'idle', since: at(19), background: false, at: at(22) } }
  const given = await one.pass(next, at(23), { ready, isPushed: async () => false })
  assert.equal(given.decision.give, 'B12')
  assert.equal(given.envelope.line, 'work: B12 is yours; run work next, then continue B12 from its checkpoint: branch b12-gate, commit abc1234 (local only), next: write the tests; fetch the branch, the old worktree is removed by the sync')
  assert.deepEqual([valueOf(await one.read('B12'), 'State'), valueOf(await one.read('B12'), 'Owner')], ['queued', 'Worker 2'])
  // The step's status line on the page, from its real History.
  const script = await readFile(new URL('../../public/board.js', import.meta.url), 'utf8')
  const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
  const page = {}
  vm.runInNewContext(`${cut('item')}\n${cut('story')}\nObject.assign(this, { stepStatus })`, page)
  const history = (await one.read('B12')).sections.get('History').map(line => line.replace(/^-\s+/, ''))
  assert.match(page.stepStatus({ owner: 'Worker 2', state: 'queued', history }), /given back, continues with Worker 2 from its checkpoint$/)
  // Its take keeps the plan; the dropped worker is still refused.
  assert.equal((await one.as('Worker 2', { action: 'take', id: 'B12', minutes: 40 }, at(24))).ok, true)
  assert.deepEqual([planOf(await one.read('B12'))?.names, planOf(await one.read('B12'))?.on], [['frame', 'hinges', 'paint'], 2])
  assert.equal((await one.as('Worker 1', { action: 'step', id: 'B12', commit: 'abc1234', next: 'paint' }, at(25))).why, words)
  // The give-back path is the board's alone, and only for a step that chat holds.
  assert.equal((await one.as('Worker 1', { action: 'advance', id: 'B12', to: 'refined', giveBack: { chat: 'Worker 2', why: 'x' } }, at(26))).ok, false)
  const refused = await workApi({ action: 'advance', id: 'B12', to: 'refined', giveBack: { chat: 'Worker 1', why: giveBackWords('Worker 1', at(5)) } }, { dir: one.dir, now: at(26), prefix: '', as: 'server' })
  assert.match(refused.why, /B12 is in progress for Worker 2: only a step taken or in progress for Worker 1 is given back/)
})

test('the give-back path: waiting on you only for a holder gone from the list; the reconciler never gives a step back at a refresh (mutant: the guard dropped)', async t => {
  const one = await garden(t, mapOf(held({ State: 'waiting on you' }), item({ Id: 'B20', Kind: 'step', Title: 'Rake', State: 'in progress', Owner: 'Worker 2', Since: stamp(at(-300)) }, { History: [`- ${stamp(at(-300))} Worker 2: queued → taken`] })))
  const server = (body, now) => workApi(body, { dir: one.dir, now, prefix: '', as: 'server' })
  assert.match((await server({ action: 'advance', id: 'B12', to: 'refined', giveBack: { chat: 'Worker 1', why: giveBackWords('Worker 1', at(5)) } }, at(30))).why, /only a step taken or in progress for Worker 1/)
  const gone = await server({ action: 'advance', id: 'B12', to: 'refined', giveBack: { chat: 'Worker 1', why: goneWords('Worker 1'), gone: true } }, at(30))
  assert.equal(gone.ok, true, gone.why)
  assert.match((await one.read('B12')).sections.get('History').at(-1), /server: waiting on you → refined \(given back by the board: Worker 1 left the list of chats\)$/)
  assert.deepEqual(continuationOf(await one.read('B12')), { at: at(30), chat: 'Worker 1' })
  // Without the give-back's own context the guard never holds: no other path moves a held step to refined.
  assert.equal((await server({ action: 'advance', id: 'B20', to: 'refined' }, at(31))).ok, false)
  // A refresh: the reconciler applies the server's moves whose guard holds; never the give-back, for any step in progress.
  const store = await readStore(one.dir)
  const done = reconcile({ store, flow: store.flow, lanes: [{ name: 'Worker 2', state: 'interrupted', isMain: false, isLeftover: false, isRunning: false, lastActivityAt: at(-300) }], now: at(31), times: { graceMs: 10 * MIN, askMs: 60 * MIN, idleMs: 5 * MIN }, prefix: '' })
  assert.deepEqual(done.moves.filter(move => move.to === 'refined'), [])
  assert.deepEqual(DEFAULT_FLOW.step.moves.filter(move => move.to === 'refined' && move.by === 'server' && move.when === GIVE_BACK_GUARD).map(move => move.from), ['taken', 'in progress', 'waiting on you'])
})

test('owner-gone: the step of a holder gone from the list goes back at once through the same path, with no note to Main (mutant: still a note)', async t => {
  const one = await garden(t, mapOf(held({ Owner: 'Ghost' }), held({ Id: 'B13', Owner: 'Ghost', State: 'waiting on you' })))
  const items = (await readStore(one.dir)).items
  const lanes = [{ name: 'Lead', isMain: true, isLeftover: false, state: 'working', isRunning: true }, { name: 'Worker 1', isMain: false, isLeftover: false, state: 'free', isRunning: true }]
  const found = findStuck({ items, lanes, now: at(60), seen: new Map([['missing ghost', at(0)]]) }).filter(one => one.check === 'owner-gone')
  assert.deepEqual(found.map(one => one.fix), [{ do: 'give-back', id: 'B12', chat: 'Ghost', why: goneWords('Ghost') }, { do: 'give-back', id: 'B13', chat: 'Ghost', why: goneWords('Ghost') }])
  const applied = []
  const done = await applySync(found, {
    apply: async body => { applied.push(body); return workApi(body, { dir: one.dir, now: at(60), prefix: '', as: 'server' }) },
    unblock: async () => ({ ok: true }), unpin: async () => ({ ok: true }), recheck: async () => ({ ok: true }), person: async () => ({ ok: true }),
    wake: async () => null, noted: { load: async () => ({ noted: [], seen: {} }), save: async () => {} }, now: () => at(60),
  })
  assert.deepEqual(applied.map(body => [body.action, body.id, body.to, body.giveBack.gone]), [['advance', 'B12', 'refined', true], ['advance', 'B13', 'refined', true]])
  assert.deepEqual(await Promise.all(['B12', 'B13'].map(async id => [valueOf(await one.read(id), 'State'), valueOf(await one.read(id), 'Owner'), valueOf(await one.read(id), 'Checkpoint') !== null])), [['refined', null, true], ['refined', null, true]])
  assert.deepEqual(done.rows.map(row => row.status), ['Fixed', 'Fixed'])
  assert.deepEqual(done.note, [])
})

test('after a give-back, the health summary names it as the board\'s own work, and the card that still names the step is no fault until its clear', async t => {
  const one = await garden(t, mapOf(held()))
  await workApi({ action: 'advance', id: 'B12', to: 'refined', giveBack: { chat: 'Worker 1', why: giveBackWords('Worker 1', at(5)) } }, { dir: one.dir, now: at(20), prefix: '', as: 'server' })
  const store = await readStore(one.dir)
  const text = healthSummary(buildView({ state: { chats: [{ name: 'Lead', isMain: true, isLeftover: false, state: 'working', isRunning: true }], chatPrefix: '', today: [], limits: {} }, items: store.items, now: at(21) }), at(21))
  assert.match(text, /- B12 refined: given back by the board from Worker 1 at 10:20; the next free worker continues it from its checkpoint, no incident: Hang the gate/)
  const card = { name: 'Worker 1', state: 'free', isMain: false, isLeftover: false, isRunning: true, lastActivityAt: at(20), task: { source: 'plan', stepId: 'B12', text: 'B12' } }
  const flags = reconcile({ store, flow: store.flow, lanes: [card], now: at(21), times: { graceMs: 10 * MIN, askMs: 60 * MIN, idleMs: 5 * MIN }, prefix: '' }).flags
  assert.deepEqual(flags.filter(flag => flag.kind === 'card'), [])
})

test('the outbox sweep keeps the waiting line while its worker holds the step, and drops it once the step left it (mutant: the sweep dropping it)', () => {
  const sent = written(decideAt(5), 'e1', at(5))
  const keep = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN, pause: null }
  const ctx = items => ({ all: [sent], items, now: at(30), keep, prefix: '', runs: new Map(), closing: new Set(), lanes: [] })
  assert.equal(whyClosed(sent, ctx(mapOf(held()))), null)
  assert.equal(whyClosed(sent, ctx(mapOf(held({ State: 'taken' })))), null)
  assert.deepEqual(whyClosed(sent, ctx(mapOf(held({ State: 'review' })))), { state: 'dropped', why: 'Worker 1 no longer holds B12' })
  assert.deepEqual(whyClosed(sent, ctx(mapOf(held({ State: 'refined', Owner: '-' })))), { state: 'dropped', why: 'Worker 1 no longer holds B12' })
  assert.equal(whyClosed(sent, ctx(null)), null, 'without a store it matters')
})

test('the old resume senders skip a holder on the sequence: resumesDue and the wake\'s asleep need; one off the sequence keeps them', () => {
  const steps = [{ id: 'B12', state: 'in progress' }]
  const off = { name: 'Worker 1', isMain: false, isLeftover: false, isRunning: false, state: 'off', storeSteps: steps }
  assert.deepEqual(resumesDue({ chats: [{ ...off, onSequence: true }], restart: { main: 'Lead' } }, []), [])
  assert.equal(resumesDue({ chats: [off], restart: { main: 'Lead' } }, []).length, 1)
  const asleep = { ...off, state: 'interrupted', asleep: true, asleepSince: at(0), appSession: 'local_0123456789abcdef0123456789abcdef' }
  // Signals change 4: the asleep line is the wake procedure's need now (src/wake.mjs `wakeNeeds`, case 3).
  assert.deepEqual(wakeNeeds({ chats: [{ ...asleep, onSequence: true }] }, []), [])
  assert.equal(wakeNeeds({ chats: [asleep] }, []).length, 1)
  // A sequence worker cut off mid-turn with no step still gets the asleep line (the timers are for holders).
  assert.equal(wakeNeeds({ chats: [{ ...asleep, onSequence: true, storeSteps: [] }] }, []).length, 1)
})

test('limit-back lines up with the new words: go on from your checkpoint, with branch, commit and next', () => {
  const lane = { name: 'Worker 1', isMain: false, isLeftover: false, state: 'suspended', suspended: { by: 'note', limit: 'fiveHour', since: at(-300), until: at(-10), isBack: true } }
  const found = findStuck({ items: mapOf(held()), lanes: [{ name: 'Lead', isMain: true, isLeftover: false, state: 'working', isRunning: true }, lane], now: at(0) }).filter(one => one.check === 'limit-back')
  assert.equal(found[0].fix.text, `work: the limit is back: ${LINE}; run work next`)
})

// ---- After the give-back (its History line, written by the second half): the refusals, the continuation, the page.

const BACK_AT = at(20)
const backLine = `- ${stamp(BACK_AT)} server: in progress → refined (${giveBackWords('Worker 1', at(5))})`
const givenBack = (more = {}) => held({ State: 'refined', Owner: '-', Refined: 'ready', Since: stamp(BACK_AT), ...more }, [`- ${stamp(at(-30))} Worker 1: queued → taken`, backLine])

test('the give-back\'s words: the History line the move will write, read back by every reader', () => {
  assert.equal(giveBackWords('Worker 1', at(5)), 'given back by the board: Worker 1 did not resume it (asked 10:05)')
  assert.equal(GIVEN_BACK.exec(backLine)?.[2], 'Worker 1')
  assert.deepEqual(continuationOf(givenBack()), { at: BACK_AT, chat: 'Worker 1' })
  // Once a worker took it again, it is no continuation any more.
  const retaken = givenBack()
  retaken.sections.get('History').push(`- ${stamp(at(25))} Worker 2: queued → taken`)
  assert.equal(continuationOf(retaken), null)
})

test('notOfferedAgain keeps a given-back step from the worker that dropped it, until it takes another task', () => {
  assert.deepEqual([...notOfferedAgain(mapOf(givenBack()), 'Worker 1')], ['B12'])
  assert.deepEqual([...notOfferedAgain(mapOf(givenBack()), 'Worker 2')], [])
  const other = item({ Id: 'B30', Kind: 'step', Title: 'Rake', State: 'in progress', Owner: 'Worker 1', Since: stamp(at(30)) }, { History: [`- ${stamp(at(30))} Worker 1: queued → taken`] })
  assert.deepEqual([...notOfferedAgain(mapOf(givenBack(), other), 'Worker 1')], [])
})

test('the next worker\'s line is the continuation: branch, commit and next ("none" for no commit, "local only" for a commit on no remote), and the dropped worker is not given it', () => {
  const free = { name: 'Worker 2', isMain: false, isLeftover: false, isRunning: true, state: 'free', mod: HANDOVER_MOD, report: { state: 'idle', since: at(19), background: false, at: at(21) } }
  const ready = [{ id: 'B12', rank: 2, keptFor: null, keptUntil: null, pinned: null }]
  const given = decide({ worker: free, items: mapOf(givenBack()), ready, now: at(21) })
  assert.equal(given.give, 'B12')
  assert.equal(given.envelope.line, 'work: B12 is yours; run work next, then continue B12 from its checkpoint: branch b12-gate, commit abc1234, next: write the tests; fetch the branch, the old worktree is removed by the sync')
  assert.match(decide({ worker: free, items: mapOf(givenBack()), ready, now: at(21), localOnly: new Set(['B12']) }).envelope.line, /commit abc1234 \(local only\), next:/)
  assert.match(continuationLine(givenBack({ Checkpoint: checkpointLine({ commit: 'none', next: 'start over', now: at(-1) }) }), { localOnly: true }), /branch b12-gate, commit none, next: start over;/)
  // An ordinary step keeps the ordinary line.
  assert.equal(decide({ worker: free, items: mapOf(item({ Id: 'B13', Kind: 'step', Title: 'Rake', State: 'refined', Refined: 'ready', Since: stamp(at(-5)) })), ready: [{ ...ready[0], id: 'B13' }], now: at(21) }).envelope.line, lineFor('B13'))
  // The worker that dropped it is not given it (it gets nothing else here).
  const dropped = { ...free, name: 'Worker 1' }
  assert.equal(decide({ worker: dropped, items: mapOf(givenBack()), ready, now: at(21) }).give, null)
})

test('the dropped worker\'s later step, report and take are refused with the board\'s words; without the History line the old refusals stand; the next worker\'s take keeps the plan', async t => {
  const plan = planText({ names: ['frame', 'hinges', 'paint'], on: 2, steps: 3, until: null, stepUntil: null, writtenAt: at(-10) })
  const one = await garden(t, mapOf(givenBack({ Plan: plan }), item({ Id: 'B13', Kind: 'step', Title: 'Rake', State: 'refined', Refined: 'ready', Since: stamp(at(-5)) }, { History: [`- ${stamp(at(-5))} Partner: made`] })))
  const words = `B12 was given back by the board at ${hourMinute(BACK_AT)}: stop that work and run work next`
  assert.equal(givenBackRefusal(givenBack(), 'Worker 1'), words)
  assert.equal(givenBackRefusal(givenBack(), 'Worker 2'), null)
  for (const body of [{ action: 'step', id: 'B12', commit: 'abc1234', next: 'paint' }, { action: 'report', id: 'B12', result: 'The gate hangs.' }, { action: 'take', id: 'B12', minutes: 30 }]) {
    const refused = await one.as('Worker 1', body, at(25))
    assert.deepEqual([refused.ok, refused.status, refused.why], [false, 409, words], body.action)
  }
  // Without the History line: the refusals as before.
  assert.equal((await one.as('Worker 1', { action: 'step', id: 'B13', commit: 'abc1234', next: 'rake' }, at(25))).why, 'B13 is not in progress for Worker 1: take it first.')
  assert.equal((await one.as('Worker 1', { action: 'report', id: 'B13', result: 'Raked.' }, at(25))).why, 'B13 is nobody\'s, not Worker 1\'s.')
  // The board gives it to Worker 2, who takes it: the plan stays, on the part it stood on.
  assert.equal((await workApi({ action: 'advance', id: 'B12', to: 'queued', for: 'Worker 2' }, { dir: one.dir, now: at(26), prefix: '', as: 'server', roleOf: chat => (chat === 'Lead' ? 'main' : 'worker') })).ok, true)
  assert.equal((await one.as('Worker 2', { action: 'take', id: 'B12', minutes: 40 }, at(27))).ok, true)
  const taken = await one.read('B12')
  assert.deepEqual([valueOf(taken, 'State'), valueOf(taken, 'Owner'), planOf(taken)?.names, planOf(taken)?.on], ['in progress', 'Worker 2', ['frame', 'hinges', 'paint'], 2])
  // The dropped worker's call on it now: still refused with the board's words (it is Worker 2's).
  assert.equal((await one.as('Worker 1', { action: 'step', id: 'B12', commit: 'abc1234', next: 'paint' }, at(28))).why, words)
  // A step taken anew that was never given back starts on a plan of its own, as before.
  assert.equal((await workApi({ action: 'advance', id: 'B13', to: 'queued', for: 'Worker 1' }, { dir: one.dir, now: at(29), prefix: '', as: 'server', roleOf: chat => (chat === 'Lead' ? 'main' : 'worker') })).ok, true)
})

test('the page: the lane says "Stopped · asked to go on at HH:MM"; the give-back\'s lines show only once its History line exists', async () => {
  const lane = stopped(at(8))
  assert.deepEqual([statusOf({ lane, handover: { state: 'working', why: null, step: 'B12', asked: at(5) }, now: at(8) }).status, statusOf({ lane, handover: { state: 'working', why: null, step: 'B12', asked: at(5) }, now: at(8) }).why], ['Stopped', 'asked to go on at 10:05'])
  assert.equal(statusOf({ lane, handover: { state: 'working', why: null, step: 'B12', asked: null }, now: at(8) }).why, 'task open since 10:00')
  const asleep = { ...lane, isRunning: false, asleep: true, asleepSince: T0 }
  assert.equal(statusOf({ lane: asleep, handover: { state: 'working', step: 'B12', asked: at(5) }, now: at(8) }).why, 'asked to go on at 10:05')
  // The dropped worker's lane: "did not resume B12, given back 10:20" from the History line, until its next task.
  assert.deepEqual(givenBackFrom(mapOf(givenBack()), 'Worker 1'), [{ id: 'B12', at: BACK_AT }])
  assert.deepEqual(givenBackFrom(mapOf(held()), 'Worker 1'), [])
  const script = await readFile(new URL('../../public/board.js', import.meta.url), 'utf8')
  const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
  const page = {}
  vm.runInNewContext(`${cut('laneflags')}\n${cut('item')}\n${cut('story')}\nObject.assign(this, { laneFlags, stepStatus })`, page)
  const tones = page.laneFlags({ name: 'Worker 1', flags: [{ kind: 'given back', id: 'B12', text: 'did not resume B12, given back 10:20', button: null }, { kind: 'given back old', id: 'B9', text: 'did not resume B9, given back 08:00', button: null }] }).map(one => one.tone)
  assert.deepEqual(tones, ['warn', 'quiet'])
  const history = [`${stamp(at(-30))} Worker 1: queued → taken`, `${stamp(BACK_AT)} server: in progress → refined (${giveBackWords('Worker 1', at(5))})`]
  assert.match(page.stepStatus({ owner: 'Worker 2', state: 'in progress', history }), /given back, continues with Worker 2 from its checkpoint$/)
  assert.match(page.stepStatus({ owner: null, state: 'refined', history }), /given back, continues with the next free worker from its checkpoint$/)
  assert.doesNotMatch(page.stepStatus({ owner: 'Worker 1', state: 'in progress', history: history.slice(0, 1) }), /given back/)
})

test('the settings: resumeAfterMinutes 5 and giveBackAfterMinutes 15 unless set; whole minutes of at least 1', () => {
  const config = parseConfig('{}', {})
  assert.deepEqual([config.resumeAfterMinutes, config.giveBackAfterMinutes], [5, 15])
  const set = parseConfig('{"resumeAfterMinutes": 3, "giveBackAfterMinutes": 30}', {})
  assert.deepEqual([set.resumeAfterMinutes, set.giveBackAfterMinutes], [3, 30])
  assert.deepEqual([parseConfig('{"resumeAfterMinutes": 0}', {}).resumeAfterMinutes, parseConfig('{"giveBackAfterMinutes": "x"}', {}).giveBackAfterMinutes], [5, 15])
  // The board reads them into the decision.
  assert.equal(decideAt(3, { timers: { resumeMs: 3 * MIN, giveBackMs: 30 * MIN } }).envelope?.kind, RESUME_KIND)
})

test('the retired rules\' open incidents are closed by the board\'s pass, with one line; another rule\'s stay', async t => {
  const incident = (id, source, state = 'open') => item({ Id: id, Kind: 'incident', Title: `${source} case`, State: state, Source: source, Subject: 'Worker 1', Key: `${source} Worker 1`, Since: stamp(at(-60)), 'First seen': stamp(at(-60)), 'Last seen': stamp(at(-5)), Count: '3' }, { History: [`- ${stamp(at(-60))} server: opened by the rule ${source}`] })
  const one = await garden(t, mapOf(incident('X1', 'unknown-lane'), incident('X2', 'holder-not-running', 'with the advisor'), incident('X3', 'stale-suspended'), incident('X4', 'holder-not-running', 'fixed')))
  const done = await workApi({ action: 'incidents-fixed' }, { dir: one.dir, now: at(0), prefix: '', as: 'server' })
  assert.deepEqual(done.result.closed, ['X1', 'X2'])
  assert.deepEqual(await Promise.all(['X1', 'X2', 'X3', 'X4'].map(async id => valueOf(await one.read(id), 'State'))), ['closed', 'closed', 'open', 'fixed'])
  assert.match((await one.read('X1')).sections.get('History').at(-1), /server: closed: the rule unknown-lane is retired \(signals change 3\)/)
  assert.deepEqual((await workApi({ action: 'incidents-fixed' }, { dir: one.dir, now: at(1), prefix: '', as: 'server' })).result.closed, [], 'once')
})

// ---- The lead's review: at most two "go on" lines per holder and step.

/** Lines 1 (at 5, spell from 10:00) and 2 (at 11:30, after a short turn at 10:06), as the board wrote them. */
function twoLines() {
  const first = written(decideAt(5), 'e1', at(5))
  const afterShort = stopped(at(11.5), { turnAt: at(6), report: { state: 'idle', since: at(6.5), background: false, at: at(11.5) } })
  assert.equal(decideAt(11.4, { envelopes: [first], worker: afterShort }).envelope, null)
  const due = decideAt(11.5, { envelopes: [first], worker: afterShort })
  assert.equal(due.envelope?.resume, resumeMarker('B12', at(6.5)), 'a short turn after the first line: a second line')
  return [first, written(due, 'e2', at(11.5))]
}
/** Worker 1 after a turn from `from` to `to` (minutes), heard at `now`. */
const turned = (from, to, now) => stopped(at(now), { turnAt: at(from), report: { state: 'idle', since: at(to), background: false, at: at(now) } })

test('the cap: a third short turn gets no third line, and the give-back comes 15 min after the second line (mutant: no cap)', () => {
  const lines = twoLines()
  for (const minutes of [17.5, 20, 26.4]) {
    const later = decideAt(minutes, { envelopes: lines, worker: turned(12, 12.5, minutes) })
    assert.equal(later.envelope, null, `minute ${minutes}`)
    assert.equal(later.asked, at(11.5))
    assert.equal(later.giveBack, null)
  }
  const due = decideAt(26.5, { envelopes: lines, worker: turned(12, 12.5, 26.5) })
  assert.deepEqual(due.giveBack, { step: 'B12', chat: 'Worker 1', askedAt: at(11.5) })
  assert.equal(due.close, 'e2')
  // An answered ask after the second line starts nothing anew either.
  const answer = item({ Id: 'Q1', Kind: 'ask', Title: 'Which hinge?', State: 'answered', Owner: 'Worker 1', Since: stamp(at(14)) })
  assert.equal(decideAt(26.5, { items: mapOf(held(), answer), envelopes: lines, worker: turned(12, 12.5, 26.5) }).giveBack?.step, 'B12')
  // The count is the History too: an outbox that let the lines go keeps no third from coming.
  const noted = held({}, [`- ${stamp(at(-30))} Worker 1: queued → taken`, `- ${stamp(at(5))} server: ${goOnWords('Worker 1', T0)}`, `- ${stamp(at(11))} server: ${goOnWords('Worker 1', at(6.5))}`])
  const fromHistory = decideAt(30, { items: mapOf(noted), worker: turned(12, 12.5, 30) })
  assert.deepEqual([fromHistory.envelope, fromHistory.giveBack?.askedAt], [null, at(11)])
  // Another holder of the same step later (taken anew) starts its own count.
  const retaken = held({ Owner: 'Worker 2', Since: stamp(at(40)) }, [...noted.sections.get('History'), `- ${stamp(at(40))} Worker 2: queued → taken`])
  assert.equal(decideAt(46, { items: mapOf(retaken), worker: { ...stopped(at(46)), name: 'Worker 2', report: { state: 'idle', since: at(40.5), background: false, at: at(46) } } }).envelope?.kind, RESUME_KIND)
})

test('the cap: a checkpoint after the second line starts the 15 minutes anew, and still no third line', () => {
  const lines = twoLines()
  const items = mapOf(held({ Checkpoint: checkpointLine({ commit: 'def5678', next: 'paint it', now: at(15) }) }))
  assert.deepEqual([decideAt(26.5, { items, envelopes: lines }).giveBack, decideAt(26.5, { items, envelopes: lines }).envelope], [null, null])
  assert.equal(decideAt(29.9, { items, envelopes: lines }).giveBack, null)
  assert.equal(decideAt(30, { items, envelopes: lines }).giveBack?.step, 'B12')
})

test('the cap: a busy spell of 3 min after the second line starts the 15 minutes anew; one of 1 min does not', () => {
  const lines = twoLines()
  // Busy from 10:12 to 10:15: the give-back counts from 10:15.
  assert.equal(decideAt(26.5, { envelopes: lines, worker: turned(12, 15, 26.5) }).giveBack, null)
  assert.equal(decideAt(30, { envelopes: lines, worker: turned(12, 15, 30) }).giveBack?.step, 'B12')
  // Busy from 10:12 to 10:13: no reset, 15 minutes after the second line.
  assert.equal(decideAt(26.5, { envelopes: lines, worker: turned(12, 13, 26.5) }).giveBack?.step, 'B12')
  // While it is busy (lane Working) nothing happens at all.
  assert.equal(decideAt(27, { envelopes: lines, worker: stopped(at(27), { state: 'working', report: { state: 'busy', since: at(25), background: false, at: at(27) } }) }).giveBack, null)
  // A busy report heard for 3 min after the second line, then silence (its process ended): from its last report.
  const cut = stopped(at(30), { state: 'unknown', isRunning: null, report: { state: 'busy', since: at(12), background: false, at: at(15) } })
  assert.equal(decideAt(29.9, { envelopes: lines, worker: cut }).giveBack, null)
  assert.equal(decideAt(30, { envelopes: lines, worker: cut }).giveBack?.step, 'B12')
})
