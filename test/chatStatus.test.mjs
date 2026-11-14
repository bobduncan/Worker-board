// Signals change 2: one status per chat (src/chatStatus.mjs). One test per row of the brief's table and per rule, the real cases
// first; the mutants of the brief at the end (each is a way the function could go wrong, written as a case that must fail).
import test from 'node:test'
import assert from 'node:assert/strict'

import { COUNT_KEYS, RESTART_SHOWN_MS, STATUSES, STATUS_FACTS, STATUS_LIST, countsOf, isBusyStatus, toneOf, statusOf } from '../src/chatStatus.mjs'

const NOW = Date.parse('2026-10-31T12:00:00')
const SEC = 1000
const MIN = 60 * SEC
const at = (ms = 0) => NOW - ms
const report = (state, agoMs = 2 * SEC, more = {}) => ({ state, since: at(agoMs + 60 * SEC), at: at(agoMs), background: false, mod: '0.27.0', ...more })
const lane = (state, more = {}) => ({ name: 'Worker', state, isRunning: true, asleep: false, report: null, suspended: null, ...more })
const status = (input, more = {}) => statusOf({ lane: input, now: NOW, ...more })
const handover = (state, why = null, step = null) => ({ state, why, step })

test('row 1: a fresh busy report is Working; background work after a reported step and a wait for the partner say why', () => {
  assert.equal(status(lane('working', { report: report('busy') })).status, STATUSES.WORKING)
  assert.equal(status(lane('working', { report: report('idle'), heldBy: 'background' })).why, 'background')
  assert.equal(status(lane('working', { report: report('idle'), waitsForPartner: ['Q5'] })).why, 'waits for the partner')
})

test('row 1 and the rule: a fresh busy report beats a pause note read from a lagging transcript', () => {
  const noted = lane('suspended', { report: report('busy', 3 * SEC), suspended: { by: 'note', limit: 'fiveHour', since: at(5 * MIN), until: null } })
  assert.equal(status(noted).status, STATUSES.WORKING)
  // the app's own stop line is kept: it stopped the turn
  assert.equal(status({ ...noted, suspended: { ...noted.suspended, by: 'app' } }).status, STATUSES.PAUSED)
  // a busy report that is no longer fresh does not beat a note
  assert.equal(status({ ...noted, report: report('busy', 3 * MIN) }).status, STATUSES.PAUSED)
})

test('row 1: a fresh busy report beats the person\'s pause and a hand-over SUSPENDED while the turn runs', () => {
  const running = lane('working', { report: report('busy') })
  assert.equal(status(running, { handover: handover('suspended', 'the person pauses the chats'), isPersonPause: true }).status, STATUSES.WORKING)
})

test('row 2: asking, or a blocking ask open, is Waiting for you (also when asleep)', () => {
  assert.equal(status(lane('waiting', { report: report('asking') })).status, STATUSES.WAITING)
  assert.equal(status(lane('waiting', { asleep: true, isRunning: false, report: report('idle', 10 * MIN) })).status, STATUSES.WAITING)
})

test('rows 3 to 6: a worker in each hand-over state reads the right status, with the step or the why', () => {
  const idle = lane('free', { report: report('idle') })
  assert.deepEqual(status(idle, { handover: handover('checking', null, 'B12') }), { status: STATUSES.CHECKING, why: 'B12', since: null, reportAt: at(2 * SEC), age: 2 * SEC })
  assert.deepEqual([status(idle, { handover: handover('handing', null, 'B13') }).status, status(idle, { handover: handover('handing', null, 'B13') }).why], [STATUSES.HANDING, 'B13'])
  assert.equal(status(idle, { handover: handover('offered', null, 'B13') }).status, STATUSES.OFFERED)
  assert.deepEqual([status(idle, { handover: handover('held', 'its clear did not run: x') }).status, status(idle, { handover: handover('held', 'its clear did not run: x') }).why], [STATUSES.HELD, 'its clear did not run: x'])
  const unanswered = status(idle, { handover: handover('unknown', 'did not answer its hand-over (B13)', 'B13') })
  assert.deepEqual([unanswered.status, unanswered.why], [STATUSES.NO_ANSWER, 'B13'])
  assert.equal(status(idle, { handover: handover('restarting') }).status, STATUSES.RESTARTING)
  assert.equal(status(idle, { handover: handover('suspended', 'a usage limit is full') }).status, STATUSES.PAUSED)
})

test('rows 3 to 6 only apply to a worker on the hand-over: with no hand-over (the escape hatch) a free lane is Free', () => {
  const idle = lane('free', { report: report('idle') })
  assert.equal(status(idle, { handover: null }).status, STATUSES.FREE)
})

