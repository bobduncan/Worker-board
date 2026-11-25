// B1302 (the fix of X211: B1297, a Quality Assurance task of Worker 5, sat in progress 2 h 15 min with its checkpoint of 10:18
// "wait related run; then mutants" and stale-checkpoint named it, while its mutant run waited in the PC's one-at-a-time test
// queue (tools/one-at-a-time.mjs): a ticket of the folder check-b1279 since 10:58, first in line behind another step's gate). The
// rule reads the queue: no case while a run of the holder's folder (its own step's or the checked step's) waits or runs there, and
// its quiet time counts from the last pass that saw it. Made-up folders and labels beyond the live shape; nobody's words.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { healthSummary } from '../../src/supervisor/health.mjs'
import { memoryOf, queueSeenAfter } from '../../src/supervisor/loop.mjs'
import { WATCH_RULES, checkpointLate, testQueueOf, testQueueWords } from '../../src/supervisor/rules/watch.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { asLandingRun, folderKey, isFolderOf, readTestQueue } from '../../src/testQueue.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import * as tool from '../../tools/one-at-a-time.mjs'

const MIN = 60_000
const at = (hours, minutes) => new Date(2026, 10, 21, hours, minutes).getTime()
const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, state: 'working', isRunning: true, queue: [], compaction: null, task: null, ...more })

// X211's live shape: B1297 (checks B1279) in progress since 10:04, checkpoint 10:18, its worker working
const qa = () => item({
  Id: 'B1297', Kind: 'step', Title: 'Quality Assurance: B1279 a start word', State: 'in progress', Since: stamp(at(10, 4)), Owner: 'Picker', Checks: 'B1279',
  Checkpoint: `none · wait related run, then mutants · ${stamp(at(10, 18))}:00`,
})
const FOLDER = 'C:\\Work\\project\\check-b1279'
const ticket = (cwd, since, more = {}) => ({ cwd, label: 'test', state: 'waiting', since, ahead: 1, ...more })
const view = (now, { queue = [], seen = new Map(), store = items(qa()) } = {}) => buildView({
  state: { chats: [lane('Lead', { isMain: true }), lane('Picker')], chatPrefix: '', pause: null, today: [], gaps: [], limits: {} },
  items: store, testQueue: { runs: queue, seen }, settings: {}, now,
})
const check = board => WATCH_RULES.find(one => one.id === 'stale-checkpoint').check(board, { seen: new Map(), observed: [] })

test('X211 as it was: no queue read, the quiet checkpoint is a case at 12:25', () => {
  const found = check(view(at(12, 25)))
  assert.deepEqual(found.map(one => one.subject), ['B1297'])
})

test('X211: a ticket of the checked step\'s folder since 10:58 (a run waits its turn) is no case at 12:25, and the health line says so', () => {
  const board = view(at(12, 25), { queue: [ticket(FOLDER, at(10, 58), { ahead: 1 })] })
  assert.deepEqual(check(board), [])
  assert.equal(checkpointLate(qa(), board), null)
  const line = healthSummary(board, at(12, 25)).split('\n').find(one => /B1297 in progress/.test(one)) ?? ''
  assert.match(line, /waits in the test queue since 10:58, 1 ahead/)
  assert.doesNotMatch(line, /^- ! /, 'not marked odd')
})

test('S3: a run of the step that waits for an idle PC is no case either, and the health line says since when it waits', () => {
  const board = view(at(12, 25), { queue: [ticket(FOLDER, at(11, 2), { idle: true, ahead: 3 })] })
  assert.deepEqual(check(board), [])
  const line = healthSummary(board, at(12, 25)).split('\n').find(one => /B1297 in progress/.test(one)) ?? ''
  assert.match(line, /waits for an idle PC since 11:02/)
  // the step's own check that waits its turn is named before an older idle job of the same folder
  const both = view(at(12, 25), { queue: [ticket(FOLDER, at(11, 2), { idle: true, ahead: 3 }), ticket(FOLDER, at(12, 10), { ahead: 1 })] })
  assert.match(healthSummary(both, at(12, 25)), /waits in the test queue since 12:10, 1 ahead/)
})

