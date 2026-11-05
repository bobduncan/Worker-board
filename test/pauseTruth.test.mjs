// Pause truth (2026-11-05, the person's real pause: Pause all on since 2026-11-04 23:36, the PC slept until 08:15, the app
// restarted). The page and the board told things that were not so. The real case is read from the board's own state of that
// day (test/fixtures/pause-2026-11-05/state-4310-trimmed.json: the live /api/state, thinned to what these tests read).
// One test per item; a mutant of each is killed by the test named in its comment.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, step, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { parseItem } from '../src/work/item.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { openPage } from './pageHarness.mjs'
import { buildState } from './withStore.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const realCase = async () => JSON.parse(await readFile(join(HERE, 'fixtures', 'pause-2026-11-05', 'state-4310-trimmed.json'), 'utf8'))

/** The classes of the day bars of one chat's row on the page. */
const barsOf = (page, name) => {
  const row = page.all('#timeline .row').find(one => one.querySelector('.row-name')?.textContent === name)
  return [...row.querySelectorAll('.span')].map(one => one.className.replace(/^span /, ''))
}

// Item 1 (mutant: pausedToday left out of the page's read, or a bar drawn `interrupted` again).
test('item 1: the day bars of the chats the cards show as Paused are drawn Paused, not Stopped', async () => {
  const state = await realCase()
  const page = await openPage({ state, now: state.readAt })
  try {
    // The cards: the real case's six chats are all Paused.
    assert.equal(page.all('.lane.is-paused').length, 6)
    for (const name of ['Worker 1', 'Worker 2', 'Worker 5']) {
      assert.deepEqual(barsOf(page, name), ['is-suspended'], `${name}'s bar`)
    }
    // A chat that was free stays a free bar.
    assert.deepEqual(barsOf(page, 'Worker 3'), ['is-free'])
    // The bars say it in words too, for the hover: "Paused", never "Stopped".
    const titles = page.all('#timeline .span').map(one => one.title)
    assert.ok(titles.some(title => title.startsWith('Paused')))
    assert.ok(!titles.some(title => title.startsWith('Stopped')))
  } finally { await page.close() }
})

// Item 1, the part before the pause: a stop that began before the pause stays a stop up to the pause's start.
test('item 1: a stop before the pause is still drawn Stopped; from the pause on it is Paused', async () => {
  const state = await realCase()
  const since = state.pause.since
  state.today = state.today.map(lane => (lane.chat === 'Worker 1' ? { ...lane, spans: [{ from: since - 3_600_000, to: state.readAt, state: 'interrupted', task: 'B1046 x' }] } : lane))
  state.day = { ...state.day, from: since - 3_600_000 }
  const page = await openPage({ state, now: state.readAt })
  try {
    assert.deepEqual(barsOf(page, 'Worker 1'), ['is-interrupted', 'is-suspended'])
  } finally { await page.close() }
})

// ---- A board built from made-up records, in the shape of the real case (the PC slept; the app restarted; the chats' own
// files were touched by the restart, not by any work of theirs).
const MIN = 60_000
const NOW = new Date(2026, 10, 5, 14, 22).getTime()
const PAUSED_AT = new Date(2026, 10, 4, 23, 36).getTime()
const RESTART_AT = new Date(2026, 10, 5, 8, 15).getTime()
const LAST_REAL = new Date(2026, 10, 4, 23, 38).getTime()
const SAID_AT = new Date(2026, 10, 4, 23, 38, 25).getTime()
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const NAMES = ['Main', 'Board']
const appJson = name => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: LAST_REAL, lastAssistantUuid: 'u-1' })
const stampOf = at => {
  const date = new Date(at)
  const two = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}
