// F24a (2026-11-14): the pieces of start-board.mjs's runs-already check (src/keeperStart.mjs): the process listing read, the
// keepers of a folder among the processes, the holder of a port in netstat's output, and the decision table. No process is
// started or listed here; test/startBoard.test.mjs runs the real cases.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { LIST_MS, isBoardOf, keepersOf, netstat, parseProcessList, portHolderOf, powershell, runsAlready, runsFolder } from '../src/keeperStart.mjs'
import { boardRuns } from '../start-board.mjs'
import { unhidden } from './windowsHide.test.mjs'

const DIR = 'C:\\Web\\p\\worker-board'
const KEEPER = { pid: 100, parent: 1, commandLine: '"C:\\Program Files\\nodejs\\node.exe" C:\\Web\\p\\worker-board\\server.mjs' }
const BOARD = { pid: 101, parent: 100, commandLine: '"C:\\Program Files\\nodejs\\node.exe" C:/Web/p/worker-board/server.mjs' }
const OTHER = { pid: 200, parent: 1, commandLine: '"C:\\Program Files\\nodejs\\node.exe" C:\\Web\\other\\worker-board\\server.mjs' }

test('the listing read, the keepers of a folder (the child\'s parent is the keeper; both slashes; another folder is not ours)', () => {
  const text = '\uFEFF{"boot":"2026-11-14T06:00:00.0000000Z","processes":[{"pid":100,"parent":1,"commandLine":"x","created":"2026-11-14T07:00:00.0000000Z"},{"pid":"bad"}]}'
  assert.deepEqual(parseProcessList(text), { bootAt: Date.parse('2026-11-14T06:00:00Z'), processes: [{ pid: 100, parent: 1, commandLine: 'x', createdAt: Date.parse('2026-11-14T07:00:00Z') }] })
  assert.equal(parseProcessList('not json'), null)
  assert.deepEqual(keepersOf([KEEPER, BOARD, OTHER], DIR), [{ pid: 100, children: [101] }])
  assert.deepEqual(keepersOf([KEEPER, BOARD, OTHER], 'C:/Web/p/worker-board/'), [{ pid: 100, children: [101] }])
  assert.deepEqual(keepersOf([OTHER], DIR), [])
  assert.deepEqual(keepersOf(null, DIR), [])
  assert.equal(runsFolder('node C:\\Web\\p\\worker-board\\test\\x.test.mjs', DIR), false, 'a test of the folder is no board')
})

test('the holder of a port in netstat\'s output: the LISTENING line of that port alone, any local address', () => {
  const text = [
    'Active Connections', '', '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1234',
    '  TCP    127.0.0.1:4310         0.0.0.0:0              LISTENING       45400',
    '  TCP    127.0.0.1:43100        0.0.0.0:0              LISTENING       7',
    '  TCP    127.0.0.1:4310         127.0.0.1:52000        ESTABLISHED     45400',
    '  TCP    [::1]:4314             [::]:0                 LISTENING       9',
  ].join('\r\n')
  assert.equal(portHolderOf(text, 4310), 45400)
  assert.equal(portHolderOf(text, 4314), 9)
  assert.equal(portHolderOf(text, 431), null)
  assert.equal(portHolderOf('', 4310), null)
})

test('this board\'s processes: the folder\'s server.mjs without --demo, --history-from or --launch-entry, and no --port but the resolved one', () => {
  const node = '"C:\\Program Files\\nodejs\\node.exe"'
  assert.equal(isBoardOf(`${node} ${DIR}\\server.mjs`, DIR, 4310), true)
  assert.equal(isBoardOf(`${node} ${DIR}\\server.mjs --port 4310 --log`, DIR, 4310), true)
  assert.equal(isBoardOf(`${node} ${DIR}\\server.mjs --port 4311`, DIR, 4310), false, 'another port')
  assert.equal(isBoardOf(`${node} ${DIR}\\server.mjs --demo --port 4310`, DIR, 4310), false, 'a demo')
  assert.equal(isBoardOf(`${node} ${DIR}\\server.mjs --history-from C:\\x\\data`, DIR, 4310), false, 'a second board showing history')
  assert.equal(isBoardOf(`${node} ${DIR}\\server.mjs --launch-entry`, DIR, 4310), false)
  assert.equal(isBoardOf(`${node} C:\\Web\\other\\server.mjs`, DIR, 4310), false)
  assert.deepEqual(keepersOf([KEEPER, BOARD, { pid: 300, parent: 1, commandLine: `${node} ${DIR}\\server.mjs --demo --port 4311` }], DIR, 4310), [{ pid: 100, children: [101] }])
  assert.equal(LIST_MS, 20_000)
})

