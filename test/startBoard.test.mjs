// B211: start-board.mjs starts the board in the background when it does not run yet, says where it runs, and is
// quiet as a hook. Tried with the demo on a free port; the board started here is stopped again.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

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
// its job. The proof is the update's own mechanism (chat 1's review): tools/job-kill.ps1 runs a shell (a node process that runs
// start-board.mjs and lingers) inside a Windows job with KILL_ON_JOB_CLOSE, as the app runs its chats, then ends the whole job with
// TerminateJobObject, as the app's self-update does; the board must still answer. The mutant (WORKER_BOARD_START_ROUTE=child: the old
// detached spawn, which inherits the job) dies with the job. (IsProcessInJob alone could not tell the two apart: a node that spawned a
// child sits in libuv's own job, measured 2026-11-14.)
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')
const JOB_KILL = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'job-kill.ps1')
const windows = { skip: process.platform !== 'win32' ? 'Windows only' : false }
const isAlive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
const parentNameOf = pid => spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $p.ParentProcessId)).Name`], { encoding: 'utf8', timeout: 30_000, windowsHide: true }).stdout.trim()
const stopDemo = async (pid, port) => {
  if (Number.isInteger(pid)) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
  const until = Date.now() + 10_000
  while (await boardAt(port) && Date.now() < until) await new Promise(done => setTimeout(done, 200))
}
/** The shell's script: runs start-board.mjs for the demo on `port`, prints its words, lingers (as a chat's shell would). */
function shellScript(t, port) {
  const file = join(tmpdir(), `start-board-shell-${process.pid}-${port}.cjs`)
  writeFileSync(file, `const { spawnSync } = require('child_process'); const run = spawnSync(process.execPath, [${JSON.stringify(SCRIPT)}, '--demo', '--port', '${port}'], { encoding: 'utf8' }); process.stdout.write(run.stdout + run.stderr); setTimeout(() => {}, 60000)`)
  t.after(() => rmSync(file, { force: true }))
  return file
}
/** Runs the shell inside a job that is then terminated (tools/job-kill.ps1); the helper's words. */
const jobKill = (file, env = {}) => spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', JOB_KILL, '-FileName', process.execPath, '-Arguments', `"${file}"`], { encoding: 'utf8', timeout: 90_000, windowsHide: true, env: { ...startEnv(process.env), ...env } })

test('F10: a board started from a shell inside a job survives the job\'s termination (the keeper\'s parent is WmiPrvSE, not the shell); the line names the keeper\'s pid', windows, async t => {
  const port = String(await freePort())
  const said = jobKill(shellScript(t, port))
  const pid = Number(said.stdout.match(/process (\d+)/)?.[1])
  t.after(() => stopDemo(pid, port))
  assert.equal(said.status, 0, said.stderr)
  assert.ok(Number.isInteger(pid), said.stdout)
  assert.doesNotMatch(said.stdout, /started as a child, not through WMI/, 'the WMI route, not the fallback')
  assert.match(said.stdout, /terminated exited=True/, 'the shell died with its job')
  assert.equal(parentNameOf(pid), 'WmiPrvSE.exe', 'the keeper was made by WMI, not by the shell')
  assert.equal(isAlive(pid), true, 'the keeper outlived the job')
  assert.equal(await boardAt(port), true, 'the board still answers after the job that started it was terminated')
})

test('F10, the mutant: a keeper spawned as the shell\'s child (the old route, WORKER_BOARD_START_ROUTE=child) dies with the job, and so does its board', windows, async t => {
  const port = String(await freePort())
  const said = jobKill(shellScript(t, port), { WORKER_BOARD_START_ROUTE: 'child' })
  const pid = Number(said.stdout.match(/process (\d+)/)?.[1])
  t.after(() => stopDemo(pid, port))
  assert.ok(Number.isInteger(pid), said.stdout)
  assert.match(said.stdout, /started as a child, not through WMI/, 'the fallback route')
  assert.match(said.stdout, /terminated exited=True/)
  const until = Date.now() + 5000
  while (await boardAt(port) && Date.now() < until) await new Promise(done => setTimeout(done, 200))
  assert.equal(await boardAt(port), false, 'the old route\'s board died with the job: that is what the update did on 2026-11-11')
  assert.equal(isAlive(pid), false)
})

test('F10: --stop writes the stop sign first (so the watcher leaves the board down), ends the keeper and its board, and writes the sign again once they are gone; --anew starts a new keeper while one answers', windows, async t => {
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
  const began = Date.now()
  const stopped = run('--stop')
  assert.equal(stopped.status, 0, stopped.stderr)
  assert.match(stopped.stdout, /^The worker board is stopped \(keeper /)
  const written = JSON.parse(readFileSync(sign, 'utf8'))
  assert.deepEqual([written.why, written.by, Number.isFinite(written.at)], ['stopped', 'command', true])
  assert.ok(written.at >= began, 'the sign was written again after the processes were gone')
  assert.deepEqual([isAlive(pid), isAlive(second), await boardAt(port)], [false, false, false], 'keepers and board gone')
})

test('F10: a WMI keeper whose board dies before it is up is noticed: the script ends with 1 and the log\'s last words, not after the 20 s wait', windows, async t => {
  // Another program holds the port: the board cannot listen, the keeper does not start it again and ends.
  const server = createServer((req, res) => res.end('<title>Something else</title>')).listen(0, '127.0.0.1')
  await new Promise(done => server.once('listening', done))
  t.after(() => server.close())
  const port = String(server.address().port)
  const began = Date.now()
  const said = run('--demo', '--port', port)
  assert.equal(said.status, 1)
  assert.ok(Date.now() - began < 18_000, `ended before the wait ran out: ${Date.now() - began} ms`)
  assert.match(said.stderr, /before it was up|in use|EADDRINUSE|ended/, said.stderr)
})
