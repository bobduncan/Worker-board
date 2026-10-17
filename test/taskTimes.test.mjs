// B185: how long tasks really take. The board reads each worker's transcript (the past once, then what it gained),
// measures a task from the worker's `work take` to its `work report` (B301: the work tool's calls, never the words of a
// message) counting only the time its turns run, keeps a list per area, and shows "estimate 1 h, took 6 min" and how far
// estimates were off lately. Made-up samples only.

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

/** The answer that ends a turn, and a tool call in the middle of one. */
const ends = (time, text = 'Done.') => line({ type: 'assistant', timestamp: iso(time), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] } })
const working = time => line({ type: 'assistant', timestamp: iso(time), message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'npm test' } }] } })
const sends = (time, message, to = 'Studio · Lead') => line({ type: 'assistant', timestamp: iso(time), message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 's', name: 'SendMessage', input: { to, message } }] } })
const handOver = (time, words) => fromChat(time, 'Studio · Lead', words)
/** B301: the worker's own calls of the work tool, as the Workers mod registers it. */
const works = (time, input) => line({ type: 'assistant', timestamp: iso(time), message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'w', name: 'mcp__a-mod__work', input }] } })
const takes = (time, id) => works(time, { action: 'take', id, branch: 'b' })
const reports = (time, id) => works(time, { action: 'report', id, result: 'done' })
/** The board's line that a step is the worker's: it opens the turn the take is made in. */
const yours = (time, id) => typed(time, `work: ${id} is yours; run work next`)
/** The store's steps: area and estimate. */
const STEPS = { B201: { area: 'board', estimateMin: 60 }, B202: { area: 'art', estimateMin: 20 }, B203: { area: 'game', estimateMin: 20 }, B204: { area: 'game', estimateMin: 20 }, B205: { area: 'board', estimateMin: 60 } }
const stepOf = id => STEPS[id] ?? null

const measure = lines => walk(parseTail(lines.join('\n'), false), freshScan('Worker 2'), stepOf)

test('a task counts the time its turns run, from the take to the report, and not the waiting for the person', () => {
  const [task] = measure([
    yours(at(0), 'B201'),
    takes(at(0), 'B201'),
    working(at(4)),
    // It shows a mock-up and asks: its turn ends, and the 30 minutes until the person answers are waiting.
    works(at(5), { action: 'ask', of: 'B201', kind: 'look', blocking: true, text: 'Is the mock-up right?' }),
    ends(at(6)),
    typed(at(36), 'yes'),
    working(at(40)),
    reports(at(44), 'B201'),
    ends(at(45)),
  ])
  assert.deepEqual([task.step, task.worker, task.area, task.estimateMin, task.startedAt, task.reportedAt], ['B201', 'Worker 2', 'board', 60, at(0), at(44)])
  assert.equal(task.workMs, (6 + 8) * MIN)
})

test('B301: a hand-over and a report written as messages measure nothing', () => {
  assert.deepEqual(measure([
    handOver(at(0), 'Task from Studio · Lead: B201, the zebracorn sings. About 1 hour.'),
    working(at(4)),
    sends(at(44), 'Report from Worker 2: B201 is merged.'),
    ends(at(45)),
  ]), [])
})

test('a second take of the same step goes on with its task; a task paused for the limit, or never reported, is left out', () => {
  const same = measure([
    yours(at(0), 'B201'),
    takes(at(0), 'B201'),
    ends(at(5)),
    typed(at(20), 'the mock-up is right, go on'),
    takes(at(20), 'B201'),
    reports(at(30), 'B201'),
  ])
  assert.deepEqual(same.map(task => [task.step, task.estimateMin, task.workMs / MIN]), [['B201', 60, 15]])
  const paused = measure([
    yours(at(0), 'B202'),
    takes(at(0), 'B202'),
    sends(at(5), 'Note from Worker 2: paused for the limit until 14:00'),
    ends(at(6)),
    typed(at(100), 'go on'),
    reports(at(110), 'B202'),
  ])
  assert.deepEqual(paused, [])
  const never = measure([
    yours(at(0), 'B203'),
    takes(at(0), 'B203'),
    ends(at(10)),
    yours(at(20), 'B204'),
    takes(at(20), 'B204'),
    reports(at(25), 'B204'),
  ])
  assert.deepEqual(never.map(task => task.step), ['B204'])
  // A report of another step than the one it took ends nothing.
  assert.deepEqual(measure([yours(at(0), 'B201'), takes(at(0), 'B201'), reports(at(5), 'B202')]), [])
})

test('work a helper did in the background counts; half an hour without a line in the middle of a turn does not', () => {
  const notified = time => line({ type: 'user', timestamp: iso(time), message: { role: 'user', content: '<task-notification>done</task-notification>' }, origin: { kind: 'task-notification', producer: 'session-task' } })
  const [task] = measure([
    yours(at(0), 'B205'),
    takes(at(0), 'B205'),
    // It sends a helper off and ends its turn; the app starts it again 20 minutes later, when the helper is done.
    ends(at(2)),
    notified(at(22)),
    working(at(25)),
    // The PC slept for two hours in the middle of the turn.
    working(at(145)),
    reports(at(148), 'B205'),
  ])
  assert.equal(task.workMs, (2 + 20 + 3 + 3) * MIN)
})

test('the area comes from what the step touches, else from its words', () => {
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
    await writeFile(file, `${yours(at(0), 'B201')}\n${takes(at(0), 'B201')}\n${working(at(3))}\n`)
    const scan = freshScan('Worker 2')
    assert.deepEqual(await readOn(file, scan, stepOf), [])
    const offset = scan.offset
    // Half a line: it is not read until it is whole.
    const report = reports(at(9), 'B201')
    await appendFile(file, report.slice(0, 20))
    assert.deepEqual(await readOn(file, scan, stepOf), [])
    assert.equal(scan.offset, offset)
    await appendFile(file, `${report.slice(20)}\n`)
    const [task] = await readOn(file, scan, stepOf)
    assert.deepEqual([task.step, task.workMs / MIN], ['B201', 9])
    assert.deepEqual(await readOn(join(folder, 'gone.jsonl'), freshScan('Worker 3'), stepOf), [])
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
