// Pause truth (2026-11-05, the person's real pause: Pause all on since 2026-11-04 23:36, the PC slept until 08:15, the app
// restarted). The page and the board told things that were not so. The real case is read from the board's own state of that
// day (test/fixtures/pause-2026-11-05/state-4310-trimmed.json: the live /api/state, thinned to what these tests read).
// One test per item; a mutant of each is killed by the test named in its comment.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, step, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { parseItem } from '../src/work/item.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { workApi } from '../src/work/api.mjs'
import { chatsWithoutProcess } from '../src/work/pause.mjs'
import { readStore, share } from '../src/work/store.mjs'
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

// ---- Item 3: the popup ask of a chat that is gone, on a step that is done (the real Q629 / Q632 / B966, words kept).
const popupAsk = (id, of, owner, extra = '') => [
  `Id: ${id}`, 'Kind: ask', 'Title: A popup in its chat may wait for you: it has tried to use ccd directory (change directory) (lava-tactics-project) for over a minute.',
  'State: open', `Owner: ${owner}`, 'Activity: Look: make the game compare to the reference pictures', 'Since: 2026-11-04 11:16', 'Filed: 1793787409459',
  'Asks: do', 'Blocking: no', `Of: ${of}`, 'Via: form', 'Route: person', extra, '', '## Text',
  'A popup in its chat may wait for you: it has tried to use ccd directory (change directory) (lava-tactics-project) for over a minute. Open its chat and look.', '',
  '## History', '- 2026-11-04 11:16 Worker 5: asked (do, with the app\'s question form)', '- 2026-11-04 11:16 server: autopilot: routed to person', '',
].join('\n')
const stepFile = (id, state, owner) => [
  `Id: ${id}`, 'Kind: step', 'Title: Fix: First look on the Terraces v5 and the Moat Keep', `State: ${state}`, `Owner: ${owner}`, 'Activity: Look: make the game compare to the reference pictures', 'Goal: G60', 'Since: 2026-11-04 18:06', 'Branch: b-x', '',
  '## History', '- 2026-11-04 18:06 Worker 5: in progress → done', '',
].join('\n')
const formAsk = (id, of, owner) => popupAsk(id, of, owner).replace(/A popup in its chat may wait for you: it has tried to use ccd directory \(change directory\) \(lava-tactics-project\) for over a minute\./g, 'Which of the three paintings do you want?')

