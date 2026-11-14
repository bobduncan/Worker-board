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
import { rmSync, writeFileSync } from 'node:fs'

import { ANSWER_MS, boardAt } from '../start-board.mjs'
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

// F24a (2026-11-14): a slow board is a running board. A made-up board of this folder (a node process with this folder's server.mjs
// path on its command line, as a keeper's child has) holds the port and answers late or never: the script starts nothing and says
// so. Another program on the port: said, nothing started. Windows only for the process parts (the listing is PowerShell's).
const HERE = join(dirname(fileURLToPath(import.meta.url)), '..')
const windows = { skip: process.platform !== 'win32' ? 'Windows only' : false }
const FAKE = "const http = require('node:http'); const [port, delay] = process.argv.slice(-2); http.createServer((q, r) => setTimeout(() => r.end('<title>Worker board</title>'), Number(delay))).listen(Number(port), '127.0.0.1')"
/** A made-up board of this folder on `port` that answers after `delayMs`; resolves once it listens. */
async function fakeBoard(t, port, delayMs) {
  // Its command line is the demo's own board's (this folder's server.mjs, --demo, the port): what start-board.mjs --demo looks for.
  const child = spawn(process.execPath, ['-e', FAKE, join(HERE, 'server.mjs'), '--demo', '--port', String(port), String(port), String(delayMs)], { stdio: 'ignore', windowsHide: true })
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
      ps(`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*server.mjs --demo --port ${port}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`)
      await new Promise(done => setTimeout(done, 500))
      left = ps(`@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*server.mjs --demo --port ${port}*' -or $_.CommandLine -like '*start-board.mjs*--demo --port ${port}*' }).Count`)
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
