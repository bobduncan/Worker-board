// Pause and resume from the store (spec 2026-10-18-pause-resume-design.md, part 1): the banner says from facts alone
// who still works, who holds a step with no checkpoint since the pause, then "Safe to restart"; after "Resume all" it
// names who has not started a turn yet, and opens the main chat when it does not run. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, line, step, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { parseItem } from '../src/work/item.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { memoryStore } from '../src/store.mjs'
import { isHolding } from '../src/work/pause.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 18, 21, 10).getTime()
const PAUSED = NOW - 9 * MIN
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const two = n => String(n).padStart(2, '0')
const stampOf = (at, seconds = false) => {
  const date = new Date(at)
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}${seconds ? `:${two(date.getSeconds())}` : ''}`
}
const held = (id, owner, checkpointAt = null) => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: in progress\nOwner: ${owner}\nSince: ${stampOf(NOW - 90 * MIN)}\n${checkpointAt === null ? '' : `Checkpoint: a1b2c3d · go on with the strip · ${stampOf(checkpointAt, true)}\n`}`)
const app = name => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 40 * MIN, lastAssistantUuid: 'u-1',
})
/** A turn that ended `ago` minutes before now. */
const ended = ago => ({ lines: [typed(NOW - (ago + 10) * MIN, 'Go on.'), step(NOW - (ago + 5) * MIN, 'Build'), answer(NOW - ago * MIN, 'Done for now.')], at: NOW - ago * MIN })
/** A turn that runs: started `ago` minutes before now, a tool call a moment ago. */
const running = ago => ({ lines: [typed(NOW - ago * MIN, 'Go on with your step.'), step(NOW - 10_000, 'Build')], at: NOW - 10_000 })

/** A background task started in a turn and not finished: a Bash call run in the background, with its id. */
const assistantRun = at => [
  line({ type: 'assistant', timestamp: new Date(at).toISOString(), message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'bg-1', name: 'Bash', input: { command: 'npm run dev', run_in_background: true } }] } }),
  line({ type: 'user', timestamp: new Date(at + 1_000).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'bg-1', content: 'Command running in background with ID: b1abc. Output is being written to: x' }] } }),
].join('\n')

const NAMES = ['Main', 'Board', 'Support']
/** Every chat's mod asked the board a moment ago: they run. */
const ALL_RUN = { shown: { Main: NOW - 5_000, Board: NOW - 5_000, Support: NOW - 5_000 }, other: {} }
const BOARD = { startedAt: NOW - 60 * MIN, offSince: null }

function build({ pause = null, steps = [held('B269', 'Board'), held('B280', 'Support')], tails = {}, outbox = [], seen = ALL_RUN, board = BOARD, restartNote = null, reports = null } = {}) {
  const work = storeFromText('## Board\n', { now: NOW - 120 * MIN })
  for (const item of steps) work.items.set(item.head.get('Id'), item)
  work.pause = pause
  const turns = { Main: ended(30), Board: ended(20), Support: ended(20), ...tails }
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: NAMES.map(app),
    tails: Object.fromEntries(NAMES.map(name => [`cli-${name}`, { text: turns[name].lines.join('\n'), isCut: false, modifiedAt: turns[name].at }])),
    planLineTexts: {},
    work, adviceText: null, folders: null, askTexts: [], pictureLists: {},
    appStartedAt: NOW - 3 * 60 * MIN, restartNote,
  }
  return buildState(raw, { lines: [], outbox, runs: [], now: NOW, config, seen, board, reports })
}
const MAIN = { name: 'Main', title: 'Game - Main', session: 'local_Main', isRunning: true, hasActed: false }

test('pausing: the banner names who still runs a turn and who holds a step with no checkpoint since the pause', () => {
  const state = build({ pause: { state: 'pausing', since: PAUSED, by: 'person' }, tails: { Board: running(15) }, steps: [held('B269', 'Board'), held('B280', 'Support', PAUSED + 2 * MIN)] })
  assert.deepEqual(state.pause, { state: 'pausing', since: PAUSED, working: ['Board'], asking: [], typing: [], unsaved: [{ chat: 'Board', id: 'B269' }], offBoard: [], isSafe: false, chats: [{ name: 'Main', state: 'still' }, { name: 'Board', state: 'working' }, { name: 'Support', state: 'still' }], main: MAIN, typedAt: null })
})

