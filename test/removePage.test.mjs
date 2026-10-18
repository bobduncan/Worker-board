// B143: what a worker's lane shows for removing it: the control (none on the main chat), the warning's lines when the
// worker is not free, and how an ask fares. The page's own code is run here, cut out of board.js between its marks.
// Made-up samples only; no word names a project.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const cut = name => {
  const [from, to] = [script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`)]
  assert.ok(from >= 0 && to > from, `board.js has no part "${name}"`)
  return script.slice(from, to)
}
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('remove')}\nObject.assign(this, { clock, removalView })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

const MIN = 60_000
const AT = new Date(2026, 9, 14, 9, 52).getTime()
const NOW = AT + 3 * MIN
const MAIN = 'Studio · Lead'
const lane = more => ({ name: 'Worker 1', isMain: false, isLeftover: false, state: 'free', task: null, queue: [], eta: null, suspended: null, removal: null, ...more })
const view = more => plain(page.removalView(lane(more), MAIN, NOW))
const task = { text: 'Build the first level', step: 2, steps: 6 }

test('the main chat and a leftover have no control; a free worker with nothing queued is removed without a warning', () => {
  assert.equal(view({ isMain: true }).canRemove, false)
  assert.equal(view({ isLeftover: true }).canRemove, false)
  assert.deepEqual(view(), { canRemove: true, reasons: [], line: null, isDisabled: false })
})

test('the warning says what the worker is doing and what would stop, for every state that is not free', () => {
  assert.deepEqual(view({ state: 'working', task, eta: { leftMs: 34 * MIN } }).reasons, [
    'It is working on "Build the first level", step 2 of 6, about 34 min left. That task stops at a safe point: its work is committed and its branch stays for another worker.',
  ])
  assert.deepEqual(view({ state: 'working' }).reasons, ['It is working. What it does stops at a safe point.'])
  assert.deepEqual(view({ state: 'waiting', task }).reasons, ['It waits for you on "Build the first level", step 2 of 6: your answer would no longer be taken.'])
  const until = new Date(2026, 9, 14, 11, 0).getTime()
  assert.deepEqual(view({ state: 'suspended', suspended: { until } }).reasons, ['It paused for the limit until 11:00: that task would not go on.'])
  // B291: stopped at a safe point for a restart.
  assert.deepEqual(view({ state: 'suspended', suspended: { by: 'restart', until: null } }).reasons, ['It stopped for the restart: that task would not go on.'])
  assert.deepEqual(view({ state: 'interrupted', task }).reasons, ['It was cut off in the middle of "Build the first level", step 2 of 6: that work would not be resumed.'])
  assert.deepEqual(view({ state: 'unknown' }).reasons, ['The board cannot tell what it is doing.'])
})

test('steps queued for a worker are named, up to three, and are handed on by the main chat', () => {
  assert.deepEqual(view({ queue: [{ title: 'Lava biome' }] }).reasons, ['1 step is queued for it: "Lava biome". The main chat hands it to another worker.'])
  const four = ['A', 'B', 'C', 'D'].map(title => ({ title }))
  assert.deepEqual(view({ queue: four }).reasons, ['4 steps are queued for it: "A", "B", "C" and 1 more. The main chat hands them to another worker.'])
  // Working and with a queue: both are said.
  assert.equal(view({ state: 'working', task, queue: four }).reasons.length, 2)
})

test('the lane says how the ask fares, and the control waits while it is open', () => {
  const asked = `You asked the main chat, ${MAIN}, to remove it at ${page.clock(AT)}.`
  const fare = removal => view({ removal })
  assert.deepEqual(fare({ at: AT, state: 'waiting', isOpen: true }), { canRemove: true, reasons: [], line: { tone: 'asked', text: `${asked} It waits for the main chat to take it.` }, isDisabled: true })
  assert.equal(fare({ at: AT, state: 'taken', isOpen: true }).line.text, `${asked} It is handed to the main chat.`)
  assert.equal(fare({ at: AT, state: 'delivered', isOpen: true }).line.text, `${asked} It is typed into its chat.`)
  // Arrived long enough ago and the worker is still there: it may be asked again.
  assert.deepEqual(fare({ at: AT, state: 'delivered', isOpen: false }), { canRemove: true, reasons: [], line: { tone: 'note', text: `${asked} It is still in the list: ask again if it should go.` }, isDisabled: false })
  assert.deepEqual(fare({ at: AT, state: 'expired', isOpen: false }).line, { tone: 'problem', text: `The ask of ${page.clock(AT)} to remove it did not reach the main chat: open its chat, then ask again.` })
  // An hour later the line is gone.
  assert.equal(plain(page.removalView(lane({ removal: { at: AT, state: 'delivered', isOpen: false } }), MAIN, AT + 61 * MIN)).line, null)
})

test('the lane has the control and the warning, and a click on them is not a click on a waiting lane', () => {
  assert.match(script, /el\('button', `remove-button\$\{isWarned \? ' is-warned' : ''\}`, '✕ Remove'\)/)
  assert.match(script, /el\('button', 'remove-sure', 'Remove anyway'\)/)
  assert.match(script, /el\('button', 'remove-keep', 'Keep it'\)/)
  assert.match(script, /send\(\{ to: main, command: 'remove', chat: name, \.\.\.\(removeSure === null \? \{\} : \{ sure: true \}\) \}, `remove:\$\{name\}`\)/)
})
