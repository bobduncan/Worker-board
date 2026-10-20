// B404: the board's background loops record their health instead of swallowing errors; a stuck "check pending" is
// found again; behaviour on a fake clock and a list for the log.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterError, failingLine, fileLog, loopRecord, settleWithin, wordsOf } from '../src/loops.mjs'
import { STUCK_CHECK_MS, stuckChecks } from '../src/work/api.mjs'

const clockAt = start => {
  let t = start
  return { now: () => t, add: ms => { t += ms } }
}

test('a loop that throws once is recorded, goes on, and is healthy after its next success', async () => {
  const clock = clockAt(Date.UTC(2026, 9, 19, 21, 10))
  const lines = []
  const loops = loopRecord({ now: clock.now, write: line => lines.push(line) })
  let calls = 0
  const pass = () => loops.run('reconcile', async () => {
    calls += 1
    if (calls === 1) throw new Error('approve-recaps: an odd recap')
    return 'ok'
  })
  assert.equal(await pass(), undefined, 'a failed run never throws')
  assert.deepEqual(loops.failing().map(one => [one.name, one.words, one.failures, one.error]), [['reconcile', 'delivery', 1, 'approve-recaps: an odd recap']])
  assert.equal(lines.length, 1)
  assert.match(lines[0], /reconcile: approve-recaps: an odd recap\n$/)
  clock.add(5000)
  assert.equal(await pass(), 'ok')
  assert.deepEqual(loops.failing(), [])
  assert.equal(loops.all()[0].lastOk, clock.now())
})

test('a loop failing every refresh writes its error once, keeps its first time, and the page line names it', async () => {
  const clock = clockAt(Date.UTC(2026, 9, 19, 21, 10))
  const lines = []
  const loops = loopRecord({ now: clock.now, write: line => lines.push(line) })
  const since = clock.now()
  for (let i = 0; i < 5; i += 1) {
    await loops.run('reconcile', async () => { throw new Error('EBUSY: resource busy') })
    clock.add(5000)
  }
  await loops.run('look', async () => { throw new Error('state unreadable') })
  assert.equal(lines.length, 2, 'one line per new error, not per run')
  const failing = loops.failing()
  assert.equal(failing[0].since, since)
  assert.equal(failing[0].failures, 5)
  const line = failingLine(failing, at => new Date(at).toISOString().slice(11, 16))
  assert.equal(line, 'Delivery failing since 21:10 (EBUSY: resource busy); also the board\'s look')
  assert.equal(failingLine([], () => ''), null)
})

test('B446: an error that differs only in its temp file name writes one line; another error writes its own', async () => {
  const clock = clockAt(Date.UTC(2026, 9, 21, 0, 40))
  const lines = []
  const loops = loopRecord({ now: clock.now, write: line => lines.push(line) })
  const busy = beside => new Error(`EPERM: operation not permitted, rename 'C:\\p\\data\\finished.json.${beside}.tmp' -> 'C:\\p\\data\\finished.json'`)
  for (const beside of ['4120.0a1b2c3d', '4120.9f8e7d6c', '4120.00ff00ff', '577.deadbeef']) {
    await loops.run('look', async () => { throw busy(beside) })
    clock.add(5000)
  }
  assert.equal(lines.length, 1, 'the same error again with another temp file is not a new line')
  assert.equal(loops.failing()[0].failures, 4)
  assert.match(loops.failing()[0].error, /finished\.json\.577\.deadbeef\.tmp/, 'the page shows the last error as it was')
  await loops.run('look', async () => { throw new Error('EPERM: operation not permitted, rename \'C:\\p\\data\\rounds.json.4120.0a1b2c3d.tmp\' -> \'C:\\p\\data\\rounds.json\'') })
  assert.equal(lines.length, 2, 'another file is another error')
  await loops.run('look', async () => { throw new Error('state unreadable') })
  assert.equal(lines.length, 3)
})

test('B446: a failure and the failure of its clean-up after it are one error, in both their words', () => {
  const joined = afterError(new Error('codex exited with 1\nstack'), new Error('EBUSY: ideas.json'), 'the idea\'s end could not be written')
  assert.ok(joined instanceof Error)
  assert.equal(joined.message, 'codex exited with 1; the idea\'s end could not be written: EBUSY: ideas.json')
  assert.equal(afterError('odd', 'worse', 'then').message, 'odd; then: worse')
})