test('pausing: safe to restart once no chat runs a turn; a step held with no checkpoint since the pause is named, and blocks nothing (the review of Pause 2)', () => {
  const state = build({ pause: { state: 'pausing', since: PAUSED, by: 'person' }, steps: [held('B269', 'Board', PAUSED + MIN), held('B280', 'Support', PAUSED + 2 * MIN)] })
  assert.equal(state.pause.isSafe, true)
  assert.deepEqual([state.pause.working, state.pause.unsaved], [[], []])
  // One written before the pause is no checkpoint for it: named, and safe all the same.
  const old = build({ pause: { state: 'pausing', since: PAUSED, by: 'person' }, steps: [held('B269', 'Board', PAUSED - MIN)] }).pause
  assert.deepEqual([old.unsaved, old.isSafe], [[{ chat: 'Board', id: 'B269' }], true])
})

test('Pause 2: the old reading of a restart is gone: an old "prepare restart" word and restart.md show nothing, with pause.json or without', () => {
  const outbox = [{ id: 'p1', at: PAUSED - MIN, to: 'Main', ask: null, command: 'prepare restart', text: 'prepare restart', state: 'delivered' }]
  const old = build({ outbox, restartNote: { at: PAUSED - 30_000 } })
  for (const key of ['preparing', 'prepared', 'resuming']) assert.equal(key in old.restart, false, key)
  assert.equal(old.pause, null)
  const now = build({ outbox, restartNote: { at: PAUSED - 30_000 }, pause: { state: 'pausing', since: PAUSED, by: 'person' } })
  assert.equal(now.pause.state, 'pausing')
  // Running again: nothing of the pause shows.
  const done = build({ outbox, restartNote: { at: PAUSED - 30_000 }, pause: { state: 'running', since: NOW - MIN, by: 'server' } })
  assert.deepEqual(done.pause, { state: 'running', since: NOW - MIN, main: MAIN, typedAt: null })
})

test('resuming with the main chat not running: who has not started a turn yet, and the main chat\'s title and session for the open link', () => {
  const nobody = { shown: {}, other: {} }
  const state = build({ pause: { state: 'resuming', since: NOW - 2 * MIN, by: 'person' }, seen: nobody, board: { startedAt: NOW - 5 * MIN, offSince: NOW - 20 * MIN } })
  assert.deepEqual(state.pause, {
    state: 'resuming', since: NOW - 2 * MIN, waiting: [{ chat: 'Board', ids: ['B269'] }, { chat: 'Support', ids: ['B280'] }], isResumed: false, until: NOW + 18 * MIN,
    main: { ...MAIN, isRunning: null }, typedAt: null,
  })
})

test('resuming: done once every holder has started a turn since the resume; the board typed "resume" to a main chat that runs', () => {
  const since = NOW - 4 * MIN
  const outbox = [{ id: 'r1', at: since + 1_000, to: 'Main', ask: null, command: 'resume', text: 'resume', state: 'delivered' }]
  const half = build({ pause: { state: 'resuming', since, by: 'person' }, outbox, tails: { Board: running(2) } })
  assert.deepEqual([half.pause.waiting, half.pause.isResumed, half.pause.typedAt], [[{ chat: 'Support', ids: ['B280'] }], false, since + 1_000])
  const back = build({ pause: { state: 'resuming', since, by: 'person' }, outbox, tails: { Board: running(2), Support: { lines: [typed(NOW - 3 * MIN, 'resume your step B280 from your checkpoint'), answer(NOW - MIN, 'Back on it.')], at: NOW - MIN } } })
  assert.deepEqual([back.pause.waiting, back.pause.isResumed], [[], true])
})

const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
const html = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'index.html'), 'utf8')
const page = { clock: ms => { const at = new Date(ms); return `${two(at.getHours())}:${two(at.getMinutes())}` } }
vm.runInNewContext(`${script.slice(script.indexOf('// pause:start'), script.indexOf('// pause:end'))}\nObject.assign(this, { pauseLines, pauseRing })`, page)
/** The page's lines, as plain objects of this realm. */
const pauseLinesOf = pause => JSON.parse(JSON.stringify(page.pauseLines(pause)))

/** The page's ring of a pause, as a plain object of this realm. */
const pauseRingOf = pause => JSON.parse(JSON.stringify(page.pauseRing(pause)))

