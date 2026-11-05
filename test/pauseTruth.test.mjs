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
import { gapsOf, lastByChat, parseHistory, today } from '../src/history.mjs'
import { fileStore, tick } from '../src/store.mjs'
import { incidentCards } from '../src/supervisor/cards.mjs'
import { createSupervisor } from '../src/supervisor/index.mjs'
import { chatsWithoutProcess, pauseFacts } from '../src/work/pause.mjs'
import { replacedChats } from '../src/replacedChats.mjs'
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

// ---- Item 5: the trial board (no chats) answers, and its history ended in a gap line (the real tail of its history.jsonl).
// Mutants: the ran line not written; the ran line written after a chat line too; the gap read open although a ran line follows.
test('item 5: a board that answers closes its gap at its next own look, not at "now"', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pause-truth-trial-'))
  try {
    const tail = await readFile(join(HERE, 'fixtures', 'pause-2026-11-05', 'trial-history-tail.jsonl'), 'utf8')
    const gapAt = 1793832280703
    await writeFile(join(dir, 'history.jsonl'), tail)
    // The board ran after the gap line (its heartbeat), and runs now: it was up when it was asked.
    const startAt = gapAt + 8 * 60 * 60_000
    await writeFile(join(dir, 'alive.json'), JSON.stringify({ at: startAt - 20_000 }))
    const store = await fileStore(dir, startAt)
    // Before its first look the gap still reads open, as the real state showed it ("from 23:44 until now").
    assert.deepEqual(gapsOf(store.lines(), startAt + 30_000).at(-1), { from: gapAt, to: startAt + 30_000 })
    await tick(store, { chats: [] }, startAt + 30_000)
    // From its first look the gap ends there, however long the board goes on without a chat line.
    const later = startAt + 30_000 + 5 * 60_000
    for (const at of [1, 2, 3, 4, 5]) await tick(store, { chats: [] }, startAt + 30_000 + at * 60_000)
    const gaps = gapsOf(store.lines(), later, later - 1000)
    assert.deepEqual(gaps.at(-1), { from: gapAt, to: startAt + 30_000 })
    assert.equal(gaps.filter(gap => gap.to > startAt + 30_000).length, 0)
    // The line is written once: ticks after it add nothing.
    assert.equal(store.lines().filter(line => line.ran === true).length, 1)
    assert.equal((await readFile(join(dir, 'history.jsonl'), 'utf8')).split('\n').filter(line => line.includes('"ran":true')).length, 1)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('item 5: a ran line is no chat line: it is read back, and it changes no chat\'s last state', async () => {
  const lines = parseHistory('{"at":1,"chat":"Worker 1","state":"working","task":"B1 x"}\n{"at":5,"gap":true}\n{"at":9,"ran":true}\n')
  assert.deepEqual(lines.map(line => line.ran === true ? 'ran' : line.gap === true ? 'gap' : line.chat), ['Worker 1', 'gap', 'ran'])
  assert.equal(lastByChat(lines).size, 0, 'a gap forgets every chat; the ran line adds none')
  assert.deepEqual(gapsOf(lines, 20), [{ from: 5, to: 9 }])
  assert.deepEqual(today(lines, { from: 0, to: 20, names: ['Worker 1'] })[0].spans, [{ from: 1, to: 5, state: 'working', task: 'B1 x' }])
})

// ---- Item 6: the supervisor's cards of B1042 and B1051 (state "new": refine word to the Advisor held by the pause).
const realStep = (id, title, since) => parseItem(`Id: ${id}\nKind: step\nTitle: ${title}\nPriority: fix\nState: new\nActivity: Worker board for any project (B126)\nSince: ${since}\n\n## History\n- ${since} Supervisor: made\n`)
const incidentOf = id => ({ id, title: `Incident ${id}`, state: 'fix', fix: null, source: 'sweep', subject: 'board', count: 3, firstSeen: NOW - 900 * MIN, lastSeen: NOW - 800 * MIN, since: NOW - 800 * MIN, evidence: null, ruleWanted: null })
const realItems = () => new Map([
  ['B1042', realStep('B1042', 'Fix of X152: chain-long must find "Tried before:" anywhere in the newest fix', '2026-11-04 22:29')],
  ['B1051', realStep('B1051', 'Fix of X153: free Worker 4 gets no hand-over for a ready check step (B1050)', '2026-11-04 23:35')],
])
const chipsOf = cards => Object.fromEntries(cards.map(card => [card.step, card.state.text]))

// Mutants: the pause not passed on; the words for a step that is not new changed.
test('item 6: while the pause holds, B1042 and B1051 wait for Resume all, not for the Advisor', () => {
  const state = { incidents: [incidentOf('X152'), incidentOf('X153')], items: realItems() }
  assert.deepEqual(chipsOf(incidentCards({ ...state, isPaused: true })), { B1042: 'new · waits for Resume all', B1051: 'new · waits for Resume all' })
  // Not paused: the Advisor, as before.
  assert.deepEqual(chipsOf(incidentCards({ ...state, isPaused: false })), { B1042: 'new · waits for the Advisor', B1051: 'new · waits for the Advisor' })
  assert.deepEqual(chipsOf(incidentCards(state)), { B1042: 'new · waits for the Advisor', B1051: 'new · waits for the Advisor' })
})

test('item 6: the supervisor view passes the pause on, from the real X152 / X153 / B1042 / B1051 records', () => {
  const x = (id, step, key) => parseItem(`Id: ${id}
Kind: incident
Title: Real ${id}
State: fix
Source: chain-long
Subject: B924
Key: ${key}
Since: 2026-11-04 22:29
First seen: 2026-11-04 22:18
Last seen: 2026-11-04 22:45
Count: 9
Fix: ${step}
Evidence: the chain

## History
- 2026-11-04 22:29 Supervisor: fix ${step}
`)
  const items = realItems()
  items.set('X152', x('X152', 'B1042', 'chain-long B924 B1031'))
  items.set('X153', x('X153', 'B1051', 'ready-while-free Worker 4'))
  const ports = {
    state: async () => ({ chats: [], chatPrefix: '', limits: {}, pause: null }), items: async () => items, outbox: () => [], refused: () => [], apply: async () => ({ ok: true }),
    wake: async () => ({ id: 'w' }), noted: { load: async () => ({ noted: [], seen: {} }), save: async () => {} }, now: () => NOW, owns: async () => true,
    loops: { run: async (_name, run) => run(), failed: () => {} }, closing: () => false, settings: {},
  }
  const view = pause => createSupervisor(ports).view(NOW, { items, lanes: [], pause })
  assert.deepEqual(chipsOf(view({ state: 'pausing', since: PAUSED_AT }).cards), { B1042: 'new · waits for Resume all', B1051: 'new · waits for Resume all' })
  assert.deepEqual(chipsOf(view({ state: 'resuming', since: PAUSED_AT }).cards), { B1042: 'new · waits for the Advisor', B1051: 'new · waits for the Advisor' })
  assert.deepEqual(chipsOf(view(null).cards), { B1042: 'new · waits for the Advisor', B1051: 'new · waits for the Advisor' })
})

// ---- Item 7: the pause's notes about steps in review (18 of the real 20 notes said "resumes from its branch and History").
const notesOf = page => page.window.document.querySelector('#restart').textContent

// Mutants: `inReview` not written by the board; the page's words for it left as before.
test('item 7: the board marks a held step that is in review, the real 18 of 20 notes were of such steps', () => {
  const live = [held('B851', 'Worker 1', 'review'), held('B1020', 'Worker 1', 'review'), held('B1031', 'Worker 5', 'review'), held('B2000', 'Worker 2', 'in progress')]
  const items = new Map(live.map(one => [one.head.get('Id'), one]))
  const lanes = ['Worker 1', 'Worker 2', 'Worker 5'].map(name => ({ name, state: 'free', isRunning: false }))
  const facts = pauseFacts({ pause: { state: 'pausing', since: PAUSED_AT }, items, lanes, prefix: '' })
  assert.deepEqual(facts.unsaved, [
    { chat: 'Worker 1', id: 'B851', inReview: true }, { chat: 'Worker 1', id: 'B1020', inReview: true }, { chat: 'Worker 5', id: 'B1031', inReview: true },
    { chat: 'Worker 2', id: 'B2000' },
  ].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })))
})

