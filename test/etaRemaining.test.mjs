// eta-remaining (chat 1's brief, the person 2026-11-11: "i want the board to reflect the remainting ETA", then "good." to the design),
// with chat 1's review decisions A-H (.claude/plans/2026-11-11-eta-remaining-review.md). The live case: Worker 1's row read "2 h 30 min
// over" in amber on B1125: its last minutes-left was 60 min at 13:44 while it worked on, its last turn at 19:46; G64's line read
// "about 10 h left" from the how made at the start. B1125's Plan line and take are the live ones (the store, 11 Nov); the chat is
// Digger in the test garden (Worker 1 in the work API's store), G64's other steps are made up.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../src/work/api.mjs'
import { parseItem, valueOf } from '../src/work/item.mjs'
import { nextPlan } from '../src/work/stepPlan.mjs'
import { B855_LINES, MIN, at as nov2, b855d, cardOf, digger, stampSec, stateAt, stepItem } from './heldFixtures.mjs'
import { openPage } from './pageHarness.mjs'

const t = (h, m, s = 0) => new Date(2026, 10, 11, h, m, s).getTime()
const tomorrow = (h, m) => new Date(2026, 10, 12, h, m).getTime()
const WORKING = [{ at: t(12, 21), chat: 'Digger', state: 'working', task: null, source: 'step' }]
const OLD_PLAN = 'Plan: step 4/5 | parts Worktree and brief; Codex sheets; Converter, lab, tests; Judges, pictures, docs; Gate, merge, report | until 2026-11-11 14:44:38 | step until 2026-11-11 14:04:38 | at 2026-11-11 13:44:38'
const NEW_PLAN = 'Plan: step 4/5 | parts Worktree and brief; Codex sheets; Converter, lab, tests; Judges, pictures, docs; Gate, merge, report | until 2026-11-11 20:56:00 | at 2026-11-11 19:46:00 | estimated 2026-11-11 19:46:00'

/** B1125 as the store held it: taken 12:21, Taken for 150 min, Size about 2 h, its last minutes-left 60 min at 13:44:38. */
const b1125 = (plan = OLD_PLAN, { state = 'in progress', history = [] } = {}) => stepItem('B1125', {
  title: 'Give each of the Knight\'s six abilities its own move', owner: 'Digger', size: 'about 2 h', since: t(19, 2), state,
  head: [`Checkpoint: 534e1de3 · Enlarged re-judge after Q735 round · ${stampSec(t(19, 2, 1))}`, plan, 'Taken for: 150 min'],
  history: [[t(12, 21), 'Digger', 'queued → taken'], [t(12, 21), 'Digger', 'taken → in progress'], [t(13, 44), 'Digger', 'step 4, about 60 min left'], ...history],
})
const b1125New = () => b1125(NEW_PLAN)
const rowWords = async (state, now) => {
  const page = await openPage({ state: JSON.parse(JSON.stringify(state)), now })
  try {
    const row = page.all('#lanes [data-lane]').find(one => one.dataset.lane === 'Digger')
    const etaBox = row.querySelector('.eta')
    return { eta: etaBox.textContent.replace(/\s+/g, ' ').trim(), title: [etaBox.title, ...[...etaBox.querySelectorAll('[title]')].map(one => one.title)].join(' '), bar:page.document.querySelector('#simple-bar b')?.textContent ?? '', amber: page.all('#lanes .is-attn, #lanes .is-blocked, #lanes .is-overdue, #simple-workers .is-attn, #simple-workers .is-overdue').length }
  } finally { await page.close() }
}

// The worker row: the latest estimate minus the working time since it was said

test('B1125 at 19:50 after a fresh 70 min at 19:46: "about 1 h 06 left · re-estimated 19:46", from its own estimate', async () => {
  const state = stateAt(t(19, 50), { items: [b1125New()], lines: WORKING })
  assert.deepEqual([digger(state).held.eta.from, digger(state).held.eta.saidAt, digger(state).held.eta.leftMs, digger(state).held.eta.isOver], ['own', t(19, 46), 66 * MIN, false])
  assert.equal((await rowWords(state, t(19, 50))).eta, 'about 1 h 06 left · re-estimated 19:46')
})

