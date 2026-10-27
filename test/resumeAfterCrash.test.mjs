// T9.4, the resume after a crash (the person, 2026-10-26: "lets build the automatic resume and see that it works"). The PC
// crashed at 09:16 and was off until 12:18. After it every chat was closed; all focus work was one chain whose head, B670, was
// in progress for Worker 3, which the crash cut off. Nothing woke Worker 3: the wake-up (`wakesDue`) wakes only a chat that
// board words wait for, and nothing waited for it; the restart flow ("Resume all") types into the main chat, which was closed
// too. Now the board adds a word of its own for each worker that holds a step and is known not to run (`resumesDue`), the
// wake-up has a chat that runs start it, and the page says when none does. Made-up chats only.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, step, typed } from '../fixtures/lines.mjs'
import { messageText } from '../src/bridge.mjs'
import { parseConfig } from '../src/config.mjs'
import { RESUME_STEP, checkSay, nobodyRunsOf, resumesDue, wakeFailedOf, wakeFor, wakesDue, waitsLong } from '../src/say.mjs'
import { readSources } from '../src/sources.mjs'
import { isLate, keepMs, memoryStore } from '../src/store.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { sweepOutbox, whyClosed } from '../src/work/outboxSweep.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = new Date(2026, 9, 26, 12, 50).getTime()
const MAX = 2000
const HERE = dirname(fileURLToPath(import.meta.url))
/** The page's own code (board.js), cut between its marks as the other page tests do. */
const script = await readFile(join(HERE, '..', 'public', 'board.js'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))

// ---- The word, and who gets it: made-up lanes as the state gives them.

/** A worker lane as the state gives it: closed, and holding nothing unless said. */
const lane = (name, more = {}) => ({
  name, isMain: false, isLeftover: false, state: 'off', isRunning: false, appSession: `local_${name.toLowerCase().replace(/\s+/g, '-')}`,
  storeSteps: [], task: null, lastActivityAt: NOW - 3 * HOUR, turnAt: null, suspended: null, removedAt: null, removal: null, ...more,
})
const held = (id, state = 'in progress') => ({ id, title: `Step ${id}`, state })
/** The board's state as `resumesDue` and the wake-up read it. */
const board = (workers, more = {}) => ({
  restart: { main: 'Main' },
  chats: [lane('Main', { isMain: true }), ...workers, lane('Old fork', { isLeftover: true, isRunning: null, storeSteps: [held('B1')] })],
  pause: { state: 'running', since: NOW - 5 * HOUR }, advisor: null, advisorHelper: null, supervisorChat: null, ...more,
})
const holder = (more = {}) => lane('Worker 3', { storeSteps: [held('B670')], task: { stepId: 'B670' }, ...more })
const asked = (more = {}) => ({ id: 'r1', at: NOW - 20 * MIN, to: 'Worker 3', command: RESUME_STEP, about: 'B670', text: 'resume your step B670 from your checkpoint', state: 'waiting', ...more })
const shape = words => words.map(one => [one.to, one.command, one.about, one.text])

test('a worker that holds a step in progress and does not run gets the board\'s word to resume it, the words the main chat sends at Resume all', () => {
  const words = resumesDue(board([holder()]), [])
  assert.deepEqual(shape(words), [['Worker 3', 'resume-step', 'B670', 'resume your step B670 from your checkpoint']])
  assert.deepEqual([words[0].ask, words[0].step, words[0].title, words[0].verdict], [null, null, null, null], 'it answers nothing and is no backlog step')
  // A step taken counts the same; a chat read as free whose process is known not to run too (an older mod's chat).
  assert.equal(resumesDue(board([holder({ storeSteps: [held('B670', 'taken')] })]), []).length, 1)
  assert.equal(resumesDue(board([holder({ state: 'free', isRunning: false })]), []).length, 1)
  // One word for each worker; the oldest step it holds when its task names none, else the step it names.
  const two = board([holder({ name: 'Worker 3', storeSteps: [held('B671', 'taken'), held('B670')], task: { stepId: 'B670' } }), lane('Worker 4', { storeSteps: [held('B8'), held('B9')], task: null })])
  assert.deepEqual(shape(resumesDue(two, [])).map(one => one.slice(0, 3)), [['Worker 3', 'resume-step', 'B670'], ['Worker 4', 'resume-step', 'B8']])
})

