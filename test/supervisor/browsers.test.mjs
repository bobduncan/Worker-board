// Leaked headless browsers (2026-11-13): the rule `browsers` finds, from one listing of the PC's processes, every headless
// Edge main process in the temp folder whose starter is gone and that ran over half an hour or whose tree used over two
// cores for five minutes in a row, and the board closes it once (each process while its creation time holds), removes the
// tool's own folder and nothing else, never while a live process is connected to its DevTools port or a landing runs. The
// real case: a worker's scratch CDP helper on a fixed port left an Edge from 07:42 rendering the game on 13 of 24 cores.
// Made-up listings shaped like the real one (ThreadCount, the command lines); the Windows calls are fakes.

import assert from 'node:assert/strict'
import test from 'node:test'

import { BUSY_CORES, BUSY_MS, LEAKED_AFTER_MS, browserKey, browserMemory, closeLeaked, devtoolsPortNow, devtoolsPortOf, fileTimeMs, isBusy, isHeadlessMain, isInTemp, inUseNow, killVerified, leakedWords, prefixOf, profileOf, toolFolderOf, watchBrowsers } from '../../src/supervisor/browsers.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 13, 21, 0).getTime()
const FILETIME = ms => (ms + 11_644_473_600_000) * 10_000
const TEMP = 'C:\\Users\\p\\AppData\\Local\\Temp'
const proc = (pid, parent, name, minutesAgo, more = {}) => ({ pid, parent, name, priority: 8, threads: 20, cpuMs: 0, created: FILETIME(NOW - minutesAgo * MIN), commandLine: null, ...more })
const cdp = `"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --headless=new --use-angle=swiftshader --remote-debugging-port=9391 --user-data-dir=${TEMP}\\edge-cdp-b1126-k3Xp9q http://127.0.0.1:5173/`
const evidence = `"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --headless=new --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check --user-data-dir="${TEMP}\\board-evidence-GYJKCI\\profile" --remote-debugging-port=0 --edge-skip-compat-layer-relaunch about:blank`
const scratch = `msedge.exe --headless=new --remote-debugging-port=9222 --user-data-dir=${TEMP}\\claude\\lava\\0dd2a510\\scratchpad\\edge-profile`
const options = { now: NOW, temp: TEMP, platform: 'win32' }
const watch = (list, memory = browserMemory(), more = {}) => watchBrowsers(list, memory, { ...options, ...more })

test('a headless or remote-driven Edge main process is one; the person\'s own Edge and Edge\'s children are not', () => {
  assert.equal(isHeadlessMain(proc(5, 1, 'msedge.exe', 1, { commandLine: cdp })), true)
  assert.equal(isHeadlessMain(proc(5, 1, 'msedge.exe', 1, { commandLine: evidence })), true)
  assert.equal(isHeadlessMain(proc(5, 1, 'MSEDGE.EXE', 1, { commandLine: 'msedge.exe --headless --user-data-dir=C:\\t\\lava-shot-4321-Xy12ab' })), true)
  // The person's Edge: neither flag. A child of a headless Edge: --type=. Another program with the flags: no.
  assert.equal(isHeadlessMain(proc(5, 1, 'msedge.exe', 1, { commandLine: 'msedge.exe --profile-directory=Default --flag-switches-begin' })), false)
  assert.equal(isHeadlessMain(proc(5, 1, 'msedge.exe', 1, { commandLine: 'msedge.exe --type=gpu-process --headless=new' })), false)
  assert.equal(isHeadlessMain(proc(5, 1, 'chrome.exe', 1, { commandLine: 'chrome.exe --headless' })), false)
  assert.equal(isHeadlessMain(proc(5, 1, 'msedge.exe', 1)), false)
})

