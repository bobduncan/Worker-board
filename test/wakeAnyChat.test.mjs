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
import { checkSay, nobodyRunsOf, wakeFailedOf, wakeFor, wakerFor, wakesDue } from '../src/say.mjs'
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
  // The partner's helper does only what the partner hands it: it never carries a start word. The supervisor's chat is the last resort.
  assert.equal(wakerFor(board({ running: ['Helper', 'Supervisor', 'Worker 2'], busy: ['Worker 2'] }), 'Worker 4', [], NOW), 'Worker 2')
  assert.equal(wakerFor(board({ running: ['Helper', 'Supervisor'] }), 'Worker 4', [], NOW), 'Supervisor')
  assert.equal(wakerFor(board({ running: ['Helper'] }), 'Worker 4', [], NOW), null)
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

test('(h) the words name the chat\'s session id and SendMessage, as the roles and the mod do, and keep their first line', () => {
  const state = board({ running: ['Advisor'] })
  for (const to of ['Worker 3', 'Main']) {
    const wake = wakeFor(word(to), state, [], NOW, MAX)
    const lines = wake.text.split('\n')
    assert.equal(lines[0], `start "${to}"`)
    // Review fix 4c: main.md, partner.md and the mod's resume text all say "SendMessage to its session id".
    assert.ok(lines[1].includes('send it one line with SendMessage to its session id'), 'SendMessage to the session id')
    assert.ok(!lines[1].includes('send_message'), 'not the app\'s other tool name')
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
  // The partner's helper does only what the partner hands it: it never carries the word.
  assert.deepEqual(((one) => [one.ok, one.status])(checkSay({ to: 'Helper', command: 'start', chat: 'Worker 3' }, board({ running: ['Helper'] }), MAX)), [false, 409])
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

// ---- The independent review of this change (2026-10-25): retries that stop, the pause, a retry hidden behind a waiting
// start word, the roles' words, a board without a mod, the 16:37 case end to end, and the chats that cannot carry a word.

/** A copy of the state with `patch` put on the chat named `name` (a lane, the partner, its helper or the supervisor's chat). */
function patched(state, name, patch) {
  const on = chat => (chat?.name === name ? { ...chat, ...patch } : chat)
  return { ...state, chats: state.chats.map(on), advisor: on(state.advisor), advisorHelper: on(state.advisorHelper), supervisorChat: on(state.supervisorChat) }
}
/**
 * The board's clock for `hours`, every 30 seconds: `wakesDue`, and what it asks goes into `outbox`. A start word is taken and
 * delivered a minute after it was sent (`deliver`), and the chat it asks for never starts. `stateAt(now)` is the state then.
 */
function tick(stateAt, outbox, { from = NOW, hours = 6, deliver = true } = {}) {
  for (let now = from; now <= from + hours * 60 * MIN; now += 30_000) {
    if (deliver) for (const one of outbox) if (one.command === 'start' && one.state === 'waiting' && now - one.at >= MIN) one.state = 'delivered'
    for (const asked of wakesDue(stateAt(now), outbox, now, MAX)) outbox.push({ id: `clock-${outbox.length}`, at: now, ...asked, state: 'waiting' })
  }
  return outbox.filter(one => one.command === 'start')
}

test('(1) retries stop: each running chat is asked once for a chat that cannot be started, three start words at most, then nothing more', () => {
  // Worker 4's words wait for good: its session is stale, or the chat was archived on purpose. Four chats run.
  const state = board({ running: ['Main', 'Advisor', 'Worker 2', 'Worker 3'] })
  const starts = tick(() => state, [word('Worker 4', { at: NOW - MIN })])
  assert.deepEqual(starts.map(one => [one.to, one.about, (one.at - NOW) / MIN]), [['Main', 'Worker 4', 0], ['Advisor', 'Worker 4', 10], ['Worker 2', 'Worker 4', 20]])
  // One chat runs: it is asked once, not every ten minutes for as long as the words wait.
  const alone = tick(() => board({ running: ['Advisor'] }), [word('Worker 4', { at: NOW - MIN })])
  assert.deepEqual(alone.map(one => [one.to, one.about]), [['Advisor', 'Worker 4']])
  // A chat that starts to run later is asked in its turn (not the one asked before), within the three.
  const later = tick(at => (at < NOW + 60 * MIN ? board({ running: ['Advisor'] }) : board({ running: ['Advisor', 'Worker 2'] })), [word('Worker 4', { at: NOW - MIN })])
  assert.deepEqual(later.map(one => [one.to, (one.at - NOW) / MIN]), [['Advisor', 0], ['Worker 2', 60]])
})

test('(1) the three asks count from the oldest word that waits: new words do not start them again, an answered wait does', () => {
  const state = board({ running: ['Main', 'Advisor', 'Worker 2', 'Worker 3'] })
  const old = ['Main', 'Advisor', 'Worker 2'].map((to, at) => start(to, 'Worker 4', { at: NOW - (60 - at) * MIN, state: 'delivered' }))
  // Words wait since before those asks, and a newer one came: nothing more is asked.
  assert.deepEqual(wakesDue(state, [word('Worker 4', { id: 'old', at: NOW - 70 * MIN }), ...old, word('Worker 4', { id: 'new', at: NOW - MIN })], NOW, MAX), [])
  // The old words were taken (the chat ran) and a word waits again since: the asks before it do not count.
  assert.deepEqual(wakesDue(state, [...old, word('Worker 4', { at: NOW - 2 * MIN })], NOW, MAX).map(one => [one.to, one.about]), [['Main', 'Worker 4']])
})

test('(1) the state carries the chats nobody could wake, until the chat runs or its words no longer wait', () => {
  const state = board({ running: ['Main', 'Advisor', 'Worker 2'] })
  const three = ['Main', 'Advisor', 'Worker 2'].map((to, at) => start(to, 'Worker 4', { at: NOW - (40 - at * 10) * MIN, state: 'delivered' }))
  const words = [word('Worker 4', { at: NOW - 45 * MIN }), ...three]
  const failed = wakeFailedOf(state, words, NOW)
  assert.deepEqual(failed, [{ chat: 'Worker 4', tries: 3, since: NOW - 45 * MIN }])
  // The last ask is still on its way (under ten minutes): not failed yet.
  assert.deepEqual(wakeFailedOf(state, [...words.slice(0, 3), start('Worker 2', 'Worker 4', { at: NOW - 5 * MIN, state: 'taken' })], NOW), [])
  // One running chat, asked once, ten minutes ago: nobody else can be asked, so it is said (one try).
  assert.deepEqual(wakeFailedOf(board({ running: ['Advisor'] }), [word('Worker 4', { at: NOW - 30 * MIN }), start('Advisor', 'Worker 4', { at: NOW - 11 * MIN, state: 'delivered' })], NOW),
    [{ chat: 'Worker 4', tries: 1, since: NOW - 30 * MIN }])
  // A chat that runs and was not asked yet can still be asked: not failed.
  assert.deepEqual(wakeFailedOf(board({ running: ['Advisor', 'Worker 2'] }), [word('Worker 4', { at: NOW - 30 * MIN }), start('Advisor', 'Worker 4', { at: NOW - 11 * MIN, state: 'delivered' })], NOW), [])
  // It goes once the chat runs, once its words no longer wait, when it is not known not to run, and while the person's pause holds.
  assert.deepEqual(wakeFailedOf(board({ running: ['Main', 'Advisor', 'Worker 2', 'Worker 4'] }), words, NOW), [])
  assert.deepEqual(wakeFailedOf(state, [{ ...words[0], state: 'delivered' }, ...three], NOW), [])
  assert.deepEqual(wakeFailedOf(board({ running: ['Main', 'Advisor', 'Worker 2'], unknown: ['Worker 4'] }), words, NOW), [])
  assert.deepEqual(wakeFailedOf({ ...state, pause: { state: 'pausing', since: NOW - MIN } }, words, NOW), [])
  // No ask was made yet: nothing failed (the clock asks first); no waiting word: nothing to say.
  assert.deepEqual(wakeFailedOf(state, [word('Worker 4')], NOW), [])
  assert.deepEqual(wakeFailedOf(state, three, NOW), [])
})

test('(2) the pause holds the clock: no start is asked while the person pauses, a held start counts as on its way, and the resume starts nobody twice', () => {
  const running = board({ running: ['Main', 'Advisor', 'Worker 2'] })
  const pausing = { ...running, pause: { state: 'pausing', since: NOW - 4 * MIN } }
  assert.deepEqual(wakesDue(pausing, [word('Worker 4', { at: NOW - 6 * MIN })], NOW, MAX), [])
  // Two hours of pause: the clock writes no held start at all (it wrote one per running chat, round and round).
  const held = [word('Worker 4', { at: NOW - 6 * MIN }), start('Main', 'Worker 4', { at: NOW - 5 * MIN })]
  assert.deepEqual(tick(() => pausing, held, { deliver: false, hours: 2 }).map(one => one.id), [held[1].id])
  // A start the pause holds counts as on its way, however old: a fresh word for the chat adds none.
  assert.equal(wakeFor(word('Worker 4'), pausing, [start('Advisor', 'Worker 4', { at: NOW - 20 * MIN })], NOW, MAX), null)
  assert.notEqual(wakeFor(word('Worker 4'), running, [start('Advisor', 'Worker 4', { at: NOW - 20 * MIN })], NOW, MAX), null, 'without the pause it is asked again')
  // The resume: that start is delivered now, so it counts from here. Ten minutes later it is asked of the next chat, once.
  const resumed = at => ({ ...running, pause: { state: 'resuming', since: at } })
  assert.deepEqual(wakesDue(resumed(NOW + 120 * MIN), held, NOW + 125 * MIN, MAX), [])
  assert.deepEqual(wakesDue(resumed(NOW + 120 * MIN), held, NOW + 131 * MIN, MAX).map(one => [one.to, one.about]), [['Advisor', 'Worker 4']])
  // Once the resume is over ("running") it is the same.
  assert.deepEqual(wakesDue({ ...running, pause: { state: 'running', since: NOW + 121 * MIN } }, held, NOW + 125 * MIN, MAX), [])
})

test('(3) an off worker whose oldest waiting word is a start for another chat is still woken for its later word', () => {
  const state = board({ running: ['Main'] })
  const outbox = [start('Worker 2', 'Worker 4', { at: NOW - 40 * MIN }), word('Worker 2', { command: 'work', at: NOW - 30 * MIN })]
  assert.deepEqual(wakesDue(state, outbox, NOW, MAX).map(one => [one.to, one.about]), [['Main', 'Worker 2']])
  // The start word alone wakes nobody (it is no word for that chat to wake it for); a plain word of the person does.
  assert.deepEqual(wakesDue(state, [outbox[0]], NOW, MAX), [])
  assert.deepEqual(wakesDue(state, [outbox[0], word('Worker 2', { at: NOW - 30 * MIN })], NOW, MAX).map(one => one.about), ['Worker 2'])
  // The words that wake nobody (a pause's resume) do not make the chat "seen" either.
  assert.deepEqual(wakesDue(state, [word('Worker 2', { command: 'resume', at: NOW - 40 * MIN }), word('Worker 2', { command: 'work', at: NOW - 30 * MIN })], NOW, MAX).map(one => one.about), ['Worker 2'])
})

test('(3) the sweep drops a waiting start whose holder is not the main chat and is known not to run, with its reason', async () => {
  const { memoryStore } = await import('../src/store.mjs')
  const { sweepOutbox } = await import('../src/work/outboxSweep.mjs')
  const keep = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN }
  const run = async (state, words) => {
    const store = memoryStore()
    for (const one of words) store.outbox().push({ ...one })
    return (await sweepOutbox({ dir: null, outbox: store, state, now: NOW, keep })).map(one => [one.id, one.state, one.why])
  }
  const carries = start('Worker 2', 'Worker 4', { at: NOW - 4 * MIN })
  const waits = word('Worker 4', { at: NOW - 4 * MIN })
  // Worker 2 does not run: it can never carry the word; another chat is asked instead.
  assert.deepEqual(await run(board({ running: ['Main'] }), [carries, waits]), [[carries.id, 'dropped', 'Worker 2 does not run, so it cannot carry the start of Worker 4']])
  // The partner is a holder too.
  const viaPartner = start('Advisor', 'Worker 4', { at: NOW - 4 * MIN })
  assert.deepEqual(await run(board({ running: ['Main'] }), [viaPartner, waits]), [[viaPartner.id, 'dropped', 'Advisor does not run, so it cannot carry the start of Worker 4']])
  // A holder that runs, or that the board cannot tell about, keeps it; so does the main chat that is off (the board's order to it).
  assert.deepEqual(await run(board({ running: ['Main', 'Worker 2'] }), [carries, waits]), [])
  assert.deepEqual(await run(board({ running: ['Main'], unknown: ['Worker 2'] }), [carries, waits]), [])
  const toMain = start('Main', 'Worker 4', { at: NOW - 4 * MIN })
  assert.deepEqual(await run(board({ running: ['Advisor'] }), [toMain, waits]), [])
})

test('(4a) the supervisor\'s never-list names the board\'s start word as the one message it carries', async () => {
  const text = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'roles', 'supervisor.md'), 'utf8')
  const never = text.slice(text.indexOf('## What you never do')).split(/\n- /)
  for (const rule of ['Never change anything but incidents', 'Never message a worker, the main chat or the partner']) {
    const found = never.find(one => one.startsWith(rule))
    assert.ok(found !== undefined, rule)
    assert.match(found, /start "<chat>"/, `${rule}: the exception for the board's start word`)
  }
})

