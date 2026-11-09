// The go-live script (tools/land.ps1, 2026-11-04): the parts that are plain logic live in src/landing.mjs and are tested
// here: whether a gate run passed, the one-landing-at-a-time lock, whether a debugger holds a board, and the landings line.
// The script itself runs in test/landScript.test.mjs, with temporary repositories and fake boards only.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { RESULTS, STALE_LOCK_MS, asciiJson, boardProcesses, failingFiles, gatePassed, gateVerdict, hhmm, inspectorDecision, landingLine, lockHolder, refreshLock, releaseLock, stripAnsi, takeLock } from '../src/landing.mjs'

const scratch = mkdtempSync(join(tmpdir(), 'landing-test-'))
after(() => rmSync(scratch, { recursive: true, force: true }))
let counter = 0
const lockFile = () => {
  const folder = join(scratch, `lock-${++counter}`)
  mkdirSync(folder)
  return join(folder, 'landing.lock')
}
const MIN = 60_000
const NOW = Date.parse('2026-11-04T18:00:00Z')

// The gate: a run passes only on its summary line.

const BOARD_PASS = ['✔ one (0.4ms)', '✔ prints fail 0 in its name (0.1ms)', 'ℹ tests 2', 'ℹ suites 0', 'ℹ pass 2', 'ℹ fail 0', 'ℹ cancelled 0', 'ℹ duration_ms 57'].join('\n')

test('the board gate passes on the summary line "ℹ fail 0" and on nothing else', () => {
  assert.deepEqual(gatePassed(BOARD_PASS, 'board'), { ok: true, why: null })
  assert.deepEqual(gatePassed(BOARD_PASS.replace(/\n/g, '\r\n'), 'board', 0), { ok: true, why: null })
  const failed = gatePassed(BOARD_PASS.replace('ℹ fail 0', 'ℹ fail 2'), 'board')
  assert.equal(failed.ok, false)
  assert.match(failed.why, /fail 2/)
})

test('a run with no summary line fails: a missing summary is a failure, never a pass', () => {
  for (const output of ['', '   \n', 'ok\n✔ one (0.4ms)\n', 'Error: Cannot find module', 'ℹ tests 2\nℹ pass 2']) {
    const run = gatePassed(output, 'board')
    assert.equal(run.ok, false, output)
    assert.match(run.why, /no summary/)
  }
})

test('"fail 0" in a test name is no summary: a run whose real summary says fail 1 fails', () => {
  const output = ['✔ the gate says fail 0 (0.1ms)', '✖ a real failure (2ms)', '✔ ℹ fail 0 inside a name (0.1ms)', 'ℹ tests 3', 'ℹ pass 2', 'ℹ fail 1'].join('\n')
  assert.equal(gatePassed(output, 'board').ok, false)
  // And one with only such names and no summary at all.
  assert.equal(gatePassed('✔ the gate says fail 0 (0.1ms)\n✔ ℹ fail 0 inside a name\n', 'board').ok, false)
})

test('a summary line a nested run printed (indented) does not count; a second real summary with failures fails the run', () => {
  assert.equal(gatePassed(`    ℹ fail 0\n${BOARD_PASS.replace('ℹ fail 0', 'ℹ fail 3')}`, 'board').ok, false)
  assert.equal(gatePassed('    ℹ fail 0\nℹ tests 1', 'board').ok, false, 'only an indented one: no summary')
  assert.equal(gatePassed(`${BOARD_PASS}\n${BOARD_PASS.replace('ℹ fail 0', 'ℹ fail 1')}`, 'board').ok, false)
})

test('a summary that says fail 0 does not pass when the command itself ended with an error code', () => {
  const run = gatePassed(BOARD_PASS, 'board', 1)
  assert.equal(run.ok, false)
  assert.match(run.why, /code 1/)
  assert.equal(gatePassed(BOARD_PASS, 'board', 0).ok, true)
})