test('a run of the step that goes now (it holds the slot) is no case either', () => {
  const board = view(at(12, 25), { queue: [{ cwd: FOLDER, label: 'test', state: 'running', since: at(12, 20), ahead: 0 }] })
  assert.deepEqual(check(board), [])
  assert.match(healthSummary(board, at(12, 25)), /its test run goes since 12:20/)
})

test('the step\'s own folder counts too: -b<id> of the step itself', () => {
  assert.deepEqual(check(view(at(12, 25), { queue: [ticket('C:\\Work\\project-b1297', at(11, 0))] })), [])
})

test('the ticket is gone at 12:40 with no checkpoint: no case until 120 min after the last pass that saw it', () => {
  const seen = new Map([[folderKey(FOLDER), at(12, 40)]])
  assert.deepEqual(check(view(at(12, 41), { seen })), [])
  assert.deepEqual(check(view(at(14, 39), { seen })), [], '119 min after')
  const later = check(view(at(14, 41), { seen }))
  assert.deepEqual(later.map(one => one.subject), ['B1297'], '121 min after: a case again')
  assert.match(later[0].evidence, /its test run left the test queue at 12:40/)
  // the quiet time counts from 12:40, not from the old checkpoint of 10:18
  assert.match(later[0].text, /no checkpoint for 2 h 1 min/)
})

test('another folder\'s ticket is no help: a case as now (b12 is not b1297, b1279\'s neighbour b12790 is not b1279)', () => {
  for (const cwd of ['C:\\Work\\project\\check-b1300', 'C:\\Work\\project\\check-b129', 'C:\\Work\\project\\check-b12790', 'C:\\Work\\b1279\\other']) {
    const found = check(view(at(12, 25), { queue: [ticket(cwd, at(10, 58))], seen: new Map([[folderKey(cwd), at(12, 24)]]) }))
    assert.deepEqual(found.map(one => one.subject), ['B1297'], cwd)
  }
})

test('the folder names: -b<id> by whole number, either case, a "-before" tail too', () => {
  const ids = ['B1297', 'B1279']
  assert.equal(isFolderOf('C:\\Work\\project\\check-b1279', ids), true)
  assert.equal(isFolderOf('C:/Work/project/Check-B1279-before/', ids), true)
  assert.equal(isFolderOf('C:\\Work\\lava-tactics-b1297', ids), true)
  assert.equal(isFolderOf('C:\\Work\\wt-b917b', ['B917']), true, 'the board rule (namesStep): a name a step really used')
  assert.equal(isFolderOf('C:\\Work\\project\\check-b12', ids), false)
  assert.equal(isFolderOf('C:\\Work\\project\\check-b12799', ids), false)
  assert.equal(isFolderOf('C:\\Work\\project\\check-b1279', [null, undefined, 'nope']), false)
})

test('a step in another state, or whose worker does not work, still gets no case from the queue read (the rule\'s other gates stand)', () => {
  const store = items(item({ Id: 'B7', Kind: 'step', State: 'review', Since: stamp(at(10, 4)), Owner: 'Picker' }))
  assert.deepEqual(check(view(at(12, 25), { store })), [])
  assert.deepEqual(testQueueOf(qa(), view(at(12, 25))), { run: null, seenAt: null })
})

