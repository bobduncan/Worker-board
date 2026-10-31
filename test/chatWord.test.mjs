// Signals change 2: one word per chat (src/chatWord.mjs). One test per row of the brief's table and per rule, the real cases
// first; the mutants of the brief at the end (each is a way the function could go wrong, written as a case that must fail).
import test from 'node:test'
import assert from 'node:assert/strict'

import { COUNT_KEYS, RESTART_SHOWN_MS, WORDS, WORD_FACTS, WORD_LIST, countsOf, isBusyWord, toneOf, wordOf } from '../src/chatWord.mjs'

const NOW = Date.parse('2026-10-31T12:00:00')
const SEC = 1000
const MIN = 60 * SEC
const at = (ms = 0) => NOW - ms
const report = (state, agoMs = 2 * SEC, more = {}) => ({ state, since: at(agoMs + 60 * SEC), at: at(agoMs), background: false, mod: '0.27.0', ...more })
const lane = (state, more = {}) => ({ name: 'Worker', state, isRunning: true, asleep: false, report: null, suspended: null, ...more })
const word = (input, more = {}) => wordOf({ lane: input, now: NOW, ...more })
const handover = (state, why = null, step = null) => ({ state, why, step })

test('row 1: a fresh busy report is Working; background work after a reported step and a wait for the partner say why', () => {
  assert.equal(word(lane('working', { report: report('busy') })).word, WORDS.WORKING)
  assert.equal(word(lane('working', { report: report('idle'), heldBy: 'background' })).why, 'background')
  assert.equal(word(lane('working', { report: report('idle'), waitsForPartner: ['Q5'] })).why, 'waits for the partner')
})

test('row 1 and the rule: a fresh busy report beats a pause note read from a lagging transcript', () => {
  const noted = lane('suspended', { report: report('busy', 3 * SEC), suspended: { by: 'note', limit: 'fiveHour', since: at(5 * MIN), until: null } })
  assert.equal(word(noted).word, WORDS.WORKING)
  // the app's own stop line is kept: it stopped the turn
  assert.equal(word({ ...noted, suspended: { ...noted.suspended, by: 'app' } }).word, WORDS.PAUSED)
  // a busy report that is no longer fresh does not beat a note
  assert.equal(word({ ...noted, report: report('busy', 3 * MIN) }).word, WORDS.PAUSED)
})

test('row 1: a fresh busy report beats the person\'s pause and a hand-over SUSPENDED while the turn runs', () => {
  const running = lane('working', { report: report('busy') })
  assert.equal(word(running, { handover: handover('suspended', 'the person pauses the chats'), isPersonPause: true }).word, WORDS.WORKING)
})

test('row 2: asking, or a blocking ask open, is Waiting for you (also when asleep)', () => {
  assert.equal(word(lane('waiting', { report: report('asking') })).word, WORDS.WAITING)
  assert.equal(word(lane('waiting', { asleep: true, isRunning: false, report: report('idle', 10 * MIN) })).word, WORDS.WAITING)
})

test('rows 3 to 6: a worker in each hand-over state reads the right word, with the step or the why', () => {
  const idle = lane('free', { report: report('idle') })
  assert.deepEqual(word(idle, { handover: handover('checking', null, 'B12') }), { word: WORDS.CHECKING, why: 'B12', since: null, reportAt: at(2 * SEC), age: 2 * SEC })
  assert.deepEqual([word(idle, { handover: handover('handing', null, 'B13') }).word, word(idle, { handover: handover('handing', null, 'B13') }).why], [WORDS.HANDING, 'B13'])
  assert.equal(word(idle, { handover: handover('offered', null, 'B13') }).word, WORDS.OFFERED)
  assert.deepEqual([word(idle, { handover: handover('held', 'its clear did not run: x') }).word, word(idle, { handover: handover('held', 'its clear did not run: x') }).why], [WORDS.HELD, 'its clear did not run: x'])
  const unanswered = word(idle, { handover: handover('unknown', 'did not answer its hand-over (B13)', 'B13') })
  assert.deepEqual([unanswered.word, unanswered.why], [WORDS.NO_ANSWER, 'B13'])
  assert.equal(word(idle, { handover: handover('restarting') }).word, WORDS.RESTARTING)
  assert.equal(word(idle, { handover: handover('suspended', 'a usage limit is full') }).word, WORDS.PAUSED)
})