// B (review 2, 8): the "since" time is the moment the worked time reached the estimate, and stays there.
test('B: past since 14:44 whatever waits came after it: a wait 16:00-17:00 leaves it at 14:44, and the row stays quiet', async () => {
  const lines = [...WORKING, { at: t(16, 0), chat: 'Digger', state: 'waiting', task: null, source: 'step' }, { at: t(17, 0), chat: 'Digger', state: 'working', task: null, source: 'step' }]
  const state = stateAt(t(17, 30), { items: [b1125()], lines })
  assert.equal(digger(state).held.eta.at, t(14, 44, 38))
  assert.deepEqual([digger(state).held.eta.isOver, digger(state).held.eta.isOverdue], [true, false])
  const shown = await rowWords(state, t(17, 30))
  assert.equal(shown.eta, 'past its estimate since 14:44')
  assert.equal(shown.amber, 0, 'never amber')
  // A wait before the estimate ran out does move it: 30 min suspended 14:00-14:30 (after the 13:44:38 estimate, before it ran out) count no work.
  const early = [...WORKING, { at: t(14, 0), chat: 'Digger', state: 'suspended', task: null, source: 'step' }, { at: t(14, 30), chat: 'Digger', state: 'working', task: null, source: 'step' }]
  assert.equal(digger(stateAt(t(17, 30), { items: [b1125()], lines: early })).held.eta.at, t(15, 14, 38))
})

// G (review 25, 29): a past time of another day says so.
test('G: the next morning it reads "past its estimate since yesterday 14:44"', async () => {
  const state = stateAt(tomorrow(9, 0), { items: [b1125()], lines: WORKING })
  assert.equal((await rowWords(state, tomorrow(9, 0))).eta, 'past its estimate since yesterday 14:44')
})

// E (review 16, 23): the take's own minutes are its first estimate.
test('E: right after a take the row says "estimated 12:21"; only a later minutes says "re-estimated"', async () => {
  const taken = b1125('Plan: until 2026-11-11 12:51:00 | at 2026-11-11 12:21:00 | estimated 2026-11-11 12:21:00')
  taken.sections.set('History', [`- 2026-11-11 12:21 Digger: taken → in progress`])
  const state = stateAt(t(12, 25), { items: [taken], lines: WORKING })
  assert.equal(digger(state).held.eta.from, 'take')
  assert.equal((await rowWords(state, t(12, 25))).eta, 'about 26 min left · estimated 12:21')
})

// H (review 20): the card's own time never sets the row.
test('H: the card says 25 min left; the row says the store\'s 40 min and never 25', async () => {
  const state = stateAt(nov2(11, 16), { items: [b855d()], card: cardOf('QA of B813', { step: 4, steps: 4, left: 25 * MIN }), lines: B855_LINES })
  const shown = await rowWords(state, nov2(11, 16))
  assert.equal(shown.eta, 'about 40 min left · re-estimated 11:14')
  assert.ok(!shown.eta.includes('25 min'))
})

// The work API: the asks ride on the worker's own `work step` answer (A, F)

