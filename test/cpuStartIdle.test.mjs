// F24b (2026-11-14, chat 1's diagnosis): a chat's mod (re)started the main board and Windows handed the chat's CPU "Low" on to it:
// Idle priority on two crowded cores, so the board's thread got no CPU (the page in 8-11 s). The keeper and the board take Normal back
// as their first act (server.mjs, os.setPriority), and the CPU job gives the board's own processes all cores back before it lists
// anything (src/cpu.mjs once(); the order is tested with a fake in test/cpu.test.mjs, where the mutant, the old order, fails). Here
// the real case: a copy of the board started by `start /LOW /AFFINITY <two cores>` runs its keeper and board at Normal on all cores.

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

const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})
const ps = command => spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 30_000, windowsHide: true }).stdout.trim()
/** `"<pid> <PriorityClass> <ProcessorAffinity>"` per pid, or '' for one that is gone. */
const stateOf = pids => ps(`foreach ($id in @(${pids.join(',')})) { try { $p = Get-Process -Id $id -ErrorAction Stop; Write-Output "$($p.Id) $($p.PriorityClass) $($p.ProcessorAffinity)" } catch { Write-Output "$id gone" } }`).split(/\r?\n/)

test('F24b: a board started at Idle on two cores (as a chat under Low would start it) runs its keeper and board at Normal on all cores', windows, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-idle-'))
  let keeper = null
  t.after(async () => {
    if (keeper !== null) spawnSync('taskkill', ['/PID', String(keeper), '/T', '/F'], { windowsHide: true })
    await new Promise(done => setTimeout(done, 1000))
    await removeDir(dir)
  })
  const [board, project, empty] = [join(dir, 'kiwi-board'), join(dir, 'kiwi'), join(dir, 'kiwi-app')]
  for (const part of COPIED) await cp(join(ROOT, part), join(board, part), { recursive: true })
  for (const one of [join(project, '.claude'), empty, join(board, 'data')]) await mkdir(one, { recursive: true })
  const port = await freePort()
  await writeFile(join(board, 'config.json'), JSON.stringify({
    name: 'kiwi', project, port, gamePort: 7300, gameRepo: '', appSessions: empty, transcripts: empty, usageHistory: join(empty, 'none.json'),
  }))
  // The board's own level is Low: the path a chat's inherited Low makes worse.
  await writeFile(join(board, 'data', 'cpu.json'), JSON.stringify({ level: 'low', at: Date.now() }))
  const cores = Math.min(64, cpus().length)
  const all = ((1n << BigInt(cores)) - 1n)
  const lastTwo = all ^ ((1n << BigInt(cores - 2)) - 1n)
  // As the chat's mod starts it under Low: Idle priority, the last two cores; the keeper and board inherit both.
  const started = spawnSync('cmd.exe', ['/c', 'start', '/LOW', '/AFFINITY', lastTwo.toString(16), '/B', '/WAIT', '""', process.execPath, join(board, 'start-board.mjs'), '--port', String(port)], {
    cwd: board, encoding: 'utf8', timeout: 90_000, windowsHide: true, env: { ...process.env, WORKER_BOARD_HOME: join(dir, 'pc') },
  })
  keeper = Number(started.stdout.match(/process (\d+)/)?.[1])
  assert.ok(Number.isInteger(keeper), `${started.stdout} ${started.stderr}`)
  const child = () => Number(ps(`(Get-CimInstance Win32_Process -Filter "ParentProcessId=${keeper}" | Select-Object -First 1).ProcessId`))
  const until = Date.now() + 60_000
  let seen = []
  while (Date.now() < until) {
    const boardPid = child()
    seen = Number.isInteger(boardPid) && boardPid > 0 ? stateOf([keeper, boardPid]) : [`keeper ${keeper}, no child yet`]
    if (seen.length === 2 && seen.every(line => line.endsWith(` Normal ${all.toString()}`))) break
    await new Promise(done => setTimeout(done, 1000))
  }
  assert.ok(seen.length === 2 && seen.every(line => line.endsWith(` Normal ${all.toString()}`)), `keeper and board at Normal on all ${cores} cores; saw: ${seen.join(' | ')}`)
})
