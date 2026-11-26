// S5 of the PC plan (chat 1, 2026-11-26): the fence. A heavy run puts itself on the work cores the board's mode file names
// before its command starts, and everything the command starts is born there, at the level's priority. The same cases are
// in the game's tests/tools/oneAtATimeFence.test.mjs.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'

import { FENCE_PRIORITY, fenceScript, fenceSelf, readMode, startAt } from '../tools/one-at-a-time.mjs'

const HELPER = fileURLToPath(new URL('../tools/one-at-a-time.mjs', import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'heavy-fence-test-'))
after(() => rmSync(scratch, { recursive: true, force: true }))
let counter = 0

/** A lock in a folder of its own, with the mode file beside it when `mode` is given (a string: written as it is). */
function lockWith(mode) {
  const lock = join(scratch, `fence-${++counter}.lock`)
  if (mode !== undefined) writeFileSync(`${lock}.mode.json`, typeof mode === 'string' ? mode : JSON.stringify(mode))
  return lock
}
const MODE = { level: 'full', masks: { person: '0x00000F', work: '0xFFFFF0', low: '0xC00000' }, threads: { work: 20, low: 2 }, since: 1, who: 'the board page' }
const plainEnv = extra => {
  const { HEAVY_RUN_HELD: _held, HEAVY_RUN_FIRST: _first, ...plain } = process.env
  return { ...plain, HEAVY_RUN_POLL_MS: '50', HEAVY_RUN_SAY_MS: '200', HEAVY_RUN_SLOTS: '1', ...extra }
}

test('S5: the mode file gives the work mask in Full and the low mask in Low; none, broken or empty gives why', () => {
  assert.deepEqual(readMode({ HEAVY_RUN_LOCK: lockWith(MODE) }), { level: 'full', mask: 0xFFFFF0n, cores: 20 })
  assert.deepEqual(readMode({ HEAVY_RUN_LOCK: lockWith({ ...MODE, level: 'low' }) }), { level: 'low', mask: 0xC00000n, cores: 2 })
  assert.deepEqual(readMode({ HEAVY_RUN_LOCK: lockWith() }), { why: 'no mode file' })
  assert.deepEqual(readMode({ HEAVY_RUN_LOCK: lockWith('{broken') }), { why: 'the mode file cannot be read' })
  assert.deepEqual(readMode({ HEAVY_RUN_LOCK: lockWith({ ...MODE, masks: { ...MODE.masks, work: '0x0' } }) }), { why: 'the mode file names no level and mask' })
  assert.deepEqual(readMode({ HEAVY_RUN_LOCK: lockWith({ ...MODE, level: 'turbo' }) }), { why: 'the mode file names no level and mask' })
})

test('S5: fenceSelf sets its own pid to the mask and checks the cores took; Full below normal, Low idle', async () => {
  const scripts = []
  const run = async script => { scripts.push(script); return String(0xFFFFF0) }
  const full = await fenceSelf({ env: { HEAVY_RUN_LOCK: lockWith(MODE) }, platform: 'win32', pid: 4242, run })
  assert.deepEqual(full, { fenced: true, level: 'full', mask: 0xFFFFF0n, cores: 20, priority: 'BelowNormal' })
  assert.equal(scripts[0], fenceScript(4242, 0xFFFFF0n))
  assert.match(scripts[0], /Get-Process -Id 4242 .*ProcessorAffinity = \[IntPtr\]\[long\]16777200;/)
  const low = await fenceSelf({ env: { HEAVY_RUN_LOCK: lockWith({ ...MODE, level: 'low' }) }, platform: 'win32', pid: 7, run: async () => String(0xC00000) })
  assert.deepEqual([low.fenced, low.mask, low.priority], [true, 0xC00000n, 'Idle'])
  assert.deepEqual(FENCE_PRIORITY, { full: 'BelowNormal', low: 'Idle' })
})

test('S5: a run under another never fences again; elsewhere, without a mode file or when the cores do not take, it runs unfenced and says why', async () => {
  let calls = 0
  const run = async () => { calls += 1; return String(0xFFFFF0) }
  const lock = lockWith(MODE)
  assert.deepEqual(await fenceSelf({ env: { HEAVY_RUN_LOCK: lock, HEAVY_RUN_HELD: '1' }, platform: 'win32', run }), { fenced: false, why: 'inside its run\'s fence' })
  assert.deepEqual(await fenceSelf({ env: { HEAVY_RUN_LOCK: lock }, platform: 'linux', run }), { fenced: false, why: 'not Windows' })
  assert.deepEqual(await fenceSelf({ env: { HEAVY_RUN_LOCK: lockWith() }, platform: 'win32', run }), { fenced: false, why: 'no mode file' })
  assert.equal(calls, 0)
  assert.deepEqual(await fenceSelf({ env: { HEAVY_RUN_LOCK: lock }, platform: 'win32', run: async () => String(0xFFFFFF) }), { fenced: false, why: `the cores did not take (${0xFFFFFF})` })
  assert.match((await fenceSelf({ env: { HEAVY_RUN_LOCK: lock }, platform: 'win32', run: async () => { throw new Error('Access is denied') } })).why, /the fence call failed \(Access is denied\)/)
})

