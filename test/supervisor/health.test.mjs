// The supervisor's Task 5: the health summary and the work tool's `health` (spec 2026-10-24, "The AI sweep" and "The
// supervisor chat"). The supervisor chat reads `work health`, a plain summary of at most 8000 characters: each chat's
// state and since when, its model and effort beside its step's, its last report and last clear; the steps under way;
// the queues; the repairs and incidents of the last day; the words not delivered; the limits. Only the chat of role
// supervisor (the list of chats' "supervisor") may read it. Made-up samples only; no word names a project.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { answer } from '../../fixtures/lines.mjs'
import { parseList } from '../../src/appChats.mjs'
import { checkTake, laneRole } from '../../src/bridge.mjs'
import { parseConfig } from '../../src/config.mjs'
import { checkSay } from '../../src/say.mjs'
import { buildState } from '../../src/state.mjs'
import { createSupervisor } from '../../src/supervisor/index.mjs'
import { HEALTH_CHARS, healthSummary } from '../../src/supervisor/health.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { workApi } from '../../src/work/api.mjs'
import { migrateBacklog, stamp } from '../../src/work/migrate.mjs'
import { writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = new Date(2026, 9, 24, 11, 0).getTime()
const ago = minutes => NOW - minutes * MIN

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const step = (id, state, more = {}, sections = {}) => item({ Id: id, Kind: 'step', Title: `Step ${id} of the garden`, State: state, Since: stamp(ago(30)), ...more }, sections)
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, state: 'free', isRunning: true, model: 'claude-sonnet-5-5', effort: 'medium', queue: [], compaction: null, task: null, ...more })

/** A board of made-up chats, steps, words and limits, with something odd in each section. */
function fixture() {
  const state = {
    chats: [
      lane('Lead', { isMain: true, state: 'working' }),
      lane('Digger', {
        state: 'working', task: { stepId: 'B12', text: 'B12 Plant the beds' },
        compaction: { kind: 'skipped', at: ago(50), why: 'it is small enough', notCleared: { at: ago(50), why: 'a subagent it started still runs (1)' } },
        queue: [{ id: 'B14', why: { reason: 'busy' } }, { id: 'B15', why: null }],
      }),
      lane('Weeder', { state: 'unknown', isRunning: false, compaction: { kind: 'cleared', at: ago(90), step: 'B10' } }),
    ],
    advisor: lane('Partner', { state: 'free' }),
    advisorHelper: null,
    chatPrefix: '',
    today: [{ chat: 'Weeder', spans: [{ from: ago(25), to: NOW, state: 'unknown' }] }],
  }
  const store = items(
    step('B10', 'review', { Owner: 'Weeder', Since: stamp(ago(95)) }, { History: [`- ${stamp(ago(95))} Weeder: in progress → review`] }),
    step('B12', 'in progress', { Owner: 'Digger', Since: stamp(ago(200)) }, { Model: ['opus: the beds\' layout is a design call'], Effort: ['high: the layout'] }),
    step('B13', 'taken', { Owner: 'Weeder', Since: stamp(ago(40)) }),
    step('B14', 'queued', { Owner: 'Digger' }),
    step('B15', 'queued', { Owner: 'Digger' }),
    step('B20', 'refined'),
    step('B21', 'new'),
    step('B9', 'done', { Owner: 'Digger' }),
    item({ Id: 'X1', Kind: 'incident', Title: 'Weeder unknown for 25 min, B13 waits', State: 'open', Source: 'unknown-lane', Subject: 'Weeder', Key: 'unknown-lane Weeder', Since: stamp(ago(15)), 'First seen': stamp(ago(15)), 'Last seen': stamp(ago(3)), Count: '5', Evidence: 'state unknown since 10:35' }),
  )
  const outbox = [
    { id: 'w1', at: ago(14), to: 'Weeder', command: 'work', about: 'B13', state: 'waiting' },
    { id: 'w2', at: ago(2), to: 'Digger', command: 'work', about: 'B12', state: 'delivered' },
  ]
  const limits = { fiveHour: { used: 64, level: 'ok', at: ago(5), resetsAt: NOW + 2 * HOUR }, week: { used: 41, level: 'ok', at: ago(5), resetsAt: null } }
  const repairs = [{ at: ago(30), rule: 'limit-back', subject: 'Weeder', key: 'limit-back Weeder' }]
  return buildView({ state, items: store, outbox, limits, pause: { state: 'running', since: ago(600) }, repairs, now: NOW })
}

