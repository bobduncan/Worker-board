// B211: start-board.mjs starts the board in the background when it does not run yet, says where it runs, and is
// quiet as a hook. Tried with the demo on a free port; the board started here is stopped again.

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { cpus, tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { createConnection } from 'node:net'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

import { ANSWER_MS, boardAt, earlyEndVerdict } from '../start-board.mjs'
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
/** Ends every keeper and board of the demo on `port` (the keeper's line is "server.mjs" --log --demo --port N), until none is left. */
async function sweep(port) {
  const psRun = command => spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 30_000, windowsHide: true }).stdout.trim()
  const until = Date.now() + 15_000
  let left = '1'
  while (Date.now() < until && left !== '0') {
    psRun(`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*server.mjs*--demo --port ${port}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`)
    await new Promise(done => setTimeout(done, 400))
    left = psRun(`@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*server.mjs*--demo --port ${port}*' }).Count`)
  }
  assert.equal(left, '0', `nothing of the demo on ${port} is left running`)
}
const stopDemo = async (pid, port) => {
  if (Number.isInteger(pid)) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
  await sweep(port)
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
  // --stop names the board it stops (its port, the demo): a demo keeper of the folder is not the real board's, and the other way round
  // (round 4). The stop sign is the REAL board's alone: a demo's stop writes none (round-4 check: a sign for a demo would hold the watcher
  // off the real board after an app update).
  const sign = join(DATA, 'stop.json')
  const before = existsSync(sign) ? readFileSync(sign, 'utf8') : null
  t.after(() => { if (before === null) rmSync(sign, { force: true }); else writeFileSync(sign, before) })
  rmSync(sign, { force: true })
  const stopped = run('--stop', '--demo', '--port', port)
  assert.equal(stopped.status, 0, stopped.stderr)
  assert.match(stopped.stdout, new RegExp(`^The worker board on port ${port} is stopped \\(keeper .*\\); no stop sign \\(a demo is not this folder's board\\)\\.`))
  assert.equal(existsSync(sign), false, 'a demo\'s stop writes no stop sign')
  assert.deepEqual([isAlive(pid), isAlive(second), await boardAt(port)], [false, false, false], 'keepers and board gone')
  // The real board's --stop (its own port, no keeper running here): the sign, written first and again, with by: 'command'.
  const began = Date.now()
  const real = run('--stop')
  assert.equal(real.status, 0, real.stderr)
  assert.match(real.stdout, /^No board of this folder was running on port \d+; the stop sign is written; the watcher leaves it down until the next start\.$/m)
  const written = JSON.parse(readFileSync(sign, 'utf8'))
  assert.deepEqual([written.why, written.by, written.at >= began], ['stopped', 'command', true])
  // Another port of the folder: no sign either.
  rmSync(sign, { force: true })
  const other = run('--stop', '--port', String(Number(port) + 1))
  assert.match(other.stdout, /no stop sign \(port \d+ is not this folder's board\)/)
  assert.equal(existsSync(sign), false)
})

// F24a (2026-11-14): a slow board is a running board. A made-up board of this folder (a node process with this folder's server.mjs
// path on its command line, as a keeper's child has) holds the port and answers late or never: the script starts nothing and says
// so. Another program on the port: said, nothing started. Windows only for the process parts (the listing is PowerShell's).
const HERE = join(dirname(fileURLToPath(import.meta.url)), '..')
const FAKE = "const http = require('node:http'); const [port, delay] = process.argv.slice(-2); http.createServer((q, r) => setTimeout(() => r.end('<title>Worker board</title>'), Number(delay))).listen(Number(port), '127.0.0.1')"
/** The race's winner: a board that is up after `delay` ms from its start and answers every request at once from then on. */
const RACE_FAKE = "const http = require('node:http'); const [port, delay] = process.argv.slice(-2); const ready = Date.now() + Number(delay); http.createServer((q, r) => setTimeout(() => r.end('<title>Worker board</title>'), Math.max(0, ready - Date.now()))).listen(Number(port), '127.0.0.1')"
/** A made-up board of this folder on `port` that answers after `delayMs`; resolves once it listens. */
async function fakeBoard(t, port, delayMs, script = FAKE) {
  // Its command line is the demo's own board's (this folder's server.mjs, --demo, the port): what start-board.mjs --demo looks for.
  const child = spawn(process.execPath, ['-e', script, join(HERE, 'server.mjs'), '--demo', '--port', String(port), String(port), String(delayMs)], { stdio: 'ignore', windowsHide: true })
  t.after(() => { try { child.kill() } catch {} })
  const until = Date.now() + 5000
  while (Date.now() < until) {
    const open = await new Promise(done => { const s = createConnection({ port: Number(port), host: '127.0.0.1' }); s.once('connect', () => { s.destroy(); done(true) }); s.once('error', () => done(false)) })
    if (open) return child
    await new Promise(done => setTimeout(done, 100))
  }
  throw new Error('the made-up board did not listen')
}

test('F24a: a board that answers in 10 s is a running board: the script waits for it and starts nothing', windows, async t => {
  const port = String(await freePort())
  const fake = await fakeBoard(t, port, 10_000)
  const began = Date.now()
  const said = spawnSync(process.execPath, [SCRIPT, '--demo', '--port', port], { encoding: 'utf8', timeout: 40_000, env: startEnv(process.env) })
  assert.deepEqual([said.status, said.stdout.trim()], [0, `The worker board runs already: http://127.0.0.1:${port}/`], said.stderr)
  assert.ok(Date.now() - began >= 10_000, 'it waited for the answer')
  assert.ok(ANSWER_MS > 10_000)
  // The made-up board still holds the port: nothing else was started on it.
  assert.equal(fake.exitCode, null)
  assert.equal(await boardAt(port, ANSWER_MS), true)
})

test('F24a: a board of this folder that never answers is still a running board (its keeper brings it back): nothing started, the line says why', windows, async t => {
  const port = String(await freePort())
  const fake = await fakeBoard(t, port, 120_000)
  const said = spawnSync(process.execPath, [SCRIPT, '--demo', '--port', port], { encoding: 'utf8', timeout: 40_000, env: startEnv(process.env) })
  assert.equal(said.status, 0, said.stderr)
  assert.match(said.stdout.trim(), new RegExp(`^The worker board runs already: http://127\\.0\\.0\\.1:${port}/ \\((a keeper of this folder runs \\(process ${fake.pid}\\)|process ${fake.pid} of this folder holds the port) but did not answer within 15 seconds: slow or starting; nothing started\\)$`))
  assert.equal(fake.exitCode, null, 'the made-up board was left alone')
  const quiet = spawnSync(process.execPath, [SCRIPT, '--demo', '--port', port, '--quiet'], { encoding: 'utf8', timeout: 40_000, env: startEnv(process.env) })
  assert.deepEqual([quiet.status, quiet.stdout], [0, ''])
})

test('F24a: a listing that fails or takes too long: unknown, nothing started, said with 1 (never a start on a guess)', windows, async t => {
  const port = String(await freePort())
  await fakeBoard(t, port, 120_000)
  // A PATH without PowerShell: the listing cannot start; the holder alone does not decide.
  const said = spawnSync(process.execPath, [SCRIPT, '--demo', '--port', port], { encoding: 'utf8', timeout: 40_000, env: { ...startEnv(process.env), PATH: dirname(process.execPath), Path: dirname(process.execPath) } })
  assert.equal(said.status, 1)
  assert.match(said.stderr.trim(), new RegExp(`^The worker board on http://127\\.0\\.0\\.1:${port}/ did not answer within 15 seconds and the PC's processes could not be listed \\(.+\\): whether this folder's board runs is unknown; nothing started\\.$`))
  assert.equal(said.stdout, '')
})

test('F24, chat 1\'s review: start-board.mjs itself runs at Normal when a chat under Low starts it at Idle (its helpers and the keeper are born from it)', windows, async t => {
  const port = String(await freePort())
  // A board of this folder that answers late holds the script in its 15 s wait: time to read the script's own priority.
  await fakeBoard(t, port, 12_000)
  const mask = ((1n << BigInt(Math.min(64, cpus().length))) - 1n) ^ ((1n << BigInt(Math.min(64, cpus().length) - 2)) - 1n)
  const shell = spawn('cmd.exe', ['/c', 'start', '/LOW', '/AFFINITY', mask.toString(16), '/B', '/WAIT', '""', process.execPath, SCRIPT, '--demo', '--port', port], { windowsHide: true, stdio: 'ignore', env: startEnv(process.env) })
  const ps = command => spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 30_000, windowsHide: true }).stdout.trim()
  // The script (by its command line too), then any demo keeper it may start once the fake board is gone, swept until none is left:
  // nothing of this test lingers (re-check (d): a demo board left running from the gate).
  let script = null
  t.after(async () => {
    shell.kill()
    if (script !== null) spawnSync('taskkill', ['/PID', String(script), '/T', '/F'], { windowsHide: true })
    ps(`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*start-board.mjs*--demo --port ${port}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`)
    const until = Date.now() + 15_000
    let left = '1'
    while (Date.now() < until && left !== '0') {
      // The keeper's line is "server.mjs" --log --demo --port N: the wildcard between takes keeper and board alike.
      ps(`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*server.mjs*--demo --port ${port}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`)
      await new Promise(done => setTimeout(done, 500))
      left = ps(`@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*server.mjs*--demo --port ${port}*' -or $_.CommandLine -like '*start-board.mjs*--demo --port ${port}*' }).Count`)
    }
    assert.equal(left, '0', 'nothing of the test is left running')
  })
  // The script is born at Idle and raises itself once its (small) import graph has loaded: on two crowded cores that takes a moment.
  const until = Date.now() + 10_000
  let state = ''
  const seen = []
  while (Date.now() < until && !/^Normal/.test(state)) {
    state = ps(`$p = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*start-board.mjs" --demo --port ${port}*' -or $_.CommandLine -like '*start-board.mjs --demo --port ${port}*' } | Select-Object -First 1; if ($p) { $g = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue; if ($g) { "$($g.PriorityClass) $($g.ProcessorAffinity) $($p.ProcessId)" } }`)
    if (state !== '' && seen.at(-1) !== state.split(' ').slice(0, 2).join(' ')) seen.push(state.split(' ').slice(0, 2).join(' '))
    if (/^(Normal|Idle)/.test(state)) script = Number(state.split(' ')[2])
    if (!/^Normal/.test(state)) await new Promise(done => setTimeout(done, 300))
  }
  assert.equal(state.split(' ').slice(0, 2).join(' '), `Normal ${mask.toString()}`, `the script raised itself to Normal within 10 s (the cores stay as inherited: the board's CPU job frees those); seen: ${seen.join(' >> ')}`)
})