test('the profile (the last --user-data-dir, as Chromium reads it), the DevTools port, the prefix, and the tool\'s own folder: a scratchpad profile is nobody\'s to remove', () => {
  assert.equal(profileOf(cdp), `${TEMP}\\edge-cdp-b1126-k3Xp9q`)
  assert.equal(profileOf(evidence), `${TEMP}\\board-evidence-GYJKCI\\profile`)
  assert.equal(profileOf('msedge.exe "--user-data-dir=C:\\My Temp\\lava-shot-4321-Xy12ab" --headless'), 'C:\\My Temp\\lava-shot-4321-Xy12ab')
  assert.equal(profileOf('msedge.exe --user-data-dir=C:\\first --headless --user-data-dir=C:\\last'), 'C:\\last', 'the last one counts (chat 1\'s review, 11)')
  assert.equal(profileOf('msedge.exe --headless'), null)
  assert.equal(devtoolsPortOf(cdp), 9391)
  assert.equal(devtoolsPortOf(evidence), null, 'port 0: the browser picks one')
  assert.equal(devtoolsPortOf('msedge.exe --headless'), null)
  assert.equal(prefixOf(`${TEMP}\\edge-cdp-b1126-k3Xp9q`), 'edge-cdp-b1126')
  assert.equal(prefixOf('C:\\t\\board-evidence-Ab12Cd'), 'board-evidence')
  assert.equal(prefixOf('C:\\t\\board-evidence-GYJKCI'), 'board-evidence', 'the real tail of 2026-11-13 21:10, capitals alone')
  assert.equal(prefixOf('C:\\t\\board-evidence-AbCdEf'), 'board-evidence', 'a random tail of letters alone, by its capitals')
  assert.equal(prefixOf('C:\\t\\game-shots-weekly-Ab12Cd'), 'game-shots-weekly', 'a word is no tail')
  assert.equal(prefixOf('C:\\t\\lava-shot-4321-Xy12ab\\'), 'lava-shot')
  assert.equal(prefixOf('/tmp/lava-shot-4321-Xy12ab'), 'lava-shot')
  assert.equal(prefixOf(`${TEMP}\\claude\\lava\\0dd2a510\\scratchpad\\edge-profile`), 'edge-profile')
  assert.equal(prefixOf(null), 'no profile')
  // The temp folder: inside it, whatever the case and the depth; the folder itself, or one beside it, is not.
  assert.equal(isInTemp(`${TEMP}\\edge-cdp-b1126-k3Xp9q`, TEMP, 'win32'), true)
  assert.equal(isInTemp(`${TEMP.toLowerCase()}\\claude\\x\\scratchpad\\p`, TEMP, 'win32'), true)
  assert.equal(isInTemp(TEMP, TEMP, 'win32'), false)
  assert.equal(isInTemp('C:\\Users\\p\\AppData\\Local\\Temporary\\x', TEMP, 'win32'), false)
  assert.equal(isInTemp(null, TEMP, 'win32'), false)
  // Guard 1 (chat 1's review, blocker 1): the folder the board may remove is the TOOL's own, right below the temp folder: the CDP helper's
  // or the game's profile itself, the evidence tool's folder that holds its `profile`; a scratchpad profile (%TEMP%\\claude\\...), a profile
  // elsewhere, a folder of another name, or the temp folder's child that is not a known tool's: never (the mutant "the first folder below
  // %TEMP%" would have removed %TEMP%\\claude, every chat's scratchpad).
  assert.equal(toolFolderOf(`${TEMP}\\edge-cdp-b1126-k3Xp9q`, TEMP, 'win32'), `${TEMP}\\edge-cdp-b1126-k3Xp9q`)
  assert.equal(toolFolderOf(`${TEMP}\\lava-shot-4321-Xy12ab`, TEMP, 'win32'), `${TEMP}\\lava-shot-4321-Xy12ab`)
  assert.equal(toolFolderOf(`${TEMP}\\board-evidence-GYJKCI\\profile`, TEMP, 'win32'), `${TEMP}\\board-evidence-GYJKCI`)
  assert.equal(toolFolderOf(`${TEMP}\\board-evidence-GYJKCI`, TEMP, 'win32'), null, 'the evidence folder is removed for its profile alone')
  assert.equal(toolFolderOf(`${TEMP}\\claude\\lava\\0dd2a510\\scratchpad\\edge-profile`, TEMP, 'win32'), null)
  assert.equal(toolFolderOf(`${TEMP}\\claude`, TEMP, 'win32'), null)
  assert.equal(toolFolderOf(`${TEMP}\\edge-cdp-b1126-k3Xp9q\\Default`, TEMP, 'win32'), null)
  assert.equal(toolFolderOf('D:\\keep\\lava-shot-77-Qq12ab', TEMP, 'win32'), null)
  assert.equal(toolFolderOf(TEMP, TEMP, 'win32'), null)
  assert.equal(toolFolderOf(null, TEMP, 'win32'), null)
  assert.equal(fileTimeMs(FILETIME(NOW)), NOW)
  assert.equal(fileTimeMs(null), null)
})

