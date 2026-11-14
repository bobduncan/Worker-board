// F24b (2026-11-14, chat 1's diagnosis): a chat's mod (re)started the main board and Windows handed the chat's CPU "Low" on to it:
// Idle priority on two crowded cores, so the board's thread got no CPU (the page in 8-11 s). The keeper and the board take Normal back
// as their first act (server.mjs, os.setPriority), start-board.mjs too, and the CPU job gives the board's own processes all cores back
// before it lists anything (src/cpu.mjs once(); the ORDER is tested with a fake in test/cpu.test.mjs, where the mutant, the old order,
// fails). Here the real cases, each able to fail (chat 1's review of F24b, items 4 and 6): the start line is proven to start at Idle on
// two cores by a probe; a demo board (no CPU job) ends at Normal while its affinity is still the two cores (fails without server.mjs's
// raise); a copy of the board at Full (never a Low CPU job against this PC: it would throttle every codex, vite and headless Edge here,
// item 3) ends at Normal on all cores. Every node.exe running the copy's server.mjs is killed after, whatever stdout said.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { cpus, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { removeDir } from './tempDir.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures', 'mods']
const windows = { skip: process.platform !== 'win32' ? 'Windows only' : cpus().length < 4 ? 'fewer than four cores' : false, timeout: 180_000 }
const CORES = Math.min(64, cpus().length)
const ALL = (1n << BigInt(CORES)) - 1n
/** The last two cores, as CPU Low pins the chats (and what they start). */
const LAST_TWO = ALL ^ ((1n << BigInt(CORES - 2)) - 1n)

const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})
const ps = command => spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 30_000, windowsHide: true }).stdout.trim()
/** `"<pid> <PriorityClass> <ProcessorAffinity>"` per pid, or `"<pid> gone"`. */
const stateOf = pids => ps(`foreach ($id in @(${pids.join(',')})) { try { $p = Get-Process -Id $id -ErrorAction Stop; Write-Output "$($p.Id) $($p.PriorityClass) $($p.ProcessorAffinity)" } catch { Write-Output "$id gone" } }`).split(/\r?\n/)
/** Runs `program args` as a chat under Low would start it: Idle priority, the last two cores; the words it printed. */
const startLow = (args, options = {}) => spawnSync('cmd.exe', ['/c', 'start', '/LOW', '/AFFINITY', LAST_TWO.toString(16), '/B', '/WAIT', '""', process.execPath, ...args], { encoding: 'utf8', timeout: 90_000, windowsHide: true, ...options })
/** Kills every node.exe whose command line runs `script` (a temp copy's server.mjs, or a demo keeper), whatever stdout said. */
const inLike = text => text.replace(/'/g, "''").replace(/[[\]]/g, '[$&]')
const killRunning = script => ps(`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*${inLike(script)}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`)
/** How many node.exe processes still run `script`. */
const stillRunning = script => ps(`@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*${inLike(script)}*' }).Count`)
/**
 * The keeper's board: its child that runs `script` (the command line, not the parent alone: Windows gives a dead process's pid out again
 * within seconds, and an orphan of the old process would then count as the keeper's child; seen with a lingering probe, 2026-11-14).
 */
const childOf = (keeper, script) => Number(ps(`(Get-CimInstance Win32_Process -Filter "ParentProcessId=${keeper}" | Where-Object { $_.CommandLine -like '*${inLike(script)}*' } | Select-Object -First 1).ProcessId`))

/** Until `pids` all read as `want` ("Normal <mask>"), at most 60 s; what was last seen. */
async function untilState(pids, want) {
  const until = Date.now() + 60_000
  const history = []
  let seen = []
  while (Date.now() < until) {
    seen = stateOf(pids)
    if (history.at(-1) !== seen.join(' | ')) history.push(seen.join(' | '))
    if (seen.length === pids.length && seen.every(line => line.endsWith(` ${want}`))) return seen
    if (seen.every(line => line.endsWith(' gone'))) break
    await new Promise(done => setTimeout(done, 1000))
  }
  // What was seen over time, for the failure's message.
  seen.history = history
  return seen
}

test('the start line starts a process at Idle on the last two cores (the probe: what the tests below start from)', windows, () => {
  const probe = startLow(['-e', 'console.log(process.pid); setTimeout(() => {}, 15000)'], { timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] })
  // start /WAIT waited for the probe to end: read what it was while it ran, through its own words.
  assert.match(probe.stdout, /^\d+/, probe.stderr)
})

