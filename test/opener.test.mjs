// T13 part 4 (the person, 2026-10-28: after a restart work must come back by itself, without a timer that costs tokens):
// when no chat's hands checked in for a minute and work waits that only they carry, the board opens one chat in the Claude
// app with the app's own program (`claude.exe --desktop --resume <session>`): the main chat first, then the partner, the
// supervisor, a worker. A fixed launch: the program's checked path and a UUID from the board's own list, nothing else. At
// most one open in 3 minutes; after two opens in a row that brought no hand back it stops and the page says so. Made-up
// names and ids only.

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  HANDS_GONE_MS, OPEN_EVERY_MS, OPEN_TRIES, OPEN_WAIT_MS, OPEN_SHOWN_MS, chatToOpen, failuresOf, handWorkWaits, handsGone, isProgram, isSessionId,
  launchCommand, openChat, openPlan, openerNote, openerRow,
} from '../src/opener.mjs'

const MIN = 60_000
const NOW = 500 * MIN
const EXE = 'C:\\Users\\Pat\\AppData\\Local\\AnthropicClaude\\app-1.0.0\\claude-code\\2.1.309\\x64 (store)\\claude.exe'
const ID = (n = 1) => `a4d087f2-6dbc-480f-981c-42282ff5c5d${n}`
const claims = (...ages) => new Map(ages.map((ago, n) => [`Chat ${n}`, { can: [], at: NOW - ago }]))
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, removedAt: null, session: ID(name.length % 10), appSession: `local_${name.replace(/\W/g, '')}`, state: 'free', ...more })
const word = (command, state = 'waiting') => ({ id: `w-${command}`, at: NOW - MIN, to: 'Lead', command, about: 'Digger', state })
const plan = more => openPlan({ now: NOW, handsGone: true, waits: true, paused: false, last: -Infinity, failures: 0, ...more })

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

test('hand work waits: a waiting start, wake, resume, new worker, set, restart or remove word; a resume with a chat not started; an asleep cut-off chat', () => {
  for (const command of ['start', 'wake', 'resume', 'spawn', 'worker-effort', 'partner-effort', 'mod-restart', 'remove']) assert.equal(handWorkWaits({}, [word(command)]), true, command)
  // Taken, delivered or no hand's word: nothing waits.
  assert.equal(handWorkWaits({}, [word('start', 'taken'), word('wake', 'delivered'), word('step'), word(null)]), false)
  assert.equal(handWorkWaits({}, []), false)
  // Resuming: while a chat holding a step has not started.
  assert.equal(handWorkWaits({ pause: { state: 'resuming', waiting: [{ chat: 'Digger', ids: ['B12'] }] } }, []), true)
  assert.equal(handWorkWaits({ pause: { state: 'resuming', waiting: [] } }, []), false)
  assert.equal(handWorkWaits({ pause: { state: 'running' } }, []), false)
  // Part 3: an asleep chat whose turn was cut, once per asleep spell, and only with an app id a hand can send to.
  const asleep = lane('Digger', { state: 'interrupted', asleep: true, asleepSince: NOW - 20 * MIN })
  assert.equal(handWorkWaits({ chats: [asleep] }, []), true)
  assert.equal(handWorkWaits({ chats: [asleep] }, [], { asleepSent: new Map([['Digger', { since: NOW - 20 * MIN }]]) }), false)
  assert.equal(handWorkWaits({ chats: [asleep] }, [], { asleepSent: new Map([['Digger', { since: NOW - 90 * MIN }]]) }), true)
  assert.equal(handWorkWaits({ chats: [{ ...asleep, appSession: null }] }, []), false)
  assert.equal(handWorkWaits({ chats: [{ ...asleep, state: 'free' }] }, []), false)
  // The partner and the supervisor too.
  assert.equal(handWorkWaits({ advisor: { ...asleep, name: 'Advisor' } }, []), true)
  assert.equal(handWorkWaits({ supervisorChat: { ...asleep, name: 'Supervisor' } }, []), true)
})