test('B544 (X9): a chat\'s effort reads as its level, never "[object Object]"; a shape it does not know reads "effort not known"', () => {
  const view = buildView({
    state: {
      chats: [lane('Lead', { isMain: true }), lane('Digger', { effort: { level: 'high', why: 'the layout', isSet: true } }), lane('Weeder', { effort: { odd: true } })],
      // The partner as state.mjs gives it: the app's level in appEffort, its high effort mode in effort.
      advisor: lane('Partner', { model: 'claude-opus-5-5', appEffort: 'xhigh', effort: { mode: 'usual', runsOn: null, isSet: true } }),
      chatPrefix: '',
    },
    now: NOW,
  })
  const text = healthSummary(view, NOW)
  const line = name => text.split('\n').find(one => one.includes(`${name} (`)) ?? ''
  assert.doesNotMatch(text, /object Object/)
  assert.match(line('Partner'), /runs opus · xhigh;/)
  assert.match(line('Digger'), /runs sonnet · high;/)
  assert.match(line('Weeder'), /runs sonnet · effort not known;/)
  assert.match(line('Lead'), /runs sonnet · medium;/)
})

test('B560 (X17): a result check\'s fix queued behind its busy builder says it stays with that builder; a plain queued step keeps its line', () => {
  const view = buildView({
    state: { chats: [lane('Lead', { isMain: true }), lane('Digger', { state: 'working', task: { stepId: 'B12', text: 'x' } }), lane('Weeder')], chatPrefix: '' },
    items: items(
      step('B12', 'in progress', { Owner: 'Digger' }),
      step('B8', 'review', { Owner: 'Digger' }),
      step('B30', 'queued', { Owner: 'Digger', Priority: 'fix', 'Fix of': 'B8', Since: stamp(ago(25)) }),
      step('B31', 'queued', { Owner: 'Digger', Since: stamp(ago(25)) }),
      // A fix queued for another chat than the step's builder stays a plain queued step.
      step('B32', 'queued', { Owner: 'Weeder', 'Fix of': 'B8', Since: stamp(ago(25)) }),
    ),
    now: NOW,
  })
  const text = healthSummary(view, NOW)
  assert.match(text, /^- B30 queued for 25 min \(stays with Digger: fix of B8\), Digger, board fix: Step B30 of the garden$/m)
  assert.match(text, /^- B31 queued for 25 min, Digger: Step B31 of the garden$/m)
  assert.match(text, /^- B32 queued for 25 min, Weeder: Step B32 of the garden$/m)
})

/** X15's board: B531 queued for Worker 5, Blocked by B522 that Worker 5 holds; Workers 1, 2 and 4 free. */
function waitingBoard(blocker, more = []) {
  return buildView({
    state: {
      chats: [lane('Lead', { isMain: true }), lane('Worker 1'), lane('Worker 2'), lane('Worker 4'), lane('Worker 5', { state: 'working', task: { stepId: 'B522', text: 'x' } })],
      chatPrefix: '',
    },
    items: items(blocker, step('B531', 'queued', { Owner: 'Worker 5', 'Blocked by': 'B522', Since: stamp(ago(275)) }), ...more),
    now: NOW,
  })
}
const lineOfStep = (text, id) => text.split('\n').find(one => one.startsWith(`- ${id} `) || one.startsWith(`- ! ${id} `)) ?? ''

test('B561 (X15): a queued step that waits for an open step waits as planned: no "!" for its age, its blocker with state and age', () => {
  const text = healthSummary(waitingBoard(step('B522', 'in progress', { Owner: 'Worker 5', Since: stamp(ago(83)) })), NOW)
  assert.equal(lineOfStep(text, 'B531'), '- B531 queued for 4 h 35 min, Worker 5 (waits as planned for B522 (in progress 1 h 23 min)): Step B531 of the garden')
  // The same through `Waits for` words that name the step (the main chat's "after").
  const words = buildView({
    state: { chats: [lane('Lead', { isMain: true }), lane('Worker 5', { state: 'working', task: { stepId: 'B522', text: 'x' } })], chatPrefix: '' },
    items: items(step('B522', 'in progress', { Owner: 'Worker 5', Since: stamp(ago(83)) }), step('B531', 'queued', { Owner: 'Worker 5', 'Waits for': 'B522 merged', Since: stamp(ago(275)) })),
    now: NOW,
  })
  assert.match(lineOfStep(healthSummary(words, NOW), 'B531'), /^- B531 queued for 4 h 35 min, Worker 5 \(waits as planned for B522 \(in progress 1 h 23 min\)\)/)
})

