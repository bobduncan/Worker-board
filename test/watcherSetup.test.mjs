// F10 (2026-11-14): the watcher's scheduled task as `npm run setup` registers, removes and tells it (src/watcherSetup.mjs), and one
// pass of the watcher over made-up boards (tools/watch-boards.mjs `watchOnce`): the HTTP answer first (G6), one process listing for
// the boards that did not answer, the decision per board, the start through the given route, one log line per start and none when
// nothing is done, the record kept. schtasks and the processes are fakes; no task is registered and no process started.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { OFF_MARKER, TASK_NAME, queryWords, setupWatcher, taskXml, vbsText, xmlBytes } from '../src/watcherSetup.mjs'
import { LOCK_STALE_MS, START_ARGS, takeWatcherLock, watchOnce } from '../tools/watch-boards.mjs'

const windows = { skip: process.platform !== 'win32' ? 'Windows only' : false }
/** What MSXML 6 says of loading the file: "<errorCode>|<reason>"; "0|" for a file it loads. */
const msxmlLoad = file => spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `$x = New-Object -ComObject Msxml2.DOMDocument.6.0; $x.async = $false; [void]$x.load('${file}'); Write-Output "$($x.parseError.errorCode)|$($x.parseError.reason.Trim())"`], { encoding: 'utf8', timeout: 30_000, windowsHide: true }).stdout.trim()

const MIN = 60_000
const NOW = new Date(2026, 10, 14, 10, 0).getTime()

test('the task: one name for the PC, its XML (logon and every 5 minutes, the interactive token, hidden, one instance, 4 minutes), its .vbs (wscript waits, so the one-instance rule holds)', () => {
  assert.equal(TASK_NAME, 'Worker board watcher')
  const xml = taskXml({ name: TASK_NAME, vbs: 'C:\\Users\\me\\.worker-board\\watch-boards.vbs', user: 'PC\\me' })
  for (const part of ['<LogonTrigger><Enabled>true</Enabled><UserId>PC\\me</UserId>', '<Interval>PT5M</Interval>', '<LogonType>InteractiveToken</LogonType>', '<Hidden>true</Hidden>', '<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>', '<ExecutionTimeLimit>PT4M</ExecutionTimeLimit>', '<StartWhenAvailable>true</StartWhenAvailable>', '<Command>wscript.exe</Command><Arguments>//B //Nologo "C:\\Users\\me\\.worker-board\\watch-boards.vbs"</Arguments>']) {
    assert.ok(xml.includes(part), part)
  }
  assert.doesNotMatch(xml, /Password|<RunLevel>HighestAvailable/, 'no password, no admin')
  const vbs = vbsText({ node: 'C:\\Program Files\\nodejs\\node.exe', script: 'D:\\Proj\\garden\\worker-board\\tools\\watch-boards.mjs' })
  // VBScript doubles a quote inside a string: the run string is "<node>" "<script>", window style 0, no wait.
  assert.match(vbs, /^shell\.Run """C:\\Program Files\\nodejs\\node\.exe"" ""D:\\Proj\\garden\\worker-board\\tools\\watch-boards\.mjs""", 0, True$/m, 'window style 0, waits for node')
  // The XML file's bytes: UTF-16LE with a BOM, as its first line declares (a UTF-8 file with that line is refused by schtasks).
  const bytes = xmlBytes(xml)
  assert.deepEqual([bytes[0], bytes[1]], [0xff, 0xfe])
  assert.equal(bytes.subarray(2).toString('utf16le'), xml)
  assert.deepEqual(queryWords('Folder: \\\r\nHostName: PC\r\nTaskName: \\Worker board watcher (x)\r\nStatus: Ready\r\nLast Run Time: 14-11-2026 10:05:00\r\nLast Result: 0\r\n'), { present: true, status: 'Ready', lastRun: '14-11-2026 10:05:00', lastResult: '0' })
  assert.deepEqual(queryWords(''), { present: false })
})