test('the mod gate passes on its " 0 fail" summary; a failing, a missing or a name-only "0 fail" does not', () => {
  const pass = ['(pass) one [0.4ms]', '(pass) a test that says 0 fail [0.1ms]', '', ' 389 pass', ' 0 fail', 'Ran 389 tests across 8 files. [26.47s]'].join('\n')
  assert.deepEqual(gatePassed(pass, 'mod'), { ok: true, why: null })
  assert.equal(gatePassed(pass.replace('\n 0 fail\n', '\n 3 fail\n'), 'mod').ok, false)
  assert.equal(gatePassed('(pass) a test that says 0 fail [0.1ms]\n(fail) one [2ms]\n', 'mod').ok, false)
  assert.equal(gatePassed('(fail) x [1ms]\n 4 pass\n 1 fail\n 0 fail inside\n', 'mod').ok, false)
  assert.equal(gatePassed(pass, 'mod', 3).ok, false)
  assert.match(gatePassed('', 'mod').why, /no summary/)
  // The board's summary is no mod summary and the other way round.
  assert.equal(gatePassed(BOARD_PASS, 'mod').ok, false)
  assert.equal(gatePassed(pass, 'board').ok, false)
})

// The lock.

test('a free lock is taken: its file says who, which branch, since when and the process', () => {
  const file = lockFile()
  const took = takeLock(file, { by: 'chat 3', branch: 'land-script', pid: 4242, now: NOW })
  assert.equal(took.ok, true)
  assert.equal(took.broke, null)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { by: 'chat 3', branch: 'land-script', at: '2026-11-04T18:00:00.000Z', pid: 4242 })
  assert.deepEqual(took.token, { pid: 4242, at: '2026-11-04T18:00:00.000Z' })
})

test('a lock another landing holds for 5 minutes is refused, naming who, the branch and the time', () => {
  const file = lockFile()
  takeLock(file, { by: 'chat 1', branch: 'mod-0.31.0', pid: 1, now: NOW - 5 * MIN })
  const second = takeLock(file, { by: 'chat 3', branch: 'land-script', pid: 2, now: NOW })
  assert.equal(second.ok, false)
  assert.equal(second.why, `a landing by chat 1 of mod-0.31.0 holds the lock since ${hhmm('2026-11-04T17:55:00.000Z')}`)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).by, 'chat 1', 'the holder\'s lock stands')
})

test('a lock held for 16 minutes is stale: it is broken with its line and taken', () => {
  const file = lockFile()
  takeLock(file, { by: 'chat 1', branch: 'mod-0.31.0', pid: 1, now: NOW - 16 * MIN })
  const second = takeLock(file, { by: 'chat 3', branch: 'land-script', pid: 2, now: NOW })
  assert.equal(second.ok, true)
  assert.equal(second.broke, `broke a stale landing lock of chat 1 (mod-0.31.0, since ${hhmm('2026-11-04T17:44:00.000Z')})`)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).by, 'chat 3')
  // The edge: exactly 15 minutes still holds; one millisecond more is stale.
  const edge = lockFile()
  takeLock(edge, { by: 'a', branch: 'b', pid: 1, now: NOW - STALE_LOCK_MS })
  assert.equal(takeLock(edge, { by: 'c', branch: 'd', pid: 2, now: NOW }).ok, false)
  const over = lockFile()
  takeLock(over, { by: 'a', branch: 'b', pid: 1, now: NOW - STALE_LOCK_MS - 1 })
  assert.equal(takeLock(over, { by: 'c', branch: 'd', pid: 2, now: NOW }).ok, true)
})

test('a lock file nobody can read is judged by the file\'s own age: fresh holds, old is broken', () => {
  const fresh = lockFile()
  writeFileSync(fresh, '')
  const held = takeLock(fresh, { by: 'chat 3', branch: 'x', pid: 2, now: Date.now() })
  assert.equal(held.ok, false)
  assert.match(held.why, /holds the lock since/)
  const old = lockFile()
  writeFileSync(old, '{ torn')
  const long = new Date(Date.now() - 20 * MIN)
  utimesSync(old, long, long)
  const broke = takeLock(old, { by: 'chat 3', branch: 'x', pid: 2, now: Date.now() })
  assert.equal(broke.ok, true)
  assert.match(broke.broke, /^broke a stale landing lock of unknown/)
})

