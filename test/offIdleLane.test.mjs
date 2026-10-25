// A worker whose chat does not run ("off") and that holds no work is no problem: nothing waits for it, and the board
// starts it when work comes. Its lane is quiet: the "Not running" chip and one muted line, no alert, no "Task not
// recorded yet", no progress bar, nothing red in its Process column. One that holds work (a store step taken, in
// progress or waiting on the person; a ready task pinned to it) keeps the alarm, worded as what waits for it.
// Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
const css = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.css'), 'utf8')
const cut = name => {
  const [from, to] = [script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`)]
  assert.ok(from >= 0 && to > from, `board.js has no part "${name}"`)
  return script.slice(from, to)
}
const page = {}
vm.runInNewContext(`${cut('offwork')}\nObject.assign(this, { offWorkOf })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

const off = (more = {}) => ({ name: 'Worker 1', state: 'off', isLeftover: false, task: { topic: null }, storeSteps: [], ...more })
const ready = (...entries) => ({ readyList: { ready: entries, held: [] }, restart: { main: 'Main', starting: [] } })

test('an off worker that holds no work is quiet: one muted line, nothing waits for it', () => {
  const view = plain(page.offWorkOf(off(), ready(), 'Main'))
  assert.deepEqual(view, { isIdle: true, waits: [], text: 'Not running, nothing waits for it' })
  // A step of its in review waits for its check, not for it; a ready task pinned to another worker is not its.
  const other = plain(page.offWorkOf(off({ storeSteps: [{ id: 'B7', state: 'review' }] }), ready({ id: 'B590', pinned: 'Worker 2', keptFor: 'Worker 2' }, { id: 'B591', pinned: null, keptFor: null }), 'Main'))
  assert.equal(other.isIdle, true)
  // Without a ready list (no store) it holds none either.
  assert.equal(page.offWorkOf(off(), {}, 'Main').isIdle, true)
})

test('an off worker that holds work keeps the alarm, worded as what waits for it and whether the board asked', () => {
  const pinned = plain(page.offWorkOf(off(), ready({ id: 'B590', pinned: 'Worker 1', keptFor: 'Worker 1' }), 'Main'))
  assert.deepEqual(pinned, { isIdle: false, waits: ['B590'], text: 'B590 waits for it: it does nothing until its chat is opened, or Main starts it (Resume all).' })
  const asked = { ...ready({ id: 'B590', pinned: 'Worker 1', keptFor: 'Worker 1' }), restart: { main: 'Main', starting: [{ chat: 'Worker 1', at: 1, state: 'waiting' }] } }
  assert.equal(page.offWorkOf(off(), asked, 'Main').text, 'B590 waits for it; the board asked Main to start it.')
  // A start word that was dropped or expired is no ask any more.
  const dropped = { ...asked, restart: { main: 'Main', starting: [{ chat: 'Worker 1', at: 1, state: 'dropped' }] } }
  assert.match(page.offWorkOf(off(), dropped, 'Main').text, /^B590 waits for it: it does nothing until/)
  const held = plain(page.offWorkOf(off({ storeSteps: [{ id: 'B12', state: 'in progress' }, { id: 'B13', state: 'waiting on you' }, { id: 'B14', state: 'review' }] }), ready(), 'Main'))
  assert.deepEqual([held.isIdle, held.waits, held.text], [false, ['B12', 'B13'], 'B12, B13 wait for it: it does nothing until its chat is opened, or Main starts it (Resume all).'])
  assert.deepEqual(plain(page.offWorkOf(off({ storeSteps: [{ id: 'B12', state: 'taken' }] }), ready(), 'Main').waits), ['B12'])
})

test('a lane that is not off, or a leftover, has no such view', () => {
  assert.equal(page.offWorkOf(off({ state: 'free' }), ready(), 'Main'), null)
  assert.equal(page.offWorkOf(off({ isLeftover: true }), ready(), 'Main'), null)
})

test('the lane draws the quiet view: no alert, no task, no bar, an empty Process column; the alarm only with work', () => {
  assert.match(script, /const offWork = offWorkOf\(lane, state, main\)/)
  assert.match(script, /const isQuietOff = offWork\?\.isIdle === true/)
  // No "Task not recorded yet" and no progress bar for the quiet one.
  assert.match(script, /const task = isQuietOff \? null : lane\.task/)
  // Its line is muted; the alarm, for one that holds work, names what waits.
  assert.match(script, /if \(offWork !== null\) what\.append\(el\('p', isQuietOff \? 'off-idle' : 'alert', offWork\.text\)\)/)
  assert.doesNotMatch(script, /Its chat is not running: it does nothing until its chat is opened/)
  assert.match(script, /const alerts = isQuietOff \? \[\] : alertsOf\(lane, state\)/)
  // Nothing red in the Process column: it stays empty as for a free worker.
  assert.match(script, /isQuietOff \? el\('div', 'eta is-muted'\) : drawEta\(lane, state\.readAt\)/)
  assert.match(css, /\.lane-row \.off-idle \{ color: var\(--muted\);/)
})
