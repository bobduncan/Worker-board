// T13 part 4 (the person, 2026-10-28: after a restart work must come back by itself, without a timer that costs tokens):
// the board opens a chat in the Claude app with the app's own program (`claude.exe --desktop --resume <session>`). A fixed
// launch: the program's checked path and a UUID from the board's own list, nothing else. Signals change 4, B908
// (2026-11-02): the launch is the second path of the one wake procedure (src/wake.mjs `launchPlan`): never while a sender
// claims, one per chat and spell, the board-wide spell launches the main chat once; the morning's launches of 10:32-11:08
// (nothing started, PowerShell ok each time) are the cases. Made-up names and ids only.

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { HANDS_GONE_MS, chatToOpen, handWorkWaits, handsGone, isProgram, isSessionId, launchCommand, openChat } from '../src/opener.mjs'
import { BOARD_KEY, claim, emptyWakes, failedToSend, heard, launchPlan, pass, sent, wakeNeeds } from '../src/wake.mjs'

const MIN = 60_000
const NOW = 500 * MIN
const EXE = 'C:\\Users\\Pat\\AppData\\Local\\AnthropicClaude\\app-1.0.0\\claude-code\\2.1.309\\x64 (store)\\claude.exe'
const ID = (n = 1) => `a4d087f2-6dbc-480f-981c-42282ff5c5d${n}`
const claims = (...ages) => new Map(ages.map((ago, n) => [`Chat ${n}`, { can: [], at: NOW - ago }]))
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, removedAt: null, session: ID(name.length % 10), appSession: `local_${name.replace(/\W/g, '')}`, state: 'free', ...more })
const word = (command, state = 'waiting') => ({ id: `w-${command}`, at: NOW - MIN, to: 'Lead', command, about: 'Digger', state })

test('the hands are gone once no chat claimed them for a minute; a young board waits for a call of a chat since its start', () => {
  assert.equal(handsGone({ claims: claims(30_000), now: NOW }), false)
  assert.equal(handsGone({ claims: claims(HANDS_GONE_MS - 1), now: NOW }), false)
  assert.equal(handsGone({ claims: claims(HANDS_GONE_MS), now: NOW }), true)
  assert.equal(handsGone({ claims: new Map(), now: NOW }), true)
  // The newest claim of all counts.
  assert.equal(handsGone({ claims: claims(10 * MIN, 20_000), now: NOW }), false)
  // A board 10 s old: no claim yet; a chat that took since the start runs, one before it says nothing.
  const startedAt = NOW - 10_000
  assert.equal(handsGone({ claims: new Map(), now: NOW, startedAt, calls: { Lead: NOW - 4000 } }), false)
  assert.equal(handsGone({ claims: new Map(), now: NOW, startedAt, calls: { Lead: NOW - 20_000 } }), true)
  assert.equal(handsGone({ claims: new Map(), now: NOW, startedAt, calls: {} }), true)
  // From a minute on, only the claims count.
  assert.equal(handsGone({ claims: new Map(), now: NOW, startedAt: NOW - HANDS_GONE_MS, calls: { Lead: NOW - 1000 } }), true)
})

// T14 (the person, 2026-10-30: "B", fix A for X1 / X103): a chat in Auto mode without the allow rule cannot send by code.
test('T14: only hands that may send keep the hands present; Auto-mode workers alone on the new mod do not', () => {
  const auto = { can: ['set', 'spawn'], mod: '0.26.5', at: NOW - 10_000 }
  const sender = { can: ['send'], mod: '0.26.5', at: NOW - 10_000 }
  assert.equal(handsGone({ claims: new Map([['Worker 1', auto], ['Worker 2', { ...auto, can: [] }]]), now: NOW }), true)
  assert.equal(handsGone({ claims: new Map([['Worker 1', auto], ['Lead', sender]]), now: NOW }), false)
  // An older mod never says it, and keeps counting as before.
  assert.equal(handsGone({ claims: new Map([['Worker 1', { ...auto, mod: '0.26.4' }]]), now: NOW }), false)
  assert.equal(handsGone({ claims: new Map([['Worker 1', { ...auto, mod: null }]]), now: NOW }), false)
})