test('nothing for a chat that runs, or that the board cannot tell about: the board acts only on what it knows', () => {
  assert.deepEqual(resumesDue(board([holder({ state: 'working', isRunning: true })]), []), [])
  assert.deepEqual(resumesDue(board([holder({ state: 'unknown', isRunning: null })]), []), [])
  assert.deepEqual(resumesDue(board([holder({ state: 'free', isRunning: null })]), []), [])
  // Its lane off is known enough, whatever `isRunning` says.
  assert.equal(resumesDue(board([holder({ state: 'off', isRunning: null })]), []).length, 1)
})

test('never for the main chat, a leftover, a chat stopped on purpose, parked or paused for the limit, removed, or while the person pauses all chats', () => {
  const none = (workers, outbox = [], more = {}) => assert.deepEqual(resumesDue(board(workers, more), outbox), [])
  // The main chat (by its flag, and by the name the state gives as main) and a leftover.
  const main = board([holder()])
  main.chats[0] = { ...main.chats[0], storeSteps: [held('B5')], task: { stepId: 'B5' } }
  assert.deepEqual(resumesDue({ ...main, chats: main.chats.filter(chat => chat.name !== 'Worker 3') }, []), [], 'the main chat and the leftover hold steps and get nothing')
  assert.deepEqual(resumesDue({ ...board([lane('Worker 9', { storeSteps: [held('B5')] })]), restart: { main: 'Worker 9' } }, []), [], 'the chat the board knows as main')
  // The person stopped its turn (src/stopped.mjs): the app drops what it is sent until it gets input.
  none([holder()], [{ id: 'w1', at: NOW - 5 * MIN, to: 'Worker 3', command: 'work', state: 'waiting', stoppedAt: NOW - 5 * MIN }])
  // Parked on purpose, paused for the limit (its lane says suspended), suspended however the lane is read.
  none([holder({ state: 'suspended', suspended: { by: 'parked', on: ['B671'] } })])
  none([holder({ state: 'suspended', suspended: { by: 'note', until: NOW + HOUR } })])
  none([holder({ suspended: { by: 'app', until: NOW + HOUR } })])
  // Removed (the lane stays two minutes and says so), or the person asked the main chat to remove it.
  none([holder({ removedAt: NOW - MIN })])
  none([holder({ removal: { isOpen: true } })])
  // The person pauses all chats: nothing is added; after the resume it is.
  none([holder()], [], { pause: { state: 'pausing', since: NOW - 4 * MIN } })
  assert.equal(resumesDue(board([holder()], { pause: { state: 'resuming', since: NOW - 4 * MIN } }), []).length, 1)
  assert.equal(resumesDue(board([holder()], { pause: { state: 'running', since: NOW - 4 * MIN } }), []).length, 1)
})

test('only a step taken or in progress counts: one in review, done, waiting on the person, queued, or none at all gets nothing', () => {
  for (const state of ['review', 'done', 'waiting on you', 'queued', 'refined', 'dropped']) {
    assert.deepEqual(resumesDue(board([holder({ storeSteps: [held('B670', state)], task: null })]), []), [], state)
  }
  assert.deepEqual(resumesDue(board([holder({ storeSteps: [], task: null })]), []), [])
  // A step in review beside one in progress: the word names the one in progress.
  assert.deepEqual(shape(resumesDue(board([holder({ storeSteps: [held('B660', 'review'), held('B670')] })]), [])).map(one => one[2]), ['B670'])
})