test('item 7: the page words a step in review as the review goes on, and another step as before', async () => {
  const state = await realCase()
  state.pause = { ...state.pause, unsaved: [...state.pause.unsaved.map(one => ({ ...one, inReview: true })), { chat: 'Worker 2', id: 'B2000' }] }
  const page = await openPage({ state, now: state.readAt })
  try {
    const text = notesOf(page)
    assert.match(text, /B851 \(Worker 1\) is in review and has no checkpoint; no chat resumes it, its check goes on after Resume all\./)
    assert.match(text, /B2000 \(Worker 2\) has no checkpoint; it resumes from its branch and History\./)
    assert.equal((text.match(/resumes from its branch/g) ?? []).length, 1, 'only the step in progress resumes from its branch')
  } finally { await page.close() }
})

// ---- Item 8: the leftover Worker 3 card of the real case ("answer B982", a step done 2026-11-04 22:18).
// Mutants: the done-step rule left out; any named step counts (some, not every); an unknown step counts as ended.
test('item 8: a leftover whose summary names only steps that are done is no reason to keep it; an open or unknown one is', async () => {
  const state = await realCase()
  const leftover = state.chats.find(one => one.isLeftover === true && one.name === 'Worker 3')
  assert.equal(leftover.needsAction, 'answer B982: http://127.0.0.1:4310/#details=B982')
  // The newer Worker 3 has come back (running, its mod reported): the case after the person's Resume all.
  const back = state.chats.map(one => (one.name === 'Worker 3' && one.isLeftover !== true ? { ...one, isRunning: true, asleep: false } : one))
  const named = stepState => replacedChats({ lanes: back, now: state.readAt, stepState }).map(one => one.session)
  assert.deepEqual(named(id => (id === 'B982' ? 'done' : null)), [leftover.appSession])
  assert.deepEqual(named(id => (id === 'B982' ? 'dropped' : null)), [leftover.appSession])
  // The step is still open: the chat may hold live work.
  assert.deepEqual(named(id => (id === 'B982' ? 'in progress' : null)), [])
  assert.deepEqual(named(id => (id === 'B982' ? 'waiting on you' : null)), [])
  // The store does not know the step (unread or gone): nothing is guessed.
  assert.deepEqual(named(() => null), [])
  // Today's behaviour stands without a store.
  assert.deepEqual(replacedChats({ lanes: back, now: state.readAt }), [])
  // Two steps named, one still open: kept.
  const two = back.map(one => (one.isLeftover === true && one.name === 'Worker 3' ? { ...one, needsAction: 'answer B982 and B983' } : one))
  assert.deepEqual(replacedChats({ lanes: two, now: state.readAt, stepState: id => (id === 'B982' ? 'done' : 'review') }), [])
  // Words naming no step keep it, as before.
  const words = back.map(one => (one.isLeftover === true && one.name === 'Worker 3' ? { ...one, needsAction: 'Answer the question' } : one))
  assert.deepEqual(replacedChats({ lanes: words, now: state.readAt, stepState: () => 'done' }), [])
})

test('item 8: a newer chat that does not run keeps the leftover, as it should: nothing proves it holds the lane', async () => {
  const state = await realCase()
  assert.deepEqual(replacedChats({ lanes: state.chats, now: state.readAt, stepState: () => 'done' }), [])
})
