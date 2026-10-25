// T9.4, first piece (the person, 2026-10-25: "once it's in the queue the worker can stay silent/off. the code aspect
// needs to wake the chat if it has replies in its message queue"). 16:37 that day, after a board restart the main chat
// was off: its words (a start of Worker 3, two effort words, note N807) waited 15+ minutes untaken, since `wakeFor`
// asked only the main chat to start a chat and returned null when the main chat itself did not run. Now any running chat
// carries the board's `start "<chat>"` word (`wakerFor`: the main chat, else the partner, else a free worker, a busy
// one, the supervisor last), a word to a main chat that does not run wakes it the same way, and when no chat runs the
// state says so (`nobodyRuns`) and the page shows one line. Made-up chats only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, step, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { checkSay, nobodyRunsOf, wakeFor, wakerFor, wakesDue } from '../src/say.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 25, 16, 37).getTime()
const MAX = 2000

/** A worker lane as the state gives it: free, and (unless said) not running. */
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, state: 'free', isRunning: false, appSession: `local_${name.toLowerCase().replace(/\s+/g, '-')}`, ...more })
/** The board's state as the wake reads it: `running` names the chats that run, `busy` the ones that work. */
function board({ running = [], busy = [], workers = ['Worker 2', 'Worker 3', 'Worker 4'], unknown = [] } = {}) {
  const more = name => ({ isRunning: unknown.includes(name) ? null : running.includes(name), state: busy.includes(name) ? 'working' : 'free' })
  return {
    restart: { main: 'Main' },
    chats: [lane('Main', { isMain: true, ...more('Main') }), ...workers.map(name => lane(name, more(name))), lane('Old fork', { isLeftover: true, isRunning: null })],
    advisor: { name: 'Advisor', appSession: 'local_advisor', ...more('Advisor') },
    advisorHelper: { name: 'Helper', appSession: 'local_helper', ...more('Helper') },
    supervisorChat: { name: 'Supervisor', appSession: 'local_supervisor', ...more('Supervisor') },
  }
}
/** A plain word typed on the board for `to`, waiting. */
const word = (to, more = {}) => ({ id: `w-${to}`, at: NOW - MIN, to, ask: null, step: null, title: null, verdict: null, text: 'Take this.', state: 'waiting', ...more })
/** A start word of the board that waits (or not) for `to`, about `about`. */
const start = (to, about, more = {}) => ({ id: `s-${to}-${about}`, at: NOW - 3 * MIN, to, command: 'start', about, text: `start "${about}"`, state: 'waiting', ...more })

test('(a) the main chat runs: it carries the start word, as it did before', () => {
  const state = board({ running: ['Main', 'Advisor', 'Worker 2'] })
  assert.equal(wakerFor(state, 'Worker 3', [], NOW), 'Main')
  const wake = wakeFor(word('Worker 3'), state, [], NOW, MAX)
  assert.deepEqual([wake.to, wake.command, wake.about], ['Main', 'start', 'Worker 3'])
  assert.equal(wake.text.split('\n')[0], 'start "Worker 3"')
})

test('(b) the main chat is off and the partner runs: the start word goes to the partner', () => {
  const state = board({ running: ['Advisor', 'Worker 2'] })
  assert.equal(wakerFor(state, 'Worker 3', [], NOW), 'Advisor')
  const wake = wakeFor(word('Worker 3'), state, [], NOW, MAX)
  assert.deepEqual([wake.to, wake.command, wake.about, wake.ask], ['Advisor', 'start', 'Worker 3', null])
})