async function popupStore(files) {
  const dir = await mkdtemp(join(tmpdir(), 'pause-truth-'))
  for (const [id, text] of Object.entries(files)) await writeFile(join(dir, `${id}.md`), text)
  await writeFile(join(dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Look: make the game compare to the reference pictures', steps: Object.keys(files).filter(id => id.startsWith('B')) }] }, null, 1)}\n`)
  return dir
}
const ROLES = { Main: 'main', 'Worker 5': 'worker', Advisor: 'advisor' }
const sweep = (dir, gone = []) => workApi({ action: 'popup-asks', gone }, { dir, now: NOW, prefix: '', roleOf: chat => ROLES[chat] ?? null, chats: Object.keys(ROLES), as: 'server', recaps: [] })
const stateOfAsk = async (dir, id) => (await readStore(dir)).items.get(id).head.get('State')

// Mutants: the done-step rule left out; the no-process rule left out; every popup withdrawn; any form ask withdrawn.
test('item 3: a popup ask whose step is done is withdrawn, with its why (the real Q629 and Q632)', async () => {
  share.ms = 0
  const dir = await popupStore({ Q629: popupAsk('Q629', 'B966', 'Worker 5'), Q632: popupAsk('Q632', 'B966', 'Worker 5'), B966: stepFile('B966', 'done', 'Worker 5') })
  try {
    const done = await sweep(dir)
    assert.equal(done.ok, true, done.why)
    assert.deepEqual(done.result.withdrawn, ['Q629', 'Q632'])
    assert.equal(await stateOfAsk(dir, 'Q629'), 'withdrawn')
    const history = (await readStore(dir)).items.get('Q629').sections.get('History').join('\n')
    assert.match(history, /withdrawn: the popup cannot wait any more: its step B966 is done/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('item 3: a popup ask of a chat with no process is withdrawn although its step is open; one of a chat that runs stays', async () => {
  share.ms = 0
  const files = { Q700: popupAsk('Q700', 'B967', 'Worker 5'), B967: stepFile('B967', 'in progress', 'Worker 5') }
  const dir = await popupStore(files)
  try {
    // Nobody is named as gone: the chat may run, and the step is open: the ask stays.
    assert.deepEqual((await sweep(dir, [])).result.withdrawn, [])
    assert.equal(await stateOfAsk(dir, 'Q700'), 'open')
    // Another chat is gone: not this one.
    assert.deepEqual((await sweep(dir, ['Worker 1'])).result.withdrawn, [])
    const done = await sweep(dir, ['Worker 5'])
    assert.deepEqual(done.result.withdrawn, ['Q700'])
    assert.match((await readStore(dir)).items.get('Q700').sections.get('History').join('\n'), /its chat Worker 5 has no process/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('item 3: a real question of the app\'s form is never withdrawn by this, and a done step does not withdraw an ask of another kind', async () => {
  share.ms = 0
  const dir = await popupStore({ Q701: formAsk('Q701', 'B966', 'Worker 5'), B966: stepFile('B966', 'done', 'Worker 5') })
  try {
    assert.deepEqual((await sweep(dir, ['Worker 5'])).result.withdrawn, [])
    assert.equal(await stateOfAsk(dir, 'Q701'), 'open')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('item 3: the chats without a process are read from the real state: all six were closed since the restart; an unknown one is not named', async () => {
  const state = await realCase()
  assert.deepEqual(chatsWithoutProcess(state.chats).sort(), ['Main', 'Worker 1', 'Worker 2', 'Worker 3', 'Worker 4', 'Worker 5'])
  assert.deepEqual(chatsWithoutProcess([{ name: 'Worker 7', isRunning: null }, { name: 'Worker 8', isRunning: true }, { name: 'Worker 9' }]), [])
})

// ---- Item 4: Main's real "Last" line.
const detailsOf = async (page, name) => {
  await page.click(`.lane-menu[data-lane="${name}"]`)
  return page.all('.lane.is-paused .more li, .lane .more li').map(one => one.textContent)
}

// Mutants: the note left out; the note said without the pause; the note said for a step that is not on the ready list.
test('item 4: Main\'s last line promised B1050 to Worker 3; while the pause holds it the card says it is not handed out', async () => {
  const state = await realCase()
  const main = state.chats.find(one => one.name === 'Main')
  assert.equal(main.statusDetail, 'Worker 3 running again; will pick up B1050')
  assert.ok(state.readyList.ready.some(one => one.id === 'B1050'))
  const page = await openPage({ state, now: state.readAt })
  try {
    const lines = await detailsOf(page, 'Main')
    assert.ok(lines.includes('Last: Worker 3 running again; will pick up B1050'), lines.join(' | '))
    assert.ok(lines.includes('B1050 is not handed out yet: the pause holds it; it goes out after Resume all.'), lines.join(' | '))
  } finally { await page.close() }
})

test('item 4: no such note once the step was taken (not on the ready list), or when no pause holds', async () => {
  const taken = await realCase()
  taken.readyList = { ...taken.readyList, ready: [] }
  const a = await openPage({ state: taken, now: taken.readAt })
  try {
    assert.ok(!(await detailsOf(a, 'Main')).some(line => line.includes('not handed out')))
  } finally { await a.close() }
  const running = await realCase()
  running.pause = { state: 'running', since: running.pause.since }
  const b = await openPage({ state: running, now: running.readAt })
  try {
    assert.ok(!(await detailsOf(b, 'Main')).some(line => line.includes('not handed out')))
  } finally { await b.close() }
})
