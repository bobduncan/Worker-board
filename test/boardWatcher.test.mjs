// F10 (2026-11-14): the boards survive a Claude app update. The watcher's decision for one board (src/boardWatcher.mjs), pure, by
// the design note's table and chat 1's guards: the board answers; a keeper runs (three silent looks: one line, never a second
// keeper, G7); a landing's lock; a stop sign current or stale (G4: the last boot, the start it belongs to); a crash with the
// three-per-hour cap; a killed board. And the WMI start route's pieces (src/keeperStart.mjs): the command line, the script, what
// Create prints, the keepers among the processes, the fallback. Made-up facts; no process is started.

import assert from 'node:assert/strict'
import test from 'node:test'

import { LOCK_FRESH_MS, SILENT_LOOKS, STARTS_PER_HOUR, STARTS_WITHIN_MS, clockOf, isSignCurrent, startsWithin, watchDecision, watcherRecordOf } from '../src/boardWatcher.mjs'
import { LIST_SCRIPT, WMI_START_MS, keeperCommandLine, keepersOf, parseCreated, parseProcessList, portOfArgs, psQuote, startKeeper, wmiCreateScript } from '../src/keeperStart.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 14, 10, 0).getTime()
const DIR = 'D:\\Proj\\garden\\worker-board'

test('the table: an answering board is left alone; a keeper that runs is given time, and after three silent looks one line, never a second keeper', () => {
  assert.deepEqual(watchDecision({ answers: true, now: NOW, record: { starts: [NOW - MIN], silentLooks: 2 } }), { do: 'nothing', why: 'the board answers', record: { starts: [NOW - MIN], silentLooks: 0 } })
  let record = { starts: [], silentLooks: 0 }
  for (let look = 1; look <= 4; look++) {
    const decided = watchDecision({ answers: false, keepers: [{ pid: 500 }], now: NOW + look * 5 * MIN, record })
    record = decided.record
    assert.equal(decided.do, look === SILENT_LOOKS ? 'say' : 'nothing', `look ${look}`)
    assert.equal(record.silentLooks, look)
  }
  assert.equal(SILENT_LOOKS, 3)
  assert.match(watchDecision({ answers: false, keepers: [{ pid: 500 }], now: NOW, record: { starts: [], silentLooks: 2 } }).why, /a keeper \(process 500\) runs, but the board has not answered for 3 looks in a row/)
  // The board answering again clears the count.
  assert.equal(watchDecision({ answers: true, now: NOW, record }).record.silentLooks, 0)
})

test('a fresh landing lock: nothing (land.ps1 restarts the boards itself); a stale one does not hold the watcher back', () => {
  assert.equal(watchDecision({ answers: false, lockAgeMs: 2 * MIN, now: NOW }).do, 'nothing')
  assert.equal(LOCK_FRESH_MS, 15 * MIN)
  assert.equal(watchDecision({ answers: false, lockAgeMs: 16 * MIN, startedAt: NOW - 60 * MIN, now: NOW }).do, 'start')
})