test('the lock is given back only by the run that holds it: a lock another run took over is never removed', () => {
  const file = lockFile()
  const mine = takeLock(file, { by: 'chat 3', branch: 'x', pid: 7, now: NOW })
  assert.equal(releaseLock(file, mine.token), true)
  assert.equal(existsSync(file), false)
  assert.equal(releaseLock(file, mine.token), false, 'nothing left to give back')
  // Taken over after it went stale: the first run's release leaves the second's lock.
  const first = takeLock(file, { by: 'chat 1', branch: 'a', pid: 1, now: NOW - 20 * MIN })
  const second = takeLock(file, { by: 'chat 3', branch: 'b', pid: 2, now: NOW })
  assert.equal(second.ok, true)
  assert.equal(releaseLock(file, first.token), false)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).by, 'chat 3')
  assert.equal(releaseLock(file, second.token), true)
})

test('lockHolder reads who holds the lock and for how long, or null when none', () => {
  const file = lockFile()
  assert.equal(lockHolder(file, NOW), null)
  takeLock(file, { by: 'chat 1', branch: 'a', pid: 1, now: NOW - 3 * MIN })
  assert.deepEqual(lockHolder(file, NOW), { by: 'chat 1', branch: 'a', at: '2026-11-04T17:57:00.000Z', pid: 1, ageMs: 3 * MIN })
})

// The debugger check.

const BOARDS = [{ dir: 'D:\\boards\\main\\worker-board', port: 4310 }, { dir: 'D:\\boards\\trial\\worker-board', port: 4314 }]
const node = (pid, ppid, commandLine) => ({ pid, ppid, name: 'node.exe', commandLine })
const listen = (pid, port) => ({ state: 'Listen', localAddress: '127.0.0.1', localPort: port, remoteAddress: '0.0.0.0', remotePort: 0, pid })
const link = (pid, localPort, remotePort) => ({ state: 'Established', localAddress: '127.0.0.1', localPort, remoteAddress: '127.0.0.1', remotePort, pid })

const PROCESSES = [
  node(100, 1, 'node "D:\\boards\\main\\worker-board\\server.mjs"'),
  node(101, 100, '"C:\\Program Files\\nodejs\\node.exe" D:\\boards\\main\\worker-board\\server.mjs'),
  node(200, 1, 'node D:\\boards\\trial\\worker-board\\server.mjs'),
  node(201, 200, 'node D:\\boards\\trial\\worker-board\\server.mjs'),
  node(900, 1, 'node D:\\boards\\elsewhere\\worker-board\\server.mjs'),
  node(950, 1, 'node D:\\boards\\tools\\trace.mjs'),
]
const BASE = [listen(101, 4310), listen(201, 4314), listen(900, 4400), link(101, 4310, 55000), link(7, 55000, 4310)]

test('the board\'s processes are its keeper and its child, found by the folder\'s server.mjs, by the port and by the parent of the port\'s owner', () => {
  const found = boardProcesses({ boards: BOARDS, processes: PROCESSES, connections: BASE })
  assert.deepEqual(found.map(one => [one.port, one.role, one.pid]), [[4310, 'keeper', 100], [4310, 'child', 101], [4314, 'keeper', 200], [4314, 'child', 201]])
  // A keeper started as `node server.mjs` has no folder in its words: it is the parent of the one that listens.
  const bare = boardProcesses({ boards: [BOARDS[0]], processes: [node(100, 1, 'node server.mjs'), node(101, 100, 'node server.mjs')], connections: [listen(101, 4310)] })
  assert.deepEqual(bare.map(one => [one.role, one.pid]), [['keeper', 100], ['child', 101]])
  // A board nobody answers for has no process.
  assert.deepEqual(boardProcesses({ boards: BOARDS, processes: [], connections: [] }), [])
})

test('no inspector on a board: ok, nothing to say', () => {
  const decision = inspectorDecision({ boards: BOARDS, processes: PROCESSES, connections: BASE })
  assert.deepEqual([decision.verdict, decision.refusal, decision.notes], ['ok', null, []])
})

