// B185: how long tasks really take. The board reads each worker's transcript (the past once, then what it gained),
// measures a task from the main chat's hand-over to the worker's report counting only the time its turns run, keeps
// a list per area, and shows "estimate 1 h, took 6 min" and how far estimates were off lately. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { fromChat, line, typed } from '../fixtures/lines.mjs'
import { parseTail } from '../src/transcript.mjs'
import { areaOf, freshScan, keptTasks, listText, offWords, readOn, taskTimesOf, walk } from '../src/taskTimes.mjs'

const MIN = 60_000
const T0 = Date.UTC(2026, 9, 14, 9, 0)
const at = minutes => T0 + minutes * MIN
const iso = time => new Date(time).toISOString()
const MAIN = { mainTitle: 'Studio · Lead', mainSession: 'local_lead' }

/** The answer that ends a turn, and a tool call in the middle of one. */
const ends = (time, text = 'Done.') => line({ type: 'assistant', timestamp: iso(time), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] } })
const working = time => line({ type: 'assistant', timestamp: iso(time), message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'npm test' } }] } })
const sends = (time, message, to = 'Studio · Lead') => line({ type: 'assistant', timestamp: iso(time), message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 's', name: 'SendMessage', input: { to, message } }] } })
const handOver = (time, words) => fromChat(time, 'Studio · Lead', words)

const measure = lines => walk(parseTail(lines.join('\n'), false), freshScan('Worker 2'), MAIN)

test('a task counts the time its turns run, from the hand-over to the report, and not the waiting for the person', () => {
  const [task] = measure([
    handOver(at(0), 'Task from Studio · Lead: B201, the zebracorn sings. About 1 hour.\nTouches: src/state.mjs, public/board.js'),
    working(at(4)),
    // It shows a mock-up and asks: its turn ends, and the 30 minutes until the person answers are waiting.
    sends(at(5), 'Question from Worker 2: is the mock-up right?'),
    ends(at(6)),
    typed(at(36), 'yes'),
    working(at(40)),
    sends(at(44), 'Report from Worker 2: B201 is merged.'),
    ends(at(45)),
  ])
  assert.deepEqual([task.step, task.worker, task.area, task.estimateMin, task.startedAt, task.reportedAt], ['B201', 'Worker 2', 'board', 60, at(0), at(44)])
  assert.equal(task.workMs, (6 + 8) * MIN)
})

test('a further message about the same step goes on with its task; a task paused for the limit, or never reported, is left out', () => {
  const same = measure([
    handOver(at(0), 'Task from Studio · Lead: B201, the zebracorn sings. About 30 min.'),
    ends(at(5)),
    handOver(at(20), 'Task from Studio · Lead: B201 again, the person said yes to the mock-up.'),
    sends(at(30), 'Report from Worker 2: B201 done.'),
  ])
  assert.deepEqual(same.map(task => [task.step, task.estimateMin, task.workMs / MIN]), [['B201', 30, 15]])
  const paused = measure([
    handOver(at(0), 'Task from Studio · Lead: B202, a sprite for the quokkaberry. About 20 min.'),
    sends(at(5), 'Note from Worker 2: paused for the limit until 14:00'),
    ends(at(6)),
    typed(at(100), 'go on'),
    sends(at(110), 'Report from Worker 2: B202 done.'),
  ])
  assert.deepEqual(paused, [])
  const never = measure([
    handOver(at(0), 'Task from Studio · Lead: B203, the first one. About 20 min.'),
    ends(at(10)),
    handOver(at(20), 'Task from Studio · Lead: B204, the second one. About 20 min.'),
    sends(at(25), 'Report from Worker 2: B204 done.'),
  ])
  assert.deepEqual(never.map(task => task.step), ['B204'])
})

test('work a helper did in the background counts; half an hour without a line in the middle of a turn does not', () => {
  const notified = time => line({ type: 'user', timestamp: iso(time), message: { role: 'user', content: '<task-notification>done</task-notification>' }, origin: { kind: 'task-notification', producer: 'session-task' } })
  const [task] = measure([
    handOver(at(0), 'Task from Studio · Lead: B205, a plan written by a helper. About 1 h.'),
    // It sends a helper off and ends its turn; the app starts it again 20 minutes later, when the helper is done.
    ends(at(2)),
    notified(at(22)),
    working(at(25)),
    // The PC slept for two hours in the middle of the turn.
    working(at(145)),
    sends(at(148), 'Report from Worker 2: B205 done.'),
  ])
  assert.equal(task.workMs, (2 + 20 + 3 + 3) * MIN)
})

