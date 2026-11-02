// T9.4, first piece (the person, 2026-10-25: "once it's in the queue the worker can stay silent/off. the code aspect
// needs to wake the chat if it has replies in its message queue"). Signals change 4, B908 (2026-11-02): the board no
// longer makes start words to wake a chat (`wakeFor`, `wakesDue`, `wakerFor`, their retries and `wakeFailedOf` went: the
// tests of them with them, H.9). A word to a chat that does not run is the wake procedure's need (src/wake.mjs, test/
// wake.test.mjs, wakeNeeds.test.mjs), a running chat's hands carry ONE message per spell, and the page says it once
// (`wakeNotice`). What stays here: the page's own start command (`startCheck`), the outbox sweep's rules for a start word,
// the roles' words, which words wake a chat, the board-wide "nobody runs" spell's carriers, and the page's one line.
// Made-up chats only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { checkSay } from '../src/say.mjs'
import { nobodyRunsSpell, wakeNeeds } from '../src/wake.mjs'

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

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))

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

test('(h) the page\'s start command names the chat\'s session id and SendMessage, as the roles and the mod do, and keeps its first line', () => {
  const state = board({ running: ['Advisor'] })
  for (const chat of ['Worker 3', 'Main']) {
    const said = checkSay({ to: 'Advisor', command: 'start', chat }, state, MAX).message
    const lines = said.text.split('\n')
    assert.equal(lines[0], `start "${chat}"`)
    // Review fix 4c: main.md, partner.md and the mod's resume text all say "SendMessage to its session id".
    assert.ok(lines[1].includes('send it one line with SendMessage to its session id'), 'SendMessage to the session id')
    assert.ok(!lines[1].includes('send_message'), 'not the app\'s other tool name')
    assert.ok(lines[1].includes('ToolSearch'), 'loaded when it is deferred')
    assert.ok(lines[1].endsWith(`Its session id: ${chat === 'Main' ? 'local_main' : 'local_worker-3'}.`))
    assert.ok(!/main chat/i.test(said.text), said.text)
  }
  // A chat whose id the board does not know: the words say to look it up by its name.
  const unknown = board({ running: ['Advisor'] })
  unknown.chats = unknown.chats.map(chat => (chat.name === 'Worker 3' ? { ...chat, appSession: null } : chat))
  const text = checkSay({ to: 'Advisor', command: 'start', chat: 'Worker 3' }, unknown, MAX).message.text
  assert.ok(!text.includes('Its session id:') && text.includes("by the chat's name"), text)
})

test('a word to another chat keeps its filter: a plain word, a partner word, a sweep and (change 4) any hand-over envelope wake it; a stale kind of word does not', () => {
  const state = board({ running: ['Advisor'] })
  for (const command of [undefined, 'recommend', 'refine', 'plan-start', 'incident', 'sweep']) assert.deepEqual(wakeNeeds(state, [word('Worker 3', { command })]).map(one => [one.chat, one.why]), [['Worker 3', 'words']], String(command))
  for (const command of ['resume', 'spawn', 'planner']) assert.deepEqual(wakeNeeds(state, [word('Worker 3', { command })]), [], command)
  // Decision 2: a task envelope wakes its chat (2026-11-02 10:31: B855's envelope to an asleep Worker 2 woke nobody).
  assert.deepEqual(wakeNeeds(state, [word('Worker 3', { command: 'handover', kind: 'task', step: 'B855', clear: null })]).map(one => one.text), ['take B855 in this turn: run work next'])
  // A word to the main chat while it is off wakes it too.
  assert.deepEqual(wakeNeeds(state, [word('Main')]).map(one => one.chat), ['Main'])
})

test('the board-wide spell: no chat that could carry a message may run, a stopped turn, a pause for the limit or a chat just removed carries none', () => {
  const state = board({ running: ['Main', 'Worker 2'] })
  assert.equal(nobodyRunsSpell(state, [word('Worker 3')]), null)
  const none = patched(patched(state, 'Main', { state: 'suspended' }), 'Worker 2', { removedAt: NOW - MIN })
  assert.deepEqual(nobodyRunsSpell(none, [word('Worker 3')]), { since: NOW - MIN, chats: ['Worker 3'] })
  // The main chat's turn was stopped (src/stopped.mjs): the app drops every word to it until it gets input.
  const stopped = patched(board({ running: ['Main'] }), 'Main', {})
  assert.deepEqual(nobodyRunsSpell(stopped, [word('Main', { stoppedAt: NOW - 5 * MIN }), word('Worker 3')]), { since: NOW - MIN, chats: ['Worker 3'] })
})

test('the page says it in one line under Needs your attention, in the attention colour: the wake record\'s notice', () => {
  const page = {}
  vm.runInNewContext(`${cut('nobodyruns')}\nObject.assign(this, { wakeNoticeText })`, page)
  assert.equal(page.wakeNoticeText({ tone: 'attention', text: 'could not wake Worker 2: the app did not start it (launched 10:32); open its chat' }), 'Could not wake Worker 2: the app did not start it (launched 10:32); open its chat.')
  for (const none of [null, undefined, { tone: 'attention', text: '' }]) assert.equal(page.wakeNoticeText(none), null)
  // It stands in Needs your attention, is part of that panel's view (so it is drawn at once), and has the attention colour.
  const needs = script.slice(script.indexOf('function drawNeeds(state)'), script.indexOf('/** Who runs and who was asked'))
  assert.match(needs, /drawWakeNotice\(state\.wakeNotice\)/)
  assert.doesNotMatch(script, /nobodyRunsText|wakeFailedText|drawNobodyRuns|drawWakeFailed|opener-note/)
  assert.match(script.slice(script.indexOf('function needsView(state, ui)'), script.indexOf('function focusPageView')), /wakeNotice: state\.wakeNotice \?\? null/)
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

/** A copy of the state with `patch` put on the chat named `name` (a lane, the partner, its helper or the supervisor's chat). */
function patched(state, name, patch) {
  const on = chat => (chat?.name === name ? { ...chat, ...patch } : chat)
  return { ...state, chats: state.chats.map(on), advisor: on(state.advisor), advisorHelper: on(state.advisorHelper), supervisorChat: on(state.supervisorChat) }
}
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

// Signals change 6 (B915, the build brief 4): changes 4 and 5 took the supervisor's mechanical jobs (carrying the start word,
// restarting a down board): its never-list names no exception for them any more, and its role has no start-word part.
test('(4a) the supervisor\'s never-list carries no start word any more (signals changes 4 and 5 took it)', async () => {
  const text = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'roles', 'supervisor.md'), 'utf8')
  const never = text.slice(text.indexOf('## What you never do')).split(/\n- /)
  for (const rule of ['Never change anything but incidents', 'Never message a worker, the main chat or the partner']) {
    const found = never.find(one => one.startsWith(rule))
    assert.ok(found !== undefined, rule)
    assert.doesNotMatch(found, /start "<chat>"/, rule)
  }
  assert.ok(!text.includes('## The board asks you to start a chat'))
})

test('(4b, 4c) the roles say SendMessage to the session id, as the start word does', async () => {
  const roles = join(dirname(fileURLToPath(import.meta.url)), '..', 'roles')
  for (const file of ['worker.md', 'partner.md']) {
    const text = await readFile(join(roles, file), 'utf8')
    const part = text.slice(text.indexOf('## The board asks you to start a chat'))
    assert.match(part.slice(0, 900), /SendMessage to (?:the|its|that) session id/, file)
    assert.ok(!part.slice(0, 900).includes('send_message'), file)
  }
})