test('B364, the user\'s pick B: while pausing the panel is one ring, a slice per chat, the count of still chats in its middle, the names beside by state', () => {
  const since = new Date(2026, 9, 18, 21, 1).getTime()
  const chats = [
    { name: 'Main', state: 'still' }, { name: 'Worker 1', state: 'working' }, { name: 'Worker 2', state: 'still' },
    { name: 'Worker 3', state: 'still' }, { name: 'Worker 5', state: 'off' }, { name: 'Advisor', state: 'typing' },
  ]
  const pausing = { state: 'pausing', since, working: ['Worker 1'], asking: [], typing: ['Advisor'], unsaved: [{ chat: 'Worker 1', id: 'B09' }], offBoard: [], isSafe: false, chats, main: MAIN, typedAt: null }
  const ring = pauseRingOf(pausing)
  assert.deepEqual([ring.head, ring.tone, ring.still, ring.of], ['Pausing…', '', 3, 5])
  assert.deepEqual(ring.slices, ['still', 'working', 'still', 'still', 'off', 'typing'])
  assert.deepEqual(ring.groups, [
    { state: 'working', text: 'Worker 1' }, { state: 'typing', text: 'Advisor' },
    { state: 'still', text: 'Main, Worker 2, Worker 3' }, { state: 'off', text: 'Worker 5 (not running)' },
  ])
  // The details, one click away: since when, and each step with no checkpoint.
  assert.deepEqual(ring.notes, ['Paused since 21:01.', 'A line is being typed into Advisor.', 'B09 (Worker 1) has no checkpoint; it resumes from its branch and History.'])
  // Nobody works any more: all still, safe to restart.
  const still = chats.map(chat => ({ ...chat, state: chat.state === 'off' ? 'off' : 'still' }))
  const safe = pauseRingOf({ ...pausing, working: [], typing: [], unsaved: [], isSafe: true, chats: still })
  assert.deepEqual([safe.head, safe.tone, safe.still, safe.of, safe.isDone], ['All still: safe to restart', 'ready', 5, 5, true])
  assert.deepEqual(safe.groups, [{ state: 'still', text: 'Main, Worker 1, Worker 2, Worker 3, Advisor' }, { state: 'off', text: 'Worker 5 (not running)' }])
  assert.deepEqual(safe.notes, ['Paused since 21:01.'])
  // B442: lines the pause holds back are named beside Safe and keep nothing from it.
  const waits = pauseRingOf({ ...pausing, working: [], typing: [], unsaved: [], isSafe: true, chats: still, held: [{ chat: 'Advisor', step: 'B441' }, { chat: 'Worker 2', step: null }] })
  assert.deepEqual([waits.head, waits.notes.at(-1)], ['All still: safe to restart', '2 lines wait for the resume (Advisor: B441, Worker 2).'])
  // A chat in the app's question form waits for the person.
  assert.deepEqual(pauseRingOf({ ...pausing, chats: [{ name: 'Advisor', state: 'asking' }] }).groups, [{ state: 'asking', text: 'Advisor (waiting for you)' }])
  // The review: a server from before B364 names no chats; the ring is drawn from who still works, asks or is typed into.
  const { chats: _none, ...older } = pausing
  const old = pauseRingOf(older)
  assert.deepEqual([old.still, old.of, old.slices], [0, 2, ['working', 'typing']])
  // No ring outside a pause; the pause's lines are only those of a resume now.
  assert.equal(page.pauseRing({ state: 'resuming', since, waiting: [] }), null)
  assert.equal(page.pauseRing(null), null)
  assert.deepEqual(pauseLinesOf(pausing), [])
  assert.deepEqual(pauseLinesOf({ state: 'running', since }), [])
  assert.deepEqual(pauseLinesOf(null), [])
})

const SESSION = 'local_84e3310d-5c34-43b7-a5f4-d59006c1d556'

