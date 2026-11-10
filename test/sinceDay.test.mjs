// A lane's "since" shows the day when it is not today (the person's screenshot, 2026-11-10 21:28: "Asleep · since 23:54" and
// "free since 23:39" were yesterday's times read as today's; the PC was off from 11-09 23:57 to 11-10 20:58). Made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { STATUSES, STATUS_LIST, countsOf, sinceClock as serverSince, statusOf } from '../src/chatStatus.mjs'
import { openPage } from './pageHarness.mjs'
import { asSent, build } from './partnerState.mjs'

const at = (day, h, m) => new Date(2026, 10, day, h, m).getTime()
const NOW = at(10, 21, 28)
const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
const cut = name => {
  const [from, to] = [script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`)]
  assert.ok(from >= 0 && to > from, `board.js has no part "${name}"`)
  return script.slice(from, to)
}
const sandbox = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('chatstatus')}\n${cut('lanetime')}\n${cut('calmoverview')}\nObject.assign(this, { sinceClock, asleepWords, freeShort, statusLabel })`, sandbox)

test('the day of a since: today plain, yesterday named, older days dated; the page and the server agree', () => {
  const cases = [
    [at(10, 8, 5), '08:05'], [at(9, 23, 54), 'yesterday 23:54'], [at(9, 0, 0), 'yesterday 00:00'], [at(8, 23, 54), '8 Nov 23:54'], [at(1, 7, 3), '1 Nov 07:03'],
    [new Date(2026, 9, 31, 12, 0).getTime(), '31 Oct 12:00'],
  ]
  for (const [ms, words] of cases) {
    assert.equal(sandbox.sinceClock(ms, NOW), words)
    assert.equal(serverSince(ms, NOW), words)
  }
})

test('the real case: asleep since 23:54 and free since 23:39 of yesterday read with the day', () => {
  assert.equal(sandbox.statusLabel({ status: 'Asleep', since: at(9, 23, 54), age: 0, isReported: true }, NOW), 'Asleep · since yesterday 23:54')
  assert.equal(sandbox.statusLabel({ status: 'Asleep', since: at(10, 20, 58), age: 0, isReported: true }, NOW), 'Asleep · since 20:58')
  assert.equal(sandbox.freeShort({ state: 'free', idle: { since: at(9, 23, 39) } }, ms => `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`, NOW), 'free since yesterday 23:39')
  assert.equal(sandbox.asleepWords({ state: 'free', asleepSince: at(8, 23, 54) }, NOW), 'asleep since 8 Nov 23:54, wakes when it gets a task')
  const stopped = statusOf({ lane: { state: 'interrupted', isRunning: true, asleep: false, report: { state: 'idle', since: at(9, 23, 54), at: at(9, 23, 54) } }, now: NOW })
  assert.equal(stopped.why, 'task open since yesterday 23:54')
})

test('the page draws the day in the pill, the Workers list and the task column', async () => {
  const baseState = asSent(build([], undefined, undefined))
  const template = baseState.chats.find(chat => chat.name === 'Digger')
  const make = (status, more) => ({ ...structuredClone(template), name: `Lane ${STATUS_LIST.indexOf(status)}`, state: 'free', isRunning: false, asleep: status === STATUSES.ASLEEP, asleepSince: status === STATUSES.ASLEEP ? at(9, 23, 54) : null, status, why: null, since: null, reportAt: NOW - 2000, age: 2000, task: null, eta: null, queue: [], flags: [], ...more })
  const sleeper = make(STATUSES.ASLEEP, { name: 'Sleeper', since: at(9, 23, 54) })
  const free = make(STATUSES.FREE, { name: 'Rester', isRunning: true, idle: { since: at(9, 23, 39), from: 'app', isSilent: false } })
  const chats = [sleeper, free]
  const page = await openPage({ state: { ...baseState, chats, counts: countsOf(chats) }, now: NOW })
  try {
    const lane = name => page.all('#lanes [data-lane]').find(one => one.dataset.lane === name)
    assert.equal(lane('Sleeper').querySelector('.pill').textContent, 'Asleep · since yesterday 23:54')
    const rows = page.all('#simple-workers .simple-worker').map(one => one.textContent)
    assert.ok(rows.some(text => text.includes('Asleep · since yesterday 23:54')), rows.join(' | '))
    assert.ok(page.all('#lanes .free-since').some(one => one.textContent === 'free since yesterday 23:39'), page.all('#lanes .free-since').map(one => one.textContent).join(' | '))
  } finally { await page.close() }
})