test('(c) the main chat and the partner are off, Worker 2 idle and Worker 3 busy: the start word goes to Worker 2', () => {
  const state = board({ running: ['Worker 2', 'Worker 3'], busy: ['Worker 3'] })
  assert.equal(wakerFor(state, 'Worker 4', [], NOW), 'Worker 2')
  assert.deepEqual([wakeFor(word('Worker 4'), state, [], NOW, MAX).to], ['Worker 2'])
  // The other way round: the idle one is Worker 3 now.
  assert.equal(wakerFor(board({ running: ['Worker 2', 'Worker 3'], busy: ['Worker 2'] }), 'Worker 4', [], NOW), 'Worker 3')
  // Only busy ones run: the first busy one in the list's order.
  assert.equal(wakerFor(board({ running: ['Worker 2', 'Worker 3'], busy: ['Worker 2', 'Worker 3'] }), 'Worker 4', [], NOW), 'Worker 2')
  // The partner's helper counts as a chat of the board, idle first as any; the supervisor's chat is the last resort.
  assert.equal(wakerFor(board({ running: ['Helper', 'Supervisor', 'Worker 2'], busy: ['Worker 2'] }), 'Worker 4', [], NOW), 'Helper')
  assert.equal(wakerFor(board({ running: ['Supervisor', 'Worker 2'], busy: ['Worker 2'] }), 'Worker 4', [], NOW), 'Worker 2')
  assert.equal(wakerFor(board({ running: ['Supervisor'] }), 'Worker 4', [], NOW), 'Supervisor')
})

test('(d) a word to the main chat while it is off: a start word for the main chat, to a running chat', () => {
  const state = board({ running: ['Advisor'] })
  // Whatever its command: every word to the main chat is an order of the board.
  for (const command of [undefined, 'start', 'spawn', 'resume', 'work', 'wake', 'remove', 'mod-restart']) {
    const wake = wakeFor(word('Main', { command }), state, [], NOW, MAX)
    assert.deepEqual([wake?.to, wake?.command, wake?.about], ['Advisor', 'start', 'Main'], String(command))
    assert.equal(wake.text.split('\n')[0], 'start "Main"')
  }
  // With the partner off too, a free worker carries it.
  assert.equal(wakeFor(word('Main'), board({ running: ['Worker 3'] }), [], NOW, MAX).to, 'Worker 3')
  // The main chat runs: nothing is asked (the word is taken by it). Not known to run: nothing is guessed.
  assert.equal(wakeFor(word('Main'), board({ running: ['Main', 'Advisor'] }), [], NOW, MAX), null)
  assert.equal(wakeFor(word('Main'), board({ running: ['Advisor'], unknown: ['Main'] }), [], NOW, MAX), null)
})

test('(e) no chat runs: no start word, and the state names the chats that wait', () => {
  const state = board()
  const words = [word('Worker 3', { at: NOW - 5 * MIN }), word('Main', { at: NOW - 9 * MIN }), word('Worker 2', { state: 'delivered' })]
  assert.equal(wakerFor(state, 'Worker 3', [], NOW), null)
  assert.equal(wakeFor(words[0], state, [], NOW, MAX), null)
  assert.equal(wakeFor(words[1], state, [], NOW, MAX), null)
  assert.deepEqual(wakesDue(state, words, NOW, MAX), [])
  assert.deepEqual(nobodyRunsOf(state, words), { since: NOW - 9 * MIN, chats: ['Worker 3', 'Main'] })
  // As soon as any chat runs it goes, and the chat is woken.
  const someone = board({ running: ['Worker 4'] })
  assert.equal(nobodyRunsOf(someone, words), null)
  assert.deepEqual(wakesDue(someone, words, NOW, MAX).map(one => [one.to, one.about]), [['Worker 4', 'Worker 3'], ['Worker 4', 'Main']])
  // Nothing waits for a chat that is off: nothing to say. Words the board does not wake a chat for do not count.
  assert.equal(nobodyRunsOf(state, [word('Worker 2', { state: 'delivered' }), word('Worker 3', { command: 'resume' })]), null)
  // A chat the board cannot tell about may run: it does not say that nobody does.
  assert.equal(nobodyRunsOf(board({ unknown: ['Worker 4'] }), words), null)
  assert.equal(nobodyRunsOf(board(), []), null)
})