test('the cap (the review of c055ddd2): a chat that runs tests again and again with no checkpoint is reported once 3 x 120 min passed since its last checkpoint', () => {
  // B1297's shape: in progress since 10:04, checkpoint 10:18; a test run waits or runs at every pass, the last one seen a few minutes ago
  const run = since => ticket(FOLDER, since)
  const board = (now, queue = []) => view(now, { queue, seen: new Map([[folderKey(FOLDER), now - 5 * MIN]]) })
  const after = minutes => at(10, 18) + minutes * MIN
  // 358 min after the checkpoint: a run goes now: still excused (the longest honest wait, 105 min in line + 120 min of run, stays silent)
  assert.deepEqual(check(board(after(358), [run(at(15, 0))])), [])
  // 361 min after: the queue no longer excuses it, with a run still going, with the last pass 5 min ago, and with no run now
  const looping = check(board(after(361), [run(at(15, 0))]))
  assert.deepEqual(looping.map(one => one.subject), ['B1297'])
  assert.doesNotMatch(looping[0].evidence, /test queue/, 'queueSeen is not shown once capped')
  assert.match(looping[0].text, /no checkpoint for 6 h 1 min/, 'the quiet time counts from the checkpoint: the runs seen reset nothing')
  assert.equal(check(board(after(361)))[0]?.subject, 'B1297')
  // the health line says nothing of the queue then, and marks the step
  const line = healthSummary(board(after(361), [run(at(15, 0))]), after(361)).split('\n').find(one => /B1297 in progress/.test(one)) ?? ''
  assert.doesNotMatch(line, /test queue/)
  assert.match(line, /^- ! B1297/)
  // a checkpoint written later restarts the count
  const fresh = items(item({ ...Object.fromEntries(qa().head), Checkpoint: `none · next · ${stamp(at(15, 0))}:00` }))
  assert.deepEqual(check(view(at(15, 0) + 358 * MIN, { queue: [run(at(16, 0))], store: fresh })), [])
})