test('once for each off spell: not again while an earlier word waits, was taken, or was sent since the chat last ran', () => {
  const at = (outbox, now = NOW) => resumesDue(board([holder()]), outbox, now).length
  assert.equal(at([]), 1)
  // Waits (however old), is taken, was typed, or failed: it was sent after the chat last wrote (09:50 here).
  assert.equal(at([asked()]), 0)
  assert.equal(at([asked({ at: NOW - 40 * HOUR })]), 0, 'a word that waits is the same wait however old')
  for (const state of ['taken', 'delivered', 'failed', 'copied']) assert.equal(at([asked({ state })]), 0, state)
  // The chat ran after the word (its transcript was written after it, or a turn began): a new off spell.
  assert.equal(resumesDue(board([holder({ lastActivityAt: NOW - 10 * MIN })]), [asked({ state: 'delivered', at: NOW - 30 * MIN })]).length, 1)
  assert.equal(resumesDue(board([holder({ lastActivityAt: NOW - 3 * HOUR, turnAt: NOW - 10 * MIN })]), [asked({ state: 'taken', at: NOW - 30 * MIN })]).length, 1)
  assert.equal(resumesDue(board([holder({ lastActivityAt: NOW - 10 * MIN })]), [asked({ state: 'delivered', at: NOW - 5 * MIN })]).length, 0, 'the word is newer than its last write')
  // The board knows no time the chat ran: one word, never two.
  assert.equal(resumesDue(board([holder({ lastActivityAt: null })]), [asked({ state: 'delivered', at: NOW - 30 * MIN })]).length, 0)
  // A word the board closed (the step moved on, it expired) is no wait; a word for another step or another chat is none either.
  assert.equal(at([asked({ state: 'dropped', why: 'Worker 3 runs again' })]), 0, 'a word closed because the chat ran, sent after it last wrote: the chat quit again without a line')
  assert.equal(at([asked({ state: 'expired' })]), 0, 'a word that expired unseen is not sent anew while the chat never ran')
  assert.equal(at([asked({ about: 'B671' })]), 1)
  assert.equal(at([asked({ to: 'Worker 4' })]), 1)
  assert.equal(at([{ ...asked(), command: 'start', about: 'Worker 3' }]), 1, 'a start is not a resume')
})

// ---- The word travels as the board's other words do.

test('the word is a wake word that waits as long as its purpose stands, and the page cannot send it', () => {
  assert.equal(waitsLong(RESUME_STEP), true)
  const keep = { messageMs: 10 * MIN, answerMs: 48 * HOUR }
  assert.equal(keepMs(asked(), keep), 48 * HOUR)
  assert.equal(isLate(asked({ at: NOW - 3 * HOUR }), NOW, keep), false)
  // A running chat is asked to start the closed one (the wake-up), as for any word that waits for it.
  const state = board([holder(), lane('Worker 5', { state: 'free', isRunning: true })])
  const start = wakeFor(asked(), state, [], NOW, MAX)
  assert.deepEqual([start?.to, start?.command, start?.about], ['Worker 5', 'start', 'Worker 3'])
  // The board's word, never the page's.
  const refused = checkSay({ to: 'Worker 3', command: RESUME_STEP, about: 'B670' }, { chats: state.chats, restart: state.restart }, MAX)
  assert.deepEqual([refused.ok, refused.status, refused.why], [false, 400, 'No such command.'])
  // The chat reads it as the board's own words, not marked as typed by the person; late, it says how late.
  const clock = ms => `${new Date(ms).getHours()}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`
  assert.equal(messageText(asked(), clock), 'resume your step B670 from your checkpoint')
  assert.equal(messageText({ ...asked(), lateMs: 3 * HOUR }, clock), 'resume your step B670 from your checkpoint\n(this word waited for you: sent 3 hours ago, at 12:30)')
})

// ---- The sweep closes it.

const storeItem = (id, state, owner = 'Worker 3') => [id, { head: new Map([['Id', id], ['Kind', 'step'], ['State', state], ['Owner', owner]]) }]
const ctxOf = (all, more = {}) => ({ all, items: new Map([storeItem('B670', 'in progress')]), runs: new Map([['Worker 3', false]]), goals: [], now: NOW, keep: { messageMs: 10 * MIN, answerMs: 48 * HOUR }, closing: new Map(), main: 'Main', prefix: '', ...more })

test('the sweep closes the word once the chat runs again, or no longer holds the step; until then it stays', () => {
  const word = asked()
  assert.equal(whyClosed(word, ctxOf([word])), null, 'the chat is closed and holds the step')
  assert.equal(whyClosed(word, ctxOf([word], { items: new Map([storeItem('B670', 'taken')]) })), null)
  // The chat runs again.
  assert.deepEqual(whyClosed(word, ctxOf([word], { runs: new Map([['Worker 3', true]]) })), { state: 'dropped', why: 'Worker 3 runs again' })
  // The step is in review, done or dropped, is gone, or is another chat's now (the list's prefix is not part of a name).
  for (const state of ['review', 'done', 'dropped', 'waiting on you']) {
    assert.deepEqual(whyClosed(word, ctxOf([word], { items: new Map([storeItem('B670', state)]) })), { state: 'dropped', why: `the step is ${state} now` }, state)
  }
  assert.deepEqual(whyClosed(word, ctxOf([word], { items: new Map() })), { state: 'dropped', why: 'the step is gone' })
  assert.deepEqual(whyClosed(word, ctxOf([word], { items: new Map([storeItem('B670', 'in progress', 'Worker 4')]) })), { state: 'dropped', why: 'Worker 3 no longer holds B670' })
  assert.equal(whyClosed(word, ctxOf([word], { items: new Map([storeItem('B670', 'in progress', 'Team - Worker 3')]), prefix: 'Team - ' })), null)
  // A board with no store cannot judge the step: only the chat running closes it. A newer word of the same kind replaces it.
  assert.equal(whyClosed(word, ctxOf([word], { items: null })), null)
  const newer = asked({ id: 'r2', at: NOW - 5 * MIN })
  assert.match(whyClosed(word, ctxOf([word, newer])).why, /^superseded by a newer word of the same kind/)
})