test('leaked: a headless main in the temp folder, over one thread, starter gone, over 30 min old; every exclusion on a listing shaped like the real one; the tree\'s CPU', () => {
  const started = NOW - 800 * MIN
  const list = [
    proc(499, 1, 'node.exe', 900, { commandLine: 'node logs/b1126-cdp.mjs' }),
    // The leaked one: its parent 7000 is gone (not listed). Its rendering sits in its children (the gpu process and a renderer); one child's
    // parent number is too old to be its child (a reused number).
    proc(500, 7000, 'msedge.exe', 800, { commandLine: cdp, cpuMs: 800 * MIN * 0.2 }),
    proc(501, 500, 'msedge.exe', 799, { threads: 12, commandLine: 'msedge.exe --type=gpu-process', cpuMs: 800 * MIN * 10.1 }),
    proc(502, 501, 'msedge.exe', 798, { threads: 5, commandLine: 'msedge.exe --type=renderer', cpuMs: 800 * MIN * 2.5 }),
    proc(503, 500, 'msedge.exe', 900, { threads: 5, commandLine: 'msedge.exe --type=utility', cpuMs: 800 * MIN * 50 }),
    // The evidence tool's Edge whose starter (499) still runs: nothing, however old.
    proc(600, 499, 'msedge.exe', 90, { commandLine: evidence }),
    // The person's own Edge, parent gone: never.
    proc(700, 7001, 'msedge.exe', 800, { commandLine: 'msedge.exe --profile-directory=Default' }),
    // A 1-thread zombie of a killed headless Edge: not alive.
    proc(800, 7002, 'msedge.exe', 800, { threads: 1, commandLine: cdp }),
    // Starter gone, but started 29 minutes ago and quiet: not yet.
    proc(900, 7003, 'msedge.exe', 29, { commandLine: `msedge.exe --headless --user-data-dir=${TEMP}\\lava-shot-4321-Xy12ab` }),
    // Starter "alive" by number only: the parent listed was created AFTER the child (the number given out again): gone. A scratchpad
    // profile: closed when leaked, its folder never removed.
    proc(1000, 1001, 'msedge.exe', 60, { commandLine: scratch, cpuMs: 60 * MIN * 0.3 }),
    proc(1001, 1, 'cmd.exe', 10),
    // Guard 1: a headless Edge with a profile OUTSIDE the temp folder (somebody's own), starter gone, however old: never touched.
    proc(1100, 7004, 'msedge.exe', 800, { commandLine: 'msedge.exe --headless=new --remote-debugging-port=9222 --user-data-dir=D:\\own\\profile' }),
    // Guard 1: a remote-driven Edge with a USER profile, starter gone: never touched.
    proc(1200, 7005, 'msedge.exe', 800, { commandLine: 'msedge.exe --remote-debugging-port=9222 --user-data-dir=C:\\Users\\p\\AppData\\Local\\Microsoft\\Edge\\User Data' }),
  ]
  const found = watch(list)
  assert.deepEqual(found, [
    { pid: 500, created: list[1].created, key: browserKey(list[1]), profile: `${TEMP}\\edge-cdp-b1126-k3Xp9q`, port: 9391, folder: `${TEMP}\\edge-cdp-b1126-k3Xp9q`, prefix: 'edge-cdp-b1126', startedAt: started, children: [{ pid: 501, created: list[2].created }, { pid: 502, created: list[3].created }], cores: 12.8, why: 'ran over 30 min', closedAt: null, closeOk: null },
    { pid: 1000, created: list[9].created, key: browserKey(list[9]), profile: `${TEMP}\\claude\\lava\\0dd2a510\\scratchpad\\edge-profile`, port: 9222, folder: null, prefix: 'edge-profile', startedAt: NOW - 60 * MIN, children: [], cores: 0.3, why: 'ran over 30 min', closedAt: null, closeOk: null },
  ])
  // The mutants: counted at 30 minutes (not 29); a zombie counted alive; a starter that runs read as gone (then the evidence tool's Edge, by its folder).
  assert.equal(LEAKED_AFTER_MS, 30 * MIN)
  assert.deepEqual(watch(list, browserMemory(), { now: NOW + MIN }).map(one => one.pid), [500, 900, 1000])
  assert.deepEqual(watch(list.map(one => (one.pid === 800 ? { ...one, threads: 2 } : one))).map(one => one.pid), [500, 800, 1000])
  const orphaned = watch(list.filter(one => one.pid !== 499))
  assert.deepEqual(orphaned.map(one => one.pid), [500, 600, 1000])
  // The real case of 2026-11-13 21:09: the evidence tool's Edge, its profile `board-evidence-<tail>\\profile`: the prefix and the folder are the tool's; port 0 is read from its profile later.
  assert.deepEqual([orphaned[1].prefix, orphaned[1].folder, orphaned[1].port], ['board-evidence', `${TEMP}\\board-evidence-GYJKCI`, null])
  // A listing without threads (an older board's script) counts nothing alive: nothing is closed on a guess.
  assert.deepEqual(watch(list.map(one => ({ ...one, threads: null }))), [])
  assert.equal(leakedWords(found[0], NOW), 'edge-cdp-b1126: a headless Edge (process 500, started 07:40, 13 h 20, 12.8 cores) with its starter gone, ran over 30 min')
  assert.equal(leakedWords({ ...found[1], cores: null }, NOW), 'edge-profile: a headless Edge (process 1000, started 20:00, 1 h 00, CPU unknown) with its starter gone, ran over 30 min')
})