test('(f) a chat asked lately to start the target is passed over, so a busy or forgetful waker does not block the wake-up', () => {
  const state = board({ running: ['Main', 'Advisor', 'Worker 2'] })
  const asked = to => [start(to, 'Worker 3')]
  assert.equal(wakerFor(state, 'Worker 3', asked('Main'), NOW), 'Advisor')
  assert.equal(wakerFor(state, 'Worker 3', [...asked('Main'), ...asked('Advisor')], NOW), 'Worker 2')
  // Every running chat was asked: the first again, since a repeat beats a word that waits for nobody.
  assert.equal(wakerFor(state, 'Worker 3', [...asked('Main'), ...asked('Advisor'), ...asked('Worker 2')], NOW), 'Main')
  // Asked in the last half hour, whether its word still waits or it took it and the target did not start: passed over.
  for (const held of ['waiting', 'taken', 'delivered', 'failed']) assert.equal(wakerFor(state, 'Worker 3', [start('Main', 'Worker 3', { state: held, at: NOW - 20 * MIN })], NOW), 'Advisor', held)
  // Not when the ask is older, was closed because the target runs, was for another chat or was no start.
  assert.equal(wakerFor(state, 'Worker 3', [start('Main', 'Worker 3', { at: NOW - 31 * MIN })], NOW), 'Main')
  assert.equal(wakerFor(state, 'Worker 3', [start('Main', 'Worker 3', { state: 'dropped' })], NOW), 'Main')
  assert.equal(wakerFor(state, 'Worker 3', [start('Main', 'Worker 4')], NOW), 'Main')
  assert.equal(wakerFor(state, 'Worker 3', [{ ...start('Main', 'Worker 3'), command: 'work' }], NOW), 'Main')
})

test('(i) a start that did not wake the chat in ten minutes is asked again, of the next chat; one on its way is not', () => {
  const state = board({ running: ['Main', 'Advisor'] })
  const waiting = word('Worker 3', { at: NOW - 15 * MIN })
  // Main took the word twelve minutes ago and Worker 3 still does not run: the Advisor is asked now.
  const again = wakesDue(state, [waiting, start('Main', 'Worker 3', { at: NOW - 12 * MIN, state: 'taken' })], NOW, MAX)
  assert.deepEqual(again.map(one => [one.to, one.about]), [['Advisor', 'Worker 3']])
  // Five minutes ago: still on its way, nothing more.
  assert.deepEqual(wakesDue(state, [waiting, start('Main', 'Worker 3', { at: NOW - 5 * MIN, state: 'taken' })], NOW, MAX), [])
})

test('(g) the target never wakes itself, and a leftover never carries a word', () => {
  // The target looks running (a board that contradicts itself): it is still not its own waker.
  const state = board({ running: ['Main', 'Advisor'] })
  assert.equal(wakerFor(state, 'Main', [], NOW), 'Advisor')
  assert.equal(wakerFor(state, 'Advisor', [], NOW), 'Main')
  assert.equal(wakerFor(board({ running: ['Advisor'] }), 'Advisor', [], NOW), null)
  // A word for a chat that runs asks nobody; a chat that is not on the board asks nobody.
  assert.equal(wakeFor(word('Advisor'), state, [], NOW, MAX), null)
  assert.equal(wakeFor(word('Nobody'), state, [], NOW, MAX), null)
  const fork = board({ running: ['Main'] })
  fork.chats = fork.chats.map(chat => (chat.name === 'Old fork' ? { ...chat, isRunning: true } : chat.name === 'Main' ? { ...chat, isRunning: false } : chat))
  assert.equal(wakerFor(fork, 'Worker 3', [], NOW), null, 'a leftover that looks running carries nothing')
})

