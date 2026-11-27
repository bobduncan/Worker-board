// S5 of the PC plan (chat 1, 2026-11-26): the fence. A heavy run puts itself on the work cores the board's mode file names
// before its command starts, and everything the command starts is born there, never above the level's priority. The same
// cases are in the game's tests/tools/oneAtATimeFence.test.mjs.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'

import { FENCE_PRIORITY, MODE_STALE_MS, fenceScript, fenceSelf, readMode, runOneAtATime, startAt } from '../tools/one-at-a-time.mjs'

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
/** A mode file as the person's board writes it (S4): its owner is this test's process, its beat now. */
const modeNow = (extra = {}) => ({ level: 'full', masks: { person: '0x00000F', work: '0xFFFFF0', low: '0xC00000' }, threads: { work: 20, low: 2 }, since: 1, who: 'the board page', pid: process.pid, port: 4310, project: 'D:\\boards\\x', beat: Date.now(), ...extra })
const plainEnv = extra => {
  // Never the fence of the run these tests run in (a gate is fenced since S5): its words are cleared here as the launcher clears them.
  const { HEAVY_RUN_HELD: _held, HEAVY_RUN_FIRST: _first, HEAVY_RUN_PRIORITY: _priority, HEAVY_RUN_MASK: _mask, HEAVY_RUN_CORES: _cores, ...plain } = process.env
  return { ...plain, HEAVY_RUN_POLL_MS: '50', HEAVY_RUN_SAY_MS: '200', HEAVY_RUN_SLOTS: '1', ...extra }
}
const PRIORITY_RANK = { Idle: 0, BelowNormal: 1, Normal: 2, AboveNormal: 3, High: 4, RealTime: 5 }

test('S5: the mode file gives the work mask in Full and the low mask in Low; none, broken or empty gives why', () => {
  assert.deepEqual(readMode({ HEAVY_RUN_LOCK: lockWith(modeNow()) }), { level: 'full', mask: 0xFFFFF0n, cores: 20 })
  assert.deepEqual(readMode({ HEAVY_RUN_LOCK: lockWith(modeNow({ level: 'low' })) }), { level: 'low', mask: 0xC00000n, cores: 2 })
  assert.deepEqual(readMode({ HEAVY_RUN_LOCK: lockWith() }), { why: 'no mode file' })
  assert.deepEqual(readMode({ HEAVY_RUN_LOCK: lockWith('{broken') }), { why: 'the mode file cannot be read' })
  assert.deepEqual(readMode({ HEAVY_RUN_LOCK: lockWith(modeNow({ masks: { work: '0x0', low: '0xC00000' } })) }), { why: 'the mode file names no level and mask' })
  assert.deepEqual(readMode({ HEAVY_RUN_LOCK: lockWith(modeNow({ level: 'turbo' })) }), { why: 'the mode file names no level and mask' })
})

test('S5: a board that is gone, or whose beat is old, leaves no level: a crashed board\'s Low never pins later runs', () => {
  const lock = lockWith(modeNow({ level: 'low', pid: 4242 }))
  assert.deepEqual(readMode({ HEAVY_RUN_LOCK: lock }, { alive: () => false }), { why: 'the board that wrote the mode file is gone' })
  assert.equal(readMode({ HEAVY_RUN_LOCK: lock }, { alive: () => true }).level, 'low')
  const old = lockWith(modeNow({ beat: Date.now() - MODE_STALE_MS - 1000 }))
  assert.deepEqual(readMode({ HEAVY_RUN_LOCK: old }), { why: 'the mode file is old (its board beats no more)' })
  // A file without a beat (written before S4's owner and beat) goes by its own age.
  const { beat: _beat, pid: _pid, ...unbeaten } = modeNow()
  const bare = lockWith(unbeaten)
  assert.equal(readMode({ HEAVY_RUN_LOCK: bare }).level, 'full')
  const then = (Date.now() - MODE_STALE_MS - 60_000) / 1000
  utimesSync(`${bare}.mode.json`, then, then)
  assert.deepEqual(readMode({ HEAVY_RUN_LOCK: bare }), { why: 'the mode file is old (its board beats no more)' })
})