test('B561: a waiting step stays odd when its blocker stalls past its limit, or has ended while the step is still blocked', () => {
  const stalled = healthSummary(waitingBoard(step('B522', 'in progress', { Owner: 'Worker 5', Since: stamp(ago(190)) })), NOW)
  assert.equal(lineOfStep(stalled, 'B531'), '- ! B531 queued for 4 h 35 min, Worker 5 (waits for B522 (in progress 3 h 10 min, stalled)): Step B531 of the garden')
  const done = healthSummary(waitingBoard(step('B522', 'done', { Owner: 'Worker 5', Since: stamp(ago(83)) })), NOW)
  assert.equal(lineOfStep(done, 'B531'), '- ! B531 queued for 4 h 35 min, Worker 5 (still blocked by B522, done): Step B531 of the garden')
  const dropped = healthSummary(waitingBoard(step('B522', 'dropped', { Since: stamp(ago(83)) })), NOW)
  assert.match(lineOfStep(dropped, 'B531'), /^- ! B531 .*\(still blocked by B522, dropped\)/)
})

test('B561: a chain of planned waits is quiet; a blocker that waits as planned itself is no stalled blocker; a loop is', () => {
  // B522 is queued 3 h behind B520, which moves: B522 waits as planned, so B531 does too.
  const chain = healthSummary(waitingBoard(step('B522', 'queued', { Owner: 'Worker 5', 'Blocked by': 'B520', Since: stamp(ago(180)) }), [step('B520', 'in progress', { Owner: 'Worker 5', Since: stamp(ago(60)) })]), NOW)
  assert.match(lineOfStep(chain, 'B531'), /^- B531 queued for 4 h 35 min, Worker 5 \(waits as planned for B522 \(queued 3 h\)\)/)
  assert.match(lineOfStep(chain, 'B522'), /^- B522 queued for 3 h, Worker 5 \(waits as planned for B520 \(in progress 1 h\)\)/)
  // Two steps that wait for each other wait for nothing that moves.
  const loop = healthSummary(waitingBoard(step('B522', 'queued', { Owner: 'Worker 5', 'Blocked by': 'B531', Since: stamp(ago(180)) })), NOW)
  assert.match(lineOfStep(loop, 'B531'), /^- ! B531 .*\(waits for B522 \(queued 3 h, stalled\)\)/)
})

test('B561: a result check\'s fix that stays with its busy builder is quiet for its age; with its builder free it is odd', () => {
  const board = builderState => buildView({
    state: { chats: [lane('Lead', { isMain: true }), lane('Digger', builderState), lane('Weeder')], chatPrefix: '' },
    items: items(
      step('B8', 'review', { Owner: 'Digger' }),
      step('B30', 'queued', { Owner: 'Digger', Priority: 'fix', 'Fix of': 'B8', Since: stamp(ago(180)) }),
      ...(builderState.task ? [step('B12', 'in progress', { Owner: 'Digger', Since: stamp(ago(60)) })] : []),
    ),
    now: NOW,
  })
  const busy = healthSummary(board({ state: 'working', task: { stepId: 'B12', text: 'x' } }), NOW)
  assert.equal(lineOfStep(busy, 'B30'), '- B30 queued for 3 h (stays with Digger: fix of B8), Digger, board fix: Step B30 of the garden')
  const free = healthSummary(board({ state: 'free' }), NOW)
  assert.equal(lineOfStep(free, 'B30'), '- ! B30 queued for 3 h (stays with Digger: fix of B8), Digger, board fix: Step B30 of the garden')
})

/** A step in review whose board check passed `minutes` ago, with agreed points (so it needs a result check). */
const checkPassed = minutes => `- ${stamp(ago(minutes))} server: check passed: merged`
const inReview = (id, minutes, history = [], more = {}) => step(id, 'review', { Since: stamp(ago(minutes)), ...more }, { 'What we build': ['- a lamp at every bench'], History: [checkPassed(minutes), ...history] })
const askOf = (id, of, state = 'open') => item({ Id: id, Kind: 'ask', Title: `Ask ${id}`, State: state, Of: of, Since: stamp(ago(50)) })
/** X19's board: B510 waits for the person's answer to Q339, B532 for its fix B548 queued for Worker 5. */
function x19Board(more = [], settings = {}) {
  return buildView({
    state: { chats: [lane('Lead', { isMain: true }), lane('Worker 2'), lane('Worker 5')], chatPrefix: '' },
    items: items(
      inReview('B510', 65, [`- ${stamp(ago(60))} Checker: result check waits for you: 2 of 3 points pass`], { Owner: 'Worker 2' }),
      askOf('Q339', 'B510'),
      inReview('B532', 105, [`- ${stamp(ago(100))} Checker: result check failed: 1 of 2 points pass; fix B548 for Worker 5`], { Owner: 'Worker 5' }),
      step('B548', 'queued', { Owner: 'Worker 5', Priority: 'fix', 'Fix of': 'B532', Since: stamp(ago(100)) }),
      ...more,
    ),
    settings,
    now: NOW,
  })
}

