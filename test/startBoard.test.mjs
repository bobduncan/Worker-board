// B211: start-board.mjs starts the board in the background when it does not run yet, says where it runs, and is
// quiet as a hook. Tried with the demo on a free port; the board started here is stopped again.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { boardAt } from '../start-board.mjs'
import { startEnv } from '../src/keeper.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'start-board.mjs')
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 30_000, env: startEnv(process.env) })
const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})

test('a page that is not the worker board is not taken for it', async t => {
  const server = createServer((req, res) => res.end('<title>Something else</title>')).listen(0, '127.0.0.1')
  await new Promise(done => server.once('listening', done))
  t.after(() => server.close())
  assert.equal(await boardAt(server.address().port), false)
  assert.equal(await boardAt(await freePort()), false)
})

test('the script starts the board once, says where, and leaves a running board alone', async t => {
  const port = String(await freePort())
  const first = run('--demo', '--port', port)
  const pid = Number(first.stdout.match(/process (\d+)/)?.[1])
  t.after(async () => {
    if (Number.isInteger(pid)) try { process.kill(pid) } catch {}
    const until = Date.now() + 10_000
    while (await boardAt(port) && Date.now() < until) await new Promise(done => setTimeout(done, 200))
  })
  assert.equal(first.status, 0, first.stderr)
  assert.ok(first.stdout.startsWith(`The worker board runs: http://127.0.0.1:${port}/ (process ${pid}; its words go to data/board.log)`), first.stdout)
  assert.equal(await boardAt(port), true)
  const again = run('--demo', '--port', port)
  assert.deepEqual([again.status, again.stdout.trim()], [0, `The worker board runs already: http://127.0.0.1:${port}/`])
  const quiet = run('--demo', '--port', port, '--quiet')
  assert.deepEqual([quiet.status, quiet.stdout], [0, ''])
})

// Signals change 5 (2026-11-02, D3): the script starts the keeper, never a bare board, and a cold start has a new token.

test('startEnv: what a keeper hands its own board is not handed on; the rest of the env is', () => {
  const env = { PATH: 'C:\bin', WORKER_BOARD_HOME: 'C:\pc', WORKER_BOARD_CHILD: '1', WORKER_BOARD_KEY: 'k'.repeat(64), WORKER_BOARD_TOKEN: 't'.repeat(64) }
  assert.deepEqual(startEnv(env), { PATH: 'C:\bin', WORKER_BOARD_HOME: 'C:\pc' })
  assert.equal(env.WORKER_BOARD_CHILD, '1', 'the env it was given is left as it was')
})

test('run from inside a board\'s process, the script still starts a keeper with a new token', async t => {
  const port = String(await freePort())
  const kept = 'a1'.repeat(32)
  const first = spawnSync(process.execPath, [SCRIPT, '--demo', '--port', port], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, WORKER_BOARD_CHILD: '1', WORKER_BOARD_TOKEN: kept } })
  const pid = Number(first.stdout.match(/process (\d+)/)?.[1])
  t.after(async () => {
    if (Number.isInteger(pid)) try { process.kill(pid) } catch {}
    const until = Date.now() + 10_000
    while (await boardAt(port) && Date.now() < until) await new Promise(done => setTimeout(done, 200))
  })
  assert.equal(first.status, 0, first.stderr)
  const token = /[0-9a-f]{64}/.exec(await fetch(`http://127.0.0.1:${port}/`).then(reply => reply.text()))?.[0]
  assert.ok(token !== undefined && token !== kept, 'a new token')
  const state = await fetch(`http://127.0.0.1:${port}/api/state`, { headers: { 'X-Board-Token': token } }).then(reply => reply.json())
  assert.equal(state.version.canRestart, true, 'the board runs under a keeper: it can be started anew')
})