test('the page after Resume all: who has not started yet; "Open <main>" by its session when the main chat does not run', () => {
  const since = new Date(2026, 9, 18, 21, 30).getTime()
  const resuming = { state: 'resuming', since, waiting: [{ chat: 'Board', ids: ['B269'] }], isResumed: false, main: { ...MAIN, session: SESSION, isRunning: false }, typedAt: null }
  assert.deepEqual(pauseLinesOf(resuming), [
    { tone: '', text: 'Resuming since 21:30: not started yet: Board (B269).' },
    { tone: 'alert', text: 'Game - Main is not running: open it; its Workers mod tells it whom to wake.', link: { label: 'Open Game - Main', href: `claude://claude.ai/epitaxy/${SESSION}` } },
  ])
  // Review 5: whether it runs is not known yet (no mod has asked the board since it started): said so, with the link.
  assert.deepEqual(pauseLinesOf({ ...resuming, main: { ...resuming.main, isRunning: null } })[1].text, 'Whether Game - Main runs is not known yet: open it; its Workers mod tells it whom to wake.')
  // Review 5: a session id that is no app id (local_ and a uuid) builds no link.
  assert.equal(pauseLinesOf({ ...resuming, main: { ...resuming.main, session: 'local_Main' } })[1].link, undefined)
  assert.equal(pauseLinesOf({ ...resuming, main: { ...resuming.main, session: 'local_84e3310d"><script>' } })[1].link, undefined)
  // The main chat runs: the board typed "resume" into it, as before.
  assert.deepEqual(pauseLinesOf({ ...resuming, main: MAIN, typedAt: since + 1_000 }), [
    { tone: '', text: 'Resuming since 21:30: not started yet: Board (B269).' },
    { tone: 'muted', text: 'Typed "resume" into Main at 21:30: it wakes each chat that holds a step.' },
  ])
  // No session known for the main chat: no link, only the words.
  assert.deepEqual(pauseLinesOf({ ...resuming, main: { ...MAIN, isRunning: false, session: null } })[1], { tone: 'alert', text: 'Game - Main is not running: open it; its Workers mod tells it whom to wake.' })
})

test('review 2: the page names a held step whose chat is not on the board, by its title (beside Safe, the review of Pause 2)', () => {
  const since = new Date(2026, 9, 18, 21, 1).getTime()
  const pausing = { state: 'pausing', since, working: [], asking: [], typing: [], unsaved: [], offBoard: [{ chat: 'Ghost', id: 'B2', title: 'Game - Ghost' }], isSafe: true, chats: [], main: MAIN, typedAt: null }
  const ring = pauseRingOf(pausing)
  assert.equal(ring.head, 'All still: safe to restart')
  assert.deepEqual(ring.notes, ['Paused since 21:01.', 'B2 (Game - Ghost, not on the board) has no checkpoint; it resumes from its branch and History.'])
})

test('review 2 and 3: the state names an off-board holder, and background work as working', () => {
  const ghost = build({ pause: { state: 'pausing', since: PAUSED, by: 'person' }, steps: [held('B9', 'Ghost')] })
  assert.deepEqual([ghost.pause.offBoard, ghost.pause.isSafe], [[{ chat: 'Ghost', id: 'B9', title: 'Game - Ghost' }], true])
  const background = { lines: [typed(NOW - 30 * MIN, 'Go on.'), assistantRun(NOW - 25 * MIN), answer(NOW - 20 * MIN, 'Started the server.')], at: NOW - 20 * MIN }
  const state = build({ pause: { state: 'pausing', since: PAUSED, by: 'person' }, steps: [], tails: { Board: background } })
  assert.equal(state.chats.find(chat => chat.name === 'Board').heldBy, 'background')
  assert.deepEqual(state.pause.working, ['Board'])
})

test('review 4: after a cycle (pause.json says running) "Resume all" for chats cut off shows again; review 5: End resume while resuming', () => {
  assert.match(script, /\(pause === null \|\| pause\.state === 'running'\) && restart\.interrupted\.length > 0/)
  assert.match(script, /button\('End resume', 'is-quiet', 'end-resume'\)/)
  assert.match(script, /sendWork\(\{ action: 'end-resume' \}, 'restart'\)/)
})

test('the page: "Pause all" replaces "Prepare restart"; both switches write pause.json through the page\'s work API', () => {
  assert.match(html, /id="pause-all"[^>]*>Pause all</)
  assert.doesNotMatch(html, /Prepare restart/)
  assert.match(script, /sendWork\(\{ action: 'pause-all' \}, 'restart'\)/)
  assert.match(script, /sendWork\(\{ action: 'resume-all' \}, 'restart'\)/)
})