test('S5: startAt starts the command at the fence\'s priority and gives this process its own back; none leaves it alone', () => {
  const seen = []
  const system = { constants: { priority: { PRIORITY_BELOW_NORMAL: 10, PRIORITY_LOW: 19 } }, now: 0, getPriority: () => system.now, setPriority: (_pid, p) => { seen.push(p); system.now = p } }
  assert.equal(startAt('Idle', () => system.now, { system, platform: 'win32' }), 19)
  assert.equal(startAt('BelowNormal', () => system.now, { system, platform: 'win32' }), 10)
  assert.deepEqual(seen, [19, 0, 10, 0])
  assert.equal(startAt(null, () => 'started', { system, platform: 'win32' }), 'started')
  assert.equal(startAt('Idle', () => 'started', { system, platform: 'linux' }), 'started')
  assert.deepEqual(seen, [19, 0, 10, 0])
  // It never lifts: inside an idle fence a command asked to start below normal stays idle.
  system.now = 19
  assert.equal(startAt('BelowNormal', () => system.now, { system, platform: 'win32' }), 19)
  assert.deepEqual(seen, [19, 0, 10, 0])
})

/** The probe a fenced run runs: it starts a grandchild, then lists the run's whole tree (pid, name, cores, priority). */
const PROBE = [
  "const { spawn, execFileSync } = require('node:child_process')",
  "const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: 'ignore', windowsHide: true })",
  'const root = Number(process.env.HEAVY_RUN_PID)',
  "const ps = '$all = Get-CimInstance Win32_Process; $ids = @(' + root + '); do { $n = $ids.Count; $ids = @(@($ids) + @($all | Where-Object { $ids -contains $_.ParentProcessId } | ForEach-Object { [int]$_.ProcessId }) | Select-Object -Unique) } while ($ids.Count -gt $n); foreach ($id in $ids) { try { $p = Get-Process -Id $id -ErrorAction Stop; [Console]::Out.WriteLine([string]$id + \" \" + $p.ProcessName + \" \" + $p.ProcessorAffinity.ToInt64() + \" \" + $p.PriorityClass) } catch {} }'",
  "const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true })",
  'sleeper.kill()',
  "process.stdout.write('MASK ' + process.env.HEAVY_RUN_MASK + ' CORES ' + process.env.HEAVY_RUN_CORES + '\\nTREE\\n' + out)",
  'process.exitCode = 3',
].join('\n')

test('S5, live: every process of a fenced run is on the mask at below normal, the run log says the fence, and the code passes through', { skip: process.platform !== 'win32' || cpus().length < 4 }, () => {
  // All logical processors but the first: a mask every PC with 4 or more has.
  const count = Math.min(64, cpus().length)
  const mask = ((1n << BigInt(count)) - 1n) & ~1n
  const hex = `0x${mask.toString(16).toUpperCase()}`
  const lock = lockWith({ ...MODE, masks: { ...MODE.masks, work: hex }, threads: { work: count - 1, low: 2 } })
  const probe = join(scratch, `probe-${counter}.cjs`)
  writeFileSync(probe, PROBE)
  const done = spawnSync(process.execPath, [HELPER, 'fence-live', '--', `node "${probe}"`], { env: plainEnv({ HEAVY_RUN_LOCK: lock }), encoding: 'utf8', windowsHide: true, timeout: 90_000 })
  assert.equal(done.status, 3, done.stderr)
  const [head, , ...rows] = done.stdout.trim().split(/\r?\n/)
  assert.equal(head, `MASK ${hex} CORES ${count - 1}`)
  const tree = rows.map(row => row.split(' ')).map(([pid, name, cores, priority]) => ({ pid: Number(pid), name, cores: BigInt(cores), priority }))
  // conhost is made by Windows for the shell's console, not by the shell, so it inherits nothing: a host of a few ms, never load.
  const children = tree.filter(one => one.pid !== done.pid && one.name.toLowerCase() !== 'conhost')
  // The shell, the probe, its grandchild and the listing itself at least.
  assert.ok(children.length >= 4, rows.join('\n'))
  for (const one of children) {
    assert.equal(one.cores, mask, `${one.name} ${one.pid} is on ${one.cores.toString(16)}, not ${hex}`)
    assert.equal(one.priority, 'BelowNormal', `${one.name} ${one.pid} runs at ${one.priority}`)
  }
  const log = readFileSync(`${lock}.runs.jsonl`, 'utf8').trim().split('\n').map(line => JSON.parse(line)).at(-1)
  assert.deepEqual([log.label, log.exit, log.fence], ['fence-live', 3, `full ${hex} BelowNormal`])
})

test('S5, live: without a mode file the run says it runs unfenced and goes as before', { skip: process.platform !== 'win32' }, () => {
  const lock = lockWith()
  const done = spawnSync(process.execPath, [HELPER, 'fence-none', '--', 'node -e "process.stdout.write(String(process.env.HEAVY_RUN_MASK))"'], { env: plainEnv({ HEAVY_RUN_LOCK: lock }), encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  assert.equal(done.status, 0, done.stderr)
  assert.equal(done.stdout, 'undefined')
  assert.match(done.stderr, /one-at-a-time: fence-none runs unfenced: no mode file/)
  const log = readFileSync(`${lock}.runs.jsonl`, 'utf8').trim().split('\n').map(line => JSON.parse(line)).at(-1)
  assert.equal(log.fence, 'unfenced: no mode file')
})
