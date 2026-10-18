// B291: a worker that sent the main chat its "Safe point:" line after "prepare restart" has stopped for the restart,
// whatever its transcript's tail shows; its lane says "Suspended" until it works again. The person, 2026-10-17:
// "board says we are still waiting put on backlog to fix/investigate this issue" and "part of B291 is that i want
// the workers to show status suspended." Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, assistant, fromChat, step, tool, toolResult, user } from '../fixtures/lines.mjs'
import { safePointNote } from '../src/limits.mjs'
import { parseTail } from '../src/transcript.mjs'

const MIN = 60_000
const at = (hour, minute = 0) => new Date(2026, 9, 17, hour, minute).getTime()
const entries = lines => parseTail(lines.join('\n'), false)
const MAIN = ['Team - Main', 'local_main-1']
const toMain = (when, message, to = MAIN[0]) => [assistant(when, 'tool_use', [tool('SendMessage', { to, message })]), toolResult(when + 1000)]
// A turn on a task, cut off by the person, then the main chat's word to stop for the restart.
const cut = [
  fromChat(at(9, 0), MAIN[0], 'Task from Team - Main: the zebracorn.'), step(at(9, 1), 'Build'), toolResult(at(9, 2)),
  user(at(9, 40), [{ type: 'text', text: '[Request interrupted by user]' }]),
  fromChat(at(9, 41), MAIN[0], 'prepare restart: stop at a safe point and send your Safe point line.'),
]
const SINCE = at(9, 39)

test('a worker that sent its safe-point line after the prepare word has stopped, also after an interrupted turn', () => {
  const sent = [...cut, ...toMain(at(9, 43), 'Note from Team - Units: Safe point: B12 at b12-zebracorn 1a2b3c4; next: the tests.'), answer(at(9, 44), 'Stopped.')]
  assert.deepEqual(safePointNote(entries(sent), MAIN, SINCE), { at: at(9, 43) })
  // Sent to the main chat by its session id, as a chat may: the same.
  const byId = [...cut, ...toMain(at(9, 43), 'Note from Team - Units: Safe point: nothing open.', MAIN[1]), answer(at(9, 44), 'Stopped.')]
  assert.deepEqual(safePointNote(entries(byId), MAIN, SINCE), { at: at(9, 43) })
  // Still in the turn that sends it: it has stopped as well.
  assert.deepEqual(safePointNote(entries(sent.slice(0, -1)), MAIN, SINCE), { at: at(9, 43) })
})

test('only a line sent after the prepare word, to the main chat, in its first line; and not once it works again', () => {
  const told = (message, { to = MAIN[0], when = at(9, 43), since = SINCE } = {}) => safePointNote(entries([...cut, ...toMain(when, message, to), answer(when + 60_000, 'Stopped.')]), MAIN, since)
  assert.equal(told('Note from Team - Units: Safe point: done.', { since: at(9, 50) }), null)
  assert.equal(told('Note from Team - Units: Safe point: done.', { to: 'Team - Support' }), null)
  assert.equal(told('Report from Team - Units: B12 done.\nSafe point: merged.'), null)
  assert.equal(told('Note from Team - Units: Safe point: done.', { since: null }), null)
  // Brought back: once it works again after that turn, it has not stopped any more.
  const back = [...cut, ...toMain(at(9, 43), 'Note from Team - Units: Safe point: done.'), answer(at(9, 44), 'Stopped.'),
    fromChat(at(10, 30), MAIN[0], 'Resume from Team - Main: go on.'), step(at(10, 31), 'Build')]
  assert.equal(safePointNote(entries(back), MAIN, SINCE), null)
})

const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
const page = {}
vm.runInNewContext(`const LIMIT_NAMES = {}\nconst clock = ms => new Date(ms).toTimeString().slice(0, 5)\n${script.slice(script.indexOf('/** What a suspended lane says'), script.indexOf('// limits:end'))}\nthis.heldText = heldText`, page)

test('the lane of a worker stopped for the restart says so, and that it waits for Resume', () => {
  assert.equal(page.heldText({ by: 'restart', limit: null, since: at(9, 43), until: null, isBack: false }), `Stopped for the restart at ${new Date(at(9, 43)).toTimeString().slice(0, 5)} · waits for Resume`)
  // The time column is narrow: "Stopped for" over "Restart".
  assert.match(script, /if \(held\.by === 'restart'\) return plain\('Restart', 'muted', 'Stopped for'\)/)
})

test('the banner: only the chats with no line yet, "everyone stopped" when none is left, and when restart.md was last written', () => {
  assert.match(script, /Still working \(no safe point yet\): \$\{preparing\.working\.join\(', '\)\}/)
  assert.match(script, /Everyone stopped: safe to restart\./)
  assert.match(script, /last wrote down who was on what at \$\{clock\(restart\.prepared\.at\)\} \(restart\.md\)/)
})