test('guard 2: under 30 minutes, a browser is leaked once its TREE used over 2 cores for 5 minutes in a row (the third sample at 3-minute steps); the samples live in the loop\'s memory and go with the process', () => {
  assert.equal(BUSY_CORES, 2)
  assert.equal(BUSY_MS, 5 * MIN)
  const sample = (minutesAgo, cpuMs) => ({ at: NOW - minutesAgo * MIN, cpuMs })
  // 3-minute steps: 2.5 cores over 6 minutes (two steps) is busy; one step of 3 minutes is not yet; a quiet step in between breaks the run.
  assert.equal(isBusy([sample(6, 0), sample(3, 3 * MIN * 2.5), sample(0, 6 * MIN * 2.5)], { cores: 2, spanMs: 5 * MIN }), true)
  assert.equal(isBusy([sample(3, 0), sample(0, 3 * MIN * 2.5)], { cores: 2, spanMs: 5 * MIN }), false)
  assert.equal(isBusy([sample(6, 0), sample(3, 3 * MIN * 1.5), sample(0, 3 * MIN * 1.5 + 3 * MIN * 2.5)], { cores: 2, spanMs: 5 * MIN }), false)
  assert.equal(isBusy([sample(9, 0), sample(6, 3 * MIN * 0.1), sample(3, 3 * MIN * 0.1 + 3 * MIN * 2.5), sample(0, 3 * MIN * 0.1 + 6 * MIN * 2.5)], { cores: 2, spanMs: 5 * MIN }), true, 'an old quiet step before the run does not count')
  assert.equal(isBusy([sample(3, 100), sample(0, 50)], { cores: 2, spanMs: 5 * MIN }), false, 'a fall (a child gone) breaks the run')
  assert.equal(isBusy([], { cores: 2, spanMs: 5 * MIN }), false)
  // Through the loop's memory: a 12-minute-old Edge, starter gone, its gpu child eating 12.8 cores while the main stays at 0.1: nothing at
  // the first two samples (one step of CPU), closed at the third (the mutant "the main's CPU alone" would wait the full 30 minutes).
  const memory = browserMemory()
  const young = cpuMs => [proc(500, 7000, 'msedge.exe', 0, { created: FILETIME(NOW - 12 * MIN), commandLine: cdp, cpuMs: cpuMs / 128 }), proc(501, 500, 'msedge.exe', 0, { created: FILETIME(NOW - 12 * MIN + 1000), threads: 12, commandLine: 'msedge.exe --type=gpu-process', cpuMs })]
  assert.deepEqual(watch(young(12 * MIN * 12.7), memory, { now: NOW }), [])
  assert.deepEqual(watch(young(15 * MIN * 12.7), memory, { now: NOW + 3 * MIN }), [])
  const third = watch(young(18 * MIN * 12.7), memory, { now: NOW + 6 * MIN })
  assert.deepEqual(third.map(one => [one.pid, one.why, Math.round(one.cores * 10) / 10]), [[500, 'over 2 cores for 5 min', 12.8]])
  assert.equal(leakedWords(third[0], NOW + 6 * MIN), 'edge-cdp-b1126: a headless Edge (process 500, started 20:48, 18 min, 12.8 cores) with its starter gone, over 2 cores for 5 min')
  // A quiet one (0.4 cores) is left alone until the half hour.
  const quiet = browserMemory()
  for (const step of [0, 3, 6, 9, 12]) assert.deepEqual(watch(young((12 + step) * MIN * 0.4), quiet, { now: NOW + step * MIN }), [], `${step} min`)
  assert.equal(watch(young(30 * MIN * 0.4), quiet, { now: NOW + 18 * MIN }).length, 1)
  // The memory follows the processes: a key whose process is gone is dropped (its samples and its close), the same number created anew is another browser.
  assert.deepEqual([...memory.samples.keys()], [browserKey(young(0)[0])])
  memory.closed.set(browserKey(young(0)[0]), { at: NOW, ok: true })
  assert.deepEqual(watch([], memory, { now: NOW + 9 * MIN }), [])
  assert.deepEqual([memory.samples.size, memory.closed.size], [0, 0])
})

