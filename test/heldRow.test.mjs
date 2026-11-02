// Signals change 7 (B914, 2026-11-02): the task, step and time on a worker's row come from the board's records. The real
// cases: B855 (2 Nov, Worker 1) taken 11:10 for 90 min with a refine size of about 2 h, its card "step 4/4, 40 min left" at
// 11:14, interrupted 11:14-11:16, its head Since rewritten to 11:52; X23 (24 Oct 21:15) Worker 3 holding B547 and B534 both
// in progress; 31 Oct 00:54 Worker 3's card saying "QA of B813" while the store held B827. Names and words as made up as
// the cases allow.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { answer, step as toolStep, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { changes } from '../src/history.mjs'
import { buildState } from '../src/state.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { valueOf, parseItem } from '../src/work/item.mjs'
import { heldOf, lastReportedOf, sizeOf, takenAtOf } from '../src/work/held.mjs'
import { workApi } from '../src/work/api.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'

const MIN = 60_000
const at = (h, m, s = 0) => new Date(2026, 10, 2, h, m, s).getTime()
const two = n => String(n).padStart(2, '0')
const stamp = ms => { const d = new Date(ms); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}` }
const stampSec = ms => `${stamp(ms)}:${two(new Date(ms).getSeconds())}`

/** A step of the store as its file reads, with `head` lines, `history` lines and a refine `size`. */
export function stepItem(id, { title = `Title of ${id}`, state = 'in progress', owner = 'Worker 1', since = at(11, 52), size = null, history = [], head = [] } = {}) {
  return parseItem([
    `Id: ${id}`, 'Kind: step', `Title: ${title}`, `State: ${state}`, ...(owner === null ? [] : [`Owner: ${owner}`]), `Since: ${stamp(since)}`, ...head, '',
    ...(size === null ? [] : ['## Refined', '  Refined (round 1, by Advisor; ready):', `  Size: ${size}`, '']),
    '## History', ...history.map(([when, who, words]) => `- ${stamp(when)} ${who}: ${words}`), '',
  ].join('\n'))
}
const itemsOf = (...items) => new Map(items.map(one => [valueOf(one, 'Id'), one]))

/** B855 as the store held it on 2 Nov: taken 11:10, a checkpoint 11:14, its head Since rewritten to 11:52 by a later move. */
export const b855 = (more = {}) => stepItem('B855', {
  title: 'A walkable tile always shows its whole move/target square', size: 'about 2 h', since: at(11, 52),
  head: [`Checkpoint: 1a2b3c4 · committed on b855-whole-move-squares; gate running · ${stampSec(at(11, 14))}`, 'Taken for: 90 min',
    `Plan: step 4/4 | parts Read; Build; Test; Report | until ${stampSec(at(11, 54))} | at ${stampSec(at(11, 14))}`],
  history: [[at(11, 10), 'server', 'queued → taken (for Worker 1)'], [at(11, 10), 'Worker 1', 'taken → in progress'], [at(11, 14), 'Worker 1', 'step 4/4, about 40 min left'],
    [at(11, 30), 'server', 'in progress → waiting on you'], [at(11, 52), 'server', 'waiting on you → in progress']],
  ...more,
})

// The store's records: since, size, checkpoint, plan

test('B855: since is the take (11:10), never the head Since a later move rewrote (11:52)', () => {
  assert.equal(takenAtOf(b855()), at(11, 10))
  const held = heldOf(itemsOf(b855()), 'Worker 1')
  assert.equal(held.since, at(11, 10))
  assert.notEqual(held.since, at(11, 52))
  // A claim counts as the take too; a line of another chat does not.
  const claimed = stepItem('B9', { history: [[at(9, 0), 'Worker 2', 'taken → in progress'], [at(9, 30), 'Worker 1', 'claimed (in progress)']] })
  assert.equal(takenAtOf(claimed), at(9, 30))
  assert.equal(takenAtOf(stepItem('B9', { history: [] })), null)
})

test('B855: the size is the refine Size (about 2 h), else the take\'s fixed Taken for, never the Plan\'s until', () => {
  assert.equal(sizeOf(b855()), 120)
  assert.equal(sizeOf(b855({ size: null })), 90)
  assert.equal(sizeOf(stepItem('B9', { head: [`Plan: until ${stampSec(at(12, 0))} | at ${stampSec(at(11, 0))}`] })), null)
})

test('the checkpoint: commit, next clipped to 120 characters, its time; one older than the take is none', () => {
  const held = heldOf(itemsOf(b855()), 'Worker 1')
  assert.deepEqual(held.checkpoint, { commit: '1a2b3c4', next: 'committed on b855-whole-move-squares; gate running', at: at(11, 14) })
  const long = 'x'.repeat(300)
  const clipped = heldOf(itemsOf(b855({ head: [`Checkpoint: none · ${long} · ${stampSec(at(11, 14))}`] })), 'Worker 1').checkpoint.next
  assert.equal(clipped.length, 120)
  assert.ok(clipped.endsWith('…'))
  // A checkpoint of an earlier run (09:40, before the take at 11:10) belongs to that run.
  assert.equal(heldOf(itemsOf(b855({ head: [`Checkpoint: abc1234 · old run · ${stampSec(at(9, 40))}`] })), 'Worker 1').checkpoint, null)
})

test('the store\'s plan rides along as the chat\'s words: step, steps, names, when written', () => {
  assert.deepEqual(heldOf(itemsOf(b855()), 'Worker 1').plan, { step: 4, steps: 4, names: ['Read', 'Build', 'Test', 'Report'], at: at(11, 14) })
})

// Which step is held (R1, R2)

test('X23: two steps in progress: the one with the holder\'s newest activity (B534); the hand-over\'s step first', () => {
  const items = itemsOf(
    stepItem('B547', { owner: 'Worker 3', since: at(21, 10), history: [[at(20, 0), 'Worker 3', 'taken → in progress'], [at(20, 30), 'Worker 3', 'step 2/3']] }),
    stepItem('B534', { owner: 'Worker 3', since: at(20, 50), history: [[at(20, 40), 'Worker 3', 'taken → in progress'], [at(21, 12), 'Worker 3', 'step 1/2']] }),
  )
  assert.equal(heldOf(items, 'Worker 3').id, 'B534')
  // R1: the hand-over's step wins over the newest Since and the newest activity.
  assert.equal(heldOf(items, 'Worker 3', '', { handoverStep: 'B547' }).id, 'B547')
  // A hand-over step the worker does not hold is no pick.
  assert.equal(heldOf(items, 'Worker 3', '', { handoverStep: 'B999' }).id, 'B534')
})

test('in progress over waiting on you over taken; a step handed back after a failed check counts as held', () => {
  const items = itemsOf(
    stepItem('B1', { state: 'taken', history: [[at(10, 59), 'Worker 1', 'step 1/2']] }),
    stepItem('B2', { state: 'waiting on you', history: [[at(10, 58), 'Worker 1', 'step 1/2']] }),
    stepItem('B3', { state: 'in progress', history: [[at(10, 0), 'Worker 1', 'taken → in progress']] }),
  )
  assert.equal(heldOf(items, 'Worker 1').id, 'B3')
  items.delete('B3')
  assert.equal(heldOf(items, 'Worker 1').id, 'B2')
  items.delete('B2')
  assert.equal(heldOf(items, 'Worker 1').id, 'B1')
  // R2: B4 reported, its board check failed: back with its worker, still in review.
  const back = stepItem('B4', { state: 'review', history: [[at(10, 0), 'Worker 1', 'taken → in progress'], [at(10, 40), 'Worker 1', 'in progress → review'], [at(10, 45), 'server', 'check failed: the gate is red']] })
  assert.equal(heldOf(itemsOf(back), 'Worker 1').id, 'B4')
  assert.equal(heldOf(itemsOf(back), 'Worker 1').since, at(10, 0))
  // One whose check has not failed is reported, not held.
  const reported = stepItem('B4', { state: 'review', history: [[at(10, 0), 'Worker 1', 'taken → in progress'], [at(10, 40), 'Worker 1', 'in progress → review']] })
  assert.equal(heldOf(itemsOf(reported), 'Worker 1'), null)
  assert.deepEqual(lastReportedOf(itemsOf(reported), 'Worker 1'), { id: 'B4', title: 'Title of B4', at: at(10, 40) })
  // Nothing held: null.
  assert.equal(heldOf(new Map(), 'Worker 1'), null)
})

// The take's fixed record

const BACKLOG = ['# Backlog', '', '## Board work #focus', '- [ ] B1 Draw the strip (for Board)', ''].join('\n')

test('the take writes Taken for, and a later work step minutes changes the Plan\'s until only', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'held-take-'))
  const NOW = at(11, 10)
  try {
    await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW - MIN }), undefined, { now: NOW - MIN })
    const as = now => body => workApi({ chat: 'Board', ...body }, { dir, now, prefix: 'Team - ', roleOf: chat => (chat === 'Board' ? 'worker' : null), freeChats: new Set(['Board']) })
    assert.equal((await as(NOW)({ action: 'take', id: 'B1', minutes: 90 })).ok, true)
    const item = async () => (await readStore(dir)).items.get('B1')
    assert.equal(valueOf(await item(), 'Taken for'), '90 min')
    const stepped = await as(at(11, 14))({ action: 'step', id: 'B1', step: 4, steps: 4, minutes: 40 })
    assert.equal(stepped.ok, true, stepped.why)
    assert.equal(valueOf(await item(), 'Taken for'), '90 min')
    assert.match(valueOf(await item(), 'Plan'), /until 2026-11-02 11:54:00/)
    assert.equal(sizeOf(await item()), 90)
    assert.equal(takenAtOf(await item()), at(11, 10))
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

// History lines (Addendum 10)

test('a history line says source step for a worker that holds a step, null otherwise; never plan or unrecorded', () => {
  const card = { text: 'B813 QA', step: 2, steps: 3, leftMs: null, estimateAt: null, startedAt: at(0, 40), source: 'plan', by: null }
  const [held, none, unrecorded] = changes(new Map(), [
    { name: 'Worker 3', state: 'working', task: card, held: { id: 'B827' } },
    { name: 'Worker 4', state: 'working', task: card, held: null },
    { name: 'Worker 5', state: 'working', task: { ...card, text: '', source: 'unrecorded' }, held: null },
  ], at(0, 54))
  assert.equal(held.source, 'step')
  assert.equal(none.source, null)
  assert.equal(unrecorded.source, null)
})

// The lane: `held` beside the card (state.mjs)

const GOALS_WITH = id => ['Last id: G6', 'Focus: G6', '', '- [~] G6 The polish', '    Done when: you judge a fight fun', '    Goal definition: every fight reads at a glance',
  '    Goal definition agreed: 2026-10-18 10:00', `    Part: Show the squares · about 2 h · steps ${id}`, '    How agreed: 2026-10-18 11:00', ''].join('\n')
const appChat = name => JSON.stringify({ title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\garden', isArchived: false, createdAt: name.length, lastActivityAt: at(11, 0), lastAssistantUuid: 'u-1' })
/** The card a chat typed: its task's words, the step of how many, the time it said was left (ms) and when. */
export const cardOf = (text, { step = null, steps = null, names = null, left = null, at: when = at(11, 14) } = {}) => JSON.stringify({ name: 'Digger', role: 'worker', state: 'working', at: when, task: { text, step, steps, names, left } })

/**
 * The garden on 2 Nov at `now`: Lead (main), Digger (the worker) and the Advisor. Digger's turn runs (a tool call a minute
 * ago) unless `isFree`; `card` is its card, `items` the store's steps, `lines` the history.
 */
export function stateAt(now, { items = [], card = null, lines = [], isFree = false, planSeen = null, goals = null } = {}) {
  const work = storeFromText('## Garden\n- [ ] B12 Plant the hedge\n', { now: at(9, 0) })
  for (const one of items) work.items.set(valueOf(one, 'Id'), one)
  const tailOf = entries => ({ text: entries.join('\n'), isCut: false, modifiedAt: now - MIN })
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [appChat('Lead'), appChat('Digger'), appChat('Advisor')],
    tails: {
      'cli-Lead': tailOf([answer(now - 30 * MIN, 'ok')]),
      'cli-Digger': tailOf(isFree ? [typed(now - 40 * MIN, 'go'), answer(now - 20 * MIN, DONE_YES)] : [typed(now - 9 * MIN, 'go on'), toolStep(now - MIN, 'Running the tests')]),
      'cli-Advisor': tailOf([answer(now - 12 * MIN, 'ok')]),
    },
    planLineTexts: card === null ? {} : { 'cli-Digger': card }, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work, ...(goals === null ? {} : { goalsText: goals }),
  }
  return buildState(raw, { lines, outbox: [], runs: [], board: null, seen: null, now, planSeen, config: { ...parseConfig('{}', {}), project: 'C:\\garden' } })
}
const digger = state => state.chats.find(lane => lane.name === 'Digger')
/** An answer that closes its turn finished (B148). */
const DONE_YES = ['Sown.', '', '---', '', '```diff', '  Prompt: sow', '  Who:    Digger', '+ Done:   yes', '```'].join('\n')
/** B855 held by Digger (the garden's worker). */
export const b855d = (more = {}) => {
  const one = b855(more)
  one.head.set('Owner', 'Digger')
  one.sections.set('History', (one.sections.get('History') ?? []).map(line => line.replace('Worker 1', 'Digger')))
  return one
}
/** Digger's history: working from 11:10, interrupted 11:14-11:16 (B855's case), working since. */
export const B855_LINES = [
  { at: at(11, 10), chat: 'Digger', state: 'working', task: null, source: 'step' },
  { at: at(11, 14), chat: 'Digger', state: 'interrupted', task: null, source: 'step' },
  { at: at(11, 16), chat: 'Digger', state: 'working', task: null, source: 'step' },
]
export const B855_CARD = cardOf('QA of B813: check the strip', { step: 4, steps: 4, names: ['Read', 'Build', 'Test', 'Report'], left: 40 * MIN })

test('B855 at 11:16: the row\'s task is the store\'s B855 whatever the card names; 1 h 56 of its 2 h; the card stays as it was', () => {
  const state = stateAt(at(11, 16), { items: [b855d()], card: B855_CARD, lines: B855_LINES, goals: GOALS_WITH('B855') })
  const lane = digger(state)
  assert.equal(lane.held.id, 'B855')
  assert.equal(lane.held.title, 'A walkable tile always shows its whole move/target square')
  assert.equal(lane.held.since, at(11, 10))
  assert.equal(lane.held.size, 120)
  // 6 minutes since the take, 2 of them interrupted: 4 worked, 116 left; the card's 40 min is not the row's time.
  assert.equal(lane.held.eta.leftMs, 116 * MIN)
  assert.equal(lane.held.eta.from, 'size')
  assert.equal(lane.held.eta.isOver, false)
  // The card stays the card, for its readers (the card flag, the sync check, Stop task, the Supervisor rules).
  assert.match(lane.task.text, /QA of B813/)
  // B689: the step's "on it" is its store holder.
  assert.match(JSON.stringify(state.focus), /"onIt":"Digger"/)
})

test('31 Oct 00:54: the card says "QA of B813" while the store holds B827: the row says B827 and its title', () => {
  const b827 = stepItem('B827', { owner: 'Digger', title: 'Keep the cards apart', size: 'about 1 h', history: [[at(0, 30), 'Digger', 'taken → in progress']] })
  const state = stateAt(at(0, 54), { items: [b827], card: cardOf('QA of B813') })
  assert.deepEqual([digger(state).held.id, digger(state).held.title], ['B827', 'Keep the cards apart'])
})

test('a card task without a store step: held is null, no "No time", and the card stays for its readers', () => {
  const state = stateAt(at(11, 16), { card: cardOf('B12 Plant the hedge', { step: 1, steps: 2, left: 20 * MIN }) })
  const lane = digger(state)
  assert.equal(lane.state, 'working')
  assert.equal(lane.held, null)
  assert.equal(lane.isWithoutTime, false)
  assert.match(lane.task.text, /Plant the hedge/)
  // The main chat has no held step at all: its row is as it was.
  assert.equal(state.chats.find(one => one.isMain).held, undefined)
})

test('a held step without a size: "No time" while it works (B832 should prevent it)', () => {
  const bare = stepItem('B20', { owner: 'Digger', history: [[at(11, 0), 'Digger', 'taken → in progress']] })
  const lane = digger(stateAt(at(11, 16), { items: [bare] }))
  assert.equal(lane.held.size, null)
  assert.equal(lane.held.eta, null)
  assert.equal(lane.isWithoutTime, true)
})

test('overdue only past twice its size and by 10 minutes (B185); a pause and a board gap are no time worked', () => {
  const small = stepItem('B21', { owner: 'Digger', size: 'about 30 min', history: [[at(11, 10), 'Digger', 'taken → in progress']] })
  const lines = [{ at: at(11, 10), chat: 'Digger', state: 'working', task: null, source: 'step' }]
  const over = digger(stateAt(at(11, 55), { items: [small], lines })).held.eta
  assert.deepEqual([over.isOver, over.isOverdue], [true, false])
  const overdue = digger(stateAt(at(12, 21), { items: [small], lines })).held.eta
  assert.deepEqual([overdue.isOver, overdue.isOverdue], [true, true])
  const paused = [...lines, { at: at(11, 20), chat: 'Digger', state: 'suspended', task: null, source: 'step' }, { at: at(11, 50), chat: 'Digger', state: 'working', task: null, source: 'step' }]
  assert.deepEqual([digger(stateAt(at(12, 21), { items: [small], lines: paused })).held.eta.isOverdue], [false])
  const gap = [...lines, { at: at(11, 20), gap: true }, { at: at(11, 50), chat: 'Digger', state: 'working', task: null, source: 'step' }]
  assert.equal(digger(stateAt(at(12, 21), { items: [small], lines: gap })).held.eta.isOverdue, false)
})

test('its plan: the store\'s at 11:14 is current at 11:40 and stale at 11:45; a reported step shows none', () => {
  const fresh = digger(stateAt(at(11, 40), { items: [b855d()] })).held.planLine
  assert.deepEqual({ text: fresh.text, at: fresh.at, isStale: fresh.isStale, from: fresh.from }, { text: '4 of 4 · Report', at: at(11, 14), isStale: false, from: 'store' })
  assert.equal(digger(stateAt(at(11, 45), { items: [b855d()] })).held.planLine.isStale, true)
  // Handed back after a failed check (in review, still its): held, but its plan is gone with the report.
  const back = b855d({ state: 'review' })
  back.sections.set('History', [...back.sections.get('History'), `- ${stamp(at(11, 20))} Digger: in progress → review`, `- ${stamp(at(11, 25))} server: check failed: red`])
  const held = digger(stateAt(at(11, 30), { items: [back] })).held
  assert.equal(held.id, 'B855')
  assert.equal(held.planLine, null)
})

test('its plan from the card on that step is dated by the board\'s own memory of its change', () => {
  const card = cardOf('B855 squares', { step: 3, steps: 4, names: ['Read', 'Build', 'Test', 'Report'] })
  const first = stateAt(at(11, 20), { items: [b855d()], card })
  assert.deepEqual([digger(first).held.planLine.text, digger(first).held.planLine.at, digger(first).held.planLine.from], ['3 of 4 · Test', at(11, 20), 'card'])
  const later = stateAt(at(11, 51), { items: [b855d()], card, planSeen: first.planSeen })
  assert.equal(digger(later).held.planLine.at, at(11, 20))
  assert.equal(digger(later).held.planLine.isStale, true)
})

test('B148: a free worker\'s Last task is the step it reported last, not its card', () => {
  const done = stepItem('B4', { owner: 'Digger', state: 'review', title: 'Sow the lawn', history: [[at(10, 0), 'Digger', 'taken → in progress'], [at(10, 40), 'Digger', 'in progress → review']] })
  const lane = digger(stateAt(at(11, 16), { items: [done], card: cardOf('B99 something the card kept'), isFree: true }))
  assert.equal(lane.state, 'free')
  assert.equal(lane.held, null)
  assert.equal(lane.lastTask.text, 'B4 Sow the lawn')
})

test('old history lines with source plan or unrecorded still read', () => {
  const lines = [{ at: at(11, 0), chat: 'Digger', state: 'working', task: 'B12 Plant', source: 'plan', startedAt: at(10, 50), leftMs: 20 * MIN, estimateAt: at(11, 0) },
    { at: at(11, 5), chat: 'Digger', state: 'working', task: '', source: 'unrecorded', startedAt: at(11, 5) }]
  const state = stateAt(at(11, 16), { card: cardOf('B12 Plant', { left: 20 * MIN }), lines })
  assert.equal(digger(state).state, 'working')
  assert.ok(Array.isArray(state.today))
})