test('S5: fenceSelf sets its own pid to the mask and checks the cores took; Full below normal, Low idle', async () => {
  const scripts = []
  const run = async script => { scripts.push(script); return String(0xFFFFF0) }
  const full = await fenceSelf({ env: { HEAVY_RUN_LOCK: lockWith(modeNow()) }, platform: 'win32', pid: 4242, run })
  assert.deepEqual(full, { fenced: true, level: 'full', mask: 0xFFFFF0n, cores: 20, priority: 'BelowNormal' })
  assert.equal(scripts[0], fenceScript(4242, 0xFFFFF0n))
  assert.match(scripts[0], /Get-Process -Id 4242 .*ProcessorAffinity = \[IntPtr\]\[long\]16777200;/)
  const low = await fenceSelf({ env: { HEAVY_RUN_LOCK: lockWith(modeNow({ level: 'low' })) }, platform: 'win32', pid: 7, run: async () => String(0xC00000) })
  assert.deepEqual([low.fenced, low.mask, low.priority], [true, 0xC00000n, 'Idle'])
  assert.deepEqual(FENCE_PRIORITY, { full: 'BelowNormal', low: 'Idle' })
})

test('S5: a run under another never fences again; elsewhere, without a mode file or when the cores do not take, it runs unfenced and says why', async () => {
  let calls = 0
  const run = async () => { calls += 1; return String(0xFFFFF0) }
  const lock = lockWith(modeNow())
  assert.deepEqual(await fenceSelf({ env: { HEAVY_RUN_LOCK: lock, HEAVY_RUN_HELD: '1' }, platform: 'win32', run }), { fenced: false, why: 'inside its run\'s fence' })
  assert.deepEqual(await fenceSelf({ env: { HEAVY_RUN_LOCK: lock }, platform: 'linux', run }), { fenced: false, why: 'not Windows' })
  assert.deepEqual(await fenceSelf({ env: { HEAVY_RUN_LOCK: lockWith() }, platform: 'win32', run }), { fenced: false, why: 'no mode file' })
  assert.equal(calls, 0)
  assert.deepEqual(await fenceSelf({ env: { HEAVY_RUN_LOCK: lock }, platform: 'win32', run: async () => String(0xFFFFFF) }), { fenced: false, why: `the cores did not take (${0xFFFFFF})` })
  assert.match((await fenceSelf({ env: { HEAVY_RUN_LOCK: lock }, platform: 'win32', run: async () => { throw new Error('Access is denied') } })).why, /the fence call failed \(Access is denied\)/)
  // A call that timed out may have set the cores: unknown, not unfenced.
  assert.deepEqual(await fenceSelf({ env: { HEAVY_RUN_LOCK: lock }, platform: 'win32', run: async () => { throw Object.assign(new Error('killed'), { timedOut: true }) } }), { fenced: false, why: 'the fence call did not answer in time (its cores are unknown)' })
})

test('S5: startAt starts the command at the fence\'s priority and gives this process its own back; it never lifts', () => {
  const seen = []
  const system = { constants: { priority: { PRIORITY_BELOW_NORMAL: 10, PRIORITY_LOW: 19 } }, now: 0, getPriority: () => system.now, setPriority: (_pid, p) => { seen.push(p); system.now = p } }
  assert.equal(startAt('Idle', () => system.now, { system, platform: 'win32' }), 19)
  assert.equal(startAt('BelowNormal', () => system.now, { system, platform: 'win32' }), 10)
  assert.deepEqual(seen, [19, 0, 10, 0])
  assert.equal(startAt(null, () => 'started', { system, platform: 'win32' }), 'started')
  assert.equal(startAt('Idle', () => 'started', { system, platform: 'linux' }), 'started')
  // Inside an idle fence a command asked to start below normal stays idle.
  system.now = 19
  assert.equal(startAt('BelowNormal', () => system.now, { system, platform: 'win32' }), 19)
  assert.deepEqual(seen, [19, 0, 10, 0])
})

/** A command that writes the fence it was given (mask, cores, priority) to `file`. */
const writesFence = file => [`"${process.execPath}" -e "require('fs').writeFileSync(process.argv[1], [process.env.HEAVY_RUN_MASK, process.env.HEAVY_RUN_CORES, process.env.HEAVY_RUN_PRIORITY].join(' '))" "${file}"`]

test('S5: the run starts its command at the fence\'s priority, idle in Low and below normal in Full, and passes the fence on', async () => {
  for (const [level, priority, mask] of [['low', 'Idle', 0xC00000n], ['full', 'BelowNormal', 0xFFFFF0n]]) {
    const lock = lockWith()
    const asked = []
    const out = join(scratch, `env-${counter}.txt`)
    const code = await runOneAtATime({
      label: `fence-${level}`, command: writesFence(out), env: plainEnv({ HEAVY_RUN_LOCK: lock }), say: () => {},
      fence: async () => ({ fenced: true, level, mask, cores: 2, priority }),
      startWith: (wanted, start) => { asked.push(wanted); return start() },
    })
    assert.equal(code, 0)
    assert.deepEqual(asked, [priority])
    assert.equal(readFileSync(out, 'utf8'), `0x${mask.toString(16).toUpperCase()} 2 ${priority}`)
    const log = readFileSync(`${lock}.runs.jsonl`, 'utf8').trim().split('\n').map(line => JSON.parse(line)).at(-1)
    assert.equal(log.fence, `${level} 0x${mask.toString(16).toUpperCase()} ${priority}`)
  }
})