test('G4: a stop sign counts only when it is newer than the last boot and belongs to the board started last; a current "stopped" keeps the board down, a stale one does not', () => {
  const stopped = { at: NOW - 10 * MIN, why: 'stopped', started: NOW - 60 * MIN }
  // Current: written after the last boot by the board that started last (started.json says the same start).
  assert.equal(isSignCurrent(stopped, { bootAt: NOW - 24 * 60 * MIN, startedAt: NOW - 60 * MIN }), true)
  assert.equal(watchDecision({ answers: false, stop: stopped, startedAt: NOW - 60 * MIN, bootAt: NOW - 24 * 60 * MIN, now: NOW }).do, 'nothing')
  // A Windows restart: node ended with code 0 at shutdown and left a 'stopped' sign older than the boot: stale, the board starts.
  assert.equal(isSignCurrent(stopped, { bootAt: NOW - 5 * MIN, startedAt: NOW - 60 * MIN }), false)
  const afterBoot = watchDecision({ answers: false, stop: stopped, startedAt: NOW - 60 * MIN, bootAt: NOW - 5 * MIN, now: NOW })
  assert.equal(afterBoot.do, 'start')
  assert.match(afterBoot.why, /a stop sign of \d\d:\d\d is stale/)
  // land.ps1's cold restart: the new keeper started (started.json NOW-3), then the old board's exit wrote its sign (at NOW-2, of the start
  // NOW-60): the sign is the OLD board's, not the last start's: stale; a killed new board is started again.
  const oldBoards = { at: NOW - 2 * MIN, why: 'stopped', started: NOW - 60 * MIN }
  assert.equal(isSignCurrent(oldBoards, { bootAt: NOW - 24 * 60 * MIN, startedAt: NOW - 3 * MIN }), false)
  assert.equal(watchDecision({ answers: false, stop: oldBoards, startedAt: NOW - 3 * MIN, bootAt: NOW - 24 * 60 * MIN, now: NOW }).do, 'start')
  // A sign without `started` (an older board) counts when newer than the last start; nothing known: it counts.
  assert.equal(isSignCurrent({ at: NOW - MIN, why: 'stopped' }, { bootAt: null, startedAt: NOW - 3 * MIN }), true)
  assert.equal(isSignCurrent({ at: NOW - 5 * MIN, why: 'stopped' }, { bootAt: null, startedAt: NOW - 3 * MIN }), false)
  assert.equal(isSignCurrent({ at: NOW - MIN, why: 'stopped' }, {}), true)
  assert.equal(isSignCurrent(null, {}), false)
  // start-board.mjs --stop (and /stop-app) writes the sign with `by: 'command'`: the person's stop holds across boots and logons, and
  // whatever started.json says (chat 1's review, item 3); only a real start takes the file away.
  const byCommand = { at: NOW - 24 * 60 * MIN, why: 'stopped', by: 'command', started: NOW - 30 * 60 * MIN }
  assert.equal(isSignCurrent(byCommand, { bootAt: NOW - 60 * MIN, startedAt: NOW - 25 * 60 * MIN }), true)
  const held = watchDecision({ answers: false, stop: byCommand, startedAt: NOW - 25 * 60 * MIN, bootAt: NOW - 60 * MIN, now: NOW })
  assert.deepEqual([held.do, held.why], ['nothing', `stopped on purpose at ${clockOf(byCommand.at)} (by command: it holds until the next start)`])
  // The cut-off is the person's logon when the listing has it (Fast Startup leaves the boot time unchanged): the watcher passes it as bootAt.
  assert.deepEqual(parseProcessList('{"boot":"2026-11-10T06:00:00Z","logon":"2026-11-14T08:30:00Z","processes":[]}'), { bootAt: Date.parse('2026-11-10T06:00:00Z'), logonAt: Date.parse('2026-11-14T08:30:00Z'), processes: [] })
  assert.equal(parseProcessList('{"boot":"2026-11-10T06:00:00Z","processes":[]}').logonAt, null)
})

test('every start counts against the cap (chat 1\'s review, items 4 and 7): three "no sign" starts in an hour, and the fourth look leaves the board alone with one line', () => {
  let record = { starts: [], silentLooks: 0 }
  for (let n = 1; n <= STARTS_PER_HOUR; n++) {
    const decided = watchDecision({ answers: false, startedAt: NOW - 60 * MIN, now: NOW + n * MIN, record })
    assert.equal(decided.do, 'start', `start ${n}`)
    assert.match(decided.why, new RegExp(`^no keeper, no answer, no stop sign: .*: start ${n} of ${STARTS_PER_HOUR} this hour$`))
    record = decided.record
  }
  const fourth = watchDecision({ answers: false, startedAt: NOW - 60 * MIN, now: NOW + 4 * MIN, record })
  assert.equal(fourth.do, 'leave')
  assert.match(fourth.why, /^no keeper, no answer, no stop sign: .*, but it was started 3 times this hour: left alone until \d\d:\d\d$/)
  assert.deepEqual(fourth.record.starts.length, 3, 'a leave adds no start')
  // A stale sign's start and a crash's start count the same way.
  const stale = { at: NOW - 2 * 60 * MIN, why: 'restart', started: NOW - 3 * 60 * MIN }
  assert.equal(watchDecision({ answers: false, stop: stale, startedAt: NOW - 60 * MIN, bootAt: NOW - 90 * MIN, now: NOW + 4 * MIN, record }).do, 'leave')
  assert.equal(watchDecision({ answers: false, stop: { at: NOW - MIN, why: 'crash', started: NOW - 60 * MIN }, startedAt: NOW - 60 * MIN, now: NOW + 4 * MIN, record }).do, 'leave')
})