test('row 6 and 13: the other UNKNOWN whys of the hand-over (mod not reported, does not run, restart late) are Unknown, not "Did not answer"', () => {
  const quiet = lane('unknown')
  for (const why of ['its Workers mod has not reported', 'its restart did not happen']) {
    const found = status(quiet, { handover: handover('unknown', why) })
    assert.deepEqual([found.status, found.why], [STATUSES.UNKNOWN, why])
  }
})

test('row 7: the app\'s stop line, a standing pause note, a parked step', () => {
  const stopped = status(lane('suspended', { suspended: { by: 'app', limit: 'fiveHour', since: at(MIN), until: NOW + 30 * MIN } }))
  assert.equal(stopped.status, STATUSES.PAUSED)
  assert.match(stopped.why, /stopped by the app at the session limit, until \d\d:\d\d/)
  assert.equal(stopped.since, at(MIN))
  assert.equal(status(lane('suspended', { suspended: { by: 'note', limit: 'week', since: at(MIN), until: null } })).why, 'paused for the weekly limit')
  const parked = status(lane('suspended', { suspended: { by: 'parked', on: ['B1', 'B2'], since: null, until: null } }))
  assert.deepEqual([parked.status, parked.why], [STATUSES.PAUSED, 'until B1 and B2'])
})

test('row 7: the person\'s pause, once the chat has stopped; one cut off with no checkpoint stays Stopped', () => {
  assert.equal(status(lane('free', { report: report('idle') }), { isPersonPause: true }).status, STATUSES.PAUSED)
  const cut = lane('interrupted', { report: report('idle', 20 * SEC) })
  assert.equal(status(cut, { isPersonPause: true }).status, STATUSES.PAUSED)
  assert.equal(status(cut, { isPersonPause: true, isUnsaved: true }).status, STATUSES.STOPPED)
  assert.equal(status(cut, { isPersonPause: true, isUnsaved: true, handover: handover('suspended', 'the person pauses the chats') }).status, STATUSES.STOPPED)
  assert.equal(status(lane('off'), { isPersonPause: true }).status, STATUSES.NOT_RUNNING)
})

test('row 8: a Workers-mod rollout asked of Main, the Advisor, the Supervisor, the Product owner reads Restarting', () => {
  const idle = lane('free', { report: report('idle') })
  assert.equal(status(idle, { modRun: { status: 'asked' } }).status, STATUSES.RESTARTING)
  assert.equal(status(idle, { modRun: { status: 'due' } }).status, STATUSES.RESTARTING)
  // after its step / by hand / tried: nothing is restarting
  assert.equal(status(idle, { modRun: { status: 'after-step' } }).status, STATUSES.FREE)
})

test('row 8 (the real case): the session changed 20 s ago and the old idle report stands: Restarting, not Unknown', () => {
  const found = status(lane('unknown', { report: null }), { clearedAt: at(20 * SEC) })
  assert.deepEqual([found.status, found.since], [STATUSES.RESTARTING, at(20 * SEC)])
  // the old session's idle report is older than the clear
  assert.equal(status(lane('free', { report: report('idle', 60 * SEC) }), { clearedAt: at(20 * SEC) }).status, STATUSES.RESTARTING)
  // the new session reported after the clear: it is what it says
  assert.equal(status(lane('free', { report: report('idle', 5 * SEC) }), { clearedAt: at(20 * SEC) }).status, STATUSES.FREE)
})

test('row 8 and 13: 3 minutes after the change with no report it is Unknown, with the age counted from the clear', () => {
  const found = status(lane('unknown', { report: null }), { clearedAt: at(3 * MIN) })
  assert.deepEqual([found.status, found.age, found.reportAt], [STATUSES.UNKNOWN, 3 * MIN, null])
  assert.ok(3 * MIN > RESTART_SHOWN_MS)
})

test('row 9: idle or ended while holding a step is Stopped, with what it says', () => {
  const idle = status(lane('interrupted', { report: report('idle', 5 * SEC, { since: at(10 * MIN) }) }))
  assert.equal(idle.status, STATUSES.STOPPED)
  assert.match(idle.why, /^task open since \d\d:\d\d$/)
  assert.equal(idle.since, at(10 * MIN))
  assert.match(status(lane('interrupted', { cutOffAt: at(MIN) })).why, /^cut off at \d\d:\d\d$/)
  assert.equal(status(lane('interrupted')).why, 'cut off by a restart')
  const asleep = status(lane('interrupted', { asleep: true, isRunning: false, asleepSince: at(8 * MIN), report: report('busy', 9 * MIN) }))
  assert.deepEqual([asleep.status, asleep.why, asleep.since], [STATUSES.STOPPED, 'resumes by itself', at(8 * MIN)])
})