test('(h) the words name the chat\'s session id and the app\'s send_message tool, and keep their first line', () => {
  const state = board({ running: ['Advisor'] })
  for (const to of ['Worker 3', 'Main']) {
    const wake = wakeFor(word(to), state, [], NOW, MAX)
    const lines = wake.text.split('\n')
    assert.equal(lines[0], `start "${to}"`)
    assert.ok(lines[1].includes('send_message'), 'the app\'s tool')
    assert.ok(lines[1].includes('ToolSearch'), 'loaded when it is deferred')
    assert.ok(lines[1].includes('"The worker board holds something for you."'), 'the one line to send')
    assert.ok(lines[1].includes('no reply needed') && lines[1].includes('go on with your own work'))
    assert.ok(lines[1].endsWith(`Its session id: ${to === 'Main' ? 'local_main' : 'local_worker-3'}.`))
    // Self-contained: it is no word for the main chat alone.
    assert.ok(!/main chat/i.test(wake.text), wake.text)
  }
  // A chat whose id the board does not know: the words say to look it up by its name.
  const unknown = board({ running: ['Advisor'] })
  unknown.chats = unknown.chats.map(chat => (chat.name === 'Worker 3' ? { ...chat, appSession: null } : chat))
  const text = wakeFor(word('Worker 3'), unknown, [], NOW, MAX).text
  assert.ok(!text.includes('Its session id:') && text.includes("by the chat's name"), text)
})

test('"start" is accepted for any chat that runs, and refused for one that does not, for a target that runs and for the main chat itself', () => {
  const state = board({ running: ['Advisor', 'Worker 2'] })
  for (const to of ['Advisor', 'Worker 2']) assert.equal(checkSay({ to, command: 'start', chat: 'Worker 3' }, state, MAX).ok, true, to)
  // The words are the same for every chat.
  assert.equal(checkSay({ to: 'Worker 2', command: 'start', chat: 'Worker 3' }, state, MAX).message.text, checkSay({ to: 'Advisor', command: 'start', chat: 'Worker 3' }, state, MAX).message.text)
  // A chat that does not run starts nothing (the main chat is the board's usual addressee: its start word waits for it).
  const off = checkSay({ to: 'Worker 4', command: 'start', chat: 'Worker 3' }, state, MAX)
  assert.deepEqual([off.ok, off.status], [false, 409])
  assert.equal(checkSay({ to: 'Main', command: 'start', chat: 'Worker 3' }, state, MAX).ok, true)
  // The target runs, is unknown, is the chat itself, is a leftover, or is not on the board.
  for (const chat of ['Worker 2', 'Advisor', 'Nobody', 'Old fork', undefined]) assert.equal(checkSay({ to: 'Advisor', command: 'start', chat }, state, MAX).ok, false, String(chat))
  assert.equal(checkSay({ to: 'Worker 3', command: 'start', chat: 'Worker 3' }, board({ running: ['Worker 3'] }), MAX).ok, false)
  // No such chat, and the other commands stay the main chat's.
  assert.equal(checkSay({ to: 'Nobody', command: 'start', chat: 'Worker 3' }, state, MAX).status, 400)
  assert.equal(checkSay({ to: 'Advisor', command: 'spawn' }, state, MAX).status, 400)
  assert.equal(checkSay({ to: 'Worker 2', command: 'resume' }, state, MAX).status, 400)
  assert.equal(checkSay({ to: 'Advisor', command: 'start', chat: 'Worker 3', text: 'More' }, state, MAX).status, 400)
})

