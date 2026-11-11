// The review of chat-reports (2026-10-25): the page words a chat that reports its turn state as what is known. One idle
// with its task open is "Idle, task open" on its lane and in the restart banner, never "Cut off"; one not running says
// why ("silent since HH:MM", "its session ended at HH:MM"). A chat on an older Workers mod keeps today's words.
// Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const NOW = new Date(2026, 9, 25, 9, 30).getTime()
const MIN = 60_000
const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
const cut = name => {
  const [from, to] = [script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`)]
  assert.ok(from >= 0 && to > from, `board.js has no part "${name}"`)
  return script.slice(from, to)
}
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}
${cut('chatstatus')}\n${cut('lanetime')}\n${cut('simpleidle')}\n${cut('restartwords')}\nObject.assign(this, { clock, timeOf, simpleIdle, stoppedLines })`, page)
const plain = value => JSON.parse(JSON.stringify(value))
const pad = n => String(n).padStart(2, '0')
const hhmm = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`

const reportedIdle = { name: 'Board', state: 'interrupted', isLeftover: false, cutOffAt: null, report: { state: 'idle', since: NOW - 7 * MIN, background: false, at: NOW - 5_000 }, status: 'Stopped', why: `task open since ${hhmm(NOW - 7 * MIN)}`, since: NOW - 7 * MIN, age: 5_000 }
const cutOff = { name: 'Support', state: 'interrupted', isLeftover: false, cutOffAt: NOW - 20 * MIN, report: null, status: 'Stopped', why: `cut off at ${hhmm(NOW - 20 * MIN)}`, since: NOW - 20 * MIN, age: null }

test('a reporting chat idle with its task open and a cut-off one are both Stopped, each with its why (Signals change 2)', () => {
  const idle = plain(page.timeOf(reportedIdle, NOW))
  assert.deepEqual([idle.label, idle.main], ['Stopped', `task open since ${hhmm(NOW - 7 * MIN)}`])
  const old = plain(page.timeOf(cutOff, NOW))
  assert.deepEqual([old.label, old.main], ['Stopped', `cut off at ${hhmm(NOW - 20 * MIN)}`])
  assert.equal(page.simpleIdle(reportedIdle), `Stopped · task open since ${hhmm(NOW - 7 * MIN)}`)
  assert.equal(page.simpleIdle(cutOff), `Stopped · cut off at ${hhmm(NOW - 20 * MIN)}`)
})

test('a reporting chat that does not run says why on its lane; one without a reason says "Not running" as before', () => {
  const silent = plain(page.timeOf({ name: 'Board', state: 'off', offWhy: `silent since ${hhmm(NOW - 6 * MIN)}` }, NOW))
  assert.deepEqual([silent.label, silent.main, silent.small], ['Process', 'Not running', [`silent since ${hhmm(NOW - 6 * MIN)}`]])
  const ended = plain(page.timeOf({ name: 'Board', state: 'off', offWhy: 'its session ended at 09:20' }, NOW))
  assert.deepEqual(ended.small, ['its session ended at 09:20'])
  assert.deepEqual(plain(page.timeOf({ name: 'Board', state: 'off', offWhy: null }, NOW)).small, [])
  assert.equal(page.simpleIdle({ state: 'off', status: 'Not running', why: 'its session ended at 09:20', offWhy: 'its session ended at 09:20' }), 'Not running · its session ended at 09:20')
  assert.equal(page.simpleIdle({ state: 'off' }), 'Not running')
})

test('the restart banner names reporting chats idle with their task open apart from those cut off', () => {
  const restart = { main: 'Main', interrupted: ['Board', 'Support'] }
  assert.deepEqual(plain(page.stoppedLines(restart, [reportedIdle, cutOff])), ['Cut off in the middle of a task: Support.', 'Idle with its task open: Board.'])
  assert.deepEqual(plain(page.stoppedLines({ main: 'Main', interrupted: ['Support'] }, [cutOff])), ['Cut off in the middle of a task: Support.'])
  assert.deepEqual(plain(page.stoppedLines({ main: 'Main', interrupted: [] }, [])), [])
  // The banner uses it.
  // (P5: each chat it names is a link, so the line is a node built from the same words: test/stillTrue.test.mjs draws it.)
  assert.match(script, /for \(const text of stoppedLines\(restart, state\.chats \?\? \[\]\)\) \{/)
})