test('the area comes from what the hand-over touches, else from its words', () => {
  assert.equal(areaOf('Task: B1, a fix.\nTouches: src/state.mjs, public/board.js'), 'board')
  assert.equal(areaOf('Task: B2, the walk cycle of the zebracorn, in four directions.'), 'art')
  assert.equal(areaOf('Task: B3, a new arena.\nTouches: src/arena/crossing.ts, tests'), 'game')
  assert.equal(areaOf('Task: B4, the board\'s window gets a header.'), 'board')
  assert.equal(areaOf('Task: B5, the shop sells boots.'), 'game')
})

test('a transcript is read once from its start, then only what it gained; a line still being written waits', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'task-times-'))
  try {
    const file = join(folder, 'worker.jsonl')
    await writeFile(file, `${handOver(at(0), 'Task from Studio · Lead: B201, the zebracorn sings. About 1 h.')}\n${working(at(3))}\n`)
    const scan = freshScan('Worker 2')
    assert.deepEqual(await readOn(file, scan, MAIN), [])
    const offset = scan.offset
    // Half a line: it is not read until it is whole.
    const report = sends(at(9), 'Report from Worker 2: B201 merged.')
    await appendFile(file, report.slice(0, 20))
    assert.deepEqual(await readOn(file, scan, MAIN), [])
    assert.equal(scan.offset, offset)
    await appendFile(file, `${report.slice(20)}\n`)
    const [task] = await readOn(file, scan, MAIN)
    assert.deepEqual([task.step, task.workMs / MIN], ['B201', 9])
    assert.deepEqual(await readOn(join(folder, 'gone.jsonl'), freshScan('Worker 3'), MAIN), [])
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

const task = (step, area, estimateMin, workMin, startMin) => ({ step, steps: step === null ? [] : [step], worker: 'Worker 2', area, estimateMin, startedAt: at(startMin), reportedAt: at(startMin + workMin), workMs: workMin * MIN })

test('per area: how many, the typical working time and how far estimates were off; lately; per step, both tasks of a step as one', () => {
  const tasks = [
    task('B1', 'board', 60, 6, 0), task('B2', 'board', 45, 5, 10), task('B3', 'board', 30, 4, 20), task('B4', 'board', 60, 10, 30), task('B5', 'board', 20, 5, 40),
    task('B6', 'game', 90, 30, 50), task(null, 'game', null, 12, 90),
    // A later fix of B1 belongs to B1.
    task('B1', 'board', null, 3, 200),
  ]
  const times = taskTimesOf(tasks)
  assert.deepEqual(times.areas.map(area => [area.area, area.count, area.typicalMin, area.off, area.isEnough]), [['board', 5, 5, '6.7x too high', true], ['game', 2, 21, '3x too high', false]])
  assert.deepEqual(times.byStep.B1, { estimateMin: 60, workMin: 9, worker: 'Worker 2', at: at(203) })
  assert.deepEqual([times.lately.count, times.lately.off], [6, '6.3x too high'])
  assert.deepEqual([offWords(1.1), offWords(0.4), offWords(12.4), offWords(null)], ['about right', '2.5x too low', '12x too high', null])
})

test('the list the chats read: per area and the last tasks, written by the board; tasks kept once per worker and start', () => {
  const tasks = [task('B1', 'board', 60, 6, 0), task('B6', 'game', 90, 75, 50)]
  const text = listText(tasks, at(300))
  assert.match(text, /^# How long tasks really take\n/)
  assert.match(text, /\| board \| 1 \| 6 min \(too few tasks to go by\) \| 10x too high \|/)
  assert.match(text, /\| B6 \| Worker 2 \| game \| 1 h 30 min \| 1 h 15 min \|/)
  assert.match(text, /it updates itself, do not edit it/)
  assert.equal(keptTasks(tasks, [task('B1', 'board', 60, 7, 0), task('B7', 'art', null, 3, 400)]).length, 3)
})

// The page

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`${cut('tasktimes')}\nObject.assign(this, { tookWords, estimatesLine })`, page)

test('a finished step says "estimate 1 h, took 6 min"; the Overview says how far estimates were off lately', () => {
  assert.equal(page.tookWords({ estimateMin: 60, workMin: 6 }), 'estimate 1 h, took 6 min')
  assert.equal(page.tookWords({ estimateMin: null, workMin: 75 }), 'took 1 h 15 min')
  assert.equal(page.tookWords(undefined), '')
  const line = page.estimatesLine(taskTimesOf([task('B1', 'board', 60, 6, 0), task('B2', 'board', 45, 5, 10)]))
  assert.equal(line.text, 'Estimates lately: 9.5x too high')
  assert.match(line.title, /board: 2 tasks, typically 6 min, estimates 9\.5x too high \(too few to go by\)/)
  assert.equal(page.estimatesLine(taskTimesOf([])), null)
  assert.match(script, /\}\)\.concat\(estimatesPill\(state\.taskTimes \?\? null\)\)\)/)
  assert.match(script, /el\('span', 'finished-took', row\.took\)/)
})