test('B563 (X19): a step in review that waits for the person\'s answer or for its open fix says so, with no "!" for its age', () => {
  const text = healthSummary(x19Board(), NOW)
  assert.equal(lineOfStep(text, 'B510'), '- B510 review for 1 h 5 min, Worker 2 (waits for your answer to its check): Step B510 of the garden')
  assert.equal(lineOfStep(text, 'B532'), '- B532 review for 1 h 45 min, Worker 5 (waits for its fix B548 (queued, Worker 5)): Step B532 of the garden')
})

test('B563: a step in review that waits for its check past reviewMinutes is odd; within it, quiet; it names the check it waits for', () => {
  const first = healthSummary(x19Board([inReview('B540', 75, [], { Owner: 'Worker 2' })]), NOW)
  assert.equal(lineOfStep(first, 'B540'), '- ! B540 review for 1 h 15 min, Worker 2 (waits for its first check, check asked 09:45, no check word yet): Step B540 of the garden')
  // The same wait under a longer reviewMinutes is no "!".
  assert.equal(lineOfStep(healthSummary(x19Board([inReview('B540', 75, [], { Owner: 'Worker 2' })], { reviewMinutes: 90 }), NOW), 'B540'), '- B540 review for 1 h 15 min, Worker 2 (waits for its first check, check asked 09:45, no check word yet): Step B540 of the garden')
  // The ask answered: it waits for its check again, counted from that check, not from its review.
  const again = healthSummary(buildView({
    state: { chats: [lane('Lead', { isMain: true }), lane('Worker 2')], chatPrefix: '' },
    items: items(inReview('B510', 200, [`- ${stamp(ago(30))} Checker: result check waits for you: 2 of 3 points pass`], { Owner: 'Worker 2' }), askOf('Q339', 'B510', 'answered')),
    now: NOW,
  }), NOW)
  assert.equal(lineOfStep(again, 'B510'), '- B510 review for 3 h 20 min, Worker 2 (waits for its check again, check asked 10:30, no check word yet): Step B510 of the garden')
})

test('B585 (X33): a first check counts from the board check that asked it, and the line names the check word and its state', () => {
  // B522: in review since 21:41 (here 75 min ago), its board check passed at 22:04 (52 min ago), the word to the partner delivered.
  const b522 = step('B522', 'review', { Owner: 'Worker 2', Since: stamp(ago(75)) }, {
    'What we build': ['- a lamp at every bench'],
    History: [`- ${stamp(ago(75))} Worker 2: in progress → review`, `- ${stamp(ago(74))} server: check failed: no tests bite`, `- ${stamp(ago(53))} Worker 2: reported again`, checkPassed(52)],
  })
  const board = outbox => buildView({
    state: { chats: [lane('Lead', { isMain: true }), lane('Worker 2')], chatPrefix: '' },
    items: items(b522), outbox, now: NOW,
  })
  const word = { id: 'w9', command: 'result-check', about: 'B522', to: 'Partner', at: ago(52), state: 'delivered' }
  assert.equal(lineOfStep(healthSummary(board([word]), NOW), 'B522'), '- B522 review for 1 h 15 min, Worker 2 (waits for its first check, check asked 10:08, word to Partner (delivered)): Step B522 of the garden')
  // A word from before the check was asked is not its word.
  assert.equal(lineOfStep(healthSummary(board([{ ...word, at: ago(70) }]), NOW), 'B522'), '- B522 review for 1 h 15 min, Worker 2 (waits for its first check, check asked 10:08, no check word yet): Step B522 of the garden')
})