test('a crash (the keeper gave up): started again, three times an hour at most, then left alone until the hour is over; a killed board (no sign, no keeper) is started', () => {
  const crash = { at: NOW - 2 * MIN, why: 'crash', started: NOW - 30 * MIN }
  assert.equal(watchDecision({ answers: false, stop: crash, startedAt: null, now: NOW }).do, 'nothing', 'no started.json: left alone')
  let record = { starts: [], silentLooks: 0 }
  for (let n = 1; n <= STARTS_PER_HOUR; n++) {
    const decided = watchDecision({ answers: false, stop: crash, startedAt: NOW - 30 * MIN, now: NOW + n * MIN, record })
    assert.equal(decided.do, 'start', `start ${n}`)
    assert.match(decided.why, new RegExp(`start ${n} of ${STARTS_PER_HOUR} this hour`))
    record = decided.record
  }
  const fourth = watchDecision({ answers: false, stop: crash, startedAt: NOW - 30 * MIN, now: NOW + 4 * MIN, record })
  assert.equal(fourth.do, 'leave')
  assert.match(fourth.why, /the board crashed .*, but it was started 3 times this hour: left alone until \d\d:\d\d/)
  // An hour on the starts are forgotten.
  assert.equal(watchDecision({ answers: false, stop: crash, startedAt: NOW - 30 * MIN, now: NOW + MIN + STARTS_WITHIN_MS, record }).do, 'start')
  assert.deepEqual(startsWithin([NOW - 2 * STARTS_WITHIN_MS, NOW - MIN], NOW, true), [NOW - MIN, NOW])
  // A board that never ran here (no started.json): left alone; the watcher starts nothing new.
  const never = watchDecision({ answers: false, now: NOW })
  assert.deepEqual([never.do, never.why], ['nothing', 'the board never ran here (no data/started.json): start it once by hand'])
  // Killed by the app's update: no sign, no keeper, no answer, and it ran before.
  const killed = watchDecision({ answers: false, startedAt: NOW - 60 * MIN, now: NOW })
  assert.equal(killed.do, 'start')
  assert.match(killed.why, /no keeper, no answer, no stop sign/)
  assert.deepEqual(killed.record, { starts: [NOW], silentLooks: 0 })
})

test('the watcher\'s record file: the boards\' starts and silent looks, anything else left out', () => {
  assert.deepEqual(watcherRecordOf('{"boards":{"C:\\\\a":{"starts":[1,"x",2],"silentLooks":2},"C:\\\\b":{}}}'), { boards: { 'C:\\a': { starts: [1, 2], silentLooks: 2 }, 'C:\\b': { starts: [], silentLooks: 0 } } })
  assert.deepEqual(watcherRecordOf('nonsense'), { boards: {} })
})