test('readTestQueue: the lock, its slot files and the tickets, live pids only, in the order they go', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'testq-'))
  try {
    const lock = path.join(dir, 'one-heavy-run.lock')
    const queue = `${lock}.queue`
    mkdirSync(queue)
    const now = at(12, 30)
    const iso = ms => new Date(ms).toISOString()
    writeFileSync(lock, JSON.stringify({ pid: 11, label: 'test', cwd: 'C:\\Work\\worker-board-b1300', startedAt: iso(at(12, 25)) }))
    const put = (name, body) => writeFileSync(path.join(queue, name), typeof body === 'string' ? body : JSON.stringify(body))
    put('000000000000002-00000044.json', { pid: 44, label: 'test', cwd: FOLDER, startedAt: iso(at(10, 58)) })
    put('000000000000003-00000055.json', { pid: 55, label: 'test', cwd: 'C:\\Work\\other-b9', startedAt: iso(at(11, 5)) })
    put('000000000000001-00000066.json', { pid: 66, label: 'test', cwd: 'C:\\Work\\dead-b8', startedAt: iso(at(10, 0)) })
    put('000000000000004-00000077.json', 'not json')
    // F56: a landing gate's ticket, read as the landing lock's branch when one is given
    put('000000000000005-00000088.json', { pid: 88, label: 'test', cwd: 'C:\\Users\\x\\AppData\\Local\\Temp\\land-gate-697acf36', startedAt: iso(at(11, 10)) })
    const alive = pid => pid !== 66
    const found = readTestQueue({ tool, env: { HEAVY_RUN_LOCK: lock }, now, runs: alive })
    assert.deepEqual(found.map(one => [one.cwd, one.state, one.ahead]), [
      ['C:\\Work\\worker-board-b1300', 'running', 0],
      [FOLDER, 'waiting', 1],
      ['C:\\Work\\other-b9', 'waiting', 2],
      ['C:\\Users\\x\\AppData\\Local\\Temp\\land-gate-697acf36', 'waiting', 3],
    ], 'the dead pid\'s ticket and the unreadable one are none; each waiting run counts the one that runs and the tickets before it')
    const landed = readTestQueue({ tool, env: { HEAVY_RUN_LOCK: lock }, now, runs: alive, landing: { by: 'chat 3', branch: 'b1442-sandbox', phase: 'gate' } })
    assert.deepEqual(landed.map(one => [one.cwd, one.gate ?? null]).at(-1), ['b1442-sandbox', 'C:\\Users\\x\\AppData\\Local\\Temp\\land-gate-697acf36'], 'F56: the gate\'s ticket reads as the lock\'s branch')
    assert.deepEqual(landed.slice(0, 3).map(one => one.cwd), found.slice(0, 3).map(one => one.cwd), 'the other runs are as they were')
    assert.equal(found[1].since, at(10, 58))
    // a lock whose process is gone, or older than 75 minutes without a beat (F39), is stale: not running
    assert.deepEqual(readTestQueue({ tool, env: { HEAVY_RUN_LOCK: lock }, now: at(13, 45), runs: alive }).filter(one => one.state === 'running'), [])
    assert.equal(readTestQueue({ tool, env: { HEAVY_RUN_LOCK: lock }, now, runs: pid => pid !== 11 && alive(pid) }).filter(one => one.state === 'running').length, 0)
    // nothing was written or removed (read only): the dead ticket still stands
    assert.equal(readTestQueue({ tool, env: { HEAVY_RUN_LOCK: path.join(dir, 'none.lock') }, now }).length, 0)
    assert.deepEqual(readTestQueue({ tool, env: { HEAVY_RUN_LOCK: lock }, now, runs: alive }).length, 4)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S3: readTestQueue lists the idle room\'s runs after every ticket, oldest first, marked idle with since when they came; a dead or quiet one is left out, one in the queue or a slot is not counted twice', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'testq-'))
  try {
    const lock = path.join(dir, 'one-heavy-run.lock')
    const queue = `${lock}.queue`
    const room = tool.idleRoomOf(lock)
    mkdirSync(queue)
    mkdirSync(room)
    const now = at(14, 10)
    const iso = ms => new Date(ms).toISOString()
    writeFileSync(lock, JSON.stringify({ pid: 11, label: 'test', cwd: 'C:\\Work\\land-b1', startedAt: iso(at(14, 9)), since: iso(at(14, 0)), beat: iso(at(14, 9)), order: 2 }))
    const put = (folder, name, body) => writeFileSync(path.join(folder, name), JSON.stringify(body))
    put(queue, '000000000000005-00000022.json', { pid: 22, label: 'check', cwd: 'C:\\Work\\lava-tactics-b5', startedAt: iso(at(14, 5)), order: 2, beat: iso(at(14, 9)) })
    put(room, '000000000000002-00000033.json', { pid: 33, label: 'slow-tier', cwd: 'C:\\Work\\lava-tactics', startedAt: iso(at(14, 2)), idle: true, order: 2, beat: iso(at(14, 9)) })
    put(room, '000000000000001-00000044.json', { pid: 44, label: 'b1517-measure2', cwd: 'C:\\Work\\lava-tactics-b1517', startedAt: iso(at(13, 40)), idle: true, order: 2, beat: iso(at(14, 9)) })
    put(room, '000000000000003-00000055.json', { pid: 55, label: 'idle:dead', cwd: 'C:\\Work\\gone', startedAt: iso(at(13, 0)), idle: true, order: 2, beat: iso(at(14, 9)) })
    put(room, '000000000000004-00000066.json', { pid: 66, label: 'idle:quiet', cwd: 'C:\\Work\\slept', startedAt: iso(at(13, 0)), idle: true, order: 2, beat: iso(at(13, 50)) })
    // pid 22's run also stands in the room (it looks once in the queue): counted in the queue only
    put(room, '000000000000000-00000022.json', { pid: 22, label: 'check', cwd: 'C:\\Work\\lava-tactics-b5', startedAt: iso(at(14, 5)), idle: true, order: 2, beat: iso(at(14, 9)) })
    const found = readTestQueue({ tool, env: { HEAVY_RUN_LOCK: lock }, now, runs: pid => pid !== 55 })
    assert.deepEqual(found.map(one => [one.label, one.state, one.ahead, one.idle === true, one.since]), [
      ['test', 'running', 0, false, at(14, 0)],
      ['check', 'waiting', 1, false, at(14, 5)],
      ['b1517-measure2', 'waiting', 2, true, at(13, 40)],
      ['slow-tier', 'waiting', 3, true, at(14, 2)],
    ])
    assert.equal(testQueueWords(found[2]), 'waits for an idle PC since 13:40')
    // no queue folder at all: the room is still read (pid 22's room ticket now counts there, by its name)
    rmSync(queue, { recursive: true, force: true })
    assert.deepEqual(readTestQueue({ tool, env: { HEAVY_RUN_LOCK: lock }, now, runs: pid => pid !== 55 }).map(one => [one.label, one.idle === true]), [['test', false], ['check', true], ['b1517-measure2', true], ['slow-tier', true]])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readTestQueue with F39 tickets: a beat keeps a holder at work, a stale beat drops a ticket, a first-class ticket goes 30 min earlier, the holder keeps its since', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'testq-'))
  try {
    const lock = path.join(dir, 'one-heavy-run.lock')
    const queue = `${lock}.queue`
    mkdirSync(queue)
    const now = at(14, 0)
    const iso = ms => new Date(ms).toISOString()
    // a holder that took its slot at 12:30 and beat a minute ago: at work (past the 75 min a lock without a beat gets) (startedAt moves with its beats)
    writeFileSync(lock, JSON.stringify({ pid: 11, label: 'test', cwd: 'C:\\Work\\worker-board-b1300', since: iso(at(12, 30)), startedAt: iso(now - MIN), beat: iso(now - MIN), order: tool.ORDER_MARK }))
    const put = (name, body) => writeFileSync(path.join(queue, name), JSON.stringify({ order: tool.ORDER_MARK, ...body }))
    const ms = at => String(at).padStart(15, '0')
    put(`${ms(at(12, 0))}-00000044.json`, { pid: 44, label: 'test', cwd: FOLDER, startedAt: iso(at(12, 0)), beat: iso(now - MIN) })
    put(`${ms(at(12, 10))}-00000055.json`, { pid: 55, label: 'test', cwd: 'C:\\Work\\gate-b9', startedAt: iso(at(12, 10)), beat: iso(now - MIN), first: true })
    put(`${ms(at(12, 20))}-00000066.json`, { pid: 66, label: 'test', cwd: 'C:\\Work\\old-beat-b8', startedAt: iso(at(12, 20)), beat: iso(now - 6 * MIN) })
    const found = readTestQueue({ tool, env: { HEAVY_RUN_LOCK: lock }, now, runs: () => true })
    assert.deepEqual(found.map(one => [one.cwd, one.state, one.ahead]), [
      ['C:\\Work\\worker-board-b1300', 'running', 0],
      ['C:\\Work\\gate-b9', 'waiting', 1],
      [FOLDER, 'waiting', 2],
    ], 'the first-class ticket of 12:10 goes before the ordinary one of 12:00; the ticket with a 6 min old beat is left out')
    assert.equal(found[0].since, at(12, 30), 'the holder since, not its moving startedAt')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the memory of the last pass per folder: set by a pass that saw a run, pruned after 3 days, kept over a restart', () => {
  const before = new Map([['c:/old', at(12, 0) - 4 * 24 * 60 * MIN], ['c:/work/check-b1279', at(12, 0)]])
  const after = queueSeenAfter(before, [{ cwd: 'C:\\Work\\New-b5' }], at(12, 30))
  assert.deepEqual([...after.keys()].sort(), ['c:/work/check-b1279', 'c:/work/new-b5'])
  assert.equal(after.get('c:/work/new-b5'), at(12, 30))
  assert.equal(after.get('c:/work/check-b1279'), at(12, 0), 'a folder not seen this pass keeps its last time')
  assert.deepEqual([...memoryOf({ queueSeen: { 'c:/x': 5, 'c:/y': 'no' } }).queueSeen], [['c:/x', 5]])
  assert.equal(memoryOf(null).queueSeen.size, 0)
})