test('B446: the page has words for the loops that run on a chat\'s report and for the pictures', () => {
  assert.equal(wordsOf('result-check'), 'asking for a result check')
  assert.equal(wordsOf('guard'), 'the goal guard')
  assert.equal(wordsOf('picture'), 'making a picture')
  assert.equal(wordsOf('measure'), 'measuring the tasks')
})

test('the log file is written, and a full one is moved aside', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'loops-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, '.claude', 'board-errors.log')
  const write = fileLog(file, { maxBytes: 60 })
  await write('2026-10-19T21:10:00.000Z look: one\n')
  await write('2026-10-19T21:10:05.000Z look: two\n')
  assert.equal(await readFile(file, 'utf8'), '2026-10-19T21:10:05.000Z look: two\n')
  assert.equal(await readFile(`${file}.1`, 'utf8'), '2026-10-19T21:10:00.000Z look: one\n')
  await writeFile(join(dir, 'blocker'), 'x')
  // A log that cannot be written never throws.
  await fileLog(join(dir, 'blocker', 'x.log'))('line\n')
  assert.ok((await stat(join(dir, 'blocker'))).isFile())
})

const stamp = ms => {
  const at = new Date(ms)
  const pad = n => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}
const step = (id, state, history) => ({
  head: new Map([['Id', id], ['Kind', 'step'], ['State', state]]),
  sections: new Map([['History', history]]),
})

test('a step on "check pending" for more than 2 minutes is stuck; a check that ran, a running one or a fresh one is not', () => {
  const now = new Date(2026, 9, 19, 23, 30).getTime()
  const old = stamp(now - STUCK_CHECK_MS - 60_000)
  const fresh = stamp(now - 60_000)
  const items = [
    step('B1', 'review', [`- ${old} Worker 5: in progress → review`, `- ${old} server: check pending`]),
    step('B2', 'review', [`- ${old} server: check pending`, `- ${old} server: check passed: work in board`]),
    step('B3', 'review', [`- ${fresh} server: check pending`]),
    step('B4', 'review', [`- ${old} server: check pending`]),
    step('B5', 'done', [`- ${old} server: check pending`]),
    step('B6', 'review', [`- ${old} server: check failed: the branch b6 is still there`, `- ${old} Worker 2: reported again`, `- ${old} server: check pending`]),
  ]
  assert.deepEqual(stuckChecks(items, now, new Set(['B4'])), ['B1', 'B6'])
})

test('a restart waits for the running work, but at most its time', async () => {
  let release = () => {}
  const running = new Promise(done => { release = done })
  let wake = () => {}
  const sleep = () => new Promise(done => { wake = done })
  const waiting = settleWithin([running, null, Promise.reject(new Error('a check failed'))], 10_000, sleep)
  release()
  assert.equal(await waiting, true, 'all settled in time, a failed one too')
  const stuck = settleWithin([new Promise(() => {})], 10_000, sleep)
  wake()
  assert.equal(await stuck, false, 'the time ran out')
})

test('a stuck check is run again at most three times after one report; a new report starts the count anew', () => {
  const now = new Date(2026, 9, 19, 23, 30).getTime()
  const old = stamp(now - STUCK_CHECK_MS - 60_000)
  const again = `- ${old} server: check run again: it stood on check pending for more than 2 minutes`
  const pending = `- ${old} server: check pending`
  const tries = n => Array.from({ length: n }, () => [again, pending]).flat()
  const items = [
    step('B1', 'review', [`- ${old} Worker 5: in progress → review`, pending, ...tries(2)]),
    step('B2', 'review', [`- ${old} Worker 5: in progress → review`, pending, ...tries(3)]),
    step('B3', 'review', [`- ${old} Worker 5: in progress → review`, pending, ...tries(3), `- ${old} Worker 5: reported again`, pending]),
  ]
  assert.deepEqual(stuckChecks(items, now), ['B1', 'B3'])
})

test('a check failing for one step is shown by its step, and its next success clears it', async () => {
  const loops = loopRecord({ now: () => 0 })
  await loops.run('check:B7', async () => { throw new Error('git did not answer') })
  assert.equal(loops.failing()[0].words, 'the check of B7')
  await loops.run('check:B8', async () => 'ok')
  assert.equal(loops.failing().length, 1)
  await loops.run('check:B7', async () => 'ok')
  assert.deepEqual(loops.failing(), [])
})