test('B563: a step in review whose fix was dropped is odd; so is one whose open fix is odd itself', () => {
  const dropped = healthSummary(buildView({
    state: { chats: [lane('Lead', { isMain: true }), lane('Worker 5')], chatPrefix: '' },
    items: items(
      inReview('B532', 20, [`- ${stamp(ago(15))} Checker: result check failed: 1 of 2 points pass; fix B548 for Worker 5`], { Owner: 'Worker 5' }),
      step('B548', 'dropped', { Owner: 'Worker 5', 'Fix of': 'B532', Since: stamp(ago(10)) }),
    ),
    now: NOW,
  }), NOW)
  assert.equal(lineOfStep(dropped, 'B532'), '- ! B532 review for 20 min, Worker 5 (its fix B548 was dropped): Step B532 of the garden')
  // Its fix stalled in progress for 4 h: the step it fixes is odd with it.
  const stalled = healthSummary(buildView({
    state: { chats: [lane('Lead', { isMain: true }), lane('Worker 5', { state: 'working', task: { stepId: 'B548', text: 'x' } })], chatPrefix: '' },
    items: items(
      inReview('B532', 300, [`- ${stamp(ago(290))} Checker: result check failed: 1 of 2 points pass; fix B548 for Worker 5`], { Owner: 'Worker 5' }),
      step('B548', 'in progress', { Owner: 'Worker 5', 'Fix of': 'B532', Since: stamp(ago(240)) }),
    ),
    now: NOW,
  }), NOW)
  assert.equal(lineOfStep(stalled, 'B532'), '- ! B532 review for 5 h, Worker 5 (waits for its fix B548 (in progress, Worker 5)): Step B532 of the garden')
  // Its fix queued for a chat that is gone: odd too.
  const gone = healthSummary(buildView({
    state: { chats: [lane('Lead', { isMain: true }), lane('Worker 5')], chatPrefix: '' },
    items: items(
      inReview('B532', 100, [`- ${stamp(ago(90))} Checker: result check failed: 1 of 2 points pass; fix B548 for Somebody gone`], { Owner: 'Worker 5' }),
      step('B548', 'queued', { Owner: 'Somebody gone', 'Fix of': 'B532', Since: stamp(ago(20)) }),
    ),
    now: NOW,
  }), NOW)
  assert.match(lineOfStep(gone, 'B532'), /^- ! B532 review for 1 h 40 min, Worker 5 \(waits for its fix B548 \(queued, Somebody gone\)\)/)
})

/** X18's board at 20:23: Lead's last report B301 at 22:29 the day before, and a time of another day in every section. */
const X18_NOW = new Date(2026, 9, 24, 20, 23).getTime()
const yesterday = (hours, minutes) => new Date(2026, 9, 23, hours, minutes).getTime()
const today = (hours, minutes) => new Date(2026, 9, 24, hours, minutes).getTime()
function x18Board({ reportAt = yesterday(22, 29) } = {}) {
  return buildView({
    state: {
      chats: [
        lane('Lead', { isMain: true, compaction: { kind: 'cleared', at: yesterday(22, 40), step: 'B301' } }),
        lane('Digger', { state: 'suspended', suspended: { limit: '5-hour limit', until: new Date(2026, 9, 25, 1, 10).getTime() }, compaction: { kind: 'compacted', at: yesterday(21, 5), notCleared: { at: yesterday(21, 5), why: 'a subagent still runs' } } }),
        lane('Weeder', { state: 'unknown', compaction: { kind: 'skipped', at: today(19, 50), why: 'small enough' } }),
      ],
      chatPrefix: '',
      today: [{ chat: 'Digger', spans: [{ from: yesterday(23, 15), to: X18_NOW, state: 'suspended' }] }, { chat: 'Weeder', spans: [{ from: today(20, 3), to: X18_NOW, state: 'unknown' }] }],
    },
    items: items(
      step('B301', 'done', { Owner: 'Lead', Since: stamp(reportAt) }, { History: [`- ${stamp(reportAt)} Lead: in progress → review`] }),
      step('B302', 'review', { Owner: 'Weeder', Since: stamp(today(19, 40)) }, { History: [`- ${stamp(today(19, 40))} Weeder: in progress → review`] }),
      item({ Id: 'X18', Kind: 'incident', Title: 'a time in the future', State: 'open', Source: 'sweep', Key: 'time Lead', Since: stamp(yesterday(23, 0)), 'First seen': stamp(yesterday(23, 0)), 'Last seen': stamp(today(20, 20)), Count: '2' }),
    ),
    limits: { fiveHour: { used: 97, level: 'full', at: today(20, 20), resetsAt: new Date(2026, 9, 25, 1, 10).getTime() }, week: { used: 41, level: 'ok', at: yesterday(23, 50), resetsAt: today(23, 0) } },
    pause: { state: 'running', since: yesterday(8, 0) },
    repairs: [{ at: yesterday(22, 30), rule: 'limit-back', subject: 'Digger', key: 'limit-back Digger' }],
    now: X18_NOW,
  })
}

