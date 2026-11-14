// F10 (2026-11-14): the watcher's scheduled task as `npm run setup` registers, removes and tells it (src/watcherSetup.mjs), and one
// pass of the watcher over made-up boards (tools/watch-boards.mjs `watchOnce`): the HTTP answer first (G6), one process listing for
// the boards that did not answer, the decision per board, the start through the given route, one log line per start and none when
// nothing is done, the record kept. schtasks and the processes are fakes; no task is registered and no process started.

import assert from 'node:assert/strict'
import test from 'node:test'

import { queryWords, setupWatcher, taskNameFor, taskXml, vbsText } from '../src/watcherSetup.mjs'
import { watchOnce } from '../tools/watch-boards.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 14, 10, 0).getTime()

test('the task: its name from the project folder, its XML (logon and every 5 minutes, the interactive token, hidden, one instance, 4 minutes), its .vbs', () => {
  assert.equal(taskNameFor('C:\\Web\\lava-tactics-project'), 'Worker board watcher (lava-tactics-project)')
  assert.equal(taskNameFor('C:\\Web\\Test\\'), 'Worker board watcher (Test)')
  const xml = taskXml({ name: 'Worker board watcher (lava-tactics-project)', vbs: 'C:\\Users\\me\\.worker-board\\watch-boards.vbs', user: 'PC\\me' })
  for (const part of ['<LogonTrigger><Enabled>true</Enabled><UserId>PC\\me</UserId>', '<Interval>PT5M</Interval>', '<LogonType>InteractiveToken</LogonType>', '<Hidden>true</Hidden>', '<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>', '<ExecutionTimeLimit>PT4M</ExecutionTimeLimit>', '<StartWhenAvailable>true</StartWhenAvailable>', '<Command>wscript.exe</Command><Arguments>//B //Nologo "C:\\Users\\me\\.worker-board\\watch-boards.vbs"</Arguments>']) {
    assert.ok(xml.includes(part), part)
  }
  assert.doesNotMatch(xml, /Password|<RunLevel>HighestAvailable/, 'no password, no admin')
  const vbs = vbsText({ node: 'C:\\Program Files\\nodejs\\node.exe', script: 'C:\\Web\\lava-tactics-project\\worker-board\\tools\\watch-boards.mjs' })
  // VBScript doubles a quote inside a string: the run string is "<node>" "<script>", window style 0, no wait.
  assert.match(vbs, /^shell\.Run """C:\\Program Files\\nodejs\\node\.exe"" ""C:\\Web\\lava-tactics-project\\worker-board\\tools\\watch-boards\.mjs""", 0, False$/m, 'window style 0, no wait')
  assert.deepEqual(queryWords('Folder: \\\r\nHostName: PC\r\nTaskName: \\Worker board watcher (x)\r\nStatus: Ready\r\nLast Run Time: 14-11-2026 10:05:00\r\nLast Result: 0\r\n'), { present: true, status: 'Ready', lastRun: '14-11-2026 10:05:00', lastResult: '0' })
  assert.deepEqual(queryWords(''), { present: false })
})