// The probe above ends before it can be read from outside; this one is read while it runs.
test('the probe, read while it runs: Idle, the two-core mask', windows, async t => {
  const { spawn } = await import('node:child_process')
  const shell = spawn('cmd.exe', ['/c', 'start', '/LOW', '/AFFINITY', LAST_TWO.toString(16), '/B', '/WAIT', '""', process.execPath, '-e', 'console.log(process.pid); setTimeout(() => {}, 20000)'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
  let out = ''
  const pid = await new Promise(done => shell.stdout.on('data', chunk => { out += chunk; const found = Number(out.trim().split(/\s+/)[0]); if (found) done(found) }))
  t.after(async () => {
    shell.kill()
    ps(`Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`)
    const until = Date.now() + 5000
    while (Date.now() < until && stateOf([pid])[0] !== `${pid} gone`) await new Promise(done => setTimeout(done, 200))
  })
  assert.deepEqual(stateOf([pid]), [`${pid} Idle ${LAST_TWO.toString()}`], 'the start line applies Idle and the two-core mask')
})

test('F24b, server.mjs alone: a demo board (no CPU job) started at Idle on two cores runs its keeper and board at Normal while their affinity is still the two cores (fails without the raise in server.mjs)', windows, async t => {
  const port = await freePort()
  t.after(() => killRunning(`server.mjs --demo --port ${port}`))
  const started = startLow([join(ROOT, 'start-board.mjs'), '--demo', '--port', String(port)], { cwd: ROOT })
  const keeper = Number(started.stdout.match(/process (\d+)/)?.[1])
  assert.ok(Number.isInteger(keeper), `${started.stdout} ${started.stderr}`)
  const board = childOf(keeper, `server.mjs --demo --port ${port}`)
  assert.ok(Number.isInteger(board) && board > 0, 'the keeper has its board')
  const seen = await untilState([keeper, board], `Normal ${LAST_TWO.toString()}`)
  assert.deepEqual([...seen], [`${keeper} Normal ${LAST_TWO.toString()}`, `${board} Normal ${LAST_TWO.toString()}`], `Normal at once, the cores as inherited (no CPU job in a demo); saw over time: ${(seen.history ?? seen).join(' >> ')}`)
})

test('F24b, server.mjs alone, directly: the demo keeper started with start /LOW /AFFINITY (no start-board.mjs) and its board read Normal while their affinity is still the two cores (fails without the raise in server.mjs)', windows, async t => {
  const { spawn } = await import('node:child_process')
  const port = await freePort()
  const script = `server.mjs --demo --port ${port}`
  t.after(async () => {
    const until = Date.now() + 15_000
    do {
      killRunning(script)
      await new Promise(done => setTimeout(done, 500))
    } while (Date.now() < until && stillRunning(script) !== '0')
    assert.equal(stillRunning(script), '0')
  })
  // The keeper itself at Idle on the two cores, as a chat under Low would spawn it; it runs on (no /WAIT), its board under it.
  const shell = spawn('cmd.exe', ['/c', 'start', '/LOW', '/AFFINITY', LAST_TWO.toString(16), '/B', '""', process.execPath, join(ROOT, 'server.mjs'), '--demo', '--port', String(port)], { cwd: ROOT, windowsHide: true, stdio: 'ignore' })
  t.after(() => shell.kill())
  const until = Date.now() + 30_000
  let pids = []
  while (Date.now() < until && pids.length < 2) {
    pids = ps(`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*${inLike(script)}*' } | ForEach-Object { $_.ProcessId }`).split(/\r?\n/).filter(Boolean).map(Number)
    if (pids.length < 2) await new Promise(done => setTimeout(done, 500))
  }
  assert.equal(pids.length, 2, `keeper and board: ${pids}`)
  const seen = await untilState(pids, `Normal ${LAST_TWO.toString()}`)
  assert.deepEqual([...seen].sort(), pids.map(pid => `${pid} Normal ${LAST_TWO.toString()}`).sort(), `Normal at once, the cores as inherited; saw over time: ${(seen.history ?? seen).join(' >> ')}`)
})

test('F24b, the CPU job: a copy of the board at Full started at Idle on two cores runs its keeper and board at Normal on all cores', windows, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-idle-'))
  const board = join(dir, 'kiwi-board')
  t.after(async () => {
    // Every process of the copy, then the folder once they have let go of it.
    const script = join(board, 'server.mjs')
    const until = Date.now() + 15_000
    do {
      killRunning(script)
      await new Promise(done => setTimeout(done, 500))
    } while (Date.now() < until && stillRunning(script) !== '0')
    assert.equal(stillRunning(script), '0', 'every process of the copy is gone')
    for (let tries = 0; tries < 10; tries++) {
      try {
        await removeDir(dir)
        return
      } catch {
        await new Promise(done => setTimeout(done, 1000))
      }
    }
    await removeDir(dir)
  })
  const [project, empty] = [join(dir, 'kiwi'), join(dir, 'kiwi-app')]
  for (const part of COPIED) await cp(join(ROOT, part), join(board, part), { recursive: true })
  for (const one of [join(project, '.claude'), empty, join(board, 'data')]) await mkdir(one, { recursive: true })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({
    name: 'kiwi', project, port, gamePort: 7300, gameRepo: '', appSessions: empty, transcripts: empty, usageHistory: join(empty, 'none.json'),
  }))
  // Full, never Low: a Low CPU job of the copy would throttle every codex, vite and headless Edge on this PC.
  await writeFile(join(board, 'data', 'cpu.json'), JSON.stringify({ level: 'full', at: Date.now() }))
  const started = startLow([join(board, 'start-board.mjs'), '--port', String(port)], { cwd: board, env: { ...process.env, WORKER_BOARD_HOME: join(dir, 'pc') } })
  const keeper = Number(started.stdout.match(/process (\d+)/)?.[1])
  assert.ok(Number.isInteger(keeper), `${started.stdout} ${started.stderr}`)
  const child = childOf(keeper, join(board, 'server.mjs'))
  assert.ok(Number.isInteger(child) && child > 0, 'the keeper has its board')
  const seen = await untilState([keeper, child], `Normal ${ALL.toString()}`)
  assert.deepEqual(seen, [`${keeper} Normal ${ALL.toString()}`, `${child} Normal ${ALL.toString()}`], `keeper and board at Normal on all ${CORES} cores; saw: ${seen.join(' | ')}`)
})