test('the decision: an answer, a keeper of the folder, the port held by the folder\'s process: runs, nothing started; a foreign holder: not ours; nothing: start', () => {
  const at = { dir: DIR, port: 4310, answerSeconds: 15 }
  assert.deepEqual(runsAlready({ ...at, answers: true }), { runs: true, why: 'it answers' })
  assert.deepEqual(runsAlready({ ...at, answers: false, processes: [KEEPER, BOARD, OTHER], holder: 101 }), { runs: true, why: 'process 101 of this folder holds the port but did not answer within 15 seconds: slow or starting; nothing started' })
  assert.deepEqual(runsAlready({ ...at, answers: false, processes: [KEEPER, BOARD, OTHER], holder: null }).why, 'a keeper of this folder runs (process 100, board 101) but did not answer within 15 seconds: slow or starting; nothing started')
  assert.deepEqual(runsAlready({ ...at, answers: false, processes: [KEEPER], holder: null }), { runs: true, why: 'a keeper of this folder runs (process 100) but did not answer within 15 seconds: slow or starting; nothing started' })
  // The port held by a process of this folder that is no keeper by its parent (its parent runs the folder too, say, read oddly).
  const odd = { pid: 300, parent: 1, commandLine: 'node -e "x" C:\\Web\\p\\worker-board\\server.mjs' }
  assert.deepEqual(runsAlready({ ...at, answers: false, processes: [odd], holder: 300 }).runs, true)
  // Another program on the port: not ours, and a start would fail on it; also when a keeper of this folder runs beside it (its child
  // dies on the port). A demo of this folder on the port is not this board either.
  assert.deepEqual(runsAlready({ ...at, answers: false, processes: [OTHER], holder: 200 }), { runs: false, foreign: { pid: 200, commandLine: OTHER.commandLine } })
  assert.deepEqual(runsAlready({ ...at, answers: false, processes: [KEEPER, OTHER], holder: 200 }).foreign?.pid, 200)
  const demo = { pid: 400, parent: 1, commandLine: '"C:\\Program Files\\nodejs\\node.exe" C:\\Web\\p\\worker-board\\server.mjs --demo --port 4310' }
  assert.deepEqual(runsAlready({ ...at, answers: false, processes: [demo], holder: 400 }).foreign?.pid, 400)
  assert.deepEqual(runsAlready({ ...at, answers: false, processes: [demo], holder: null }), { runs: false }, 'a demo keeper is no keeper of this board')
  assert.deepEqual(runsAlready({ ...at, answers: false, processes: [], holder: 999 }), { runs: false, foreign: { pid: 999, commandLine: '' } })
  // Nothing of this folder and a free port: a start.
  assert.deepEqual(runsAlready({ ...at, answers: false, processes: [OTHER], holder: null }), { runs: false })
  // No listing (it failed or took too long): unknown, never a start on a guess; the holder alone does not decide.
  assert.deepEqual(runsAlready({ ...at, answers: false, processes: null, holder: null, listingError: 'PowerShell took longer than 10 s' }), { runs: false, unknown: "the PC's processes could not be listed (PowerShell took longer than 10 s): whether this folder's board runs is unknown; nothing started" })
  assert.deepEqual(runsAlready({ ...at, answers: false, processes: null, holder: 45400 }).runs, false)
  assert.match(runsAlready({ ...at, answers: false, processes: null, holder: 45400 }).unknown, /^the PC's processes could not be listed: /)
})

test('PowerShell and netstat get Normal priority from outside at once (a start-board.mjs under Low is at Idle: its helpers would starve); the listing is tried twice, and only two failures are unknown', async t => {
  if (process.platform !== 'win32') return t.skip('Windows only')
  const raised = []
  const raise = pid => raised.push(pid)
  await powershell('Write-Output 1', 20_000, { raise })
  await netstat(20_000, { raise })
  assert.equal(raised.length, 2)
  assert.ok(raised.every(pid => Number.isInteger(pid) && pid > 0), String(raised))
  // boardRuns (start-board.mjs): a listing that fails once is tried again; twice is unknown, never a start.
  let calls = 0
  const listing = JSON.stringify({ boot: '2026-11-14T06:00:00Z', processes: [{ pid: 100, parent: 1, commandLine: '"C:\\node.exe" C:\\Web\\p\\worker-board\\server.mjs' }] })
  const flaky = async () => { calls += 1; if (calls === 1) throw new Error('PowerShell took longer than 20 s'); return listing }
  const onceOk = await boardRuns(4310, { answers: async () => false, list: flaky, ports: async () => '', platform: 'win32', dir: 'C:\\Web\\p\\worker-board' })
  assert.deepEqual([calls, onceOk.runs], [2, true])
  calls = 0
  const broken = async () => { calls += 1; throw new Error('PowerShell took longer than 20 s') }
  const unknown = await boardRuns(4310, { answers: async () => false, list: broken, ports: async () => '', platform: 'win32', dir: 'C:\\Web\\p\\worker-board' })
  assert.equal(calls, 2)
  assert.match(unknown.unknown, /^the PC's processes could not be listed \(PowerShell took longer than 20 s; again: PowerShell took longer than 20 s\): whether this folder's board runs is unknown; nothing started$/)
})

test('the listing has a 20 s bound, and PowerShell and netstat are started hidden (start-board.mjs runs detached from a chat\'s mod: a console program without windowsHide pops a terminal up)', () => {
  assert.equal(LIST_MS, 20_000)
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'keeperStart.mjs'), 'utf8')
  assert.deepEqual(unhidden(source), [])
  assert.equal((source.match(/windowsHide: true/g) ?? []).length, 2, 'both spawns')
})