test('the guards stay: not again within two minutes, and not while an earlier start still waits for ten', () => {
  const state = board({ running: ['Advisor'] })
  const to = word('Worker 3')
  const asked = (state2, at) => [start('Advisor', 'Worker 3', { at, state: state2 })]
  assert.equal(wakeFor(to, state, asked('delivered', NOW - MIN), NOW, MAX), null)
  assert.notEqual(wakeFor(to, state, asked('delivered', NOW - 3 * MIN), NOW, MAX), null)
  for (const held of ['waiting', 'taken']) {
    assert.equal(wakeFor(to, state, asked(held, NOW - 5 * MIN), NOW, MAX), null, held)
    assert.notEqual(wakeFor(to, state, asked(held, NOW - 11 * MIN), NOW, MAX), null, held)
  }
  // A start for another chat does not hold this one back, and a word to the main chat is guarded by main's own starts.
  assert.notEqual(wakeFor(to, state, [start('Advisor', 'Worker 4', { at: NOW - MIN })], NOW, MAX), null)
  assert.equal(wakeFor(word('Main'), state, [start('Advisor', 'Main', { at: NOW - MIN })], NOW, MAX), null)
})

test('a word to another chat keeps its filter: a plain word, a partner word and a sweep wake it; a stale kind of word does not', () => {
  const state = board({ running: ['Advisor'] })
  for (const command of [undefined, 'recommend', 'refine', 'plan-start', 'incident', 'sweep']) assert.equal(wakeFor(word('Worker 3', { command }), state, [], NOW, MAX)?.command, 'start', String(command))
  for (const command of ['resume', 'spawn', 'planner']) assert.equal(wakeFor(word('Worker 3', { command }), state, [], NOW, MAX), null, command)
  // The board knows no main chat: a chat that does not run is still started by one that runs.
  const alone = { ...state, restart: { main: null } }
  assert.equal(wakeFor(word('Worker 3'), alone, [], NOW, MAX)?.to, 'Advisor')
})

