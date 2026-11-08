// Stop and rethink, the Focus run view while a rethink runs (the person, 2026-11-08: "i dont know where to look and who is waiting for
// what right now"): `focus.rethink`, derived from the goal's `Evaluation asked` line and the holds, and the card the page draws from it.
// Made-up names only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { parseGoals } from '../src/goals.mjs'
import { focusState } from '../src/state.mjs'
import { parseItem } from '../src/work/item.mjs'
import { openPage } from './pageHarness.mjs'
import { asSent, build, RUN_GOALS } from './partnerState.mjs'

const HOLD = (minute, part = 'Side stairs') => `the rethink of G6 "${part}" (${minute})`
const GOALS = (asked = true) => ['Last id: G6', 'Focus: G6', '', '- [~] G6 The polish', '    Done when: x', '    Goal definition: calm', '    Goal definition agreed: 2026-11-01 10:00',
  '    Part: Side stairs · about 1 h · steps B1, B2', '    Part: Walls · about 1 h · steps B3', '    How agreed: 2026-11-01 11:00', ...(asked ? ['    Evaluation asked: 2026-11-08 22:30'] : []), ''].join('\n')
const step = (id, state, history = []) => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\nSince: 2026-11-08 22:00\n\n${history.length === 0 ? '' : `## History\n${history.join('\n')}\n`}`)
const words = (minute, text) => `## Your words\n1. ${minute} · note (rethink, ${minute})\n   You: ${text}\n\n`
const held = (id, minute, { state = 'refined', history = [], text = null } = {}) => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\nWaits for: ${HOLD(minute)}\nSince: 2026-11-08 22:00\n\n${text === null ? '' : words(minute, text)}## History\n${history.join('\n')}\n`)
const STOP = ['- 2026-11-08 21:00 Game - Worker 5: queued → taken', '- 2026-11-08 22:27 Game - Worker 5: stopped for the rethink of G6 "Side stairs" (2026-11-08 22:27): its stop checkpoint is in']
const free = name => ({ name: `Game - ${name}`, state: 'free', task: null, isLeftover: false })
const busy = name => ({ name: `Game - ${name}`, state: 'working', task: { step: 1, steps: 2 }, isLeftover: false })
const ASK = parseItem('Id: Q9\nKind: ask\nTitle: Rebuild G6: side stairs\nState: open\nOwner: Game - Advisor\nSince: 2026-11-08 23:00\n')
const run = (goals, items, lanes = [free('Worker 5')], partnerLane = null) => focusState(parseGoals(goals), items, [], 'Game - ', null, null, lanes, null, null, { partnerLane })
const partnerLane = { name: 'Game - Advisor', state: 'working', doingNow: 'Evaluate G6', task: { step: 1, steps: 4 }, eta: { leftMs: 34.5 * 60_000 } }

test('state: null without "Evaluation asked", and null without a hold', () => {
  const items = [held('B1', '2026-11-08 22:27', { text: 'all wrong' })]
  assert.equal(run(GOALS(false), items).rethink, null)
  assert.equal(run(GOALS(true), [step('B1', 'refined')]).rethink, null)
  // A hold of another goal is not this goal's rethink.
  assert.equal(run(GOALS(true), [parseItem('Id: B1\nKind: step\nTitle: x\nState: refined\nWaits for: the rethink of G9 "Side stairs" (2026-11-08 22:27)\nSince: 2026-11-08 22:00\n')]).rethink, null)
})

test('state: set with both: the part, the earliest minute, the held steps, the words, the partner and the open ask', () => {
  const items = [held('B1', '2026-11-08 22:27', { text: 'all wrong, look at this' }), held('B2', '2026-11-08 22:25'), step('B3', 'queued'), ASK]
  const rethink = run(GOALS(), items, [free('Worker 5')], partnerLane).rethink
  assert.equal(rethink.part, 'Side stairs')
  assert.equal(rethink.at, '2026-11-08 22:25', 'the earliest minute')
  assert.deepEqual(rethink.held.map(one => one.id), ['B1', 'B2'])
  assert.deepEqual(rethink.held[0], { id: 'B1', title: 'Step B1', state: 'refined' })
  assert.deepEqual(rethink.partner, { name: 'Advisor', state: 'working', doingNow: 'Evaluate G6', progress: '1 of 4', minutesLeft: 35 })
  assert.deepEqual(rethink.ask, { id: 'Q9', title: 'Rebuild G6: side stairs' })
})

test('state: the words are the point of the rethink minute, one line, cut at 400 characters', () => {
  const long = `all ${'wrong '.repeat(100)}`
  const rethink = run(GOALS(), [held('B1', '2026-11-08 22:27', { text: long }), held('B2', '2026-11-08 22:27')]).rethink
  assert.equal(rethink.words.length, 400)
  assert.equal(run(GOALS(), [held('B1', '2026-11-08 22:27', { text: 'all wrong' })]).rethink.words, 'all wrong')
  assert.equal(run(GOALS(), [held('B1', '2026-11-08 22:27')]).rethink.words, null)
})

test('state: a freed step names its former worker, and the worker is free only while its lane says free now', () => {
  const items = [held('B1', '2026-11-08 22:27', { state: 'refined', history: STOP, text: 'x' })]
  const idle = run(GOALS(), items, [free('Worker 5')]).rethink
  assert.deepEqual(idle.freed, [{ id: 'B1', worker: 'Worker 5', isFree: true }])
  const working = run(GOALS(), items, [busy('Worker 5')]).rethink
  assert.deepEqual(working.freed, [{ id: 'B1', worker: 'Worker 5', isFree: false }], 'a busy lane is not free')
  assert.deepEqual(run(GOALS(), [held('B1', '2026-11-08 22:27', { state: 'queued' })]).rethink.freed, [], 'a held step nobody stopped is not freed')
})