test('S5: a stop signal while the fence is being set starts no command and ends with the signal\'s code', async () => {
  const lock = lockWith()
  const signals = new EventEmitter()
  const made = join(scratch, `made-${counter}.txt`)
  let started = 0
  const code = await runOneAtATime({
    label: 'fence-stop', command: writesFence(made), env: plainEnv({ HEAVY_RUN_LOCK: lock }), signals, say: () => {},
    fence: () => new Promise(done => { setTimeout(() => signals.emit('SIGTERM'), 20); setTimeout(() => done({ fenced: false, why: 'slow' }), 200) }),
    startWith: (wanted, start) => { started += 1; return start() },
  })
  assert.equal(code, 128 + 15)
  assert.equal(started, 0)
  assert.equal(existsSync(made), false)
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

/** This process's own cores (the test may itself run inside a fence: the live run takes a part of them, never more). */
const ownMask = () => BigInt.asUintN(64, BigInt(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${process.pid}).ProcessorAffinity.ToInt64()`], { encoding: 'utf8', windowsHide: true }).trim()))

test('S5, live: every process of a fenced run is on the mask and never above the fence\'s priority; the run log says the fence; the code passes through', { skip: process.platform !== 'win32' || cpus().length < 4 }, () => {
  // This process's cores but the lowest one: a part of whatever fence the test itself runs in.
  const own = ownMask()
  const mask = own & (own - 1n)
  const hex = `0x${mask.toString(16).toUpperCase()}`
  const cores = mask.toString(2).replaceAll('0', '').length
  const lock = lockWith(modeNow({ masks: { person: '0x1', work: hex, low: '0xC00000' }, threads: { work: cores, low: 2 } }))
  const probe = join(scratch, `probe-${counter}.cjs`)
  writeFileSync(probe, PROBE)
  const done = spawnSync(process.execPath, [HELPER, 'fence-live', '--', `node "${probe}"`], { env: plainEnv({ HEAVY_RUN_LOCK: lock }), encoding: 'utf8', windowsHide: true, timeout: 90_000 })
  assert.equal(done.status, 3, done.stderr)
  const [head, , ...rows] = done.stdout.trim().split(/\r?\n/)
  assert.equal(head, `MASK ${hex} CORES ${cores}`)
  const tree = rows.map(row => row.split(' ')).map(([pid, name, set, priority]) => ({ pid: Number(pid), name, cores: BigInt.asUintN(64, BigInt(set)), priority }))
  // conhost is made by Windows for the shell's console, not by the shell, so it inherits nothing: a host of a few ms, never load.
  const children = tree.filter(one => one.pid !== done.pid && one.name.toLowerCase() !== 'conhost')
  // The shell, the probe, its grandchild and the listing itself at least.
  assert.ok(children.length >= 4, rows.join('\n'))
  for (const one of children) {
    assert.equal(one.cores, mask, `${one.name} ${one.pid} is on ${one.cores.toString(16)}, not ${hex}`)
    assert.ok(PRIORITY_RANK[one.priority] <= PRIORITY_RANK.BelowNormal, `${one.name} ${one.pid} runs at ${one.priority}, above below normal`)
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

test('S5 fix: a run of its own never passes on a fence it did not set (a fenced gate\'s tests start their own runs)', { skip: process.platform !== 'win32' }, () => {
  const lock = lockWith()
  const outer = { HEAVY_RUN_MASK: '0xFFFFF0', HEAVY_RUN_CORES: '20', HEAVY_RUN_PRIORITY: 'BelowNormal' }
  const say = 'node -e "process.stdout.write([process.env.HEAVY_RUN_MASK, process.env.HEAVY_RUN_CORES, process.env.HEAVY_RUN_PRIORITY].join(\' \'))"'
  const done = spawnSync(process.execPath, [HELPER, 'fence-outer', '--', say], { env: plainEnv({ HEAVY_RUN_LOCK: lock, ...outer }), encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  assert.equal(done.status, 0, done.stderr)
  assert.equal(done.stdout, '  ')
  // A run under another (HEAVY_RUN_HELD) is inside that fence and passes it on.
  const held = spawnSync(process.execPath, [HELPER, 'fence-held', '--', say], { env: plainEnv({ HEAVY_RUN_LOCK: lock, HEAVY_RUN_HELD: '1', ...outer }), encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  assert.equal(held.stdout, '0xFFFFF0 20 BelowNormal')
})