test('B562 (X18): a last report of the day before shows its date, so 22:29 never reads as a time later than now (20:23)', () => {
  const text = healthSummary(x18Board(), X18_NOW)
  const lead = text.split('\n').find(one => one.includes('Lead (main)')) ?? ''
  assert.match(lead, /; last report B301 at 2026-10-23 22:29;/)
  assert.doesNotMatch(lead, /at 22:29;/)
  // A report of today keeps its clock alone.
  const todays = healthSummary(x18Board({ reportAt: today(18, 5) }), X18_NOW).split('\n').find(one => one.includes('Lead (main)')) ?? ''
  assert.match(todays, /; last report B301 at 18:05;/)
  assert.match(text.split('\n').find(one => one.includes('Weeder (worker)')) ?? '', /unknown since 20:03 \(20 min\);.*; last report B302 at 19:40; compaction skipped at 19:50: small enough$/)
})

test('B562: every time in the summary of another day, past or future, carries its date; the head keeps the clock of now', () => {
  const text = healthSummary(x18Board(), X18_NOW)
  const line = words => text.split('\n').find(one => one.includes(words)) ?? ''
  assert.match(text, /^The board's health at 20:23,/)
  assert.match(line('Lead (main)'), /cleared at 2026-10-23 22:40 after B301$/)
  assert.match(line('Digger (worker)'), /suspended since 2026-10-23 23:15 \(21 h 8 min\) \(for 5-hour limit until 2026-10-25 01:10\);/)
  assert.match(line('Digger (worker)'), /not cleared at 2026-10-23 21:05: a subagent still runs; compacted at 2026-10-23 21:05$/)
  assert.match(line('X18 open'), /first 2026-10-23 23:00, last 20:20:/)
  assert.match(line('repair limit-back'), /^- 2026-10-23 22:30 repair limit-back on Digger/)
  // A reset tomorrow and a read of yesterday show their dates; a reset later today its clock.
  assert.match(line('5-hour limit: '), /5-hour limit: 97% used \(full\), read at 20:20, resets at 2026-10-25 01:10; weekly limit: 41% used \(ok\), read at 2026-10-23 23:50, resets at 23:00/)
  assert.match(line('- pause:'), /pause: running since 2026-10-23 08:00/)
})

test('B562: health.mjs prints no time through the bare clockOf outside dayClockOf and the head line, so a new time cannot skip its date', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../../src/supervisor/health.mjs', import.meta.url), 'utf8')
  const rest = source.replace(/const dayClockOf = [\s\S]*?\n}\n/, '').split('\n').filter(one => !/^\s*const head = /.test(one))
  assert.deepEqual(rest.filter(one => /\bclockOf\(/.test(one)).map(one => one.trim()), [])
  assert.match(source, /const dayClockOf = /, 'dayClockOf is still there to be cut out')
})

test('the summary holds every section: the chats with state, since, model and effort beside the step\'s, last report and clear', () => {
  const text = healthSummary(fixture(), NOW)
  assert.ok(text.length <= HEALTH_CHARS)
  for (const title of ['Chats (', 'Steps under way (', 'Queues:', 'Incidents and repairs of the last day:', 'Words not delivered:', 'Limits and pause:']) assert.ok(text.includes(title), title)
  const line = name => text.split('\n').find(one => one.includes(`${name} (`)) ?? ''
  // A worker on a step: what it runs at beside what its step wants, its clear that did not happen, and why. B576: hours
  // after the take with no switch, the mismatch is odd.
  assert.match(line('Digger'), /! Digger \(worker\): working; runs sonnet · medium; its step B12 wants opus · high \(no switch asked, 3 h 20 min after the take\); on B12 "Step B12 of the garden" \(in progress\)/)
  assert.match(line('Digger'), /not cleared at 10:10: a subagent it started still runs \(1\); compaction skipped at 10:10: it is small enough$/)
  // A worker unknown since the timeline says, its chat not running: odd, with its last report and its last clear.
  assert.match(line('Weeder'), /^- ! Weeder \(worker\): unknown since 10:35 \(25 min\), its chat does not run; .*on B13 .*; last report B10 at 09:25; cleared at 09:30 after B10$/)
  assert.match(line('Lead'), /Lead \(main\): working/)
  assert.match(line('Partner'), /Partner \(partner\): free/)
  // The steps under way with state, age and owner; an old one in progress is odd; new and refined only counted.
  assert.match(text, /- ! B12 in progress for 3 h 20 min, Digger \[no checkpoint\]: Step B12 of the garden/)
  assert.match(text, /- ! B13 taken for 40 min, Weeder/)
  assert.match(text, /- backlog, not queued: 1 new, 1 refined/)
  assert.ok(!text.includes('B9 '), 'a done step is no step under way')
  assert.match(text, /- Digger: B14, B15 \(the first waits: busy\)/)
  // The incident with its key and evidence; the repair of the day.
  assert.match(text, /- ! X1 open, from unknown-lane, seen 5 times, first 10:45, last 10:57: Weeder unknown for 25 min, B13 waits \[key: unknown-lane Weeder\] \(evidence: state unknown since 10:35\)/)
  assert.match(text, /- 10:30 repair limit-back on Weeder \(limit-back Weeder\)/)
  // The word that waits for 14 minutes is odd; a delivered one is not listed.
  assert.match(text, /- ! 10:46 work B13 to Weeder: waiting for 14 min/)
  assert.ok(!text.includes('to Digger:'))
  assert.match(text, /- 5-hour limit: 64% used \(ok\), read at 10:55, resets at 13:00; weekly limit: 41% used \(ok\), read at 10:55/)
  assert.match(text, /- pause: running since 01:00/)
})