test('swept as the board does it: the word waits while its chat is off, goes when the chat runs', async () => {
  const keep = { messageMs: 10 * MIN, answerMs: 48 * HOUR }
  const run = async state => {
    const store = memoryStore()
    store.outbox().push(asked())
    const closed = await sweepOutbox({ dir: null, outbox: store, state, now: NOW, keep })
    return closed.map(one => [one.id, one.state, one.why])
  }
  assert.deepEqual(await run(board([holder()])), [])
  assert.deepEqual(await run(board([holder({ state: 'free', isRunning: true })])), [['r1', 'dropped', 'Worker 3 runs again']])
})

// ---- The 2026-10-26 case, through the state.

const NAMES = ['Main', 'Worker 3', 'Worker 5']
const config = { ...parseConfig('{}', {}), project: 'C:\\game' }
const CRASH = new Date(2026, 9, 26, 9, 2).getTime()
const app = name => JSON.stringify({ title: `Team - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\game', isArchived: false, createdAt: name.length, lastActivityAt: CRASH, lastAssistantUuid: 'u-1' })
/** The chats' cards as their mods left them: all on a Workers mod that reports; Worker 3 was working on B670 when the PC crashed. */
const cardOf = (name, at = CRASH) => JSON.stringify(name === 'Worker 3'
  ? { name, role: 'worker', state: 'working', task: { text: 'B670 Moving lava on a painted', step: 0, steps: 0, left: null, isReported: false }, at, mod: '0.20.0' }
  : { name, role: name === 'Main' ? 'main' : 'worker', state: 'waiting', task: null, at, mod: '0.20.0' })
/** The conversations stand where the crash left them: Worker 3 in the middle of a turn, the others between two turns. */
const tails = Object.fromEntries(NAMES.map(name => [`cli-${name}`, name === 'Worker 3'
  ? { text: [typed(CRASH - 20 * MIN, 'Go on.'), step(CRASH, 'Paint the lava')].join('\n'), isCut: false, modifiedAt: CRASH }
  : { text: [typed(CRASH - 50 * MIN, 'Go on.'), answer(CRASH - 40 * MIN, 'Done.')].join('\n'), isCut: false, modifiedAt: CRASH - 40 * MIN }]))
const reportOf = (name, at, state = 'idle') => [name, { state, since: at, background: false, at, session: `cli-${name}`, mod: '0.20.0' }]

/** The board's state at `now`: `running` the chats whose mods report and ask lately, `withCards` which chats have a card. */
function build({ now = NOW, running = [], outbox = [], startedAt = NOW - 10 * MIN, withCards = NAMES, steps = [['B670', 'in progress', 'Worker 3']], pause = null, wroteAt = null } = {}) {
  const work = storeFromText('## Board\n', { now: CRASH - HOUR })
  for (const [id, state, owner, more = ''] of steps) work.items.set(id, parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\nOwner: ${owner}\nSince: ${stamp(CRASH - 40 * MIN)}\n${more}`))
  if (pause !== null) work.pause = pause
  // Worker 3 wrote to its conversation at `wroteAt` (it was started, ran a while and quit again), else it stands where the crash left it.
  const tailsNow = wroteAt === null ? tails : { ...tails, 'cli-Worker 3': { text: [typed(wroteAt - MIN, 'Go on.'), step(wroteAt, 'Paint the lava')].join('\n'), isCut: false, modifiedAt: wroteAt } }
  return buildState({
    listText: '{"prefix":"Team - ","main":"Main"}', appChatTexts: NAMES.map(app), tails: tailsNow, planLineTexts: Object.fromEntries(withCards.map(name => [`cli-${name}`, cardOf(name)])),
    planLineAt: Object.fromEntries(withCards.map(name => [`cli-${name}`, CRASH])), work, adviceText: null, folders: null, askTexts: [], pictureLists: {},
    appStartedAt: NOW - 12 * MIN,
  }, {
    lines: [], runs: [], now, config, board: { startedAt, offSince: null },
    seen: { shown: Object.fromEntries(running.map(name => [name, now - 5_000])), other: {} },
    reports: new Map(running.map(name => reportOf(name, now - 5_000))), outbox,
  })
}
const laneOf = (state, name) => state.chats.find(chat => chat.name === name)