test('rows 3 to 6 only apply to a worker on the hand-over: with no hand-over (the escape hatch) a free lane is Free', () => {
  const idle = lane('free', { report: report('idle') })
  assert.equal(word(idle, { handover: null }).word, WORDS.FREE)
})

test('row 6 and 13: the other UNKNOWN whys of the hand-over (mod not reported, does not run, restart late) are Unknown, not "Did not answer"', () => {
  const quiet = lane('unknown')
  for (const why of ['its Workers mod has not reported', 'its restart did not happen']) {
    const found = word(quiet, { handover: handover('unknown', why) })
    assert.deepEqual([found.word, found.why], [WORDS.UNKNOWN, why])
  }
})

test('row 7: the app\'s stop line, a standing pause note, a parked step', () => {
  const stopped = word(lane('suspended', { suspended: { by: 'app', limit: 'fiveHour', since: at(MIN), until: NOW + 30 * MIN } }))
  assert.equal(stopped.word, WORDS.PAUSED)
  assert.match(stopped.why, /stopped by the app at the session limit, until \d\d:\d\d/)
  assert.equal(stopped.since, at(MIN))
  assert.equal(word(lane('suspended', { suspended: { by: 'note', limit: 'week', since: at(MIN), until: null } })).why, 'paused for the weekly limit')
  const parked = word(lane('suspended', { suspended: { by: 'parked', on: ['B1', 'B2'], since: null, until: null } }))
  assert.deepEqual([parked.word, parked.why], [WORDS.PAUSED, 'until B1 and B2'])
})

test('row 7: the person\'s pause, once the chat has stopped; one cut off with no checkpoint stays Stopped', () => {
  assert.equal(word(lane('free', { report: report('idle') }), { isPersonPause: true }).word, WORDS.PAUSED)
  const cut = lane('interrupted', { report: report('idle', 20 * SEC) })
  assert.equal(word(cut, { isPersonPause: true }).word, WORDS.PAUSED)
  assert.equal(word(cut, { isPersonPause: true, isUnsaved: true }).word, WORDS.STOPPED)
  assert.equal(word(cut, { isPersonPause: true, isUnsaved: true, handover: handover('suspended', 'the person pauses the chats') }).word, WORDS.STOPPED)
  assert.equal(word(lane('off'), { isPersonPause: true }).word, WORDS.NOT_RUNNING)
})

test('row 8: a Workers-mod rollout asked of Main, the Advisor, the Supervisor, the Product owner reads Restarting', () => {
  const idle = lane('free', { report: report('idle') })
  assert.equal(word(idle, { modRun: { status: 'asked' } }).word, WORDS.RESTARTING)
  assert.equal(word(idle, { modRun: { status: 'due' } }).word, WORDS.RESTARTING)
  // after its step / by hand / tried: nothing is restarting
  assert.equal(word(idle, { modRun: { status: 'after-step' } }).word, WORDS.FREE)
})

test('row 8 (the real case): the session changed 20 s ago and the old idle report stands: Restarting, not Unknown', () => {
  const found = word(lane('unknown', { report: null }), { clearedAt: at(20 * SEC) })
  assert.deepEqual([found.word, found.since], [WORDS.RESTARTING, at(20 * SEC)])
  // the old session's idle report is older than the clear
  assert.equal(word(lane('free', { report: report('idle', 60 * SEC) }), { clearedAt: at(20 * SEC) }).word, WORDS.RESTARTING)
  // the new session reported after the clear: it is what it says
  assert.equal(word(lane('free', { report: report('idle', 5 * SEC) }), { clearedAt: at(20 * SEC) }).word, WORDS.FREE)
})

test('row 8 and 13: 3 minutes after the change with no report it is Unknown, with the age counted from the clear', () => {
  const found = word(lane('unknown', { report: null }), { clearedAt: at(3 * MIN) })
  assert.deepEqual([found.word, found.age, found.reportAt], [WORDS.UNKNOWN, 3 * MIN, null])
  assert.ok(3 * MIN > RESTART_SHOWN_MS)
})

