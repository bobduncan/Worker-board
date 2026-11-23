// F42, the real case: the Overview read "Estimates lately: 5.9x too high" on 23 Nov from ten tasks of 24-25 October: the board still read
// a step's old `Estimate` head line, which no step has had since. A step's estimate is its refine Size now, also for tasks already kept.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { taskTimesOf, withStepSizes } from '../src/taskTimes.mjs'
import { parseItem } from '../src/work/item.mjs'

const MIN = 60_000
const NOV = new Date(2026, 10, 21, 12).getTime()
const OCT = new Date(2026, 9, 24, 23).getTime()
const task = (step, estimateMin, workMin, at) => ({ step, steps: step === null ? [] : [step], worker: 'Worker 1', area: 'game', estimateMin, startedAt: at - workMin * MIN, reportedAt: at, workMs: workMin * MIN, effort: null, ranOn: null, tokens: null })
const sized = (id, size) => parseItem(`Id: ${id}\nKind: step\nTitle: A step\nState: done\n\n## Refined\n  What: a thing\n  Size: ${size}\n`)
/** The ten of 24-25 October, each with its old estimate. */
const OLD = [[45, 8], [180, 71], [90, 15], [45, 1], [45, 13], [60, 12], [210, 20], [45, 14], [45, 1], [90, 6]].map(([estimate, work], i) => task(`B${570 + i}`, estimate, work, OCT + i * MIN))
/** The newest ten, as the store has them: no estimate on the task, the Size on the step. */
const NEW = [['B1300', 90, 71], ['B1288', 45, 158], ['B1282', 90, 114], ['B1286', 30, 1], ['B1293', 120, 42], ['B1290', 60, 55], ['B1289', 45, 28], ['B1159', 90, 7], ['B1269', 60, 4], ['B1270', 45, 30]]
const KEPT = [...OLD, ...NEW.map(([id, , work], i) => task(id, null, work, NOV + i * MIN))]
const ITEMS = new Map(NEW.map(([id, size]) => [id, sized(id, `about ${size} min`)]))

test('the real case: the line reads the newest tasks by their size, no longer those of October', () => {
  assert.equal(taskTimesOf(KEPT).lately.off, '5.8x too high', 'as the board read it before')
  const times = taskTimesOf(withStepSizes(KEPT, ITEMS))
  assert.equal(times.lately.count, 10)
  assert.equal(times.lately.off, '1.6x too high')
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