const STEP_TEXT = (state, plan, extra = []) => `${['Id: B1125', 'Kind: step', 'Title: Give each ability its own move', `State: ${state}`, 'Owner: Worker 1', 'Since: 2026-11-11 12:21', 'Activity: Garden', plan, 'Taken for: 150 min', '', '## History', '- 2026-11-11 12:21 Worker 1: taken → in progress', ...extra, ''].join('\n')}`
async function storeWith(state = 'in progress', plan = OLD_PLAN, extra = []) {
  const dir = await mkdtemp(join(tmpdir(), 'eta-remaining-'))
  await writeFile(join(dir, 'B1125.md'), STEP_TEXT(state, plan, extra))
  await writeFile(join(dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Garden', steps: ['B1125'] }] }, null, 1)}\n`)
  return dir
}
/** Worker 1's lane as the state gives it: B1125 held, past its estimate of 13:44:38 (or not). */
const pastLane = (isOver = true, saidAt = t(13, 44, 38)) => ({ name: 'Worker 1', state: 'working', held: { id: 'B1125', eta: { isOver, saidAt, from: 'own', at: t(14, 44, 38), leftMs: 0 } } })
const ctxOf = (dir, now, lanes = [pastLane()]) => ({ dir, now, prefix: '', roleOf: name => (name === 'Worker 1' ? 'worker' : name === 'Worker 2' ? 'worker' : null), chats: ['Worker 1', 'Worker 2'], pictureProblem: async () => null, lanes })
const historyOf = async dir => parseItem(await readFile(join(dir, 'B1125.md'), 'utf8')).sections.get('History')

test('A: past its estimate, the worker\'s next checkpoint answer asks a fresh estimate once, with a History line the row reads; no word is typed', async t2 => {
  const dir = await storeWith()
  t2.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const first = await workApi({ action: 'step', chat: 'Worker 1', id: 'B1125', commit: '534e1de3', next: 'rejudge on en' }, ctxOf(dir, t(19, 46)))
  assert.equal(first.ok, true, first.why)
  assert.match(first.result.text, /B1125 is past its estimate \(given 13:44\): give a fresh minutes-left now: work step id=B1125 minutes=/)
  assert.doesNotMatch(first.result.text, /Give your minutes left with every checkpoint/, 'one ask, not two')
  assert.equal((await historyOf(dir)).filter(one => /server: asked a fresh estimate \(estimated 2026-11-11 13:44:38\)/.test(one)).length, 1)
  // The same estimate: no second ask.
  const second = await workApi({ action: 'step', chat: 'Worker 1', id: 'B1125', commit: '534e1de3', next: 'rejudge again' }, ctxOf(dir, t(19, 50)))
  assert.doesNotMatch(second.result.text, /past its estimate/)
  assert.equal((await historyOf(dir)).filter(one => /asked a fresh estimate/.test(one)).length, 1)
  // The row reads it from the store: "· new estimate asked".
  const item = b1125(OLD_PLAN, { history: [[t(19, 46), 'server', 'asked a fresh estimate (estimated 2026-11-11 13:44:38)']] })
  const state = stateAt(t(19, 47), { items: [item], lines: WORKING })
  assert.equal(digger(state).held.eta.asked, true)
  assert.equal((await rowWords(state, t(19, 47))).eta, 'past its estimate since 14:44 · new estimate asked')
  // A call with fresh minutes asks nothing.
  assert.doesNotMatch((await workApi({ action: 'step', chat: 'Worker 1', id: 'B1125', commit: 'abc1234', next: 'x', minutes: 40 }, ctxOf(dir, t(20, 0), [pastLane(true, t(20, 30))]))).result.text, /past its estimate|Give your minutes/)
})

test('A: not past its estimate, no estimate ask: only the minutes ask for a checkpoint without minutes', async t2 => {
  const dir = await storeWith()
  t2.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const bare = await workApi({ action: 'step', chat: 'Worker 1', id: 'B1125', commit: '534e1de3', next: 'x' }, ctxOf(dir, t(13, 50), [pastLane(false)]))
  assert.doesNotMatch(bare.result.text, /past its estimate/)
  assert.match(bare.result.text, /Give your minutes left with every checkpoint: work step id=B1125 minutes=/)
  assert.equal(bare.result.text.split('\n').length, 1, 'one line')
})

test('F: a checkpoint with minutes on a step in review (handed back) keeps the checkpoint, ignores the minutes and asks nothing', async t2 => {
  const dir = await storeWith('review')
  t2.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const made = await workApi({ action: 'step', chat: 'Worker 1', id: 'B1125', commit: 'none', next: 'fix the red test', minutes: 30 }, ctxOf(dir, t(19, 46)))
  assert.equal(made.ok, true, made.why)
  const item = parseItem(await readFile(join(dir, 'B1125.md'), 'utf8'))
  assert.match(valueOf(item, 'Checkpoint'), /fix the red test/)
  assert.equal(valueOf(item, 'Plan'), OLD_PLAN.slice('Plan: '.length), 'the minutes are left out')
  assert.doesNotMatch(made.result.text, /Give your minutes|past its estimate/)
})

test('F: while the person pauses all chats a checkpoint asks nothing', async t2 => {
  const dir = await storeWith()
  t2.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeFile(join(dir, 'pause.json'), `${JSON.stringify({ state: 'pausing', since: t(19, 40), by: 'person' })}\n`)
  const made = await workApi({ action: 'step', chat: 'Worker 1', id: 'B1125', commit: '534e1de3', next: 'paused' }, ctxOf(dir, t(19, 46)))
  assert.equal(made.ok, true, made.why)
  assert.doesNotMatch(made.result.text, /Give your minutes|past its estimate/)
})

// C (review 3, 12, 14): an old Plan line keeps its estimate time through a call without minutes.
test('C: an old Plan line (no estimated part) keeps 13:44:38 as its estimate through a step call without minutes', async t2 => {
  const kept = nextPlan({ names: [], on: 4, steps: 5, until: t(14, 44, 38), stepUntil: null, writtenAt: t(13, 44, 38), estimatedAt: null }, { step: 5 }, t(20, 5))
  assert.equal(kept.estimatedAt, t(13, 44, 38))
  const dir = await storeWith()
  t2.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  assert.equal((await workApi({ action: 'step', chat: 'Worker 1', id: 'B1125', step: 5 }, ctxOf(dir, t(20, 5), [pastLane(true)]))).ok, true)
  const plan = valueOf(parseItem(await readFile(join(dir, 'B1125.md'), 'utf8')), 'Plan')
  assert.match(plan, /estimated 2026-11-11 13:44:38/)
})

// The goal line (D): the open steps' remaining estimates added up, never "0 min", no clock time

const G64 = parts => ['Last id: G64', 'Focus: G64', '', '- [~] G64 The Knight attacks', '    Done when: you judge each ability reads', '    Goal definition: an own attack move per ability',
  '    Goal definition agreed: 2026-11-11 00:09', ...parts, '    How agreed: 2026-11-11 01:00', '    Go: 2026-11-11 01:05', ''].join('\n')
const PARTS = ['    Part: Base moves · about 4 h · steps B1124', '    Part: Ability moves · about 6 h · steps B1125, B1140', '    Part: Polish · about 2 h']
const b1124 = (state = 'done') => stepItem('B1124', { owner: 'Worker 2', state, size: 'about 4 h', since: t(11, 0) })
const b1140 = (size = 'about 1 h') => stepItem('B1140', { owner: null, state: 'refined', size, since: t(12, 0) })

test('D: G64 at 19:50: B1125\'s 66 min left + B1140\'s 1 h + Polish\'s 2 h (no steps) = about 4 h left, and no clock time', async () => {
  const state = stateAt(t(19, 50), { items: [b1124(), b1125New(), b1140()], lines: WORKING, goals: G64(PARTS) })
  assert.equal(state.focus.progress.minutesLeft, 66 + 60 + 120)
  assert.equal(state.focus.progress.readyAt, undefined)
  const { bar } = await rowWords(state, t(19, 50))
  assert.match(bar, /Focus G64 · The Knight attacks · .* · about 4 h left$/)
  assert.doesNotMatch(bar, /ready around/)
})

test('D: a step past its estimate counts its Size (never 0); a done step in an open part counts nothing; an unsized step counts its share', () => {
  const past = stateAt(t(19, 46), { items: [b1124(), b1125(), b1140()], lines: WORKING, goals: G64(PARTS) })
  assert.equal(past.focus.progress.minutesLeft, 120 + 60 + 120, 'B1125 past its estimate counts its 2 h Size')
  // Ability moves with a done step beside the open ones: the done one counts nothing.
  const mixed = stateAt(t(19, 50), { items: [b1124(), b1125New(), b1140()], lines: WORKING, goals: G64(['    Part: Ability moves · about 6 h · steps B1124, B1125, B1140']) })
  assert.equal(mixed.focus.progress.minutesLeft, 66 + 60)
  // A new step without a Size counts its share of the part (6 h over 3 steps), never the whole 6 h again.
  const unsized = stateAt(t(19, 50), { items: [b1124(), b1125New(), b1140(null)], lines: WORKING, goals: G64(['    Part: Ability moves · about 6 h · steps B1124, B1125, B1140']) })
  assert.equal(unsized.focus.progress.minutesLeft, 66 + 120)
})

test('D: a step in review counts 0 unless its worker holds it again (handed back); with only checks left the line says so, never "0 min"', async () => {
  const review = b1125(NEW_PLAN, { state: 'review' })
  review.head.set('Owner', 'Nobody')
  const checks = stateAt(t(19, 50), { items: [b1124(), review], lines: WORKING, goals: G64(['    Part: Ability moves · about 6 h · steps B1125']) })
  assert.equal(checks.focus.progress.minutesLeft, 0)
  const { bar } = await rowWords(checks, t(19, 50))
  assert.match(bar, / · the rest waits for its check$/)
  assert.doesNotMatch(bar, /0 min/)
  // Handed back: in review, its check failed, Digger holds it again with 66 min left.
  const back = b1125(NEW_PLAN, { state: 'review', history: [[t(19, 47), 'Digger', 'in progress → review'], [t(19, 48), 'server', 'check failed: red']] })
  const fixing = stateAt(t(19, 50), { items: [back], lines: WORKING, goals: G64(['    Part: Ability moves · about 6 h · steps B1125']) })
  assert.equal(digger(fixing).held?.id, 'B1125')
  assert.equal(fixing.focus.progress.minutesLeft, 66)
})

// Chat 1's verifier of 327f1c22 (.claude/plans/2026-11-12-eta-remaining-verifier.md)

test('verifier 1: right after a take the hover names the take\'s minutes, never "its size"', async () => {
  const taken = b1125('Plan: until 2026-11-11 12:51:00 | at 2026-11-11 12:21:00 | estimated 2026-11-11 12:21:00')
  taken.sections.set('History', ['- 2026-11-11 12:21 Digger: taken → in progress'])
  const shown = await rowWords(stateAt(t(12, 25), { items: [taken], lines: WORKING }), t(12, 25))
  assert.match(shown.title, /the minutes given with its take/)
  assert.doesNotMatch(shown.title, /its size/)
})

test('verifier 2: a step in review whose fix is under way counts the fix\'s time, and the line never says only checks are left', async () => {
  const review = b1125(NEW_PLAN, { state: 'review' })
  review.head.set('Owner', 'Nobody')
  const fix = stepItem('B1141', { title: 'Fix of B1125', owner: 'Digger', size: 'about 1 h', since: t(19, 40), head: ['Fix of: B1125', 'Plan: until 2026-11-11 20:15:00 | at 2026-11-11 19:45:00 | estimated 2026-11-11 19:45:00'], history: [[t(19, 40), 'Digger', 'taken → in progress']] })
  const state = stateAt(t(19, 50), { items: [b1124(), review, fix], lines: WORKING, goals: G64(['    Part: Ability moves · about 6 h · steps B1125']) })
  assert.equal(state.focus.progress.minutesLeft, 25)
  assert.doesNotMatch((await rowWords(state, t(19, 50))).bar, / · the rest waits for its check$/)
})

test('verifier 3, 7, 16: no ask on a step that takes no minutes, on another held step, or on a stop checkpoint', async t2 => {
  for (const state of ['review', 'taken']) {
    const dir = await storeWith(state)
    t2.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
    const made = await workApi({ action: 'step', chat: 'Worker 1', id: 'B1125', commit: 'none', next: 'x' }, ctxOf(dir, t(19, 46)))
    assert.equal(made.ok, true, made.why)
    assert.doesNotMatch(made.result.text, /Give your minutes|past its estimate/, state)
    assert.ok(!(await historyOf(dir)).some(one => /asked a fresh estimate/.test(one)), state)
  }
  // The lane holds B1125 past its estimate; a checkpoint on B1126 (waiting on you) asks nothing about B1125's estimate.
  const dir = await storeWith()
  t2.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeFile(join(dir, 'B1126.md'), STEP_TEXT('waiting on you', 'Branch: b1126').replaceAll('B1125', 'B1126'))
  await writeFile(join(dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Garden', steps: ['B1125', 'B1126'] }] }, null, 1)}\n`)
  // The lane's estimate time is B1126's own take (12:21) too, so only the held-step guard keeps the ask off it.
  const other = await workApi({ action: 'step', chat: 'Worker 1', id: 'B1126', commit: 'none', next: 'x' }, ctxOf(dir, t(19, 46), [pastLane(true, t(12, 21))]))
  assert.equal(other.ok, true, other.why)
  assert.doesNotMatch(other.result.text, /past its estimate/)
  // A stop checkpoint (the step is held for a rethink): no ask either.
  const held = await storeWith('in progress', OLD_PLAN, [])
  t2.after(() => rm(held, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const text = (await readFile(join(held, 'B1125.md'), 'utf8')).replace('Taken for: 150 min', 'Taken for: 150 min\nWaits for: the rethink of G64 "the moves" (2026-11-11 19:40)')
  await writeFile(join(held, 'B1125.md'), text)
  const stop = await workApi({ action: 'step', chat: 'Worker 1', id: 'B1125', commit: 'none', next: 'stopped for the rethink' }, ctxOf(held, t(19, 46)))
  assert.doesNotMatch(stop.result?.text ?? stop.why ?? '', /Give your minutes|past its estimate/)
})

test('verifier 4, 5: a kept lane older than the worker\'s fresh minutes asks nothing', async t2 => {
  const dir = await storeWith('in progress', 'Plan: step 4/5 | until 2026-11-11 20:56:10 | at 2026-11-11 19:46:10 | estimated 2026-11-11 19:46:10')
  t2.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const made = await workApi({ action: 'step', chat: 'Worker 1', id: 'B1125', step: 5 }, ctxOf(dir, t(19, 46, 30), [pastLane(true, t(13, 44, 38))]))
  assert.equal(made.ok, true, made.why)
  assert.doesNotMatch(made.result.text, /past its estimate/)
  assert.ok(!(await historyOf(dir)).some(one => /asked a fresh estimate/.test(one)))
})

test('verifier 6: a part whose time is not known makes the line "at least", never "only checks"', async () => {
  const review = b1125(NEW_PLAN, { state: 'review' })
  review.head.set('Owner', 'Nobody')
  const rules = stepItem('B1160', { owner: null, state: 'new', since: t(12, 0) })
  const state = stateAt(t(19, 50), { items: [b1124(), review, rules], lines: WORKING, goals: G64(['    Part: Ability moves · about 6 h · steps B1125', '    Part: Rules · steps B1160']) })
  assert.equal(state.focus.progress.timeUnknown, true)
  assert.doesNotMatch((await rowWords(state, t(19, 50))).bar, / · the rest waits for its check$/)
})

test('verifier 11: an old Plan line whose at is no minutes call gives no re-estimate time', () => {
  const plan = { names: [], on: 5, steps: 5, until: t(19, 47, 4), stepUntil: t(19, 4, 49), writtenAt: t(18, 44, 49), estimatedAt: null }
  assert.equal(nextPlan(plan, { step: 5 }, t(19, 5)).estimatedAt, null)
  assert.equal(nextPlan({ ...plan, until: t(19, 44, 49) }, { step: 5 }, t(19, 5)).estimatedAt, t(18, 44, 49), 'a whole number of minutes: its minutes call')
})

test('verifier 12: after a rename the take\'s own estimate does not read "re-estimated"', async () => {
  const item = stepItem('B1', { owner: 'Digger', since: t(12, 21), head: ['Plan: until 2026-11-11 13:21:00 | at 2026-11-11 12:21:00 | estimated 2026-11-11 12:21:00'], history: [[t(12, 21), 'Worker 1', 'taken → in progress'], [t(12, 30), 'server', 'Worker 1 renamed to Digger (same chat)']] })
  const state = stateAt(t(12, 40), { items: [item], lines: WORKING })
  assert.notEqual(digger(state).held.eta.from, 'own')
  assert.doesNotMatch((await rowWords(state, t(12, 40))).eta, /re-estimated/)
})

test('verifier 14, 15: a goal marked done says nothing more; checks beside a verdict say both', async () => {
  const script = await readFile(new URL('../public/board.js', import.meta.url), 'utf8')
  const start = script.indexOf('const restWords = ')
  const end = script.indexOf('\n}\n', start) + 3
  const page = {}
  const vm = await import('node:vm')
  vm.runInNewContext(`${script.slice(start, end)}\nObject.assign(this, { restWords })`, page)
  assert.equal(page.restWords({ stage: 'done', progress: { minutesLeft: 0 }, parts: [] }, null, false), '')
  assert.equal(page.restWords({ stage: 'run', progress: { minutesLeft: 0 }, parts: [{ state: 'verdict' }, { state: 'now' }] }, null, false), ' · the rest waits for checks and your verdict')
  assert.equal(page.restWords({ stage: 'run', progress: { minutesLeft: 0 }, parts: [{ state: 'now' }] }, null, false), ' · the rest waits for its check')
})
