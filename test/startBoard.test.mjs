// B211: start-board.mjs starts the board in the background when it does not run yet, says where it runs, and is
// quiet as a hook. Tried with the demo on a free port; the board started here is stopped again.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

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

// F10 (2026-11-14): the boards survive a Claude app update: the keeper is started through WMI, outside the caller's process tree and
// its job. The proof is the brief's real case: a shell starts the board and the shell's whole tree is killed; the board must still answer
// (a keeper spawned as a child, the mutant, dies with the tree). IsProcessInJob alone cannot tell the two apart: a node process that
// spawned a child sits in libuv's own job (measured 2026-11-14: the keeper true, its board false, a WMI-made node without children
// false), so tools/in-job.ps1 is a helper for a look, not the proof.
const IN_JOB = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'in-job.ps1')
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')
const windows = { skip: process.platform !== 'win32' ? 'Windows only' : false }
/** What tools/in-job.ps1 says of the pids: "<pid> True|False|gone" each. */
const inJob = (...pids) => spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', IN_JOB, ...pids.map(String)], { encoding: 'utf8', timeout: 30_000, windowsHide: true }).stdout.trim().split(/\r?\n/)
const parentNameOf = pid => spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $p.ParentProcessId)).Name`], { encoding: 'utf8', timeout: 30_000, windowsHide: true }).stdout.trim()
const stopDemo = async (pid, port) => {
  if (Number.isInteger(pid)) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
  const until = Date.now() + 10_000
  while (await boardAt(port) && Date.now() < until) await new Promise(done => setTimeout(done, 200))
}

test('F10: a board started from a shell survives the kill of that shell\'s whole process tree (the keeper\'s parent is WmiPrvSE, not the shell); the line names the keeper\'s pid', windows, async t => {
  const port = String(await freePort())
  // The shell: a node process that runs start-board.mjs and then lingers, as a chat's shell would.
  const shell = spawn(process.execPath, ['-e', `const { spawnSync } = require('child_process'); const run = spawnSync(process.execPath, [${JSON.stringify(SCRIPT)}, '--demo', '--port', '${port}'], { encoding: 'utf8', env: ${JSON.stringify(startEnv(process.env))} }); process.stdout.write(run.stdout + run.stderr); setTimeout(() => {}, 60000)`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let said = ''
  shell.stdout.on('data', chunk => { said += chunk })
  shell.stderr.on('data', chunk => { said += chunk })
  await new Promise(done => { const look = () => (/process \d+/.test(said) || /did not/.test(said) ? done() : setTimeout(look, 200)); look() })
  const pid = Number(said.match(/process (\d+)/)?.[1])
  t.after(() => stopDemo(pid, port))
  t.after(() => spawnSync('taskkill', ['/PID', String(shell.pid), '/T', '/F'], { windowsHide: true }))
  assert.ok(Number.isInteger(pid), said)
  assert.doesNotMatch(said, /started as a child, not through WMI/, 'the WMI route, not the fallback')
  assert.equal(parentNameOf(pid), 'WmiPrvSE.exe', 'the keeper was made by WMI, not by the shell')
  assert.equal(await boardAt(port), true)
  // The shell's whole tree goes (as the app's update ends the app's job): the board is no part of it.
  spawnSync('taskkill', ['/PID', String(shell.pid), '/T', '/F'], { windowsHide: true })
  await new Promise(done => setTimeout(done, 1500))
  assert.equal(await boardAt(port), true, 'the board still answers after its starting shell\'s tree was killed')
  assert.equal(inJob(pid)[0], `${pid} True`, 'libuv\'s own job: a keeper that spawned its board (not the app\'s)')
})

test('F10: --stop writes the stop sign first (so the watcher leaves the board down), then ends the keeper and its board; --anew starts a new keeper while one answers', windows, async t => {
  const port = String(await freePort())
  const first = run('--demo', '--port', port)
  const pid = Number(first.stdout.match(/process (\d+)/)?.[1])
  t.after(() => stopDemo(pid, port))
  assert.equal(first.status, 0, first.stderr)
  const anew = run('--demo', '--port', port, '--anew')
  const second = Number(anew.stdout.match(/process (\d+)/)?.[1])
  t.after(() => stopDemo(second, port))
  assert.ok(Number.isInteger(second) && second !== pid, `a second keeper although the board answers: ${anew.stdout} ${anew.stderr}`)
  // A demo board writes no started.json and no stop.json of its own; --stop writes the sign all the same and ends every keeper of this folder.
  const sign = join(DATA, 'stop.json')
  const before = existsSync(sign) ? readFileSync(sign, 'utf8') : null
  t.after(() => { if (before === null) rmSync(sign, { force: true }); else writeFileSync(sign, before) })
  const stopped = run('--stop')
  assert.equal(stopped.status, 0, stopped.stderr)
  assert.match(stopped.stdout, /^The worker board is stopped \(keeper /)
  const written = JSON.parse(readFileSync(sign, 'utf8'))
  assert.deepEqual([written.why, written.by, Number.isFinite(written.at)], ['stopped', 'command', true])
  const until = Date.now() + 10_000
  while (await boardAt(port) && Date.now() < until) await new Promise(done => setTimeout(done, 200))
  assert.equal(await boardAt(port), false, 'the board is gone')
  assert.deepEqual(inJob(pid, second), [`${pid} gone`, `${second} gone`])
})