test('the WMI start route: the command line, the hidden Create, what it prints, and the fallback with its log line', async () => {
  const node = 'C:\\Program Files\\nodejs\\node.exe'
  assert.equal(keeperCommandLine({ node, dir: DIR, args: ['--port', '4310', 'a word'] }), `"${node}" "${DIR}\\server.mjs" --log --port 4310 "a word"`)
  const script = wmiCreateScript(keeperCommandLine({ node, dir: DIR }), DIR)
  assert.match(script, /Get-CimClass -ClassName Win32_ProcessStartup/)
  assert.match(script, /ShowWindow = \[uint16\]0/, 'the console is never shown')
  assert.doesNotMatch(script, /CreateFlags/, 'CreateFlags made Create answer 21 on this PC')
  assert.match(script, /Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @\{ CommandLine = '"C:\\Program Files\\nodejs\\node\.exe" "D:\\Proj\\garden\\worker-board\\server\.mjs" --log'; CurrentDirectory = 'D:\\Proj\\garden\\worker-board'; ProcessStartupInformation = \$startup \}/)
  assert.equal(psQuote("it's"), "'it''s'")
  assert.deepEqual(parseCreated('ret=0 pid=4321\r\n'), { ret: 0, pid: 4321 })
  assert.deepEqual(parseCreated('ret=21 pid='), { ret: 21, pid: null })
  assert.equal(parseCreated('nothing'), null)
  // The route taken: WMI answers 0 with a pid: that is the keeper, nothing spawned.
  const spawned = []
  const logged = []
  const spawnChild = ({ dir, args }) => { spawned.push([dir, args]); return { pid: 77, on: () => {} } }
  const log = (dir, text) => logged.push([dir, text])
  const none = async () => ({ bootAt: null, logonAt: null, processes: [] })
  assert.deepEqual(await startKeeper({ dir: DIR, args: ['--quiet'], node, run: async () => 'ret=0 pid=5100', spawnChild, log, platform: 'win32', list: none }), { pid: 5100, how: 'wmi', why: null })
  assert.deepEqual([spawned, logged], [[], []])
  // A timeout or an unreadable answer is no proof that Create failed (chat 1's review, item 8): a keeper of the folder made since the
  // call is ours, nothing is spawned; one from before the call is not.
  const made = { pid: 6100, parent: 1, commandLine: `"${node}" "${DIR}\\server.mjs" --log`, createdAt: NOW }
  // The late look takes this board's keeper alone: a demo keeper of the folder made since the call is not it.
  const demoMade = { pid: 6200, parent: 1, commandLine: `"${node}" "${DIR}\\server.mjs" --log --demo --port 4311`, createdAt: NOW }
  assert.equal((await startKeeper({ dir: DIR, args: [], node, run: async () => { throw new Error('PowerShell took longer than 30 s') }, spawnChild: () => ({ pid: 77, on: () => {} }), log: () => {}, platform: 'win32', now: () => NOW, list: async () => ({ processes: [demoMade] }) })).how, 'child')
  const slow = async () => { throw new Error('PowerShell took longer than 30 s') }
  assert.deepEqual(await startKeeper({ dir: DIR, args: [], node, run: slow, spawnChild, log, platform: 'win32', now: () => NOW, list: async () => ({ processes: [made] }) }), { pid: 6100, how: 'wmi', why: null, late: 'PowerShell took longer than 30 s' })
  assert.deepEqual(await startKeeper({ dir: DIR, args: [], node, run: async () => 'garbage', spawnChild, log, platform: 'win32', now: () => NOW, list: async () => ({ processes: [made] }) }), { pid: 6100, how: 'wmi', why: null, late: 'WMI gave no answer that could be read' })
  assert.deepEqual([spawned, logged], [[], []])
  const older = await startKeeper({ dir: DIR, args: [], node, run: slow, spawnChild, log, platform: 'win32', now: () => NOW, list: async () => ({ processes: [{ ...made, createdAt: NOW - 60_000 }] }) })
  assert.equal(older.how, 'child', 'a keeper from before the call is not the one Create may have made')
  assert.equal(WMI_START_MS, 30_000)
  // The proof's mutant: WORKER_BOARD_START_ROUTE=child takes the old route without asking WMI.
  spawned.length = 0
  logged.length = 0
  const forced = await startKeeper({ dir: DIR, args: [], node, run: async () => { throw new Error('WMI must not be asked') }, spawnChild, log, platform: 'win32', env: { WORKER_BOARD_START_ROUTE: 'child' } })
  assert.deepEqual([forced.how, forced.why, spawned.length], ['child', 'WORKER_BOARD_START_ROUTE=child', 1])
  // Create refused, PowerShell missing or slow with no keeper made, an unreadable answer with none, or not Windows: the detached child, with one log line that says so.
  for (const [run, why, platform] of [[async () => 'ret=2 pid=', 'Win32_Process.Create answered 2', 'win32'], [async () => { throw new Error('PowerShell took longer than 10 s') }, 'PowerShell took longer than 10 s', 'win32'], [async () => 'garbage', 'WMI gave no answer that could be read', 'win32'], [async () => 'ret=0 pid=1', 'not Windows', 'linux']]) {
    spawned.length = 0
    logged.length = 0
    const made = await startKeeper({ dir: DIR, args: [], node, run, spawnChild, log, platform, list: none, env: {} })
    assert.deepEqual([made.pid, made.how, made.why], [77, 'child', why])
    assert.deepEqual(spawned, [[DIR, []]])
    assert.equal(logged.length, 1)
    assert.match(logged[0][1], new RegExp(`^started as a child of process \\d+ \\(WMI: ${why.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\): an app update will end it$`))
  }
})