test('the chat to open: the main chat, else the partner, else the supervisor, else a worker; never one left or removed', () => {
  const main = lane('Lead', { isMain: true, session: ID(1) })
  const digger = lane('Digger', { session: ID(2) })
  const advisor = { name: 'Advisor', session: ID(3) }
  const supervisor = { name: 'Supervisor', session: ID(4) }
  assert.deepEqual(chatToOpen({ chats: [digger, main], advisor, supervisorChat: supervisor }), { chat: 'Lead', session: ID(1) })
  assert.deepEqual(chatToOpen({ chats: [digger], advisor, supervisorChat: supervisor }), { chat: 'Advisor', session: ID(3) })
  assert.deepEqual(chatToOpen({ chats: [digger], advisor: null, supervisorChat: supervisor }), { chat: 'Supervisor', session: ID(4) })
  assert.deepEqual(chatToOpen({ chats: [digger] }), { chat: 'Digger', session: ID(2) })
  // A main chat removed from the list, or one left behind (no lane of the list), is never opened.
  assert.deepEqual(chatToOpen({ chats: [{ ...main, removedAt: NOW - MIN }, digger] }), { chat: 'Digger', session: ID(2) })
  assert.deepEqual(chatToOpen({ chats: [{ ...main, isLeftover: true }] }), null)
  assert.equal(chatToOpen({ chats: [] }), null)
  assert.equal(chatToOpen(null), null)
})

test('only a UUID from the board\'s own list reaches the launch: a bad id gives null, never a launch', async () => {
  for (const bad of ['', 'not-an-id', `${ID(1)} --dangerously-skip-permissions`, `${ID(1)}'`, `'; calc; '`, `${ID(1)}\n`, 'local_abc', 12, null, undefined]) {
    assert.equal(isSessionId(bad), false, String(bad))
    assert.equal(chatToOpen({ chats: [lane('Lead', { isMain: true, session: bad })] }), null, String(bad))
    assert.equal(launchCommand({ exe: EXE, session: bad, cwd: 'C:\\garden' }), null, String(bad))
  }
  // A main chat with a bad id is passed over for the next with a good one.
  assert.deepEqual(chatToOpen({ chats: [lane('Lead', { isMain: true, session: 'nope' })], advisor: { name: 'Advisor', session: ID(3) } }), { chat: 'Advisor', session: ID(3) })
  let spawned = 0
  const done = await openChat({ exe: EXE, session: 'not-an-id', spawn: () => { spawned += 1 } })
  assert.deepEqual([done.launched, done.ok, spawned], [false, false, 0])
})

test('the launch is exactly the fixed list: PowerShell\'s Start-Process with the program and --desktop --resume <uuid>; no shell character passes', () => {
  assert.deepEqual(launchCommand({ exe: EXE, session: ID(1), cwd: 'C:\\garden' }), {
    file: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath '${EXE}' -ArgumentList '--desktop','--resume','${ID(1)}' -WorkingDirectory 'C:\\garden' -WindowStyle Hidden`],
  })
  for (const bad of ["C:\\it's", 'C:\\a;calc', 'garden', '\\\\server\\share', null, '']) assert.equal(launchCommand({ exe: EXE, session: ID(1), cwd: bad }), null, String(bad))
  assert.equal(isProgram(EXE), true)
  assert.equal(isProgram('D:\\Programme\\Clàude\\claude.exe'), true)
  for (const bad of ["C:\\it's\\claude.exe", 'C:\\a;calc\\claude.exe', 'C:\\a&calc\\claude.exe', 'C:\\a|b\\claude.exe', 'C:\\$(calc)\\claude.exe', 'C:\\a`b\\claude.exe',
    'C:\\a"b\\claude.exe', 'C:\\a\nb\\claude.exe', 'C:\\a‘b\\claude.exe', 'C:\\a%PATH%\\claude.exe', 'C:\\a<b\\claude.exe', 'C:\\[x]\\claude.exe',
    'claude.exe', '.\\claude.exe', '\\\\server\\share\\claude.exe', 'C:\\Claude\\claude.cmd', 'C:\\Claude\\evil.exe', 'C:\\Claude\\claude.exe --x', null, '']) {
    assert.equal(isProgram(bad), false, String(bad))
    assert.equal(launchCommand({ exe: bad, session: ID(1), cwd: 'C:\\garden' }), null, String(bad))
  }
})

/** A spawn that records its call and ends as told. */
function fakeSpawn(code, calls) {
  return (file, args, options) => {
    calls.push({ file, args, options })
    const child = new EventEmitter()
    child.unref = () => {}
    setTimeout(() => (code instanceof Error ? child.emit('error', code) : child.emit('exit', code)), 0)
    return child
  }
}

