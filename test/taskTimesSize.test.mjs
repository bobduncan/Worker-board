// F42, the real case: the Overview read "Estimates lately: 5.9x too high" on 23 Nov from ten tasks of 24-25 October: the board still read
// a step's old `Estimate` head line, which no step has had since. A step's estimate is its refine Size now, also for tasks already kept.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { taskTimesOf, withStepSizes } from '../src/taskTimes.mjs'
import { parseItem } from '../src/work/item.mjs'

const MIN = 60_000
const NOV = new Date(2026, 10, 21, 12).getTime()
const task = (step, estimateMin, workMin, at) => ({ step, steps: step === null ? [] : [step], worker: 'Worker 1', area: 'game', estimateMin, startedAt: at - workMin * MIN, reportedAt: at, workMs: workMin * MIN, effort: null, ranOn: null, tokens: null })
const sized = (id, size) => parseItem(`Id: ${id}\nKind: step\nTitle: A step\nState: done\n\n## Refined\n  What: a thing\n  Size: ${size}\n`)
const row = ([step, estimateMin, startedAt, reportedAt, workMs]) => ({ step, steps: [step], worker: 'Worker 1', area: 'game', estimateMin, startedAt, reportedAt, workMs, effort: null, ranOn: null, tokens: null })
/** The live task-times of 2026-11-23: the ten of 24-25 October that still carry an old estimate: step, estimate, started, reported, worked. */
const OLD = [['B570', 180, 1792870320380, 1792874734616, 4278334], ['B576', 45, 1792874218282, 1792874694751, 476469], ['B571', 90, 1792874521814, 1792875399677, 877863], ['B580', 45, 1792875033793, 1792875825694, 791899], ['B584', 60, 1792875456574, 1792876148919, 692345], ['B579', 210, 1792875556750, 1792876766747, 1209997], ['B574', 45, 1792875598657, 1792875605816, 7159], ['B581', 45, 1792878168668, 1792878978712, 810044], ['B592', 45, 1792916667351, 1792916708994, 41643], ['B594', 90, 1792918018473, 1792918545046, 344754]].map(row)
/** The same file's newest ten steps (B1293 in two tasks), with no estimate on the task. */
const NEW = [['B1276', null, 1795127473904, 1795128634923, 1139002], ['B1269', null, 1795130709736, 1795130999529, 267077], ['B1282', null, 1795130831959, 1795253593149, 6825672], ['B1159', null, 1795209354875, 1795209774230, 419355], ['B1289', null, 1795211109458, 1795212764864, 1655406], ['B1290', null, 1795211140605, 1795214591903, 3304807], ['B1293', null, 1795214704107, 1795250906279, 2224251], ['B1293', null, 1795250735499, 1795251053894, 312044], ['B1288', null, 1795251678227, 1795261151462, 9462928], ['B1286', null, 1795251860093, 1795251897329, 37236], ['B1300', null, 1795253650483, 1795265993401, 4251550]].map(row)
/** Those steps' refine sizes in the store, in minutes. */
const SIZES = [['B1300', 90], ['B1288', 45], ['B1282', 90], ['B1286', 30], ['B1293', 120], ['B1290', 60], ['B1289', 45], ['B1159', 90], ['B1269', 60], ['B1276', 30]]
const KEPT = [...OLD, ...NEW]
const ITEMS = new Map(SIZES.map(([id, size]) => [id, sized(id, `about ${size} min`)]))

test('the real case: the line reads the newest ten tasks by their size, no longer those of October', () => {
  assert.equal(taskTimesOf(KEPT).lately.off, '5.9x too high', 'as the board read it before')
  const times = taskTimesOf(withStepSizes(KEPT, ITEMS))
  assert.equal(times.lately.count, 10)
  assert.equal(times.lately.off, '1.6x too high', 'the newest ten only: over all tasks the typical figure was about 6x')
  assert.equal(times.byStep.B1300.estimateMin, 90)
})

test('an estimate a task has stays; a task with no step, no item or no size has none; the kept list is not changed', () => {
  const own = task('B1', 30, 10, NOV)
  const noStep = task(null, null, 10, NOV)
  const noItem = task('B2', null, 10, NOV)
  const noSize = task('B3', null, 10, NOV)
  const gets = task('B5', null, 10, NOV)
  const items = new Map([['B1', sized('B1', 'about 2 h')], ['B3', parseItem('Id: B3\nKind: step\nTitle: A step\nState: done\n')], ['B5', sized('B5', 'about 1 h')]])
  const list = [own, noStep, noItem, noSize, gets]
  const before = JSON.stringify(list)
  const out = withStepSizes(list, items)
  assert.deepEqual(out.map(one => one.estimateMin), [30, null, null, null, 60])
  assert.equal(out[0], own)
  assert.equal(gets.estimateMin, null, 'the kept task itself keeps no size')
  assert.equal(JSON.stringify(list), before)
  assert.deepEqual(withStepSizes([noItem], undefined).map(one => one.estimateMin), [null])
})

test('a step without a refine size counts the minutes of its take', () => {
  const item = parseItem('Id: B4\nKind: step\nTitle: A step\nState: done\nTaken for: 90 min\n')
  assert.equal(withStepSizes([task('B4', null, 10, NOV)], new Map([['B4', item]]))[0].estimateMin, 90)
})

test('the board counts the size on the page, in its list and on a new task', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.match(server, /taskTimes: withStepSizes\(taskTimes\.tasks, raw\.work\?\.items\)/)
  assert.match(server, /listText\(withStepSizes\(taskTimes\.tasks, items\), clock\(\)\)/)
  assert.match(server, /estimateMin: minutesOf\(`about \$\{item\.head\.get\('Estimate'\) \?\? ''\}`\) \?\? sizeOf\(item\)/)
})