/**
 * One look of the board's clock, as the server does it (server.mjs): the resume words first, kept in the outbox, then the
 * wake-up for the words that wait. Returns what was added.
 */
function tick(outbox, stateAt, now) {
  const added = []
  const say = word => { outbox.push({ id: `clock-${outbox.length}`, at: now, ...word, state: 'waiting' }); added.push(word) }
  const state = stateAt(now)
  for (const word of resumesDue(state, outbox)) say(word)
  if (state.bridge?.isMissing !== true) for (const word of wakesDue(state, outbox, now, MAX)) say(word)
  return added
}

test('2026-10-26: Worker 3 holds B670 and does not run, Worker 5 runs: one tick resumes the one and has the other start it, the next ten minutes add nothing', () => {
  const outbox = []
  const stateAt = (now, running = ['Worker 5']) => build({ now, running, outbox })
  const first = stateAt(NOW)
  assert.deepEqual([laneOf(first, 'Worker 3').state, laneOf(first, 'Worker 3').isRunning, laneOf(first, 'Worker 5').state, laneOf(first, 'Worker 5').isRunning], ['off', false, 'free', true])
  assert.deepEqual(laneOf(first, 'Worker 3').storeSteps.map(one => [one.id, one.state]), [['B670', 'in progress']])
  const added = tick(outbox, stateAt, NOW)
  assert.deepEqual(added.map(one => [one.to, one.command, one.about]), [['Worker 3', 'resume-step', 'B670'], ['Worker 5', 'start', 'Worker 3']])
  assert.equal(added[0].text, 'resume your step B670 from your checkpoint')
  assert.equal(added[1].text.split('\n')[0], 'start "Worker 3"')
  // The next ticks, every half minute for ten minutes: nothing more, however the chat fares.
  for (let at = NOW + 30_000; at < NOW + 10 * MIN; at += 30_000) assert.deepEqual(tick(outbox, now => stateAt(now), at), [], `${(at - NOW) / MIN} min later`)
  // Main was not touched: it holds nothing, and it is a closed chat nothing waits for.
  assert.equal(outbox.filter(one => one.to === 'Main').length, 0)
})

test('2026-10-26: the start worked and Worker 3 runs: the word and the start are closed; a chat that quits again without a line is not asked again, one that wrote a line is', async () => {
  const outbox = []
  const stateAt = (now, running, more = {}) => build({ now, running, outbox, ...more })
  tick(outbox, now => stateAt(now, ['Worker 5']), NOW)
  const at = NOW + 2 * MIN
  const running = stateAt(at, ['Worker 5', 'Worker 3'])
  assert.equal(laneOf(running, 'Worker 3').isRunning, true)
  const store = memoryStore()
  for (const one of outbox) store.outbox().push({ ...one })
  const closed = await sweepOutbox({ dir: null, outbox: store, state: running, now: at, keep: { messageMs: 10 * MIN, answerMs: 48 * HOUR } })
  assert.deepEqual(closed.map(one => [one.state, one.why]).sort(), [['dropped', 'Worker 3 runs again'], ['dropped', 'Worker 3 runs now']])
  const sent = store.outbox()
  // It quits again three hours later having written nothing: the word sent after it last wrote counts, so it is not started in a loop.
  const later = NOW + 3 * HOUR
  const quit = stateAt(later, ['Worker 5'])
  assert.deepEqual([laneOf(quit, 'Worker 3').state, laneOf(quit, 'Worker 3').isRunning], ['off', false])
  assert.deepEqual(resumesDue(quit, sent), [])
  // It wrote a line after the word, then quit: a new off spell, a new word, once.
  const wrote = stateAt(later, ['Worker 5'], { wroteAt: NOW + 2 * MIN })
  assert.deepEqual(resumesDue(wrote, sent).map(one => [one.to, one.about]), [['Worker 3', 'B670']])
  assert.deepEqual(tick(sent, now => stateAt(now, ['Worker 5'], { wroteAt: NOW + 2 * MIN }), later).map(one => one.command), ['resume-step', 'start'])
  assert.deepEqual(tick(sent, now => stateAt(now, ['Worker 5'], { wroteAt: NOW + 2 * MIN }), later + MIN), [])
})