test('with 900 items it stays under 8000 characters and keeps the steps every chat holds; it says what it left out', () => {
  const lanes = Array.from({ length: 8 }, (_, i) => lane(`Worker ${i + 1}`, { state: 'working', task: { stepId: `B${1000 + i}`, text: 'x' } }))
  const all = []
  lanes.forEach((one, i) => {
    all.push(step(`B${1000 + i}`, 'in progress', { Owner: one.name, Title: `A long title for the step that worker ${i + 1} is on, with many words in it to fill the line` }))
    all.push(step(`B${1100 + i}`, 'review', { Owner: one.name }))
  })
  for (let i = 0; i < 300; i += 1) all.push(step(`B${2000 + i}`, 'queued', { Owner: 'Somebody gone', Title: `A queued step for a chat that left, number ${i}, with a title long enough to matter` }))
  for (let i = 0; i < 584; i += 1) all.push(step(`B${3000 + i}`, 'done', { Owner: 'Worker 1' }))
  assert.equal(all.length, 900)
  const view = buildView({ state: { chats: [lane('Lead', { isMain: true }), ...lanes], chatPrefix: '' }, items: items(...all), now: NOW })
  const text = healthSummary(view, NOW)
  assert.ok(text.length <= HEALTH_CHARS, `${text.length} characters`)
  for (const i of lanes.keys()) {
    assert.ok(text.includes(`B${1000 + i} in progress`), `B${1000 + i}`)
    assert.ok(text.includes(`B${1100 + i} review`), `B${1100 + i}`)
    assert.ok(text.includes(`Worker ${i + 1} (worker)`), `Worker ${i + 1}`)
  }
  assert.match(text, /- \(\d+ more left out: the oldest and least odd\)/)
})