test('row 9: idle or ended while holding a step is Stopped, with what it says', () => {
  const idle = word(lane('interrupted', { report: report('idle', 5 * SEC, { since: at(10 * MIN) }) }))
  assert.equal(idle.word, WORDS.STOPPED)
  assert.match(idle.why, /^task open since \d\d:\d\d$/)
  assert.equal(idle.since, at(10 * MIN))
  assert.match(word(lane('interrupted', { cutOffAt: at(MIN) })).why, /^cut off at \d\d:\d\d$/)
  assert.equal(word(lane('interrupted')).why, 'cut off by a restart')
  const asleep = word(lane('interrupted', { asleep: true, isRunning: false, asleepSince: at(8 * MIN), report: report('busy', 9 * MIN) }))
  assert.deepEqual([asleep.word, asleep.why, asleep.since], [WORDS.STOPPED, 'resumes by itself', at(8 * MIN)])
})

test('rule: asleep with a step is Stopped, never Working, and never counted busy', () => {
  const found = word(lane('interrupted', { asleep: true, isRunning: false, asleepSince: at(MIN), report: report('busy', 2 * MIN) }))
  assert.equal(found.word, WORDS.STOPPED)
  assert.equal(isBusyWord(found.word), false)
  assert.deepEqual(countsOf([{ word: found.word }]).working, 0)
})

test('row 10: Free is what the hand-out would take now: hand-over FREE; the timers\' escape hatch and the side chats by state free', () => {
  const idle = lane('free', { report: report('idle', 12 * SEC) })
  const found = word(idle, { handover: handover('free') })
  assert.deepEqual([found.word, found.age], [WORDS.FREE, 12 * SEC])
  assert.equal(word({ ...idle, isMain: true }).word, WORDS.FREE)
})

test('row 10 and the rule: a worker the hand-out skips (HELD) is never Free, whatever its lane state says', () => {
  const idle = lane('free', { report: report('idle') })
  for (const state of ['held', 'handing', 'offered', 'checking', 'restarting', 'suspended', 'unknown', 'working']) {
    const found = word(idle, { handover: handover(state, state === 'unknown' ? 'its Workers mod has not reported' : 'x') })
    assert.notEqual(found.word, WORDS.FREE, `hand-over ${state}`)
  }
})

test('row 11: process ended, idle: Asleep, with since', () => {
  const found = word(lane('free', { asleep: true, isRunning: false, asleepSince: at(7 * MIN), report: report('idle', 7 * MIN) }), { handover: handover('free') })
  assert.deepEqual([found.word, found.since], [WORDS.ASLEEP, at(7 * MIN)])
})

test('row 12: process gone and it will not wake by itself (a wake failed, ended, silent, unreported) is Not running, with the kind', () => {
  for (const offWhy of ['woken at 11:50, it did not start', 'its session ended at 11:40', 'silent since 11:30', 'no report since the board started at 11:00']) {
    const found = word(lane('off', { isRunning: false, offWhy, offSince: at(10 * MIN) }))
    assert.deepEqual([found.word, found.why, found.since], [WORDS.NOT_RUNNING, offWhy, at(10 * MIN)])
  }
  // a free lane known not to run, with no kind: its chat is closed
  assert.equal(word(lane('free', { isRunning: false })).word, WORDS.NOT_RUNNING)
})

test('row 13: no report and none of the above is Unknown with the age; quiet under 2 min, attention after', () => {
  const found = word(lane('unknown', { isRunning: null, report: report('idle', 45 * SEC) }))
  assert.deepEqual([found.word, found.age], [WORDS.UNKNOWN, 45 * SEC])
  assert.equal(toneOf(found.word, found.age), 'quiet')
  assert.equal(toneOf(WORDS.UNKNOWN, 3 * MIN), 'attention')
  assert.equal(word(lane('unknown', { isRunning: null })).age, null)
})

test('the age: now minus the report\'s time, the board\'s clock; since stays apart from it', () => {
  const found = word(lane('working', { report: report('busy', 25 * SEC, { since: at(90 * MIN) }) }))
  assert.deepEqual([found.age, found.reportAt, found.since], [25 * SEC, at(25 * SEC), at(90 * MIN)])
})