test('2026-10-26: no chat runs after the reboot: Worker 3 gets its word, the state names it, the page line shows, Worker 5 is not free', () => {
  const outbox = []
  const stateAt = now => build({ now, running: [], outbox })
  const state = stateAt(NOW)
  // The board has run past the off time and no mod has called: every chat with a mod that reports reads as not running.
  assert.deepEqual(state.bridge, { isMissing: true })
  assert.deepEqual(state.chats.map(chat => [chat.name, chat.state, chat.isRunning]), [['Main', 'off', false], ['Worker 3', 'off', false], ['Worker 5', 'off', false]])
  assert.equal(state.nobodyRuns, null, 'nothing waits yet')
  assert.deepEqual(tick(outbox, stateAt, NOW).map(one => [one.to, one.command, one.about]), [['Worker 3', 'resume-step', 'B670']])
  const waiting = stateAt(NOW + 30_000)
  assert.deepEqual(JSON.parse(JSON.stringify(waiting.nobodyRuns)), { since: NOW, chats: ['Worker 3'] })
  assert.deepEqual(waiting.wakeFailed, [])
  assert.deepEqual(nobodyRunsOf(waiting, outbox), waiting.nobodyRuns)
  // The page's line, the page's own code cut out of board.js.
  const page = {}
  vm.runInNewContext(`${cut('nobodyruns')}\nObject.assign(this, { nobodyRunsText })`, page)
  assert.equal(page.nobodyRunsText(waiting.nobodyRuns), 'No chat is running, so nobody can wake Worker 3: open any chat of the project, and the board wakes the rest.')
  // Nothing is added while it stands, nor ten minutes on.
  assert.deepEqual(tick(outbox, stateAt, NOW + 30_000), [])
  assert.deepEqual(tick(outbox, stateAt, NOW + 9 * MIN), [])
  // Then one chat is opened (Worker 5): the line goes, and the board has it start Worker 3.
  const opened = NOW + 10 * MIN
  const stateOpened = now => build({ now, running: ['Worker 5'], outbox })
  assert.equal(stateOpened(opened).nobodyRuns, null)
  const added = tick(outbox, stateOpened, opened)
  assert.deepEqual(added.map(one => [one.to, one.command, one.about]), [['Worker 5', 'start', 'Worker 3']])
})

test('a chat with no card has no known mod, so it is not called off by a guess (Worker 5 of 2026-10-26); one that holds a step is read off by the app\'s restart and is resumed', () => {
  // Worker 5 never joined the list: it has no card, so the board has no mod for it and Gap 1 (a card that names a mod that
  // reports, and no report since the board started) cannot apply. Today's reading of its conversation stands, as
  // chatReport.state.test.mjs pins for a chat without a card: its turn ended, so it is free; it runs for nobody to know.
  const cards = ['Main', 'Worker 3']
  const outbox = []
  const closed = now => build({ now, running: [], outbox, withCards: cards })
  const state = closed(NOW)
  assert.deepEqual([laneOf(state, 'Worker 5').state, laneOf(state, 'Worker 5').isRunning, laneOf(state, 'Worker 5').report], ['free', null, null])
  // It holds nothing, so it gets no word; Worker 3, whose card names its mod, is read off and resumed, and the page says nobody runs.
  assert.deepEqual(tick(outbox, closed, NOW).map(one => [one.to, one.about]), [['Worker 3', 'B670']])
  assert.deepEqual(JSON.parse(JSON.stringify(closed(NOW + MIN).nobodyRuns)), { since: NOW, chats: ['Worker 3'] }, 'an unknown chat counts as not running while no mod has called')
  // Once a chat has called, it is known not to run (nothing of it asked), and still free: an idle chat that is closed.
  const heard = now => build({ now, running: ['Main'], outbox, withCards: cards })
  assert.deepEqual([laneOf(heard(NOW + MIN), 'Worker 5').state, laneOf(heard(NOW + MIN), 'Worker 5').isRunning], ['free', false])
  assert.deepEqual(resumesDue(heard(NOW + MIN), outbox), [], 'free and holding nothing: nothing to resume')
  // A chat without a card that holds a step: the app started after its conversation was last written (B315), so it reads off, and is resumed.
  const holding = now => build({ now, running: [], outbox: [], withCards: cards, steps: [['B670', 'in progress', 'Worker 3'], ['B680', 'in progress', 'Worker 5']] })
  assert.deepEqual([laneOf(holding(NOW), 'Worker 5').state, laneOf(holding(NOW), 'Worker 5').isRunning], ['off', false])
  assert.deepEqual(shape(resumesDue(holding(NOW), [])).map(one => one.slice(0, 3)), [['Worker 3', 'resume-step', 'B670'], ['Worker 5', 'resume-step', 'B680']])
})