/** A temporary store and the work API with a health port, as the server gives it. */
async function store(t, health = async () => 'The board\'s health at 11:00.') {
  const dir = await mkdtemp(join(tmpdir(), 'health-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, migrateBacklog('# Backlog\n\n## Work\n- [ ] B12 Plant the beds (for Digger; about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  const roles = { Lead: 'main', Digger: 'worker', Partner: 'advisor', Second: 'helper', Watcher: 'supervisor' }
  const ctx = { dir, now: NOW, prefix: '', roleOf: chat => roles[chat] ?? null, ...(health === null ? {} : { health }) }
  return {
    chat: (chat, body) => workApi({ chat, ...body }, ctx),
    as: (as, body) => workApi(body, { ...ctx, as }),
  }
}

test('work health answers the summary to the supervisor chat, and refuses every other role', async t => {
  const s = await store(t)
  const read = await s.chat('Watcher', { action: 'health' })
  assert.equal(read.ok, true, read.why)
  assert.deepEqual(read.result, { text: 'The board\'s health at 11:00.', changed: false })
  for (const chat of ['Lead', 'Digger', 'Partner', 'Second']) {
    const refused = await s.chat(chat, { action: 'health' })
    assert.equal(refused.ok, false, chat)
    assert.equal(refused.status, 403, chat)
  }
  assert.equal((await s.as('person', { action: 'health' })).status, 403)
  // The supervisor chat reads and files incidents; it changes nothing else.
  assert.equal((await s.chat('Watcher', { action: 'note', to: 'main', text: 'hello' })).status, 403)
  assert.equal((await s.chat('Watcher', { action: 'incident', title: 'Digger works with no step for an hour', subject: 'Digger', evidence: 'working since 10:00, card empty', rule: 'a worker working with no step for 30 min' })).ok, true)
})

test('the review: the supervisor\'s chat files no ask through a "For you" block at its turn\'s end; a worker\'s is filed', async t => {
  const s = await store(t)
  const item = { n: 1, kind: 'decide', text: ['Should the board wake Digger now?'], options: [], advice: '', pictures: [], play: '', ref: null }
  const watcher = await s.chat('Watcher', { action: 'turn-ended', since: NOW - 1000, forYou: [item] })
  assert.equal(watcher.ok, true, watcher.why)
  assert.equal(watcher.result.asked, undefined)
  assert.equal(watcher.result.role, 'supervisor')
  const digger = await s.chat('Digger', { action: 'turn-ended', since: NOW - 1000, forYou: [item] })
  assert.equal(digger.result.asked?.length, 1)
})

test('work health on a board without a supervisor, or one whose summary fails, says so', async t => {
  assert.equal((await (await store(t, null)).chat('Watcher', { action: 'health' })).status, 409)
  const failing = await store(t, async () => { throw new Error('the store is torn') })
  const refused = await failing.chat('Watcher', { action: 'health' })
  assert.deepEqual([refused.status, refused.why], [503, 'The health summary could not be made: the store is torn'])
})

test('the supervisor builds the summary from its ports: the board, the store, the outbox and the repairs of its memory', async () => {
  const supervisor = createSupervisor({
    state: async () => ({ chats: [lane('Lead', { isMain: true }), lane('Digger', { state: 'working' })], chatPrefix: '' }),
    items: async () => items(step('B12', 'in progress', { Owner: 'Digger' }), step('B14', 'queued', { Owner: 'Digger' })),
    outbox: () => [{ id: 'w1', at: ago(20), to: 'Digger', command: 'work', about: 'B14', state: 'waiting' }],
    refused: () => [],
    apply: async () => ({ ok: true }),
    wake: async () => null,
    noted: { load: async () => ({ noted: [], seen: {} }), save: async () => {} },
    memory: { load: async () => ({ repairs: [{ at: ago(10), rule: 'blocked', subject: 'B12', key: 'blocked B12 B11' }] }), save: async () => {} },
    now: () => NOW,
    loops: { run: async (_name, fn) => fn(), failed: () => {} },
  })
  const text = await supervisor.health()
  assert.match(text, /^The board's health at 11:00/)
  assert.match(text, /- B12 in progress for 30 min, Digger/)
  assert.match(text, /- 10:50 repair blocked on B12 \(blocked B12 B11\)/)
  assert.match(text, /- ! 10:40 work B14 to Digger: waiting for 20 min/)
})

// The supervisor's chat: the list of chats' "supervisor", shown by its own card, never a worker.
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const app = name => JSON.stringify({
  title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
const tail = lines => ({ text: lines.join('\n'), isCut: false, modifiedAt: NOW })
function build(list = '{"prefix":"Garden · ","main":"Lead","supervisor":"watcher"}') {
  const chats = ['Lead', 'Digger', 'Watcher']
  const raw = {
    listText: list, appChatTexts: chats.map(app), tails: Object.fromEntries(chats.map(name => [`cli-${name}`, tail([answer(NOW - 30 * MIN, 'ok')])])),
    planLineTexts: {}, backlogText: '', adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], board: null, seen: null, now: NOW, config })
}

test('the list of chats names the supervisor\'s chat with "supervisor": no lane, no worker; it takes its words and has its role', () => {
  assert.deepEqual(parseList('{"prefix":"Team - ","main":"Lead","supervisor":" Watcher "}'), { prefix: 'Team - ', main: 'Lead', problem: null, supervisor: 'Watcher' })
  assert.equal(parseList('{"prefix":"Team - ","main":"Lead","supervisor":""}').supervisor, undefined)
  const state = build()
  assert.deepEqual(state.chats.map(one => one.name), ['Lead', 'Digger'])
  assert.equal(state.workers.count, 1)
  assert.equal(state.supervisorName, 'watcher')
  assert.deepEqual([state.supervisorChat.name, state.supervisorChat.session, state.supervisorChat.appSession], ['Watcher', 'cli-Watcher', 'local_Watcher'])
  assert.equal(state.spendingSubjects.find(one => one.name === 'Watcher').role, 'supervisor')
  assert.equal(laneRole(state, 'Watcher'), 'supervisor')
  assert.deepEqual(checkTake({ chat: 'Watcher', session: 'cli-Watcher' }, state), { ok: true, chat: 'Watcher' })
  // The main chat may be asked to start it, as any chat the board shows.
  assert.equal(checkSay({ to: 'Lead', command: 'start', chat: 'Watcher' }, { ...state, supervisorChat: { ...state.supervisorChat, isRunning: false } }, 3000).ok, true)
  // Without the entry it is a worker as before.
  const without = build('{"prefix":"Garden · ","main":"Lead"}')
  assert.equal(without.supervisorChat, null)
  assert.deepEqual(without.chats.map(one => one.name), ['Lead', 'Digger', 'Watcher'])
})