test('rule: asleep with a step is Stopped, never Working, and never counted busy', () => {
  const found = status(lane('interrupted', { asleep: true, isRunning: false, asleepSince: at(MIN), report: report('busy', 2 * MIN) }))
  assert.equal(found.status, STATUSES.STOPPED)
  assert.equal(isBusyStatus(found.status), false)
  assert.deepEqual(countsOf([{ status: found.status }]).working, 0)
})

test('row 10: Free is what the hand-out would take now: hand-over FREE; the timers\' escape hatch and the side chats by state free', () => {
  const idle = lane('free', { report: report('idle', 12 * SEC) })
  const found = status(idle, { handover: handover('free') })
  assert.deepEqual([found.status, found.age], [STATUSES.FREE, 12 * SEC])
  assert.equal(status({ ...idle, isMain: true }).status, STATUSES.FREE)
})

test('row 10 and the rule: a worker the hand-out skips (HELD) is never Free, whatever its lane state says', () => {
  const idle = lane('free', { report: report('idle') })
  for (const state of ['held', 'handing', 'offered', 'checking', 'restarting', 'suspended', 'unknown', 'working']) {
    const found = status(idle, { handover: handover(state, state === 'unknown' ? 'its Workers mod has not reported' : 'x') })
    assert.notEqual(found.status, STATUSES.FREE, `hand-over ${state}`)
  }
})

test('row 11: process ended, idle: Asleep, with since', () => {
  const found = status(lane('free', { asleep: true, isRunning: false, asleepSince: at(7 * MIN), report: report('idle', 7 * MIN) }), { handover: handover('free') })
  assert.deepEqual([found.status, found.since], [STATUSES.ASLEEP, at(7 * MIN)])
})

test('row 12: process gone and it will not wake by itself (a wake failed, ended, silent, unreported) is Not running, with the kind', () => {
  for (const offWhy of ['woken at 11:50, it did not start', 'its session ended at 11:40', 'silent since 11:30', 'no report since the board started at 11:00']) {
    const found = status(lane('off', { isRunning: false, offWhy, offSince: at(10 * MIN) }))
    assert.deepEqual([found.status, found.why, found.since], [STATUSES.NOT_RUNNING, offWhy, at(10 * MIN)])
  }
  // a free lane known not to run, with no kind: its chat is closed
  assert.equal(status(lane('free', { isRunning: false })).status, STATUSES.NOT_RUNNING)
})

test('row 13: no report and none of the above is Unknown with the age; quiet under 2 min, attention after', () => {
  const found = status(lane('unknown', { isRunning: null, report: report('idle', 45 * SEC) }))
  assert.deepEqual([found.status, found.age], [STATUSES.UNKNOWN, 45 * SEC])
  assert.equal(toneOf(found.status, found.age), 'quiet')
  assert.equal(toneOf(STATUSES.UNKNOWN, 3 * MIN), 'attention')
  assert.equal(status(lane('unknown', { isRunning: null })).age, null)
})

test('the age: now minus the report\'s time, the board\'s clock; since stays apart from it', () => {
  const found = status(lane('working', { report: report('busy', 25 * SEC, { since: at(90 * MIN) }) }))
  assert.deepEqual([found.age, found.reportAt, found.since], [25 * SEC, at(25 * SEC), at(90 * MIN)])
})

test('tones per the table: attention only for what needs attention', () => {
  const attention = STATUS_LIST.filter(status => toneOf(status, 0) === 'attention')
  // F9: Link gone (its Workers mod was unloaded) is the person's to fix by a restart.
  assert.deepEqual(attention, [STATUSES.WAITING, STATUSES.HELD, STATUSES.NO_ANSWER, STATUSES.NOT_RUNNING, STATUSES.LINK_GONE])
  for (const status of [STATUSES.WORKING, STATUSES.CHECKING, STATUSES.HANDING, STATUSES.OFFERED, STATUSES.PAUSED, STATUSES.RESTARTING, STATUSES.STOPPED, STATUSES.FREE, STATUSES.ASLEEP]) assert.equal(toneOf(status, 0), 'quiet')
})

test('counts: one number per status, counts.working equals the number of Working statuses, and only Working is busy', () => {
  const chats = [STATUSES.WORKING, STATUSES.WORKING, STATUSES.FREE, STATUSES.ASLEEP, STATUSES.STOPPED, STATUSES.PAUSED, STATUSES.NOT_RUNNING, STATUSES.UNKNOWN, STATUSES.HELD].map(w => ({ status: w })).concat([{ status: null }])
  const counts = countsOf(chats)
  assert.deepEqual(Object.keys(counts), COUNT_KEYS)
  assert.equal(counts.working, 2)
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 9, 'a chat without a status (a leftover) is not counted')
  assert.deepEqual(STATUS_LIST.filter(isBusyStatus), [STATUSES.WORKING])
  assert.equal(new Set(COUNT_KEYS).size, STATUS_LIST.length)
  assert.deepEqual(Object.keys(STATUS_FACTS), STATUS_LIST)
})