// F56: a worker that waits for its OWN landing gate: the gate's queue ticket runs in <temp>/land-gate-xxxxxxxx, which no step's folder
// names; read as the landing lock's branch (b1442-sandbox), the ticket is B1442's and its quiet checkpoint is no case.
const GATE = 'C:\\Users\\x\\AppData\\Local\\Temp\\land-gate-697acf36'
const landingStep = () => item({
  Id: 'B1442', Kind: 'step', Title: 'Paint the Sandbox in Warm-up Isle\'s look', State: 'in progress', Since: stamp(at(10, 4)), Owner: 'Picker',
  Checkpoint: `a1b2c3d4 · landing runs (land.ps1) · ${stamp(at(10, 18))}:00`,
})

test('F56: asLandingRun reads a landing gate\'s run as the lock\'s branch, keeps the folder as `gate`, and leaves every other run and an unknown branch alone', () => {
  const run = { cwd: GATE, label: 'test', state: 'waiting', since: at(10, 58), ahead: 1 }
  assert.deepEqual(asLandingRun(run, { by: 'chat 3', branch: 'b1442-sandbox', phase: 'gate' }), { ...run, cwd: 'b1442-sandbox', gate: GATE })
  assert.deepEqual(asLandingRun(run, { by: 'chat 3', branch: ' qa/b866-x ' }), { ...run, cwd: 'qa/b866-x', gate: GATE })
  for (const landing of [null, undefined, {}, { branch: 'unknown' }, { branch: '' }, { branch: 7 }]) assert.equal(asLandingRun(run, landing), run, `no lock to read: ${JSON.stringify(landing)}`)
  for (const cwd of [FOLDER, 'C:\\Work\\land-gate-xyz', 'C:\\Work\\land-gate-697acf36-more']) assert.equal(asLandingRun({ ...run, cwd }, { branch: 'b1442-sandbox' }).cwd, cwd, `not a gate folder: ${cwd}`)
  assert.equal(asLandingRun(null, { branch: 'b1442-sandbox' }), null)
})