test('guard 4: a browser the board tried to close before and still sees carries that attempt (the rule lists it, never a second kill), a failed one too', () => {
  const memory = browserMemory()
  const list = [proc(500, 7000, 'msedge.exe', 800, { commandLine: cdp })]
  assert.deepEqual([watch(list, memory)[0].closedAt, watch(list, memory)[0].closeOk], [null, null])
  memory.closed.set(browserKey(list[0]), { at: NOW - MIN, ok: false })
  assert.deepEqual([watch(list, memory)[0].closedAt, watch(list, memory)[0].closeOk], [NOW - MIN, false])
})

test('closing: the landing and a live DevTools connection skip it (nothing counted); then each process is killed while its creation time holds, and the tool\'s own folder removed, no other', async () => {
  const calls = []
  const kill = async processes => { calls.push(['kill', processes]); return { ok: true, why: null, killed: processes.length } }
  const remove = async folder => { calls.push(['remove', folder]); return { ok: true, why: null } }
  const inUse = async () => false
  const one = { pid: 500, created: 7, children: [{ pid: 501, created: 8 }, { pid: 502, created: 9 }], profile: `${TEMP}\\edge-cdp-b1126-k3Xp9q`, folder: `${TEMP}\\edge-cdp-b1126-k3Xp9q`, port: 9391, prefix: 'edge-cdp-b1126', startedAt: NOW }
  assert.deepEqual(await closeLeaked(one, { kill, remove, inUse }), { ok: true, skipped: false, why: null, profile: 'removed' })
  assert.deepEqual(calls, [['kill', [{ pid: 500, created: 7 }, { pid: 501, created: 8 }, { pid: 502, created: 9 }]], ['remove', `${TEMP}\\edge-cdp-b1126-k3Xp9q`]])
  calls.length = 0
  // The evidence tool's folder, not the profile in it, is what goes.
  assert.deepEqual(await closeLeaked({ ...one, profile: `${TEMP}\\board-evidence-f9NyC5\\profile`, folder: `${TEMP}\\board-evidence-f9NyC5` }, { kill, remove, inUse }), { ok: true, skipped: false, why: null, profile: 'removed' })
  assert.deepEqual(calls.at(-1), ['remove', `${TEMP}\\board-evidence-f9NyC5`])
  calls.length = 0
  // Guard 1: no tool folder (a scratchpad profile): the browser is closed, nothing removed.
  assert.deepEqual(await closeLeaked({ ...one, folder: null }, { kill, remove, inUse }), { ok: true, skipped: false, why: null, profile: 'left: not the tool\'s own folder' })
  assert.deepEqual(calls.map(call => call[0]), ['kill'])
  calls.length = 0
  // Guard 4: a landing runs, or a live process is connected to the DevTools port (a tool still driving it): skipped, nothing killed; unknown connections: skipped too.
  assert.deepEqual(await closeLeaked(one, { kill, remove, inUse, landing: () => true }), { ok: false, skipped: true, why: 'a landing runs', profile: null })
  assert.deepEqual(await closeLeaked(one, { kill, remove, inUse: async () => true }), { ok: false, skipped: true, why: 'in use: a live process is connected to its DevTools port', profile: null })
  assert.deepEqual(await closeLeaked(one, { kill, remove, inUse: async () => null }), { ok: false, skipped: true, why: 'its DevTools connections could not be read', profile: null })
  assert.deepEqual(calls, [], 'nothing killed, nothing removed')
  // A failed kill is not ok (and the loop records the attempt); a failed remove is said.
  assert.deepEqual(await closeLeaked(one, { kill: async () => ({ ok: false, why: 'access denied', killed: 0 }), remove, inUse }), { ok: false, skipped: false, why: 'access denied', profile: null })
  assert.deepEqual(await closeLeaked(one, { kill, remove: async () => ({ ok: false, why: 'EBUSY' }), inUse }), { ok: true, skipped: false, why: null, profile: 'left (EBUSY)' })
})