test('an inspector that listens and has no client is a note, not a refusal (the warm restart replaces it)', () => {
  const decision = inspectorDecision({ boards: BOARDS, processes: PROCESSES, connections: [...BASE, listen(101, 9229)] })
  assert.equal(decision.verdict, 'note')
  assert.equal(decision.refusal, null)
  assert.deepEqual(decision.notes, ['an inspector listens on 9229 at the 4310 board\'s child (pid 101); no client is attached, going on'])
})

test('a client on the inspector is a refusal that names the board, its process, the port and the client with its command line', () => {
  // The real case, 2026-11-04 17:11: a trace script of a worker held the old child on 4310.
  const connections = [...BASE, listen(101, 9229), link(101, 9229, 61000), link(950, 61000, 9229)]
  const decision = inspectorDecision({ boards: BOARDS, processes: PROCESSES, connections })
  assert.equal(decision.verdict, 'refuse')
  assert.equal(decision.refusal, 'a debugger is attached to the 4310 board\'s child (pid 101, inspector port 9229, client pid 950 node D:\\boards\\tools\\trace.mjs): stop it first')
  // A client whose end of the pair is not in the list is still a client.
  const unseen = inspectorDecision({ boards: BOARDS, processes: PROCESSES, connections: [...BASE, listen(201, 9230), link(201, 9230, 61001)] })
  assert.equal(unseen.verdict, 'refuse')
  assert.match(unseen.refusal, /^a debugger is attached to the 4314 board's child \(pid 201, inspector port 9230, client pid unknown\): stop it first$/)
  // The keeper's own inspector counts as the keeper's.
  const keeper = inspectorDecision({ boards: BOARDS, processes: PROCESSES, connections: [...BASE, listen(100, 9231), link(100, 9231, 61002), link(950, 61002, 9231)] })
  assert.match(keeper.refusal, /the 4310 board's keeper \(pid 100, inspector port 9231, client pid 950/)
})

test('the boards\' own ports and other processes\' connections are no inspector: a page, the script\'s own asks, another folder\'s board', () => {
  // The board's own port with a dozen established connections, and the other board's port listened to by the same process.
  const busy = [...BASE, link(101, 4310, 55001), link(101, 4310, 55002), listen(101, 4314), link(101, 4314, 55003), listen(900, 9229), link(900, 9229, 55004)]
  assert.equal(inspectorDecision({ boards: BOARDS, processes: PROCESSES, connections: busy }).verdict, 'ok')
})

test('the decision names the first refusal when two boards are held, and keeps the notes of the others', () => {
  const connections = [...BASE, listen(101, 9229), listen(201, 9230), link(201, 9230, 61003), link(950, 61003, 9230)]
  const decision = inspectorDecision({ boards: BOARDS, processes: PROCESSES, connections })
  assert.equal(decision.verdict, 'refuse')
  assert.match(decision.refusal, /4314 board/)
  assert.equal(decision.notes.length, 1)
  assert.match(decision.notes[0], /4310 board's child/)
})

// The landings line.

test('the landings line has the fields in a fixed order, one line of plain ASCII JSON', () => {
  const line = landingLine({
    at: '2026-11-04T18:00:00.000Z', by: 'chat 3', branch: 'land-script', head: 'a'.repeat(40), before: 'b'.repeat(40), after: 'a'.repeat(40), trial: 'a'.repeat(7),
    result: 'landed', why: null, boards: [{ port: 4310, commit: 'aaaaaaa', since: 1762279200000 }, { port: 4314, commit: 'aaaaaaa', since: 1762279201000 }], cold: false, gateLog: 'data/landings/x.log',
  })
  assert.ok(!line.includes('\n'))
  const read = JSON.parse(line)
  assert.deepEqual(Object.keys(read), ['at', 'by', 'branch', 'head', 'before', 'after', 'trial', 'result', 'why', 'boards', 'cold', 'gateLog', 'branches'])
  assert.equal(read.result, 'landed')
  // 2026-11-09: the branches, empty when the run gave none; as given otherwise.
  assert.deepEqual(read.branches, { swept: [], kept: [], landed: null })
  const withBranches = JSON.parse(landingLine({ at: 'A', by: 'b', branch: 'c', head: 'h', before: 'b', after: 'a', result: 'landed', branches: { swept: ['old'], kept: ['ahead (not fully merged into main)'], landed: { remote: 'removed', local: 'kept: checked out in x' } } }))
  assert.deepEqual(withBranches.branches, { swept: ['old'], kept: ['ahead (not fully merged into main)'], landed: { remote: 'removed', local: 'kept: checked out in x' } })
  assert.deepEqual(read.boards, [{ port: 4310, commit: 'aaaaaaa', since: 1762279200000 }, { port: 4314, commit: 'aaaaaaa', since: 1762279201000 }])
  assert.equal(read.cold, false)
})

test('a refused landing has no "after"; every result is one of the four; anything else is an error', () => {
  const refused = JSON.parse(landingLine({ at: '2026-11-04T18:00:00.000Z', by: 'unknown', branch: 'x', head: 'h', before: 'b', after: 'wrongly given', result: 'refused', why: 'merge main into x first' }))
  assert.equal(refused.after, null)
  assert.equal(refused.why, 'merge main into x first')
  assert.deepEqual(refused.boards, [])
  assert.equal(refused.gateLog, null)
  assert.deepEqual(RESULTS, ['landed', 'refused', 'rolled-back', 'rollback-failed'])
  for (const result of RESULTS.slice(2)) assert.equal(JSON.parse(landingLine({ at: 'A', by: 'b', branch: 'c', head: 'h', before: 'b', after: 'a', result, why: 'w' })).after, 'a')
  assert.throws(() => landingLine({ at: 'A', by: 'b', branch: 'c', head: 'h', before: 'b', result: 'done' }), /result/)
})

test('text with characters above ASCII is escaped, so Windows PowerShell reads it the same whatever its code page', () => {
  assert.equal(asciiJson({ a: 'ℹ fail 0 é' }), '{"a":"\\u2139 fail 0 \\u00e9"}')
  const line = landingLine({ at: 'A', by: 'chat é', branch: 'x', head: 'h', before: 'b', result: 'refused', why: 'ℹ' })
  assert.ok(/^[\x20-\x7e]*$/.test(line))
  assert.equal(JSON.parse(line).by, 'chat é')
})

test('hhmm gives the local time of an ISO time as two digits and two digits', () => {
  const at = new Date(2026, 10, 4, 7, 5, 9).toISOString()
  assert.equal(hhmm(at), '07:05')
  assert.equal(hhmm('not a time'), '??:??')
})

// Review 2026-11-04 (an independent read of the first build): colours, the failing files, the lock's heartbeat.

const ESC = String.fromCharCode(27)

test('a summary the test runner coloured (FORCE_COLOR) is still the summary: the codes are stripped before the lines are read', () => {
  const coloured = ['✔ one (0.4ms)', 'ℹ tests 2', 'ℹ pass 2', `${ESC}[34mℹ fail 0${ESC}[39m`, `${ESC}[34mℹ cancelled 0${ESC}[39m`].join('\n')
  assert.deepEqual(gatePassed(coloured, 'board', 0), { ok: true, why: null })
  assert.equal(gatePassed(coloured.replace('fail 0', 'fail 2'), 'board').ok, false)
  // A colour in front of the mod's summary too, and codes alone are no summary.
  assert.equal(gatePassed(`(pass) a [1ms]\n ${ESC}[1m2 pass${ESC}[0m\n ${ESC}[31m0 fail${ESC}[0m\n`, 'mod').ok, true)
  assert.equal(gatePassed(`${ESC}[34m${ESC}[39m\n`, 'board').ok, false)
  assert.equal(stripAnsi(`${ESC}[1;32mgreen${ESC}[0m ${ESC}[?25hok`), 'green ok')
})

test('the failing test files are read from the runner\'s "failing tests" list (spec) and from the location of a "not ok" (tap), once each', () => {
  const spec = [
    '✖ a test (3ms)', '✖ failing tests:', '', 'test at test/anyProject.test.mjs:48:1', '✖ no new tie (175ms)', '  AssertionError', '',
    'test at test/landing.test.mjs:63:1', '✖ the mod gate (0.7ms)', '', 'test at test/anyProject.test.mjs:67:1',
  ].join('\n')
  assert.deepEqual(failingFiles(spec), ['test/anyProject.test.mjs', 'test/landing.test.mjs'])
  const tap = ["not ok 1 - a test", '  ---', "  location: 'file:///C:/work/board/test/a.test.mjs:12:1'", '  ...', 'not ok 2 - b', `  location: 'file:///C:/work/board/test/b.test.mjs:5:3'`].join('\n')
  assert.deepEqual(failingFiles(tap), ['C:/work/board/test/a.test.mjs', 'C:/work/board/test/b.test.mjs'])
  assert.deepEqual(failingFiles(BOARD_PASS), [])
  assert.deepEqual(failingFiles(`${ESC}[31mtest at test/x.test.mjs:1:1${ESC}[39m`), ['test/x.test.mjs'])
})

test('a gate verdict names the failing files and nothing more when it passed', () => {
  const failed = gateVerdict(['✖ failing tests:', 'test at test/a.test.mjs:1:1', 'ℹ fail 1'].join('\n'), 'board', 1)
  assert.deepEqual([failed.ok, failed.files], [false, ['test/a.test.mjs']])
  assert.deepEqual(gateVerdict(BOARD_PASS, 'board', 0), { ok: true, why: null })
  assert.deepEqual(Object.keys(gateVerdict('no summary at all', 'board', 0)), ['ok', 'why'], 'no files to name without a failing list')
})

test('the lock\'s heartbeat: a refresh gives the lock a new time, so a live landing never looks stale; only its holder may refresh', () => {
  const file = lockFile()
  const took = takeLock(file, { by: 'chat 3', branch: 'land-script', pid: 7, now: NOW - 14 * MIN })
  // Without a refresh it is 16 minutes old two minutes on, and another landing breaks it.
  const lateTaker = lockFile()
  takeLock(lateTaker, { by: 'chat 3', branch: 'land-script', pid: 7, now: NOW - 14 * MIN })
  assert.equal(takeLock(lateTaker, { by: 'chat 4', branch: 'x', pid: 8, now: NOW + 2 * MIN }).ok, true, 'a lock nobody refreshed is stale after 15 minutes')
  const refreshed = refreshLock(file, took.token, NOW)
  assert.equal(refreshed.ok, true)
  assert.deepEqual(refreshed.token, { pid: 7, at: '2026-11-04T18:00:00.000Z' })
  const held = takeLock(file, { by: 'chat 4', branch: 'x', pid: 8, now: NOW + 2 * MIN })
  assert.equal(held.ok, false, 'two minutes after the refresh the lock holds')
  assert.match(held.why, /^a landing by chat 3 of land-script holds the lock since /)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { by: 'chat 3', branch: 'land-script', at: '2026-11-04T18:00:00.000Z', pid: 7 })
  // The old token no longer gives it back; the new one does.
  assert.equal(releaseLock(file, took.token), false)
  assert.equal(releaseLock(file, refreshed.token), true)
})

test('a lock another landing took over, or that is gone, is not refreshed: the landing is told it is not its own', () => {
  const file = lockFile()
  const mine = takeLock(file, { by: 'chat 3', branch: 'a', pid: 7, now: NOW - 20 * MIN })
  takeLock(file, { by: 'chat 4', branch: 'b', pid: 8, now: NOW })
  const lost = refreshLock(file, mine.token, NOW)
  assert.equal(lost.ok, false)
  assert.match(lost.why, /^the landing lock was taken over by chat 4 \(b, since /)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).by, 'chat 4', 'the other landing\'s lock is untouched')
  rmSync(file)
  assert.deepEqual(refreshLock(file, mine.token, NOW), { ok: false, why: 'the landing lock is gone' })
})