test('setup registers the task from an XML in the person\'s worker-board home (G5: never in the checkout), replacing one that is there; --watcher off removes it; --check only tells', async () => {
  const calls = []
  const written = []
  const run = async (program, args) => {
    calls.push([program, ...args])
    if (args[0] === '/Query') return { code: 1, out: '', err: 'ERROR: The system cannot find the file specified.' }
    return { code: 0, out: 'SUCCESS: The scheduled task "Worker board watcher (lava-tactics-project)" has successfully been created.', err: '' }
  }
  const write = async (file, text) => { written.push([file, text]) }
  const common = { home: 'C:\\Users\\me\\.worker-board', node: 'C:\\node.exe', script: 'C:\\Web\\lava-tactics-project\\worker-board\\tools\\watch-boards.mjs', project: 'C:\\Web\\lava-tactics-project', user: 'PC\\me', run, write }
  const on = await setupWatcher({ mode: 'on', ...common })
  assert.equal(on.ok, true)
  assert.match(on.lines[0], /^The watcher task "Worker board watcher \(lava-tactics-project\)" is registered: every 5 minutes and at logon, as PC\\me, hidden \(wscript, C:\\Users\\me\\.worker-board\\watch-boards\.vbs\)/)
  assert.deepEqual(written.map(([file]) => file), ['C:\\Users\\me\\.worker-board\\watch-boards.vbs', 'C:\\Users\\me\\.worker-board\\watch-boards.task.xml'])
  assert.ok(written.every(([file]) => !file.includes('\\tools\\')), 'nothing is written into the checkout')
  assert.deepEqual(calls.at(-1), ['schtasks', '/Create', '/XML', 'C:\\Users\\me\\.worker-board\\watch-boards.task.xml', '/TN', 'Worker board watcher (lava-tactics-project)', '/F'])
  // --check: tells, writes nothing, creates nothing.
  calls.length = 0
  written.length = 0
  const check = await setupWatcher({ mode: 'check', ...common })
  assert.deepEqual([check.ok, written, calls.map(one => one[1])], [true, [], ['/Query']])
  assert.match(check.lines[0], /is not registered: setup would register it/)
  // --watcher off with the task there: deleted; not there: nothing to remove.
  const there = async (program, args) => { calls.push([program, ...args]); return { code: 0, out: args[0] === '/Query' ? 'TaskName: x\r\nStatus: Ready\r\nLast Run Time: never\r\nLast Result: 0\r\n' : '', err: '' } }
  calls.length = 0
  const off = await setupWatcher({ mode: 'off', ...common, run: there })
  assert.equal(off.ok, true)
  assert.match(off.lines[0], /is removed/)
  assert.deepEqual(calls.at(-1), ['schtasks', '/Delete', '/TN', 'Worker board watcher (lava-tactics-project)', '/F'])
  assert.match((await setupWatcher({ mode: 'off', ...common })).lines[0], /was not registered: nothing to remove/)
  // A failing schtasks is said, never thrown.
  const failing = async () => ({ code: 1, out: '', err: 'ERROR: Access is denied.' })
  assert.deepEqual(await setupWatcher({ mode: 'on', ...common, run: failing }), { ok: false, lines: ['The watcher task "Worker board watcher (lava-tactics-project)" could not be registered: ERROR: Access is denied.'] })
})

test('one pass of the watcher: an answering board costs one request; the others share one process listing; a killed board is started through the given route with one log line; a keeper that runs is left alone; the record is kept', async () => {
  const boards = [{ folder: 'C:\\Web\\a\\worker-board', port: 4310 }, { folder: 'C:\\Web\\b\\worker-board', port: 4314 }, { folder: 'C:\\Web\\c\\worker-board', port: 4320 }]
  const asked = []
  let listed = 0
  const started = []
  const logged = []
  let kept = null
  const answers = async port => { asked.push(port); return port === 4310 }
  const listProcesses = async () => { listed += 1; return { bootAt: NOW - 24 * 60 * MIN, processes: [{ pid: 900, parent: 1, commandLine: '"C:\\node.exe" "C:\\Web\\c\\worker-board\\server.mjs" --log' }] } }
  const readStarted = async () => ({ at: NOW - 60 * MIN })
  const start = async ({ dir }) => { started.push(dir); return { pid: 5100, how: 'wmi', why: null } }
  const outcomes = await watchOnce({ boards, answers, listProcesses, start, readStarted, now: NOW, record: { boards: {} }, keepRecord: async record => { kept = record }, log: (dir, text) => logged.push([dir, text]), wait: async () => true })
  assert.deepEqual(outcomes.map(one => [one.port, one.do]), [[4310, 'nothing'], [4314, 'start'], [4320, 'nothing']])
  assert.deepEqual(asked, [4310, 4314, 4320], 'the HTTP answer first, once per board')
  assert.equal(listed, 1, 'one listing for the boards that did not answer')
  assert.deepEqual(started, ['C:\\Web\\b\\worker-board'])
  assert.deepEqual(logged.map(([dir, text]) => [dir, text.replace(/\(.*\)/, '(...)')]), [['C:\\Web\\b\\worker-board', 'watcher: started the board (...): keeper process 5100 by WMI']])
  assert.deepEqual(kept.boards['C:\\Web\\b\\worker-board'], { starts: [NOW], silentLooks: 0 })
  assert.deepEqual(kept.boards['C:\\Web\\c\\worker-board'], { starts: [], silentLooks: 1 })
  // Nothing to do: no listing, no log line, the record untouched but for the answering board's count.
  asked.length = 0
  logged.length = 0
  listed = 0
  const quiet = await watchOnce({ boards: [boards[0]], answers, listProcesses, start, now: NOW, record: { boards: {} }, keepRecord: async () => {}, log: (dir, text) => logged.push([dir, text]) })
  assert.deepEqual([quiet.map(one => one.do), listed, logged], [['nothing'], 0, []])
  // --dry: the decision said, nothing started or logged.
  started.length = 0
  const dry = await watchOnce({ boards: [boards[1]], answers, listProcesses, start, readStarted, now: NOW, record: { boards: {} }, keepRecord: async () => { throw new Error('a dry pass keeps nothing') }, log: () => { throw new Error('no line') }, isDry: true })
  assert.deepEqual([dry[0].do, started], ['start', []])
})