test('open only while the hands are gone, work waits, nobody pauses, 3 minutes after the last open and before two failures', () => {
  assert.deepEqual(plan({}), { open: true, why: 'no chat runs and work waits for one' })
  assert.deepEqual(plan({ handsGone: false }), { open: false, why: 'a chat with the Workers mod runs' })
  assert.deepEqual(plan({ waits: false }), { open: false, why: 'nothing waits for a running chat' })
  assert.deepEqual(plan({ paused: true }), { open: false, why: 'the person pauses the chats' })
  // The spacing.
  assert.equal(plan({ last: NOW - OPEN_EVERY_MS + 1 }).open, false)
  assert.equal(plan({ last: NOW - 2 * MIN }).why, 'a chat was opened less than 3 minutes ago')
  assert.equal(plan({ last: NOW - OPEN_EVERY_MS }).open, true)
  // The cooldown.
  assert.equal(plan({ failures: OPEN_TRIES - 1 }).open, true)
  assert.deepEqual(plan({ failures: OPEN_TRIES }), { open: false, why: '2 opens in a row brought no chat back' })
})

test('a failure is an open no hand came back after within 2 minutes; a hand checking in resets the count', () => {
  const opens = [{ at: NOW - 10 * MIN, chat: 'Lead', ok: true }, { at: NOW - 6 * MIN, chat: 'Lead', ok: true }]
  assert.equal(failuresOf({ opens, claims: new Map(), now: NOW }), 2)
  // An open still in its 2 minutes is no failure yet; one PowerShell could not start is one at once.
  assert.equal(failuresOf({ opens: [{ at: NOW - OPEN_WAIT_MS + 1, ok: true }], now: NOW }), 0)
  assert.equal(failuresOf({ opens: [{ at: NOW - OPEN_WAIT_MS, ok: true }], now: NOW }), 1)
  assert.equal(failuresOf({ opens: [{ at: NOW - 1000, ok: false }], now: NOW }), 1)
  // A hand that checked in after the first open resets it: only the open after it counts.
  assert.equal(failuresOf({ opens, claims: claims(8 * MIN), now: NOW }), 1)
  assert.equal(failuresOf({ opens, claims: claims(30_000), now: NOW }), 0)
  // Two failures stop the opening, and a hand back opens the way again.
  const after = failuresOf({ opens, claims: new Map(), now: NOW })
  assert.equal(plan({ failures: after, last: opens[1].at }).open, false)
  assert.equal(plan({ failures: failuresOf({ opens, claims: claims(MIN + 10_000), now: NOW + 3 * MIN }), last: opens[1].at, now: NOW + 3 * MIN }).open, true)
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

test('the page\'s line: quiet for 15 minutes after an open, attention once the tries brought no chat back; the ⚙ row', () => {
  const timeOf = at => `T${(at / MIN) % 1000}`
  assert.equal(openerNote({ opens: [], now: NOW, timeOf }), null)
  const opens = [{ at: NOW - 5 * MIN, chat: 'Lead', ok: true }]
  assert.deepEqual(openerNote({ opens, failures: 0, now: NOW, timeOf }), { tone: 'quiet', text: 'Opened Lead at T495 to wake the chats.' })
  assert.equal(openerNote({ opens, failures: 0, now: NOW + OPEN_SHOWN_MS, timeOf }), null)
  assert.deepEqual(openerNote({ opens, failures: 2, now: NOW + OPEN_SHOWN_MS, timeOf }), { tone: 'attention', text: 'Opened Lead twice, but no chat came back: open any chat of the project yourself.' })
  assert.deepEqual(openerRow({}), { key: 'open', title: 'Wake the chats when none runs', byCode: true, why: null })
  assert.deepEqual(openerRow({ failed: 'Lead' }), { key: 'open', title: 'Wake the chats when none runs', byCode: false, why: 'the last try failed: no chat came back after the board opened Lead twice' })
  assert.equal(openerRow({ blocked: 'only on Windows' }).why, 'only on Windows')
})

test('the server checks on its own timer, at the start and after Resume all, never on the demo or a board that only shows; the launch has only the list\'s id', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.match(server, /const canOpen = !isShowOnly && bridgeKey !== null && config\.project !== '' && process\.platform === 'win32'/)
  assert.match(server, /if \(!isDemo && canOpen\) \{\n {4}const lookToOpen = \(\) => loops\.run\('opener', \(\) => openCheck\(\)\)\n {4}setTimeout\(lookToOpen, OPEN_FIRST_MS\)\n {4}setInterval\(lookToOpen, OPEN_CHECK_MS\)/)
  assert.match(server, /body\?\.action === 'resume-all' && !isShowOnly\) \{\n {8}const state = await readState\(\)\n.*\n {8}void loops\.run\('opener', \(\) => openCheck\(state\)\)/)
  // The cheap exit first: nothing is read while a chat's hands claimed within the minute.
  assert.match(server, /const gone = handsGone\(\{ claims: codeClaims, now, startedAt, calls: seen\?\.shown \?\? \{\} \}\)\n {4}if \(!gone \|\| !\(await ownsLoops\(\)\)\) return/)
  assert.match(server, /paused: isHolding\(state\.pause\)/)
  assert.match(server, /const target = chatToOpen\(state\)/)
  assert.match(server, /openChat\(\{ exe: await findClaude\(\), session: target\.session, cwd: resolve\(HERE, config\.project\) \}\)/)
  assert.match(server, /opens\.push\(\{ at: now, chat: target\.chat, ok: done\.ok \}\)/)
  assert.match(server, /rows: \[\.\.\.view\.rows, openerRowNow\(\)\]/)
  assert.match(server, /opener: openerNoteNow\(\),/)
})

test('the page shows the line where the restart banner is, quiet or amber, also without a main chat; the ⚙ row says it', async () => {
  const { openPage } = await import('./pageHarness.mjs')
  const { asSent, build, ask, MIN: PAGE_MIN, NOW: PAGE_NOW } = await import('./partnerState.mjs')
  const base = asSent(build([ask('Q2', 'person', PAGE_NOW - 40 * PAGE_MIN)]))
  const quiet = await openPage({ state: { ...base, opener: { tone: 'quiet', text: 'Opened Lead at 10:00 to wake the chats.' } } })
  try {
    assert.equal(quiet.find('#restart').hidden, false)
    const line = quiet.find('#restart .opener-note')
    assert.equal(line.textContent, 'Opened Lead at 10:00 to wake the chats.')
    assert.deepEqual([line.classList.contains('muted'), line.classList.contains('alert')], [true, false])
  } finally { await quiet.close() }
  const loud = await openPage({ state: { ...base, restart: { ...base.restart, main: null }, opener: { tone: 'attention', text: 'Opened Lead twice, but no chat came back: open any chat of the project yourself.' } } })
  try {
    assert.equal(loud.find('#restart').hidden, false)
    assert.equal(loud.find('#restart .opener-note').classList.contains('alert'), true)
  } finally { await loud.close() }
  const none = await openPage({ state: { ...base, restart: { ...base.restart, main: null }, opener: null } })
  try {
    assert.equal(none.find('#restart').hidden, true)
  } finally { await none.close() }
  const rows = [
    { key: 'wake', title: 'Wake, start and resume chats', byCode: true, why: null },
    openerRow({}),
  ]
  const jobs = { rows, missing: [], needsTask: false, missingRoutines: [], checked: null, canAllow: true, taskLine: null }
  const panel = await openPage({ state: { ...base, codeJobs: jobs } })
  try {
    const lines = panel.all('#code-job-list li').map(one => [one.querySelector('.code-job-title').textContent, one.querySelector('.code-job-state').textContent])
    assert.deepEqual(lines, [['Wake, start and resume chats', 'by itself'], ['Wake the chats when none runs', 'by itself']])
  } finally { await panel.close() }
  const failed = await openPage({ state: { ...base, codeJobs: { ...jobs, rows: [openerRow({ failed: 'Lead' })] } } })
  try {
    assert.equal(failed.text('#code-job-list .code-job-state'), 'last try failed')
    assert.match(failed.find('#code-job-list li').title, /no chat came back after the board opened Lead twice; open any chat of the project yourself\.$/)
  } finally { await failed.close() }
})

// The person, 2026-10-30: "why cant the board connect directly to the chats using the same command, bypassing main?"
test('while other chats run, an asleep worker with a queued step or a waiting word is the one to open; never the main chat, one awake or left', async () => {
  const { asleepWithWork } = await import('../src/opener.mjs')
  const state = {
    chats: [
      lane('Lead', { isMain: true, asleep: true, queue: [{ id: 'B1' }] }),
      lane('Digger', { asleep: true, asleepSince: NOW - 10 * MIN, queue: [{ id: 'B2' }] }),
      lane('Miner', { asleep: true, asleepSince: NOW - 5 * MIN, queue: [] }),
      lane('Smith', { asleep: true, queue: [] }),
      lane('Awake', { asleep: false, queue: [{ id: 'B3' }] }),
      lane('Gone', { asleep: true, isLeftover: true, queue: [{ id: 'B4' }] }),
      lane('NoId', { asleep: true, session: 'not-a-uuid', queue: [{ id: 'B5' }] }),
    ],
  }
  const outbox = [{ ...word('work'), to: 'Miner' }, { ...word('work', 'delivered'), to: 'Smith' }]
  assert.deepEqual(asleepWithWork(state, outbox).map(one => [one.chat, one.since]), [['Digger', NOW - 10 * MIN], ['Miner', NOW - 5 * MIN]])
  assert.deepEqual(asleepWithWork({ chats: [] }, outbox), [])
})

test('an asleep worker opens after its work waited a minute, at most once in 3 minutes, and not after two opens left it asleep', async () => {
  const { ASLEEP_WAIT_MS, asleepPlan } = await import('../src/opener.mjs')
  const at = more => asleepPlan({ now: NOW, chat: 'Digger', since: NOW - 30 * MIN, waitingSince: NOW - ASLEEP_WAIT_MS, opens: [], paused: false, ...more })
  assert.equal(at().open, true)
  assert.equal(at({ waitingSince: NOW - ASLEEP_WAIT_MS + 1 }).open, false)
  assert.equal(at({ paused: true }).open, false)
  assert.equal(at({ opens: [{ at: NOW - OPEN_EVERY_MS + 1, chat: 'Digger', ok: true }] }).open, false)
  assert.equal(at({ opens: [{ at: NOW - OPEN_EVERY_MS, chat: 'Digger', ok: true }] }).open, true)
  // Another chat's open does not count, nor one before this asleep spell.
  assert.equal(at({ opens: [{ at: NOW - MIN, chat: 'Miner', ok: true }, { at: NOW - 40 * MIN, chat: 'Digger', ok: false }] }).open, true)
  const failed = [{ at: NOW - 20 * MIN, chat: 'Digger', ok: true }, { at: NOW - 10 * MIN, chat: 'Digger', ok: false }]
  assert.equal(at({ opens: failed }).open, false)
  assert.equal(at({ opens: failed.slice(0, OPEN_TRIES - 1) }).open, true)
})

test('the server opens an asleep worker on the same minute\'s look while other chats run, with the list\'s id only, one per look', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.match(server, /if \(!gone \|\| !\(await ownsLoops\(\)\)\) return gone \? undefined : openAsleep\(now, given\)/)
  assert.match(server, /const waiting = asleepWithWork\(state, store\.outbox\(\)\.filter\(message => !isLate\(message, now, keep\)\)\)/)
  assert.match(server, /asleepPlan\(\{ now, chat: one\.chat, since: one\.since, waitingSince: asleepWaiting\.get\(one\.chat\), opens, paused: isHolding\(state\.pause\) \}\)/)
  assert.match(server, /openChat\(\{ exe: await findClaude\(\), session: one\.session, cwd: resolve\(HERE, config\.project\) \}\)/)
})