test('F24, re-check (c): importing start-board.mjs raises nothing (only the script that runs does): a test file under Low stays at Idle', { ...windows, timeout: 60_000 }, async t => {
  const mask = ((1n << BigInt(Math.min(64, cpus().length))) - 1n) ^ ((1n << BigInt(Math.min(64, cpus().length) - 2)) - 1n)
  const file = join(tmpdir(), `imports-start-board-${process.pid}.mjs`)
  writeFileSync(file, `import ${JSON.stringify(new URL('../start-board.mjs', import.meta.url).href)}\nconsole.log(process.pid)\nsetTimeout(() => {}, 20000)\n`)
  t.after(() => rmSync(file, { force: true }))
  const shell = spawn('cmd.exe', ['/c', 'start', '/LOW', '/AFFINITY', mask.toString(16), '/B', '/WAIT', '""', process.execPath, file], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
  let out = ''
  const pid = await new Promise(done => shell.stdout.on('data', chunk => { out += chunk; const found = Number(out.trim().split(/\s+/)[0]); if (found) done(found) }))
  t.after(() => { spawnSync('taskkill', ['/PID', String(pid), '/F'], { windowsHide: true }); shell.kill() })
  const state = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `$g = Get-Process -Id ${pid}; "$($g.PriorityClass) $($g.ProcessorAffinity)"`], { encoding: 'utf8', timeout: 30_000, windowsHide: true }).stdout.trim()
  assert.equal(state, `Idle ${mask.toString()}`, 'the importing process keeps its Idle: the raise is the running script\'s alone')
})