test('the state carries nobodyRuns while words wait for a chat that is off and no chat runs, and drops it once one does', () => {
  const config = { ...parseConfig('{}', {}), project: 'C:\\game' }
  const app = name => JSON.stringify({ title: `Team - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\game', isArchived: false, createdAt: name.length, lastActivityAt: NOW - 40 * MIN, lastAssistantUuid: 'u-1' })
  const quiet = { text: [typed(NOW - 50 * MIN, 'Go on.'), answer(NOW - 40 * MIN, 'Done.')].join('\n'), isCut: false, modifiedAt: NOW - 40 * MIN }
  const alive = { text: [typed(NOW - 50 * MIN, 'Go on.'), step(NOW - 5_000, 'Build')].join('\n'), isCut: false, modifiedAt: NOW - 5_000 }
  const build = tails => buildState({
    listText: '{"prefix":"Team - ","main":"Main"}',
    appChatTexts: ['Main', 'Board', 'Support'].map(app),
    tails: Object.fromEntries(['Main', 'Board', 'Support'].map(name => [`cli-${name}`, tails[name] ?? quiet])),
    planLineTexts: {}, work: storeFromText('## Board\n', { now: NOW - 60 * MIN }), adviceText: null, folders: null, askTexts: [], pictureLists: {},
    appStartedAt: NOW - 3 * 60 * MIN,
  }, {
    lines: [], runs: [], now: NOW, config, board: { startedAt: NOW - 30 * MIN, offSince: null },
    // A mod asked lately (from a chat that is no lane), so the board knows who runs and who does not.
    seen: { shown: { Ghost: NOW - 5_000 }, other: {} },
    outbox: [{ id: 'm1', at: NOW - 12 * MIN, to: 'Board', ask: null, step: null, title: null, verdict: null, text: 'Take this.', state: 'waiting' },
      { id: 'm2', at: NOW - 8 * MIN, to: 'Main', ask: null, step: null, title: null, verdict: null, text: 'Report in.', state: 'waiting' },
      { id: 'm3', at: NOW - 7 * MIN, to: 'Support', ask: null, step: null, title: null, verdict: null, text: 'Old.', state: 'delivered' }],
  })
  const none = build({})
  assert.deepEqual(['Main', 'Board', 'Support'].map(name => none.chats.find(chat => chat.name === name).isRunning), [false, false, false])
  assert.deepEqual(JSON.parse(JSON.stringify(none.nobodyRuns)), { since: NOW - 12 * MIN, chats: ['Board', 'Main'] })
  // Support's conversation is being written: a chat runs, so the line goes and Board is woken through it.
  const someone = build({ Support: alive })
  assert.equal(someone.nobodyRuns, null)
  assert.equal(wakerFor(someone, 'Board', [], NOW), 'Support')
})

// The page's one line under Needs your attention. The page's own code, cut out of board.js between its marks.
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))

test('the page says it in one line under Needs your attention, in the attention colour, and only while nobody runs', () => {
  const page = {}
  vm.runInNewContext(`${cut('nobodyruns')}\nObject.assign(this, { nobodyRunsText })`, page)
  assert.equal(page.nobodyRunsText({ since: NOW, chats: ['Worker 3'] }), 'No chat is running, so nobody can wake Worker 3: open any chat of the project, and the board wakes the rest.')
  assert.equal(page.nobodyRunsText({ since: NOW, chats: ['Main', 'Worker 3', 'Advisor'] }), 'No chat is running, so nobody can wake Main, Worker 3 and Advisor: open any chat of the project, and the board wakes the rest.')
  for (const none of [null, undefined, { since: NOW, chats: [] }]) assert.equal(page.nobodyRunsText(none), null)
  // It stands in Needs your attention, is part of that panel's view (so it is drawn at once), and has the attention colour.
  const needs = script.slice(script.indexOf('function drawNeeds(state)'), script.indexOf('/** Who runs and who was asked'))
  assert.match(needs, /drawNobodyRuns\(state\.nobodyRuns\)/)
  assert.match(script.slice(script.indexOf('function needsView(state, ui)'), script.indexOf('function focusPageView')), /nobodyRuns: state\.nobodyRuns \?\? null/)
  assert.match(style, /\.nobody-runs \{[^}]*var\(--warn\)/)
})

test('the sweep keeps the start of the main chat while a start word waits for it (the hand-out\'s start of a worker), and drops it once nothing does', async () => {
  // 16:37: "a start of Worker 3" waited for the main chat, which was off. The word that has a chat that runs start the
  // main chat must not be dropped as "nothing waits for Main": the start of Worker 3 is what waits for it.
  const { memoryStore } = await import('../src/store.mjs')
  const { sweepOutbox } = await import('../src/work/outboxSweep.mjs')
  const keep = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN }
  const state = { restart: { main: 'Main' }, chats: [lane('Main', { isMain: true }), lane('Worker 3')], advisor: { name: 'Advisor', isRunning: true } }
  const handOut = start('Main', 'Worker 3', { at: NOW - 4 * MIN, reported: 1 })
  const waits = word('Worker 3', { at: NOW - 4 * MIN })
  const wake = start('Advisor', 'Main', { at: NOW - 3 * MIN })
  const run = async (words, chats = state) => {
    const store = memoryStore()
    for (const one of words) store.outbox().push({ ...one })
    const closed = await sweepOutbox({ dir: null, outbox: store, state: chats, now: NOW, keep })
    return closed.map(one => [one.id, one.why])
  }
  assert.deepEqual(await run([handOut, waits, wake]), [])
  // The hand-out's start was taken: nothing waits for the main chat any more.
  assert.deepEqual(await run([{ ...handOut, state: 'delivered' }, waits, wake]), [[wake.id, 'nothing waits for Main any more']])
  // The main chat runs: the word is done.
  const running = { ...state, chats: [lane('Main', { isMain: true, isRunning: true }), lane('Worker 3')] }
  assert.deepEqual(await run([handOut, waits, wake], running), [[wake.id, 'Main runs now']])
  // A start to any other chat still holds nothing for it: the word that wakes Worker 3 (to the partner) goes with its words.
  const wakeThree = start('Advisor', 'Worker 3', { at: NOW - 3 * MIN })
  assert.deepEqual((await run([wakeThree, handOut]))[0], [wakeThree.id, 'nothing waits for Worker 3 any more'])
})