test('opening starts PowerShell detached, with its own console and nothing redirected, in the project folder, and says how it ended', async () => {
  const calls = []
  assert.deepEqual(await openChat({ exe: EXE, session: ID(1), cwd: 'C:\\garden', spawn: fakeSpawn(0, calls) }), { launched: true, ok: true, why: null })
  assert.deepEqual(calls, [{ file: 'powershell.exe', args: launchCommand({ exe: EXE, session: ID(1), cwd: 'C:\\garden' }).args, options: { windowsHide: true, detached: false, stdio: 'ignore', cwd: 'C:\\garden' } }])
  assert.deepEqual(await openChat({ exe: EXE, session: ID(1), cwd: 'C:\\garden', spawn: fakeSpawn(1, []) }), { launched: true, ok: false, why: 'PowerShell ended with 1' })
  assert.match((await openChat({ exe: EXE, session: ID(1), cwd: 'C:\\garden', spawn: fakeSpawn(new Error('ENOENT'), []) })).why, /^PowerShell could not start: ENOENT/)
  assert.deepEqual(await openChat({ exe: null, session: ID(1), spawn: fakeSpawn(0, []) }), { launched: false, ok: false, why: 'the Claude app\'s program was not found' })
})

// Change 4a (2026-10-31): a refine word and an incident word waited for the Advisor while every chat was asleep. Made-up names.
const asleepBoard = (more = {}) => ({
  chats: [lane('Lead', { isMain: true, isRunning: false, session: ID(1) }), lane('Digger', { isRunning: false, session: ID(2), asleep: true, asleepSince: NOW - 20 * MIN })],
  advisor: { name: 'Advisor', isRunning: false, state: 'free', session: ID(3), appSession: 'local_Advisor' },
  supervisorChat: { name: 'Supervisor', isRunning: false, state: 'free', session: ID(4) },
  restart: { main: 'Lead' },
  ...more,
})
const refineWord = { id: 'w-refine', at: NOW - 30 * MIN, to: 'Advisor', ask: null, command: 'refine', about: 'B900', round: 1, state: 'waiting' }
const incidentWord = { ...refineWord, id: 'w-incident', command: 'incident', about: 'X1' }
const envelope = { id: 'w-hand', at: NOW - 6 * MIN, to: 'Digger', command: 'handover', kind: 'task', step: 'B855', clear: null, about: 'Digger', state: 'waiting' }
const spell = NOW - 20 * MIN

test('handWorkWaits reads the one rule: a chat that needs a wake, or the board-wide spell; a running chat and an unknown one say nothing', () => {
  const state = asleepBoard()
  for (const one of [refineWord, incidentWord, envelope]) assert.equal(handWorkWaits(state, [one]), true, one.command)
  assert.equal(handWorkWaits(state, [{ ...refineWord, state: 'taken' }, { ...incidentWord, state: 'delivered' }]), false)
  // A chat that runs carries the word itself.
  assert.equal(handWorkWaits(asleepBoard({ advisor: { name: 'Advisor', isRunning: true, state: 'free', session: ID(3) } }), [refineWord]), false)
  // Unknown is not guessed, but on a board no mod has called since it started it counts as off.
  const unknown = asleepBoard({ advisor: { name: 'Advisor', state: 'free', session: ID(3) }, chats: [] })
  assert.equal(handWorkWaits(unknown, [refineWord]), false)
  assert.equal(handWorkWaits({ ...unknown, bridge: { isMissing: true } }, [refineWord]), true)
})

test('H.5: no launch while a sender claims; the message is first (the 11:06:50 case: the Advisor\'s message woke Worker 5)', () => {
  const state = asleepBoard()
  const needs = wakeNeeds(state, [envelope])
  assert.deepEqual(needs.map(one => one.chat), ['Digger'])
  assert.equal(launchPlan(emptyWakes(), { needs, senderClaims: true }), null)
  // No sender: Digger is launched.
  assert.deepEqual(launchPlan(emptyWakes(), { needs, senderClaims: false }), { key: 'Digger', chat: 'Digger', session: ID(2), spell })
})

test('H.5: one launch per spell (10:32 and 10:35 were two): a second check does not launch again, pending or failed', () => {
  const record = emptyWakes()
  const needs = wakeNeeds(asleepBoard(), [envelope])
  const plan = launchPlan(record, { needs, senderClaims: false })
  assert.ok(claim(record, { chat: plan.key, spell: plan.spell, path: 'launch', by: 'board', jobId: 'l1', now: NOW, paths: ['launch'] }))
  sent(record, 'Digger', 'l1', NOW + 1000)
  // The next minute: the launch is pending.
  assert.equal(launchPlan(record, { needs, senderClaims: false }), null)
  // Two minutes after the send, no report: failed, and still no second launch in this spell.
  assert.equal(pass(record, NOW + 1000 + 2 * MIN).length, 1)
  assert.equal(launchPlan(record, { needs, senderClaims: false }), null)
})