test('the written XML loads in MSXML 6 (what schtasks /Create /XML reads); the same text as UTF-8 does not (chat 1\'s review, items 1 and 5)', windows, t => {
  const dir = mkdtempSync(join(tmpdir(), 'watcher-xml-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const xml = taskXml({ name: TASK_NAME, vbs: 'C:\\Users\\me\\.worker-board\\watch-boards.vbs', user: 'PC\\me' })
  writeFileSync(join(dir, 'good.xml'), xmlBytes(xml))
  writeFileSync(join(dir, 'bad.xml'), xml)
  assert.equal(msxmlLoad(join(dir, 'good.xml')), '0|')
  assert.match(msxmlLoad(join(dir, 'bad.xml')), /^-\d+\|.*encoding/i, 'the UTF-8 file is refused')
})

test('setup registers the task from an XML in the person\'s worker-board home (G5: never in the checkout), replacing one that is there; --watcher off removes it and leaves a marker a plain setup respects (--watcher on removes it); --check only tells', async () => {
  const calls = []
  const written = []
  const run = async (program, args) => {
    calls.push([program, ...args])
    if (args[0] === '/Query') return { code: 1, out: '', err: 'ERROR: The system cannot find the file specified.' }
    return { code: 0, out: 'SUCCESS: The scheduled task "Worker board watcher" has successfully been created.', err: '' }
  }
  const write = async (file, text) => { written.push([file, text]) }
  const markers = new Set()
  const marker = 'C:\\Users\\me\\.worker-board\\watcher-off.json'
  const common = { home: 'C:\\Users\\me\\.worker-board', node: 'C:\\node.exe', script: 'D:\\Proj\\garden\\worker-board\\tools\\watch-boards.mjs', user: 'PC\\me', run, write, exists: async file => markers.has(file), remove: async file => { markers.delete(file) } }
  const on = await setupWatcher({ mode: 'on', ...common })
  assert.equal(on.ok, true)
  assert.match(on.lines[0], /^The watcher task "Worker board watcher" is registered: every 5 minutes and at logon, as PC\\me, hidden \(wscript, C:\\Users\\me\\.worker-board\\watch-boards\.vbs\)/)
  assert.deepEqual(written.map(([file]) => file), ['C:\\Users\\me\\.worker-board\\watch-boards.vbs', 'C:\\Users\\me\\.worker-board\\watch-boards.task.xml'])
  assert.ok(Buffer.isBuffer(written[1][1]) && written[1][1][0] === 0xff && written[1][1][1] === 0xfe, 'the XML goes as UTF-16LE with a BOM')
  assert.ok(written.every(([file]) => !file.includes('\\tools\\')), 'nothing is written into the checkout')
  assert.deepEqual(calls.at(-1), ['schtasks', '/Create', '/XML', 'C:\\Users\\me\\.worker-board\\watch-boards.task.xml', '/TN', 'Worker board watcher', '/F'])
  // --check: tells, writes nothing, creates nothing; with the off marker it says the watcher stays off.
  calls.length = 0
  written.length = 0
  const check = await setupWatcher({ mode: 'check', ...common })
  assert.deepEqual([check.ok, written, calls.map(one => one[1])], [true, [], ['/Query']])
  assert.match(check.lines[0], /is not registered: setup would register it/)
  markers.add(marker)
  assert.match((await setupWatcher({ mode: 'check', ...common })).lines[0], /is not registered and stays off \(`--watcher off` was given/)
  markers.delete(marker)
  // --check on a registered task names the script it runs (the task's XML → the .vbs → the watcher) and warns when it is another checkout's.
  const registered = async (program, args) => {
    calls.push([program, ...args])
    if (args[0] === '/Query' && args.includes('/XML')) return { code: 0, out: '<Task><Actions><Exec><Command>wscript.exe</Command><Arguments>//B //Nologo "C:\\Users\\me\\.worker-board\\watch-boards.vbs"</Arguments></Exec></Actions></Task>', err: '' }
    if (args[0] === '/Query') return { code: 0, out: 'TaskName: x\r\nStatus: Ready\r\nLast Run Time: 14-11-2026 10:05:00\r\nLast Result: 0\r\n', err: '' }
    return { code: 0, out: '', err: '' }
  }
  const vbsOf = script => vbsText({ node: 'C:\\node.exe', script })
  const ours = await setupWatcher({ mode: 'check', ...common, run: registered, read: async () => vbsOf(common.script) })
  assert.match(ours.lines[1], /^The task runs this checkout's watcher: D:\\Proj\\garden\\worker-board\\tools\\watch-boards\.mjs\.$/)
  const other = await setupWatcher({ mode: 'check', ...common, run: registered, read: async () => vbsOf('D:\\Proj\\garden-trial\\worker-board\\tools\\watch-boards.mjs') })
  assert.match(other.lines[1], /^WARNING: the task runs D:\\Proj\\garden-trial\\worker-board\\tools\\watch-boards\.mjs, not this checkout's /)
  assert.match((await setupWatcher({ mode: 'check', ...common, run: registered, read: async () => null })).lines[1], /could not be read/)
  // --watcher off with the task there: deleted; not there: nothing to remove.
  const there = async (program, args) => { calls.push([program, ...args]); return { code: 0, out: args[0] === '/Query' ? 'TaskName: x\r\nStatus: Ready\r\nLast Run Time: never\r\nLast Result: 0\r\n' : '', err: '' } }
  calls.length = 0
  written.length = 0
  const off = await setupWatcher({ mode: 'off', ...common, run: there })
  assert.equal(off.ok, true)
  assert.match(off.lines[0], /is removed .* It stays off until `npm run setup -- --watcher on`/)
  assert.deepEqual(calls.at(-1), ['schtasks', '/Delete', '/TN', 'Worker board watcher', '/F'])
  assert.deepEqual(written.map(([file]) => file), [marker], 'the off marker')
  assert.match((await setupWatcher({ mode: 'off', ...common })).lines[0], /was not registered: nothing to remove; it stays off/)
  // With the marker there, a plain setup leaves the watcher off and registers nothing; `--watcher on` removes the marker and registers.
  markers.add(marker)
  calls.length = 0
  written.length = 0
  const stillOff = await setupWatcher({ mode: 'on', ...common })
  assert.deepEqual([stillOff.ok, calls.filter(one => one[1] === '/Create').length, written.length], [true, 0, 0])
  assert.match(stillOff.lines[0], /^The watcher stays off \(`--watcher off` was given before, .*watcher-off\.json\): `npm run setup -- --watcher on` turns it on again\.$/)
  const onAgain = await setupWatcher({ mode: 'on', isExplicit: true, ...common })
  assert.deepEqual([onAgain.ok, markers.has(marker), calls.at(-1)[1]], [true, false, '/Create'])
  // --watcher off whose delete fails: said, and NO marker (the task still runs).
  const stuck = async (program, args) => { calls.push([program, ...args]); return args[0] === '/Query' ? { code: 0, out: 'TaskName: x\r\nStatus: Ready\r\n', err: '' } : { code: 1, out: '', err: 'ERROR: Access is denied.' } }
  written.length = 0
  const notOff = await setupWatcher({ mode: 'off', ...common, run: stuck })
  assert.deepEqual([notOff.ok, written.length], [false, 0])
  assert.match(notOff.lines[0], /could not be removed/)
  // A failing schtasks is said, never thrown.
  const failing = async () => ({ code: 1, out: '', err: 'ERROR: Access is denied.' })
  assert.deepEqual(await setupWatcher({ mode: 'on', ...common, run: failing }), { ok: false, lines: ['The watcher task "Worker board watcher" could not be registered: ERROR: Access is denied.'] })
})

test('one pass at a time: the lock is taken with wx, a fresh one is another pass\'s, a stale one (older than 4 minutes) is broken and taken', t => {
  const dir = mkdtempSync(join(tmpdir(), 'watcher-lock-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'watcher.lock')
  const first = takeWatcherLock(file, NOW)
  assert.equal(first.taken, true)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { pid: process.pid, at: NOW })
  const second = takeWatcherLock(file, NOW + MIN)
  assert.deepEqual([second.taken, second.why], [false, `another pass runs (process ${process.pid}, 60 s ago)`])
  assert.equal(LOCK_STALE_MS, 4 * MIN)
  const stale = takeWatcherLock(file, NOW + LOCK_STALE_MS + 1)
  assert.equal(stale.taken, true, 'a stale lock is broken')
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).at, NOW + LOCK_STALE_MS + 1)
  stale.release()
  assert.equal(takeWatcherLock(file, NOW).taken, true, 'released: free again')
  // An unreadable lock counts as stale.
  writeFileSync(file, 'garbage')
  assert.equal(takeWatcherLock(file, NOW).taken, true)
})

test('one pass of the watcher: an answering board costs one request; the others share one process listing; a killed board is started through the given route with one log line; a keeper that runs is left alone; the record is kept', async () => {
  const boards = [{ folder: 'D:\\Proj\\a\\worker-board', port: 4310 }, { folder: 'D:\\Proj\\b\\worker-board', port: 4314 }, { folder: 'D:\\Proj\\c\\worker-board', port: 4320 }]
  const asked = []
  let listed = 0
  const started = []
  const logged = []
  let kept = null
  const answers = async port => { asked.push(port); return port === 4310 }
  // Board c has its keeper; board b has only a DEMO keeper on another port, which is not its board: b is started.
  const listProcesses = async () => { listed += 1; return { bootAt: NOW - 24 * 60 * MIN, processes: [{ pid: 900, parent: 1, commandLine: '"C:\\node.exe" "D:\\Proj\\c\\worker-board\\server.mjs" --log' }, { pid: 950, parent: 1, commandLine: '"C:\\node.exe" "D:\\Proj\\b\\worker-board\\server.mjs" --log --demo --port 4399' }] } }
  const readStarted = async () => ({ at: NOW - 60 * MIN })
  const keptOrder = []
  const start = async ({ dir }) => { started.push(dir); keptOrder.push('start'); return { pid: 5100, how: 'wmi', why: null } }
  assert.deepEqual(START_ARGS, ['--started-by', 'watcher'], 'the start says who started the board (the page: "started by the watcher")')
  const outcomes = await watchOnce({ boards, answers, listProcesses, start, readStarted, now: NOW, record: { boards: {} }, keepRecord: async record => { kept = record; keptOrder.push('record') }, log: (dir, text) => logged.push([dir, text]), wait: async () => true })
  assert.deepEqual(outcomes.map(one => [one.port, one.do]), [[4310, 'nothing'], [4314, 'start'], [4320, 'nothing']])
  assert.deepEqual(asked, [4310, 4314, 4320], 'the HTTP answer first, once per board')
  assert.equal(listed, 1, 'one listing for the boards that did not answer')
  assert.deepEqual(started, ['D:\\Proj\\b\\worker-board'])
  assert.deepEqual(logged.map(([dir, text]) => [dir, text.replace(/\(.*\)/, '(...)')]), [['D:\\Proj\\b\\worker-board', 'watcher: started the board (...): keeper process 5100 by WMI']])
  assert.deepEqual(kept.boards['D:\\Proj\\b\\worker-board'], { starts: [NOW], silentLooks: 0 })
  // The record is kept BEFORE the start as well (a pass the task's time limit cuts off mid-start still counts toward the cap).
  assert.ok(keptOrder.indexOf('record') < keptOrder.indexOf('start'), `record before start: ${keptOrder.join(' → ')}`)
  assert.deepEqual(kept.boards['D:\\Proj\\c\\worker-board'], { starts: [], silentLooks: 1 })
  // Nothing to do: no listing, no log line, the record untouched but for the answering board's count.
  asked.length = 0
  logged.length = 0
  listed = 0
  const quiet = await watchOnce({ boards: [boards[0]], answers, listProcesses, start, now: NOW, record: { boards: {} }, keepRecord: async () => {}, log: (dir, text) => logged.push([dir, text]) })
  assert.deepEqual([quiet.map(one => one.do), listed, logged], [['nothing'], 0, []])
  // A listing that fails or cannot be read: nothing is started on a guess (a keeper may run); one line per silent board (chat 1's review, item 2).
  for (const broken of [async () => { throw new Error('PowerShell took longer than 30 s') }, async () => null]) {
    started.length = 0
    logged.length = 0
    const unsure = await watchOnce({ boards, answers, listProcesses: broken, start, readStarted, now: NOW, record: { boards: {} }, keepRecord: async () => {}, log: (dir, text) => logged.push([dir, text]), wait: async () => true })
    assert.deepEqual(unsure.map(one => one.do), ['nothing', 'nothing', 'nothing'])
    assert.match(unsure[1].why, /^the PC's processes could not be listed \((PowerShell took longer than 30 s|the listing could not be read)\) while the board does not answer: nothing started$/)
    assert.deepEqual(started, [])
    assert.deepEqual(logged.map(([dir]) => dir), ['D:\\Proj\\b\\worker-board', 'D:\\Proj\\c\\worker-board'], 'one line per silent board')
  }
  // --dry: the decision said, nothing started or logged.
  started.length = 0
  const dry = await watchOnce({ boards: [boards[1]], answers, listProcesses, start, readStarted, now: NOW, record: { boards: {} }, keepRecord: async () => { throw new Error('a dry pass keeps nothing') }, log: () => { throw new Error('no line') }, isDry: true })
  assert.deepEqual([dry[0].do, started], ['start', []])
})