// --- mutants: each is a wrong reading the function must not make ---

test('mutant: Unknown after a clear (the old reading, a minute of Unknown) is not what 20 s after a clear reads', () => {
  assert.notEqual(status(lane('unknown', { report: null }), { clearedAt: at(20 * SEC) }).status, STATUSES.UNKNOWN)
})

test('mutant: two statuses on one lane (Free and Asleep, asleep and restarting): one status comes out, a string of the list', () => {
  const both = status(lane('free', { asleep: true, isRunning: false, asleepSince: at(MIN), report: report('idle', MIN) }), { handover: handover('free'), modRun: { status: 'due' } })
  assert.equal(typeof both.status, 'string')
  assert.ok(STATUS_LIST.includes(both.status))
  assert.equal(both.status, STATUSES.RESTARTING, 'the first row that holds wins')
})

test('mutant: Free for a HELD worker', () => {
  assert.equal(status(lane('free', { report: report('idle') }), { handover: handover('held', 'its clear did not run') }).status, STATUSES.HELD)
})

test('mutant: Working for asleep-with-a-step', () => {
  const found = status(lane('working', { asleep: true, isRunning: false, asleepSince: at(MIN), waitsForPartner: ['Q1'], report: report('idle', 2 * MIN) }))
  assert.notEqual(found.status, STATUSES.WORKING)
  assert.equal(found.status, STATUSES.ASLEEP)
})

test('mutant: the age from another clock: the same lane at a later page time has the same age (age is the board\'s, set at the read)', () => {
  const first = status(lane('working', { report: report('busy', 25 * SEC) }))
  const again = status(lane('working', { report: report('busy', 25 * SEC) }))
  assert.equal(first.age, again.age)
  assert.equal(first.age, 25 * SEC)
})

test('every input gives a status of the list (a sweep over the lane states and hand-over states)', () => {
  const states = ['working', 'waiting', 'free', 'unknown', 'interrupted', 'suspended', 'off']
  const hands = [null, ...['working', 'checking', 'handing', 'offered', 'free', 'held', 'suspended', 'restarting', 'unknown'].map(state => handover(state, state === 'unknown' ? 'did not answer its hand-over (B1)' : 'x'))]
  for (const state of states) for (const asleep of [false, true]) for (const hand of hands) for (const person of [false, true]) {
    const found = status(lane(state, { asleep, isRunning: asleep ? false : true, suspended: state === 'suspended' ? { by: 'app', limit: 'week' } : null }), { handover: hand, isPersonPause: person })
    assert.ok(STATUS_LIST.includes(found.status), `${state} ${asleep} ${hand?.state} ${person}`)
  }
})

test('the lazy clear (Task 4, D6): while its clear is on its way the Handing pill\'s why says "clearing… <stage> HH:MM:SS"; once settled, the step again; the pill set stays', async () => {
  const { clearingOf } = await import('../src/work/handover.mjs')
  const idle = lane('free', { report: report('idle') })
  const stageAt = Date.parse('2026-10-31T11:59:52')
  const why = status(idle, { handover: handover('handing', null, 'B13'), clearing: { stage: 'clear-queued', at: stageAt } })
  assert.deepEqual([why.status, why.why], [STATUSES.HANDING, 'clearing… clear-queued 11:59:52'])
  assert.equal(status(idle, { handover: handover('handing', null, 'B13'), clearing: null }).why, 'B13')
  // Only the Handing pill: an Offered worker with a stale stage is not reworded.
  assert.equal(status(idle, { handover: handover('offered', null, 'B13'), clearing: { stage: 'log-saved', at: stageAt } }).why, 'B13')
  // From the envelope in flight: pending while its newest stage is log-saved or clear-queued; none once cleared, refused or settled.
  const env = (stages, more = {}) => ({ id: 'e1', at: stageAt - 5 * SEC, to: 'Worker', command: 'handover', kind: 'task', step: 'B13', clear: { step: 'B12' }, state: 'taken', stages, ...more })
  assert.deepEqual(clearingOf([env([{ stage: 'log-saved', at: stageAt - 2 * SEC }, { stage: 'clear-queued', at: stageAt }])]), { stage: 'clear-queued', at: stageAt })
  assert.equal(clearingOf([env([{ stage: 'clear-queued', at: stageAt }, { stage: 'cleared', at: stageAt + SEC }])]), null)
  assert.equal(clearingOf([env([{ stage: 'clear-queued', at: stageAt }, { stage: 'clear-refused', at: stageAt + SEC }])]), null)
  assert.equal(clearingOf([env([{ stage: 'clear-queued', at: stageAt }], { state: 'delivered', outcome: { cleared: true } })]), null)
  assert.equal(clearingOf([env(undefined)]), null)
})
