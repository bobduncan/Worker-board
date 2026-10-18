// B315: the moment right after the Claude app was quit and opened again. No chat's process runs until its chat is
// opened (or a message reaches it through the app), so a word the board sends is only copied for the person to paste;
// and the workers' cards still say "working" from before the quit. Seen live 2026-10-18 16:32: "Resume all" was
// copied, nothing said so plainly, and nobody resumed for ten minutes; the Overview showed four workers "Working"
// while Needs your attention said three of them held a step but were not working. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, step, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { appStartedAt } from '../src/sources.mjs'
import { isStaleWork } from '../src/state.mjs'
import { parseItem } from '../src/work/item.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 18, 16, 40).getTime()
/** The app was opened again at 16:23, the board a little later. */
const APP = NOW - 17 * MIN
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }

const sinceOf = at => {
  const date = new Date(at)
  const two = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}
const held = (id, owner) => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: in progress\nOwner: ${owner}\nSince: ${sinceOf(NOW - 90 * MIN)}\n`)
const app = name => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 40 * MIN, lastAssistantUuid: 'u-1',
})
/** A card its process left saying working, on a task not reported yet. */
const card = id => JSON.stringify({ name: 'x', role: 'worker', state: 'working', task: { text: `${id} the flags`, step: 2, steps: 4, isReported: false }, at: NOW - 45 * MIN })
/** A turn that ended `ago` minutes before now, its transcript last written then. */
const ended = ago => ({ lines: [typed(NOW - (ago + 10) * MIN, 'Go on with B269.'), step(NOW - (ago + 5) * MIN, 'Build'), answer(NOW - ago * MIN, 'Stopped at a safe point.')], at: NOW - ago * MIN })

const NAMES = ['Main', 'Board', 'Support']
/** No Workers mod has asked the board since it started five minutes ago: no chat runs. */
const NOBODY = { seen: { shown: {}, other: {} }, board: { startedAt: NOW - 5 * MIN, offSince: NOW - 20 * MIN } }

function build({ tails = {}, appStartedAt = APP, outbox = [], seen = NOBODY.seen, board = NOBODY.board } = {}) {
  const work = storeFromText('## Board\n', { now: NOW - 120 * MIN })
  for (const item of [held('B269', 'Board'), held('B280', 'Support')]) work.items.set(item.head.get('Id'), item)
  const turns = { Main: ended(30), Board: ended(30), Support: ended(30), ...tails }
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: NAMES.map(app),
    tails: Object.fromEntries(NAMES.map(name => [`cli-${name}`, { text: turns[name].lines.join('\n'), isCut: false, modifiedAt: turns[name].at }])),
    planLineTexts: { 'cli-Board': card('B269'), 'cli-Support': card('B280') },
    work, adviceText: null, folders: null, askTexts: [], pictureLists: {},
    appStartedAt,
  }
  return buildState(raw, { lines: [], outbox, runs: [], now: NOW, config, seen, board })
}
const lane = (state, name) => state.chats.find(chat => chat.name === name)
const hints = state => state.forYou.filter(need => need.kind === 'idle')

test('a card left "working" by the quit app, quiet since before the app started, is "Not running" with its step, not "Working"', () => {
  const state = build()
  const board = lane(state, 'Board')
  assert.deepEqual([board.state, board.isRunning, board.task?.stepId, board.eta, board.isWithoutTime], ['off', false, 'B269', null, false])
  assert.deepEqual([lane(state, 'Support').state, lane(state, 'Main').state], ['off', 'free'])
  assert.equal(state.counts.working, 0)
  assert.equal(state.counts.off, 2)
  // The lane and the hint agree: a chat that is not running has only its lane's "Not running", no "may wait for you".
  assert.deepEqual(hints(state), [])
  assert.deepEqual(state.forYou.filter(need => need.kind === 'intervene'), [])
  // The restart banner names them as not running yet.
  assert.deepEqual(state.restart.notRunning, ['Board', 'Support'])
})

test('it is back to its own state once its transcript moves after the app started, or its process asks the board', () => {
  const back = build({ tails: { Board: { lines: [...ended(30).lines, typed(NOW - 3 * MIN, 'resume'), step(NOW - MIN, 'Build')], at: NOW - MIN } } })
  assert.equal(lane(back, 'Board').state, 'working')
  // Opened and idle: its mod asks the board, so it runs; its card holds it between two turns, as before.
  const asks = build({ seen: { shown: { Board: NOW - 5_000 }, other: {} } })
  assert.deepEqual([lane(asks, 'Board').state, lane(asks, 'Board').isRunning], ['working', true])
  assert.equal(lane(asks, 'Support').state, 'off')
})

test('without the app\'s start time: stale once quiet longer than the grace time with no running process', () => {
  const seen = { shown: { Main: NOW - 5_000 }, other: {} }
  const long = build({ appStartedAt: null, seen })
  assert.deepEqual([lane(long, 'Board').state, lane(long, 'Board').isRunning], ['off', false])
  // Quiet for six minutes only: still its card's state, but a chat that is not running gets no "may wait for you" hint.
  const short = build({ appStartedAt: null, seen, tails: { Board: ended(6), Support: ended(6) } })
  assert.deepEqual([lane(short, 'Board').state, lane(short, 'Board').isRunning], ['working', false])
  assert.deepEqual(hints(short), [])
  // Nothing is known of its process (no Workers mod answers) and nothing of the app's start: its card stands.
  assert.equal(lane(build({ appStartedAt: null }), 'Board').state, 'working')
})

test('the rule on its own', () => {
  const base = { state: 'working', isRunning: null, writtenAt: NOW - 30 * MIN, appStartedAt: APP, now: NOW, graceMs: 10 * MIN }
  assert.equal(isStaleWork(base), true)
  assert.equal(isStaleWork({ ...base, isRunning: true }), false)
  assert.equal(isStaleWork({ ...base, state: 'waiting' }), false)
  assert.equal(isStaleWork({ ...base, writtenAt: APP + MIN }), false)
  assert.equal(isStaleWork({ ...base, writtenAt: null }), false)
  assert.equal(isStaleWork({ ...base, appStartedAt: null }), false)
  assert.equal(isStaleWork({ ...base, appStartedAt: null, isRunning: false }), true)
  assert.equal(isStaleWork({ ...base, appStartedAt: null, isRunning: false, writtenAt: NOW - 5 * MIN }), false)
})

const PASTE = 'resume\nNot running, as the worker board reads it: Board, Support.\n(typed on the worker board, 16:20)'
const resume = (extra = {}) => ({ id: 'r1', at: NOW - 20 * MIN, to: 'Main', ask: null, command: 'resume', text: 'resume\nNot running, as the worker board reads it: Board, Support.', pasteText: PASTE, state: 'copied', ...extra })

test('"Resume all" only copied: the banner keeps it until the main chat has taken it, with the words to copy again', () => {
  const state = build({ outbox: [resume()] })
  assert.deepEqual(state.restart.copied, { at: NOW - 20 * MIN, command: 'resume', text: PASTE, chat: 'Game - Main', session: 'local_Main', isMainRunning: null })
  // Longer than the quarter of an hour a handed word shows: it stays while it is not taken.
  assert.deepEqual(state.restart.resuming, { at: NOW - 20 * MIN, state: 'copied' })
  // Pasted into the main chat: taken, and said as handed for a while.
  const pasted = build({ outbox: [resume()], tails: { Main: { lines: [...ended(30).lines, typed(NOW - 3 * MIN, PASTE)], at: NOW - 3 * MIN } } })
  assert.equal(pasted.restart.copied, null)
  assert.deepEqual(pasted.restart.resuming, { at: NOW - 20 * MIN, state: 'delivered' })
  // A newer word of the same kind that the board could hand over takes its place.
  const again = build({ outbox: [resume(), resume({ id: 'r2', at: NOW - MIN, state: 'waiting' })] })
  assert.equal(again.restart.copied, null)
})

test('any line to the main chat that was only copied shows the same, one to another chat does not', () => {
  const line = { id: 'l1', at: NOW - 4 * MIN, to: 'Main', ask: null, text: 'Hand out B290 [I7]', state: 'copied' }
  assert.deepEqual(build({ outbox: [line] }).restart.copied, { at: NOW - 4 * MIN, command: null, text: 'Hand out B290 [I7]', chat: 'Game - Main', session: 'local_Main', isMainRunning: null })
  assert.equal(build({ outbox: [{ ...line, to: 'Board' }] }).restart.copied, null)
  assert.equal(build().restart.copied, null)
})

const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
const page = {}
vm.runInNewContext(`${script.slice(script.indexOf('// copied:start'), script.indexOf('// copied:end'))}\nObject.assign(this, { copiedLine })`, page)

test('the banner says plainly that the main chat is not running, where to paste, and its session id', () => {
  const copied = { at: NOW, command: 'resume', text: PASTE, chat: 'Game - Main', session: 'local_Main', isMainRunning: null }
  assert.equal(page.copiedLine(copied, { main: 'Main', isModThere: true }),
    'Main\'s chat is not running yet: open Game - Main in the app (or click it in the sidebar) and paste with Ctrl+V; the word is on your clipboard. Its session id: local_Main.')
  assert.equal(page.copiedLine({ ...copied, session: null }, { main: 'Main', isModThere: true }),
    'Main\'s chat is not running yet: open Game - Main in the app (or click it in the sidebar) and paste with Ctrl+V; the word is on your clipboard.')
  // Its chat runs by now: the word still waits to be pasted.
  assert.match(page.copiedLine({ ...copied, isMainRunning: true }, { main: 'Main', isModThere: true }), /^Main's chat runs now, but the word was only copied: paste it into Game - Main with Ctrl\+V/)
  // Without a Workers mod nothing types it in at all.
  assert.match(page.copiedLine(copied, { main: 'Main', isModThere: false }), /^No Workers mod types it in for you: open Game - Main in the app/)
  // The banner has the button to copy the words again.
  assert.match(script, /button\('Copy again', 'is-quiet', 'copy'\)/)
})

test('the lane says "Not running", never "Working", and its time column says so too', () => {
  assert.match(script, /off: 'Not running'/)
  assert.match(script, /if \(lane\.state === 'off'\) return plain\('Not running', 'bad', 'Process'\)/)
})

test('the app\'s last start is read from the lock it holds in its own folder, above its chat list', async t => {
  const root = await mkdtemp(join(tmpdir(), 'b315-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const sessions = join(root, 'claude-code-sessions')
  await mkdir(sessions)
  assert.equal(await appStartedAt(sessions), null)
  await writeFile(join(root, 'lockfile'), '')
  await utimes(join(root, 'lockfile'), new Date(APP), new Date(APP))
  assert.equal(Math.round(await appStartedAt(sessions) / 1000), Math.round(APP / 1000))
  assert.equal(await appStartedAt(''), null)
})

test('the bar on top says why the words were only copied: no chat runs yet, or no Workers mod', async () => {
  const paste = {}
  vm.runInNewContext(`${script.slice(script.indexOf('// paste:start'), script.indexOf('// paste:end'))}\nObject.assign(this, { pasteLine })`, paste)
  assert.match(paste.pasteLine({ chat: 'Game - Main' }, true, true), /paste it there \(Ctrl\+V\)\. Its chat is not running yet, so nothing types it in for you\.$/)
  assert.match(paste.pasteLine({ chat: 'Game - Main' }, true), /No Workers mod types it in for you\.$/)
  // The server keeps the words as they were copied with them, for the banner's "Copy again".
  const server = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs'), 'utf8')
  assert.match(server, /if \(isCopied\) message = \{ \.\.\.message, pasteText: messageText\(message, timeOf/)
})
