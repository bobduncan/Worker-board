// B446: the result check of B404 found four catches left in server.mjs that swallowed their errors: asking the partner
// for a result check and the goal guard after a chat's checked, a picture's end after its making failed, and measuring
// the tasks inside the look. They now run through the loops' record (src/loops.mjs), so a failure shows on the page
// and is written to the log; no other catch in server.mjs drops an error without a word.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const server = await readFile(join(HERE, '..', 'server.mjs'), 'utf8')

/** The text of server.mjs from `from` up to `to`, both found once. */
const part = (from, to) => {
  const start = server.indexOf(from)
  assert.ok(start >= 0, `server.mjs holds ${from}`)
  const end = server.indexOf(to, start)
  assert.ok(end > start, `server.mjs holds ${to} after ${from}`)
  return server.slice(start, end)
}

// The other catches that give a value (`() => []`, `() => null`, ...) are fallbacks of a read, not of an action.
test('B446: no `.catch(() => {})` in server.mjs drops an error; only the settings queue has one, and its caller gets the error', () => {
  const silent = server.split('\n').map((line, i) => [i + 1, line.trim()]).filter(([, line]) => /\.catch\(\(\) => \{\}\)/.test(line))
  assert.deepEqual(silent.map(([, line]) => line), ['settingsQueue = turn.catch(() => {})'], silent.map(([at, line]) => `${at}: ${line}`).join('\n'))
  // The queue's caller has the turn itself, with its error.
  assert.match(part('const settingsTurn = run => {', 'const requests ='), /return turn\n/)
})

test('B446: the result check and the goal guard after a chat\'s checked run as loops', () => {
  const action = part('const workAction = async (body, as) => {', 'if (done.ok && done.result.changed !== false)')
  // The error names the step that was not asked for: the loop runs for every step.
  assert.match(action, /loops\.run\('result-check', \(\) => askResultCheck\(asked\)\.catch\(error => \{ throw aboutError\(asked\.id, error\) \}\)\)/)
  assert.match(action, /loops\.run\('guard', async \(\) => guardNow\(await goalOfChecked\(body\.id\)\)\)/)
  // A store the guard cannot read fails its loop, instead of counting no attempt as a success.
  const guard = part('const guardNow = async id => {', 'const toPartner = async')
  const goal = part('const goalOfChecked = async id => {', 'const openOverturnedGoal')
  for (const one of [guard, goal]) {
    assert.match(one, /await readStore\(workDir\)\)\.items/)
    assert.doesNotMatch(one, /readStore\(workDir\)\.catch/)
  }
})

test('B446: a picture whose making fails still gets its end, and its error is kept with the end\'s', () => {
  const making = part('loops.run(\'picture\'', 'const readState = cached(')
  assert.match(making, /^loops\.run\('picture', \(\) => work\(\)\.catch\(async error => \{/)
  assert.match(making, /ideas\.finish\(idea\.id, version\.n, \{ why: 'The picture could not be made\.' \}\)/)
  assert.match(making, /afterError\(error, ending, /)
  assert.match(making, /throw error/)
})

test('B446: measuring the tasks inside the look is a loop of its own; its failure does not stop the look', () => {
  const look = part('const look = () =>', 'const next = seenFromState(')
  assert.match(look, /await loops\.run\('measure', \(\) => measureTasks\(state\)\)/)
  assert.doesNotMatch(look, /measureTasks\(state\)\.catch/)
})