test('F24a: another program on the port is said, and nothing is started on it', windows, async t => {
  const server = createServer((req, res) => res.end('<title>Something else</title>')).listen(0, '127.0.0.1')
  await new Promise(done => server.once('listening', done))
  t.after(() => server.close())
  const port = String(server.address().port)
  const said = spawnSync(process.execPath, [SCRIPT, '--demo', '--port', port], { encoding: 'utf8', timeout: 40_000, env: startEnv(process.env) })
  assert.equal(said.status, 1)
  assert.match(said.stderr.trim(), new RegExp(`^Port ${port} is held by process ${process.pid} \\(.*startBoard\\.test\\.mjs.*\\), not by this folder's board: nothing started\\.$`))
  assert.equal(said.stdout, '')
})

test('F10, re-check item 2: a keeper that loses the port race (another keeper\'s board holds the port and answers seconds later) is no failure: the script waits for the board and ends with 0', windows, async t => {
  const port = String(await freePort())
  // A board of this folder (the demo's own, by its command line) that holds the port and is up after 14 s: the race's winner. The check
  // before the start is skipped by a test hook here (WORKER_BOARD_SKIP_CHECK, this test's alone), as a second keeper's start would be
  // in flight when a chat's start and a landing's restart cross.
  await fakeBoard(t, port, 14_000, RACE_FAKE)
  t.after(() => sweep(port))
  const began = Date.now()
  const said = spawnSync(process.execPath, [SCRIPT, '--demo', '--port', port], { encoding: 'utf8', timeout: 40_000, env: { ...startEnv(process.env), WORKER_BOARD_SKIP_CHECK: '1' } })
  assert.equal(said.status, 0, `${said.stdout} ${said.stderr}`)
  assert.ok(Date.now() - began >= 12_000, 'it waited for the winner\'s board, instead of failing on the keeper\'s early end')
  assert.match(said.stdout, new RegExp(`^The worker board runs already: http://127\\.0\\.0\\.1:${port}/ \\(another keeper won the port; this one, process \\d+, ended\\)`))
})