test('H.5: after a failed message a launch runs although carriers claim', () => {
  const record = emptyWakes()
  const needs = wakeNeeds(asleepBoard(), [envelope])
  claim(record, { chat: 'Digger', spell, path: 'message', by: 'Advisor', jobId: `wake:${spell}:Digger`, now: NOW })
  sent(record, 'Digger', `wake:${spell}:Digger`, NOW)
  assert.equal(launchPlan(record, { needs, senderClaims: true }), null, 'the message is on its way')
  pass(record, NOW + 2 * MIN)
  assert.deepEqual(launchPlan(record, { needs, senderClaims: true }), { key: 'Digger', chat: 'Digger', session: ID(2), spell })
})

test('H.5: the board-wide spell launches chatToOpen once (the main chat); while it is pending nothing else; after it failed, a chat\'s own', () => {
  const record = emptyWakes()
  const state = asleepBoard()
  const outbox = [refineWord, envelope]
  const nobody = { since: refineWord.at, chats: ['Advisor', 'Digger'] }
  const needs = wakeNeeds(state, outbox)
  const target = chatToOpen(state, outbox)
  const plan = launchPlan(record, { needs, nobody, senderClaims: false, target })
  assert.deepEqual(plan, { key: BOARD_KEY, chat: 'Lead', session: ID(1), spell: refineWord.at })
  claim(record, { chat: BOARD_KEY, spell: plan.spell, path: 'launch', by: 'board', jobId: 'b', now: NOW, paths: ['launch'] })
  sent(record, BOARD_KEY, 'b', NOW)
  assert.equal(launchPlan(record, { needs, nobody, senderClaims: false, target }), null, 'one chat at a time')
  pass(record, NOW + 2 * MIN)
  // Its launch failed: no second board-wide launch; the needs' own launches, in order (the partner first).
  assert.deepEqual(launchPlan(record, { needs, nobody, senderClaims: false, target }), { key: 'Advisor', chat: 'Advisor', session: ID(3), spell: 0 })
})

test('H.5: a launch is never a verdict; the chat\'s own report with a new run is', () => {
  const record = emptyWakes()
  claim(record, { chat: 'Digger', spell, path: 'launch', by: 'board', jobId: 'l', now: NOW, runBefore: 11 })
  sent(record, 'Digger', 'l', NOW + 500)
  assert.equal(record.wakes.get('Digger').at(-1).attempts[0].verdict, null)
  assert.equal(heard(record, 'Digger', { state: 'idle', run: 11, at: NOW + MIN }, NOW + MIN), null)
  assert.equal(heard(record, 'Digger', { state: 'busy', run: 12, at: NOW + MIN }, NOW + MIN).verdict, 'woke')
  // A launch whose PowerShell failed is failed at once, with its why.
  const other = emptyWakes()
  claim(other, { chat: 'Digger', spell, path: 'launch', by: 'board', jobId: 'l', now: NOW })
  assert.equal(failedToSend(other, 'Digger', 'l', 'PowerShell ended with 1', NOW).why, 'PowerShell ended with 1')
})

test('the server: the wake\'s minute on its own timer, at the start and after Resume all; the launch claimed before its await, logged "launched"', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.match(server, /const canOpen = !isShowOnly && bridgeKey !== null && config\.project !== '' && process\.platform === 'win32'/)
  assert.match(server, /if \(!isDemo && bridgeKey !== null && !isShowOnly\) \{\n {4}const lookToOpen = \(\) => loops\.run\('opener', \(\) => wakePass\(\)\)\n {4}setTimeout\(lookToOpen, OPEN_FIRST_MS\)\n {4}setInterval\(lookToOpen, OPEN_CHECK_MS\)/)
  assert.match(server, /void loops\.run\('opener', \(\) => wakePass\(state\)\)/)
  const launch = server.slice(server.indexOf('const launchFor = async'), server.indexOf('const wakePass = async'))
  assert.ok(launch.indexOf('claimWake(wakes') < launch.indexOf('await openChat('), 'the claim before the await')
  assert.match(launch, /openChat\(\{ exe: await findClaude\(\), session: target\.session, cwd: resolve\(HERE, config\.project\) \}\)/)
  assert.match(launch, /Wake: launched \$\{target\.chat\} \(\$\{target\.session\}\) at \$\{timeOf\(now\)\}/)
  assert.doesNotMatch(server, /'started' : done\.why/)
  assert.match(server, /rows: \[\.\.\.view\.rows, wakeRowNow\(\)\]/)
})