const held = (id, owner, state = 'in progress') => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\nOwner: ${owner}\nSince: ${stampOf(NOW - 20 * 60 * MIN)}\n`)
const TASK = 'Long Ledge painted three ways'

/**
 * The board of the real case: one worker, Board, whose turn was cut at 23:38 by the PC's sleep. The app's restart at 08:15
 * appended a `cost-state` line to its transcript (so the file's own time is 08:15) and the Workers mod rewrote its card
 * (`at` 08:15) with the same plan it held. The history knows the plan as it was said at 23:38.
 */
function realBoard({ pause = { state: 'pausing', since: PAUSED_AT, by: 'person' }, steps = [held('B269', 'Board')], leftMs = 6_574_399, historyLeftMs = 6_574_399, lines = null, outbox = [], reports = new Map(), writeAfter = null } = {}) {
  const work = storeFromText('## Board\n', { now: NOW - 1200 * MIN })
  for (const item of steps) work.items.set(item.head.get('Id'), item)
  work.pause = pause
  const board = { text: [typed(LAST_REAL - 10 * MIN, 'Go on.'), step(LAST_REAL - 5 * MIN, 'Build'), step(LAST_REAL, 'Build'), ...(writeAfter === null ? [] : [step(writeAfter, 'Build')]), JSON.stringify({ type: 'cost-state', sessionId: 'cli-Board', totalCostUSD: 4.5 })].join('\n'), isCut: false, modifiedAt: (writeAfter ?? RESTART_AT) + 7_000 }
  const main = { text: [typed(LAST_REAL - 30 * MIN, 'Go on.'), answer(LAST_REAL - 25 * MIN, 'Done for now.')].join('\n'), isCut: false, modifiedAt: LAST_REAL - 25 * MIN }
  const card = JSON.stringify({ name: 'Board', role: 'worker', state: 'waiting', task: { text: TASK, step: 5, steps: 6, left: leftMs, isReported: false }, at: RESTART_AT + 8_000, mod: '0.31.0' })
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: NAMES.map(appJson),
    tails: { 'cli-Main': main, 'cli-Board': board },
    planLineTexts: { 'cli-Board': card },
    planLineAt: { 'cli-Board': RESTART_AT + 8_000 },
    work, adviceText: null, folders: null, askTexts: [], pictureLists: {},
    appStartedAt: RESTART_AT, restartNote: null,
  }
  const history = lines ?? [
    { at: SAID_AT, chat: 'Board', state: 'interrupted', task: TASK, step: 5, steps: 6, leftMs: historyLeftMs, estimateAt: SAID_AT, startedAt: LAST_REAL - 90 * MIN, source: 'step', by: null },
    { at: SAID_AT + 6 * MIN, gap: true },
  ]
  // Every chat's mod reported at the restart: asleep (its process ended with its turn cut).
  const seen = { shown: { Main: NOW - 5_000, Board: NOW - 5_000 }, other: {} }
  return buildState(raw, { lines: history, outbox, runs: [], now: NOW, config, seen, board: { startedAt: RESTART_AT, offSince: null }, reports })
}
const laneOf = (state, name) => state.chats.find(one => one.name === name)

// Item 2 (mutants: lastActivityAt back to the file's own time; the estimate back to the card's `at`).
test('item 2: a card never says "last activity" or "said ... left" at the time of the app restart', () => {
  const state = realBoard()
  const lane = laneOf(state, 'Board')
  // Its real last activity was its last entry (23:38), not the 08:15 touch of the file by the restart.
  assert.equal(lane.lastActivityAt, LAST_REAL, `last activity ${new Date(lane.lastActivityAt).toISOString()}`)
  // The estimate was said at 23:38 (the history knew it); the card was only rewritten at 08:15 with the same plan.
  assert.equal(lane.task.leftMs, 6_574_399)
  assert.equal(lane.task.estimateAt, SAID_AT, `estimate said ${new Date(lane.task.estimateAt).toISOString()}`)
})

test('item 2: a plan the chat renewed (another time left) is a new estimate, said when the card says', () => {
  const state = realBoard({ leftMs: 3_000_000 })
  const lane = laneOf(state, 'Board')
  assert.equal(lane.task.leftMs, 3_000_000)
  assert.equal(lane.task.estimateAt, RESTART_AT + 8_000)
})

test('item 2: a chat that really wrote after the restart is active then (the entry itself, not the file)', () => {
  const wrote = RESTART_AT + 3 * MIN
  const lane = laneOf(realBoard({ writeAfter: wrote }), 'Board')
  assert.equal(lane.lastActivityAt, wrote)
})

test('item 2: a history that already holds the wrong restart time is read back to the estimate\'s first line', () => {
  // The live history of the real case: the look after the restart (08:15:10) repeated the card's rewritten time.
  const lines = [
    { at: SAID_AT, chat: 'Board', state: 'interrupted', task: TASK, step: 5, steps: 6, leftMs: 6_574_399, estimateAt: SAID_AT, startedAt: LAST_REAL - 90 * MIN, source: 'step', by: null },
    { at: SAID_AT + 6 * MIN, gap: true },
    { at: RESTART_AT + 10_000, chat: 'Board', state: 'interrupted', task: TASK, step: 5, steps: 6, leftMs: 6_574_399, estimateAt: RESTART_AT + 8_000, startedAt: LAST_REAL - 90 * MIN, source: 'step', by: null },
  ]
  assert.equal(laneOf(realBoard({ lines }), 'Board').task.estimateAt, SAID_AT)
})