test('the keepers of a folder among the PC\'s node processes: the one running its server.mjs whose parent does not (the child\'s parent is the keeper); both slashes; another folder\'s board is not it', () => {
  const list = [
    { pid: 100, parent: 1, commandLine: `"C:\\nodejs\\node.exe" "${DIR}\\server.mjs" --log` },
    { pid: 101, parent: 100, commandLine: `"C:\\nodejs\\node.exe" ${DIR}/server.mjs` },
    { pid: 200, parent: 1, commandLine: '"C:\\nodejs\\node.exe" "D:\\Proj\\garden-trial\\worker-board\\server.mjs"' },
    { pid: 300, parent: 1, commandLine: `"C:\\nodejs\\node.exe" "${DIR}\\tools\\watch-boards.mjs"` },
    { pid: 400, parent: 1, commandLine: null },
  ]
  assert.deepEqual(keepersOf(list, DIR), [{ pid: 100, children: [101] }])
  assert.deepEqual(keepersOf(list, `${DIR}\\`), [{ pid: 100, children: [101] }])
  assert.deepEqual(keepersOf(list, 'D:/Proj/garden-trial/worker-board'), [{ pid: 200, children: [] }])
  assert.deepEqual(keepersOf([], DIR), [])
  // The listing script's answer read: the boot time and the processes.
  const read = parseProcessList('\uFEFF{"boot":"2026-11-14T07:09:45.5000000Z","processes":[{"pid":100,"parent":1,"commandLine":"x","created":"2026-11-14T08:00:00.0000000Z"},{"pid":"bad"}]}')
  assert.deepEqual(read, { bootAt: Date.parse('2026-11-14T07:09:45.500Z'), logonAt: null, processes: [{ pid: 100, parent: 1, commandLine: 'x', createdAt: Date.parse('2026-11-14T08:00:00.000Z') }] })
  assert.deepEqual(parseProcessList('{"boot":"x","processes":{"pid":5,"parent":2,"commandLine":"y"}}').processes.map(one => one.pid), [5], 'one process comes as an object')
  assert.equal(parseProcessList('not json'), null)
  // F10's re-check: a CIM query that fails ends the script with an error (never an empty list), the logon comes from Win32_LogonSession.
  assert.match(LIST_SCRIPT, /^\$ErrorActionPreference = 'Stop'; /)
  assert.match(LIST_SCRIPT, /Win32_LogonSession/)
  assert.match(LIST_SCRIPT, /explorer\.exe'.*Get-CimAssociatedInstance -InputObject \$e -ResultClassName Win32_LogonSession/, 'the session holding the user\'s explorer')
  assert.deepEqual([portOfArgs(['--demo', '--port', '4311']), portOfArgs(['--quiet']), portOfArgs(['--port', 'x'])], [4311, null, null])
})