test('while the person pauses all chats the board adds nothing, and after the resume it does', () => {
  const outbox = []
  const paused = now => build({ now, outbox, pause: { state: 'pausing', since: NOW - 4 * MIN } })
  assert.equal(paused(NOW).pause.state, 'pausing')
  assert.deepEqual(tick(outbox, paused, NOW), [])
  const resumed = now => build({ now, outbox, pause: { state: 'running', since: NOW - 2 * MIN } })
  assert.deepEqual(tick(outbox, resumed, NOW).map(one => one.command), ['resume-step'])
})

test('a step in review or done, and a worker with nothing in the store, leave the board quiet after the reboot', () => {
  for (const steps of [[['B670', 'review', 'Worker 3']], [['B670', 'done', 'Worker 3']], [['B670', 'waiting on you', 'Worker 3']], [['B670', 'in progress', 'Worker 9']], []]) {
    const outbox = []
    assert.deepEqual(tick(outbox, now => build({ now, outbox, steps }), NOW), [], JSON.stringify(steps))
  }
})

// ---- A card a crash tore.

test('a card torn by the crash (its end filled with NUL bytes) is read as the JSON it holds: the chat keeps its mod, so it reads not running instead of unknown for ever', async t => {
  const root = await mkdtemp(join(tmpdir(), 'resume-crash-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const put = async (path, text) => {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }
  const nul = String.fromCharCode(0)
  const chat = (name, id) => JSON.stringify({ title: `Team - ${name}`, sessionId: `local_${id}`, cliSessionId: id, cwd: join(root, 'project'), isArchived: false, createdAt: name.length, lastActivityAt: CRASH, lastAssistantUuid: 'u-1' })
  await put('project/.claude/chats/list.json', '{"prefix":"Team - ","main":"Main"}')
  // The files as the real crash left them: Worker 3's card 161 bytes longer than its JSON, its conversation ending in a line of NUL bytes.
  await put('project/.claude/chats/worker3-id.json', `${cardOf('Worker 3')}\n${nul.repeat(161)}`)
  await put('project/.claude/chats/main-id.json', cardOf('Main'))
  await put('app/a/b/local_main.json', chat('Main', 'main-id'))
  await put('app/a/b/local_worker3.json', chat('Worker 3', 'worker3-id'))
  await put('transcripts/main-id.jsonl', tails['cli-Main'].text)
  await put('transcripts/worker3-id.jsonl', `${tails['cli-Worker 3'].text}\n${nul.repeat(400)}`)
  const onDisk = { ...parseConfig('{}', {}), project: join(root, 'project'), appSessions: join(root, 'app'), transcripts: join(root, 'transcripts'), pictureRoots: [] }
  const raw = await readSources(onDisk, async () => null, NOW)
  const text = raw.planLineTexts['worker3-id']
  assert.equal(typeof text, 'string', 'the chat has its card')
  assert.equal(JSON.parse(text).mod, '0.20.0')
  assert.equal(JSON.parse(text).task.text, 'B670 Moving lava on a painted')
  // A card that was not torn is read as it is.
  assert.equal(raw.planLineTexts['main-id'], cardOf('Main'))
  // The state: it is off for want of a report, as the chats with sound cards are, and holds B670, so it is resumed.
  const work = storeFromText('## Board\n', { now: CRASH })
  work.items.set('B670', parseItem(`Id: B670\nKind: step\nTitle: Step\nState: in progress\nOwner: Worker 3\nSince: ${stamp(CRASH - 40 * MIN)}\n`))
  const state = buildState({ ...raw, work, appStartedAt: NOW - 12 * MIN, planLineAt: { 'main-id': CRASH, 'worker3-id': CRASH } }, { lines: [], runs: [], now: NOW, config: onDisk, board: { startedAt: NOW - 10 * MIN, offSince: null }, seen: { shown: {}, other: {} }, reports: new Map(), outbox: [] })
  const worker = laneOf(state, 'Worker 3')
  assert.deepEqual([worker.state, worker.isRunning, worker.task?.stepId ?? null], ['off', false, 'B670'])
  assert.match(worker.offWhy, /^no report since the board started at \d\d:\d\d$/)
  assert.deepEqual(resumesDue(state, []).map(one => [one.to, one.about]), [['Worker 3', 'B670']])
})

// ---- The roles, the design and the server.

test('the server adds the resume words on every look of its clock that delivers, before the wake-up, and also while no chat has called the board', async () => {
  const server = await readFile(join(HERE, '..', 'server.mjs'), 'utf8')
  const resume = server.indexOf('resumesDue(state, sentNow())')
  const wake = server.indexOf('wakesDue(state, sentNow()')
  assert.ok(resume > 0 && wake > resume, 'resumesDue runs before wakesDue')
  const condition = server.slice(server.lastIndexOf('if (bridgeKey', resume), resume)
  assert.match(condition, /^if \(bridgeKey !== null\) \{/, condition)
  assert.ok(!condition.includes('isMissing'), 'a board no chat has called yet adds the words too')
})

test('the worker\'s role and the design say what the word is and what to do with it', async () => {
  const worker = await readFile(join(HERE, '..', 'roles', 'worker.md'), 'utf8')
  const part = worker.slice(worker.indexOf('## The board resumes your step'), worker.indexOf('## Not yours'))
  assert.ok(part.length > 0, 'a part of its own')
  assert.match(part, /resume your step B<id> from your checkpoint/)
  assert.match(part, /work next/)
  assert.match(part, /nothing else/i)
  const design = await readFile(join(HERE, '..', 'DESIGN.md'), 'utf8')
  const t94 = design.slice(design.indexOf('## Any running chat wakes a chat words wait for (T9.4'), design.indexOf('## Asset providers, part 1'))
  assert.match(t94, /resumesDue/)
  assert.match(t94, /resume-step/)
  const protocol = await readFile(join(HERE, '..', 'roles', 'protocol.md'), 'utf8')
  assert.match(protocol, /`resume your step B<id> from your checkpoint` \(no mark: the board's word\)/)
})

// The failure of the wake-up stays what it was: asked in vain, said once.
test('a resume that no chat could carry is said as the wake-up says it, after three tries, and never asked again', () => {
  const outbox = [asked({ at: NOW - 40 * MIN })]
  const state = board([holder(), lane('Worker 5', { state: 'free', isRunning: true }), lane('Worker 6', { state: 'free', isRunning: true }), lane('Worker 7', { state: 'free', isRunning: true })])
  for (const [to, ago] of [['Worker 5', 30], ['Worker 6', 20], ['Worker 7', 10]]) outbox.push({ id: `s-${to}`, at: NOW - ago * MIN, to, command: 'start', about: 'Worker 3', state: 'delivered' })
  assert.deepEqual(wakesDue(state, outbox, NOW, MAX), [])
  assert.deepEqual(resumesDue(state, outbox), [])
  assert.deepEqual(wakeFailedOf(state, outbox, NOW).map(one => [one.chat, one.tries]), [['Worker 3', 3]])
})

test('T9.1.1: a worker that holds a Quality Assurance task in progress (no branch) is resumed as for any step', () => {
  const outbox = []
  const task = ['B730', 'in progress', 'Worker 3', 'Checks: B701\nNot by: Worker 1\n']
  const stateAt = (now, running = ['Worker 5']) => build({ now, running, outbox, steps: [['B701', 'review', 'Worker 1'], task] })
  assert.deepEqual(laneOf(stateAt(NOW), 'Worker 3').storeSteps.map(one => [one.id, one.state]), [['B730', 'in progress']])
  const added = tick(outbox, stateAt, NOW)
  assert.deepEqual(added.map(one => [one.to, one.command, one.about]), [['Worker 3', 'resume-step', 'B730'], ['Worker 5', 'start', 'Worker 3']])
  assert.equal(added[0].text, 'resume your step B730 from your checkpoint')
})