test('the Windows calls: the kill names each process with its creation time in one PowerShell call and kills only on a match; the DevTools port comes from the command line or the profile\'s file; the connection count says in use', async () => {
  const scripts = []
  const run = async script => { scripts.push(script); return '2\n' }
  assert.deepEqual(await killVerified([{ pid: 500, created: 133800000000000000 }, { pid: 501, created: 133800000000001000 }, { pid: 'x', created: 1 }], { platform: 'win32', run }), { ok: true, why: null, killed: 2 })
  assert.equal(scripts.length, 1)
  assert.match(scripts[0], /@\{ pid = 500; created = \[long\]133800000000000000 \}, @\{ pid = 501; created = \[long\]133800000000001000 \}/)
  assert.match(scripts[0], /\[long\]\$p\.CreationDate\.ToFileTimeUtc\(\) -eq \$one\.created/, 'the creation time must match')
  assert.match(scripts[0], /Stop-Process -Id \$one\.pid -Force/)
  assert.doesNotMatch(scripts[0], /taskkill|\/T/, 'no tree kill by number')
  assert.deepEqual(await killVerified([], { platform: 'win32', run }), { ok: true, why: null, killed: 0 })
  assert.deepEqual(await killVerified([{ pid: 5, created: 1 }], { platform: 'linux', run }), { ok: false, why: 'only on Windows', killed: 0 })
  assert.deepEqual(await killVerified([{ pid: 5, created: 1 }], { platform: 'win32', run: async () => { throw new Error('Access is denied') } }), { ok: false, why: 'Access is denied', killed: 0 })
  // The port: the command line's, else the profile's DevToolsActivePort file (its first line), else none.
  assert.equal(await devtoolsPortNow({ port: 9391, profile: 'C:\\p' }), 9391)
  assert.equal(await devtoolsPortNow({ port: null, profile: 'C:\\p' }, { read: async file => { assert.equal(file, 'C:\\p\\DevToolsActivePort'); return '54321\n/devtools/browser/abc' } }), 54321)
  assert.equal(await devtoolsPortNow({ port: null, profile: 'C:\\p' }, { read: async () => { throw new Error('ENOENT') } }), null)
  assert.equal(await devtoolsPortNow({ port: null, profile: null }), null)
  // In use: an established connection on that port, read in one PowerShell call; none for a browser without a port; null when the call failed.
  const asked = []
  assert.equal(await inUseNow({ port: 9391 }, { platform: 'win32', run: async script => { asked.push(script); return '1' } }), true)
  assert.match(asked[0], /Get-NetTCPConnection -State Established.*LocalPort -eq 9391 -or \$_\.RemotePort -eq 9391/)
  assert.equal(await inUseNow({ port: 9391 }, { platform: 'win32', run: async () => '0' }), false)
  assert.equal(await inUseNow({ port: null, profile: 'C:\\p' }, { platform: 'win32', run: async () => '1', read: async () => { throw new Error('ENOENT') } }), false)
  assert.equal(await inUseNow({ port: 9391 }, { platform: 'win32', run: async () => { throw new Error('no cmdlet') } }), null)
})
