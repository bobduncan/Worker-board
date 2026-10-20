// B446: the result check of B404 found four catches left in server.mjs that swallowed their errors: asking the partner
// for a result check and the goal guard after a chat's checked, a picture's end after its making failed, and measuring
// the tasks inside the look. They now run through the loops' record (src/loops.mjs), so a failure shows on the page
// and is written to the log; no other catch in server.mjs drops an error without a reason (B467).

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

// B467: the result check of B446 found two more that gave a value instead (`() => []`, `() => ({ items: new Map() })`):
// a store or goal map it could not read was taken for an empty one. A catch that drops its error is now one of two,
// each with its reason; a read that may find nothing there says so with `absentAs` (only a missing file or folder).
test('B467: no catch in server.mjs drops its error, apart from the settings queue and the refusal of a goal not reopened', () => {
  const dropped = server.split('\n').map((line, i) => [i + 1, line.trim()]).filter(([, line]) => /\.catch\(\(\) =>/.test(line))
  assert.deepEqual(dropped.map(([, line]) => line), [
    '.catch(() => ({ ok: false, status: 500, why: `${about} could not be opened again: try once more.` }))',
    'settingsQueue = turn.catch(() => {})',
  ], dropped.map(([at, line]) => `${at}: ${line}`).join('\n'))
  // The queue's caller has the turn itself, with its error; the page is told the goal was not opened again.
  assert.match(part('const settingsTurn = run => {', 'const requests ='), /return turn\n/)
  assert.match(part('const openOverturnedGoal = async body => {', 'const workReads'), /return opened\n/)
  // No `.then(..., () => ...)` drops a read's error either; a look whether a file is there (stat) may.
  const second = server.split('\n').filter(line => /\.then\([^)]*\), \(\) =>/.test(line) && !/stat\(/.test(line))
  assert.deepEqual(second, [])
})

test('B467: a work store or goal map the server cannot read fails what needed it, never taken for an empty one', () => {
  assert.doesNotMatch(server, /readStore\(workDir\)\.catch/)
  const measure = part('const measureTasks = async state => {', 'const stepOf =')
  assert.match(measure, /const items = \(await readStore\(workDir\)\)\.items/)
  // The evaluations that run: unknown keeps the partner's effort as it is, instead of switching it.
  const focus = part('const focusNow = async body => {', 'const main = state.restart?.main ?? null')
  assert.match(focus, /const running = done\.ok \? await loops\.run\('evaluations', \(\) => evaluationsRunning\(/)
  assert.match(focus, /isKnown && running\.length === 0\) await partnerMode\(state, 'usual'/)
  assert.match(focus, /const back = isSameFocus \|\| !isKnown \|\| running\.length > 0 \? null :/)
})

test('B467: the app\'s folder, the kinds of idea, another board\'s task times and where the chats find the board are shown when they fail', () => {
  assert.match(server, /await loops\.run\('app-folder', \(\) => followApp\(config, process\.env, process\.platform\)\)/)
  assert.match(server, /readFile\(kindsFile, 'utf8'\)\.catch\(absentAs\(''\)\)\.catch\(error => \{ loops\.failed\('design-kinds', error\); return '' \}\)/)
  assert.match(server, /\.catch\(absentAs\(null\)\)\.catch\(error => \{ loops\.failed\('history', error\); return null \}\)/)
  assert.match(server, /loops\.failed\('bridge-note', error\)/)
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