test('F56: a waiting land-gate ticket while the lock names b1442-sandbox: no case for B1442 at 130 minutes of quiet, and the health line says it waits; a branch without a step id, or no lock, keeps the case', () => {
  const landing = { by: 'chat 3', branch: 'b1442-sandbox', phase: 'gate' }
  const gateTicket = (lock = landing) => asLandingRun(ticket(GATE, at(10, 58), { ahead: 1 }), lock)
  const quiet = at(12, 28)
  const board = view(quiet, { queue: [gateTicket()], store: items(landingStep()) })
  assert.deepEqual(check(board), [], 'the gate\'s ticket is B1442\'s run: excused')
  assert.equal(checkpointLate(landingStep(), board), null)
  assert.match(healthSummary(board, quiet).split('\n').find(one => /B1442 in progress/.test(one)) ?? '', /waits in the test queue since 10:58, 1 ahead/)
  // the same ticket with no lock, a lock of a branch without a step id, or another step's branch: the case stands
  for (const lock of [null, { branch: 'unknown' }, { branch: 'f55-loop-claim' }, { branch: 'main' }, { branch: 'b1443-other' }]) {
    assert.deepEqual(check(view(quiet, { queue: [gateTicket(lock)], store: items(landingStep()) })).map(one => one.subject), ['B1442'], `lock ${JSON.stringify(lock)}`)
  }
  // the memory of the last pass keys the branch, as it keys a folder: the ticket gone at 12:40 is no case until 120 min after that pass
  const seen = queueSeenAfter(new Map(), [gateTicket()], at(12, 28))
  assert.deepEqual([...seen.keys()], ['b1442-sandbox'])
  assert.deepEqual(check(view(at(12, 40), { queue: [], seen, store: items(landingStep()) })), [])
})

test('F56: the server reads the queue with the landing lock beside it', async () => {
  const { readFile } = await import('node:fs/promises')
  const server = await readFile(new URL('../../server.mjs', import.meta.url), 'utf8')
  assert.match(server, /testQueue: async \(\) => readTestQueue\(\{ tool: await import\('\.\/tools\/one-at-a-time\.mjs'\), now: clock\(\), landing: lockHolder\(join\(HERE, 'data', 'landing\.lock'\), clock\(\)\) \}\)/)
})