test('(4b, 4c) the roles say SendMessage to the session id, as the start word does', async () => {
  const roles = join(dirname(fileURLToPath(import.meta.url)), '..', 'roles')
  for (const file of ['worker.md', 'partner.md', 'supervisor.md']) {
    const text = await readFile(join(roles, file), 'utf8')
    const part = text.slice(text.indexOf('## The board asks you to start a chat'))
    assert.match(part.slice(0, 900), /SendMessage to (?:the|its|that) session id/, file)
    assert.ok(!part.slice(0, 900).includes('send_message'), file)
  }
})

/** The made-up chats of the state tests: a chat's app file, and a conversation that has been quiet for 40 minutes. */
const app = name => JSON.stringify({ title: `Team - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\game', isArchived: false, createdAt: name.length, lastActivityAt: NOW - 40 * MIN, lastAssistantUuid: 'u-1' })
const quiet = { text: [typed(NOW - 50 * MIN, 'Go on.'), answer(NOW - 40 * MIN, 'Done.')].join('\n'), isCut: false, modifiedAt: NOW - 40 * MIN }

test('(5) a board no mod has called since it started: its chats are not known to run, and the "No chat is running" line stands', () => {
  const config = { ...parseConfig('{}', {}), project: 'C:\\game' }
  const make = tails => buildState({
    listText: '{"prefix":"Team - ","main":"Main"}', appChatTexts: ['Main', 'Board'].map(app), tails, planLineTexts: {},
    work: storeFromText('## Board\n', { now: NOW - 60 * MIN }), adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: NOW - 3 * 60 * MIN,
  }, {
    lines: [], runs: [], now: NOW, config, board: { startedAt: NOW - 30 * MIN, offSince: null }, seen: { shown: {}, other: {} },
    outbox: [{ id: 'm1', at: NOW - 12 * MIN, to: 'Board', ask: null, step: null, title: null, verdict: null, text: 'Take this.', state: 'waiting' }],
  })
  const built = make({ 'cli-Main': quiet, 'cli-Board': quiet })
  assert.deepEqual(built.bridge, { isMissing: true })
  assert.deepEqual(built.chats.map(chat => chat.isRunning), [null, null])
  assert.deepEqual(JSON.parse(JSON.stringify(built.nobodyRuns)), { since: NOW - 12 * MIN, chats: ['Board'] })
  // A chat that is known to run (its conversation is being written) is a chat that runs, bridge or not.
  const alive = { text: [typed(NOW - 50 * MIN, 'Go on.'), step(NOW - 5_000, 'Build')].join('\n'), isCut: false, modifiedAt: NOW - 5_000 }
  assert.equal(make({ 'cli-Main': alive, 'cli-Board': quiet }).nobodyRuns, null)
  // A board that has only just started knows nothing yet: it says nothing.
  assert.equal(nobodyRunsOf({ ...board(), bridge: { isMissing: false }, chats: board().chats.map(chat => ({ ...chat, isRunning: null })) }, [word('Worker 3')]), null)
})

test('(1) a chat the "No chat is running" line names is not named again as one nobody could wake', () => {
  const config = { ...parseConfig('{}', {}), project: 'C:\\game' }
  const built = buildState({
    listText: '{"prefix":"Team - ","main":"Main"}', appChatTexts: ['Main', 'Board'].map(app), tails: { 'cli-Main': quiet, 'cli-Board': quiet }, planLineTexts: {},
    work: storeFromText('## Board\n', { now: NOW - 60 * MIN }), adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: NOW - 3 * 60 * MIN,
  }, {
    lines: [], runs: [], now: NOW, config, board: { startedAt: NOW - 30 * MIN, offSince: null },
    // A mod asked lately (from a chat that is no lane), so the board knows that no lane runs.
    seen: { shown: { Ghost: NOW - 5_000 }, other: {} },
    outbox: [{ id: 'm1', at: NOW - 30 * MIN, to: 'Board', ask: null, step: null, title: null, verdict: null, text: 'Take this.', state: 'waiting' },
      { id: 's1', at: NOW - 20 * MIN, to: 'Main', command: 'start', about: 'Board', text: 'start "Board"', state: 'delivered' }],
  })
  assert.deepEqual(JSON.parse(JSON.stringify(built.nobodyRuns)), { since: NOW - 30 * MIN, chats: ['Board'] })
  assert.deepEqual(built.wakeFailed, [])
})

test('(6) the 16:37 case end to end: the main chat off after a board restart, its start of Worker 3 waiting, the partner running', () => {
  const config = { ...parseConfig('{}', {}), project: 'C:\\game' }
  const names = ['Main', 'Advisor', 'Worker 3']
  const handOut = { id: 'h1', at: NOW - 15 * MIN, to: 'Main', ask: null, step: null, title: null, verdict: null, version: null, command: 'start', about: 'Worker 3', reported: 1, text: 'start "Worker 3"\nIts chat is not running.', state: 'waiting' }
  // The main chat reported 29 minutes ago and has been silent since (more than offAfterMinutes); the partner reports now.
  const report = (name, at) => [name, { state: 'idle', since: at, background: false, at, session: `cli-${name}`, mod: '0.19.0' }]
  const stateAt = (now, outbox) => buildState({
    listText: '{"prefix":"Team - ","main":"Main"}', appChatTexts: names.map(app),
    tails: Object.fromEntries(names.map(name => [`cli-${name}`, quiet])), planLineTexts: {}, work: storeFromText('## Board\n', { now: NOW - 60 * MIN }), adviceText: null, folders: null, askTexts: [], pictureLists: {},
    appStartedAt: NOW - 3 * 60 * MIN,
  }, {
    lines: [], runs: [], now, config, board: { startedAt: NOW - 30 * MIN, offSince: null }, seen: { shown: { Advisor: now - 5_000 }, other: {} },
    reports: new Map([report('Main', NOW - 29 * MIN), report('Advisor', now - 5_000)]), outbox,
  })
  const outbox = [handOut]
  const first = stateAt(NOW, outbox)
  const lanes = Object.fromEntries([...first.chats, first.advisor].map(chat => [chat.name, chat.isRunning]))
  assert.deepEqual([lanes.Main, lanes.Advisor], [false, true])
  // One tick of the clock: the partner is asked to start the main chat.
  const asked = wakesDue(first, outbox, NOW, MAX)
  assert.deepEqual(asked.map(one => [one.to, one.command, one.about]), [['Advisor', 'start', 'Main']])
  assert.equal(asked[0].text.split('\n')[0], 'start "Main"')
  outbox.push({ id: 'w1', at: NOW, ...asked[0], state: 'waiting' })
  // The next tick, and every one within ten minutes: nothing more.
  for (const minutes of [0.1, 1, 5, 9.5]) {
    const at = NOW + minutes * MIN
    assert.deepEqual(wakesDue(stateAt(at, outbox), outbox, at, MAX), [], `${minutes} min later`)
  }
  assert.equal(stateAt(NOW + 5 * MIN, outbox).nobodyRuns, null)
  // The main chat did not start, nobody else runs: the board says so (one try), and asks no more.
  const late = NOW + 11 * MIN
  assert.deepEqual(wakesDue(stateAt(late, outbox), outbox, late, MAX), [])
  assert.deepEqual(JSON.parse(JSON.stringify(stateAt(late, outbox).wakeFailed)), [{ chat: 'Main', tries: 1, since: NOW - 15 * MIN }])
})

test('(7) a chat that cannot carry a word now is passed over: a stopped turn, a pause for the limit, a chat just removed', () => {
  const state = board({ running: ['Main', 'Advisor', 'Worker 2', 'Worker 3'] })
  // The main chat's turn was stopped (src/stopped.mjs): the app drops every word to it until it gets input.
  assert.equal(wakerFor(state, 'Worker 4', [word('Main', { stoppedAt: NOW - 5 * MIN })], NOW), 'Advisor')
  // A turn begun after the stop lets it carry again.
  assert.equal(wakerFor(patched(state, 'Main', { turnAt: NOW - MIN }), 'Worker 4', [word('Main', { stoppedAt: NOW - 5 * MIN })], NOW), 'Main')
  // A chat paused for the limit (its card says Suspended), the partner too.
  assert.equal(wakerFor(patched(state, 'Main', { state: 'suspended' }), 'Worker 4', [], NOW), 'Advisor')
  assert.equal(wakerFor(patched(patched(state, 'Main', { state: 'suspended' }), 'Advisor', { state: 'suspended' }), 'Worker 4', [], NOW), 'Worker 2')
  // A chat removed in the last minutes (its lane stays two minutes and says so).
  assert.equal(wakerFor(patched(patched(state, 'Main', { removedAt: NOW - MIN }), 'Worker 2', { removedAt: NOW - MIN }), 'Worker 4', [], NOW), 'Advisor')
  assert.equal(wakerFor(patched(patched(state, 'Advisor', { state: 'suspended' }), 'Main', { removedAt: NOW - MIN }), 'Worker 4', [], NOW), 'Worker 2')
  // Only such chats run: nobody carries it, and the page says so.
  const none = patched(patched(board({ running: ['Main', 'Worker 2'] }), 'Main', { state: 'suspended' }), 'Worker 2', { removedAt: NOW - MIN })
  assert.equal(wakerFor(none, 'Worker 4', [], NOW), null)
  assert.deepEqual(nobodyRunsOf(none, [word('Worker 3')]), { since: NOW - MIN, chats: ['Worker 3'] })
  // A lane whose own words are held by a stop still carries a word for another chat unless it is the stopped one.
  assert.equal(wakerFor(state, 'Worker 4', [word('Worker 2', { stoppedAt: NOW - 5 * MIN })], NOW), 'Main')
})

test('the page says it for the chats nobody could wake: one line each, in the same style as the "No chat is running" line', () => {
  const page = {}
  vm.runInNewContext(`${cut('times')}\n${cut('nobodyruns')}\nObject.assign(this, { wakeFailedText })`, page)
  const at = new Date(2026, 9, 25, 16, 7).getTime()
  assert.equal(page.wakeFailedText({ chat: 'Worker 4', tries: 3, since: at }), 'Nobody could wake Worker 4 after 3 tries since 16:07: open it yourself.')
  assert.equal(page.wakeFailedText({ chat: 'Main', tries: 1, since: at }), 'Nobody could wake Main after 1 try since 16:07: open it yourself.')
  const needs = script.slice(script.indexOf('function drawNeeds(state)'), script.indexOf('/** Who runs and who was asked'))
  assert.match(needs, /drawWakeFailed\(state\.wakeFailed\)/)
  assert.match(script.slice(script.indexOf('function needsView(state, ui)'), script.indexOf('function focusPageView')), /wakeFailed: state\.wakeFailed \?\? \[\]/)
})

test('(j) retries stop on the send path too: a word sent anew to an off chat asks no fourth chat, and the page says so', () => {
  // The re-check of the review: the hand-out's pinned start is sent anew each start window, and each send called wakeFor.
  const state = board({ running: ['Advisor', 'Worker 2', 'Worker 3'] })
  const first = word('Main', { id: 'w-main-1', at: NOW - 40 * MIN })
  const asked = [['Advisor', 35], ['Worker 2', 25], ['Worker 3', 15]].map(([to, ago]) => start(to, 'Main', { id: `s-${to}`, at: NOW - ago * MIN, state: 'taken' }))
  const fresh = word('Main', { id: 'w-main-2', at: NOW })
  assert.equal(wakeFor(fresh, state, [first, ...asked], NOW, MAX), null, 'three tries: nobody is asked a fourth time')
  assert.deepEqual(wakeFailedOf(state, [first, ...asked, fresh], NOW).map(one => [one.chat, one.tries]), [['Main', 3]])
  // Two tries: the one chat not asked in this wait is asked, never one asked before.
  const two = wakeFor(fresh, state, [first, ...asked.slice(0, 2)], NOW, MAX)
  assert.deepEqual([two.to, two.about], ['Worker 3', 'Main'])
})

test('(k) a start word that waits for a main chat that is off is no try: it asks nobody yet', () => {
  const state = board({ running: ['Advisor'] })
  const waiting = word('Worker 3', { at: NOW - 30 * MIN, command: 'work' })
  const handOut = [1, 2, 3].map(n => start('Main', 'Worker 3', { id: `s-main-${n}`, at: NOW - (30 - n * 5) * MIN }))
  const wake = wakesDue(state, [waiting, ...handOut], NOW, MAX)
  // Worker 3 is asked for at once, and the main chat too, since words wait for it.
  assert.deepEqual(wake.map(one => [one.to, one.about]), [['Advisor', 'Worker 3'], ['Advisor', 'Main']])
  assert.deepEqual(wakeFailedOf(state, [waiting, ...handOut], NOW), [])
})