test('tones per the table: attention only for what needs attention', () => {
  const attention = WORD_LIST.filter(word => toneOf(word, 0) === 'attention')
  assert.deepEqual(attention, [WORDS.WAITING, WORDS.HELD, WORDS.NO_ANSWER, WORDS.NOT_RUNNING])
  for (const word of [WORDS.WORKING, WORDS.CHECKING, WORDS.HANDING, WORDS.OFFERED, WORDS.PAUSED, WORDS.RESTARTING, WORDS.STOPPED, WORDS.FREE, WORDS.ASLEEP]) assert.equal(toneOf(word, 0), 'quiet')
})

test('counts: one number per word, counts.working equals the number of Working words, and only Working is busy', () => {
  const chats = [WORDS.WORKING, WORDS.WORKING, WORDS.FREE, WORDS.ASLEEP, WORDS.STOPPED, WORDS.PAUSED, WORDS.NOT_RUNNING, WORDS.UNKNOWN, WORDS.HELD].map(w => ({ word: w })).concat([{ word: null }])
  const counts = countsOf(chats)
  assert.deepEqual(Object.keys(counts), COUNT_KEYS)
  assert.equal(counts.working, 2)
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 9, 'a chat without a word (a leftover) is not counted')
  assert.deepEqual(WORD_LIST.filter(isBusyWord), [WORDS.WORKING])
  assert.equal(new Set(COUNT_KEYS).size, WORD_LIST.length)
  assert.deepEqual(Object.keys(WORD_FACTS), WORD_LIST)
})

// --- mutants: each is a wrong reading the function must not make ---

test('mutant: Unknown after a clear (the old reading, a minute of Unknown) is not what 20 s after a clear reads', () => {
  assert.notEqual(word(lane('unknown', { report: null }), { clearedAt: at(20 * SEC) }).word, WORDS.UNKNOWN)
})

test('mutant: two words on one lane (Free and Asleep, asleep and restarting): one word comes out, a string of the list', () => {
  const both = word(lane('free', { asleep: true, isRunning: false, asleepSince: at(MIN), report: report('idle', MIN) }), { handover: handover('free'), modRun: { status: 'due' } })
  assert.equal(typeof both.word, 'string')
  assert.ok(WORD_LIST.includes(both.word))
  assert.equal(both.word, WORDS.RESTARTING, 'the first row that holds wins')
})

test('mutant: Free for a HELD worker', () => {
  assert.equal(word(lane('free', { report: report('idle') }), { handover: handover('held', 'its clear did not run') }).word, WORDS.HELD)
})

test('mutant: Working for asleep-with-a-step', () => {
  const found = word(lane('working', { asleep: true, isRunning: false, asleepSince: at(MIN), waitsForPartner: ['Q1'], report: report('idle', 2 * MIN) }))
  assert.notEqual(found.word, WORDS.WORKING)
  assert.equal(found.word, WORDS.ASLEEP)
})

test('mutant: the age from another clock: the same lane at a later page time has the same age (age is the board\'s, set at the read)', () => {
  const first = word(lane('working', { report: report('busy', 25 * SEC) }))
  const again = word(lane('working', { report: report('busy', 25 * SEC) }))
  assert.equal(first.age, again.age)
  assert.equal(first.age, 25 * SEC)
})

test('every input gives a word of the list (a sweep over the lane states and hand-over states)', () => {
  const states = ['working', 'waiting', 'free', 'unknown', 'interrupted', 'suspended', 'off']
  const hands = [null, ...['working', 'checking', 'handing', 'offered', 'free', 'held', 'suspended', 'restarting', 'unknown'].map(state => handover(state, state === 'unknown' ? 'did not answer its hand-over (B1)' : 'x'))]
  for (const state of states) for (const asleep of [false, true]) for (const hand of hands) for (const person of [false, true]) {
    const found = word(lane(state, { asleep, isRunning: asleep ? false : true, suspended: state === 'suspended' ? { by: 'app', limit: 'week' } : null }), { handover: hand, isPersonPause: person })
    assert.ok(WORD_LIST.includes(found.word), `${state} ${asleep} ${hand?.state} ${person}`)
  }
})
