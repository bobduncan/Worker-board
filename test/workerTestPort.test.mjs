// B814: a worker's test server is a plain background command on a port of its own; the take names it, and the board's
// play servers pass over those ports.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { GAME_SPAN, WORKER_PORTS_FROM, gamePortFor, workerPort } from '../src/ports.mjs'
import { workApi } from '../src/work/api.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { writeStore } from '../src/work/store.mjs'

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')
const NOW = Date.UTC(2026, 9, 31, 12, 0)

test('workerPort: Worker n takes gamePort + 90 + n, inside the range, never 5173, no two alike', () => {
  const ports = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => workerPort(5300, `Worker ${n}`))
  assert.deepEqual(ports.slice(0, 5), [5391, 5392, 5393, 5394, 5395])
  assert.equal(new Set(ports).size, 9)
  assert.ok(ports.every(port => port >= 5300 + WORKER_PORTS_FROM && port < 5300 + GAME_SPAN && port !== 5173))
  assert.equal(workerPort(5300, 'Game - Worker 4'), 5394)
})

test('workerPort: a name with no number from 1 to 9, or no game port, has none', () => {
  assert.equal(workerPort(5300, 'Units'), null)
  assert.equal(workerPort(5300, 'Worker 0'), null)
  assert.equal(workerPort(5300, 'Worker 12'), null)
  assert.equal(workerPort(undefined, 'Worker 1'), null)
})

test('gamePortFor: the play servers of any number of folders pass over the workers\' ports', () => {
  const used = Array.from({ length: 400 }, (_none, place) => gamePortFor(5300, place))
  assert.ok(used.every(port => port >= 5300 && port < 5300 + WORKER_PORTS_FROM))
  const workers = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => workerPort(5300, `Worker ${n}`)))
  assert.ok(used.every(port => !workers.has(port)))
  assert.equal(gamePortFor(5300, 0), 5300)
  assert.equal(gamePortFor(5300, 3), 5303)
})

test('work take names the worker\'s test-server port and refuses launch.json and preview_start', async t => {
  const dir = await mkdtemp(join(DATA, 'test-worker-port-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, migrateBacklog(['# Backlog', '', '## Art', '- [ ] B13 Draw the knight (for Worker 4; about 1 h)', ''].join('\n'), { now: NOW }), undefined, { now: NOW })
  const call = body => workApi(body, { dir, now: NOW, prefix: 'Game - ', roleOf: name => (name === 'Worker 4' ? 'worker' : null), testPort: who => workerPort(5300, who) })
  const taken = await call({ action: 'take', minutes: 30, chat: 'Worker 4', id: 'B13', branch: 'b13-knight' })
  assert.equal(taken.ok, true, taken.why)
  assert.equal(taken.result.testPort, 5394)
  assert.match(taken.result.text, /Test server port for Worker 4: 5394/)
  assert.match(taken.result.text, /never through \.claude\/launch\.json or preview_start/)
})