test('state: after the evaluation ends (no Evaluation line, holds cleared) it is null, whatever is stored', () => {
  assert.equal(run(GOALS(false), [step('B1', 'refined', STOP), step('B2', 'queued')], [free('Worker 5')], partnerLane).rethink, null)
})

// --- the page ---
const RETHINK = {
  part: 'Show damage', partTitle: 'Show damage', at: '2026-11-08 22:27', words: 'all wrong, look at this',
  held: [{ id: 'B1070', title: 'Bridge', state: 'refined' }],
  freed: [{ id: 'B1068', worker: 'Worker 5', isFree: true }, { id: 'B1069', worker: 'Worker 2', isFree: false }],
  partner: { name: 'Advisor', state: 'working', doingNow: 'Evaluate G6', progress: '1 of 4', minutesLeft: 35 },
  ask: null,
}
const GUARD = { state: 'evaluating', attempts: 1, part: 'Show damage', parts: [], ask: null, of: 'three checks' }
function stateOf(rethink, guard = GUARD) {
  const state = asSent(build([], undefined, RUN_GOALS))
  const part = state.focus.parts[0]
  state.focus = { ...state.focus, rethink, guard, round: { n: 1, since: '2026-11-08 20:00', why: 'the first plan' }, openNow: [{ index: 0, title: part.title, kind: 'new' }], parts: [{ ...part, state: 'done', done: 1, total: 1 }] }
  return state
}
async function open(rethink, guard) {
  const page = await openPage({ state: stateOf(rethink, guard) })
  await page.click('[data-tab="advice"]')
  return page
}
const lines = page => page.all('.focus-rethink li').map(one => one.textContent)

test('page: the card shows its heading and lines, calm, above Open now', async () => {
  const page = await open(RETHINK)
  try {
    assert.equal(page.all('.focus-rethink').length, 1)
    assert.equal(page.text('.focus-rethink h3'), 'You asked to stop and rethink: Show damage')
    assert.deepEqual(lines(page), [
      'Your words (2026-11-08 22:27): "all wrong, look at this"',
      'Stopped and held: B1070 Bridge',
      'Worker 5 is free for other work',
      'Now: your Advisor rethinks it · 1 of 4, about 35 min',
      'Next for you: one question with 2 or 3 ways, each with a picture. Nothing on it is built before your pick.',
    ])
    assert.equal(page.all('.focus-rethink.is-asking, .focus-rethink.is-evaluating, .focus-rethink .is-ask').length, 0, 'no attention colour')
    // The person, 2026-11-08: "i want a loader if we are waiting for this": the Now line turns while the Advisor works.
    assert.equal(page.all('.focus-rethink-now .calm-spinner').length, 1)
  } finally { await page.close() }
})

test('page: once the pick waits for the person, the Now line has no loader', async () => {
  const page = await open({ ...RETHINK, ask: { id: 'Q684', title: 'Rebuild G6: which way?' } })
  try { assert.equal(page.all('.focus-rethink-now .calm-spinner').length, 0) } finally { await page.close() }
})

test('page: a busy worker has no "is free" line; the partner without progress says when it started', async () => {
  const page = await open({ ...RETHINK, freed: [{ id: 'B1068', worker: 'Worker 2', isFree: false }], partner: null })
  try {
    assert.equal(lines(page).some(one => /is free/.test(one)), false)
    assert.ok(lines(page).includes('Now: your Advisor rethinks it · started 2026-11-08 22:27'))
  } finally { await page.close() }
})

test('page: the old evaluation card is gone while the card shows, and is back without it', async () => {
  const withIt = await open(RETHINK)
  try { assert.equal(withIt.all('.focus-guard').length, 0) } finally { await withIt.close() }
  const without = await open(null)
  try {
    assert.equal(without.all('.focus-rethink').length, 0)
    assert.match(without.text('.focus-guard'), /Your partner evaluates the approach/)
  } finally { await without.close() }
})

test('page: a state after the rethink ended (rethink null) draws no card', async () => {
  const page = await open(null, null)
  try { assert.equal(page.all('.focus-rethink').length, 0) } finally { await page.close() }
})

test('page: the block of the rethought part reads "Being rethought", not done', async () => {
  const page = await open(RETHINK)
  try {
    await page.click('[data-focus-blocks="open"]')
    const row = page.find('.focus-open-block')
    assert.match(row.textContent, /Being rethought/)
    assert.equal(row.classList.contains('is-met'), false)
    assert.equal(row.querySelector('.focus-bullet-mark').textContent, '')
    assert.match(page.text('.focus-round'), /being rethought/)
    assert.doesNotMatch(page.text('.focus-round'), /1 of 1 done/)
  } finally { await page.close() }
  const plain = await open(null)
  try {
    await plain.click('[data-focus-blocks="open"]')
    assert.match(plain.text('.focus-round'), /1 of 1 done/)
    assert.equal(plain.find('.focus-open-block .focus-bullet-mark').textContent, '✓')
  } finally { await plain.close() }
})

test('page: with an open ask, the last line is a link to it', async () => {
  const page = await open({ ...RETHINK, ask: { id: 'Q9', title: 'Rebuild G6: side stairs' } })
  try {
    const link = page.find('.focus-rethink a')
    assert.equal(link.textContent, 'Your pick waits: Rebuild G6: side stairs')
    assert.equal(link.getAttribute('href'), '#details=Q9')
    assert.equal(lines(page).some(one => /^Next for you/.test(one)), false)
  } finally { await page.close() }
})