test('B442: a line the pause holds back is not typing: safe to restart, the line named; a line already being typed still blocks; after the resume it is typed once', async () => {
  const pause = { state: 'pausing', since: PAUSED, by: 'person' }
  const refine = { id: 'h1', at: PAUSED + MIN, to: 'Support', ask: null, command: 'work', step: 'B441', text: 'work: B441 is yours; run work next', state: 'waiting' }
  const state = build({ pause, outbox: [refine] })
  assert.deepEqual([state.pause.isSafe, state.pause.typing], [true, []])
  assert.deepEqual(state.pause.held, [{ chat: 'Support', step: 'B441' }])
  assert.deepEqual(state.pause.chats.find(chat => chat.name === 'Support'), { name: 'Support', state: 'still' })
  // Handed before the pause and typed (taken): it starts a turn, so it blocks, as before.
  const taken = build({ pause, outbox: [{ ...refine, at: PAUSED - MIN, state: 'taken', takenAt: NOW - MIN }] })
  assert.deepEqual([taken.pause.isSafe, taken.pause.typing, 'held' in taken.pause], [false, ['Support'], false])
  // The second half: the pause hands nothing out; at the resume the line is typed once, and a second take finds none.
  const keep = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN }
  const resuming = { state: 'resuming', since: NOW, by: 'person', pausedSince: PAUSED }
  const outbox = memoryStore()
  await outbox.say({ ...refine })
  assert.deepEqual(await outbox.take('Support', NOW - MIN, { ...keep, pause }, message => message.command === 'resume'), [])
  const once = await outbox.take('Support', NOW + MIN, { ...keep, pause: resuming }, isHolding(resuming) ? () => false : undefined)
  assert.deepEqual(once.map(one => one.id), ['h1'])
  assert.deepEqual(await outbox.take('Support', NOW + 2 * MIN, { ...keep, pause: resuming }, isHolding(resuming) ? () => false : undefined), [])
})

// The person, 2026-10-28 ("adisor seems finished, why is that one still showing as running?"): a word the chat took started
// a turn; once the chat's own report says that turn ended after the take, it no longer counts as typing.
test('pausing: a word a chat took counts as typing until the chat reports its turn ended after it', () => {
  const pause = { state: 'pausing', since: PAUSED, by: 'person' }
  const word = { id: 'w1', at: NOW - 4 * MIN, takenAt: NOW - 3 * MIN, to: 'Support', command: 'work', text: 'work: Q1 is yours', state: 'taken' }
  assert.deepEqual(build({ pause, outbox: [word] }).pause.typing, ['Support'])
  const idleAfter = new Map([['Support', { state: 'idle', since: NOW - MIN, at: NOW - MIN, background: false, session: 'cli-Support' }]])
  assert.deepEqual(build({ pause, outbox: [word], reports: idleAfter }).pause.typing, [])
  // Idle since before the take: the word's turn may still run.
  const idleBefore = new Map([['Support', { state: 'idle', since: NOW - 5 * MIN, at: NOW - MIN, background: false, session: 'cli-Support' }]])
  assert.deepEqual(build({ pause, outbox: [word], reports: idleBefore }).pause.typing, ['Support'])
})

// The person, 2026-10-28 ("i expect red mean unexpected ... pausing is better to have it purple, suspended").
test('the page: while pausing, a chat stopped with its task open at its checkpoint shows suspended by the pause; one with no checkpoint stays interrupted', async () => {
  const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
  const source = name => script.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}$`, 'm'))[0]
  const ctx = { LIMIT_NAMES: {}, clock: () => '' }
  vm.runInNewContext(`${source('pausedLanes')}\n${source('heldText')}\nthis.pausedLanes = pausedLanes; this.heldText = heldText`, ctx)
  const chats = [{ name: 'Worker 1', state: 'interrupted' }, { name: 'Worker 2', state: 'interrupted' }, { name: 'Worker 3', state: 'working' }]
  const pausing = { state: 'pausing', since: PAUSED, unsaved: [{ chat: 'Worker 2', id: 'B2' }] }
  const shown = ctx.pausedLanes(chats, pausing)
  assert.deepEqual(shown.map(lane => lane.state), ['suspended', 'interrupted', 'working'])
  assert.equal(shown[0].suspended.by, 'pause')
  assert.equal(ctx.heldText(shown[0].suspended), 'Paused by you · stopped at its checkpoint; goes on at Resume all')
  // Not pausing: nothing changes.
  assert.deepEqual(ctx.pausedLanes(chats, { state: 'running' }).map(lane => lane.state), ['interrupted', 'interrupted', 'working'])
})

