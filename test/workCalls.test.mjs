// board-fast-answer (B1030 way A, 2026-11-11): the work calls' day record (src/workCalls.mjs): every answered call counted by day and
// action with its time and the state rebuilds that started during it; the day's figures in one line for the health summary; the
// newest seven days kept in a file. A made-up clock and folder; nothing of the board runs.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { DAYS_KEPT, MOST_TIMES, OVER_MS, dayOf, figuresOf, percentile, workCallRecord, workCallsWords } from '../src/workCalls.mjs'
import { tempDir } from './tempDir.mjs'

const DAY = new Date(2026, 10, 11, 10, 0).getTime()
const MIN = 60_000
const HOUR = 60 * MIN

test('the figures: count, median, p95, slowest, over 5 s and rebuilds, by day and by action; the words of the health line', () => {
  let now = DAY
  const record = workCallRecord({ now: () => now })
  assert.equal(workCallsWords(record.today()), 'work calls today: none yet')
  for (const [action, ms, rebuilds] of [['take', 120, 0], ['step', 300, 0], ['report', 2800, 1], ['note', 90, 0], ['ask', 6200, 2], ['step', 250, 0]]) record.note({ action, chat: 'Worker 5', ms, rebuilds })
  const today = record.today()
  assert.deepEqual([today.day, today.count, today.median, today.p95, today.max, today.over, today.rebuilds], ['2026-11-11', 6, 250, 6200, 6200, 1, 3])
  assert.deepEqual(figuresOf(null), { count: 0, median: null, p95: null, max: null, over: 0, rebuilds: 0 })
  assert.deepEqual(today.byAction.step, { count: 2, median: 250, p95: 300, max: 300, over: 0, rebuilds: 0 })
  assert.deepEqual(today.byAction.ask, { count: 1, median: 6200, p95: 6200, max: 6200, over: 1, rebuilds: 2 })
  assert.equal(workCallsWords(today), 'work calls today: 6 (median 0.3 s, slowest 6.2 s, 1 over 5 s, 3 rebuilds started during calls)')
  // Without a slow call or a rebuild the line is the bare figure.
  assert.equal(workCallsWords({ count: 412, median: 310, max: 1800, over: 0, rebuilds: 0 }), 'work calls today: 412 (median 0.3 s, slowest 1.8 s, 0 over 5 s)')
  assert.equal(workCallsWords({ count: 1, median: 12_400, max: 12_400, over: 1, rebuilds: 1 }), 'work calls today: 1 (median 12 s, slowest 12 s, 1 over 5 s, 1 rebuild started during calls)')
  // The percentile: the value under which the share lies; exactly OVER_MS counts as over.
  assert.deepEqual([percentile([5, 1, 3], 0.5), percentile([5, 1, 3], 0.95), percentile([], 0.5), percentile([7], 0.95)], [3, 5, null, 7])
  record.note({ action: 'take', ms: OVER_MS })
  assert.equal(record.today().over, 2)
  // A time that is no number, or negative, counts nothing.
  record.note({ action: 'take', ms: Number.NaN })
  record.note({ action: 'take', ms: -5 })
  assert.equal(record.today().count, 7)
  // The next day starts its own figures; the days list is newest first.
  now = DAY + 24 * HOUR
  record.note({ action: 'take', ms: 100 })
  assert.deepEqual([record.today().count, record.days().map(one => one.day)], [1, ['2026-11-12', '2026-11-11']])
  assert.equal(dayOf(DAY + 13 * HOUR + 59 * MIN), '2026-11-11')
})

test('the file: written soon after a note, read back at the start, the newest seven days kept, the single times capped', async t => {
  const file = join(await tempDir(t), 'work-calls.json')
  let now = DAY
  const record = workCallRecord({ now: () => now, file, saveMs: 10 })
  for (let day = 0; day < DAYS_KEPT + 2; day++) {
    now = DAY + day * 24 * HOUR
    record.note({ action: 'take', ms: 100 + day })
  }
  await record.flush()
  const kept = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(Object.keys(kept.days).length, DAYS_KEPT)
  assert.ok(!('2026-11-11' in kept.days) && '2026-11-13' in kept.days, 'the two oldest days are gone')
  // Read back by a new record: the same figures; a day's single times are capped at MOST_TIMES, the counts go on.
  const again = workCallRecord({ now: () => now, file })
  await again.load()
  assert.deepEqual(again.days().map(one => one.day), record.days().map(one => one.day))
  assert.equal(again.today().max, 100 + DAYS_KEPT + 1)
  for (let i = 0; i < MOST_TIMES + 50; i++) again.note({ action: 'take', ms: 50 })
  assert.deepEqual([again.today().count, again.today().byAction.take.count], [MOST_TIMES + 51, MOST_TIMES + 51])
  await again.flush()
  const capped = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(capped.days[dayOf(now)].all.times.length, MOST_TIMES)
  // A broken file is an empty record, never a crash.
  const broken = workCallRecord({ now: () => now, file, fs: { readFile: async () => '{not json' } })
  await broken.load()
  assert.equal(broken.today().count, 0)
})