test('F10, round 5: an early end that is no port race (the child dies before it is up) fails at once with the log\'s words, not after the 20 s wait', windows, async t => {
  const port = String(await freePort())
  t.after(() => sweep(port))
  // The fallback route (the keeper as this script's child) hands the caller's env on; the test hook ends the board at once.
  const began = Date.now()
  const said = spawnSync(process.execPath, [SCRIPT, '--demo', '--port', port], { encoding: 'utf8', timeout: 40_000, env: { ...startEnv(process.env), WORKER_BOARD_START_ROUTE: 'child', WORKER_BOARD_FAIL_START: '1' } })
  assert.equal(said.status, 1, `${said.stdout} ${said.stderr}`)
  assert.ok(Date.now() - began < 12_000, `at once, not after the wait: ${Date.now() - began} ms`)
  assert.match(said.stderr, /WORKER_BOARD_FAIL_START is set|before it was up/)
  assert.doesNotMatch(said.stderr, /did not answer on .* within 20 seconds/)
})

test('F10, round 4: under --anew a lost race IS a failure (the winner is the old board the cold restart kills next): 1 at once, with the log\'s words; the verdict in words', windows, async t => {
  const port = String(await freePort())
  await fakeBoard(t, port, 120_000, RACE_FAKE)
  t.after(() => sweep(port))
  const began = Date.now()
  const said = run('--demo', '--port', port, '--anew')
  assert.equal(said.status, 1, `${said.stdout} ${said.stderr}`)
  assert.ok(Date.now() - began < 15_000, `at once, not after the wait: ${Date.now() - began} ms`)
  assert.match(said.stderr, /is in use|before it was up/)
  assert.deepEqual([earlyEndVerdict({ words: 'Port 4310 is in use: the board may be running already.', isAnew: false }), earlyEndVerdict({ words: 'Port 4310 is in use', isAnew: true }), earlyEndVerdict({ words: 'The board ended with code 1 before it was up', isAnew: false }), earlyEndVerdict({ words: '' })], ['race', 'fail', 'fail', 'fail'])
})
